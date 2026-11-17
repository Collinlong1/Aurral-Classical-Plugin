import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { File, TagTypes, Id3v2UserTextInformationFrame } from "node-taglib-sharp";
import plugin, { makeContext, waitForBackgroundTagging } from "../src/index.js";
import { readTags, readValues, writeTags } from "../src/tags.js";
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
  await waitForBackgroundTagging();
  globalThis.fetch = realFetch;
  await fs.rm(folders.root, { recursive: true, force: true });
});

const input = (extra = {}) => ({ settings: baseSettings, libraryFolder: folders.libraryFolder, dataFolder: folders.dataFolder, ...extra });

// The album and artist menu actions only plan (v0.3 8.7); `act` chooses one
// and then confirms its request, as an admin does in the editor. Returns the
// confirmed run's message, or the plan's when nothing was planned.
async function act(name, request) {
  const { listRequests, applyRequest } = await import("../src/tag-requests.js");
  const before = new Set(listRequests(request).map((entry) => entry.id));
  const planned = await plugin.actions[name](request);
  const made = listRequests(request).find((entry) => !before.has(entry.id));
  if (!made) return planned;
  return applyRequest(makeContext(request), made.id, request.user);
}

test("enabling the plugin without file-write opt-in never tags existing media", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "readonly-default.flac"));
  const before = await fs.readFile(file);
  const settings = { mbMirror: baseSettings.mbMirror };
  await plugin.events["download.finished"](input({ settings, track: { path: file } }));
  await plugin.scheduled(input({ settings }));
  assert.deepEqual(await fs.readFile(file), before);
});

test("clear removes duplicate native ID3 work frames, including an empty leading frame", async () => {
  const file = await copyFixture("sine.mp3", path.join(folders.libraryFolder, "duplicates.mp3"));
  const audio = File.createFromPath(file);
  const id3 = audio.getTag(TagTypes.Id3v2, true);
  for (const value of ["", ...Array.from({length:7},(_,i) => `Work ${i}`)]) {
    const frame = Id3v2UserTextInformationFrame.fromDescription("WORK"); frame.text = [value]; id3.addFrame(frame);
  }
  audio.save(); audio.dispose();
  await act("clear-classical", input({ user:{id:1,role:"admin"}, album:{title:"Duplicate",tracks:[{path:file}]} }));
  assert.deepEqual(readValues(file,["work"]).work,[]);
});

test("a failed atomic replacement preserves original audio and the persisted backup", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder,"failure.flac"));
  const album = {title:"Failure",tracks:[{path:file}]};
  await act("tag-album", input({user:{id:1,role:"admin"},album}));
  const before = await fs.readFile(file);
  const backup = await fs.readFile(path.join(folders.dataFolder,"originals.json"));
  const rename = fs.rename;
  fs.rename = async (source, target) => {
    if (String(source).endsWith(".tagging")) throw Object.assign(new Error("Read-only fixture"),{code:"EROFS"});
    return rename(source,target);
  };
  try {
    const result = await act("untag-album", input({user:{id:1,role:"admin"},album}));
    assert.match(result.message,/1 skipped/);
  } finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(file),before);
  assert.deepEqual(await fs.readFile(path.join(folders.dataFolder,"originals.json")),backup);
});

