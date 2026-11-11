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
