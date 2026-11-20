// Regressions for "the editor turns the plugin off during a scan". Each
// checkpoint used to rewrite every piece of evidence read so far (quadratic
// over a scan, each write blocking the plugin's only thread), and every
// finished scan kept its whole file list and evidence forever, so the
// database, and the integrity check every new plugin process runs, grew by
// tens of megabytes a scan.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tempFolders, copyFixture, json as response } from "./helpers.js";
import { writeTags } from "../src/tags.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { ModelJobs } from "../src/model/jobs.js";
import { enqueueModelScan, modelStatus, runModelJobs } from "../src/model/runtime.js";

async function library(t, count) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const files = [];
  for (let i = 0; i < count; i++) {
    const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, `${i}.flac`));
    await writeTags(file, { title: [`Sonata No. ${i}: I. Allegro`] });
    files.push(file);
  }
  const ctx = {
    ...folders,
    settings: {},
    userOperations: { version: 1, url: "http://host.test/ops", token: "test-only" },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: { tracks: files.map((file, i) => ({ id: i, files: [{ id: i, path: file, albumId: 1, available: true }] })) },
      }),
  };
  return ctx;
}
const admin = { id: 1, role: "admin" };
const withCatalogue = async (ctx, read) => {
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    return read(c);
  } finally {
    c.close();
  }
};

// Runs a scan one file per checkpoint and stops it ("crashes") after
// `stopAfter` checkpoints; records what every checkpoint wrote.
async function scanUntil(t, ctx, stopAfter = Infinity) {
  const original = ModelJobs.prototype.checkpoint;
  const writes = [];
  ModelJobs.prototype.checkpoint = function (job, progress, options = {}) {
    if (!options.done && writes.length >= stopAfter) throw new Error("simulated crash");
    writes.push({ progress: JSON.stringify(progress).length, chunk: options.chunk?.items.length ?? 0, done: !!options.done });
    return original.call(this, job, progress, options);
  };
  t.after(() => (ModelJobs.prototype.checkpoint = original));
  try {
    await runModelJobs(ctx, { budgetMs: 60_000, batchSize: 1 });
  } catch (error) {
    if (error.message !== "simulated crash") throw error;
  } finally {
    ModelJobs.prototype.checkpoint = original;
  }
  // A crashed scan waits for a retry delay; let it run now.
  await withCatalogue(ctx, (c) => c.db.prepare("UPDATE model_job SET next_run_at=0 WHERE state='retry'").run());
  return writes;
}
const activeTracks = (ctx) =>
  withCatalogue(ctx, (c) => c.db.prepare("SELECT count(*) AS n FROM track_link WHERE state='active'").get().n);

test("scan checkpoints save only new evidence, resume from chunks and leave a compact job", async (t) => {
  const ctx = await library(t, 6);
  const id = await enqueueModelScan(ctx, admin);
  const first = await scanUntil(t, ctx, 3);
  // Each checkpoint wrote one file's evidence and a small progress record,
  // not everything read so far.
  assert.deepEqual(first.map((w) => w.chunk), [1, 1, 1]);
  assert.ok(first.every((w) => w.progress < 400), JSON.stringify(first));
  await withCatalogue(ctx, (c) => {
    const job = new ModelJobs(c).get(id);
    assert.equal(job.progress.collected, undefined);
    assert.equal(job.progress.chunks, 3);
    assert.equal(new ModelJobs(c).chunks(id, job.progress.chunks).length, 3);
  });
  const rest = await scanUntil(t, ctx);
  assert.ok(rest.at(-1).done);
  assert.equal(await activeTracks(ctx), 6);
  await withCatalogue(ctx, (c) => {
    const job = new ModelJobs(c).get(id);
    assert.equal(job.state, "done");
    assert.equal(c.db.prepare("SELECT count(*) AS n FROM model_job WHERE type='scan_chunk'").get().n, 0);
    assert.equal(job.input.files, undefined);
    assert.equal(job.input.total, 6);
  });
  const status = await modelStatus(ctx);
  assert.equal(status.scan.total, 6);
  assert.equal(status.scan.processed, 6);
  assert.deepEqual(status.jobs.map((row) => ({ ...row })), [{ state: "done", count: 1 }]);
});

