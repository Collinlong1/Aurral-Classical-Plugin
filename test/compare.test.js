import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import plugin from "../src/index.js";
import { summarize } from "../src/compare.js";
import { writeTags } from "../src/tags.js";
import { baseSettings, copyFixture, fakeFetch, json, RECORDING, symphonyEntities, tempFolders, API } from "./helpers.js";

let folders, files, submitted, operationState, complete;
const realFetch = globalThis.fetch;
beforeEach(async () => {
  folders = await tempFolders(); files = []; submitted = []; operationState = "done"; complete = true;
  globalThis.fetch = fakeFetch({ entities: symphonyEntities(), aurral: (method, route, body) => {
    if (route.endsWith("/library")) return json({ version: 1, complete, library: { tracks: files } });
    if (method === "POST") { submitted.push(body); return json({ operationId: 1, playlistId: "owned" }); }
    if (route.includes("/jobs/")) return json({ state: operationState, error: "Rejected" });
    return json({},404);
  }});
});
afterEach(async () => { globalThis.fetch = realFetch; await fs.rm(folders.root, { recursive: true, force: true }); });
const input = (extra = {}) => ({ settings: baseSettings, libraryFolder: folders.libraryFolder, dataFolder: folders.dataFolder,
  user: { id: 2, username: "listener", role: "user" },
  userOperations: { version: 1, url: `${API}/plugins/classical/user-operations`, token: "scoped" }, ...extra });

async function owned(n, recording = `recording-${n}`, workId = "mvt1") {
  const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, `release-${n}`, "track.flac"));
  await writeTags(file, { workId: [workId], work: ["Sonata: I"], composer: ["Composer"], recordingMbid: [recording] });
  const track = { id: n, title: "Same title", artistName: "Performer", mbid: recording, files: [{ id: n, albumId: n, available: true, source: "aurral", path: file }] };
  files.push(track);
  return { ...track, path: file };
}

test("all 30 owned recordings across releases survive provider omissions and the old 25 limit", async () => {
  const selected = await owned(0);
  for (let i=1; i<30; i++) await owned(i);
  await owned(30, "recording-0"); // Same performance, another release.
  await owned(31, "other", "different-work"); // Same title, different identity.
  const result = await plugin.actions["compare-track"](input({ tracks: [selected] }));
  assert.equal(submitted[0].tracks.length, 30);
  assert.equal(submitted[0].key, "work:mvt1");
  assert.match(result.message, /30 owned recordings/);
  const diagnostics = JSON.parse(await fs.readFile(path.join(folders.dataFolder, "comparison-2.json"), "utf8"));
  assert.equal(diagnostics.comparisons[0].recordings[0].releases.length, 2);
});

test("explicit work evidence supports an owned broadcast with no recording MBID", async () => {
  const selected = await owned(0, "");
  await plugin.actions["compare-track"](input({ tracks: [selected] }));
  assert.equal(submitted[0].tracks.length, 1);
});
test("stock missing capability fails honestly before creating a playlist", async () => {
  await assert.rejects(plugin.actions["compare-track"](input({ userOperations: undefined, tracks: [] })), /requires.*capability/);
  assert.equal(submitted.length, 0);
});
test("a partial library snapshot never produces a truncated comparison", async () => {
  const selected = await owned(0); complete = false;
  await assert.rejects(plugin.actions["compare-track"](input({ tracks: [selected] })), /Incomplete/);
  assert.equal(submitted.length, 0);
});
test("queued operation failure is reported instead of success", async () => {
  const selected = await owned(0); operationState = "failed";
  await assert.rejects(plugin.actions["compare-track"](input({ tracks: [selected] })), /Rejected/);
});
test("ambiguous explicit work IDs stop selected comparison", async () => {
  const selected = await owned(0);
  await writeTags(selected.path, { workId: ["a", "b"] });
  await assert.rejects(plugin.actions["compare-track"](input({ tracks: [selected] })), /multiple work IDs/);
});
test("messages stay under 500 characters", () => {
  const message = summarize(Array.from({length: 20}, () => "Completed a very long work comparison with thirty owned recordings"));
  assert.ok(message.length <= 500); assert.match(message,/And \d+ more$/);
});
