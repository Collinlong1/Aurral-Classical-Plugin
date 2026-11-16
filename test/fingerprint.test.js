import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tempFolders, copyFixture } from "./helpers.js";
import { writeTags, readTags } from "../src/tags.js";
import {
  fingerprint,
  AUDIO_PREFIX,
  CONTAINER_PREFIX,
} from "../src/model/fingerprint.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { reconcile, classify } from "../src/model/reconcile.js";

for (const name of ["sine.flac", "sine.mp3"])
  test(`${name}: tag edits keep the audio fingerprint; audio edits change it`, async (t) => {
    const folders = await tempFolders();
    t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
    const file = await copyFixture(name, path.join(folders.libraryFolder, name));
    const before = await fingerprint(file);
    assert.ok(before.startsWith(AUDIO_PREFIX), before);
    const bytesBefore = await fs.readFile(file);
    await writeTags(file, {
      composer: ["Ludwig van Beethoven"],
      work: "Symphony No. 5 in C minor, Op. 67: I. Allegro con brio",
      title: "A much longer retagged title ".repeat(20),
    });
    assert.ok(!bytesBefore.equals(await fs.readFile(file)), "retag changed the file");
    assert.equal(await fingerprint(file), before);
    const bytes = await fs.readFile(file);
    bytes[bytes.length - 200] ^= 0xff;
    await fs.writeFile(file, bytes);
    assert.notEqual(await fingerprint(file), before);
  });

test("unsupported containers fall back to a tag-sensitive whole-file hash", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = await copyFixture("sine.m4a", path.join(folders.libraryFolder, "a.m4a"));
  assert.ok((await fingerprint(file)).startsWith(CONTAINER_PREFIX));
});

const snapshot = (tracks, generation) => ({
  version: 1,
  complete: true,
  instanceId: "i",
  epoch: "e",
  generation,
  tracks,
});
const item = (extra) => ({
  coreId: "t1",
  fileId: "f1",
  path: "/library/1.flac",
  size: 1000,
  durationMs: 2000,
  ...extra,
});

test("a retag keeps the track link active and its work attachment", async (t) => {
  const folders = await tempFolders();
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(async () => {
    c.close();
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  // Container hash (e.g. M4A): size and hash change after a retag.
  const [link] = reconcile(c, snapshot([item({ fingerprint: `${CONTAINER_PREFIX}a` })], 1));
  c.segment(link.id, { kind: "whole" });
  const [after] = reconcile(
    c,
    snapshot([item({ fingerprint: `${CONTAINER_PREFIX}b`, size: 1400 })], 2),
  );
  assert.equal(after.id, link.id);
  // Upgrade from the old whole-file hash to the audio hash.
  const [upgraded] = reconcile(c, snapshot([item({ fingerprint: `${AUDIO_PREFIX}x`, size: 1400 })], 3));
  assert.equal(upgraded.id, link.id);
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM track_link").get().n,
    1,
  );
  // Different audio at the same path is still never silently reassigned.
  reconcile(c, snapshot([item({ fingerprint: `${AUDIO_PREFIX}y`, size: 1400 })], 4));
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(link.id).state,
    "review",
  );
});

function wav(title, sample = 7) {
  const chunk = (id, body) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "latin1");
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE(16000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const name = Buffer.from(`${title}\0`, "latin1");
  const info = Buffer.concat([Buffer.from("INFOINAM", "latin1"), Buffer.alloc(4), name]);
  info.writeUInt32LE(name.length, 8);
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    chunk("fmt ", fmt),
    chunk("LIST", info),
    chunk("data", Buffer.alloc(16000, sample)),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

test("WAV: fingerprints skip tag chunks and never close the file mid-read", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = path.join(folders.libraryFolder, "a.wav");
  await fs.writeFile(file, wav("Original title"));
  const before = await fingerprint(file);
  assert.ok(before.startsWith(AUDIO_PREFIX), before);
  await fs.writeFile(file, wav("A much longer replacement title"));
  assert.equal(await fingerprint(file), before);
  await fs.writeFile(file, wav("Original title", 9));
  assert.notEqual(await fingerprint(file), before);
});

