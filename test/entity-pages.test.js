// The Classical Library's entity pages (v0.3 4.4, 4.5, 5.1-5.3, 6.1-6.3,
// 6.5): composers, people, ensembles, works, recordings and saved
// comparisons, over the small test Library in library-fixture.js.
import assert from "node:assert/strict";
import test from "node:test";
import { MOONLIGHT, SONATA, album, library, workId } from "./library-fixture.js";
import { Metadata } from "../src/model/metadata.js";
import { ensureSearchIndex } from "../src/search/engine.js";
import { searchResult } from "../src/search/provider.js";
import { applyClassicalMutation, renderClassical } from "../src/model/pages.js";
import { completeness } from "../src/model/pages-entities.js";
import { renderAlbumPresentation, renderTrackLinks } from "../src/model/presentation.js";

const ME = { id: 7, role: "user" };
const OTHER = { id: 8, role: "user" };
const ADMIN = { id: 1, role: "admin" };
const read = (c, resourceId, query = {}, user = ME) => renderClassical(c, resourceId, query, user);
const section = (view, id) => view.sections.find((s) => s.id === id);
const ofType = (view, type) => view.sections.filter((s) => s.type === type);
const header = (view) => view.sections.find((s) => s.type === "header");
const ref = (c, kind, like) => c.db.prepare("SELECT ref FROM search_doc WHERE kind=? AND title LIKE ?").get(kind, like)?.ref;
const fact = (view, label) => header(view).facts.find((f) => f.label === label)?.value;
const page = (resourceId) => ({ type: "resource", pageId: "classical", resourceId });
// Every section stays inside core's view 2 limits.
function fitsCore(view) {
  assert.equal(view.version, 2);
  assert.ok(view.sections.length <= 30, "sections");
  const big = JSON.stringify(view).length;
  assert.ok(big < 512000, `${big} bytes`);
  for (const s of view.sections) {
    if (s.type === "rows") assert.ok(s.rows.length <= 100, s.id);
    if (s.type === "groups") {
      assert.ok(s.groups.length <= 50, s.id);
      for (const g of s.groups) assert.ok(g.rows.length <= 100, s.id);
    }
    if (s.type === "tracks") assert.ok(s.items.length <= 500, s.id);
    if (s.type === "header") assert.ok(s.facts.length <= 20 && (s.actions || []).length <= 6 && (s.badges || []).length <= 6);
    if (s.type === "pager") assert.ok(s.limit <= 500);
  }
  return view;
}

// A recording made by hand, as an admin's editor makes one: each part plays
// a movement (or none) from a track's range, or the whole track.
const trackOf = (c, coreId) => c.db.prepare("SELECT id FROM track_link WHERE core_id=?").get(coreId).id;
function handRecording(c, work, parts, { label = "By hand", soloist = null } = {}) {
  const performance = c.createEntity("performance");
  const pw = c.relate("performance_work", performance, work);
  const recording = c.createEntity("recording");
  c.relate("recording_performance", recording, performance);
  if (soloist) c.credit(performance, soloist, "soloist");
  const realization = c.realization(work, pw, label);
  parts.forEach(({ track, movement = null, startMs = 0, endMs = null }, i) => {
    const content = c.recordingContent(recording, pw, { movement, position: i + 1, startMs, endMs });
    const segment = c.segment(trackOf(c, track), endMs === null ? { kind: "whole" } : { startMs, endMs });
    c.segmentContent(segment, content);
    c.realizationItem(realization, segment, { movement, sequence: i + 1 });
  });
  return { performance, realization };
}
const movementsOf = (c, work) => c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work).map((r) => r.target_id);
// Brendel's Allegretto alone: an excerpt of the Moonlight.
function brendelExcerpt(c, moonlight) {
  const m = new Metadata(c);
  const brendel = c.createEntity("person");
  m.manual(brendel, "name", "Alfred Brendel", { actor: "test" });
  return handRecording(c, moonlight, [{ track: "excerpt-0", movement: movementsOf(c, moonlight)[1] }], { label: "Album excerpt", soloist: brendel });
}
const EXCERPT = album("excerpt", MOONLIGHT, ["II. Allegretto"], { composer: "Ludwig van Beethoven", artist: "Alfred Brendel" });

async function withIndex(t, extra = []) {
  const lib = await library(t, null, extra);
  ensureSearchIndex(lib.c);
  return lib;
}

// -- 4.4 composer pages --------------------------------------------------