test("conductor, performer and artist ID tags are read in each format that has them", async () => {
  for (const ext of ["flac", "mp3"]) {
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, `credits.${ext}`));
    const f = File.createFromPath(file);
    try {
      f.tag.conductor = "Claudio Abbado";
      const xiph = f.getTag(TagTypes.Xiph, false);
      if (xiph) {
        xiph.setFieldAsStrings("PERFORMER", "Maurizio Pollini (piano)", "Wiener Philharmoniker");
        xiph.setFieldAsStrings("MUSICBRAINZ_ARTISTID", "id-1; id-2");
      }
      f.save();
    } finally {
      f.dispose();
    }
    const tags = readTags(file);
    assert.equal(tags.conductor, "Claudio Abbado", ext);
    // PERFORMER is a Vorbis comment; other formats have no such field.
    assert.deepEqual(tags.performers, ext === "flac" ? ["Maurizio Pollini (piano)", "Wiener Philharmoniker"] : [], ext);
    assert.deepEqual(tags.artistMbids, ext === "flac" ? ["id-1", "id-2"] : [], ext);
  }
  const plain = readTags(await copyFixture("sine.flac", path.join(folders.libraryFolder, "plain.flac")));
  assert.deepEqual([plain.conductor, plain.performers], ["", []]);
});

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
    // Some taggers put the work in GROUPING: the model reads it in every format.
    const grouped = File.createFromPath(file);
    try {
      grouped.tag.grouping = "Symphony No. 5 in C minor, op. 67";
      grouped.save();
    } finally {
      grouped.dispose();
    }
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
    assert.equal(tags.grouping, "Symphony No. 5 in C minor, op. 67");
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
  const result = await act("tag-album", 
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
  const result = await act("tag-artist", 
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

for (const ext of ["flac", "mp3", "m4a", "opus"]) {
  test(`restore preserves seven original classical values in ${ext}`, async () => {
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, `restore.${ext}`));
    const values = Array.from({ length: 7 }, (_, i) => `Original ${i + 1}`);
    const original = { composer: values, work: values, workId: values };
    await writeTags(file, original);
    const album = { title: "Restore", tracks: [{ path: file }] };
    await act("tag-album", input({ user: { id: 1, role: "admin" }, album }));
    const result = await act("untag-album", input({ user: { id: 1, role: "admin" }, album }));
    assert.match(result.message, /1 restored/);
    assert.deepEqual(readValues(file, Object.keys(original)), original);
  });

  test(`no-backup removal clears every one of seven classical values in ${ext}`, async () => {
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, `seven.${ext}`));
    const values = Array.from({ length: 7 }, (_, i) => `Value ${i + 1}`);
    await writeTags(file, { composer: values, work: values, workId: values });
    const unrelated = otherTags(file);
    const recording = readTags(file).recordingMbid;
    const result = await act("untag-album", input({ user: { id: 1, role: "admin" }, album: { title: "Seven", tracks: [{ path: file }] } }));
    assert.match(result.message, /1 cleared/);
    assert.deepEqual(readValues(file, ["composer", "work", "workId"]), { composer: [], work: [], workId: [] });
    assert.deepEqual(otherTags(file), unrelated);
    assert.equal(readTags(file).recordingMbid, recording);
    await plugin.scheduled(input());
    assert.deepEqual(readValues(file, ["composer", "work", "workId"]), { composer: [], work: [], workId: [] });
  });
}

for (const ext of ["flac", "mp3", "m4a"]) {
  test(`Remove classical tags restores a ${ext} exactly, and it stays untagged`, async () => {
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, "album", `01.${ext}`));
    const before = tagsOf(file);
    const others = otherTags(file);
    await plugin.scheduled(input());
    assert.equal(readTags(file).artist, EXPECTED_ARTIST);
    const album = { title: "Symphony No. 5", tracks: [{ path: file }] };
    const result = await act("untag-album", input({ user: { id: 1, role: "admin" }, album }));
    assert.match(result.message, /^"Symphony No. 5": 1 restored/);
    assert.deepEqual(tagsOf(file), before);
    assert.deepEqual(otherTags(file), others);
    // The schedule leaves it alone from now on...
    await plugin.scheduled(input());
    assert.deepEqual(tagsOf(file), before);
    // ...until an admin tags it as classical again.
    await act("tag-album", input({ user: { id: 1, role: "admin" }, album }));
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
  const result = await act("untag-album", input({ user: { id: 1, role: "admin" }, album: { title: "Old", tracks: [{ path: file }] } }));
  assert.match(result.message, /1 cleared/);
  assert.equal(readTags(file).artist, "Berliner Philharmoniker, Herbert von Karajan");
});

test("files with no evidence of being classical are left alone, unless an admin says so", async () => {
  const entities = symphonyEntities();
  delete entities["artist:beet"]["life-span"];
  delete entities["work:sym5"].type;
  globalThis.fetch = fakeFetch({ entities });
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "unsure", "01.flac"));
  // Its genre tags don't count as evidence either.
  const f = File.createFromPath(file);
  f.tag.genres = [];
  f.save();
  f.dispose();
  await plugin.scheduled(input());
  const processed = await readProcessed(makeContext(input()));
  assert.equal(processed[await fs.realpath(file)].reason, "not clearly classical");
  assert.equal(readTags(file).artist, "Berliner Philharmoniker, Herbert von Karajan");
  await act("tag-album", input({ user: { id: 1, role: "admin" }, album: { title: "Unsure", tracks: [{ path: file }] } }));
  assert.equal(readTags(file).artist, EXPECTED_ARTIST);
});