test("a library scan with WAV files completes", async (t) => {
  const { enqueueModelScan, runModelJobs, modelStatus } = await import("../src/model/runtime.js");
  const { json } = await import("./helpers.js");
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const files = [];
  for (let i = 0; i < 3; i++) {
    const file = path.join(folders.libraryFolder, `${i}.wav`);
    await fs.writeFile(file, wav(`Track ${i}`, i + 1));
    files.push(file);
  }
  const ctx = {
    ...folders,
    settings: {},
    api: { url: "http://host.test/api", key: "k" },
    fetch: async () =>
      json({
        version: 1,
        complete: true,
        library: { tracks: files.map((file, i) => ({ id: i, title: `Track ${i}`, files: [{ id: i, path: file, available: true, durationMs: 1000 }] })) },
      }),
  };
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 60_000 });
  const status = await modelStatus(ctx);
  assert.equal(status.scan.state, "done");
  assert.equal(status.scan.skipped, 0);
  assert.equal(status.tracks.find((row) => row.state === "active").count, 3);
});

async function retagCatalogue(t) {
  const folders = await tempFolders(), c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(async () => { c.close(); await fs.rm(folders.root, { recursive: true, force: true }); });
  return { c, folders };
}
const retagged = (extra = {}) => item({ coreId: "new-track", path: "/library/a.m4a", fingerprint: `${CONTAINER_PREFIX}after`, size: 1400, ...extra });
const priorContainer = () => item({ path: "/library/a.m4a", fingerprint: `${CONTAINER_PREFIX}before` });

test("#14 a changed core ID and container hash retain the stable file link and pinned metadata", async (t) => {
  const { c } = await retagCatalogue(t);
  const [old] = reconcile(c, snapshot([priorContainer()], 1));
  const m = new Metadata(c); m.manual(old.id, "title", "My pinned name", { actor: "1", pin: true });
  const segment = c.segment(old.id, { kind: "whole" });
  const [after] = reconcile(c, snapshot([retagged()], 2));
  assert.equal(after.id, old.id);
  assert.equal(m.resolve(old.id, "title").value, "My pinned name");
  assert.equal(c.db.prepare("SELECT track_link_id FROM segment WHERE id=?").get(segment).track_link_id, old.id);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_link").get().n, 1);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link'").get().n, 0);
});

for (const variant of ["file", "path", "duration", "audio", "epoch"]) {
  test(`#14 stable-file retag matching rejects changed ${variant}`, async (t) => {
    const { c } = await retagCatalogue(t);
    const original = priorContainer();
    if (variant === "audio") original.fingerprint = `${AUDIO_PREFIX}old-audio`;
    const [old] = reconcile(c, snapshot([original], 1));
    const next = retagged({ ...(variant === "file" && { fileId: "different" }), ...(variant === "path" && { path: "/library/elsewhere.m4a" }),
      ...(variant === "duration" && { durationMs: 2001 }), ...(variant === "audio" && { fingerprint: `${AUDIO_PREFIX}new-audio` }) });
    const scan = snapshot([next], 2); if (variant === "epoch") scan.epoch = "new-epoch";
    const result = reconcile(c, scan);
    assert.ok(result.every((row) => row.id !== old.id));
    assert.notEqual(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(old.id).state, "active");
  });
}

test("#14 stable physical files are reserved when one core ID changes and an identical-audio copy moves", async (t) => {
  const { c } = await retagCatalogue(t);
  const a = item({ fingerprint: `${AUDIO_PREFIX}same` }), b = item({ coreId: "b", fileId: "b", path: "/library/b.flac", fingerprint: `${AUDIO_PREFIX}same` });
  const rows = reconcile(c, snapshot([a, b], 1));
  const result = reconcile(c, snapshot([{ ...a, coreId: "a-new" }, { ...b, path: "/library/moved-b.flac" }], 2));
  assert.deepEqual(result.map((row) => row.id), rows.map((row) => row.id));
});

