import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import plugin, { makeContext } from "../src/index.js";
import { readTags } from "../src/tags.js";
import { downloadStatus, groupFolders, KEEP_FREE_BYTES, linesUp } from "../src/source.js";
import { catalogueNumber, shortWorkTitle } from "../src/works.js";
import { baseSettings, copyFixture, fakeFetch, json, RECORDING, SLSKD, symphonyEntities, tempFolders } from "./helpers.js";

let folders;
const realFetch = globalThis.fetch;

const track = (recordingId, position, lengthMs, title) => ({
  position,
  number: String(position),
  title,
  length: lengthMs,
  recording: { id: recordingId, title, length: lengthMs },
  "artist-credit": [{ name: "Ludwig van Beethoven", artist: { id: "beet", name: "Ludwig van Beethoven" } }],
});

function entities() {
  const e = symphonyEntities();
  e["release:rel1"] = {
    id: "rel1",
    title: "Symphonies 5 & 7",
    date: "1963",
    "artist-credit": [
      { name: "Ludwig van Beethoven", joinphrase: "; ", artist: { id: "beet", name: "Ludwig van Beethoven" } },
      { name: "Berliner Philharmoniker", joinphrase: ", ", artist: { id: "bpo", name: "Berliner Philharmoniker" } },
      { name: "Herbert von Karajan", artist: { id: "kara", name: "Herbert von Karajan" } },
    ],
    "release-group": { id: "rg1" },
    media: [
      { position: 1, tracks: [track(RECORDING, 1, 2000, "Symphony No. 5: I. Allegro con brio"), track("r2", 2, 300_000, "Symphony No. 5: II. Andante")] },
      { position: 2, tracks: [track("r3", 1, 400_000, "Symphony No. 7: I."), track("r4", 2, 500_000, "Symphony No. 7: II.")] },
    ],
  };
  return e;
}

const file = (dir, name, seconds, extra = {}) => ({ filename: `${dir}\\${name}`, size: 1000, length: seconds, bitRate: 900, ...extra });
function responses() {
  return [
    { username: "alice", hasFreeUploadSlot: true, queueLength: 0, uploadSpeed: 5000, files: [
      file("@@a\\Classical\\Beethoven - Karajan\\CD1", "01 Allegro.flac", 2), file("@@a\\Classical\\Beethoven - Karajan\\CD1", "02 Andante.flac", 300),
      file("@@a\\Classical\\Beethoven - Karajan\\CD1", "cover.jpg", undefined),
      file("@@a\\Classical\\Beethoven - Karajan\\CD2", "01.flac", 401), file("@@a\\Classical\\Beethoven - Karajan\\CD2", "02.flac", 499),
    ] },
    { username: "bob", hasFreeUploadSlot: true, queueLength: 2, uploadSpeed: 100, files: [
      file("@@b\\Karajan 1963", "1-01.mp3", 2), file("@@b\\Karajan 1963", "1-02.mp3", 301), file("@@b\\Karajan 1963", "2-01.mp3", 400), file("@@b\\Karajan 1963", "2-02.mp3", 500),
    ] },
    { username: "carol", files: [file("@@c\\Beethoven 5", "01.flac", 2), file("@@c\\Beethoven 5", "02.flac", 305)] },
    { username: "dave", files: [file("@@d\\B5", "01.flac", 2), file("@@d\\B5", "02.flac", 300), file("@@d\\B5", "03.flac", 100)] },
    { username: "erin", files: [file("@@e\\B5", "01.flac", undefined), file("@@e\\B5", "02.flac", undefined)] },
  ];
}

function fakeSlskd(state) {
  return (method, route, body) => {
    state.requests.push({ method, route, body });
    if (method === "POST" && route === "/searches") {
      state.searches.push(body.searchText);
      return json({ id: body.id, state: "InProgress" });
    }
    if (method === "GET" && /^\/searches\/[^/]+$/.test(route)) return json({ isComplete: true, state: "Completed" });
    if (method === "GET" && route.endsWith("/responses")) return json(state.responses);
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "POST" && route.startsWith("/transfers/downloads/")) return new Response(null, { status: 201 });
    if (method === "GET" && route.startsWith("/transfers/downloads/"))
      return json({ directories: [{ files: state.transfers() }] });
    if (method === "GET" && route === "/application") return json({ version: { full: "0.22.0" } });
    return json({}, 404);
  };
}