test("soundtracks and Christmas albums are never tagged, even by Tag as classical", async () => {
  for (const album of [{ "secondary-types": ["Soundtrack"] }, { genres: [{ name: "christmas music", count: 2 }, { name: "classical", count: 3 }] }]) {
    const entities = symphonyEntities();
    entities["release-group:rg-x"] = { id: "rg-x", ...album };
    globalThis.fetch = fakeFetch({ entities });
    const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, `x-${Math.random()}`, "01.flac"));
    const f = File.createFromPath(file);
    f.tag.musicBrainzReleaseGroupId = "rg-x";
    f.save();
    f.dispose();
    const result = await act("tag-album", input({ user: { id: 1, role: "admin" }, album: { title: "X", tracks: [{ path: file }] } }));
    assert.match(result.message, /skipped \(non-classical\)/);
    assert.equal(readTags(file).artist, "Berliner Philharmoniker, Herbert von Karajan");
  }
});

test("Aurral is asked to rescan the Library after tags change, and only then", async () => {
  const refreshes = [];
  globalThis.fetch = fakeFetch({
    entities: symphonyEntities(),
    // The classical model's scheduled sync also asks for a library snapshot; this test is about refreshes.
    aurral: (method, route, body) => (route.includes("/user-operations/") || refreshes.push([method, route, body]), new Response("{}", { status: 202 })),
  });
  const api = { url: "http://aurral.test/api", key: "plugin-key" };
  await copyFixture("sine.flac", path.join(folders.libraryFolder, "a", "01.flac"));
  await plugin.scheduled(input({ api }));
  assert.deepEqual(refreshes, [["POST", "/library/refresh", { mode: "quick" }]]);
  await plugin.scheduled(input({ api }));
  assert.equal(refreshes.length, 1, "nothing changed the second time");
});

test("the copy being tagged has no audio extension, so a Library scan never picks it up", async () => {
  const fsp = (await import("node:fs/promises")).default;
  const copies = [];
  const realCopy = fsp.copyFile;
  fsp.copyFile = (from, to, mode) => (copies.push(to), realCopy(from, to, mode));
  try {
    for (const ext of ["flac", "mp3", "m4a", "opus"]) {
      const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, "t", `01.${ext}`));
      copies.length = 0;
      const { writeTags } = await import("../src/tags.js");
      assert.deepEqual(await writeTags(file, { artist: ["Someone — Else"] }), ["artist"]);
      assert.equal(readTags(file).artist, "Someone — Else");
      assert.equal(copies.length, 1);
      assert.match(path.basename(copies[0]), /^\.01\.[0-9a-f-]+\.tagging$/);
    }
  } finally {
    fsp.copyFile = realCopy;
  }
});

async function withAlbumArtist(file, names, ids) {
  const f = File.createFromPath(file);
  f.tag.albumArtists = names;
  const xiph = f.getTag(TagTypes.Xiph, false);
  xiph.setFieldAsStrings("MUSICBRAINZ_ALBUMARTISTID", ...ids);
  f.save();
  f.dispose();
}
const tchaikovskyEntities = () => {
  const e = symphonyEntities();
  e["artist:pti"] = { id: "pti", name: "Пётр Ильич Чайковский", "sort-name": "Tchaikovsky, Pyotr Ilyich", aliases: [{ name: "Pyotr Ilyich Tchaikovsky", locale: "en", primary: true }] };
  return e;
};

test("an album Aurral files under one artist gets that artist's English name", async () => {
  globalThis.fetch = fakeFetch({ entities: tchaikovskyEntities() });
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "pti", "01.flac"));
  await withAlbumArtist(file, ["Пётр Ильич Чайковский"], ["pti"]);
  await plugin.scheduled(input());
  assert.equal(readTags(file).albumArtist, "Pyotr Tchaikovsky");
  // Remove classical tags puts it back.
  await act("untag-album", input({ user: { id: 1, role: "admin" }, album: { title: "X", tracks: [{ path: file }] } }));
  assert.equal(readTags(file).albumArtist, "Пётр Ильич Чайковский");
});

test("an album credited to several artists, as beets tags them, keeps its album artist", async () => {
  globalThis.fetch = fakeFetch({ entities: tchaikovskyEntities() });
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "credit", "01.flac"));
  await withAlbumArtist(file, ["Pyotr Ilyich Tchaikovsky; Berlin Philharmonic Orchestra, Claudio Abbado"], ["pti", "bpo", "abbado"]);
  await plugin.scheduled(input());
  const tags = readTags(file);
  assert.equal(tags.artist, EXPECTED_ARTIST);
  assert.equal(tags.albumArtist, "Pyotr Ilyich Tchaikovsky; Berlin Philharmonic Orchestra, Claudio Abbado");
  assert.deepEqual(tags.albumArtistMbids, ["pti", "bpo", "abbado"]);
});

