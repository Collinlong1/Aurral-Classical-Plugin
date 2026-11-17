import assert from "node:assert/strict";
import test from "node:test";
import { album, library, realizationsOf, scan, setup, resetGeneration } from "./library-fixture.js";
import { Metadata } from "../src/model/metadata.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { searchCatalogue, ensureSearchIndex } from "../src/search/engine.js";
import { relinkReissue, unlinkReissue } from "../src/model/reissues.js";
import { catalogueKeys, parseQuery } from "../src/search/normalize.js";
import { listView } from "../src/model/pages.js";

test("catalogue numbers are one key however they are written", () => {
  for (const text of ["Op 27 no 2", "Op.27/2", "op. 27, No. 2", "Opus 27 No. 2"]) assert.deepEqual(catalogueKeys(text).map((k) => k.key), ["op:27:2"], text);
  assert.deepEqual(catalogueKeys("Hob. XVI:52 and Hob.XVI/52").map((k) => k.key), ["hob:xvi:52", "hob:xvi:52"]);
  assert.deepEqual(catalogueKeys("KV 331a, K. 331").map((k) => k.key), ["k:331a", "k:331"]);
  assert.deepEqual(catalogueKeys("Sonata in D major").map((k) => k.key), [], "a key name is not a catalogue number");
  assert.deepEqual(catalogueKeys("D. 960; S.244/2; BWV 1007 2").map((k) => k.key), ["d:960", "s:244:2", "bwv:1007"]);
  assert.deepEqual(parseQuery("Piano Sonata No. 14").words, ["piano", "sonata", "14"]);
});

test("different names, nicknames and catalogue formats find the same work first", async (t) => {
  const { c, moonlight } = await library(t);
  for (const q of ["Moonlight Sonata", "Op. 27 No. 2", "op.27/2", "Piano Sonata No. 14", "quasi una fantasia"]) {
    const result = searchCatalogue(c, { q });
    assert.equal(result.best?.kind, "work", q);
    assert.equal(result.best.ref, moonlight, q);
    assert.equal(result.sections[0].id, "work", q);
  }
  // Accents, partial words and spellings.
  const dvorak = searchCatalogue(c, { q: "Dvorak" });
  assert.equal(dvorak.best.kind, "composer");
  assert.equal(dvorak.best.title, "Antonín Dvořák");
  assert.ok(searchCatalogue(c, { q: "dvor sym" }).sections.find((s) => s.id === "work").items.some((i) => i.title.startsWith("Symphony No. 9")));
  assert.equal(searchCatalogue(c, { q: "BWV 1007" }).best.title, "Cello Suite No. 1 in G major, BWV 1007");
  assert.equal(searchCatalogue(c, { q: "Bach Cello Suite" }).best.kind, "work");
  // Op. 27 alone finds its numbered pieces; Op. 95 is a different work.
  const op27 = searchCatalogue(c, { q: "Op. 27" });
  assert.equal(op27.best.ref, moonlight);
  assert.ok(!op27.sections.find((s) => s.id === "work").items.some((i) => i.title.includes("Op. 95")));
});

