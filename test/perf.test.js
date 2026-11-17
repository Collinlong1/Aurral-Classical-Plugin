// v0.3 9.1: on a warm 10,000-track catalogue, the first page of every list
// and page type answers in under a second, through the plugin's own entry
// points (each opens the catalogue, as in production).
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tempFolders } from "./helpers.js";
import { buildCatalogue } from "../scripts/perf-catalogue.mjs";
import plugin from "../index.js";

const LIMIT_MS = 1000;

test("first pages answer in under a second on a warm 10,000-track catalogue", { timeout: 600_000 }, async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const c = await buildCatalogue(path.join(folders.dataFolder, "model"));
  const count = (sql) => c.db.prepare(sql).get().n;
  assert.equal(count("SELECT count(*) AS n FROM track_link WHERE state='active'"), 10_000);
  assert.equal(count("SELECT count(*) AS n FROM realization"), 2_500);
  c.close();

  const user = { id: 7, username: "listener", role: "user" };
  const admin = { id: 1, username: "admin", role: "admin" };
  const base = { ...folders, settings: {} };
  const classical = (resourceId, query = {}) => () => plugin.pages.read({ ...base, user, pageId: "classical", resourceId, query, capabilities: { resourceView: 2, itemLinks: 1 } });
  const editor = (query) => () => plugin.pages.read({ ...base, user: admin, pageId: "editor", query, capabilities: { adminForms: 2, formActions: true, orderField: true } });
  // The index is built once, as the first read after a scan would.
  await classical("home")();
  const db = (await import("../src/model/catalogue.js")).openCatalogue;
  const lookup = await db(path.join(folders.dataFolder, "model"));
  const ref = (kind, like = "%") => lookup.db.prepare("SELECT ref FROM search_doc WHERE kind=? AND title LIKE ? ORDER BY ref LIMIT 1").get(kind, like).ref;
  const work = ref("work");
  const pages = {
    "Classical home": classical("home"),
    ...Object.fromEntries(["composer", "work", "performer", "conductor", "ensemble", "recording"].map((kind) => [`list:${kind}`, classical(`list:${kind}`)])),
    "list:work by catalogue": classical("list:work", { sort: "catalogue" }),
    composer: classical(`composer:${ref("composer")}`),
    "person (soloist)": classical(`person:${ref("performer", "Soloist%")}`),
    "person (conductor)": classical(`person:${ref("performer", "Conductor%")}`),
    ensemble: classical(`ensemble:${ref("performer", "Orchestra%")}`),
    work: classical(`work:${work}`),
    "work movements": classical(`work:${work}`, { tab: "movements" }),
    recording: classical(`recording:${ref("recording")}`),
    "v1 work page": () => plugin.pages.read({ ...base, user, pageId: "work", resourceId: work, query: {}, capabilities: { resourceView: 2 } }),
    ...Object.fromEntries(["works", "composers", "performers", "albums", "review", "search", "activity"].map((tab) => [`editor ${tab}`, editor({ tab, offset: "0" })])),
    "editor work": editor({ tab: "works", selection: work }),
    "editor album": editor({ tab: "albums", selection: "album:perf-0" }),
    search: () => plugin.search({ ...base, user, query: { q: "sonata" }, capabilities: { search: 1, itemLinks: 1 } }),
    "album presentation": () => plugin.albumPresentation({ ...base, user, album: { id: "perf-0" }, capabilities: { albumPresentation: 1, itemLinks: 1 } }),
    "track links": () => plugin.trackLinks({ ...base, user, trackIds: ["0-0", "1-1", "2-2"], capabilities: { trackLinks: 1 } }),
  };
  lookup.close();
  const timings = {};
  for (const [name, read] of Object.entries(pages)) {
    await read(); // warm
    const started = performance.now();
    const result = await read();
    timings[name] = Math.round(performance.now() - started);
    assert.ok(result, name);
  }
  t.diagnostic(JSON.stringify(timings));
  const slow = Object.entries(timings).filter(([, ms]) => ms >= LIMIT_MS);
  assert.deepEqual(slow, [], `pages at or over ${LIMIT_MS} ms`);
});
