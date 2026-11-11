import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tempFolders, copyFixture, json as response } from "./helpers.js";
import plugin from "../src/index.js";
import {
  modelStatus,
  modelSyncDue,
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