test("files tagged by an older version get the album artist on the next schedule", async () => {
  const fetchHere = fakeFetch({ entities: tchaikovskyEntities() });
  globalThis.fetch = fetchHere;
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "old", "01.flac"));
  await withAlbumArtist(file, ["Пётр Ильич Чайковский"], ["pti"]);
  await plugin.scheduled(input());
  // Pretend an older version tagged it: no album artist and no version.
  const { writeTags } = await import("../src/tags.js");
  await writeTags(file, { albumArtist: ["Пётр Ильич Чайковский"] });
  const ctx = makeContext(input());
  const processed = await readProcessed(ctx);
  const real = await fs.realpath(file);
  const stat = await fs.stat(real);
  processed[real] = { ...processed[real], v: undefined, mtimeMs: Math.round(stat.mtimeMs), size: stat.size };
  await fs.writeFile(path.join(folders.dataFolder, "processed.json"), JSON.stringify(processed));
  await plugin.scheduled(input());
  assert.equal(readTags(file).albumArtist, "Pyotr Tchaikovsky");
  const processedNow = await readProcessed(makeContext(input()));
  assert.equal(processedNow[real].v, 2);
  const calls = fetchHere.calls.length;
  await plugin.scheduled(input());
  assert.equal(fetchHere.calls.length, calls, "and only once");
});

test("an admin action runs while another is still going, instead of waiting for it", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "busy", "01.flac"));
  const ctx = makeContext(input());
  let release;
  const gate = new Promise((r) => (release = r));
  // A long admin action, like Tag as classical on a big artist.
  const long = withTagging(ctx, () => gate, { priority: true });
  await new Promise((r) => setTimeout(r, 50));
  const started = Date.now();
  const tagged = await act("tag-album", input({ user: { id: 1, role: "admin" }, album: { title: "Busy", tracks: [{ path: file }] } }));
  assert.match(tagged.message, /1 tagged/);
  const untagged = await act("untag-album", input({ user: { id: 1, role: "admin" }, album: { title: "Busy", tracks: [{ path: file }] } }));
  assert.match(untagged.message, /1 restored/);
  assert.ok(Date.now() - started < 10_000);
  release();
  await long;
  assert.notEqual(readTags(file).artist, EXPECTED_ARTIST);
});

test("background tagging in this process stops for an admin action", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "busy", "01.flac"));
  const ctx = makeContext(input());
  let yielded = false;
  const background = withTagging(ctx, async (session) => {
    while (!(await session.shouldYield())) await new Promise((r) => setTimeout(r, 5));
    yielded = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  let release;
  const gate = new Promise((r) => (release = r));
  const action = withTagging(ctx, () => gate, { priority: true });
  await background;
  assert.ok(yielded);
  release();
  await action;
  assert.ok(file);
});

test("background tagging in another process pauses for an admin action", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "busy", "01.flac"));
  // Another Aurral process holding the lock, which stops when it sees the
  // admin's request to pause.
  const { tryLock } = await import("../src/store.js");
  const lock = await tryLock(path.join(folders.dataFolder, "tagging.lock"), 120_000);
  assert.ok(lock);
  const other = (async () => {
    for (;;) {
      const stat = await fs.stat(path.join(folders.dataFolder, "tagging.yield")).catch(() => null);
      if (stat) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await lock.release();
  })();
  const started = Date.now();
  const result = await act("tag-album", input({ user: { id: 1, role: "admin" }, album: { title: "Busy", tracks: [{ path: file }] } }));
  await other;
  assert.ok(Date.now() - started < 10_000);
  assert.match(result.message, /1 tagged/);
  assert.equal(readTags(file).artist, EXPECTED_ARTIST);
});

test("a Tag as classical left in the queue doesn't undo a later Remove classical tags", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "later", "01.flac"));
  const album = { title: "Later", tracks: [{ path: file }] };
  await act("tag-album", input({ user: { id: 1, role: "admin" }, album }));
  const ctx = makeContext(input());
  // A Tag as classical that was cut off (the plugin restarted) leaves its
  // request queued; then the admin removes the tags.
  await enqueue(ctx, [file], { force: true, source: "action" });
  const queued = (await fs.readdir(path.join(folders.dataFolder, "queue")))[0];
  const job = JSON.parse(await fs.readFile(path.join(folders.dataFolder, "queue", queued), "utf8"));
  job.at -= 10 * 60_000;
  await fs.writeFile(path.join(folders.dataFolder, "queue", queued), JSON.stringify(job));
  await act("untag-album", input({ user: { id: 1, role: "admin" }, album }));
  await plugin.scheduled(input());
  assert.notEqual(readTags(file).artist, EXPECTED_ARTIST);
  assert.deepEqual(await fs.readdir(path.join(folders.dataFolder, "queue")), []);
});