test("a composer page groups works by form, sorts them, and links to works and performers (4.4)", async (t) => {
  const extra = [
    ...album("op13", "Piano Sonata No. 8 in C minor, Op. 13", ["I. Grave", "II. Adagio cantabile"], { composer: "Ludwig van Beethoven", artist: "Igor Levit" }),
    ...album("op20", "Septet in E-flat major, Op. 20", ["I. Adagio", "II. Adagio cantabile"], { composer: "Ludwig van Beethoven", artist: "Igor Levit" }),
  ];
  const { c, moonlight } = await withIndex(t, extra);
  const m = new Metadata(c);
  const pathetique = workId(c, "Sonata No. 8");
  const septet = workId(c, "Septet");
  m.manual(moonlight, "form", "sonata", { actor: "test", pin: true });
  m.manual(pathetique, "form", "sonata", { actor: "test", pin: true });
  m.manual(pathetique, "catalogue", ["Op. 13"], { actor: "test", pin: true });
  m.manual(septet, "date", "1799", { actor: "test", pin: true });
  const beethoven = ref(c, "composer", "Ludwig%");
  m.manual(beethoven, "aliases", ["Louis van Beethoven"], { actor: "test", pin: true });
  m.manual(beethoven, "date", "1770–1827", { actor: "test", pin: true });
  m.manual(beethoven, "period", "Classical", { actor: "test", pin: true });
  m.manual(beethoven, "description", "Bonn, then Vienna.", { actor: "test", pin: true });
  ensureSearchIndex(c);
  // No MusicBrainz ID: the page is the catalogue's own.
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM external_identity WHERE entity_id=?").get(beethoven).n, 0);

  const view = fitsCore(read(c, `composer:${beethoven}`));
  assert.equal(header(view).title, "Ludwig van Beethoven");
  assert.equal(header(view).subtitle, "Composer · 3 works");
  assert.equal(fact(view, "Other names"), "Louis van Beethoven");
  assert.equal(fact(view, "Dates"), "1770–1827");
  assert.equal(fact(view, "Period"), "Classical");
  assert.equal(section(view, "about").items[0].value, "Bonn, then Vienna.");
  // By form (the default): sonatas, then works with no form.
  const works = section(view, "works");
  assert.equal(works.type, "groups");
  assert.deepEqual(works.groups.map((g) => [g.heading, g.rows.map((r) => r.id)]), [
    ["Sonata", [pathetique, moonlight]],
    ["Other works", [septet]],
  ]);
  // Catalogue numbers only where the title lacks them; recording counts.
  assert.equal(works.groups[0].rows[1].detail, "2 recordings");
  assert.deepEqual(works.groups[0].rows[0].link, page(`work:${pathetique}`));
  // Other orders are one list.
  const sorted = (sort) => section(read(c, `composer:${beethoven}`, { sort }), "works");
  assert.equal(sorted("title").type, "rows");
  // Numbers as numbers: No. 8 before No. 14.
  assert.deepEqual(sorted("title").rows.map((r) => r.id), [pathetique, moonlight, septet]);
  assert.deepEqual(sorted("date").rows.map((r) => r.id)[0], septet);
  assert.deepEqual(view.sections.find((s) => s.type === "sort").options.map((o) => o.value), ["form", "title", "catalogue", "date"]);
  // Performers who recorded his works, most recordings first.
  const performers = section(view, "performers").rows;
  // Levit plays all three: soloist on one, performer (from the tags) on two.
  assert.equal(performers[0].label, "Igor Levit");
  assert.equal(performers[0].detail, "Performer · 3 recordings");
  assert.ok(performers.some((r) => r.label === "Daniel Barenboim" && r.link.resourceId.startsWith("person:")));
});

test("a composer page pages 100 works at a time, and an unknown composer is not found (4.4)", async (t) => {
  const many = Array.from({ length: 130 }, (_, i) => album(`m${i}`, `Minuet No. ${i + 1} in G major, WoO ${500 + i}`, ["I. Minuet", "II. Trio"], { composer: "Ludwig van Beethoven", artist: "Igor Levit" })).flat();
  const { c } = await withIndex(t, many);
  const beethoven = ref(c, "composer", "Ludwig%");
  const first = fitsCore(read(c, `composer:${beethoven}`, { sort: "title" }));
  assert.equal(section(first, "works").rows.length, 100);
  assert.deepEqual(first.sections.find((s) => s.type === "pager"), { type: "pager", total: 131, offset: 0, limit: 100 });
  const second = fitsCore(read(c, `composer:${beethoven}`, { sort: "title", page: 1 }));
  assert.equal(section(second, "works").rows.length, 31);
  assert.equal(section(second, "performers"), undefined, "performers on the first page only");
  // By form, one group of 100 rows.
  assert.equal(section(read(c, `composer:${beethoven}`), "works").groups[0].rows.length, 100);
  assert.throws(() => read(c, "composer:nobody"), /Composer not found/);
});

// -- 4.5 search links ---------------------------------------------------------

