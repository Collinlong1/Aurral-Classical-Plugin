import { File, TagTypes } from "node-taglib-sharp";
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
import { reconcile } from "../src/model/reconcile.js";
import { Metadata } from "../src/model/metadata.js";
import { readValues } from "../src/tags.js";

async function library(t, count = 3, { identical = false } = {}) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const files = [];
  for (let i = 0; i < count; i++) {
    const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, `${i}.flac`));
    // Most fixtures use distinct audio; duplicate-copy tests retain the same bytes.
    if (!identical) {
      const { size } = await fs.stat(file);
      const fd = await fs.open(file, "r+");
      await fd.write(Buffer.from([i + 1]), 0, 1, size - 50);
      await fd.close();
    }
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
  // One file names its conductor, performers and artist ID; the other names
  // none, and its evidence keeps exactly the fields it had before they were read.
  const tagged = File.createFromPath(files[1]);
  try {
    tagged.tag.conductor = "Herbert von Karajan";
    const xiph = tagged.getTag(TagTypes.Xiph, true);
    xiph.setFieldAsStrings("PERFORMER", "Anne-Sophie Mutter (violin)", "Berliner Philharmoniker");
    xiph.setFieldAsStrings("MUSICBRAINZ_ARTISTID", "artist-mbid-1");
    tagged.save();
  } finally {
    tagged.dispose();
  }
  await fs.utimes(files[1], 1_000_000_000, 1_000_000_000);
  const scan = async () => {
    await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 60_000 });
  };
  const fingerprints = async () => {
    const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
    try {
      return c.db.prepare("SELECT json_extract(evidence,'$.fingerprint') AS f FROM track_link WHERE state='active' ORDER BY core_id").all().map((row) => row.f);
    } finally {
      c.close();
    }
  };
  await scan();
  const rows = await evidenceRows(ctx);
  const first = await fingerprints();
  const hints = async () => {
    const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
    try {
      return c.db.prepare("SELECT json_extract(evidence,'$.hints') AS h FROM track_link WHERE state='active' ORDER BY core_id").all().map((row) => JSON.parse(row.h));
    } finally {
      c.close();
    }
  };
  const [plain, credited] = await hints();
  for (const key of ["conductor", "performers", "artistMbids"]) assert.equal(key in plain, false, key);
  assert.deepEqual(
    [credited.conductor, credited.performers, credited.artistMbids],
    ["Herbert von Karajan", ["Anne-Sophie Mutter (violin)", "Berliner Philharmoniker"], ["artist-mbid-1"]],
  );
  await scan();
  assert.equal(await evidenceRows(ctx), rows);
  assert.deepEqual(await fingerprints(), first);
  assert.deepEqual(await hints(), [plain, credited]);
  // Written in place, keeping size, modified time and inode: before 1.0.33
  // this file was taken as unchanged; the ctime now shows the write.
  const stat = await fs.stat(files[0]);
  const fd = await fs.open(files[0], "r+");
  await fd.write(Buffer.from([0x55]), 0, 1, stat.size - 100);
  await fd.close();
  await fs.utimes(files[0], 1_000_000_000, 1_000_000_000);
  const id = await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 60_000 });
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    // The written file is opened and hashed again; the other is reused.
    assert.equal(JSON.parse(c.db.prepare("SELECT progress FROM model_job WHERE id=?").get(id).progress).reused, 1);
  } finally {
    c.close();
  }
  // Its audio changed, so it is hashed anew; the other keeps its hash.
  const after = await fingerprints();
  assert.notEqual(after[0], first[0]);
  assert.equal(after[1], first[1]);
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