test("Tag as classical on an artist works on a fresh install, before any scan", async () => {
  await copyFixture("sine.flac", path.join(folders.libraryFolder, "Ludwig van Beethoven", "Album", "01.flac"));
  const result = await act("tag-artist", input({ user: { id: 1, role: "admin" }, artist: { id: 1, name: "Ludwig van Beethoven", mbid: null, albums: [] } }));
  assert.match(result.message, /1 tagged/);
});

// v0.3 8.2: classical fields round-trip, one at a time and with several
// values, on every format enabled for release; others are listed as
// unsupported, and the audio never changes.
test("classical tag fields round-trip per field and keep several values on FLAC and MP3", async (t) => {
  const { writeTags, readValues, FORMAT_FIELDS, CLASSICAL_FIELDS, writableFields, readTags } = await import("../src/tags.js");
  const { fingerprint } = await import("../src/model/fingerprint.js");
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const values = {
    composer: ["Ludwig van Beethoven", "Franz Liszt"],
    composerSort: ["Beethoven, Ludwig van", "Liszt, Franz"],
    work: ["Symphony No. 5 in C minor, Op. 67"],
    movementName: ["Allegro con brio"],
    movementNumber: ["1"],
    movementTotal: ["4"],
    performers: ["Martha Argerich (piano)", "Berliner Philharmoniker (orchestra)"],
    conductor: ["Herbert von Karajan"],
    catalogue: ["Op. 67", "LvW 5"],
    workId: ["00000000-0000-4000-8000-0000000000aa"],
  };
  assert.deepEqual(Object.keys(values), CLASSICAL_FIELDS);
  assert.deepEqual(Object.keys(FORMAT_FIELDS), [".flac", ".mp3"]);
  assert.deepEqual(FORMAT_FIELDS[".flac"], CLASSICAL_FIELDS);
  // MP3: no Picard ID3 frame node-taglib-sharp writes for movements or performers.
  assert.deepEqual(FORMAT_FIELDS[".mp3"], ["composer", "composerSort", "work", "conductor", "catalogue", "workId"]);
  assert.deepEqual([writableFields("a.m4a"), writableFields("a.opus"), writableFields("A.FLAC").length], [[], [], 10]);
  for (const ext of ["flac", "mp3"]) {
    const fields = FORMAT_FIELDS[`.${ext}`];
    // One field at a time: only it changes, every other tag stays.
    for (const field of fields) {
      const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, `${ext}-${field}.${ext}`));
      const before = readTags(file);
      const audio = await fingerprint(file);
      assert.deepEqual(await writeTags(file, { [field]: values[field] }), [field], `${ext} ${field}`);
      assert.deepEqual(readValues(file, [field])[field], values[field], `${ext} ${field}`);
      const after = readTags(file);
      for (const kept of ["title", "artist", "albumArtist", "album", "recordingMbid", "genres", "trackNumber", "durationMs"]) assert.deepEqual(after[kept], before[kept], `${ext} ${field} kept ${kept}`);
      assert.equal(await fingerprint(file), audio, `${ext} ${field} audio`);
    }
    // All together, then a second identical write changes nothing.
    const file = await copyFixture(`sine.${ext}`, path.join(folders.libraryFolder, `${ext}-all.${ext}`));
    const all = Object.fromEntries(fields.map((field) => [field, values[field]]));
    assert.deepEqual((await writeTags(file, all)).sort(), [...fields].sort());
    assert.deepEqual(readValues(file, fields), all);
    assert.deepEqual(await writeTags(file, all), []);
    // Clearing a field removes it; the others keep their values.
    await writeTags(file, { catalogue: [] });
    assert.deepEqual(readValues(file, ["catalogue", "composer"]), { catalogue: [], composer: values.composer });
  }
  // The scan reads what was written as performers and conductor (FLAC).
  const flac = path.join(folders.libraryFolder, "flac-all.flac");
  assert.deepEqual([readTags(flac).performers, readTags(flac).conductor], [values.performers, "Herbert von Karajan"]);
});