test("search links composers and contributors to their pages on view 2 hosts, and filters elsewhere (4.5)", async (t) => {
  const { c, barenboim, moonlight } = await withIndex(t);
  const items = (capabilities) => Object.fromEntries(searchResult(c, { q: "barenboim", limit: 10 }, capabilities).sections.flatMap((s) => s.items.map((i) => [`${i.kind}:${i.title}`, i.link])));
  const v2 = items({ resourceView: 2, itemLinks: 1 });
  assert.deepEqual(v2["performer:Daniel Barenboim"], page(`person:${barenboim}`));
  const work = Object.entries(v2).find(([key]) => key.startsWith("work:Piano Sonata"))[1];
  assert.deepEqual(work, page(`work:${moonlight}`));
  assert.match(Object.entries(v2).find(([key]) => key.startsWith("recording:"))[1].resourceId, /^recording:/);
  const ensemble = searchResult(c, { q: "chicago" }, { resourceView: 2 }).sections.find((s) => s.id === "performer").items[0];
  assert.match(ensemble.link.resourceId, /^ensemble:/);
  const composer = searchResult(c, { q: "dvorak" }, { resourceView: 2 }).sections.find((s) => s.id === "composer").items[0];
  assert.match(composer.link.resourceId, /^composer:/);
  // Older hosts: filters and the v1 work page, as before.
  const v1 = items({});
  assert.deepEqual(v1["performer:Daniel Barenboim"], { type: "filter", filters: { performer: [barenboim] } });
  assert.deepEqual(Object.entries(v1).find(([key]) => key.startsWith("work:Piano Sonata"))[1], { type: "resource", pageId: "work", resourceId: moonlight });
  assert.deepEqual(searchResult(c, { q: "dvorak" }).sections.find((s) => s.id === "composer").items[0].link.type, "filter");
});

// -- 5.1, 5.2 people ----------------------------------------------------------

test("a pianist who also conducts has one page with a section for each role (5.1)", async (t) => {
  const { c, barenboim } = await withIndex(t);
  const view = fitsCore(read(c, `person:${barenboim}`));
  assert.equal(header(view).title, "Daniel Barenboim");
  assert.equal(header(view).subtitle, "Soloist · Conductor · 2 recordings");
  const playing = section(view, "as-performer");
  const conducting = section(view, "as-conductor");
  assert.equal(playing.title, "As soloist or performer");
  assert.equal(conducting.title, "As conductor");
  // Recordings grouped by composer, each heading linking to the composer.
  assert.deepEqual(playing.groups.map((g) => g.heading), ["Ludwig van Beethoven"]);
  assert.deepEqual(conducting.groups.map((g) => g.heading), ["Antonín Dvořák"]);
  assert.match(conducting.groups[0].link.resourceId, /^composer:/);
  assert.equal(conducting.groups[0].rows[0].label, "Symphony No. 9 in E minor, Op. 95");
  assert.equal(conducting.groups[0].rows[0].detail, "With Chicago Symphony Orchestra · Album dvorak-db");
  assert.match(conducting.groups[0].rows[0].link.resourceId, /^recording:/);
  // One identity: the same page under either list.
  const people = (kind) => section(renderClassical(c, `list:${kind}`), kind).rows.filter((r) => r.label === "Daniel Barenboim");
  assert.deepEqual(people("performer").map((r) => r.link), [page(`person:${barenboim}`)]);
  assert.deepEqual(people("conductor").map((r) => r.link), [page(`person:${barenboim}`)]);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM entity e WHERE e.kind='person' AND e.deleted_at IS NULL AND e.id IN (SELECT f.target_id FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id WHERE f.field='name' AND a.value=?)").get(JSON.stringify("Daniel Barenboim")).n, 1);
  assert.throws(() => read(c, "person:nobody"), /Contributor not found/);
});

test("a contributor's recordings page 100 at a time, grouped by composer then work (5.1)", async (t) => {
  const many = Array.from({ length: 120 }, (_, i) =>
    album(`s${i}`, `Sonata No. ${i + 1} in C major, Op. ${300 + i}`, ["I. Allegro", "II. Adagio"], { composer: i % 2 ? "Joseph Haydn" : "Muzio Clementi", artist: "Igor Levit" }),
  ).flat();
  const { c } = await withIndex(t, many);
  const m = new Metadata(c);
  for (const [like, sortName] of [["Ludwig%", "Beethoven, Ludwig van"], ["Muzio%", "Clementi, Muzio"], ["Joseph%", "Haydn, Joseph"]])
    m.manual(ref(c, "composer", like), "sortName", sortName, { actor: "test", pin: true });
  ensureSearchIndex(c);
  const levit = ref(c, "performer", "Igor Levit");
  const first = fitsCore(read(c, `person:${levit}`));
  const pager = first.sections.find((s) => s.type === "pager");
  assert.deepEqual(pager, { type: "pager", total: 121, offset: 0, limit: 100 });
  const groups = section(first, "as-performer").groups;
  // Composers by sort name, as the Composers list orders them; works by title.
  assert.deepEqual(groups.map((g) => g.heading), ["Ludwig van Beethoven", "Muzio Clementi", "Joseph Haydn"]);
  const clementi = groups[1].rows.map((r) => r.label);
  assert.deepEqual(clementi.slice(0, 3), ["Sonata No. 1 in C major, Op. 300", "Sonata No. 3 in C major, Op. 302", "Sonata No. 5 in C major, Op. 304"]);
  assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), 100);
  const second = fitsCore(read(c, `person:${levit}`, { page: 1 }));
  assert.equal(ofType(second, "groups").reduce((n, s) => n + s.groups.reduce((m, g) => m + g.rows.length, 0), 0), 21);
  assert.equal(section(second, "collaborators"), undefined);
});