let state;
beforeEach(async () => {
  folders = await tempFolders();
  state = { requests: [], searches: [], responses: responses(), transfers: () => [] };
  globalThis.fetch = fakeFetch({ entities: entities(), slskd: fakeSlskd(state) });
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(folders.root, { recursive: true, force: true });
});

const settings = { ...baseSettings, slskdUrl: SLSKD, slskdApiKey: "key", slskdDownloadFolder: "" };
const input = (extra = {}) => ({ settings: { ...settings, slskdDownloadFolder: folders.downloads }, libraryFolder: folders.libraryFolder, dataFolder: folders.dataFolder, ...extra });
const request = { artist: "Ludwig van Beethoven", title: "Symphony No. 5: I. Allegro con brio", album: "Symphonies 5 & 7", durationMs: 2000, trackMbid: RECORDING, releaseMbid: "rel1", trackNumber: 1, discNumber: 1, artistMbid: null, albumMbid: null, releaseYear: null };

test("catalogue numbers and short work titles", () => {
  assert.equal(catalogueNumber("Symphony No. 5 in C minor, op. 67"), "op 67");
  assert.equal(catalogueNumber("Étude in C minor, Op. 10 No. 12"), "op 10 no 12");
  assert.equal(catalogueNumber("Cello Suite No. 1 in G major, BWV 1007: I. Prélude"), "BWV 1007");
  assert.equal(catalogueNumber("Symphony No. 40 in G minor, K. 550"), "K 550");
  assert.equal(catalogueNumber("Piano Sonata in B-flat major, D. 960"), "D 960");
  assert.equal(catalogueNumber("Piano Sonata in E-flat major, Hob. XVI:52"), "Hob XVI:52");
  assert.equal(catalogueNumber("Nocturne"), "");
  assert.equal(shortWorkTitle("Symphony No. 5 in C minor, op. 67: I. Allegro con brio"), "Symphony 5");
  assert.equal(shortWorkTitle("Cello Suite No. 1 in G major, BWV 1007"), "Cello Suite 1");
});

test("a folder lines up only with the right count and lengths within 2 seconds", () => {
  const tracks = [{ lengthMs: 2000 }, { lengthMs: 300_000 }];
  const folder = (lengths) => lengths.map((s) => ({ lengthMs: s == null ? null : s * 1000 }));
  assert.ok(linesUp(folder([2, 301.9]), tracks));
  assert.ok(!linesUp(folder([2, 302.5]), tracks));
  assert.ok(!linesUp(folder([2]), tracks));
  assert.ok(!linesUp(folder([2, null]), tracks));
  const groups = groupFolders(responses());
  assert.ok(groups.every((g) => g.files.every((f) => !f.filename.endsWith(".jpg"))));
});

test("track search returns files from folders that line up with the release", async () => {
  const results = await plugin.downloadSource.search(input({ track: request }));
  assert.deepEqual(results.map((r) => r.data.username).sort(), ["alice", "bob"]);
  for (const r of results) {
    assert.equal(r.title, request.title);
    assert.equal(r.durationMs, 2000);
    assert.equal(r.data.files[0].recordingId, RECORDING);
  }
  assert.equal(state.searches[0], "Beethoven Symphony 5 op 67 Karajan");
});

test("a request without a recording ID uses the release's track at its position", async () => {
  const results = await plugin.downloadSource.search(input({ track: { ...request, trackMbid: null } }));
  assert.deepEqual(results.map((r) => r.data.username).sort(), ["alice", "bob"]);
  assert.equal(results[0].data.files[0].recordingId, RECORDING);
});