test("a scan saved by an older version (all evidence in progress) resumes and finishes", async (t) => {
  const ctx = await library(t, 5);
  const id = await enqueueModelScan(ctx, admin);
  await scanUntil(t, ctx, 2);
  // Rewrite the saved state the way the previous version stored it.
  await withCatalogue(ctx, (c) => {
    const jobs = new ModelJobs(c);
    const job = jobs.get(id);
    const collected = jobs.chunks(id, job.progress.chunks);
    c.db.prepare("DELETE FROM model_job WHERE type='scan_chunk'").run();
    c.db
      .prepare("UPDATE model_job SET progress=? WHERE id=?")
      .run(JSON.stringify({ cursor: job.progress.cursor, collected, errors: [], errorCount: 0 }), id);
  });
  const writes = await scanUntil(t, ctx);
  // The old evidence is saved again as the first chunk, then one per file.
  assert.equal(writes[0].chunk, 3);
  assert.equal(await activeTracks(ctx), 5);
  await withCatalogue(ctx, (c) => assert.equal(new ModelJobs(c).get(id).state, "done"));
});

test("old finished scans are compacted and stop growing the database", async (t) => {
  const ctx = await library(t, 3);
  await enqueueModelScan(ctx, admin);
  await runModelJobs(ctx, { budgetMs: 60_000 });
  // A finished scan as the previous version left it: the whole file list and
  // all evidence still in the row.
  const bloated = await withCatalogue(ctx, (c) => {
    const row = c.db.prepare("SELECT id FROM model_job WHERE key='library_scan'").get();
    const files = Array.from({ length: 2000 }, (_, i) => ({ coreId: String(i), path: `/library/${i}.flac` }));
    c.db
      .prepare("UPDATE model_job SET input=?,progress=? WHERE id=?")
      .run(
        JSON.stringify({ instanceId: "x", epoch: "e", generation: 1, files }),
        JSON.stringify({ cursor: 2000, collected: files, errors: [], errorCount: 0 }),
        row.id,
      );
    return row.id;
  });
  await withCatalogue(ctx, (c) => new ModelJobs(c).compactFinished());
  await withCatalogue(ctx, (c) => {
    const row = c.db.prepare("SELECT length(input) AS i,length(progress) AS p,input,progress FROM model_job WHERE id=?").get(bloated);
    assert.ok(row.i < 300 && row.p < 300, `compact sizes ${row.i}/${row.p}`);
    assert.equal(JSON.parse(row.input).total, 2000);
    assert.deepEqual(JSON.parse(row.progress), { cursor: 2000, errorCount: 0, reused: 0, errors: [] });
  });
});

test("opening the database never waits on the full integrity check; a scan runs it", async (t) => {
  const ctx = await library(t, 2);
  await enqueueModelScan(ctx, admin);
  // A broken reference fails the full check, so it shows where the check runs.
  await withCatalogue(ctx, (c) => {
    c.db.exec("PRAGMA foreign_keys=OFF");
    c.db.prepare("INSERT INTO relation(id,kind,source_id,target_id,data) VALUES ('broken','movement','gone','gone','{}')").run();
  });
  // As after a restart: a database file this process has never opened.
  const restarted = { ...ctx, dataFolder: path.join(ctx.dataFolder, "..", "restarted") };
  await fs.cp(path.join(ctx.dataFolder, "model"), path.join(restarted.dataFolder, "model"), { recursive: true });
  // Page calls open the database: each plugin process's first one used to
  // pay a full read of the file first, long enough to time out.
  assert.ok(await modelStatus(restarted));
  await assert.rejects(runModelJobs(restarted, { budgetMs: 60_000 }), /integrity check failed/);
});