test("collaborators are counted from shared credits (5.2)", async (t) => {
  const { c, barenboim, karajan, credit } = await withIndex(t);
  // Karajan also conducts the Chicago recording: a second shared recording.
  credit("dvorak-db", karajan, "conductor");
  ensureSearchIndex(c);
  const chicago = ref(c, "performer", "Chicago%");
  const view = fitsCore(read(c, `ensemble:${chicago}`));
  const rows = section(view, "collaborators").rows;
  assert.deepEqual(rows.map((r) => [r.label, r.detail]), [
    ["Daniel Barenboim", "Conductor · 1 recording"],
    ["Herbert von Karajan", "Conductor · 1 recording"],
  ]);
  assert.deepEqual(rows[0].link, page(`person:${barenboim}`));
  // Karajan: the Berlin and Chicago orchestras, and Barenboim on the second.
  const his = section(read(c, `person:${karajan}`), "collaborators").rows.map((r) => [r.label, r.detail]);
  assert.deepEqual(his, [
    ["Berliner Philharmoniker", "Orchestra · 1 recording"],
    ["Chicago Symphony Orchestra", "Orchestra · 1 recording"],
    ["Daniel Barenboim", "Conductor · 1 recording"],
  ]);
  // Nobody is their own collaborator.
  assert.ok(!his.some(([label]) => label === "Herbert von Karajan"));
});

// -- 5.3 ensembles ------------------------------------------------------------

test("an ensemble page lists its recordings and its members from member_of (5.3)", async (t) => {
  const { c, barenboim } = await withIndex(t);
  const chicago = ref(c, "performer", "Chicago%");
  const m = new Metadata(c);
  const concertmaster = c.createEntity("person");
  m.manual(concertmaster, "name", "Robert Chen", { actor: "test" });
  m.manual(chicago, "date", "1891", { actor: "test", pin: true });
  m.manual(chicago, "aliases", ["CSO"], { actor: "test", pin: true });
  c.relate("member_of", concertmaster, chicago, { position: 1 });
  c.relate("member_of", barenboim, chicago, { position: 2 });
  ensureSearchIndex(c);
  const view = fitsCore(read(c, `ensemble:${chicago}`));
  assert.equal(header(view).title, "Chicago Symphony Orchestra");
  assert.equal(header(view).subtitle, "Orchestra · 1 recording");
  assert.equal(fact(view, "Founded"), "1891");
  assert.equal(fact(view, "Other names"), "CSO");
  const members = section(view, "members");
  assert.equal(members.title, "Members");
  assert.deepEqual(members.rows.map((r) => [r.label, r.link]), [
    ["Robert Chen", page(`person:${concertmaster}`)],
    ["Daniel Barenboim", page(`person:${barenboim}`)],
  ]);
  // One list for an ensemble, not a section per role.
  assert.equal(section(view, "as-performer").title, "Recordings");
  assert.equal(section(view, "as-conductor"), undefined);
  // The member's page names the ensemble.
  assert.deepEqual(section(read(c, `person:${barenboim}`), "members").rows.map((r) => [r.label, r.link]), [["Chicago Symphony Orchestra", page(`ensemble:${chicago}`)]]);
  // An ensemble without members has no members section.
  assert.equal(section(read(c, `ensemble:${ref(c, "performer", "Berliner%")}`), "members"), undefined);
});

// -- 6.1 works ----------------------------------------------------------------

test("completeness reads complete, some movements, or an excerpt", () => {
  assert.equal(completeness(3, 3), "Complete");
  assert.equal(completeness(1, 0), "Complete");
  assert.equal(completeness(2, 3), "2 of 3 movements");
  assert.equal(completeness(1, 3), "Excerpt");
});

