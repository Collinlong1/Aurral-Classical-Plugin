// Performer credits derived from tags (v0.3 Phase 1.4): who plays, in which
// role, on records the editor can correct. Admins' credits always win.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { contributorFor, contributorIndex, deriveCredits, performerNames, trackCredits } from "../src/model/contributors.js";
import { renderWork } from "../src/model/presentation.js";

async function catalogueWith(t, albums) {
  const folders = await tempFolders();
  const c = await openCatalogue(folders.dataFolder);
  t.after(async () => {
    try {
      c.close();
    } catch {}
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const tracks = albums.flatMap(({ id, artist, titles, hints = {} }) =>
    titles.map((entry, i) => ({
      coreId: `${id}-${i}`,
      fileId: `${id}-${i}`,
      path: `/library/${id}/${i}.flac`,
      size: 1000,
      durationMs: 60000,
      fingerprint: `audio-sha256-v2:${id}-${i}`,
      albumId: id,
      hints: { album: id, albumArtist: artist, artist, genres: ["Classical"], work: "", trackNumber: i + 1, discNumber: 1, ...hints, ...(typeof entry === "string" ? { title: entry } : entry) },
    })),
  );
  for (const row of reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: 1, tracks })) classify(c, row.id, row.hints);
  return c;
}
const match = (c, albumId = null) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
const credits = (c, albumId) =>
  c.db
    .prepare(
      `SELECT DISTINCT k.id,k.role,k.instrument,k.source,k.state,e.kind,e.data,a.value AS name FROM credit k
       JOIN entity e ON e.id=k.contributor_id
       JOIN metadata_target m ON m.entity_id=k.contributor_id JOIN field_resolution f ON f.target_id=m.id AND f.field='name' JOIN assertion a ON a.id=f.assertion_id
       JOIN relation pw ON pw.source_id=k.target_id AND pw.kind='performance_work' JOIN realization r ON r.performance_work_id=pw.id
       JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
       WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY k.position`,
    )
    .all(albumId)
    .map((row) => ({ name: JSON.parse(row.name), kind: row.kind, role: row.role, instrument: row.instrument, source: row.source, state: row.state, unreviewed: JSON.parse(row.data).unreviewed === true, id: row.id }));
const beethoven = (movement) => ({ title: `Symphony No. 5 in C minor, Op. 67: ${movement}`, composer: ["Ludwig van Beethoven"] });
const fifth = ["I. Allegro con brio", "II. Andante con moto", "III. Allegro", "IV. Allegro"].map(beethoven);

test("tags name who plays: performers with instruments, a conductor, ensembles by their own names", () => {
  // The split shared with search and the album page, composers left out.
  assert.deepEqual(performerNames({ artist: "Ludwig van Beethoven — Igor Levit", composer: ["Ludwig van Beethoven"] }), ["Igor Levit"]);
  const role = (hints) => trackCredits(hints).map((credit) => [credit.name, credit.kind, credit.role, credit.instrument]);
  assert.deepEqual(role({ artist: "Berliner Philharmoniker; Herbert von Karajan", conductor: "Herbert von Karajan" }), [
    ["Herbert von Karajan", "person", "conductor", null],
    ["Berliner Philharmoniker", "ensemble", "orchestra", null],
  ]);
  // PERFORMER tags win over the artist tag and carry the instrument.
  assert.deepEqual(role({ artist: "Argerich; Freire", performers: ["Martha Argerich (piano)", "Nelson Freire (piano)"] }), [
    ["Martha Argerich", "person", "performer", "piano"],
    ["Nelson Freire", "person", "performer", "piano"],
  ]);
  assert.deepEqual(role({ artist: "Monteverdi Choir; English Baroque Soloists" }).map(([name, , r]) => [name, r]), [
    ["Monteverdi Choir", "choir"],
    ["English Baroque Soloists", "ensemble"],
  ]);
  // A list of names splits; a name with a comma in it does not.
  assert.deepEqual(role({ artist: "Wiener Philharmoniker, Karl Böhm" }).map(([name, kind]) => [name, kind]), [
    ["Wiener Philharmoniker", "ensemble"],
    ["Karl Böhm", "person"],
  ]);
  assert.deepEqual(role({ artist: "Choir of King's College, Cambridge" }).map(([name, kind, r]) => [name, kind, r]), [["Choir of King's College, Cambridge", "ensemble", "choir"]]);
  // Without a role in the tags, a person simply performs.
  assert.deepEqual(role({ artist: "Glenn Gould" }), [["Glenn Gould", "person", "performer", null]]);
});