test("combined searches, role-aware filters and one recording across releases", async (t) => {
  const { c, moonlight, barenboim, karajan, credit } = await library(t);
  // Composer + work + performer finds the recording, and lifts its work.
  const combined = searchCatalogue(c, { q: "Beethoven moonlight levit" });
  const recordings = combined.sections.find((s) => s.id === "recording");
  assert.equal(recordings.total, 1, "the Levit recording on two releases is one recording");
  assert.equal(recordings.items[0].realizations.length, 2);
  assert.match(recordings.items[0].detail, /2 releases/);
  assert.equal(combined.sections.find((s) => s.id === "work").items[0].ref, moonlight);
  // Barenboim plays the sonata and conducts the symphony: the conductor
  // filter keeps only what he conducted.
  const conducted = searchCatalogue(c, { q: "", filters: { conductor: [barenboim] }, kinds: ["recording"] });
  assert.deepEqual(conducted.sections.map((s) => s.id), ["recording"]);
  assert.equal(conducted.sections[0].total, 1);
  assert.match(conducted.sections[0].items[0].subtitle, /Symphony No. 9/);
  const played = searchCatalogue(c, { q: "barenboim", kinds: ["recording"] });
  assert.equal(played.sections[0].total, 2, "a name search finds every role");
  const karajanOnly = searchCatalogue(c, { q: "symphony", filters: { conductor: [karajan] } });
  assert.ok(karajanOnly.sections.find((s) => s.id === "recording").items.every((i) => /Karajan/.test(i.title)));
  // Facets offer the roles found, and the performer list is role-labelled.
  const facets = searchCatalogue(c, { q: "barenboim" });
  assert.ok(facets.facets.find((f) => f.key === "conductor").options.some((o) => o.value === barenboim));
  assert.match(facets.sections.find((s) => s.id === "performer").items[0].subtitle, /Soloist · Conductor|Conductor · Soloist/);
  // A derived credit counts until an admin removes it; removing it rebuilds
  // the index even though no credit row is added or deleted.
  const conductedBy = () => searchCatalogue(c, { q: "", filters: { conductor: [barenboim] }, kinds: ["recording"] }).sections[0]?.total ?? 0;
  const derived = credit("dvorak", barenboim, "conductor", "derived");
  assert.equal(conductedBy(), 2);
  c.removeCredit(derived);
  assert.equal(conductedBy(), 1);
  // Credits' roles and instruments filter recordings; tag names no longer
  // stand in for performers once credits exist.
  const roleFacet = searchCatalogue(c, { q: "barenboim" }).facets.find((f) => f.key === "role");
  assert.deepEqual(roleFacet.options.map((o) => o.value).sort(), ["conductor", "orchestra", "soloist"]);
  assert.equal(searchCatalogue(c, { q: "", filters: { role: ["conductor"] }, kinds: ["recording"] }).sections[0].total, 2);
  const soloist = c.db.prepare("SELECT id,target_id FROM credit WHERE contributor_id=? AND role='soloist'").get(barenboim);
  c.removeCredit(soloist.id);
  c.credit(soloist.target_id, barenboim, "soloist", { instrument: "piano" });
  assert.deepEqual(
    searchCatalogue(c, { q: "", filters: { instrument: ["piano"] }, kinds: ["recording"] }).sections[0].items.map((i) => i.title),
    ["Daniel Barenboim"],
  );
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM search_facet WHERE facet='performer' AND value LIKE 'name:%'").get().n, 0);
  // Sort keys are stored with each document.
  assert.deepEqual({ ...c.db.prepare("SELECT sort_title,sort_key FROM search_doc WHERE kind='work' AND ref=?").get(moonlight) }, {
    sort_title: "piano sonata no 14 in c sharp minor op 27 no 2",
    sort_key: "op:000027:000002",
  });
  assert.match(c.db.prepare("SELECT stamp FROM search_state").get().stamp, /^v4\|/);
  // Period filter from a pinned field.
  assert.deepEqual(searchCatalogue(c, { q: "sonata", filters: { period: ["classical"] }, kinds: ["work"] }).sections[0].items.map((i) => i.ref), [moonlight]);
  // Two different recordings of the sonata stay two.
  assert.equal(searchCatalogue(c, { q: "moonlight", kinds: ["recording"] }).sections[0].total, 2);
});

test("the index is rebuilt only when the catalogue changes, and edits are found", async (t) => {
  const { c, moonlight } = await library(t);
  assert.equal(ensureSearchIndex(c).rebuilt, true);
  assert.equal(ensureSearchIndex(c).rebuilt, false);
  new Metadata(c).manual(moonlight, "aliases", ["Mondscheinsonate"], { actor: "test", pin: true });
  assert.equal(searchCatalogue(c, { q: "mondscheinsonate" }).best.ref, moonlight);
  assert.equal(searchCatalogue(c, { q: "" }).total, 0);
});

test("search answers within 300 ms on a 10,000-track index", async (t) => {
  resetGeneration();
  const c = await setup(t);
  const composers = ["Ludwig van Beethoven", "Wolfgang Amadeus Mozart", "Franz Schubert", "Johannes Brahms", "Antonín Dvořák", "Pyotr Ilyich Tchaikovsky", "Johann Sebastian Bach", "Frédéric Chopin"];
  const tracks = [];
  for (let a = 0; tracks.length < 10000; a++) {
    const composer = composers[a % composers.length];
    tracks.push(...album(`a${a}`, `Symphony No. ${(a % 40) + 1} in C minor, Op. ${a % 400}`, ["I. Allegro", "II. Andante", "III. Menuetto", "IV. Finale"], { composer, artist: `Orchestra ${a % 300}; Conductor ${a % 150}`, durations: [0, 1, 2, 3].map((i) => 240000 + ((a * 7919 + i * 104729) % 200000)) }));
  }
  scan(c, tracks.slice(0, 10000));
  const built = ensureSearchIndex(c);
  const owned = c.db.prepare("SELECT count(*) AS n FROM track_link WHERE state='active'").get().n;
  console.log(`index: ${owned} tracks, ${built.docs} documents`, c.db.prepare("SELECT kind,count(*) AS n FROM search_doc GROUP BY kind").all());
  assert.equal(owned, 10000);
  const times = [];
  for (const q of ["symphony 12 brahms", "Op. 27", "tchaikovsky", "orchestra 17 andante", "dvorak symphony", "allegro"]) {
    const result = searchCatalogue(c, { q });
    assert.equal(result.index.rebuilt, false);
    times.push(result.ms);
  }
  const filtered = searchCatalogue(c, { q: "symphony", filters: { composer: [searchCatalogue(c, { q: "brahms", kinds: ["composer"] }).sections[0].items[0].ref] } });
  times.push(filtered.ms);
  console.log(`search on ${built.docs} documents (build ${Math.round(built.ms)} ms): ${times.join(", ")} ms`);
  assert.ok(Math.max(...times) < 300, `slowest search ${Math.max(...times)} ms`);
});

