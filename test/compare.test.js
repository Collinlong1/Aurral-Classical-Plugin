import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import plugin from "../src/index.js";
import { summarize } from "../src/compare.js";
import { API, baseSettings, copyFixture, fakeFetch, json, RECORDING, symphonyEntities, tempFolders } from "./helpers.js";

let folders;
let aurral;
const realFetch = globalThis.fetch;

function entities(recordingCount) {
  const e = symphonyEntities();
  const others = Array.from({ length: recordingCount }, (_, n) => `other-${n}`);
  e["work:mvt1"] = {
    ...e["work:mvt1"],
    relations: [
      ...e["work:mvt1"].relations,
      ...[RECORDING, ...others].map((id) => ({ type: "performance", "target-type": "recording", direction: "backward", attributes: [], recording: { id, title: "Allegro" } })),
      { type: "performance", "target-type": "recording", direction: "backward", attributes: ["partial"], recording: { id: "excerpt", title: "Allegro (excerpt)" } },
    ],
  };
  for (const [n, id] of others.entries())
    e[`recording:${id}`] = {
      id,
      title: "Symphony No. 5: I. Allegro con brio",
      length: 420_000,
      "artist-credit": [{ name: `Orchestra ${n}`, artist: { id: `orch-${n}`, name: `Orchestra ${n}` } }],
      releases: [
        { id: `bootleg-${n}`, title: "Bootleg", status: "Bootleg", date: "1950", media: [{ position: 1, tracks: [{ id: "t", position: 1, title: "x", length: 1 }] }] },
        {
          id: `rel-${n}`,
          title: `Beethoven 5 (${n})`,
          status: "Official",
          date: `19${70 + n}`,
          "release-group": { id: `rg-${n}` },
          "artist-credit": [{ name: "Ludwig van Beethoven", joinphrase: "; ", artist: { id: "beet" } }, { name: `Orchestra ${n}`, artist: { id: `orch-${n}` } }],
          media: [{ position: 2, tracks: [{ id: `track-${n}`, position: 3, title: "Symphony No. 5: I. Allegro con brio", length: 421_000 }] }],
        },
      ],
    };
  return e;
}

function fakeAurral(users = [], playlists = []) {
  const state = { created: [], updated: [] };
  state.handler = (method, route, body) => {
    if (method === "GET" && route === "/users") return json(users);
    if (method === "GET" && route === "/playlists/status") return json({ staticPlaylists: playlists });
    if (method === "POST" && route === "/playlists/static-playlists") {
      state.created.push(body);
      return json({ success: true, playlistId: "new" });
    }
    if (method === "PUT" && route.startsWith("/playlists/static-playlists/")) {
      state.updated.push({ id: route.split("/").pop(), ...body });
      return json({ success: true });
    }
    return json({ error: "nope" }, 404);
  };
  return state;
}

beforeEach(async () => {
  folders = await tempFolders();
  aurral = fakeAurral();
  globalThis.fetch = fakeFetch({ entities: entities(15), aurral: (...a) => aurral.handler(...a) });
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(folders.root, { recursive: true, force: true });
});

const input = (extra = {}) => ({
  settings: { ...baseSettings, compareCount: 5 },
  libraryFolder: folders.libraryFolder,
  dataFolder: folders.dataFolder,
  api: { url: API, key: "plugin-key" },
  user: { id: 1, username: "admin", role: "admin" },
  ...extra,
});
const libraryTrack = (file) => ({ id: 7, path: file, title: "Allegro", artist: "x", album: "y", durationMs: 2000, mbid: RECORDING, trackNumber: 1, discNumber: 1 });

test("creates a playlist of N recordings, Library copies first", async () => {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, "b5", "01.flac"));
  const { message } = await plugin.actions["compare-track"](input({ tracks: [libraryTrack(file)] }));
  assert.equal(aurral.created.length, 1);
  const playlist = aurral.created[0];
  assert.equal(playlist.name, "Recordings: Ludwig van Beethoven: Symphony No. 5 in C minor, op. 67: I. Allegro con brio");
  assert.equal(playlist.downloadMissing, true);
  assert.equal(playlist.tracks.length, 5);
  assert.equal(playlist.tracks[0].trackMbid, RECORDING);
  assert.equal(playlist.tracks[0].path, await fs.realpath(file));
  const download = playlist.tracks[1];
  assert.deepEqual(
    { artist: download.artist, album: download.album, releaseMbid: download.releaseMbid, albumMbid: download.albumMbid, trackNumber: download.trackNumber, discNumber: download.discNumber, durationMs: download.durationMs },
    { artist: "Ludwig van Beethoven; Orchestra 0", album: "Beethoven 5 (0)", releaseMbid: "rel-0", albumMbid: "rg-0", trackNumber: 3, discNumber: 2, durationMs: 421_000 },
  );
  assert.ok(!playlist.tracks.some((t) => t.trackMbid === "excerpt"));
  assert.match(message, /^Created ".*": 5 recordings, 1 in the Library, 4 to download$/);
});

test("updates the playlist when it already exists", async () => {
  aurral = fakeAurral([], [{ id: "p1", name: "Recordings: Ludwig van Beethoven: Symphony No. 5 in C minor, op. 67: I. Allegro con brio" }]);
  const { message } = await plugin.actions["compare-album"](input({ album: { id: 1, title: "B5", tracks: [{ ...libraryTrack(null), path: null }] } }));
  assert.equal(aurral.created.length, 0);
  assert.equal(aurral.updated[0].id, "p1");
  assert.equal(aurral.updated[0].tracks.length, 5);
  assert.match(message, /^Updated/);
});

test("only admins and people who can request music may compare", async () => {
  aurral = fakeAurral([
    { id: 2, role: "user", permissions: { addAlbum: false } },
    { id: 3, role: "user", permissions: { addAlbum: true } },
  ]);
  const track = { ...libraryTrack(null), path: null };
  await assert.rejects(plugin.actions["compare-track"](input({ user: { id: 2, role: "user" }, tracks: [track] })), /Only admins/);
  await assert.rejects(plugin.actions["compare-track"](input({ user: { id: 9, role: "user" }, tracks: [track] })), /Only admins/);
  await plugin.actions["compare-track"](input({ user: { id: 3, role: "user" }, tracks: [track] }));
  assert.equal(aurral.created.length, 1);
});

test("a track without a composer can't be compared", async () => {
  const e = entities(2);
  e["work:mvt1"].relations = e["work:mvt1"].relations.filter((r) => r.type !== "composer");
  e["work:sym5"].relations = [];
  globalThis.fetch = fakeFetch({ entities: e, aurral: (...a) => aurral.handler(...a) });
  await assert.rejects(plugin.actions["compare-track"](input({ tracks: [{ ...libraryTrack(null), path: null }] })), /no Work with a composer/);
});

test("messages stay under 500 characters", () => {
  const lines = Array.from({ length: 12 }, (_, n) => `Created "Recordings: Somebody: A very long work title number ${n}": 10 recordings, 2 in the Library, 8 to download`);
  const message = summarize(lines);
  assert.ok(message.length <= 500);
  assert.match(message, /And \d+ more$/);
});