test("matching derives performer credits once, as unreviewed records, and reuses one record per name", async (t) => {
  const c = await catalogueWith(t, [
    { id: "karajan", artist: "Berliner Philharmoniker; Herbert von Karajan", titles: fifth, hints: { conductor: "Herbert von Karajan" } },
    { id: "kleiber", artist: "Wiener Philharmoniker; Carlos Kleiber", titles: fifth },
  ]);
  match(c, "karajan");
  match(c, "kleiber");
  const view = (albumId) => credits(c, albumId).map(({ name, kind, role, source, unreviewed }) => [name, kind, role, source, unreviewed]);
  assert.deepEqual(view("karajan"), [
    ["Herbert von Karajan", "person", "conductor", "derived", true],
    ["Berliner Philharmoniker", "ensemble", "orchestra", "derived", true],
  ]);
  // No conductor tag: Kleiber is a performer, never a guessed conductor.
  assert.deepEqual(view("kleiber"), [
    ["Wiener Philharmoniker", "ensemble", "orchestra", "derived", true],
    ["Carlos Kleiber", "person", "performer", "derived", true],
  ]);
  // The work page lists them.
  const work = c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").get().id;
  assert.deepEqual(renderWork(c, work, { id: 1, role: "user" }).recordings.map((r) => r.label).sort(), [
    "Herbert von Karajan, Berliner Philharmoniker · karajan",
    "Wiener Philharmoniker, Carlos Kleiber · kleiber",
  ]);
  // Rescans and the library pass add nothing more.
  const count = () => c.db.prepare("SELECT count(*) AS n FROM credit WHERE source='derived'").get().n;
  const before = count();
  match(c);
  match(c, "karajan");
  assert.equal(count(), before);
  assert.equal(deriveCredits(c), 0);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind IN ('person','ensemble') AND json_extract(data,'$.unreviewed')=1").get().n, 4);
});

test("derivation never touches an admin's credits and never brings back one an admin removed", async (t) => {
  const c = await catalogueWith(t, [
    { id: "removed", artist: "Glenn Gould", titles: fifth },
    { id: "manual", artist: "Wilhelm Kempff", titles: fifth },
  ]);
  match(c, "removed");
  const [gould] = credits(c, "removed");
  assert.equal(gould.name, "Glenn Gould");
  c.removeCredit(gould.id);
  match(c);
  match(c, "removed");
  assert.deepEqual(credits(c, "removed").map(({ name, state }) => [name, state]), [["Glenn Gould", "removed"]]);

  // An admin replaces the second album's derived credit with their own.
  const metadata = new Metadata(c);
  const pianist = c.createEntity("person");
  metadata.manual(pianist, "name", "Wilhelm Backhaus", { actor: "admin" });
  match(c, "manual");
  const [derived] = credits(c, "manual");
  c.removeCredit(derived.id);
  const performance = c.db.prepare("SELECT target_id FROM credit WHERE id=?").get(derived.id).target_id;
  c.credit(performance, pianist, "soloist");
  match(c);
  assert.deepEqual(credits(c, "manual").map(({ name, role, source, state }) => [name, role, source, state]), [
    ["Wilhelm Kempff", "performer", "derived", "removed"],
    ["Wilhelm Backhaus", "soloist", "manual", "active"],
  ]);
});

test("tracks that disagree get the credits every track names; composers and same-named people are reused or left alone", async (t) => {
  const c = await catalogueWith(t, [
    {
      id: "mixed",
      artist: "",
      titles: fifth.map((track, i) => ({ ...track, artist: i === 1 ? "Staatskapelle Dresden; Guest Soloist" : "Staatskapelle Dresden" })),
    },
    {
      id: "rach",
      artist: "Sergei Rachmaninoff",
      titles: ["I. Moderato", "II. Adagio sostenuto", "III. Allegro scherzando"].map((m) => ({
        title: `Piano Concerto No. 2 in C minor, Op. 18: ${m}`,
        composer: ["Sergei Rachmaninoff"],
        performers: ["Sergei Rachmaninoff (piano)", "Philadelphia Orchestra"],
      })),
    },
  ]);
  match(c, "mixed");
  assert.deepEqual(credits(c, "mixed").map(({ name, role }) => [name, role]), [["Staatskapelle Dresden", "orchestra"]]);
  match(c, "rach");
  // The composer at the piano is one person.
  const people = contributorIndex(c).person.get("sergei rachmaninoff");
  assert.equal(people.length, 1);
  assert.deepEqual(c.db.prepare("SELECT DISTINCT role FROM credit WHERE contributor_id=? ORDER BY role").all(people[0]).map((row) => row.role), ["composer", "performer"]);
  assert.deepEqual(
    credits(c, "rach").map(({ name, role, instrument }) => [name, role, instrument]),
    [
      ["Sergei Rachmaninoff", "performer", "piano"],
      ["Philadelphia Orchestra", "orchestra", null],
    ],
  );

  // Two records already share a name: neither is guessed.
  const metadata = new Metadata(c);
  for (let i = 0; i < 2; i++) {
    const id = c.createEntity("person");
    metadata.manual(id, "name", "John Williams", { actor: "admin" });
  }
  const index = contributorIndex(c);
  assert.equal(contributorFor(c, index, "John Williams"), null);
  // A MusicBrainz artist ID names its holder whatever the name.
  const held = contributorFor(c, index, "J. Williams", { mbid: "jw-guitar" });
  assert.equal(contributorFor(c, contributorIndex(c), "John Christopher Williams", { mbid: "jw-guitar" }), held);
});