test("the editor's Search tab lists ranked results that open their entries", async (t) => {
  const { c, moonlight } = await library(t);
  const { renderV2 } = await import("../src/model/editor-v2.js");
  ensureSearchIndex(c);
  const page = renderV2(c, { tab: "search", q: "op 27 no 2" }, "r");
  assert.equal(page.tab, "search");
  assert.equal(page.list.items[0].selection, moonlight);
  assert.equal(page.list.items[0].badge.label, "Work");
  assert.ok(page.list.items.some((item) => item.badge.label === "Recording" && item.selection === moonlight));
  assert.ok(page.list.items.some((item) => item.badge.label === "Album" && item.selection.startsWith("album:")));
  assert.deepEqual(renderV2(c, { tab: "search", q: "" }, "r").list.items, []);
});

test("the work page lists one entry per recording, with its releases, parts and movements", async (t) => {
  const { c, moonlight } = await library(t);
  const { renderWork } = await import("../src/model/presentation.js");
  const realizations = realizationsOf(c, moonlight);
  // A user's pick of the box-set copy points at the recording shown.
  const box = c.db.prepare("SELECT id FROM realization WHERE work_id=? AND label='Album levit-box'").get(moonlight).id;
  c.db.prepare("INSERT INTO user_work_state VALUES (7,?,0,?,?)").run(moonlight, box, Date.now());
  const view = renderWork(c, moonlight, { id: 7, role: "user" });
  assert.equal(realizations.length, 3);
  assert.equal(view.recordings.length, 2, "Levit's two releases are one recording");
  const levit = view.recordings.find((r) => r.releases.length === 2);
  assert.deepEqual(levit.releases.map((r) => r.album).sort(), ["Album levit", "Album levit-box"]);
  assert.equal(levit.performer, "Igor Levit");
  assert.equal(view.pickedRealizationId, levit.id);
  assert.equal(view.pickScope, "user");
  const barenboim = view.recordings.find((r) => r.performer === "Daniel Barenboim");
  assert.deepEqual(barenboim.parts.map((p) => p.durationMs), [360000, 140000, 420000]);
  assert.equal(barenboim.durationMs, 920000);
  assert.ok(barenboim.complete);
  assert.deepEqual(barenboim.items.map((i) => i.movementIds.length), [1, 1, 1]);
  assert.deepEqual(barenboim.items.map((i) => i.movementIds[0]), view.work.movements.map((m) => m.id));

  // The grouping is stored: it holds when the tags stop saying so, and an
  // admin's unlink holds through later matching until they link it again.
  const performanceOf = (realization) =>
    c.db.prepare("SELECT pw.source_id AS p FROM realization r JOIN relation pw ON pw.id=r.performance_work_id WHERE r.id=?").get(realization).p;
  const [first, second] = levit.releases.map((release) => performanceOf(release.realizationId));
  const links = () => c.db.prepare("SELECT count(*) AS n FROM relation WHERE kind='same_recording'").get().n;
  const entries = () => renderWork(c, moonlight, { id: 7, role: "user" }).recordings.length;
  assert.equal(links(), 1);
  const boxMbids = (value) =>
    c.db.prepare("UPDATE track_link SET evidence=json_set(evidence,'$.hints.recordingMbid',?) WHERE CAST(json_extract(evidence,'$.albumId') AS TEXT)='levit-box'").run(value);
  boxMbids("retagged");
  assert.equal(entries(), 2, "a stored link outlasts the tags");
  boxMbids("l1");
  unlinkReissue(c, first, second, "admin");
  assert.equal(entries(), 3);
  autoMatchTaggedWorks(c, { actor: "admin", allowStructuredTitles: true });
  assert.deepEqual([links(), entries()], [0, 3], "matching never links a pair an admin took apart");
  assert.equal(searchCatalogue(c, { q: "moonlight levit", kinds: ["recording"] }).sections[0].total, 2);
  relinkReissue(c, first, second, "admin");
  assert.deepEqual([links(), entries()], [1, 2]);
});