// A scan took about an hour on the user's library: every unchanged file was
// opened again to re-read its tags. Now a file nothing wrote to since the
// last scan (same path, size, modified time, inode and ctime, placed the same
// way by the host) is only stat'ed. A tag edit that keeps the modified time
// still moves ctime, so it is read again.
test("rescans open only files written since the last scan, even when a tag edit kept the modified time", async (t) => {
  const { ctx, files } = await library(t, 3);
  const scan = async () => {
    const id = await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 30_000 });
    const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
    try {
      return {
        reused: JSON.parse(c.db.prepare("SELECT progress FROM model_job WHERE id=?").get(id).progress).reused,
        titles: c.db.prepare("SELECT json_extract(evidence,'$.hints.title') AS title FROM track_link ORDER BY core_id").all().map((row) => row.title),
      };
    } finally {
      c.close();
    }
  };
  // The first scan after this change has no ctime to compare: it reads all.
  assert.equal((await scan()).reused, 0);
  assert.equal((await scan()).reused, 3);
  const { writeTags } = await import("../src/tags.js");
  const { mtime, atime } = await fs.stat(files[1]);
  await writeTags(files[1], { title: ["Retagged"] });
  await fs.utimes(files[1], atime, mtime);
  const after = await scan();
  assert.equal(after.reused, 2);
  assert.equal(after.titles[1], "Retagged");
  // Written in place, same size, inode and modified time: only ctime tells.
  const before = await fs.stat(files[2]);
  const fd = await fs.open(files[2], "r+");
  await fd.write(Buffer.from([0x55]), 0, 1, before.size - 60);
  await fd.close();
  await fs.utimes(files[2], before.atime, before.mtime);
  const inPlace = await fs.stat(files[2]);
  assert.deepEqual([inPlace.size, inPlace.ino, inPlace.mtimeMs], [before.size, before.ino, before.mtimeMs]);
  assert.equal((await scan()).reused, 2);
});

// On the user's server half the files reported a new inode number at every
// scan (a filesystem that makes them up), so every rescan re-hashed them:
// an hour for 12,802 files. Once a ctime is stored, it decides.
test("rescans reuse files whose inode number changed but which nothing wrote to", async (t) => {
  const { ctx } = await library(t, 3);
  const scan = async () => {
    const id = await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 30_000 });
    const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
    try {
      return JSON.parse(c.db.prepare("SELECT progress FROM model_job WHERE id=?").get(id).progress).reused;
    } finally {
      c.close();
    }
  };
  await scan();
  const rows = await evidenceRows(ctx);
  // As if the filesystem had numbered every file differently since.
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  for (const row of c.db.prepare("SELECT id,evidence FROM track_link").all()) {
    const evidence = JSON.parse(row.evidence);
    evidence.ino += 1_000_000;
    c.db.prepare("UPDATE track_link SET evidence=? WHERE id=?").run(JSON.stringify(evidence), row.id);
  }
  c.close();
  assert.equal(await scan(), 3);
  assert.equal(await evidenceRows(ctx), rows);
});

// On the user's server a scan's final step failed with "database is locked":
// since 1.0.34 model jobs run on worker threads with their own connections,
// and another writer held the lock past the 5-second wait. A background job
// now waits up to a minute; scheduled runs skip while one is running.
test("a scan waits for another connection's write instead of failing as locked", async (t) => {
  const { ctx } = await library(t, 2);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  const { Worker } = await import("node:worker_threads");
  const file = path.join(ctx.dataFolder, "model", "classical.sqlite");
  // Another writer: takes the write lock and holds it for six seconds.
  const blocker = new Worker(
    `const { DatabaseSync } = require("node:sqlite");
     const { parentPort, workerData } = require("node:worker_threads");
     const db = new DatabaseSync(workerData);
     db.exec("BEGIN IMMEDIATE");
     parentPort.postMessage("locked");
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
     db.exec("COMMIT");
     db.close();`,
    { eval: true, workerData: file },
  );
  await new Promise((resolve) => blocker.once("message", resolve));
  const done = new Promise((resolve) => blocker.once("exit", resolve));
  await runModelJobs(ctx, { budgetMs: 60_000 });
  await done;
  assert.equal((await modelStatus(ctx)).scan.state, "done");
});

