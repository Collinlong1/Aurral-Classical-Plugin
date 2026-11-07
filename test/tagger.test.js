import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { File, TagTypes } from "node-taglib-sharp";
import plugin, { makeContext } from "../src/index.js";
import { readTags } from "../src/tags.js";
import { enqueue, readProcessed, runQueue, withTagging } from "../src/tagger.js";
import { baseSettings, copyFixture, EXPECTED_ARTIST, fakeFetch, RECORDING, symphonyEntities, tempFolders, waitFor } from "./helpers.js";

let folders;
let fetchImpl;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  folders = await tempFolders();
  fetchImpl = fakeFetch({ entities: symphonyEntities() });
  globalThis.fetch = fetchImpl;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(folders.root, { recursive: true, force: true });
});

const input = (extra = {}) => ({ settings: baseSettings, libraryFolder: folders.libraryFolder, dataFolder: folders.dataFolder, ...extra });

function otherTags(file) {
  const f = File.createFromPath(file);
  try {
    const xiph = f.getTag(TagTypes.Xiph, false);
    return {
      artists: xiph?.getField("ARTISTS") ?? null,
      genres: f.tag.genres,
      pictures: f.tag.pictures.length,
      aurralIds: xiph?.getField("AURRAL_IDS") ?? null,
    };
  } finally {
    f.dispose();
  }
}

for (const ext of ["flac", "mp3", "m4a", "opus"]) {
  test(`download.finished tags a ${ext} in the background and keeps every other tag`, async () => {
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, "Beethoven", `01 Allegro.${ext}`));
    const before = otherTags(file);
    const started = Date.now();
    await plugin.events["download.finished"](input({ event: "download.finished", track: { path: file, mbid: RECORDING }, source: "test" }));
    assert.ok(Date.now() - started < 1000, "the event answers right away");
    await waitFor(async () => (await readProcessed(makeContext(input())))[await fs.realpath(file)]);
    const tags = readTags(file);
    assert.equal(tags.artist, EXPECTED_ARTIST);
    assert.deepEqual(tags.composer, ["Ludwig van Beethoven"]);
    assert.equal(tags.work, "Symphony No. 5 in C minor, op. 67: I. Allegro con brio");
    assert.equal(tags.workId, "mvt1");
    assert.equal(tags.recordingMbid, RECORDING);
    assert.equal(tags.title, "Symphony No. 5: I.");
    assert.deepEqual(otherTags(file), before);
    const leftovers = (await fs.readdir(path.dirname(file))).filter((n) => n.startsWith("."));
    assert.deepEqual(leftovers, []);
  });
}

test("the schedule finds classical files nobody queued, once", async () => {
  const classical = await copyFixture("sine.flac", path.join(folders.libraryFolder, "a", "classical.flac"));
  await plugin.scheduled(input());
  assert.equal(readTags(classical).artist, EXPECTED_ARTIST);
  const calls = fetchImpl.mbCalls().length;
  await plugin.scheduled(input());
  assert.equal(fetchImpl.mbCalls().length, calls, "nothing is looked up again");
});

test("the schedule skips files whose genres say they aren't classical, without lookups", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "rock.flac"));
  const f = File.createFromPath(file);
  f.tag.genres = ["rock"];
  f.save();
  f.dispose();
  await plugin.scheduled(input());
  assert.equal(fetchImpl.mbCalls().length, 0);
  const processed = await readProcessed(makeContext(input()));
  assert.equal(processed[await fs.realpath(file)].reason, "non-classical");
  assert.equal(readTags(file).artist, "Berliner Philharmoniker, Herbert von Karajan");
});

test("a recording without a composer is left alone and recorded", async () => {
  const entities = symphonyEntities();
  entities["work:mvt1"].relations = [];
  entities["work:sym5"].relations = [];
  globalThis.fetch = fakeFetch({ entities });
  const file = await copyFixture("sine.mp3", path.join(folders.libraryFolder, "x.mp3"));
  const before = await fs.readFile(file);
  await plugin.scheduled(input());
  assert.deepEqual(await fs.readFile(file), before);
  const processed = await readProcessed(makeContext(input()));
  assert.equal(processed[await fs.realpath(file)].reason, "no composer");
});

test("MusicBrainz being down leaves files queued for later", async () => {
  globalThis.fetch = async () => new Response("down", { status: 503 });
  const ctx = makeContext(input());
  ctx.mb.retryWaitMs = 1;
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "x.flac"));
  await enqueue(ctx, [file]);
  const stats = await runQueue(ctx, 5000);
  assert.equal(stats.tagged, 0);
  assert.equal(stats.left, 1);
});

test("files outside the Library are never written", async () => {
  const outside = await copyFixture("sine.flac", path.join(folders.root, "elsewhere", "x.flac"));
  const before = await fs.readFile(outside);
  const ctx = makeContext(input());
  await enqueue(ctx, [outside]);
  const stats = await runQueue(ctx, 5000);
  assert.equal(stats.skipped["outside the Library"], 1);
  assert.deepEqual(await fs.readFile(outside), before);
});