// v0.3 8.4, 8.5: confirmed writes with per-file backups, and restore.
test("tag writing: only confirmed, with the setting on and never from a scan; changed files are left alone; restore puts the first tags back", async (t) => {
  const { tagLibrary } = await import("./tag-library.js");
  const { runTagJobs } = await import("../src/model/tag-write.js");
  const { runModelJobs } = await import("../src/model/runtime.js");
  const { fingerprint } = await import("../src/model/fingerprint.js");
  const lib = await tagLibrary(t, { settings: {} });
  const fifth = lib.files.slice(0, 4).map((file) => file.file);
  const original = fifth.map((file) => readTags(file));
  const audio = await Promise.all(fifth.map((file) => fingerprint(file)));
  const firstEvidence = async () => {
    const c = await lib.catalogue();
    try {
      return Object.fromEntries(c.db.prepare("SELECT core_id,json_extract(evidence,'$.hints') AS hints FROM track_link WHERE state='active' ORDER BY core_id").all().map((row) => [row.core_id, JSON.parse(row.hints)]));
    } finally {
      c.close();
    }
  };
  const evidence = await firstEvidence();
  const preview = (await lib.mutate("tag-preview-open", { albumId: "fifth" }, "album:fifth")).selection;
  const token = preview.slice(5);

  // Off by default: refused, nothing queued.
  const off = await lib.mutate("tag-write", { token, confirm: true }, preview);
  assert.equal(off.ok, false);
  assert.match(off.message, /Writing tags is off/);
  lib.ctx.settings.enableTagWriting = true;
  assert.match((await lib.mutate("tag-write", { token, confirm: false }, preview)).message, /Confirm/);
  // Someone edits one file after the preview.
  await writeTags(fifth[1], { composer: ["L. v. Beethoven"] });
  const queued = await lib.mutate("tag-write", { token, confirm: true }, preview);
  assert.equal(queued.ok, true, queued.message);
  assert.match(queued.selection, /^tag-run:/);
  assert.equal(lib.started.length, 1, "the run is started once its job is committed");
  // Scans and the schedule run model jobs: never a tag write.
  await runModelJobs(lib.ctx, { budgetMs: 5_000 });
  assert.equal((await lib.read(queued.selection)).badges[0].label, "Running");
  assert.deepEqual(fifth.map((file) => readTags(file).work), ["", "", "", ""]);

  assert.equal(await runTagJobs(lib.ctx, { budgetMs: 30_000 }), true);
  const report = await lib.read(queued.selection);
  assert.match(report.subtitle, /^Done · 4 of 4 files · 3 written · 1 skipped$/);
  const rows = report.sections[0].rows;
  assert.deepEqual(rows.map((row) => [row.label, row.badge.label]), [["01.flac", "Written"], ["02.flac", "Skipped"], ["03.flac", "Written"], ["04.mp3", "Written"]]);
  assert.equal(rows[1].detail, "Its tags changed since the preview");
  // Written as previewed; the audio and every other tag are unchanged.
  const flac = readValues(fifth[0], ["work", "movementName", "movementNumber", "movementTotal", "performers"]);
  assert.deepEqual(flac, { work: ["Symphony No. 5 in C minor, Op. 67"], movementName: ["I. Allegro con brio"], movementNumber: ["1"], movementTotal: ["4"], performers: ["Berliner Philharmoniker (orchestra)", "Herbert von Karajan (performer)"] });
  assert.deepEqual(readValues(fifth[3], ["work", "movementName"]), { work: ["Symphony No. 5 in C minor, Op. 67"], movementName: [] });
  assert.deepEqual(readValues(fifth[1], ["composer", "work"]), { composer: ["L. v. Beethoven"], work: [] }, "the edited file is left alone");
  for (const i of [0, 2, 3]) {
    assert.equal(await fingerprint(fifth[i]), audio[i], `audio ${i}`);
    for (const kept of ["title", "artist", "albumArtist", "album", "trackNumber", "durationMs"]) assert.deepEqual(readTags(fifth[i])[kept], original[i][kept], `${i} ${kept}`);
  }
  // One backup a written file, with the old values of exactly what was written.
  const c = await lib.catalogue();
  const backups = c.db.prepare("SELECT * FROM tag_backup ORDER BY path").all();
  c.close();
  assert.deepEqual(backups.map((row) => path.basename(row.path)), ["01.flac", "03.flac", "04.mp3"]);
  assert.deepEqual(JSON.parse(backups[0].tags).work, []);
  assert.equal(backups[0].fingerprint, audio[0]);
  assert.equal(backups[0].actor, "1");
  // Confirming the same preview again writes nothing more.
  const again = await lib.mutate("tag-write", { token, confirm: true }, preview);
  assert.deepEqual([again.ok, again.selection], [true, queued.selection]);
  assert.match(again.message, /written already/);

  // 8.5: restore one file, then the rest of the run.
  const one = await lib.mutate("tag-restore", { backup: rows[0].actions[0].arguments.backup }, queued.selection);
  assert.equal(one.ok, true, one.message);
  await runTagJobs(lib.ctx, { budgetMs: 30_000 });
  assert.deepEqual(readValues(fifth[0], ["work", "performers"]), { work: [], performers: [] });
  assert.deepEqual((await lib.read(`track:${await lib.linkOf(0)}`)).sections.find((s) => s.id === "tag-history").rows[0].badge.label, "Restored");
  assert.match((await lib.mutate("tag-restore", { backup: rows[0].actions[0].arguments.backup }, queued.selection)).message, /restored already/);
  // A file edited after the write is not put back over that edit.
  await writeTags(fifth[2], { composer: ["Someone else"] });
  const rest = (await lib.read(queued.selection)).actions.find((a) => a.command === "tag-restore");
  assert.equal(rest.label, "Restore all 2");
  const restoring = await lib.mutate("tag-restore", rest.arguments, queued.selection);
  await runTagJobs(lib.ctx, { budgetMs: 30_000 });
  const restored = await lib.read(restoring.selection);
  assert.deepEqual(restored.sections[0].rows.map((row) => [row.label, row.badge.label]), [["03.flac", "Skipped"], ["04.mp3", "Restored"]]);
  assert.match(restored.sections[0].rows[0].detail, /changed since they were written/);
  assert.deepEqual(readValues(fifth[2], ["composer", "work"]), { composer: ["Someone else"], work: ["Symphony No. 5 in C minor, Op. 67"] });
  for (const i of [0, 3]) assert.equal(await fingerprint(fifth[i]), audio[i]);
  // Restore, then rescan: the first evidence comes back for restored files.
  await lib.scan();
  const after = await firstEvidence();
  for (const id of ["0", "3"]) assert.deepEqual(after[id], evidence[id], `evidence of file ${id}`);

  // Turned off again: a queued run stops before writing.
  lib.ctx.settings.enableTagWriting = true;
  const second = (await lib.mutate("tag-preview-open", { albumId: "fifth" }, "album:fifth")).selection;
  const run = await lib.mutate("tag-write", { token: second.slice(5), confirm: true }, second);
  lib.ctx.settings.enableTagWriting = false;
  await runTagJobs(lib.ctx, { budgetMs: 30_000 });
  assert.match((await lib.read(run.selection)).subtitle, /^Stopped: Tag writing is off/);
  assert.deepEqual(readValues(fifth[0], ["work"]), { work: [] });
});