async function duplicateCatalogue(t) {
  const folders = await tempFolders(), c = await openCatalogue(folders.dataFolder);
  t.after(async () => { c.close(); await fs.rm(folders.root, { recursive: true, force: true }); });
  const track = (id) => ({ coreId: id, fileId: id, path: `/library/${id}.flac`, size: 1000, durationMs: 60000, fingerprint: "audio-sha256-v2:identical", hints: { title: id } });
  let generation = 0;
  const scan = (tracks, epoch = "e") => reconcile(c, { version: 1, complete: true, instanceId: "i", epoch, generation: ++generation, tracks });
  return { c, track, scan };
}
for (const movedFirst of [true, false]) {
  test(`#16 exact copies are reserved before a duplicate-audio move (moved first: ${movedFirst})`, async (t) => {
    const { c, track, scan } = await duplicateCatalogue(t);
    const original = [track("moved"), track("fixed")];
    if (!movedFirst) original.reverse();
    const rows = scan(original), ids = Object.fromEntries(rows.map((r) => [r.coreId, r.id]));
    const m = new Metadata(c);
    for (const row of rows) m.manual(row.id, "title", `Pinned ${row.coreId}`, { actor: "1", pin: true });
    const moved = { ...track("moved"), coreId: "new-core", fileId: "new-file", path: "/library/renamed.flac" };
    const result = scan([track("fixed"), moved]);
    assert.equal(result.length, 2);
    assert.equal(result.find((r) => r.coreId === "new-core").id, ids.moved);
    assert.equal(result.find((r) => r.coreId === "fixed").id, ids.fixed);
    assert.equal(m.resolve(ids.moved, "title").value, "Pinned moved");
    assert.equal(m.resolve(ids.fixed, "title").value, "Pinned fixed");
    assert.deepEqual(c.db.prepare("SELECT state FROM track_link").all().map((r) => r.state), ["active", "active"]);
    const evidence = c.db.prepare("SELECT count(*) AS n FROM track_evidence").get().n;
    scan([moved, track("fixed")]);
    assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_evidence").get().n, evidence);
    assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link'").get().n, 0);
  });
}

test("#16 deleting one of 28 identical copies leaves the exact copies active and only the deleted link missing", async (t) => {
  const { c, track, scan } = await duplicateCatalogue(t);
  const original = Array.from({ length: 28 }, (_, i) => track(String(i)));
  const before = scan(original);
  const after = scan(original.slice(1));
  assert.deepEqual(after.map((r) => r.id), before.slice(1).map((r) => r.id));
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(before[0].id).state, "missing");
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_link WHERE state='active'").get().n, 27);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link'").get().n, 0);
  assert.deepEqual(c.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("#16 two indistinguishable moved copies stay ambiguous while an exact third copy stays active", async (t) => {
  const { c, track, scan } = await duplicateCatalogue(t);
  const rows = scan([track("a"), track("b"), track("fixed")]);
  scan([{ ...track("x"), path: "/library/moved/x.flac" }, { ...track("y"), path: "/library/moved/y.flac" }, track("fixed")]);
  for (const row of rows.slice(0, 2)) assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(row.id).state, "review");
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(rows[2].id).state, "active");
  const reviews = c.db.prepare("SELECT evidence FROM review_item WHERE kind='track_link'").all();
  assert.equal(reviews.length, 2);
  for (const row of reviews) assert.deepEqual(JSON.parse(row.evidence).candidates.map((r) => r.coreId).sort(), ["x", "y"]);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_link").get().n, 3);
});

test("#16 an epoch change does not reserve exact-looking duplicate copies", async (t) => {
  const { c, track, scan } = await duplicateCatalogue(t);
  const tracks = [track("a"), track("b")], old = scan(tracks);
  scan(tracks, "new-epoch");
  for (const row of old) assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(row.id).state, "review");
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_link WHERE state='active'").get().n, 2);
});

test("#16 real identical-audio files keep their links when one moves and another is deleted", async (t) => {
  const { ctx, files } = await library(t, 28, { identical: true });
  const scan = async () => { await enqueueModelScan(ctx, { id: 1, role: "admin" }); await runModelJobs(ctx, { budgetMs: 60000 }); };
  const links = async () => { const c = await openCatalogue(path.join(ctx.dataFolder, "model")); try { return c.db.prepare("SELECT id,core_id,state,evidence FROM track_link ORDER BY CAST(core_id AS INTEGER)").all(); } finally { c.close(); } };
  await scan(); const before = await links();
  const renamed = path.join(ctx.libraryFolder, "renamed.flac");
  await fs.rename(files[0], renamed); files[0] = renamed;
  await scan();
  let after = await links();
  assert.deepEqual(after.map((r) => r.id), before.map((r) => r.id));
  assert.ok(after.every((r) => r.state === "active"));
  await fs.rm(files.pop()); await scan(); after = await links();
  assert.deepEqual(after.map((r) => r.id), before.map((r) => r.id));
  assert.equal(after.filter((r) => r.state === "active").length, 27);
  assert.equal(after.at(-1).state, "missing");
});