test("a work page has facts, movements, recordings by performance with completeness, and keeps picks and favourites (6.1)", async (t) => {
  const { c, moonlight } = await withIndex(t, EXCERPT);
  brendelExcerpt(c, moonlight);
  const m = new Metadata(c);
  m.manual(moonlight, "catalogue", ["Op. 27 No. 2"], { actor: "test", pin: true });
  m.manual(moonlight, "key", "C-sharp minor", { actor: "test", pin: true });
  m.manual(moonlight, "date", "1801", { actor: "test", pin: true });
  ensureSearchIndex(c);
  const view = fitsCore(read(c, `work:${moonlight}`));
  assert.equal(header(view).subtitle, "Ludwig van Beethoven · “Moonlight”");
  assert.equal(fact(view, "Catalogue"), "Op. 27 No. 2");
  assert.equal(fact(view, "Key"), "C-sharp minor");
  assert.match(header(view).facts[0].link.resourceId, /^composer:/);
  assert.deepEqual(Object.fromEntries(section(view, "about").items.map((i) => [i.label, i.value])), { Period: "Classical", Written: "1801", "Other names": "Sonata quasi una fantasia" });
  assert.deepEqual(view.sections.find((s) => s.type === "tabs").tabs.map((tab) => [tab.id, tab.count]), [["recordings", 3], ["movements", 3]]);
  // Recordings: one per performance (Levit's two releases are one), badged.
  const recordings = section(view, "recordings").groups;
  assert.equal(recordings.length, 3);
  const levit = recordings.find((g) => g.heading === "Igor Levit");
  assert.deepEqual(levit.rows.map((r) => [r.label, r.badge]).sort(), [["Album levit", "Complete"], ["Album levit-box", "Complete"]]);
  assert.deepEqual(recordings.find((g) => g.heading === "Alfred Brendel").rows.map((r) => r.badge), ["Excerpt"]);
  assert.deepEqual(levit.rows[0].link.type, "album");
  assert.match(levit.link.resourceId, /^recording:/);
  // A playable section, with the work as context for queued titles.
  const play = section(view, "play");
  assert.equal(play.type, "tracks");
  assert.equal(play.context, MOONLIGHT);
  // With no pick, the fullest recording plays (Barenboim before Levit by
  // name), never the excerpt, whatever order the random ids give.
  assert.equal(play.title, "Listen: Daniel Barenboim");
  assert.equal(play.items.length, 3);
  // Movements tab, with how many recordings hold each.
  const movements = section(read(c, `work:${moonlight}`, { tab: "movements" }), "movements").rows;
  assert.deepEqual(movements.map((r) => [r.label, r.detail]), [["I. Adagio sostenuto", "3 recordings".replace("3", "2")], ["II. Allegretto", "3 recordings"], ["III. Presto agitato", "2 recordings"]]);
  assert.deepEqual(movements[1].link, { type: "filter", filters: { movement: [movements[1].id] } });
  // A chosen movement compares that movement across recordings.
  const second = read(c, `work:${moonlight}`, { filters: { movement: [movements[1].id] } });
  assert.equal(section(second, "play").title, "Compare: II. Allegretto");
  assert.deepEqual(section(second, "play").items.map((i) => i.title), ["II. Allegretto", "II. Allegretto", "II. Allegretto"]);
  // Favourite and pick are the reader's own, shared with the v1 work page.
  assert.deepEqual(applyClassicalMutation(c, `work:${moonlight}`, { command: "favourite", value: true }, ME), { ok: true });
  const favourite = header(read(c, `work:${moonlight}`)).actions[0];
  assert.deepEqual([favourite.label, favourite.pressed], ["Remove favourite", true]);
  assert.equal(header(read(c, `work:${moonlight}`, {}, OTHER)).actions[0].pressed, false);
  const brendel = recordings.find((g) => g.heading === "Alfred Brendel").link.resourceId;
  applyClassicalMutation(c, brendel, { command: "pick", realizationId: brendel.slice("recording:".length) }, ME);
  const picked = section(read(c, `work:${moonlight}`), "play");
  assert.equal(picked.title, "Your pick: Alfred Brendel");
  assert.equal(section(read(c, `work:${moonlight}`), "recordings").groups.find((g) => g.heading === "Alfred Brendel").detail.split(" · ")[0], "Your pick");
  assert.throws(() => read(c, "work:nothing"), /Work not found/);
});

test("a work of 600 movements pages its movements and stays inside core's limits (6.1)", async (t) => {
  const { c } = await withIndex(t);
  const m = new Metadata(c);
  const work = c.createEntity("work");
  m.manual(work, "title", "Six Hundred Pieces", { actor: "test" });
  const composer = ref(c, "composer", "Johann%");
  c.credit(work, composer, "composer");
  const movements = Array.from({ length: 600 }, (_, i) => {
    const id = c.createEntity("movement");
    m.manual(id, "title", `No. ${i + 1}`, { actor: "test" });
    c.relate("movement", work, id, { position: i + 1 });
    return id;
  });
  // One recording of the first movement, from a track already in the Library.
  handRecording(c, work, [{ track: "ma-0", movement: movements[0] }]);
  ensureSearchIndex(c);
  const view = fitsCore(read(c, `work:${work}`));
  assert.deepEqual(view.sections.find((s) => s.type === "tabs").tabs.map((tab) => tab.count), [1, 600]);
  // Too many movements for a menu: no movement filter.
  assert.equal(view.sections.find((s) => s.type === "filters"), undefined);
  assert.deepEqual(section(view, "recordings").groups[0].rows.map((r) => r.badge), ["Excerpt"]);
  const tab = (n) => fitsCore(read(c, `work:${work}`, { tab: "movements", page: n }));
  assert.equal(section(tab(0), "movements").rows.length, 100);
  assert.deepEqual(tab(0).sections.find((s) => s.type === "pager"), { type: "pager", total: 600, offset: 0, limit: 100 });
  assert.deepEqual(section(tab(5), "movements").rows.map((r) => r.label).slice(-1), ["No. 600"]);
  assert.equal(section(tab(9), "empty")?.message ?? tab(9).sections.find((s) => s.type === "empty").message, "No more movements.");
});

