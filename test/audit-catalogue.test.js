// The read-only catalogue audit is the dry run before a release reaches the
// user's library: it must report what the repairs would do, and never
// change the catalogue it reads.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks, mergeWork } from "../src/model/auto-match.js";
import { renderAlbumPresentation } from "../src/model/presentation.js";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "audit-catalogue.mjs");

test("audit: the dry run lists the repairs and the live catalogue is left as it was", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const model = path.join(folders.dataFolder, "model");
  const c = await openCatalogue(model);
  c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const titles = [1, 2, 3].map((n) => `Valse oubliée No. ${n}, S215 No. ${n}`);
  const tracks = titles.map((title, i) => ({
    coreId: `howard-${i}`,
    fileId: `howard-${i}`,
    path: `/library/howard/${i}.flac`,
    size: 1000,
    durationMs: 60000,
    fingerprint: `audio-sha256-v2:howard-${i}`,
    albumId: "howard",
    hints: { title, album: "The Complete Liszt Piano Music", albumArtist: "Leslie Howard", artist: "Leslie Howard", composer: ["Franz Liszt"], genres: ["Classical"], work: "", trackNumber: i + 1, discNumber: 1 },
  }));
  for (const row of reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: 1, tracks })) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c, { albumId: "howard", actor: "admin", allowStructuredTitles: true });
  // What 1.0.22's merge left: three valses in one work.
  const workOf = (title) => renderAlbumPresentation(c, "howard").groups.find((group) => group.items.some((item) => item.title === title)).workId;
  const keep = workOf(titles[1]);
  for (const title of [titles[0], titles[2]]) mergeWork(c, keep, workOf(title), "model-scan");
  c.close();
  const file = path.join(model, "classical.sqlite");
  const hash = async () => createHash("sha256").update(await fs.readFile(file)).digest("hex");
  const before = await hash();

  const out = path.join(folders.root, "audit");
  await promisify(execFile)(process.execPath, [script, model, out]);
  const report = await fs.readFile(path.join(out, "audit.md"), "utf8");
  const { dryRun } = JSON.parse(await fs.readFile(path.join(out, "audit.json"), "utf8"));
  assert.match(report, /works split from a work an old merge joined across sibling numbers: 2/);
  assert.deepEqual(dryRun.splits.map((split) => split.tracksName).sort(), ["cat:s:215:1", "cat:s:215:3"]);
  assert.equal(dryRun.merges.length, 0);
  assert.equal(dryRun.duplicatesAfter.length, 0);
  // The snapshot is gone and the live file unchanged, byte for byte.
  assert.deepEqual((await fs.readdir(out)).sort(), ["audit.json", "audit.md"]);
  assert.equal(await hash(), before);
  const live = await openCatalogue(model);
  try {
    assert.equal(live.db.prepare("SELECT count(*) AS n FROM audit_event WHERE action='work.split_sibling'").get().n, 0);
  } finally {
    live.close();
  }
});