test("only one process tags at a time", async () => {
  const ctx = makeContext(input());
  let second;
  await withTagging(ctx, async () => {
    second = await runQueue(ctx, 1000);
  });
  assert.equal(second, null);
});

test("Tag as classical on an album retags its files", async () => {
  const file = await copyFixture("sine.opus", path.join(folders.libraryFolder, "album", "01.opus"));
  const result = await plugin.actions["tag-album"](
    input({ user: { id: 1, role: "admin" }, album: { title: "Symphony No. 5", tracks: [{ path: file }, { path: null }] } }),
  );
  assert.match(result.message, /1 tagged/);
  assert.ok(result.message.length < 500);
  assert.equal(readTags(file).artist, EXPECTED_ARTIST);
});

test("Tag as classical on an artist finds the artist's files", async () => {
  const mine = await copyFixture("sine.flac", path.join(folders.libraryFolder, "Ludwig van Beethoven", "01.flac"));
  const other = await copyFixture("sine.flac", path.join(folders.libraryFolder, "Someone Else", "01.flac"));
  const f = File.createFromPath(other);
  f.tag.albumArtists = ["Someone Else"];
  f.save();
  f.dispose();
  const result = await plugin.actions["tag-artist"](
    input({ user: { id: 1, role: "admin" }, artist: { id: 3, name: "Ludwig van Beethoven", mbid: null, albums: [] } }),
  );
  assert.match(result.message, /^Ludwig van Beethoven: 1 tagged/);
  assert.equal(readTags(mine).artist, EXPECTED_ARTIST);
  assert.equal(readTags(other).artist, "Berliner Philharmoniker, Herbert von Karajan");
});

test("settings change the separator and order", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "x.flac"));
  const settings = { ...baseSettings, separator: "/", nameOrder: "composer, conductor, ensemble" };
  await plugin.scheduled(input({ settings }));
  assert.equal(readTags(file).artist, "Ludwig van Beethoven / Herbert von Karajan / Berlin Philharmonic");
});

test("a recording MusicBrainz doesn't have is recorded, not retried", async () => {
  globalThis.fetch = fakeFetch({ entities: {} });
  const ctx = makeContext(input());
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "gone.flac"));
  await enqueue(ctx, [file]);
  const stats = await runQueue(ctx, 5000);
  assert.equal(stats.skipped["not on MusicBrainz"], 1);
  assert.equal(stats.left, 0);
});

const tagsOf = (file) => {
  const t = readTags(file);
  return { artist: t.artist, composer: t.composer, work: t.work, workId: t.workId, recording: t.recordingMbid, title: t.title };
};

for (const ext of ["flac", "mp3", "m4a"]) {
  test(`Remove classical tags restores a ${ext} exactly, and it stays untagged`, async () => {
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, "album", `01.${ext}`));
    const before = tagsOf(file);
    const others = otherTags(file);
    await plugin.scheduled(input());
    assert.equal(readTags(file).artist, EXPECTED_ARTIST);
    const album = { title: "Symphony No. 5", tracks: [{ path: file }] };
    const result = await plugin.actions["untag-album"](input({ user: { id: 1, role: "admin" }, album }));
    assert.match(result.message, /^"Symphony No. 5": 1 restored/);
    assert.deepEqual(tagsOf(file), before);
    assert.deepEqual(otherTags(file), others);
    // The schedule leaves it alone from now on...
    await plugin.scheduled(input());
    assert.deepEqual(tagsOf(file), before);
    // ...until an admin tags it as classical again.
    await plugin.actions["tag-album"](input({ user: { id: 1, role: "admin" }, album }));
    assert.equal(readTags(file).artist, EXPECTED_ARTIST);
  });
}

test("files tagged before backups get MusicBrainz's credit for the track back", async () => {
  const entities = symphonyEntities();
  entities["release:rel1"] = {
    id: "rel1",
    media: [{ position: 1, tracks: [{ position: 1, recording: { id: RECORDING }, "artist-credit": [
      { name: "Berliner Philharmoniker", joinphrase: ", ", artist: { id: "bpo" } }, { name: "Herbert von Karajan", artist: { id: "kara" } },
    ] }] }],
  };
  globalThis.fetch = fakeFetch({ entities });
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "old", "01.flac"));
  const f = File.createFromPath(file);
  f.tag.performers = ["Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan"];
  f.tag.musicBrainzReleaseId = "rel1";
  f.save();
  f.dispose();
  const result = await plugin.actions["untag-album"](input({ user: { id: 1, role: "admin" }, album: { title: "Old", tracks: [{ path: file }] } }));
  assert.match(result.message, /1 restored/);
  assert.equal(readTags(file).artist, "Berliner Philharmoniker, Herbert von Karajan");
});