test("a work in a collection shows its siblings under Related (6.1)", async (t) => {
  const { c, moonlight } = await withIndex(t, album("op27-1", "Piano Sonata No. 13 in E-flat major, Op. 27 No. 1", SONATA, { composer: "Ludwig van Beethoven", artist: "Igor Levit" }));
  const m = new Metadata(c);
  const sister = workId(c, "Sonata No. 13");
  const set = c.createEntity("collection");
  m.manual(set, "title", "Two Sonatas, Op. 27", { actor: "test" });
  c.relate("collection_member", set, moonlight, { position: 2 });
  c.relate("collection_member", set, sister, { position: 1 });
  ensureSearchIndex(c);
  const view = read(c, `work:${moonlight}`);
  assert.deepEqual(view.sections.find((s) => s.type === "tabs").tabs.at(-1), { id: "related", label: "Related", count: 1 });
  assert.equal(section(view, "about").items.find((i) => i.label === "Part of").value, "Two Sonatas, Op. 27");
  const related = section(read(c, `work:${moonlight}`, { tab: "related" }), "related").groups[0];
  assert.equal(related.heading, "Two Sonatas, Op. 27");
  assert.deepEqual(related.rows.map((r) => [r.id, r.badge, r.link]), [
    [sister, "", page(`work:${sister}`)],
    [moonlight, "This work", null],
  ]);
});

// -- 6.2 recordings -----------------------------------------------------------

test("a recording page has its work, credits by role, playable movements and every release (6.2)", async (t) => {
  const { c, moonlight } = await withIndex(t);
  const key = ref(c, "recording", "Igor Levit");
  const levit = ref(c, "performer", "Igor Levit");
  const view = fitsCore(read(c, `recording:${key}`));
  assert.equal(header(view).title, "Igor Levit");
  assert.equal(header(view).subtitle, `${MOONLIGHT} · Ludwig van Beethoven`);
  assert.deepEqual(header(view).facts[0], { label: "Work", value: MOONLIGHT, link: page(`work:${moonlight}`) });
  assert.deepEqual(header(view).badges, ["Complete"]);
  assert.deepEqual(section(view, "credits").items, [{ label: "Soloist", value: "Igor Levit", link: page(`person:${levit}`) }]);
  const movements = section(view, "movements");
  assert.equal(movements.type, "tracks");
  assert.deepEqual(movements.items.map((i) => i.title), SONATA);
  assert.ok(movements.items.every((i) => i.durationMs > 0));
  // Two releases of one performance.
  assert.deepEqual(section(view, "releases").rows.map((r) => r.link.albumId).sort(), ["levit", "levit-box"]);
  // The other release's realization opens the same page.
  const other = c.db.prepare("SELECT id FROM realization WHERE label='Album levit-box'").get().id;
  const viaOther = read(c, `recording:${other}`);
  assert.equal(header(viaOther).title, "Igor Levit");
  assert.equal(section(viaOther, "releases").rows.length, 2);
  // Favourite the performance; the reader's own.
  const action = header(view).actions.find((a) => a.mutation.command === "favourite-item");
  assert.deepEqual(applyClassicalMutation(c, `recording:${key}`, action.mutation, ME), { ok: true });
  assert.equal(header(read(c, `recording:${key}`)).actions[0].label, "Remove favourite");
  assert.equal(header(read(c, `recording:${key}`, {}, OTHER)).actions[0].label, "Favourite recording");
  assert.throws(() => applyClassicalMutation(c, `recording:${key}`, { ...action.mutation, target: "elsewhere" }, ME), /not on this page/);
  // Picks: the reader's, and the server's for admins only.
  assert.deepEqual(header(view).actions.map((a) => a.label), ["Favourite recording", "Make my pick"]);
  assert.deepEqual(header(read(c, `recording:${key}`, {}, ADMIN)).actions.map((a) => a.label), ["Favourite recording", "Make my pick", "Set server pick"]);
  applyClassicalMutation(c, `recording:${key}`, { command: "admin-pick", realizationId: key }, ADMIN);
  assert.deepEqual(header(read(c, `recording:${key}`)).badges, ["Complete", "Server pick"]);
  assert.throws(() => applyClassicalMutation(c, `recording:${key}`, { command: "admin-pick", realizationId: null }, ME), /Only admins/);
});

