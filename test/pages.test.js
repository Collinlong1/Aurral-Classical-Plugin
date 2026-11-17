import assert from "node:assert/strict";
import test from "node:test";
import { library, setup, workId } from "./library-fixture.js";
import { ensureSearchIndex } from "../src/search/engine.js";
import { LISTS, listView, renderClassical } from "../src/model/pages.js";

const section = (view, id) => view.sections.find((s) => s.id === id);

test("the Classical home counts each list as the list does and links to it", async (t) => {
  const { c } = await library(t);
  const home = renderClassical(c, "home");
  assert.equal(home.title, "Classical");
  assert.equal(home.sections[0].subtitle, "3 works · 5 recordings");
  const browse = section(home, "browse");
  assert.deepEqual(browse.rows.map((row) => row.id), Object.keys(LISTS));
  for (const row of browse.rows) {
    assert.deepEqual(row.link, { type: "resource", pageId: "classical", resourceId: `list:${row.id}` });
    assert.equal(row.detail, listView(c, row.id).sections[0].subtitle, row.id);
  }
  assert.deepEqual(
    Object.fromEntries(browse.rows.map((row) => [row.id, row.detail])),
    { composer: "3 composers", work: "3 works", performer: browse.rows[2].detail, conductor: "2 conductors", ensemble: browse.rows[4].detail, recording: "5 recordings" },
  );
});

test("recently added works follow the newest track that plays part of each", async (t) => {
  const { c, moonlight } = await library(t);
  const bach = workId(c, "Cello Suite");
  const dvorak = workId(c, "Symphony No. 9");
  const touch = (albumId, at) => c.db.prepare("UPDATE track_link SET created_at=? WHERE json_extract(evidence,'$.albumId')=?").run(at, albumId);
  const day = 24 * 3600 * 1000;
  const base = Date.UTC(2026, 10, 1);
  for (const albumId of ["levit", "levit-box", "barenboim", "ma", "dvorak", "dvorak-db"]) touch(albumId, base);
  touch("ma", base + 3 * day);
  touch("levit-box", base + 9 * day);
  ensureSearchIndex(c);
  const recent = section(renderClassical(c, "home"), "recent").rows;
  assert.deepEqual(recent.map((row) => row.id), [moonlight, bach, dvorak]);
  assert.equal(recent[0].detail, "Ludwig van Beethoven · Added Nov 10, 2026");
  assert.deepEqual(recent[1].link, { type: "resource", pageId: "classical", resourceId: `work:${bach}` });
  // A work whose tracks are all gone leaves the list.
  c.db.prepare("UPDATE track_link SET state='missing' WHERE json_extract(evidence,'$.albumId')='ma'").run();
  assert.deepEqual(section(renderClassical(c, "home"), "recent").rows.map((row) => row.id), [moonlight, dvorak]);
});

test("an empty Library's Classical home says how it fills", async (t) => {
  const c = await setup(t);
  const home = renderClassical(c, "home");
  assert.deepEqual(home.sections.map((s) => s.type), ["header", "empty"]);
  assert.match(home.sections[1].message, /No classical music/);
});
