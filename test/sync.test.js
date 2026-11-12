import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tempFolders, copyFixture, json as response } from "./helpers.js";
import plugin from "../src/index.js";
import {
  modelStatus,
  modelSyncDue,
  requestModelSync,
  enqueueModelScan,
  runModelJobs,
  SYNC_INTERVAL_MS,
} from "../src/model/runtime.js";
import { openCatalogue } from "../src/model/catalogue.js";

async function library(t, count = 3) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const files = [];
  for (let i = 0; i < count; i++) {
    const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, `${i}.flac`));
    // Distinct audio per file (identical copies are legitimately ambiguous).
    const { size } = await fs.stat(file);
    const fd = await fs.open(file, "r+");
    await fd.write(Buffer.from([i + 1]), 0, 1, size - 50);
    await fd.close();
    await fs.utimes(file, 1_000_000_000, 1_000_000_000);
    files.push(file);
  }
  let snapshots = 0;
  const host = () => ({
    version: 1,
    complete: true,
    library: {
      tracks: files.map((file, i) => ({
        id: i,
        title: `Track ${i}`,
        files: [{ id: i, path: file, available: true, durationMs: 1000 }],
      })),
    },
  });
  const ctx = {
    ...folders,
    settings: {},
    api: { url: "http://host.test/api", key: "plugin-key" },
    fetch: async (url, init) => {
      assert.equal(url, "http://host.test/api/plugins/aurral-classical/user-operations/library");
      assert.equal(init.headers["X-Api-Key"], "plugin-key");
      snapshots++;
      return response(host());
    },
  };
  return { folders, files, ctx, snapshots: () => snapshots };
}
const evidenceRows = async (ctx) => {
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    return c.db.prepare("SELECT count(*) AS n FROM track_evidence").get().n;
  } finally {
    c.close();
  }
};

test("scheduled runs start the first scan with the plugin API key, then only when due", async (t) => {
  const { ctx, snapshots } = await library(t);
  t.mock.method(globalThis, "fetch", ctx.fetch);
  const input = { ...ctx, settings: {} };
  await plugin.scheduled(input);
  const status = await modelStatus(ctx);
  assert.equal(status.scan.state, "done");
  assert.equal(status.tracks.find((r) => r.state === "active").count, 3);
  assert.equal(snapshots(), 1);
  await plugin.scheduled(input);
  assert.equal(snapshots(), 1, "a fresh scan is not repeated");
  // A finished download requests the next sync without scanning inside the event.
  await plugin.events["download.finished"]({ ...input, track: { path: "/x.flac" }, source: "test" });
  assert.equal(snapshots(), 1);
  assert.equal(await modelSyncDue(ctx), true);
  await plugin.scheduled(input);
  assert.equal(snapshots(), 2);
  assert.equal(await modelSyncDue(ctx), false);
  assert.equal(
    await modelSyncDue(ctx, { now: Date.now() + SYNC_INTERVAL_MS + 1 }),
    true,
  );
});

test("one unreadable or deleted file never fails the library scan", async (t) => {
  const { ctx, files } = await library(t, 4);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 60_000 });
  // Now: one file is deleted, one becomes unreadable (moved outside the library).
  await fs.rm(files[0]);
  await fs.rename(files[1], path.join(ctx.root, "outside.flac"));
  await fs.symlink(path.join(ctx.root, "outside.flac"), files[1]);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 60_000 });
  const status = await modelStatus(ctx);
  assert.equal(status.scan.state, "done");
  assert.equal(status.scan.skipped, 2);
  const states = Object.fromEntries(status.tracks.map((r) => [r.state, r.count]));
  // The deleted file is missing; the unreadable one keeps its previous evidence.
  assert.deepEqual(states, { active: 3, missing: 1 });
});

test("rescans reuse unchanged fingerprints and add no evidence rows", async (t) => {
  const { ctx, files } = await library(t, 2);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 60_000 });
  const rows = await evidenceRows(ctx);
  // Change audio bytes but keep size, mtime and inode: an unchanged-looking
  // file is not re-hashed, so the stored fingerprint is reused.
  const stat = await fs.stat(files[0]);
  const fd = await fs.open(files[0], "r+");
  await fd.write(Buffer.from([0x55]), 0, 1, stat.size - 100);
  await fd.close();
  await fs.utimes(files[0], 1_000_000_000, 1_000_000_000);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 60_000 });
  assert.equal(await evidenceRows(ctx), rows);
  const status = await modelStatus(ctx);
  assert.equal(status.tracks.find((r) => r.state === "active").count, 2);
});

test("a scan whose process died reports as interrupted, then resumes", async (t) => {
  const { ctx } = await library(t, 2);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  // Simulate the host killing the plugin mid-scan: running, lease lapsed.
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  c.db.prepare("UPDATE model_job SET state='running',owner='dead',lease_until=1,attempt=1").run();
  c.close();
  const input = { ...ctx, user: { id: 1, role: "admin" } };
  t.mock.method(globalThis, "fetch", ctx.fetch);
  assert.match(
    (await plugin.actions["classical-model-status"](input)).message,
    /interrupted \(run Scan again to resume\); processed 0\/2/,
  );
  const result = await plugin.actions["classical-model-scan"](input);
  assert.match(result.message, /done; processed 2\/2/);
});

test("#10 a sync request survives a failed snapshot, a pending scan and a resumed failed scan", async (t) => {
  const { ctx, snapshots } = await library(t);
  const admin = { id: 1, role: "admin" };
  const fetch = ctx.fetch;
  // 1. The host snapshot fails: the request stays.
  await requestModelSync(ctx);
  ctx.fetch = async () => {
    throw new Error("host unavailable");
  };
  await assert.rejects(enqueueModelScan(ctx, admin), /host unavailable/);
  assert.equal(await modelSyncDue(ctx), true);
  ctx.fetch = fetch;
  // 2. A scan is already pending with an older snapshot: the request outlives it.
  await enqueueModelScan(ctx, admin);
  assert.equal(snapshots(), 1, "that enqueue answered the first request");
  await requestModelSync(ctx);
  await enqueueModelScan(ctx, admin); // resumes the pending scan
  assert.equal(snapshots(), 1);
  await runModelJobs(ctx, { budgetMs: 60_000 });
  assert.equal(await modelSyncDue(ctx), true, "a fresh snapshot is still owed");
  await enqueueModelScan(ctx, admin);
  assert.equal(snapshots(), 2);
  await runModelJobs(ctx, { budgetMs: 60_000 });
  assert.equal(await modelSyncDue(ctx), false);
  // 3. The latest scan failed, then a download asked for a sync: take a fresh
  // snapshot rather than resuming the failed scan's older one.
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    c.db.prepare("UPDATE model_job SET state='failed',created_at=? WHERE id=(SELECT id FROM model_job ORDER BY created_at DESC LIMIT 1)").run(Date.now() - 1000);
  } finally {
    c.close();
  }
  await requestModelSync(ctx);
  await enqueueModelScan(ctx, admin);
  assert.equal(snapshots(), 3);
  assert.equal(await modelSyncDue(ctx), false);
  // An explicit Scan with no newer request still resumes a failed scan.
  await runModelJobs(ctx, { budgetMs: 60_000 });
  const c2 = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    c2.db.prepare("UPDATE model_job SET state='failed' WHERE id=(SELECT id FROM model_job ORDER BY created_at DESC LIMIT 1)").run();
  } finally {
    c2.close();
  }
  await enqueueModelScan(ctx, admin);
  assert.equal(snapshots(), 3);
});