test("an excerpt and a broadcast have recording pages too (6.2)", async (t) => {
  const { c, moonlight } = await withIndex(t, EXCERPT);
  brendelExcerpt(c, moonlight);
  ensureSearchIndex(c);
  const brendel = ref(c, "recording", "Alfred Brendel");
  const view = read(c, `recording:${brendel}`);
  assert.deepEqual(header(view).badges, ["Excerpt"]);
  assert.deepEqual(section(view, "movements").items.map((i) => i.title), ["II. Allegretto"]);
  assert.equal(section(view, "releases").title, "Release");
  // A broadcast: a performance with no tracks, named by its own record.
  const m = new Metadata(c);
  const performance = c.createEntity("performance", { type: "broadcast", date: "1961-05", datePrecision: "month" });
  c.relate("performance_work", performance, moonlight);
  const record = c.createEntity("recording", { type: "broadcast" });
  c.relate("recording_performance", record, performance);
  m.manual(record, "title", "BBC Proms broadcast", { actor: "test" });
  m.manual(record, "date", "1961-05", { actor: "test" });
  m.manual(record, "location", "Royal Albert Hall", { actor: "test" });
  m.manual(record, "description", "From the archive.", { actor: "test" });
  ensureSearchIndex(c);
  const broadcast = fitsCore(read(c, `recording:${performance}`));
  assert.equal(header(broadcast).title, "BBC Proms broadcast");
  assert.equal(fact(broadcast, "Recorded"), "1961-05");
  assert.equal(fact(broadcast, "Location"), "Royal Albert Hall");
  assert.deepEqual(header(broadcast).badges, ["Broadcast"]);
  assert.equal(section(broadcast, "about").items[0].value, "From the archive.");
  assert.equal(broadcast.sections.find((s) => s.type === "empty").message, "Nothing from this recording is in your Library.");
  assert.deepEqual(header(broadcast).actions.map((a) => a.label), ["Favourite recording"]);
  assert.throws(() => read(c, "recording:nothing"), /Recording not found/);
});

// -- 6.3 links on album and player tracks -------------------------------------

test("album groups and their tracks link to the work, recording, composer and performers (6.3)", async (t) => {
  const { c, moonlight } = await withIndex(t);
  const levit = ref(c, "performer", "Igor Levit");
  const beethoven = ref(c, "composer", "Ludwig%");
  const realization = c.db.prepare("SELECT id FROM realization WHERE label='Album levit'").get().id;
  const expected = [
    { label: "Go to Work", link: page(`work:${moonlight}`) },
    { label: "Go to Recording", link: page(`recording:${realization}`) },
    { label: "Go to Ludwig van Beethoven", link: page(`composer:${beethoven}`) },
    { label: "Go to Igor Levit", link: page(`person:${levit}`) },
  ];
  const presentation = renderAlbumPresentation(c, "levit", { albumPresentation: 1, itemLinks: 1 });
  const group = presentation.groups[0];
  assert.deepEqual(group.links, expected);
  assert.ok(group.items.every((item) => JSON.stringify(item.links) === JSON.stringify(expected)));
  // Hosts without item links get none.
  const plain = renderAlbumPresentation(c, "levit");
  assert.equal(plain.groups[0].links, undefined);
  assert.ok(plain.groups[0].items.every((item) => item.links === undefined));
  // An orchestra and conductor are both named, at most six links.
  const dvorak = renderAlbumPresentation(c, "dvorak", { itemLinks: 1 }).groups[0].links.map((l) => l.label);
  assert.deepEqual(dvorak, ["Go to Work", "Go to Recording", "Go to Antonín Dvořák", "Go to Herbert von Karajan", "Go to Berliner Philharmoniker"]);
});

test("track links name the same places for tracks queued from ordinary pages (6.3)", async (t) => {
  const { c, moonlight } = await withIndex(t);
  const result = renderTrackLinks(c, ["levit-1", "levit-1", "not-a-track", ""]);
  assert.deepEqual(Object.keys(result.tracks), ["levit-1"]);
  assert.deepEqual(result.tracks["levit-1"][0], { label: "Go to Work", link: page(`work:${moonlight}`) });
  assert.equal(result.tracks["levit-1"].length, 4);
  assert.deepEqual(renderTrackLinks(c, []), { version: 1, tracks: {} });
  // A track holding parts of two works names each work.
  const m = new Metadata(c);
  const other = c.createEntity("work");
  m.manual(other, "title", "Encore", { actor: "test" });
  handRecording(c, other, [{ track: "levit-1", startMs: 200000, endMs: 250000 }], { label: "Encore" });
  assert.deepEqual(renderTrackLinks(c, ["levit-1"]).tracks["levit-1"].map((l) => l.label), [`Go to Work: ${MOONLIGHT}`, "Go to Work: Encore"]);
});

// -- 6.5 saved comparisons ----------------------------------------------------

// Movements I and II of the Moonlight from one track, as ranges.
function rangeRecording(c, work) {
  const movements = movementsOf(c, work);
  const { realization } = handRecording(c, work, [
    { track: "barenboim-0", movement: movements[0], startMs: 0, endMs: 120000 },
    { track: "barenboim-0", movement: movements[1], startMs: 120000, endMs: 300000 },
  ], { label: "Ranges" });
  return { realization, movements };
}

