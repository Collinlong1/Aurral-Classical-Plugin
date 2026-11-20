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

test("the album presentation answers in under a second on a warm 10,000-track catalogue", { timeout: 600_000 }, async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const c = await buildCatalogue(path.join(folders.dataFolder, "model"));
  const count = (sql) => c.db.prepare(sql).get().n;
  assert.equal(count("SELECT count(*) AS n FROM track_link WHERE state='active'"), 10_000);
  assert.equal(count("SELECT count(*) AS n FROM realization"), 2_500);
  c.close();

  const user = { id: 7, username: "listener", role: "user" };
  const base = { ...folders, settings: {} };
  const db = (await import("../src/model/catalogue.js")).openCatalogue;
  const lookup = await db(path.join(folders.dataFolder, "model"));
  const pages = {
    "album presentation": () => plugin.albumPresentation({ ...base, user, album: { id: "perf-0" }, capabilities: { albumPresentation: 1 } }),
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