test("a tag write killed at any moment leaves the old file or the new one, never a mix, and the same audio", async (t) => {
  const { spawn } = await import("node:child_process");
  const { fingerprint } = await import("../src/model/fingerprint.js");
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "kill.flac"));
  // A larger file makes each write take longer, so kills land mid-write.
  await writeTags(file, { work: ["x".repeat(200_000)] });
  const audio = await fingerprint(file);
  const states = [JSON.stringify({ composer: ["A"], work: ["Work A"] }), JSON.stringify({ composer: ["B"], work: ["Work B"] })];
  await writeTags(file, JSON.parse(states[0]));
  const tags = new URL("../src/tags.js", import.meta.url).href;
  const script = `const { writeTags } = await import(${JSON.stringify(tags)}); const s = ${JSON.stringify(states.map((x) => JSON.parse(x)))}; process.send?.("go"); for (let i = 0; ; i++) await writeTags(${JSON.stringify(file)}, s[i % 2]);`;
  for (let round = 0; round < 12; round++) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 250)));
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const now = JSON.stringify(readValues(file, ["composer", "work"]));
    assert.ok(states.includes(now), `round ${round}: ${now}`);
    assert.equal(await fingerprint(file), audio, `round ${round}: audio`);
  }
  // What a kill can leave is a copy with no audio extension, never indexed.
  for (const name of await fs.readdir(path.dirname(file))) if (name !== "kill.flac") assert.match(name, /^\.kill\..*\.tagging$/);
});