test("a saved comparison keeps the parts and ranges chosen, for its owner only (6.5)", async (t) => {
  const { c, moonlight } = await withIndex(t);
  const { movements } = rangeRecording(c, moonlight);
  ensureSearchIndex(c);
  // Compare movement II: every recording's second movement, ranges kept.
  const work = read(c, `work:${moonlight}`, { filters: { movement: [movements[1]] } });
  const save = header(work).actions.find((a) => a.mutation?.command === "save-queue");
  assert.equal(save.label, "Save comparison");
  assert.equal(save.mutation.name, `${MOONLIGHT} – II. Allegretto`);
  const shown = section(work, "play").items;
  assert.deepEqual(save.mutation.itemIds, shown.map((i) => i.id));
  const ranged = shown.find((i) => i.endMs === 300000);
  assert.equal(ranged.startMs, 120000);
  // Save two parts: the ranged one and Levit's.
  const two = [ranged.id, shown.find((i) => i.endMs === null).id];
  assert.deepEqual(applyClassicalMutation(c, `work:${moonlight}`, { command: "save-queue", name: "Two seconds movements", itemIds: two }, ME), { ok: true });
  const saved = section(read(c, `work:${moonlight}`), "saved");
  assert.equal(saved.title, "Saved comparisons");
  assert.equal(saved.rows[0].label, "Two seconds movements");
  assert.match(saved.rows[0].detail, /^2 parts · Saved /);
  // Another reader sees none of it.
  assert.equal(section(read(c, `work:${moonlight}`, {}, OTHER), "saved"), undefined);
  // The comparison plays exactly those parts, in order, with their ranges.
  const queueId = saved.rows[0].link.resourceId;
  const queue = fitsCore(read(c, queueId));
  assert.equal(header(queue).title, "Two seconds movements");
  assert.deepEqual(header(queue).facts, [{ label: "Work", value: MOONLIGHT, link: page(`work:${moonlight}`) }]);
  const parts = section(queue, "parts");
  assert.equal(parts.context, MOONLIGHT);
  assert.deepEqual(parts.items.map((i) => [i.id, i.trackId, i.startMs, i.endMs]), [
    [ranged.id, "barenboim-0", 120000, 300000],
    [two[1], shown.find((i) => i.id === two[1]).trackId, 0, null],
  ]);
  assert.equal(read(c, queueId, {}, OTHER).sections[1].message, "This saved comparison was deleted.");
  // Only items the page shows can be saved; a name is required.
  assert.throws(() => applyClassicalMutation(c, `work:${moonlight}`, { command: "save-queue", name: "x", itemIds: ["forged"] }, ME), /no longer on this page/);
  assert.throws(() => applyClassicalMutation(c, `work:${moonlight}`, { command: "save-queue", name: " ", itemIds: two }, ME), /Name the comparison/);
  // A part whose track left the Library is left out.
  c.db.prepare("UPDATE track_link SET state='missing' WHERE core_id='barenboim-0'").run();
  assert.deepEqual(section(read(c, queueId), "parts").items.map((i) => i.id), [two[1]]);
  // Delete: the owner's only.
  applyClassicalMutation(c, queueId, { command: "delete-queue", target: queueId.slice("queue:".length) }, OTHER);
  assert.ok(section(read(c, queueId), "parts"), "another reader's delete changes nothing");
  assert.deepEqual(applyClassicalMutation(c, queueId, header(queue).actions[0].mutation, ME), { ok: true });
  assert.equal(read(c, queueId).sections[1].message, "This saved comparison was deleted.");
  assert.equal(section(read(c, `work:${moonlight}`), "saved"), undefined);
});

test("a whole-work comparison is offered with two or more recordings, and the list of saves is bounded (6.5)", async (t) => {
  const { c, moonlight } = await withIndex(t);
  const save = header(read(c, `work:${moonlight}`)).actions.find((a) => a.mutation?.command === "save-queue");
  assert.equal(save.label, "Save whole-work comparison");
  assert.equal(save.mutation.itemIds.length, 6);
  for (let i = 0; i < 50; i++) applyClassicalMutation(c, `work:${moonlight}`, { ...save.mutation, name: `Save ${i}` }, ME);
  assert.throws(() => applyClassicalMutation(c, `work:${moonlight}`, save.mutation, ME), /keeps 50 saved comparisons/);
  assert.equal(section(read(c, `work:${moonlight}`), "saved").rows.length, 50);
  // A single recording has nothing to compare.
  const bach = workId(c, "Cello Suite");
  assert.equal(header(read(c, `work:${bach}`)).actions.some((a) => a.mutation?.command === "save-queue"), false);
  // Lists and home have no actions.
  assert.throws(() => applyClassicalMutation(c, "home", { command: "favourite" }, ME), /no actions/);
});
