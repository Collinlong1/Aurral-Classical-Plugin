import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { searchCatalogue, ensureSearchIndex } from "../src/search/engine.js";
import { catalogueKeys, parseQuery } from "../src/search/normalize.js";

async function setup(t) {
  const folders = await tempFolders();
  const c = await openCatalogue(folders.dataFolder);
  t.after(async () => {
    try {
      c.close();
    } catch {}
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  return c;
}

let generation = 0;
function album(albumId, work, movements, { composer, artist, durations = [], mbids = [], extra = {} }) {
  return movements.map((title, i) => ({
    coreId: `${albumId}-${i}`,
    fileId: `${albumId}-${i}`,
    path: `/library/${albumId}/${i}.flac`,
    size: 1000,
    durationMs: durations[i] ?? 300000 + i * 1000,
    fingerprint: `audio-sha256-v2:${albumId}-${i}`,
    albumId,
    hints: {
      title: `${work}: ${title}`,
      album: `Album ${albumId}`,
      artist,
      composer: [composer],
      work: `${work}: ${title}`,
      trackNumber: i + 1,
      discNumber: 1,
      genres: ["Classical"],
      recordingMbid: mbids[i] || "",
      ...extra,
    },
  }));
}
function scan(c, tracks) {
  if (!generation) c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const rows = reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: ++generation, tracks });
  for (const row of rows) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c, { actor: "test" });
}
const workId = (c, like) => c.db.prepare("SELECT f.target_id AS id FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id JOIN entity e ON e.id=f.target_id WHERE e.kind='work' AND e.deleted_at IS NULL AND f.field='title' AND a.value LIKE ?").get(`%${like}%`)?.id;
const realizationsOf = (c, work) => c.db.prepare("SELECT id,performance_work_id FROM realization WHERE work_id=? ORDER BY label").all(work);

const MOONLIGHT = "Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2";
const SONATA = ["I. Adagio sostenuto", "II. Allegretto", "III. Presto agitato"];
async function library(t) {
  generation = 0;
  const c = await setup(t);
  scan(c, [
    ...album("levit", MOONLIGHT, SONATA, { composer: "Ludwig van Beethoven", artist: "Igor Levit", mbids: ["l1", "l2", "l3"] }),
    // The same Levit recording on a second release (a box set).
    ...album("levit-box", MOONLIGHT, SONATA, { composer: "Ludwig van Beethoven", artist: "Igor Levit", mbids: ["l1", "l2", "l3"] }),
    ...album("barenboim", MOONLIGHT, SONATA, { composer: "Ludwig van Beethoven", artist: "Daniel Barenboim", durations: [360000, 140000, 420000] }),
    ...album("ma", "Cello Suite No. 1 in G major, BWV 1007", ["I. Prélude", "II. Allemande"], { composer: "Johann Sebastian Bach", artist: "Yo-Yo Ma" }),
    ...album("dvorak", "Symphony No. 9 in E minor, Op. 95", ["I. Adagio – Allegro molto", "II. Largo"], { composer: "Antonín Dvořák", artist: "Berliner Philharmoniker; Herbert von Karajan" }),
    ...album("dvorak-db", "Symphony No. 9 in E minor, Op. 95", ["I. Adagio – Allegro molto", "II. Largo"], { composer: "Antonín Dvořák", artist: "Chicago Symphony Orchestra; Daniel Barenboim" }),
  ]);
  const m = new Metadata(c);
  const moonlight = workId(c, "Piano Sonata No. 14");
  m.manual(moonlight, "nickname", "Moonlight", { actor: "test", pin: true });
  m.manual(moonlight, "aliases", ["Sonata quasi una fantasia"], { actor: "test", pin: true });
  m.manual(moonlight, "period", "Classical", { actor: "test", pin: true });
  // Credits: Barenboim plays the sonata and conducts the symphony.
  const person = (name) => {
    const id = c.createEntity("person");
    m.manual(id, "name", name, { actor: "test" });
    return id;
  };
  const barenboim = person("Daniel Barenboim");
  const karajan = person("Herbert von Karajan");
  const levit = person("Igor Levit");
  const credit = (album, contributor, role) => {
    const realization = c.db.prepare("SELECT r.performance_work_id FROM realization r WHERE r.label=?").get(`Album ${album}`);
    const performance = c.db.prepare("SELECT source_id FROM relation WHERE id=?").get(realization.performance_work_id).source_id;
    c.credit(performance, contributor, role);
  };
  credit("barenboim", barenboim, "soloist");
  credit("dvorak-db", barenboim, "conductor");
  credit("dvorak", karajan, "conductor");
  credit("levit", levit, "soloist");
  credit("levit-box", levit, "soloist");
  return { c, moonlight, barenboim, karajan };
}

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
  const { c, moonlight, barenboim, karajan } = await library(t);
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
  generation = 0;
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
  const page = renderV2(c, { tab: "search", q: "op 27 no 2" }, "r");
  assert.equal(page.tab, "search");
  assert.equal(page.list.items[0].selection, moonlight);
  assert.equal(page.list.items[0].badge.label, "Work");
  assert.ok(page.list.items.some((item) => item.badge.label === "Recording" && item.selection === moonlight));
  assert.ok(page.list.items.some((item) => item.badge.label === "Album" && item.selection.startsWith("album:")));
  assert.deepEqual(renderV2(c, { tab: "search", q: "" }, "r").list.items, []);
});