function withEditions(releases) {
  const e = entities();
  e["release:rel1"].status = "Official";
  e["editions:rg1"] = { releases };
  return e;
}
// Another pressing of rel1: the same tracks, the second one 5 seconds longer.
const pressing = (extra = {}) => ({
  id: "other",
  status: "Official",
  media: [{ tracks: [
    { title: "Symphony No. 5: I. Allegro con brio", length: 2000, recording: { id: RECORDING } },
    { title: "Symphony No. 5: II. Andante", length: 305_000, recording: { id: "r2" } },
  ] }, { tracks: [
    { title: "Symphony No. 7: I.", length: 400_000, recording: { id: "r3" } },
    { title: "Symphony No. 7: II.", length: 500_000, recording: { id: "r4" } },
  ] }],
  ...extra,
});

const album = { artist: "Ludwig van Beethoven", title: "Symphonies 5 & 7", releaseMbid: "rel1", releaseGroupMbid: "rg1", tracks: [] };
// carol shares one disc; this one has both discs, the second track 5s long.
const fullRip = { username: "frank", files: [
  file("@@f\\B57", "01.flac", 2), file("@@f\\B57", "02.flac", 305), file("@@f\\B57", "03.flac", 400), file("@@f\\B57", "04.flac", 500),
] };

test("an album folder may match another official pressing's lengths, as in Aurral", async () => {
  state.responses.push(fullRip);
  globalThis.fetch = fakeFetch({ entities: withEditions([pressing()]), slskd: fakeSlskd(state) });
  const results = await plugin.downloadSource.searchAlbum(input({ album }));
  assert.ok(results.map((r) => r.data.username).includes("frank"));
});

test("an album folder matching only a pressing Aurral wouldn't count is left out", async () => {
  // Aurral judges a whole album against the pinned release and only official
  // pressings with the same titles in the same order, and would reject it.
  const unofficial = pressing({ status: null });
  const retitled = pressing();
  retitled.media[0].tracks[1].title = "Andante con moto";
  for (const releases of [[unofficial], [retitled]]) {
    state.responses = [...responses(), fullRip];
    globalThis.fetch = fakeFetch({ entities: withEditions(releases), slskd: fakeSlskd(state) });
    const results = await plugin.downloadSource.searchAlbum(input({ album }));
    assert.ok(!results.map((r) => r.data.username).includes("frank"));
  }
});

test("a single track may come from any edition of the album", async () => {
  // Aurral checks single tracks by the recording ID the plugin tags them
  // with, and sends doubtful ones to review rather than dropping them.
  globalThis.fetch = fakeFetch({ entities: withEditions([pressing({ status: null, media: [{ tracks: [
    { title: "Allegro", length: 2000, recording: { id: RECORDING } }, { title: "Andante", length: 305_000, recording: { id: "r2" } },
  ] }] })]), slskd: fakeSlskd(state) });
  const results = await plugin.downloadSource.search(input({ track: request }));
  assert.ok(results.map((r) => r.data.username).includes("carol"));
});

test("searches return nothing for requests that aren't classical", async () => {
  const e = entities();
  e["work:mvt1"].relations = [];
  e["work:sym5"].relations = [];
  globalThis.fetch = fakeFetch({ entities: e, slskd: fakeSlskd(state) });
  assert.deepEqual(await plugin.downloadSource.search(input({ track: request })), []);
  assert.deepEqual(await plugin.downloadSource.searchAlbum(input({ album: { artist: "x", title: "y", releaseMbid: "rel1", tracks: [] } })), []);
  assert.deepEqual(await plugin.downloadSource.search(input({ track: { ...request, releaseMbid: null } })), []);
  assert.equal(state.searches.length, 0);
});