test("Classical Library lists browse one kind each, sorted and filtered", async (t) => {
  const { c, moonlight, barenboim, karajan } = await library(t);
  ensureSearchIndex(c);
  const rows = (view) => view.sections.find((s) => s.type === "rows")?.rows || [];
  const labels = (view) => rows(view).map((row) => row.label);
  const composers = listView(c, "composer");
  assert.equal(composers.title, "Composers");
  assert.equal(composers.sections[0].subtitle, "3 composers");
  assert.deepEqual(labels(composers), ["Antonín Dvořák", "Johann Sebastian Bach", "Ludwig van Beethoven"]);
  assert.equal(rows(composers)[0].link.pageId, "classical");
  assert.match(rows(composers)[0].link.resourceId, /^composer:/);
  // Works: by title, or by catalogue number.
  const works = listView(c, "work");
  assert.deepEqual(labels(works), ["Cello Suite No. 1 in G major, BWV 1007", "Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2", "Symphony No. 9 in E minor, Op. 95"]);
  assert.deepEqual(rows(works).find((row) => row.id === moonlight).link, { type: "resource", pageId: "work", resourceId: moonlight });
  assert.deepEqual(labels(listView(c, "work", { sort: "catalogue" })), ["Cello Suite No. 1 in G major, BWV 1007", "Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2", "Symphony No. 9 in E minor, Op. 95"]);
  assert.deepEqual(works.sections.find((s) => s.type === "sort").options.map((o) => o.value), ["title", "catalogue", "date"]);
  // Conductors are people credited as conductors; ensembles are not performers.
  const conductors = listView(c, "conductor");
  assert.deepEqual(rows(conductors).map((row) => row.link.resourceId).sort(), [`person:${barenboim}`, `person:${karajan}`].sort());
  assert.ok(labels(listView(c, "performer")).includes("Igor Levit"));
  for (const label of labels(listView(c, "performer"))) assert.ok(!/Philharmoniker|Orchestra/.test(label), label);
  // Filters and a query narrow a list; a query adds "Best match".
  const beethoven = rows(composers).find((row) => row.label === "Ludwig van Beethoven").link.resourceId.slice("composer:".length);
  assert.deepEqual(labels(listView(c, "work", { filters: { composer: [beethoven] } })), ["Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2"]);
  const recordings = listView(c, "recording", { q: "Barenboim" });
  assert.equal(recordings.sections.find((s) => s.type === "sort").active, "relevance");
  assert.equal(rows(recordings).length, 2);
  assert.ok(listView(c, "recording").sections.find((s) => s.type === "filters").filters.some((f) => f.key === "conductor"));
  assert.equal(listView(c, "work", { q: "no such work" }).sections.at(-1).message, "No works match.");
  assert.throws(() => listView(c, "nothing"), /No Classical list/);
});

test("Classical Library lists show 100 rows a page", async (t) => {
  resetGeneration();
  const c = await setup(t);
  const tracks = [];
  for (let a = 0; a < 230; a++) tracks.push(...album(`p${a}`, `Prelude No. ${a + 1} in C major, Op. ${1000 + a}`, ["I. Prelude", "II. Fugue"], { composer: "Paging Composer", artist: "Pianist" }));
  scan(c, tracks);
  ensureSearchIndex(c);
  const at = (page) => listView(c, "work", { page, sort: "catalogue" });
  const first = at(0);
  assert.equal(first.sections[0].subtitle, "230 works");
  assert.equal(first.sections.find((s) => s.type === "rows").rows.length, 100);
  assert.deepEqual(first.sections.at(-1), { type: "pager", total: 230, offset: 0, limit: 100 });
  const last = at(2);
  const lastRows = last.sections.find((s) => s.type === "rows").rows;
  assert.equal(lastRows.length, 30);
  assert.equal(lastRows.at(-1).label, "Prelude No. 230 in C major, Op. 1229");
  assert.equal(at(1).sections.find((s) => s.type === "rows").rows[0].label, "Prelude No. 101 in C major, Op. 1100");
  assert.deepEqual(at(2).sections.at(-1), { type: "pager", total: 230, offset: 200, limit: 100 });
  // By title, "Prelude No. 10" sorts as words, not numbers; by catalogue, Op. 1009 follows Op. 1008.
  assert.equal(listView(c, "work", { sort: "catalogue" }).sections.find((s) => s.type === "rows").rows[9].label, "Prelude No. 10 in C major, Op. 1009");
  assert.equal(at(9).sections.find((s) => s.type === "empty").message, "No more works.");
});