test("#16 conflicting historical exact claims remain in review without stealing a fixed copy", async (t) => {
  const { c, track, scan } = await duplicateCatalogue(t);
  const original = [track("a"), track("fixed")], rows = scan(original);
  c.db.prepare(`INSERT INTO track_link SELECT 'historical-review',instance_id,core_id,file_id,'review',evidence,revision,created_at,updated_at
    FROM track_link WHERE id=?`).run(rows[0].id);
  c.db.prepare("INSERT INTO metadata_target(id,track_link_id) VALUES ('historical-review','historical-review')").run();
  const result = scan(original);
  assert.deepEqual(result.map((r) => r.id), [rows[1].id]);
  for (const id of [rows[0].id, "historical-review"]) assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(id).state, "review");
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(rows[1].id).state, "active");
});

test("#16 deleting an identical file sharing a core track does not review the exact remaining file", async (t) => {
  const { c, track, scan } = await duplicateCatalogue(t);
  const a = { ...track("a"), coreId: "shared-track" }, b = { ...track("b"), coreId: "shared-track" };
  const before = scan([a, b]);
  const after = scan([a]);
  assert.deepEqual(after.map((r) => r.id), [before[0].id]);
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(before[1].id).state, "missing");
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link'").get().n, 0);
});

// v0.3 8.6: a rescan after classical tags were written keeps every link and
// placement, reads the new tags, and an admin's values still win.
test("after tags are written, a rescan keeps links, placements and manual values, and makes no second work", async (t) => {
  const { tagLibrary } = await import("./tag-library.js");
  const { runTagJobs } = await import("../src/model/tag-write.js");
  const { renderAlbumPresentation } = await import("../src/model/presentation.js");
  const lib = await tagLibrary(t);
  const state = async () => {
    const c = await lib.catalogue();
    try {
      const work = renderAlbumPresentation(c, "fifth").groups[0].workId;
      return {
        work,
        links: c.db.prepare("SELECT id,core_id,state FROM track_link ORDER BY core_id").all().map((row) => ({ ...row })),
        placements: c.db.prepare("SELECT i.id,i.movement_id,i.segment_id,s.track_link_id FROM realization_item i JOIN segment s ON s.id=i.segment_id JOIN realization r ON r.id=i.realization_id WHERE r.work_id=? ORDER BY i.id").all(work).map((row) => ({ ...row })),
        works: c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='work' AND deleted_at IS NULL").get().n,
        hints: Object.fromEntries(c.db.prepare("SELECT core_id,evidence FROM track_link WHERE state='active'").all().map((row) => [row.core_id, JSON.parse(row.evidence).hints])),
        values: Object.fromEntries(["title", "catalogue"].map((field) => [field, new Metadata(c).resolve(work, field)])),
      };
    } finally {
      c.close();
    }
  };
  const first = await state();
  // An admin's title and catalogue number, then the tags they propose.
  const c = await lib.catalogue();
  new Metadata(c).manual(first.work, "title", "Symphony No. 5 “Fate”", { actor: "admin", pin: true });
  new Metadata(c).manual(first.work, "catalogue", ["Op. 67"], { actor: "admin", pin: true });
  c.close();
  const preview = (await lib.mutate("tag-preview-open", { albumId: "fifth" }, "album:fifth")).selection;
  assert.equal((await lib.mutate("tag-write", { token: preview.slice(5), confirm: true }, preview)).ok, true);
  await runTagJobs(lib.ctx, { budgetMs: 30_000 });
  assert.deepEqual(readValues(lib.files[0].file, ["work", "catalogue"]), { work: ["Symphony No. 5 “Fate”"], catalogue: ["Op. 67"] });

  await lib.scan();
  const after = await state();
  assert.deepEqual(after.links, first.links, "every track keeps its link");
  assert.deepEqual(after.placements, first.placements, "every movement keeps its tracks");
  assert.equal(after.works, first.works, "the new WORK tags make no second work");
  // The scan read the new tags…
  assert.equal(after.hints["0"].work, "Symphony No. 5 “Fate”");
  assert.deepEqual(after.hints["0"].performers, ["Berliner Philharmoniker (orchestra)", "Herbert von Karajan (performer)"]);
  // …and the admin's values still win over anything the tags now say.
  assert.deepEqual([after.values.title.value, after.values.title.source], ["Symphony No. 5 “Fate”", "manual"]);
  assert.deepEqual([after.values.catalogue.value, after.values.catalogue.source], [["Op. 67"], "manual"]);
  // Nothing more to write.
  const again = await lib.read((await lib.mutate("tag-preview-open", { albumId: "fifth" }, "album:fifth")).selection);
  assert.deepEqual(again.sections.map((s) => s.title), ["Already up to date (4)"]);
});