test("album search needs every disc, from one or several folders", async () => {
  const album = { artist: "Ludwig van Beethoven", title: "Symphonies 5 & 7", releaseMbid: "rel1", releaseGroupMbid: "rg1", tracks: [] };
  const results = await plugin.downloadSource.searchAlbum(input({ album }));
  assert.deepEqual(results.map((r) => r.data.username), ["alice", "bob"]);
  assert.equal(results[0].trackCount, 4);
  assert.deepEqual(results[0].data.files.map((f) => f.disc), [1, 1, 2, 2]);
  assert.equal(results[0].title, album.title);
});

test("a pending track download is copied in and tagged once slskd finishes", async () => {
  const [result] = await plugin.downloadSource.search(input({ track: request }));
  const started = await plugin.downloadSource.download(input({ result, directory: path.join(folders.root, "stage") }));
  assert.ok(started.pending);
  const remote = result.data.files[0].filename;
  const transfer = (s) => [{ filename: remote, state: s, requestedAt: "2026-01-01T00:00:00" }];
  state.transfers = () => transfer("InProgress");
  const directory = path.join(folders.root, "stage");
  await fs.mkdir(directory, { recursive: true });
  assert.deepEqual(await plugin.downloadSource.status(input({ id: started.pending, directory })), { done: false });
  state.transfers = () => transfer("Completed, Succeeded");
  const remoteFolder = remote.split("\\").at(-2);
  await copyFixture("sine.flac", path.join(folders.downloads, remoteFolder, remote.split("\\").at(-1)));
  const done = await plugin.downloadSource.status(input({ id: started.pending, directory }));
  assert.equal(done.done, true);
  const tags = readTags(path.join(directory, done.path));
  assert.equal(tags.title, "Symphony No. 5: I. Allegro con brio");
  assert.equal(tags.artist, "Ludwig van Beethoven");
  assert.equal(tags.recordingMbid, RECORDING);
});

test("an album download tags the files it can vouch for and leaves the rest", async () => {
  const album = { artist: "Ludwig van Beethoven", title: "Symphonies 5 & 7", releaseMbid: "rel1", releaseGroupMbid: "rg1", tracks: [] };
  const [result] = await plugin.downloadSource.searchAlbum(input({ album }));
  const directory = path.join(folders.root, "stage");
  await fs.mkdir(directory, { recursive: true });
  const started = await plugin.downloadSource.downloadAlbum(input({ result, album, directory }));
  state.transfers = () => result.data.files.map((f) => ({ filename: f.filename, state: "Completed, Succeeded" }));
  for (const f of result.data.files) {
    const parts = f.filename.split("\\");
    await copyFixture("sine.flac", path.join(folders.downloads, parts.at(-2), parts.at(-1)));
  }
  assert.deepEqual(await plugin.downloadSource.status(input({ id: started.pending, directory })), { done: true });
  const names = (await fs.readdir(directory)).sort();
  assert.equal(names.length, 4);
  const tagged = names.map((n) => readTags(path.join(directory, n)));
  // Only the first file is 2 seconds long, like its track on the release.
  assert.equal(tagged[0].recordingMbid, RECORDING);
  assert.equal(tagged[0].title, "Symphony No. 5: I. Allegro con brio");
  for (const t of tagged.slice(1)) assert.equal(t.title, "Symphony No. 5: I.");
});

async function finishedAlbum() {
  const album = { artist: "Ludwig van Beethoven", title: "Symphonies 5 & 7", releaseMbid: "rel1", releaseGroupMbid: "rg1", tracks: [] };
  const [result] = await plugin.downloadSource.searchAlbum(input({ album }));
  const directory = path.join(folders.root, "stage");
  await fs.mkdir(directory, { recursive: true });
  const started = await plugin.downloadSource.downloadAlbum(input({ result, album, directory }));
  state.transfers = () => result.data.files.map((f) => ({ filename: f.filename, state: "Completed, Succeeded" }));
  for (const f of result.data.files) {
    const parts = f.filename.split("\\");
    await copyFixture("sine.flac", path.join(folders.downloads, parts.at(-2), parts.at(-1)));
  }
  return { directory, id: started.pending };
}

const noLinks = async () => {
  throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
};