test("accompanist is a role for a person, not an ensemble", async (t) => {
  const c = await catalogueWith(t, []);
  const metadata = new Metadata(c);
  const work = c.createEntity("work");
  const pianist = c.createEntity("person");
  metadata.manual(pianist, "name", "Gerald Moore", { actor: "admin" });
  const quartet = c.createEntity("ensemble");
  metadata.manual(quartet, "name", "Fixture Quartet", { actor: "admin" });
  assert.ok(c.credit(work, pianist, "accompanist"));
  assert.throws(() => c.credit(work, quartet, "accompanist"), /Invalid role/);
});

test("identity: composer and performer of one name are one person; an artist ID wins; another ID is someone else", async (t) => {
  const chopin = ["I. Grave – Doppio movimento", "II. Scherzo", "III. Marche funèbre", "IV. Finale"].map((m) => ({
    title: `Piano Sonata No. 2 in B-flat minor, Op. 35: ${m}`,
    composer: ["Frédéric Chopin"],
  }));
  const rachmaninoff = ["I. Moderato", "II. Adagio sostenuto", "III. Allegro scherzando"].map((m) => ({
    title: `Piano Concerto No. 2 in C minor, Op. 18: ${m}`,
    composer: ["Sergei Rachmaninoff"],
  }));
  const c = await catalogueWith(t, [
    // Rachmaninoff plays Chopin before any of his own works is matched.
    { id: "plays", artist: "Sergei Rachmaninoff", titles: chopin },
    { id: "own", artist: "Philadelphia Orchestra", titles: rachmaninoff },
    // Two John Williamses (the guitarist and the composer), each album
    // tagged with its artist's own ID.
    { id: "jw1", artist: "John Williams", titles: fifth, hints: { artistMbids: ["jw-guitar"] } },
    { id: "jw2", artist: "John Williams", titles: fifth, hints: { artistMbids: ["jw-composer"] } },
    { id: "jw3", artist: "Johnny Williams", titles: fifth, hints: { artistMbids: ["jw-composer"] } },
    // Two names, one ID: whose it is is a guess, so none is used.
    { id: "pair", artist: "Martha Argerich; Nelson Freire", titles: fifth, hints: { artistMbids: ["only-one"] } },
  ]);
  for (const album of ["plays", "own", "jw1", "jw2", "jw3", "pair"]) match(c, album);
  const people = (name) => contributorIndex(c).person.get(name) || [];
  // One Rachmaninoff, credited as the pianist and as the composer.
  assert.equal(people("sergei rachmaninoff").length, 1);
  assert.deepEqual(
    c.db.prepare("SELECT DISTINCT role FROM credit WHERE contributor_id=? AND state='active' ORDER BY role").all(people("sergei rachmaninoff")[0]).map((row) => row.role),
    ["composer", "performer"],
  );
  // Two John Williamses: the first gained its ID, the second is a new record
  // an admin is asked about; "Johnny Williams" carries the second's ID.
  const williams = people("john williams");
  assert.equal(williams.length, 2);
  const idOf = (id) => c.db.prepare("SELECT record_id FROM external_identity WHERE entity_id=? AND record_kind='artist'").get(id)?.record_id;
  assert.deepEqual(williams.map(idOf), ["jw-guitar", "jw-composer"]);
  assert.equal(credits(c, "jw3")[0].name, "John Williams");
  assert.deepEqual(
    c.db.prepare("SELECT target_id,json_extract(evidence,'$.reason') AS reason FROM review_item WHERE kind='contributor_identity' AND status='open'").all().map((row) => [row.target_id, row.reason]),
    [[williams[1], "same-name-different-id"]],
  );
  assert.deepEqual(people("martha argerich").map(idOf), [undefined]);
  assert.deepEqual(people("nelson freire").map(idOf), [undefined]);
});

test("a name mapped to a known contributor: later albums with that spelling land on them", async (t) => {
  const { mergeContributor } = await import("../src/model/auto-match.js");
  const c = await catalogueWith(t, [
    { id: "first", artist: "S. Richter", titles: fifth },
    { id: "second", artist: "S. Richter", titles: fifth.map((track) => ({ ...track, title: track.title.replace("Symphony No. 5", "Symphony No.5") })) },
  ]);
  const metadata = new Metadata(c);
  const richter = c.createEntity("person");
  metadata.manual(richter, "name", "Sviatoslav Richter", { actor: "admin" });
  match(c, "first");
  const [derived] = credits(c, "first");
  assert.equal(derived.name, "S. Richter");
  const spelled = c.db.prepare("SELECT contributor_id AS id FROM credit WHERE id=?").get(derived.id).id;
  // What the editor's "This is…" does.
  mergeContributor(c, richter, spelled, "admin");
  match(c, "second");
  const landed = c.db.prepare("SELECT DISTINCT contributor_id AS id FROM credit WHERE state='active' AND role='performer'").all().map((row) => row.id);
  assert.deepEqual(landed, [richter]);
  assert.deepEqual(contributorIndex(c).person.get("s richter"), [richter]);
});
