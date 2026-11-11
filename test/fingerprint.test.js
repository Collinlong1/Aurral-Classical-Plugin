import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tempFolders, copyFixture } from "./helpers.js";
import { writeTags } from "../src/tags.js";
import {
  fingerprint,
  AUDIO_PREFIX,
  CONTAINER_PREFIX,
} from "../src/model/fingerprint.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile } from "../src/model/reconcile.js";

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