test("a download that won't fit in Aurral's data folder is refused before copying", async () => {
  const { directory, id } = await finishedAlbum();
  const ctx = { ...makeContext(input()), linkFile: noLinks, freeBytes: async () => KEEP_FREE_BYTES + 1000 };
  await assert.rejects(downloadStatus(ctx, id, directory), /Not enough room for this download in Aurral's data folder/);
  assert.deepEqual(await fs.readdir(directory), [], "nothing was copied");
});

test("files are hard-linked when slskd's folder is on the same disk, and need no space", async () => {
  const { directory, id } = await finishedAlbum();
  const ctx = { ...makeContext(input()), freeBytes: async () => 0 };
  assert.deepEqual(await downloadStatus(ctx, id, directory), { done: true });
  assert.equal((await fs.readdir(directory)).length, 4);
});

test("a slow copy carries on across status calls instead of running past one", async () => {
  const { directory, id } = await finishedAlbum();
  let release;
  const gate = new Promise((r) => (release = r));
  const ctx = {
    ...makeContext(input()),
    finishWaitMs: 50,
    linkFile: async (...args) => {
      await gate;
      return noLinks(...args);
    },
  };
  assert.deepEqual(await downloadStatus(ctx, id, directory), { done: false });
  assert.deepEqual(await downloadStatus(ctx, id, directory), { done: false });
  release();
  assert.deepEqual(await downloadStatus({ ...ctx, finishWaitMs: 10_000 }, id, directory), { done: true });
  assert.equal((await fs.readdir(directory)).filter((n) => n.endsWith(".flac")).length, 4);
  assert.deepEqual((await fs.readdir(directory)).filter((n) => !n.endsWith(".flac")), [], "no partial copies left");
});

test("a failed slskd transfer fails the download", async () => {
  const [result] = await plugin.downloadSource.search(input({ track: request }));
  const directory = path.join(folders.root, "stage");
  const started = await plugin.downloadSource.download(input({ result, directory }));
  state.transfers = () => [{ filename: result.data.files[0].filename, state: "Completed, Rejected" }];
  await assert.rejects(plugin.downloadSource.status(input({ id: started.pending, directory })), /rejected/);
});

test("the settings test reports MusicBrainz and slskd", async () => {
  const answer = await plugin.test(input());
  assert.match(answer.message, /MusicBrainz answers at mb\.test/);
  assert.match(answer.message, /slskd 0\.22\.0 answers/);
  assert.ok(answer.message.length < 500);
});

test("searches started while slskd is busy wait and try again", async () => {
  let busy = 0;
  const inner = fakeSlskd(state);
  globalThis.fetch = fakeFetch({
    entities: entities(),
    slskd: (method, route, body) => (method === "POST" && route === "/searches" && busy++ % 2 === 0 ? json({ error: "Only one concurrent operation is permitted" }, 429) : inner(method, route, body)),
  });
  const results = await plugin.downloadSource.search(input({ track: request }));
  assert.ok(state.searches.length >= 1);
  assert.deepEqual(results.map((r) => r.data.username).sort(), ["alice", "bob"]);
});

test("an older cancelled request for a file doesn't fail a download slskd is still doing", async () => {
  const [result] = await plugin.downloadSource.search(input({ track: request }));
  const directory = path.join(folders.root, "stage");
  const started = await plugin.downloadSource.download(input({ result, directory }));
  const filename = result.data.files[0].filename;
  state.transfers = () => [
    { filename, state: "Completed, Cancelled", requestedAt: "2026-01-01T00:00:00" },
    { filename, state: "InProgress", requestedAt: "2026-01-01T00:30:00" },
  ];
  assert.deepEqual(await plugin.downloadSource.status(input({ id: started.pending, directory })), { done: false });
  // ...and a finished earlier request is used, whatever came after it.
  state.transfers = () => [
    { filename, state: "Completed, Succeeded", requestedAt: "2026-01-01T00:00:00" },
    { filename, state: "Completed, Cancelled", requestedAt: "2026-01-01T00:30:00" },
  ];
  const parts = filename.split("\\");
  await copyFixture("sine.flac", path.join(folders.downloads, parts.at(-2), parts.at(-1)));
  assert.equal((await plugin.downloadSource.status(input({ id: started.pending, directory }))).done, true);
});

test("a second download of the same folder joins the first, and each job gets the files", async () => {
  const album = { artist: "Ludwig van Beethoven", title: "Symphonies 5 & 7", releaseMbid: "rel1", releaseGroupMbid: "rg1", tracks: [] };
  const [result] = await plugin.downloadSource.searchAlbum(input({ album }));
  const dirs = [path.join(folders.root, "job-a"), path.join(folders.root, "job-b")];
  for (const d of dirs) await fs.mkdir(d, { recursive: true });
  const first = await plugin.downloadSource.downloadAlbum(input({ result, album, directory: dirs[0] }));
  const enqueues = () => state.requests.filter((r) => r.method === "POST" && r.route.startsWith("/transfers/downloads/")).length;
  assert.equal(enqueues(), 1);
  const second = await plugin.downloadSource.downloadAlbum(input({ result, album, directory: dirs[1] }));
  assert.equal(second.pending, first.pending);
  assert.equal(enqueues(), 1, "slskd is asked once");
  state.transfers = () => result.data.files.map((f) => ({ filename: f.filename, state: "Completed, Succeeded" }));
  for (const f of result.data.files) {
    const parts = f.filename.split("\\");
    await copyFixture("sine.flac", path.join(folders.downloads, parts.at(-2), parts.at(-1)));
  }
  for (const d of dirs) {
    assert.deepEqual(await plugin.downloadSource.status(input({ id: first.pending, directory: d })), { done: true });
    assert.equal((await fs.readdir(d)).length, 4);
  }
});

// slskd cleared its transfers (or never queued them): the download fails
// instead of waiting a day, and the next try starts afresh instead of joining it.
async function clearedAlbum() {
  const album = { artist: "Ludwig van Beethoven", title: "Symphonies 5 & 7", releaseMbid: "rel1", releaseGroupMbid: "rg1", tracks: [] };
  const [result] = await plugin.downloadSource.searchAlbum(input({ album }));
  const directory = path.join(folders.root, "stage");
  await fs.mkdir(directory, { recursive: true });
  const started = await plugin.downloadSource.downloadAlbum(input({ result, album, directory }));
  state.transfers = () => [];
  return { album, result, directory, id: started.pending };
}

test("a download slskd no longer lists fails, and the next try doesn't join it", async () => {
  const { album, result, directory, id } = await clearedAlbum();
  const ctx = { ...makeContext(input()), missingGraceMs: 0 };
  await assert.rejects(downloadStatus(ctx, id, directory), /no longer has this transfer/);
  const enqueues = () => state.requests.filter((r) => r.method === "POST" && r.route.startsWith("/transfers/downloads/")).length;
  const before = enqueues();
  const again = await plugin.downloadSource.downloadAlbum(input({ result, album, directory }));
  assert.notEqual(again.pending, id, "a new download, not the failed one");
  assert.equal(enqueues(), before + 1, "the files were asked for again");
});

test("a just-queued download slskd doesn't list yet keeps waiting", async () => {
  const { directory, id } = await clearedAlbum();
  assert.deepEqual(await downloadStatus(makeContext(input()), id, directory), { done: false });
});

test("a finished download whose transfers slskd cleared is still picked up", async () => {
  const { result, directory, id } = await clearedAlbum();
  for (const f of result.data.files) {
    const parts = f.filename.split("\\");
    await copyFixture("sine.flac", path.join(folders.downloads, parts.at(-2), parts.at(-1)));
  }
  const ctx = { ...makeContext(input()), missingGraceMs: 0 };
  assert.deepEqual(await downloadStatus(ctx, id, directory), { done: true });
  assert.equal((await fs.readdir(directory)).filter((n) => n.endsWith(".flac")).length, 4);
});
