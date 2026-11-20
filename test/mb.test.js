import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import { MusicBrainz, mbBaseUrl, PUBLIC_MB } from "../src/mb.js";
import { tempFolders } from "./helpers.js";

let folders;
beforeEach(async () => (folders = await tempFolders()));
afterEach(() => fs.rm(folders.root, { recursive: true, force: true }));

const ok = (data) => new Response(JSON.stringify(data), { status: 200 });

test("the public server is used without a mirror, with a contact in the User-Agent", async () => {
  assert.equal(mbBaseUrl({}), PUBLIC_MB);
  assert.equal(mbBaseUrl({ mbMirror: "musicbrainz.lan:5000/" }), "http://musicbrainz.lan:5000");
  assert.equal(mbBaseUrl({ mbMirror: "https://mb.example/ws/2" }), "https://mb.example");
  const seen = [];
  const mb = new MusicBrainz({ settings: {}, dataFolder: folders.dataFolder, intervalMs: 0, fetchImpl: async (url, init) => (seen.push([url, init.headers["User-Agent"]]), ok({ id: "x" })) });
  await mb.get("work", "x", "artist-rels");
  assert.match(seen[0][0], /^https:\/\/musicbrainz\.org\/ws\/2\/work\/x\?fmt=json&inc=artist-rels$/);
  assert.match(seen[0][1], /^AurralClassical\/\S+ \( https:\/\/github\.com\/Collinlong1\/Aurral-Classical-Plugin \)$/);
});

test("retries 503s, caches answers and 404s", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes("missing")) return new Response("", { status: 404 });
    return calls === 1 ? new Response("", { status: 503, headers: { "retry-after": "0" } }) : ok({ id: "w" });
  };
  const mb = new MusicBrainz({ settings: { mbMirror: "http://mb.test" }, dataFolder: folders.dataFolder, fetchImpl, retryWaitMs: 1 });
  assert.deepEqual(await mb.get("work", "w"), { id: "w" });
  assert.equal(calls, 2);
  assert.deepEqual(await mb.get("work", "w"), { id: "w" });
  assert.equal(await mb.get("work", "missing"), null);
  assert.equal(await mb.get("work", "missing"), null);
  assert.equal(calls, 3);
});

test("stops asking after 5 failed lookups in a row", async () => {
  let calls = 0;
  const mb = new MusicBrainz({ settings: { mbMirror: "http://mb.test" }, dataFolder: folders.dataFolder, retryWaitMs: 1, maxRetries: 1, fetchImpl: async () => (calls++, new Response("", { status: 500 })) });
  for (let i = 0; i < 7; i++) await mb.get("work", `w${i}`);
  assert.equal(calls, 5);
  assert.equal(mb.disabled, true);
});

test("one request a second across clients sharing a data folder", async () => {
  const times = [];
  const fetchImpl = async () => (times.push(Date.now()), ok({}));
  const make = () => new MusicBrainz({ settings: {}, dataFolder: folders.dataFolder, fetchImpl, intervalMs: 300 });
  const [a, b] = [make(), make()];
  await Promise.all([a.get("work", "1"), b.get("work", "2"), a.get("work", "3"), b.get("work", "4")]);
  times.sort((x, y) => x - y);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 280, `requests ${times[i] - times[i - 1]}ms apart`);
});

test("provider dispatch stays serialized through delayed responses", async () => {
  let active = 0, maximum = 0;
  const times = [], completions = [];
  const fetchImpl = async () => {
    times.push(Date.now()); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 80));
    active--; completions.push(Date.now());
    return ok({});
  };
  const make = () => new MusicBrainz({ settings:{},dataFolder:folders.dataFolder,fetchImpl,intervalMs:40 });
  await Promise.all([make().get('work','slow-one'),make().get('work','slow-two'),make().get('work','slow-three')]);
  assert.equal(maximum,1);
  for (let i=1;i<times.length;i++) assert.ok(times[i]-completions[i-1]>=35);
});