async function brokenRetag(t) {
  const { c, folders } = await retagCatalogue(t);
  const workTitle = "Symphony No. 5, Op. 67";
  const hints = (title, trackNumber) => ({ title: `${workTitle}: ${title}`, work: workTitle, composer: ["Ludwig van Beethoven"], genres: ["Classical"], album: "A", trackNumber, discNumber: 1 });
  const first = { ...priorContainer(), albumId: "A", hints: hints("I. Allegro", 1) };
  const second = item({ coreId: "t2", fileId: "f2", path: "/library/b.m4a", fingerprint: `${CONTAINER_PREFIX}second`, albumId: "A", hints: hints("II. Andante", 2) });
  const original = reconcile(c, snapshot([first, second], 1));
  for (const row of original) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c);
  const work = c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").get().id;
  const parts = () => c.db.prepare("SELECT target_id,position FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work);
  const before = parts();
  const m = new Metadata(c); m.manual(original[0].id, "title", "Pinned original", { actor: "1", pin: true });
  const next = { ...retagged(), albumId: "A", hints: hints("I. Allegro con brio", 1) };
  c.db.prepare("UPDATE track_link SET state='review' WHERE id=?").run(original[0].id);
  const review = c.review("track_link", original[0].id, { epochChanged: false, candidates: [], reused: [next] });
  const newer = "bad-retag-new-link", now = Date.now();
  c.db.prepare("INSERT INTO track_link VALUES (?,?,?,?,'active',?,1,?,?)").run(newer, "i", next.coreId, next.fileId, JSON.stringify(next), now, now);
  c.db.prepare("INSERT INTO metadata_target(id,track_link_id) VALUES (?,?)").run(newer, newer);
  m.derived(newer, "title", "Earlier derived value"); m.derived(newer, "title", "Later derived value");
  classify(c, newer, next.hints); autoMatchTaggedWorks(c);
  assert.equal(parts().length, 3, "fixture reproduces the appended duplicate movement");
  const scan = (generation) => {
    const rows = reconcile(c, snapshot([next, second], generation));
    for (const row of rows) classify(c, row.id, row.hints);
    autoMatchTaggedWorks(c); return rows;
  };
  return { c, folders, work, original, newer, next, second, before, parts, scan, m, review };
}

test("#14 repairs the old review/new link split and removes only the unused auto-added movement", async (t) => {
  const s = await brokenRetag(t), c = s.c;
  const realization = c.db.prepare("SELECT id FROM realization WHERE work_id=?").get(s.work).id;
  c.db.prepare("INSERT INTO user_work_state VALUES (2,?,1,?,1)").run(s.work, realization);
  c.db.prepare("INSERT INTO admin_work_pick VALUES (?,?,1,1)").run(s.work, realization);
  s.m.manual(s.work, "description", "Keep the original work notes", { actor: "1", pin: true });
  const rows = s.scan(2);
  assert.equal(s.m.resolve(s.work, "description").value, "Keep the original work notes");
  assert.deepEqual(rows.map((r) => r.id), s.original.map((r) => r.id));
  assert.equal(c.db.prepare("SELECT core_id FROM track_link WHERE id=?").get(s.original[0].id).core_id, s.next.coreId);
  assert.equal(s.m.resolve(s.original[0].id, "title").value, "Pinned original");
  assert.equal(c.db.prepare("SELECT 1 FROM track_link WHERE id=?").get(s.newer), undefined);
  assert.equal(c.db.prepare("SELECT 1 FROM metadata_target WHERE id=?").get(s.newer), undefined);
  assert.deepEqual(s.parts(), s.before);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link' AND status='open'").get().n, 0);
  assert.equal(c.db.prepare("SELECT picked_realization_id FROM user_work_state WHERE user_id=2").get().picked_realization_id, realization);
  assert.equal(c.db.prepare("SELECT realization_id FROM admin_work_pick WHERE work_id=?").get(s.work).realization_id, realization);
  assert.deepEqual(c.db.prepare("PRAGMA foreign_key_check").all(), []);
  const repairs = c.db.prepare("SELECT count(*) AS n FROM audit_event WHERE action='track.repair_retag'").get().n;
  s.scan(3); assert.deepEqual(s.parts(), s.before);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM audit_event WHERE action='track.repair_retag'").get().n, repairs);
});

for (const edit of ["track", "movement", "classification"]) {
  test(`#14 retag repair preserves manual ${edit} data on the newer link`, async (t) => {
    const s = await brokenRetag(t), c = s.c;
    if (edit === "track") s.m.manual(s.newer, "title", "Manual newer value", { actor: "1", pin: true });
    if (edit === "movement") s.m.manual(s.parts().find((r) => !s.before.some((p) => p.target_id === r.target_id)).target_id, "title", "Manual movement", { actor: "1" });
    if (edit === "classification") classify(c, s.newer, {}, { manual: "not_classical", actor: "1" });
    const parts = s.parts(), items = c.db.prepare("SELECT * FROM realization_item ORDER BY id").all();
    reconcile(c, snapshot([s.next, s.second], 2));
    assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(s.newer).state, "active");
    assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(s.original[0].id).state, "review");
    assert.deepEqual(s.parts(), parts);
    assert.deepEqual(c.db.prepare("SELECT * FROM realization_item ORDER BY id").all(), items);
    assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link' AND status='open'").get().n, 1);
    assert.deepEqual(c.db.prepare("PRAGMA foreign_key_check").all(), []);
  });
}