// v0.3 8.7 (review E6/B12): the four menu actions plan; an admin confirms.
test("album and artist menu actions write nothing until an admin confirms their request in the editor", async () => {
  const { listRequests, readRequest, applyRequest } = await import("../src/tag-requests.js");
  const { readEditor, mutateEditor } = await import("../src/model/editor.js");
  const admin = { id: 1, role: "admin" };
  const one = await copyFixture("sine.flac", path.join(folders.libraryFolder, "req", "01.flac"));
  const two = await copyFixture("sine.mp3", path.join(folders.libraryFolder, "req", "02.mp3"));
  const album = { title: "Request", tracks: [{ path: one }, { path: two }] };
  const bytes = async () => Promise.all([one, two].map((file) => fs.readFile(file)));
  const before = await bytes();

  // Choosing Tag as classical plans and says where to confirm; nothing is written.
  const planned = await plugin.actions["tag-album"](input({ user: admin, album }));
  assert.match(planned.message, /^"Request": nothing written yet\. 2 files would change\. To write them, open Classical metadata → Activity → Tag requests and confirm\.$/);
  assert.deepEqual(await bytes(), before);
  const [request] = listRequests(input());
  assert.deepEqual([request.mode, request.state, request.files.map((file) => file.status)], ["tag", "waiting", ["change", "change"]]);
  assert.deepEqual(request.files[0].values.artist, [EXPECTED_ARTIST]);
  assert.equal(request.files[0].current.artist[0], "Berliner Philharmoniker, Herbert von Karajan");
  // No catalogue database is made by planning.
  await assert.rejects(fs.access(path.join(folders.dataFolder, "model", "classical.sqlite")));

  // The editor lists it under Activity and shows each file's change.
  const editor = { ...input(), user: admin, pageId: "editor", capabilities: { adminForms: 2 } };
  const started = [];
  const maintenance = { status: async () => null, run: async (command, user, values) => (started.push([command, values]), { message: "started", selection: `tag-request:${values.request}` }) };
  const activity = await readEditor({ ...editor, maintenance, query: { tab: "activity" } });
  const row = activity.list.items.find((item) => item.selection === `tag-request:${request.id}`);
  assert.equal(row.label, 'Tag as classical: "Request"');
  assert.equal(row.badge.label, "Waiting for you");
  const view = (await readEditor({ ...editor, maintenance, query: { tab: "activity", selection: row.selection } })).view;
  assert.match(view.subtitle, /2 files would change\. Nothing is written until you confirm\./);
  assert.match(view.sections[0].rows[0].detail, new RegExp(`Artist: Berliner Philharmoniker, Herbert von Karajan → ${EXPECTED_ARTIST}`));
  const write = view.actions.find((a) => a.command === "maintenance-tag-request");
  assert.deepEqual([write.label, write.arguments, Boolean(write.confirm)], ["Write 2 files", { request: request.id, confirm: true }, true]);
  // The editor passes the confirmation on, and opens the request.
  const confirmed = await mutateEditor({ ...editor, maintenance, mutation: { revision: activity.revision, command: write.command, values: write.arguments } });
  assert.deepEqual([confirmed.ok, confirmed.selection], [true, `tag-request:${request.id}`]);
  assert.deepEqual(started, [["maintenance-tag-request", { request: request.id, confirm: true }]]);
  assert.deepEqual(await bytes(), before, "the stub wrote nothing");

  // Someone edits the MP3 after the request; confirming writes the FLAC only.
  await writeTags(two, { composer: ["Someone"] });
  const result = await applyRequest(makeContext(input({ user: admin })), request.id, admin);
  assert.equal(result.message, '"Request": 1 tagged, 1 skipped (changed since the request)');
  assert.deepEqual([readTags(one).artist, readTags(two).composer], [EXPECTED_ARTIST, ["Someone"]]);
  const done = readRequest(input(), request.id);
  assert.deepEqual([done.state, done.files.map((file) => file.result.status)], ["done", ["tagged", "skipped"]]);
  // Confirming again writes nothing more.
  assert.equal((await applyRequest(makeContext(input({ user: admin })), request.id, admin)).message, result.message);

  // Restore and Clear plan too; a request can be discarded unwritten.
  const restore = await plugin.actions["untag-album"](input({ user: admin, album: { title: "Request", tracks: [{ path: one }] } }));
  assert.match(restore.message, /nothing written yet\. 1 file would change/);
  assert.equal(readTags(one).artist, EXPECTED_ARTIST);
  const restoring = listRequests(input()).find((entry) => entry.mode === "restore");
  assert.deepEqual(restoring.files[0].values.artist, ["Berliner Philharmoniker, Herbert von Karajan"]);
  await (await import("../src/tag-requests.js")).discardRequest(input(), restoring.id);
  assert.equal(readRequest(input(), restoring.id), null);
  const clear = await plugin.actions["clear-classical"](input({ user: admin, album: { title: "Request", tracks: [{ path: one }] } }));
  assert.match(clear.message, /nothing written yet/);
  assert.equal(readTags(one).artist, EXPECTED_ARTIST);
  // An album with nothing to change makes no request.
  const none = await plugin.actions["tag-album"](input({ user: admin, album: { title: "Done", tracks: [{ path: one }] } }));
  assert.equal(none.message, '"Done": nothing to write (1 already right).');
});