test("#14 real M4A title retags keep work and movement links when the host track ID changes", async (t) => {
  const { c, folders } = await retagCatalogue(t);
  const file = await copyFixture("sine.m4a", path.join(folders.libraryFolder, "a.m4a"));
  const first = { ...priorContainer(), path: file, fingerprint: await fingerprint(file), size: (await fs.stat(file)).size, durationMs: readTags(file).durationMs };
  const [old] = reconcile(c, snapshot([first], 1));
  const work = c.createEntity("work"), movement = c.createEntity("movement"), performance = c.createEntity("performance"), recording = c.createEntity("recording");
  c.relate("movement", work, movement, { position: 1 });
  const pw = c.relate("performance_work", performance, work), realization = c.realization(work, pw);
  c.relate("recording_performance", recording, performance);
  const content = c.recordingContent(recording, pw, { movement });
  const segment = c.segment(old.id, { kind: "whole" }); c.segmentContent(segment, content); c.realizationItem(realization, segment, { movement });
  await writeTags(file, { title: "A longer retagged M4A movement title" });
  const next = { ...first, coreId: "new-host-track", fingerprint: await fingerprint(file), size: (await fs.stat(file)).size, durationMs: readTags(file).durationMs };
  assert.equal(next.durationMs, first.durationMs);
  assert.notEqual(next.fingerprint, first.fingerprint);
  const [after] = reconcile(c, snapshot([next], 2));
  assert.equal(after.id, old.id);
  assert.equal(c.db.prepare("SELECT movement_id FROM realization_item WHERE realization_id=?").get(realization).movement_id, movement);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_link").get().n, 1);
});

test("#14 repair leaves an ambiguous reused-file review and its newer link intact", async (t) => {
  const s = await brokenRetag(t), c = s.c, parts = s.parts();
  c.review("track_link", s.original[0].id, { epochChanged: false, candidates: [], reused: [s.next, { ...s.next, coreId: "another" }] });
  reconcile(c, snapshot([s.next, s.second], 2));
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(s.newer).state, "active");
  assert.ok(c.db.prepare("SELECT 1 FROM track_link WHERE id=?").get(s.original[0].id));
  assert.deepEqual(s.parts(), parts);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM audit_event WHERE action='track.repair_retag'").get().n, 0);
});

test("#14 multiple historical reviews claiming the same file require a decision", async (t) => {
  const s = await brokenRetag(t), c = s.c;
  c.db.prepare(`INSERT INTO track_link SELECT 'another-old-link',instance_id,'earlier-core',file_id,'review',evidence,revision,created_at,updated_at
    FROM track_link WHERE id=?`).run(s.original[0].id);
  c.db.prepare("INSERT INTO metadata_target(id,track_link_id) VALUES ('another-old-link','another-old-link')").run();
  s.m.manual("another-old-link", "title", "Another original name", { actor: "1", pin: true });
  c.review("track_link", "another-old-link", { epochChanged: false, candidates: [], reused: [s.next] });
  reconcile(c, snapshot([s.next, s.second], 2));
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(s.newer).state, "active");
  for (const id of [s.original[0].id, "another-old-link"]) assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(id).state, "review");
  assert.equal(s.m.resolve("another-old-link", "title").value, "Another original name");
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='track_link' AND status='open'").get().n, 2);
  assert.deepEqual(c.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("#14 multiple current tracks claiming the same stable file stay ambiguous", async (t) => {
  const { c } = await retagCatalogue(t);
  const [old] = reconcile(c, snapshot([priorContainer()], 1));
  const result = reconcile(c, snapshot([retagged(), retagged({ coreId: "another-track" })], 2));
  assert.deepEqual(result, []);
  assert.equal(c.db.prepare("SELECT state FROM track_link WHERE id=?").get(old.id).state, "review");
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM track_link").get().n, 1);
  const review = c.db.prepare("SELECT evidence FROM review_item WHERE target_id=? AND status='open'").get(old.id);
  assert.equal(JSON.parse(review.evidence).candidates.length, 2);
});
