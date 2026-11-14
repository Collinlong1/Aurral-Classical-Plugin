// Regressions for messy-tag matching: composers read from mixed artist
// fields, comma-separated movements, colon-before-quote titles and opera
// headings with and without a catalogue number. Each test fails on the
// source before these fixes.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tempFolders } from "./helpers.js";
import { artistCredits, composersOf } from "../src/model/credits.js";
import { classificationEvidence } from "../src/model/classify-evidence.js";
import { recordTaggedLeaves, splitTitle, stripWorkPrefix, autoMatchTaggedWorks, withoutComposer, mapToMovements, movementParts, catalogueSubject, workKey, mergeWork, provablyDifferent } from "../src/model/auto-match.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { renderAlbumPresentation, renderWork } from "../src/model/presentation.js";
import { renderV2 } from "../src/model/editor-v2.js";
import { autoMatchLibrary } from "../src/model/runtime.js";
import path from "node:path";

const decide = (hints) => classificationEvidence(hints).decision;

test("credits: a composer beside the performers is read only with corroboration", () => {
  const smetana = {
    title: "Má Vlast - 2. Vltava",
    album: "Smetana: Má Vlast",
    albumArtist: "Vienna Philharmonic & James Levine",
    artist: "Bedřich Smetana; Vienna Philharmonic & James Levine",
    composer: [],
  };
  assert.deepEqual(artistCredits(smetana), {
    composers: ["Bedřich Smetana"],
    performers: ["Vienna Philharmonic & James Levine"],
    confidence: "high",
    evidence: ["album title"],
  });
  // Corroborated by the catalogue system instead of the album title.
  assert.equal(
    artistCredits({ title: "Partita No. 2, BWV 1004: Chaconne", album: "Recital", albumArtist: "Hilary Hahn", artist: "Johann Sebastian Bach; Hilary Hahn" })?.confidence,
    "high",
  );
  // A composer beside a soloist: the one the album names is the composer.
  assert.deepEqual(
    artistCredits({ title: "Messiah, HWV 56: Comfort ye", album: "Handel: Messiah", albumArtist: "The Choir of King's College", artist: "George Frideric Handel; Allan Clayton" })?.composers,
    ["George Frideric Handel"],
  );
  // Nothing else names him: medium, which never makes a work.
  const nutcracker = { title: "The Nutcracker - Overture", album: "The Nutcracker", albumArtist: "Royal Philharmonic Orchestra", artist: "Pyotr Ilyich Tchaikovsky; Royal Philharmonic Orchestra" };
  assert.equal(artistCredits(nutcracker)?.confidence, "medium");
  assert.deepEqual(composersOf(nutcracker), []);
  // ...unless the library already credits him as a composer.
  assert.equal(artistCredits(nutcracker, { knownComposers: new Set(["pyotr ilyich tchaikovsky"]) })?.confidence, "high");
  // A tagged composer always wins; no inference.
  assert.equal(artistCredits({ ...smetana, composer: ["Bedřich Smetana"] }), null);
});

test("credits: performers are never read as composers", () => {
  // The album's own artist, ensembles, name lists and repeated names perform.
  assert.equal(artistCredits({ artist: "Glenn Gould; Glenn Gould", albumArtist: "", album: "Bach" }), null);
  assert.equal(artistCredits({ artist: "Steve Reich; Steve Reich", albumArtist: "Steve Reich Ensemble", album: "Music for 18 Musicians" }), null);
  assert.equal(artistCredits({ artist: "Berliner Philharmoniker; Herbert von Karajan & Anne-Sophie Mutter", albumArtist: "" }), null);
  // Two uncorroborated people: nobody is chosen.
  assert.equal(artistCredits({ artist: "Alice Coote; Allan Clayton", albumArtist: "The Choir", album: "Messiah" }), null);
  // A pop album with a featured guest: the guest is at most a medium
  // candidate, and classification stays not classical with a popular genre.
  const pop = { title: "Crazy in Love", album: "Beyoncé: Dangerously in Love", albumArtist: "Beyoncé", artist: "Beyoncé; Jay-Z", genres: ["R&B"] };
  assert.notEqual(artistCredits(pop)?.confidence, "high");
  assert.equal(decide(pop), "not_classical");
  assert.deepEqual(composersOf({ artist: "Single Name Only" }), []);
});

test("classification: a corroborated artist-field composer and wider catalogue systems count", () => {
  // Before: "unsure" (only the album named a composer).
  assert.equal(
    decide({ title: "Má Vlast - 1. Vysehrad", album: "Smetana: Má Vlast", albumArtist: "Vienna Philharmonic & James Levine", artist: "Bedřich Smetana; Vienna Philharmonic & James Levine", composer: [], genres: [] }),
    "classical",
  );
  // Uncorroborated: reviewable, not dismissed.
  assert.equal(decide({ title: "Scene I", album: "The Nutcracker", albumArtist: "Royal Philharmonic Orchestra", artist: "Pyotr Ilyich Tchaikovsky; Royal Philharmonic Orchestra", composer: [], genres: [] }), "unsure");
  // Wagner's WWV and comma-anchored single-letter systems are catalogue numbers.
  const strong = (title) => classificationEvidence({ title }).signals.some((s) => s.signal === "catalogue number");
  assert.ok(strong("Tristan und Isolde, WWV 90, Act I - Prelude"));
  assert.ok(strong("La Mer, L. 109 - I. De l'aube à midi sur la mer"));
  assert.ok(strong("Boléro, M. 81"));
  // A disc number in a pop title is not one; nor is a bare initial.
  assert.ok(!strong("Greatest Hits, CD 1"));
  assert.ok(!strong("M. Ward Live"));
});

test("titles: comma-separated movements and colon-before-quote headings split", () => {
  assert.deepEqual(splitTitle("Violin Sonata No. 1 in G Minor, BWV1001, II. Fuga - Allegro"), {
    head: "Violin Sonata No. 1 in G Minor, BWV1001",
    tail: "II. Fuga - Allegro",
  });
  assert.deepEqual(splitTitle("Winterreise, D. 911, I. Gute Nacht"), { head: "Winterreise, D. 911", tail: "I. Gute Nacht" });
  assert.equal(stripWorkPrefix("Violin Sonata No. 1 in G Minor, BWV1001, II. Fuga - Allegro", "Violin Sonata No. 1 in G Minor, BWV1001"), "II. Fuga - Allegro");
  // "L. 103" is a catalogue number, not movement fifty; "Hello, I. Goodbye"
  // doesn't read as a work.
  assert.deepEqual(splitTitle("Sonata in G Major, L. 103"), { head: "", tail: "Sonata in G Major, L. 103" });
  assert.deepEqual(splitTitle("Hello, I. Goodbye"), { head: "", tail: "Hello, I. Goodbye" });
  assert.equal(splitTitle('Carmen, Act 1:"Avec la garde montante" (Enfants)').head, "Carmen, Act 1");
  assert.equal(splitTitle("Piano Sonata, Hob. XVI:52").head, "");
  // A composer before the work, by surname or in full; any other prefix stays.
  const concerto = "Piano Concerto No. 2 in C Minor, Op. 18: I. Moderato";
  assert.equal(withoutComposer(`Rachmaninoff: ${concerto}`, ["Sergei Rachmaninoff"]), concerto);
  assert.equal(withoutComposer(`Sergei Rachmaninoff: ${concerto}`, ["Sergei Rachmaninoff"]), concerto);
  assert.equal(withoutComposer(`Italie: ${concerto}`, ["Franz Liszt"]), `Italie: ${concerto}`);
  // Spelled another way than the composer tag.
  assert.equal(withoutComposer(`Rachmaninoff: ${concerto}`, ["Sergei Rachmaninov"]), concerto);
  assert.equal(withoutComposer("Tschaikowsky: Swan Lake", ["Pyotr Ilyich Tchaikovsky"]), "Swan Lake");
  assert.equal(withoutComposer("Prokofieff: Romeo and Juliet", ["Sergei Prokofiev"]), "Romeo and Juliet");
});

test("matching: a composer-prefixed title matches, and its rows name only the movement", async (t) => {
  const concerto = "Piano Concerto No. 2 in C Minor, Op. 18";
  const movements = ["I. Moderato", "II. Adagio sostenuto", "III. Allegro scherzando"];
  const c = await catalogueWith(t, [
    { id: "untagged", album: "Arrival", albumArtist: "Daniil Trifonov", artist: "Daniil Trifonov", titles: movements.map((m) => ({ title: `Rachmaninoff: ${concerto}: ${m}`, composer: ["Sergei Rachmaninoff"] })) },
    { id: "tagged", album: "Arrival", albumArtist: "Daniil Trifonov", artist: "Daniil Trifonov", titles: movements.map((m) => ({ title: `Rachmaninoff: ${concerto}: ${m}`, work: concerto, composer: ["Sergei Rachmaninoff"] })) },
  ]);
  const rows = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.title, group.items.map((item) => item.title)]);
  // Before matching, the page already reads the movement.
  assert.deepEqual(rows("tagged"), [[concerto, movements]]);
  autoMatchTaggedWorks(c, { albumId: "untagged", actor: "admin", allowStructuredTitles: true });
  assert.deepEqual(rows("untagged"), [[concerto, movements]]);
  const [{ workId, items }] = renderAlbumPresentation(c, "untagged").groups;
  assert.ok(workId);
  // A version before 1.0.17 stored the prefixed title; matching the album
  // again reads it as the movement.
  const movement = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").get(workId).target_id;
  new Metadata(c).derived(movement, "title", `Rachmaninoff: ${concerto}: ${movements[0]}`);
  assert.equal(rows("untagged")[0][1][0], `Rachmaninoff: ${concerto}: ${movements[0]}`);
  autoMatchTaggedWorks(c, { albumId: "untagged", actor: "admin", allowStructuredTitles: true });
  assert.deepEqual(rows("untagged"), [[concerto, movements]]);
  assert.equal(items.length, 3);
});

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
  const tracks = albums.flatMap(({ id, album, albumArtist, artist, titles }) =>
    titles.map((entry, i) => ({
      coreId: `${id}-${i}`,
      fileId: `${id}-${i}`,
      path: `/library/${id}/${i}.flac`,
      size: 1000,
      durationMs: 60000,
      fingerprint: `audio-sha256-v2:${id}-${i}`,
      albumId: id,
      // A title, or a title with its own tags.
      hints: { album, albumArtist, artist, composer: [], genres: [], work: "", trackNumber: i + 1, discNumber: 1, ...(typeof entry === "string" ? { title: entry } : entry) },
    })),
  );
  for (const row of reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: 1, tracks }))
    classify(c, row.id, row.hints);
  return c;
}

test("matching: a corroborated artist-field composer makes a work; an uncorroborated one is reviewed", async (t) => {
  const c = await catalogueWith(t, [
    {
      id: "dvorak",
      album: "Dvořák: Symphony No. 9",
      albumArtist: "Czech Philharmonic",
      artist: "Antonín Dvořák; Czech Philharmonic",
      titles: ["Symphony No. 9 in E Minor, Op. 95 - I. Adagio", "Symphony No. 9 in E Minor, Op. 95 - II. Largo", "Symphony No. 9 in E Minor, Op. 95 - III. Scherzo"],
    },
    {
      id: "guest",
      album: "Late Night Sessions",
      albumArtist: "Some Quartet",
      artist: "Anna Example; Some Quartet",
      titles: ["Suite for Strings, Op. 5 - I. Prelude", "Suite for Strings, Op. 5 - II. Air"],
    },
  ]);
  for (const albumId of ["dvorak", "guest"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const works = c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").all();
  assert.equal(works.length, 1);
  const composer = c.db.prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer'").get(works[0].id).contributor_id;
  assert.equal(JSON.parse(c.db.prepare("SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id WHERE f.target_id=? AND f.field='name'").get(composer).value), "Antonín Dvořák");
  const review = c.db.prepare("SELECT evidence FROM review_item WHERE kind='auto_match' AND status='open'").all().map((row) => JSON.parse(row.evidence));
  assert.ok(review.some((entry) => entry.reason === "uncertain-composer" && entry.albumId === "guest" && entry.composers[0] === "Anna Example"));
  // The editor's Review tab says why, instead of "tracks didn't line up".
  const items = renderV2(c, { tab: "review" }).list.items;
  assert.ok(items.some((item) => /artist field only \(Anna Example\)/.test(item.detail)));
  // The album page names the performer without the composer.
  const page = renderAlbumPresentation(c, "dvorak");
  assert.equal(page.groups[0].items[0].performer, "Czech Philharmonic");
});

test("album page: an opera heads as one work with or without its catalogue number, books stay apart", async (t) => {
  const c = await catalogueWith(t, [
    {
      id: "tristan",
      album: "Wagner: Tristan und Isolde",
      albumArtist: "Bayreuth Festival Orchestra",
      artist: "Richard Wagner; Bayreuth Festival Orchestra",
      titles: ["Tristan und Isolde, WWV 90, Act III: Kurwenal! He!", "Tristan und Isolde, Act III: Hei nun! Wie du kamst?", "Tristan und Isolde, WWV 90, Act III: Noch losch das Licht"],
    },
    {
      id: "ligeti",
      album: "Ligeti: Études",
      albumArtist: "Pierre-Laurent Aimard",
      artist: "György Ligeti; Pierre-Laurent Aimard",
      titles: ["Études, Book 1: No. 6, Automne à Varsovie", "Études, Book 2: No. 13, L'escalier du diable"],
    },
  ]);
  const tristan = renderAlbumPresentation(c, "tristan");
  assert.equal(tristan.groups.length, 1);
  assert.equal(tristan.groups[0].items.length, 3);
  assert.equal(tristan.groups[0].composer, "Richard Wagner");
  // Two different books of études: two blocks (no view by work needed).
  assert.equal(renderAlbumPresentation(c, "ligeti"), null);
});

test("matching: a work whose movements credit different completers is one work", async (t) => {
  const mozart = "Wolfgang Amadeus Mozart";
  const movements = [
    ["Introitus", [mozart, "Franz Xaver Süßmayr"]],
    ["Kyrie", [mozart, "Franz Xaver Süßmayr"]],
    ["Dies irae", [mozart, "Joseph Eybler"]],
    ["Tuba mirum", [mozart, "Joseph Eybler"]],
    ["Rex tremendae", [mozart, "Joseph Eybler"]],
    ["Recordare", [mozart, "Joseph Eybler"]],
    ["Confutatis", [mozart, "Joseph Eybler", "Franz Xaver Süßmayr"]],
    ["Lacrimosa", [mozart, "Franz Xaver Süßmayr", "Joseph Eybler"]],
  ];
  const c = await catalogueWith(t, [
    {
      id: "history",
      album: "The History of Classical Music, Part 2",
      albumArtist: "Various Artists",
      artist: "Various Artists",
      titles: movements.map(([name, composer]) => ({ title: `Requiem in D minor, K 626: ${name}`, composer })),
    },
    {
      id: "unmatched",
      album: "Requiem",
      albumArtist: "Choir",
      artist: "Choir",
      titles: movements.map(([name, composer]) => ({ title: `Requiem in D minor, K 626: ${name}`, composer })),
    },
  ]);
  // Before any match, the album page shows one block too, whatever order
  // the names come in.
  assert.deepEqual(
    renderAlbumPresentation(c, "unmatched").groups.map((group) => [group.composer, group.items.length, group.detail]),
    [[mozart, 8, "Not matched to a work"]],
  );
  autoMatchTaggedWorks(c, { albumId: "history", actor: "admin", allowStructuredTitles: true });
  const works = c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").all();
  assert.equal(works.length, 1);
  const page = renderAlbumPresentation(c, "history");
  assert.deepEqual(page.groups.map((group) => [group.composer, group.items.length]), [[mozart, 8]]);
  // The completers stay credited, on the movements that name them.
  const credited = (name) =>
    c.db
      .prepare(
        `SELECT COUNT(*) AS n FROM credit cr JOIN entity r ON r.id=cr.target_id AND r.kind='recording'
         JOIN field_resolution f ON f.target_id=cr.contributor_id AND f.field='name'
         JOIN assertion a ON a.id=f.assertion_id WHERE cr.role='composer' AND a.value=?`,
      )
      .get(JSON.stringify(name)).n;
  assert.equal(credited("Franz Xaver Süßmayr"), 4);
  assert.equal(credited("Joseph Eybler"), 6);
  // Matching again changes nothing.
  assert.equal(autoMatchTaggedWorks(c, { albumId: "history", actor: "admin", allowStructuredTitles: true }).created, 0);
});

test("matching: a completer split made by earlier matching is repaired, keeping favourites and picks", async (t) => {
  const mozart = "Wolfgang Amadeus Mozart";
  const credits = [
    [mozart, "Franz Xaver Süßmayr"],
    [mozart, "Franz Xaver Süßmayr"],
    [mozart, "Joseph Eybler"],
    [mozart, "Joseph Eybler"],
    [mozart, "Joseph Eybler", "Franz Xaver Süßmayr"],
    [mozart, "Franz Xaver Süßmayr", "Joseph Eybler"],
  ];
  const names = ["Introitus", "Kyrie", "Dies irae", "Tuba mirum", "Confutatis", "Lacrimosa"];
  const c = await catalogueWith(t, [
    {
      id: "split",
      album: "Requiem",
      albumArtist: "Choir",
      artist: "Choir",
      titles: names.map((name, i) => ({ title: `Requiem in D minor, K 626: ${name}`, composer: credits[i] })),
    },
  ]);
  // Earlier matching made one work per credit combination. Reproduce it by
  // matching each combination's tracks on their own, with the works made so
  // far marked as edited, which the repair leaves alone.
  const tracks = c.db.prepare("SELECT id FROM track_link ORDER BY json_extract(evidence,'$.hints.trackNumber')").all().map((row) => row.id);
  const only = (indexes) =>
    tracks.forEach((id, i) => c.db.prepare("UPDATE classification SET state=? WHERE target_id=?").run(indexes.includes(i) ? "classical" : "not_classical", id));
  const live = () => c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL ORDER BY rowid").all().map((row) => row.id);
  const edited = (source) =>
    live().forEach((work) => c.db.prepare("UPDATE assertion SET source=? WHERE target_id=? AND field='title'").run(source, work));
  for (const part of [[0, 1], [2, 3], [4, 5]]) {
    only(part);
    autoMatchTaggedWorks(c, { albumId: "split", actor: "admin", allowStructuredTitles: true });
    edited("manual");
  }
  only([0, 1, 2, 3, 4, 5]);
  const [first, second, third] = live();
  assert.equal(live().length, 3);
  const realizationOf = (work) => c.db.prepare("SELECT id FROM realization WHERE work_id=?").get(work).id;
  c.db.prepare("INSERT INTO user_work_state VALUES (7,?,1,?,?)").run(third, realizationOf(third), Date.now());
  c.db.prepare("INSERT INTO admin_work_pick VALUES (?,?,1,?)").run(second, realizationOf(second), Date.now());
  // Edited works are left alone.
  autoMatchTaggedWorks(c, { albumId: "split", actor: "admin", allowStructuredTitles: true });
  assert.equal(live().length, 3);
  edited("derived");

  autoMatchTaggedWorks(c, { albumId: "split", actor: "admin", allowStructuredTitles: true });
  assert.deepEqual(live(), [first]);
  const page = renderAlbumPresentation(c, "split");
  assert.deepEqual(
    page.groups.map((group) => [group.workId, group.composer, group.items.map((item) => item.title)]),
    [[first, mozart, names]],
  );
  const kept = realizationOf(first);
  assert.deepEqual({ ...c.db.prepare("SELECT favourite,picked_realization_id FROM user_work_state WHERE user_id=7 AND work_id=?").get(first) }, { favourite: 1, picked_realization_id: kept });
  assert.equal(c.db.prepare("SELECT realization_id FROM admin_work_pick WHERE work_id=?").get(first).realization_id, kept);
});

test("matching: a set WORK names is one work per catalogue number in its titles", async (t) => {
  const liszt = ["Franz Liszt"];
  const book = (id, work, titles) => ({ id, album: id, albumArtist: "Pianist", artist: "Pianist", titles: titles.map((title) => ({ title, work, composer: liszt })) });
  const c = await catalogueWith(t, [
    book("kobayashi", "Années de pèlerinage, Deuxième année", ["Italie, S. 161, no. 4: Sonetto 47 del Petrarca", "Italie, S. 161, no. 5: Sonetto 104 del Petrarca"]),
    // The same book on another album, tagged with the cycle's name only.
    book("other", "Années de pèlerinage", ["Italie, S. 161, no. 6: Sonetto 123 del Petrarca", "Italie, S. 161, no. 7: Après une lecture du Dante"]),
    // Another book under that name stays its own work.
    book("suisse", "Années de pèlerinage", ["Suisse, S. 160, no. 1: Chapelle de Guillaume Tell", "Suisse, S. 160, no. 2: Au lac de Wallenstadt"]),
    // A label over a symphony's movements doesn't name it.
    { id: "label", album: "label", albumArtist: "Orchestra", artist: "Orchestra", titles: ["Symphony No. 5 in C minor, Op. 67: I. Allegro con brio", "Symphony No. 5 in C minor, Op. 67: II. Andante con moto"].map((title) => ({ title, work: "Favourites", composer: ["Ludwig van Beethoven"] })) },
  ]);
  for (const albumId of ["kobayashi", "other", "suisse", "label"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const workOf = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.workId, group.title]);
  const [[annees, title]] = workOf("kobayashi");
  assert.equal(title, "Années de pèlerinage, Deuxième année");
  assert.deepEqual(workOf("other"), [[annees, title]]);
  assert.notEqual(workOf("suisse")[0][0], annees);
  assert.equal(workOf("label")[0][1], "Symphony No. 5 in C minor, Op. 67");
  // The rows keep the parts' own numbers.
  assert.deepEqual(
    renderAlbumPresentation(c, "kobayashi").groups[0].items.map((item) => item.title),
    ["Italie, S. 161, no. 4: Sonetto 47 del Petrarca", "Italie, S. 161, no. 5: Sonetto 104 del Petrarca"],
  );
});

test("album page: numbered pieces of a set head as the set; single numbered pieces stay apart", async (t) => {
  const piece = (composer) => (title) => ({ title, composer: [composer], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    {
      id: "argerich",
      album: "Chopin",
      albumArtist: "Martha Argerich",
      artist: "Martha Argerich",
      titles: [
        "24 Préludes, op. 28 no. 6 in B minor",
        "24 Préludes, op. 28 no. 10 in C-sharp minor",
        "Études in G-flat major, Op. 10 No. 5 \"Black Keys\"",
        "Prelude in C-sharp minor, Op. 45",
      ].map(piece("Frédéric Chopin")),
    },
    { id: "glass", album: "Glass", albumArtist: "Víkingur Ólafsson", artist: "Víkingur Ólafsson", titles: ["Études no. 9", "Études no. 2"].map(piece("Philip Glass")) },
    { id: "field", album: "Field", albumArtist: "Benjamin Frith", artist: "Benjamin Frith", titles: ["Nocturne no. 10 in E minor", "Nocturne no. 11 in E-flat major"].map(piece("John Field")) },
  ]);
  const blocks = (albumId) =>
    renderAlbumPresentation(c, albumId)?.groups.map((group) => [group.title, group.items.map((item) => item.title), group.detail ?? null]) ?? null;
  assert.deepEqual(blocks("argerich"), [
    ["24 Préludes, op. 28", ["No. 6 in B minor", "No. 10 in C-sharp minor"], null],
    // A key before the number: one piece, whatever its plural.
    ["Études in G-flat major, Op. 10 No. 5 \"Black Keys\"", ["Études in G-flat major, Op. 10 No. 5 \"Black Keys\""], null],
    ["Prelude in C-sharp minor, Op. 45", ["Prelude in C-sharp minor, Op. 45"], null],
  ]);
  assert.deepEqual(blocks("glass"), [["Études", ["No. 9", "No. 2"], null]]);
  // Field's nocturnes are pieces of their own: no set, so no work view.
  assert.equal(blocks("field"), null);
  // A set with its own opus and a piece with its own opus are works; a set
  // without a number, a piece within an opus and Field's nocturnes are not.
  autoMatchTaggedWorks(c, { actor: "admin", allowStructuredTitles: true });
  const works = (albumId) => renderAlbumPresentation(c, albumId)?.groups.map((group) => [group.title, Boolean(group.workId)]) ?? null;
  assert.deepEqual(works("argerich"), [
    ["24 Préludes, op. 28", true],
    ["Études in G-flat major, Op. 10 No. 5 \"Black Keys\"", false],
    ["Prelude in C-sharp minor, Op. 45", true],
  ]);
  assert.deepEqual(works("glass"), [["Études", false]]);
  assert.equal(works("field"), null);
});

test("matching: a movement an earlier pass left out fills the work's missing movement", async (t) => {
  const rach = "Sergei Rachmaninoff";
  const work = "Piano Concerto no. 4 in G minor, op. 40";
  const album = (id, titles) => ({ id, album: id, albumArtist: "Daniil Trifonov", artist: "Daniil Trifonov", titles });
  const c = await catalogueWith(t, [
    album("other", ["I. Allegro vivace", "II. Largo", "III. Allegro vivace"].map((title) => ({ title, work, composer: [rach], genres: ["Classical"] }))),
    // The first movement credits another composer too, and spells its work differently.
    album("departure", [
      { title: "1. Allegro vivace", work: "Concerto for Piano and Orchestra no. 4 in G minor, op. 40", composer: ["Camille Saint-Saëns", rach], genres: ["Classical"] },
      ...["II. Largo", "III. Allegro vivace"].map((title) => ({ title, work, composer: [rach], genres: ["Classical"] })),
    ]),
  ]);
  autoMatchTaggedWorks(c, { albumId: "other", actor: "admin", allowStructuredTitles: true });
  // An earlier version matched the album without its first movement.
  const first = c.db.prepare("SELECT id FROM track_link WHERE core_id='departure-0'").get().id;
  c.db.prepare("UPDATE classification SET state='not_classical' WHERE target_id=?").run(first);
  autoMatchTaggedWorks(c, { albumId: "departure", actor: "admin", allowStructuredTitles: true });
  c.db.prepare("UPDATE classification SET state='classical' WHERE target_id=?").run(first);
  assert.deepEqual(renderAlbumPresentation(c, "departure").groups.map((group) => group.missing.map((m) => m.title)), [[], ["I. Allegro vivace"]]);

  autoMatchTaggedWorks(c, { albumId: "departure", actor: "admin", allowStructuredTitles: true });
  const [group, ...rest] = renderAlbumPresentation(c, "departure").groups;
  assert.equal(rest.length, 0);
  assert.deepEqual([group.title, group.missing, group.items.map((item) => item.title)], [work, [], ["I. Allegro vivace", "II. Largo", "III. Allegro vivace"]]);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM relation WHERE kind='movement' AND source_id=?").get(group.workId).n, 3);
});

test("matching: a movement number never maps a track onto a differently named movement", () => {
  const partita = ["Preludio", "Loure", "Gavotte en rondeau", "Menuet I", "Menuet II", "Bourrée", "Gigue"].map((name, i) => ({
    id: `m${i + 1}`,
    position: i + 1,
    ...movementParts(`${["I", "II", "III", "IV", "V", "VI", "VII"][i]}. ${name}`),
  }));
  const tracks = (...titles) => titles.map((movementTitle) => ({ movementTitle }));
  // Rachmaninoff's suite from the partita: "2. Gavotte" is not "II. Loure".
  assert.equal(mapToMovements(partita, tracks("1. Preludio. Non allegro", "2. Gavotte", "3. Gigue")), null);
  // The same number with the same first word still maps.
  assert.deepEqual(mapToMovements(partita, tracks("I. Preludio (Live)", "VII. Gigue")), ["m1", "m7"]);
});

test("matching: a title naming a whole piece is a work; a set with its own opus is one work", async (t) => {
  const chopin = (title) => ({ title, composer: ["Frédéric Chopin"], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    {
      id: "zimerman",
      album: "Chopin: Ballades; Barcarolle; Fantaisie",
      albumArtist: "Krystian Zimerman",
      artist: "Frédéric Chopin — Krystian Zimerman",
      titles: ["Ballade No. 1 in G Minor, Op. 23", "Ballade No. 2 in F Major, Op. 38", "Barcarolle in F sharp, Op. 60", "Fantaisie in F minor, Op. 49"].map(chopin),
    },
    {
      id: "fliter",
      album: "Chopin: Waltzes",
      albumArtist: "Ingrid Fliter",
      artist: "Ingrid Fliter",
      titles: ["Waltz in E-flat, op. 18", "Waltzes, op. 34 no. 1 in A-flat", "Waltzes, op. 34 no. 2 in A minor", "Waltz in A-flat, op. 42"].map(chopin),
    },
  ]);
  for (const albumId of ["zimerman", "fliter"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const blocks = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.title, Boolean(group.workId), group.items.map((item) => item.title)]);
  assert.deepEqual(blocks("zimerman"), [
    ["Ballade No. 1 in G Minor, Op. 23", true, ["Ballade No. 1 in G Minor, Op. 23"]],
    ["Ballade No. 2 in F Major, Op. 38", true, ["Ballade No. 2 in F Major, Op. 38"]],
    ["Barcarolle in F sharp, Op. 60", true, ["Barcarolle in F sharp, Op. 60"]],
    ["Fantaisie in F minor, Op. 49", true, ["Fantaisie in F minor, Op. 49"]],
  ]);
  assert.deepEqual(blocks("fliter"), [
    ["Waltz in E-flat, op. 18", true, ["Waltz in E-flat, op. 18"]],
    ["Waltzes, op. 34", true, ["No. 1 in A-flat", "No. 2 in A minor"]],
    ["Waltz in A-flat, op. 42", true, ["Waltz in A-flat, op. 42"]],
  ]);
});

test("matching: cases from a real library's audit", async (t) => {
  const tag = (composer) => (title) => ({ title, composer: [composer], genres: ["Classical"] });
  const liszt = tag("Franz Liszt");
  const c = await catalogueWith(t, [
    // The work in the title's head, its number in the next part; no WORK tag.
    { id: "kobayashi", album: "Chopin & Liszt", albumArtist: "Aimi Kobayashi", artist: "Aimi Kobayashi", titles: ["Années de pèlerinage, Deuxième année: Italie, S. 161, no. 4: Sonetto 47 del Petrarca", "Années de pèlerinage, Deuxième année: Italie, S. 161, no. 5: Sonetto 104 del Petrarca"].map(liszt) },
    // Hyperion writes "S161", and a dash before the book.
    { id: "howard", album: "The Complete Liszt Piano Music", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: ["Années de pèlerinage, deuxième année – Italie, S161: I. Sposalizio", "Années de pèlerinage, deuxième année – Italie, S161: II. Il pensero", "Années de pèlerinage, première année – Suisse, S160: I. Chapelle de Guillaume Tell", "Années de pèlerinage, première année – Suisse, S160: II. Au lac de Wallenstadt"].map(liszt) },
    // A head with a catalogue range names a set of works, not one.
    { id: "grimaud", album: "Bach", albumArtist: "Hélène Grimaud", artist: "Hélène Grimaud", titles: ["Book 1, BWV 846-869: 1. Prelude in C Minor BWV 847", "Book 1, BWV 846-869: 2. Fugue in C Minor BWV 847", "Book 1, BWV 846-869: 1. Prelude in C-Sharp Minor BWV 849", "Book 1, BWV 846-869: 2. Fugue in C-Sharp Minor BWV 849"].map(tag("Johann Sebastian Bach")) },
    // Two recordings of one work in a box; a movement a work repeats is not one.
    { id: "decca", album: "Decca Sound", albumArtist: "Various Artists", artist: "Orchestra", titles: [1, 2].flatMap(() => ["I. Alborada", "II. Variazioni", "III. Alborada"].map((m) => `Capriccio espagnol, op. 34: ${m}`)).map(tag("Nikolai Rimsky-Korsakov")) },
    { id: "mass", album: "Mass in B minor", albumArtist: "Choir", artist: "Choir", titles: ["Kyrie eleison", "Christe eleison", "Kyrie eleison", "Gloria in excelsis Deo"].map((m) => `Mass in B Minor, BWV 232: ${m}`).map(tag("Johann Sebastian Bach")) },
    // A whole piece with its own number and no form word.
    { id: "sibelius", album: "Sibelius", albumArtist: "Orchestra", artist: "Orchestra", titles: ["Tapiola, op. 112", "Finlandia, op. 26"].map(tag("Jean Sibelius")) },
    { id: "dante", album: "Dante Symphony", albumArtist: "Orchestra", artist: "Orchestra", titles: ["Dante Symphony: I. Inferno: 1. Lento", "Dante Symphony: I. Inferno: 2. Allegro frenetico", "Dante Symphony: II. Purgatorio: 1. Andante con moto"].map(liszt) },
  ]);
  const match = (albumId) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  for (const albumId of ["kobayashi", "howard", "grimaud", "decca", "mass", "sibelius", "dante"]) match(albumId);
  const blocks = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.title, group.workId, group.items.map((item) => item.title)]);
  const [kobayashi] = blocks("kobayashi");
  assert.deepEqual([kobayashi[0], Boolean(kobayashi[1])], ["Années de pèlerinage, Deuxième année", true]);
  const howard = blocks("howard");
  assert.deepEqual(howard.map(([title, workId]) => [title.toLowerCase(), Boolean(workId)]), [
    ["années de pèlerinage, deuxième année", true],
    ["années de pèlerinage, première année", true],
  ]);
  // S161 and S. 161 are one work; S160 another.
  assert.equal(howard[0][1], kobayashi[1]);
  assert.notEqual(howard[1][1], kobayashi[1]);
  // No work named after the set; the preludes and fugues stay unmatched.
  assert.ok(blocks("grimaud").every(([, workId]) => !workId));
  const decca = blocks("decca");
  assert.equal(decca.length, 2);
  assert.ok(decca[0][1] && decca[0][1] === decca[1][1]);
  assert.deepEqual(decca[1][2], ["I. Alborada", "II. Variazioni", "III. Alborada"]);
  assert.deepEqual(blocks("mass").map(([, , rows]) => rows.length), [4]);
  assert.deepEqual(blocks("sibelius").map(([title, workId]) => [title, Boolean(workId)]), [["Tapiola, op. 112", true], ["Finlandia, op. 26", true]]);
  // A movement inside a movement keeps its path, and a name an earlier
  // repair cut short comes back when the album is matched again.
  const dante = () => blocks("dante")[0][2];
  assert.deepEqual(dante(), ["I. Inferno: 1. Lento", "I. Inferno: 2. Allegro frenetico", "II. Purgatorio: 1. Andante con moto"]);
  const workId = blocks("dante")[0][1];
  const first = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").get(workId).target_id;
  new Metadata(c).derived(first, "title", "1. Lento");
  assert.equal(dante()[0], "1. Lento");
  match("dante");
  assert.equal(dante()[0], "I. Inferno: 1. Lento");
});

test("Auto-match every album matches each album from tags and titles, for admins only", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const tracks = ["a", "b"].flatMap((album) =>
    ["I. Allegro", "II. Adagio"].map((movement, i) => ({
      coreId: `${album}-${i}`,
      fileId: `${album}-${i}`,
      path: `/library/${album}/${i}.flac`,
      size: 1000,
      durationMs: 60000,
      fingerprint: `audio-sha256-v2:${album}-${i}`,
      albumId: album,
      hints: { title: `Piano Sonata No. ${album === "a" ? 8 : 14}, Op. ${album === "a" ? 13 : 27}: ${movement}`, album, albumArtist: "Pianist", artist: "Pianist", composer: ["Ludwig van Beethoven"], genres: ["Classical"], work: "", trackNumber: i + 1, discNumber: 1 },
    })),
  );
  for (const row of reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: 1, tracks })) classify(c, row.id, row.hints);
  c.close();
  const ctx = { dataFolder: folders.dataFolder };
  await assert.rejects(autoMatchLibrary(ctx, { id: 2, role: "user" }));
  assert.deepEqual(await autoMatchLibrary(ctx, { id: 1, role: "admin" }), { albums: 2, created: 2 });
  // Matched albums have nothing left to check.
  assert.deepEqual(await autoMatchLibrary(ctx, { id: 1, role: "admin" }), { albums: 0, created: 0 });
});

test("matching: repeated work names, sets' own numbering and a movement over two tracks line up", async (t) => {
  const tag = (composer) => (title) => ({ title, composer: [composer], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    // The first album makes each work.
    { id: "first", album: "First", albumArtist: "Orchestra", artist: "Orchestra", titles: [
      ...["I. Allegro ma non troppo", "II. Molto vivace", "III. Adagio molto e cantabile", "IV. Presto"].map((m) => `Symphony No. 9 in D minor, op. 125: ${m}`),
      ...["Theme: Largo", "I. Moderato", "II. L'istesso tempo"].map((m) => `Variations on a Theme of Chopin, op. 22: ${m}`),
    ].map((title, i) => tag(i < 4 ? "Ludwig van Beethoven" : "Sergei Rachmaninoff")(title)) },
    { id: "set", album: "Set", albumArtist: "Pianist", artist: "Pianist", titles: ["24 Preludes, op. 28: No.1 In C Major", "24 Preludes, op. 28: No.2 In A Minor", "24 Preludes, op. 28: No.3 In G Major"].map(tag("Frédéric Chopin")) },
    // The finale over two tracks.
    { id: "choral", album: "Choral", albumArtist: "Orchestra", artist: "Orchestra", titles: ["I. Allegro ma non troppo", "II. Molto vivace", "III. Adagio molto e cantabile", "IV. Presto", "IV. “O Freunde, nicht diese Töne!”. Allegro assai"].map((m) => `Symphony No. 9 in D minor, op. 125: ${m}`).map(tag("Ludwig van Beethoven")) },
    // The store repeats the work after the composer.
    { id: "doubled", album: "Piano Works", albumArtist: "Pianist", artist: "Pianist", titles: ["Theme: Largo", "I. Moderato", "II. L'istesso tempo"].map((m) => `Variations on a Theme of Chopin, op. 22 : Rachmaninoff: Variations on a Theme of Chopin, op. 22: ${m}`).map(tag("Sergei Rachmaninoff")) },
    // The set spelled with its accent, its numbering its own.
    { id: "history", album: "History", albumArtist: "Various", artist: "Pianist", titles: ["24 Préludes, op. 28 no. 1 in C major", "24 Préludes, op. 28 no. 3 in G major"].map(tag("Frédéric Chopin")) },
  ]);
  const match = (albumId) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  for (const albumId of ["first", "set", "choral", "doubled", "history"]) match(albumId);
  const blocks = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.workId, group.items.map((item) => item.title), group.missing.length]);
  const [[ninth], [variations]] = blocks("first");
  const [choral] = blocks("choral");
  assert.equal(choral[0], ninth);
  assert.deepEqual(choral[1], ["I. Allegro ma non troppo", "II. Molto vivace", "III. Adagio molto e cantabile", "IV. Presto", "IV. “O Freunde, nicht diese Töne!”. Allegro assai"]);
  assert.equal(choral[2], 0);
  assert.deepEqual(blocks("doubled"), [[variations, ["Theme: Largo", "I. Moderato", "II. L'istesso tempo"], 0]]);
  const [[preludes]] = blocks("set");
  const [history] = blocks("history");
  assert.equal(history[0], preludes);
  assert.deepEqual(history[1], ["No.1 In C Major", "No.3 In G Major"]);
});

// From the 1.0.22 audit of a real library: catalogue numbers that differ
// only in a suffix ("S172a"), a Searle sub-number ("S. 534/2b") or a piece
// number after them ("S164e No. 2") were read as the stem, so different
// pieces shared one identity: on one album they were "several tracks naming
// one piece", across albums one joined the other's work or was reviewed
// against it, and the audit counted them as duplicate works.
test("matching: a catalogue number's suffix and piece number are part of the work's identity", async (t) => {
  const subjects = (titles) => titles.map(catalogueSubject);
  assert.deepEqual(
    subjects(["Ave Maria, S504i", "Ave Maria, S504ii", "Stabat mater, S172b", "Harmonies poétiques et religieuses, S172a", "Consolations, S172", "Ungarns Gott, S543bis", "Die Zelle in Nonnenwerth, S534ii/bis", "Feuille d'album no. 2, S. 534/2b", "Album-Leaf 'Magyar', S164e No. 2", "Au bord d'une source, S160 No. 4bis"]),
    ["cat:s:504i", "cat:s:504ii", "cat:s:172b", "cat:s:172a", "cat:s:172", "cat:s:543bis", "cat:s:534ii/bis", "cat:s:534/2b", "cat:s:164e:2", "cat:s:160:4bis"],
  );
  // The same number written either way stays one identity.
  assert.equal(workKey("Ungarns Gott, S543", ["Franz Liszt"]), workKey("Ungarns Gott, S. 543", ["Franz Liszt"]));
  assert.equal(catalogueSubject("Années de pèlerinage, deuxième année – Italie, S161"), catalogueSubject("Italie, S. 161"));

  const liszt = (title) => ({ title, composer: ["Franz Liszt"], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    {
      id: "howard",
      album: "The Complete Liszt Piano Music",
      albumArtist: "Leslie Howard",
      artist: "Leslie Howard",
      titles: [
        "Harmonies poétiques et religieuses, S172a: I. Invocation",
        "Harmonies poétiques et religieuses, S172a: II. Hymne du matin",
        "Ave Maria, S504i",
        "Ave Maria, S504ii",
        "Klavierstück, S189",
        "Klavierstück, S189a",
        "Klavierstück, S189b",
        "Album-Leaf 'Magyar', S164e No. 1",
        "Album-Leaf 'Magyar', S164e No. 2",
        "Ungarns Gott, S543",
        "Ungarns Gott, S543bis",
        "Années de pèlerinage, première année – Suisse, S160: I. Chapelle de Guillaume Tell",
        "Années de pèlerinage, première année – Suisse, S160: II. Au lac de Wallenstadt",
        "Au bord d'une source, S160 No. 4bis",
      ].map(liszt),
    },
    {
      id: "consolations",
      album: "Liszt: Consolations",
      albumArtist: "Pianist",
      artist: "Pianist",
      titles: ["Consolations, S172: I. E major", "Consolations, S172: II. E major", "Stabat mater, S172b", "Ungarns Gott, S. 543"].map(liszt),
    },
  ]);
  for (const albumId of ["howard", "consolations"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const blocks = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.title, group.workId, group.items.map((item) => item.title)]);
  const howard = blocks("howard");
  const titled = (rows, title) => rows.find(([heading]) => heading === title);
  // Every piece is its own work, matched on its own.
  for (const title of ["Ave Maria, S504i", "Ave Maria, S504ii", "Klavierstück, S189", "Klavierstück, S189a", "Klavierstück, S189b", "Album-Leaf 'Magyar', S164e No. 1", "Album-Leaf 'Magyar', S164e No. 2", "Ungarns Gott, S543", "Ungarns Gott, S543bis", "Au bord d'une source, S160 No. 4bis"])
    assert.ok(titled(howard, title)?.[1], `${title} is matched`);
  assert.equal(new Set(howard.map(([, workId]) => workId)).size, howard.length);
  // The variant of a set's movement is no movement of the set.
  assert.deepEqual(titled(howard, "Années de pèlerinage, première année")[2], ["I. Chapelle de Guillaume Tell", "II. Au lac de Wallenstadt"]);
  // Across albums: S172 and S172b are not S172a; S. 543 is S543.
  const other = blocks("consolations");
  const harmonies = titled(howard, "Harmonies poétiques et religieuses, S172a")[1];
  assert.deepEqual(other.map(([title, , rows]) => [title, rows]), [
    ["Consolations, S172", ["I. E major", "II. E major"]],
    ["Stabat mater, S172b", ["Stabat mater, S172b"]],
    ["Ungarns Gott, S543", ["Ungarns Gott, S. 543"]],
  ]);
  assert.ok(other.every(([, workId]) => workId && workId !== harmonies));
  assert.equal(other[2][1], titled(howard, "Ungarns Gott, S543")[1]);
  const mismatches = c.db.prepare("SELECT COUNT(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").get().n;
  assert.equal(mismatches, 0);
});

// An album that made a piece under its 1.0.22 key (the number without its
// suffix) and later lost its tracks keeps them out only when that work has
// the exact number. One made under a sibling number was the false join an
// admin undid, so the piece now gets its own work.
test("matching: tracks taken out under the old catalogue key stay out only for the same number", async (t) => {
  const liszt = (title) => ({ title, composer: ["Franz Liszt"], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    { id: "removed", album: "The Complete Liszt Piano Music", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: ["Ungarns Gott, S543bis", "Klavierstück, S189a"].map(liszt) },
  ]);
  const metadata = new Metadata(c);
  const madeBefore = (title, oldSubject) => {
    const work = c.createEntity("work");
    metadata.derived(work, "title", title);
    const key = JSON.stringify(["i", "removed", JSON.stringify([["franz liszt"], oldSubject]), ["franz liszt"], "structured-title", "standalone"]);
    c.externalIdentity(work, "embedded-tags", "album-work", createHash("sha256").update(JSON.stringify(["album-work", key])).digest("hex"), { evidence: {} });
    return work;
  };
  const same = madeBefore("Ungarns Gott, S543bis", "cat:s:543");
  const sibling = madeBefore("Klavierstück, S189", "cat:s:189");
  autoMatchTaggedWorks(c, { albumId: "removed", actor: "admin", allowStructuredTitles: true });
  const groups = renderAlbumPresentation(c, "removed").groups.map((group) => [group.title, group.workId]);
  const work = (title) => groups.find(([heading]) => heading === title)?.[1] ?? null;
  assert.equal(work("Ungarns Gott, S543bis"), null);
  assert.ok(work("Klavierstück, S189a"));
  assert.notEqual(work("Klavierstück, S189a"), sibling);
  assert.ok(same);
});

// From the 1.0.22 audit: a work an earlier album made from part of a piece
// turned fuller albums away as movement-mismatch reviews, and an album that
// divides a piece into more tracks (one per variation) could not share the
// work an album with fewer, longer tracks had made.
test("matching: an incomplete auto-made work takes a fuller album's movements; other divisions line up", async (t) => {
  const tag = (composer, work = "") => (title) => ({ title, composer: [composer], genres: ["Classical"], work });
  const rach = tag("Sergei Rachmaninoff");
  const c = await catalogueWith(t, [
    // Two of the nine Études-tableaux, named the MusicBrainz way.
    { id: "ampico", album: "Rachmaninov plays Rachmaninov", albumArtist: "Sergei Rachmaninoff", artist: "Sergei Rachmaninoff", titles: ["Etude-tableau in B minor, op. 39 no. 4", "Etude-tableau in A minor, op. 39 no. 6"].map(tag("Sergei Rachmaninoff", "Études-tableaux, op. 39")) },
    { id: "lugansky", album: "Nikolai Lugansky plays Rachmaninov: Études-tableaux", albumArtist: "Nikolai Lugansky", artist: "Nikolai Lugansky", titles: ["Allegro agitato in C minor", "Lento assai in A minor", "Allegro molto in F-sharp minor", "Allegro assai in B minor", "Appassionato in E-flat minor", "Allegro in A minor", "Lento lugubre in C minor", "Allegro moderato in D minor", "Allegro moderato in D major"].map((piece, i) => `Études-tableaux op. 39: ${piece}, no. ${i + 1}`).map(rach) },
    // A few of them later, out of order.
    { id: "fantasia", album: "Fantasia", albumArtist: "Pianist", artist: "Pianist", titles: ["Études-tableaux, Op. 39, No. 6", "Études-tableaux, Op. 39, No. 4", "Études-tableaux, Op. 39, No. 5"].map(rach) },
    // Two of Children's Corner, one abbreviated.
    { id: "excerpts", album: "The Complete Recordings", albumArtist: "Pianist", artist: "Pianist", titles: ["Children’s Corner, L. 113, CD 119: Dr. Gradus ad Parnassum", "Children’s Corner, L. 113, CD 119: Golliwogg's Cakewalk"].map(tag("Claude Debussy")) },
    { id: "decca", album: "Decca Sound", albumArtist: "Various Artists", artist: "Pianist", titles: ["I. Doctor Gradus ad Parnassum", "II. Jimbo’s Lullaby", "III. Serenade for the Doll", "IV. The Snow is dancing", "V. The little Shepherd", "VI. Golliwogg’s Cakewalk"].map((m) => `Children’s Corner, L. 113: ${m}`).map(tag("Claude Debussy")) },
    // Several variations per track first, then one per track, two ways.
    { id: "combined", album: "Rhapsody on a Theme of Paganini", albumArtist: "Pianist", artist: "Pianist", titles: ["Introduction: Allegro vivace / I. (Precedente)", "Theme: L'istesso tempo / II. L'istesso tempo / III. L'istesso tempo", "IV. Più vivo"].map((m) => `Rhapsody on a Theme of Paganini, op. 43: ${m}`).map(rach) },
    { id: "trifonov", album: "Rachmaninoff - Piano Works", albumArtist: "Daniil Trifonov", artist: "Daniil Trifonov", titles: ["Introduction. Allegro vivace - Variation No. 1 (Precedente)", "Tema. L'istesso tempo", "Variation No. 2 L'istesso tempo", "Variation No. 3 L'istesso tempo", "Variation No. 4 Più vivo"].map((m) => `Rachmaninoff: Rhapsody on a Theme of Paganini, Op. 43: ${m}`).map(rach) },
    { id: "complete", album: "The Complete Recordings", albumArtist: "Pianist", artist: "Pianist", titles: ["Introduction: Allegro vivace", "Variation 1: (Precedente)", "Tema: L'istesso tempo", "Variation 2: L'istesso tempo", "Variation 3: L'istesso tempo", "Variation 4: Più vivo"].map((m) => `Rhapsody on a Theme of Paganini, op. 43: ${m}`).map(rach) },
  ]);
  const order = ["ampico", "lugansky", "fantasia", "excerpts", "decca", "combined", "trifonov", "complete"];
  for (const albumId of order) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const blocks = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.workId, group.items.map((item) => item.title)]);
  const movements = (work) => workMovementTitles(c, work);
  // One work of nine; the first album's pieces keep their recordings.
  const [[etudes, ampico]] = blocks("ampico");
  assert.ok(etudes);
  assert.equal(movements(etudes).length, 9);
  assert.deepEqual(ampico, ["Etude-tableau in B minor, op. 39 no. 4", "Etude-tableau in A minor, op. 39 no. 6"]);
  assert.deepEqual(movements(etudes).slice(3, 6), ["Etude-tableau in B minor, op. 39 no. 4", "Appassionato in E-flat minor, no. 5", "Etude-tableau in A minor, op. 39 no. 6"]);
  assert.deepEqual(blocks("lugansky").map(([work, rows]) => [work, rows.length]), [[etudes, 9]]);
  assert.deepEqual(blocks("fantasia").map(([work, rows]) => [work, rows]), [[etudes, ["Etude-tableau in A minor, op. 39 no. 6", "Etude-tableau in B minor, op. 39 no. 4", "Appassionato in E-flat minor, no. 5"]]]);
  // Children's Corner: six movements, Dr. and Doctor alike.
  const [[corner]] = blocks("excerpts");
  assert.deepEqual(blocks("decca").map(([work, rows]) => [work, rows.length]), [[corner, 6]]);
  assert.deepEqual(movements(corner), ["Dr. Gradus ad Parnassum", "II. Jimbo’s Lullaby", "III. Serenade for the Doll", "IV. The Snow is dancing", "V. The little Shepherd", "Golliwogg's Cakewalk"]);
  // The rhapsody gets one movement per section, the first album's tracks
  // each covering theirs; the other albums' tracks line up one by one.
  const [[rhapsody, combinedRows]] = blocks("combined");
  assert.deepEqual(movements(rhapsody), ["Introduction: Allegro vivace", "I. (Precedente)", "Theme: L'istesso tempo", "II. L'istesso tempo", "III. L'istesso tempo", "IV. Più vivo"]);
  assert.deepEqual(combinedRows, ["Introduction: Allegro vivace / I. (Precedente)", "Theme: L'istesso tempo / II. L'istesso tempo / III. L'istesso tempo", "IV. Più vivo"]);
  for (const albumId of ["trifonov", "complete"]) assert.deepEqual(blocks(albumId).map(([work]) => work), [rhapsody]);
  const sequence = (albumId) =>
    c.db
      .prepare(
        `SELECT i.movement_id,i.occurrence FROM realization_item i JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
         WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY i.sequence`,
      )
      .all(albumId)
      .map((row) => [workMovementTitles(c, rhapsody, true).indexOf(row.movement_id) + 1, row.occurrence]);
  assert.deepEqual(sequence("combined"), [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]);
  assert.deepEqual(sequence("trifonov"), [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]);
  assert.deepEqual(sequence("complete"), [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").get().n, 0);
});

test("matching: an edited work is never expanded; a track continuing a movement adds none", async (t) => {
  const beethoven = (title) => ({ title, composer: ["Ludwig van Beethoven"], genres: ["Classical"] });
  const debussy = (title) => ({ title, composer: ["Claude Debussy"], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    { id: "three", album: "Late Sonatas", albumArtist: "Pianist", artist: "Pianist", titles: ["I. Moderato cantabile molto espressivo", "II. Allegro molto", "III. Adagio ma non troppo - Fuga (Allegro ma non troppo)"].map((m) => `Piano Sonata No. 31 in A-flat major, Op. 110: ${m}`).map(beethoven) },
    { id: "four", album: "Sonatas", albumArtist: "Pianist", artist: "Pianist", titles: ["I. Moderato cantabile molto espressivo", "II. Allegro molto", "III. Adagio ma non troppo - Fuga (Allegro ma non troppo)", "IV. Fuga (Allegro ma non troppo)"].map((m) => `Piano Sonata No. 31 in A-flat major, Op. 110: ${m}`).map(beethoven) },
    { id: "excerpts", album: "Encores", albumArtist: "Pianist", artist: "Pianist", titles: ["Children’s Corner, L. 113: The Snow is dancing", "Children’s Corner, L. 113: Golliwogg's Cakewalk"].map(debussy) },
    { id: "full", album: "Debussy", albumArtist: "Pianist", artist: "Pianist", titles: ["I. Doctor Gradus ad Parnassum", "II. Jimbo’s Lullaby", "III. Serenade for the Doll", "IV. The Snow is dancing", "V. The little Shepherd", "VI. Golliwogg’s Cakewalk"].map((m) => `Children’s Corner, L. 113: ${m}`).map(debussy) },
  ]);
  const match = (albumId) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  match("three");
  match("four");
  const sonata = renderAlbumPresentation(c, "three").groups[0].workId;
  assert.equal(workMovementTitles(c, sonata).length, 3);
  match("excerpts");
  const corner = renderAlbumPresentation(c, "excerpts").groups[0].workId;
  // An admin edited the work: its structure is theirs.
  new Metadata(c).manual(corner, "description", "Two pieces from the suite.", { actor: "admin" });
  match("full");
  assert.equal(workMovementTitles(c, corner).length, 2);
  assert.ok(renderAlbumPresentation(c, "full").groups.every((group) => group.workId !== corner));
});

// A box with two recordings of a concerto, the second's titles ending in its
// performers, made one six-movement work that turned away every album with
// the concerto's three. And "Op. 27/1" and "Op. 27/2" were one work.
test("matching: a performer credit after a title is the same movement; an opus's slash number is its piece", async (t) => {
  assert.equal(catalogueSubject("Piano Sonata No. 14 in C-sharp minor, Op. 27/2"), "cat:op:27:2");
  assert.equal(catalogueSubject("String Quartet No. 3, Op. 18/3"), catalogueSubject("String Quartet No. 3, Op. 18 No. 3"));
  assert.notEqual(catalogueSubject("Op. 27/1"), catalogueSubject("Op. 27/2"));
  const rach = (title) => ({ title, composer: ["Sergei Rachmaninoff"], genres: ["Classical"] });
  const concerto = (m) => `Piano Concerto No. 2 in C minor, Op. 18: ${m}`;
  const c = await catalogueWith(t, [
    { id: "box", album: "Decca Sound", albumArtist: "Various Artists", artist: "Orchestra", titles: ["I. Moderato; Allegro", "II. Adagio sostenuto", "III. Allegro scherzando", "I. Moderato - Allegro (Philadelphia Orchestra feat. conductor: Leopold Stokowski)", "II. Adagio sostenuto (Philadelphia Orchestra feat. conductor: Leopold Stokowski)", "III. Allegro scherzando (Philadelphia Orchestra feat. conductor: Leopold Stokowski)"].map(concerto).map(rach) },
    { id: "single", album: "Piano Concertos", albumArtist: "Pianist", artist: "Pianist", titles: ["I. Moderato", "II. Adagio sostenuto", "III. Allegro scherzando"].map(concerto).map(rach) },
  ]);
  for (const albumId of ["box", "single"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const box = renderAlbumPresentation(c, "box").groups;
  assert.deepEqual(box.map((group) => group.items.length), [3, 3]);
  assert.equal(box[0].workId, box[1].workId);
  assert.equal(workMovementTitles(c, box[0].workId).length, 3);
  assert.deepEqual(renderAlbumPresentation(c, "single").groups.map((group) => group.workId), [box[0].workId]);
});

function workMovementTitles(c, work, ids = false) {
  const rows = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(work);
  if (ids) return rows.map((row) => row.target_id);
  const metadata = new Metadata(c);
  return rows.map((row) => metadata.resolve?.(row.target_id, "title")?.value ?? c.db.prepare(
    `SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id JOIN metadata_target m ON m.id=f.target_id WHERE m.entity_id=? AND f.field='title'`,
  ).get(row.target_id)?.value?.replace(/^"|"$/g, ""));
}

// From the 1.0.22 audit: the duplicate merge that runs with every match
// folded works that shared a stem key, so "Valse oubliée No. 2, S215 No. 2"
// held Nos. 1, 3 and 4. A match now detaches a recording whose tracks name
// a provably different number from an unedited auto-made work; a set and
// its numbered pieces, notation twins and edited works stay.
test("matching: works an old merge joined across sibling numbers come apart; twins, sets and edits stay", async (t) => {
  assert.equal(provablyDifferent("cat:s:215:1", "cat:s:215:2"), true);
  assert.equal(provablyDifferent("cat:s:406i", "cat:s:406ii"), true);
  assert.equal(provablyDifferent("cat:s:385i", "cat:s:385a"), true);
  assert.equal(provablyDifferent("cat:s:443/1", "cat:s:443i"), false);
  assert.equal(provablyDifferent("cat:s:443:1", "cat:s:443i"), false);
  assert.equal(catalogueSubject("Album-Leaf 'Andantino in E major', S163d/ii"), "cat:s:163d/ii");
  assert.notEqual(catalogueSubject("Album-Leaf in E major 'Leipzig', S163d"), catalogueSubject("Album-Leaf 'Andantino in E major', S163d/ii"));
  assert.equal(provablyDifferent("cat:s:163d", "cat:s:163d/ii"), false);
  assert.equal(provablyDifferent("cat:s:145", "cat:s:145:1"), false);
  assert.equal(provablyDifferent("cat:sz:107", "cat:bb:105"), false);
  const liszt = (title) => ({ title, composer: ["Franz Liszt"], genres: ["Classical"] });
  const valses = [1, 2, 3, 4].map((n) => `Valse oubliée No. ${n}, S215 No. ${n}`);
  const c = await catalogueWith(t, [
    { id: "howard", album: "The Complete Liszt Piano Music", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: [...valses, "Marche des Tcherkesses, S406i", "Tscherkessenmarsch, S406ii", "Pilgerchor (Tannhäuser), S443 No. 1", "Chor der älteren Pilger, S443i", "Capriccio alla turca, S388", "Fantasie über Motive von Beethoven, S388b"].map(liszt) },
    { id: "etudes", album: "Liszt: Études", albumArtist: "Pianist", artist: "Pianist", titles: ["Waldesrauschen, S. 145 no. 1", "Gnomenreigen, S. 145 no. 2"].map((title) => ({ ...liszt(title), work: "Zwei Konzertetüden, S. 145" })) },
  ]);
  const match = () => autoMatchTaggedWorks(c, { albumId: null, actor: "admin", allowStructuredTitles: true });
  for (const albumId of ["howard", "etudes"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const workOf = (title) => renderAlbumPresentation(c, "howard").groups.find((group) => group.items.some((item) => item.title === title))?.workId;
  // Rebuild what 1.0.22's merge made, MusicBrainz identities and all.
  const no2 = workOf(valses[1]);
  valses.forEach((title, i) => c.externalIdentity(workOf(title), "musicbrainz", "work", `mb-valse-${i + 1}`, { evidence: {} }));
  for (const title of [valses[0], valses[2], valses[3]]) assert.ok(mergeWork(c, no2, workOf(title), "model-scan"));
  assert.ok(mergeWork(c, workOf("Pilgerchor (Tannhäuser), S443 No. 1"), workOf("Chor der älteren Pilger, S443i"), "model-scan"));
  assert.ok(mergeWork(c, workOf("Capriccio alla turca, S388"), workOf("Fantasie über Motive von Beethoven, S388b"), "model-scan"));
  assert.ok(mergeWork(c, workOf("Marche des Tcherkesses, S406i"), workOf("Tscherkessenmarsch, S406ii"), "model-scan"));
  // A listener's favourite and an admin's edit on two of them.
  c.db.prepare("INSERT INTO user_work_state VALUES (7,?,1,NULL,?)").run(no2, Date.now());
  new Metadata(c).manual(workOf("Marche des Tcherkesses, S406i"), "description", "Checked by hand.", { actor: "admin" });
  const etudes = renderAlbumPresentation(c, "etudes").groups.map((group) => [group.workId, group.items.length]);
  assert.deepEqual(etudes.map(([, n]) => n), [2]);

  match();
  // Each valse is its own work again; No. 2 keeps its work and favourite.
  const valseWorks = valses.map(workOf);
  assert.ok(valseWorks.every(Boolean));
  assert.equal(new Set(valseWorks).size, 4);
  assert.equal(valseWorks[1], no2);
  assert.equal(c.db.prepare("SELECT favourite FROM user_work_state WHERE user_id=7 AND work_id=?").get(no2).favourite, 1);
  assert.notEqual(workOf("Fantasie über Motive von Beethoven, S388b"), workOf("Capriccio alla turca, S388"));
  // Twins, the edited work and the set stay as they were.
  assert.equal(workOf("Chor der älteren Pilger, S443i"), workOf("Pilgerchor (Tannhäuser), S443 No. 1"));
  assert.equal(workOf("Tscherkessenmarsch, S406ii"), workOf("Marche des Tcherkesses, S406i"));
  assert.deepEqual(renderAlbumPresentation(c, "etudes").groups.map((group) => [group.workId, group.items.length]), etudes);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE action='work.split_sibling'").get().n, 4);
  // MusicBrainz naming No. 1's work, which the merge left on No. 2's, does
  // not put it back; the identity conflict is an admin's.
  const no1Track = c.db.prepare("SELECT id FROM track_link WHERE core_id='howard-0'").get().id;
  const no1 = valseWorks[0];
  c.detachItem(c.db.prepare("SELECT i.id FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE s.track_link_id=?").get(no1Track).id, { dropRecording: true });
  c.db.prepare("UPDATE entity SET deleted_at=? WHERE id=?").run(Date.now(), no1);
  autoMatchTaggedWorks(c, {
    albumId: "howard",
    actor: "admin",
    allowStructuredTitles: true,
    providerMatches: new Map([[no1Track, { workId: "mb-valse-1", work: "Valse oubliée No. 1, S. 215/1", movement: null, standalone: true, aliases: [], composers: ["Franz Liszt"], composerIds: {} }]]),
  });
  assert.ok(workOf(valses[0]));
  assert.notEqual(workOf(valses[0]), no2);
  // A second match repairs nothing more.
  match();
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM audit_event WHERE action='work.split_sibling'").get().n, 4);
});

test("matching: duplicate works merge on a number; a title with none goes to review", async (t) => {
  const c = await catalogueWith(t, []);
  const metadata = new Metadata(c);
  const composer = c.createEntity("person", { roles: ["composer"] });
  metadata.derived(composer, "name", "Sergei Rachmaninoff");
  const work = (title, album) => {
    const id = c.createEntity("work");
    metadata.derived(id, "title", title);
    c.credit(id, composer, "composer", { position: 1 });
    c.externalIdentity(id, "embedded-tags", "album-work", `${title}-${album}`, { evidence: { albumId: album } });
    return id;
  };
  const vocalise = [work("Vocalise, op. 34 no. 14", "a"), work("Vocalise, Op. 34 No. 14", "b")];
  const prelude = [work("Prelude", "a"), work("Prelude", "b")];
  autoMatchTaggedWorks(c, { actor: "model-scan", allowStructuredTitles: true });
  const live = (id) => c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(id).deleted_at == null;
  assert.deepEqual(vocalise.map(live), [true, false]);
  assert.deepEqual(prelude.map(live), [true, true]);
  assert.equal(c.db.prepare("SELECT json_extract(evidence,'$.reason') AS reason FROM review_item WHERE status='open' AND target_id=?").get(prelude[1])?.reason, "duplicate-work");
});

// From the 1.0.22 audit: 99 open movement-mismatch reviews, many for tracks
// a later match had already put in a work. Only the editor closed them.
test("reviews: an Auto-match review closes when every track it names is in a work; others stay open", async (t) => {
  const debussy = (title) => ({ title, composer: ["Claude Debussy"], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    { id: "excerpts", album: "Encores", albumArtist: "Pianist", artist: "Pianist", titles: ["Children’s Corner, L. 113: The Snow is dancing", "Children’s Corner, L. 113: Golliwogg's Cakewalk"].map(debussy) },
    { id: "full", album: "Debussy", albumArtist: "Pianist", artist: "Pianist", titles: ["I. Doctor Gradus ad Parnassum", "II. Jimbo’s Lullaby", "III. Serenade for the Doll", "IV. The Snow is dancing", "V. The little Shepherd", "VI. Golliwogg’s Cakewalk"].map((m) => `Children’s Corner, L. 113: ${m}`).map(debussy) },
    { id: "other", album: "Other", albumArtist: "Pianist", artist: "Pianist", titles: ["Prelude", "Fugue"].map(debussy) },
  ]);
  const ids = (album) => c.db.prepare("SELECT id FROM track_link WHERE core_id LIKE ? ORDER BY core_id").all(`${album}-%`).map((row) => row.id);
  // Reviews an earlier release raised: one now settled, one not.
  c.review("auto_match", ids("full")[0], { reason: "movement-mismatch", albumId: "full", tracks: ids("full") });
  c.review("auto_match", ids("other")[0], { reason: "movement-mismatch", albumId: "other", tracks: ids("other") });
  for (const albumId of ["excerpts", "full", "other"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const open = c.db.prepare("SELECT target_id FROM review_item WHERE kind='auto_match' AND status='open'").all().map((row) => row.target_id);
  assert.deepEqual(open, [ids("other")[0]]);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM audit_event WHERE action='review.auto_resolve'").get().n, 1);
});

// From the first 1.0.27 audit of the real library, and the works it left:
// an album choice in the editor kept Études-tableaux op. 39 from expanding;
// one album's sibling pieces were one work's movements (S215 No. 2 holding
// Nos. 1–4); a recording titled as an excerpt ("Tyrolean Melody from the
// opera…, S385a") proposed no work, so the repair could not read its
// number; and two same-numbered works with different MusicBrainz works
// stayed apart with no review.
test("matching: the works the first 1.0.27 audit left are repaired; conflicting duplicates are reviewed", async (t) => {
  const tag = (composer, extra = {}) => (title) => ({ title, composer: [composer], genres: ["Classical"], ...extra });
  const liszt = tag("Franz Liszt");
  const valses = [2, 3, 4, 1].map((n) => `Valse oubliée No. ${n}, S215 No. ${n}`);
  const c = await catalogueWith(t, [
    { id: "ampico", album: "Rachmaninov plays Rachmaninov", albumArtist: "Sergei Rachmaninoff", artist: "Sergei Rachmaninoff", titles: ["Etude‐tableau in B minor, op. 39 no. 4", "Etude‐tableau in A minor, op. 39 no. 6"].map(tag("Sergei Rachmaninoff", { work: "Études-tableaux, op. 39" })) },
    { id: "lugansky", album: "Lugansky", albumArtist: "Nikolai Lugansky", artist: "Nikolai Lugansky", titles: ["Allegro agitato in C minor", "Lento assai in A minor", "Allegro molto in F-sharp minor", "Allegro assai in B minor", "Appassionato in E-flat minor", "Allegro in A minor", "Lento lugubre in C minor", "Allegro moderato in D minor", "Allegro moderato - tempo di marcia in D major"].map((piece, i) => `Études-tableaux op. 39: ${piece}, no. ${i + 1}`).map(tag("Sergei Rachmaninoff")) },
    // The old key's grouping, rebuilt with a GROUPING tag the real tracks lack.
    { id: "valses", album: "The Complete Liszt Piano Music", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: valses.map(tag("Franz Liszt", { grouping: "Valses oubliées, S215 No. 2" })) },
    { id: "fiancee", album: "The Complete Liszt Piano Music 2", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: ['Grande fantaisie sur la tyrolienne de "La fiancée", S385i', 'Tyrolean Melody from the opera "La fiancée" by Auber, S385a'].map(liszt) },
  ]);
  const match = (albumId, providerMatches) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true, ...(providerMatches && { providerMatches }) });
  const track = (core) => c.db.prepare("SELECT id FROM track_link WHERE core_id=?").get(core).id;
  const groups = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.title, group.workId, group.items.map((item) => item.title)]);
  for (const albumId of ["ampico", "valses", "fiancee"]) match(albumId);
  // The editor's album choice on op. 39.
  const [[, etudes]] = groups("ampico");
  c.audit("editor.choose-album-work", etudes, { values: { albumId: "fantasia", work: etudes } }, "1");
  // One work of four valses, as the real tracks (no GROUPING) now read.
  const [[, valse2, rows]] = groups("valses");
  assert.equal(rows.length, 4);
  c.db.prepare("UPDATE track_link SET evidence=json_remove(evidence,'$.hints.grouping') WHERE core_id LIKE 'valses-%'").run();
  // S385a joined S385i's work, as a MusicBrainz match did under 1.0.22 keys.
  const fiancee = groups("fiancee")[0][1];
  c.externalIdentity(fiancee, "musicbrainz", "work", "mb-385i", { evidence: {} });
  match("fiancee", new Map([[track("fiancee-1"), { workId: "mb-385a", work: "Tyrolean Melody, S385a", movement: null, standalone: true, aliases: [], composers: ["Franz Liszt"], composerIds: {} }]]));
  assert.ok(mergeWork(c, fiancee, groups("fiancee").find(([title]) => /S385a/.test(title))[1], "model-scan"));
  assert.equal(groups("fiancee").filter(([, work]) => work === fiancee).length, 2);
  // Two Fairy Queens, MusicBrainz says two works.
  const purcell = c.createEntity("person", { roles: ["composer"] });
  new Metadata(c).derived(purcell, "name", "Henry Purcell");
  const queens = ["mb-queen-1", "mb-queen-2"].map((mbid, i) => {
    const id = c.createEntity("work");
    new Metadata(c).derived(id, "title", "The Fairy Queen, Z. 629");
    c.credit(id, purcell, "composer", { position: 1 });
    c.externalIdentity(id, "embedded-tags", "album-work", `queen-${i}`, { evidence: { albumId: "queen" } });
    c.externalIdentity(id, "musicbrainz", "work", mbid, { evidence: {} });
    return id;
  });

  autoMatchTaggedWorks(c, { actor: "model-scan", allowStructuredTitles: true });
  // Op. 39 took the fuller album despite the album choice.
  assert.deepEqual(groups("lugansky").map(([, work, items]) => [work, items.length]), [[etudes, 9]]);
  // Each valse is its own work; No. 2 keeps its work, with only its movement.
  const valseWorks = groups("valses");
  assert.equal(new Set(valseWorks.map(([, work]) => work)).size, 4);
  assert.ok(valseWorks.every(([, work]) => work));
  assert.equal(valseWorks.find(([, , items]) => items.includes(valses[0]))[1], valse2);
  assert.ok(workMovementTitles(c, valse2).length <= 1);
  // S385a comes off, and MusicBrainz naming S385i's work for it later does
  // not put it back or make a second S385i.
  assert.notEqual(groups("fiancee").find(([, , items]) => items.some((item) => /S385a/.test(item)))?.[1], fiancee);
  match("fiancee", new Map([[track("fiancee-1"), { workId: "mb-385i", work: 'Grande fantaisie sur la tyrolienne de "La fiancée", S385i', movement: null, standalone: true, aliases: [], composers: ["Franz Liszt"], composerIds: {} }]]));
  assert.notEqual(groups("fiancee").find(([, , items]) => items.some((item) => /S385a/.test(item)))?.[1], fiancee);
  const titled385i = c.db
    .prepare("SELECT count(*) AS n FROM entity e JOIN metadata_target m ON m.entity_id=e.id JOIN field_resolution f ON f.target_id=m.id AND f.field='title' JOIN assertion a ON a.id=f.assertion_id WHERE e.kind='work' AND e.deleted_at IS NULL AND a.value LIKE '%S385i%'")
    .get().n;
  assert.equal(titled385i, 1);
  // The Fairy Queens stay two works, and an admin is asked.
  assert.ok(queens.every((id) => c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(id).deleted_at == null));
  assert.equal(c.db.prepare("SELECT json_extract(evidence,'$.reason') AS reason FROM review_item WHERE status='open' AND kind='identity' AND target_id=?").get(queens[1])?.reason, "duplicate-work");
});

// From the first scan on 1.0.28: the repair took Liszt's S121 concerto out of
// the S121a work, but under the 1.0.22 stem key both were one group, so the
// album's record of making "S121" sat on the S121a work and refused it.
test("matching: an album record left on another number's work does not keep a split piece out", async (t) => {
  const liszt = (title) => ({ title, composer: ["Franz Liszt"], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    { id: "howard", album: "Liszt", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: ["De profundis, S121a: I. Andante", "De profundis, S121a: II. Allegro", "Concerto 'Malédiction', S121: I. Quasi moderato", "Concerto 'Malédiction', S121: II. Un poco più animato"].map(liszt) },
  ]);
  const key = (subject) => JSON.stringify(["i", "howard", JSON.stringify([["franz liszt"], subject]), ["franz liszt"], "structured-title"]);
  const record = (subject) => createHash("sha256").update(JSON.stringify(["album-work", key(subject)])).digest("hex");
  // The S121a work made first, holding the record the S121 group now has.
  autoMatchTaggedWorks(c, { albumId: "howard", actor: "admin", allowStructuredTitles: true });
  const groups = () => renderAlbumPresentation(c, "howard").groups.map((group) => [group.title, group.workId]);
  const [[, profundis], [, concerto]] = groups();
  for (const item of c.db.prepare("SELECT i.id FROM realization_item i JOIN realization r ON r.id=i.realization_id WHERE r.work_id=?").all(concerto)) c.detachItem(item.id, { dropRecording: true });
  c.db.prepare("UPDATE external_identity SET entity_id=? WHERE record_id=?").run(profundis, record("cat:s:121"));
  c.db.prepare("UPDATE entity SET deleted_at=? WHERE id=?").run(Date.now(), concerto);
  autoMatchTaggedWorks(c, { albumId: "howard", actor: "admin", allowStructuredTitles: true });
  const after = groups();
  assert.equal(after.length, 2);
  assert.ok(after[1][1] && after[1][1] !== profundis);
  assert.equal(c.db.prepare("SELECT state FROM external_identity WHERE entity_id=? AND record_id=?").get(profundis, record("cat:s:121")).state, "stale");
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE status='open' AND kind='identity'").get().n, 0);
  // The same record on a work with this number still keeps the tracks out.
  for (const item of c.db.prepare("SELECT i.id FROM realization_item i JOIN realization r ON r.id=i.realization_id WHERE r.work_id=?").all(after[1][1])) c.detachItem(item.id, { dropRecording: true });
  autoMatchTaggedWorks(c, { albumId: "howard", actor: "admin", allowStructuredTitles: true });
  assert.equal(groups().filter(([, work]) => work).length, 1);
});

// From the user's library: film scores tagged Classical (Interstellar, The
// Hobbit, The Lord of the Rings, Mulan) were classical, because a classical
// genre beside a soundtrack decided alone, and an album titled "Original
// Motion Picture Soundtrack" was no soundtrack at all to the classifier.
test("classification: a film score is not classical from a Classical tag; a classical work in a soundtrack still is", () => {
  const score = (album, composer, genres, extra = {}) => decide({ title: "Main Title", album, albumArtist: composer, artist: composer, composer: [composer], genres, ...extra });
  assert.equal(score("Interstellar: Original Motion Picture Soundtrack", "Hans Zimmer", ["Classical"]), "not_classical");
  assert.equal(score("The Hobbit: An Unexpected Journey: Original Motion Picture Soundtrack", "Howard Shore", ["Classical", "Soundtrack"]), "not_classical");
  assert.equal(score("Star Wars: The Last Jedi: Original Motion Picture Soundtrack", "John Williams", []), "not_classical");
  assert.equal(score("Mulan", "Harry Gregson-Williams", ["Classical", "Film Score"]), "not_classical");
  // Credited apart from its performers, with nothing verifiable: review.
  assert.equal(score("The Hobbit: Original Motion Picture Soundtrack", "Howard Shore", ["Classical"], { artist: "London Philharmonic Orchestra", composerDistinct: true }), "unsure");
  // A verified classical work on a soundtrack, and a classical album, stay.
  assert.equal(decide({ title: "Piano Concerto No. 20 in D minor, K. 466: II. Romance", album: "Amadeus (Original Soundtrack)", artist: "Academy of St Martin in the Fields", composer: ["Wolfgang Amadeus Mozart"], composerDistinct: true, genres: ["Classical", "Soundtrack"] }), "classical");
  assert.equal(decide({ title: "Symphony No. 5 in C minor, Op. 67: I. Allegro con brio", album: "Beethoven: Symphonies", artist: "Berliner Philharmoniker", composer: ["Ludwig van Beethoven"], composerDistinct: true, genres: ["Classical"] }), "classical");
  // A word that only contains "ost" is no soundtrack.
  assert.equal(decide({ title: "Ghost Trio, Op. 70 No. 1: I. Allegro vivace", album: "Ghost Trio", composer: ["Ludwig van Beethoven"], composerDistinct: true, genres: ["Classical"] }), "classical");
});

// From the user's library: one piece of a set on a recital ("2 Poèmes, Op.
// 69: no. 1, Allegretto", one prelude of Rachmaninoff's Op. 32) was refused
// as "only one track of a work with movements". A piece of a set is a whole
// piece; one movement of a sonata alone still is refused. The album page
// lists no "missing" pieces for a set it plays only a few of.
test("matching: one piece of a set on an album is matched to the set; its other pieces are not missing there", async (t) => {
  const tag = (composer) => (title) => ({ title, composer: [composer], genres: ["Classical"] });
  const c = await catalogueWith(t, [
    { id: "poemes", album: "Scriabin", albumArtist: "Pianist", artist: "Pianist", titles: ["2 Poèmes, Op. 69: no. 1, Allegretto", "3 Morceaux, Op. 45: no. 1, Feuillet d'album", "Piano Sonata no. 3, op. 23: I. Drammatico"].map(tag("Alexander Scriabin")) },
    { id: "full", album: "Rachmaninoff: Preludes", albumArtist: "Pianist", artist: "Pianist", titles: Array.from({ length: 13 }, (_, i) => `13 Preludes, Op. 32: No. ${i + 1}`).map(tag("Sergei Rachmaninoff")) },
    { id: "recital", album: "Recital", albumArtist: "Pianist", artist: "Pianist", titles: ["13 Preludes, Op. 32: No. 12"].map(tag("Sergei Rachmaninoff")) },
  ]);
  for (const albumId of ["poemes", "full", "recital"]) autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const groups = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.title, Boolean(group.workId), group.items.map((item) => item.title), group.missing.length]);
  assert.deepEqual(groups("poemes"), [
    ["2 Poèmes, Op. 69", true, ["no. 1, Allegretto"], 0],
    ["3 Morceaux, Op. 45", true, ["no. 1, Feuillet d'album"], 0],
    // One movement of a sonata stays unmatched.
    ["Piano Sonata no. 3, op. 23", false, ["I. Drammatico"], 0],
  ]);
  const [[, matched, rows, missing]] = groups("recital");
  assert.deepEqual([matched, rows, missing], [true, ["No. 12"], 0]);
  // The full album still lists nothing missing, and a sonata missing a
  // movement still would.
  assert.equal(groups("full")[0][3], 0);
});

// From the 1.0.36 audit: fuller albums of a work turned away as
// movement-mismatch reviews. Variation tracks named by number with other
// tempo words than the album that made the work ("Variation 12: Tempo di
// minuetto" for "XII. Tempo di menuetto"); an edition numbering Carnaval
// without "Sphinxes" and spelling "Colombine"; a concerto work listing a
// second recording's three movements again after the first's.
test("matching: variations by number, editions numbered one apart, and a work listing its movements twice", async (t) => {
  const tag = (composer) => (title) => ({ title, composer: [composer], genres: ["Classical"] });
  const rach = tag("Sergei Rachmaninoff");
  const schumann = tag("Robert Schumann");
  const carnaval = ["Préambule", "Pierrot", "Arlequin", "Valse noble", "Eusebius", "Florestan", "Coquette", "Réplique", "Sphinxes", "Papillons", "A.S.C.H - S.C.H.A. (Lettres dansantes)", "Chiarina", "Chopin", "Estrella", "Reconnaissance", "Pantalon et Columbine", "Valse allemande", "Paganini: Intermezzo", "Aveu", "Promenade", "Pause", 'Marche des "Davidsbündler" contre les Philistins'];
  const roman = (n) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII"][n - 1];
  const concerto = (movements) => movements.map((m) => `Piano Concerto no. 2 in C minor, op. 18: ${m}`).map(rach);
  const c = await catalogueWith(t, [
    { id: "combined", album: "Rhapsody on a Theme of Paganini", albumArtist: "Pianist", artist: "Pianist", titles: ["Introduction: Allegro vivace / I. (Precedente)", "Theme: L'istesso tempo / II. L'istesso tempo", "X. Poco marcato / XI. Moderato / XII. Tempo di menuetto"].map((m) => `Rhapsody on a Theme of Paganini, op. 43: ${m}`).map(rach) },
    { id: "complete", album: "The Complete Recordings", albumArtist: "Pianist", artist: "Pianist", titles: ["Introduction: Allegro vivace", "Variation 1: (Precedente)", "Tema: L'istesso tempo", "Variation 2: L'istesso tempo", "Variation 10: L'istesso tempo", "Variation 11: Moderato", "Variation 12: Tempo di minuetto"].map((m) => `Rhapsody on a Theme of Paganini, op. 43: ${m}`).map(rach) },
    { id: "carnaval", album: "Schumann", albumArtist: "Pianist", artist: "Pianist", titles: carnaval.map((m, i) => `Carnaval, Op. 9: ${roman(i + 1)}. ${m}`).map(schumann) },
    { id: "history", album: "The History of Classical Music", albumArtist: "Various Artists", artist: "Pianist", titles: ["I. Préambule", "II. Pierrot", "III. Arlequin", "IV. Valse noble", "V. Eusebius", "VI. Florestan", "VII. Coquette", "VIII. Réplique – (Sphinxes)", "IX. Papillons", "X. A.S.C.H. – S.C.H.A. (Lettres dansantes)", "XI. Chiarina", "XII. Chopin", "XIII. Estrella", "XIV. Reconnaissance", "XV. Pantalon et Colombine", "XVIa. Valse Allemande", "XVIb. Paganini. Intermezzo", "XVIII. Aveu. Passionato", "XIX. Promenade. Comodo", "XX. Pause. Vivo", "XXI. Marche des “Davidsbündler” contre les Philistins"].map((m) => `Carnaval, op. 9: ${m}`).map(schumann) },
    { id: "first", album: "Rachmaninoff Plays", albumArtist: "Pianist", artist: "Pianist", titles: concerto(["I. Moderato; Allegro", "II. Adagio sostenuto", "III. Allegro scherzando"]) },
    { id: "second", album: "Rachmaninoff with Stokowski", albumArtist: "Pianist", artist: "Pianist", titles: concerto(["I. Moderato - Allegro (Stokowski)", "II. Adagio sostenuto (Stokowski)", "III. Allegro scherzando (Stokowski)"]) },
    { id: "later", album: "Piano Concertos nos. 1 & 2", albumArtist: "Pianist", artist: "Pianist", titles: concerto(["I. Moderato", "II. Adagio sostenuto", "III. Allegro scherzando"]) },
  ]);
  const match = (albumId) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  const blocks = (albumId) => renderAlbumPresentation(c, albumId).groups.map((group) => [group.workId, group.items.length]);
  const items = (albumId) =>
    c.db
      .prepare(
        `SELECT i.movement_id FROM realization_item i JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
         WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY i.sequence`,
      )
      .all(albumId)
      .map((row) => row.movement_id);
  const mismatches = () => c.db.prepare("SELECT COUNT(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").get().n;

  match("combined");
  match("complete");
  const [[rhapsody]] = blocks("combined");
  assert.deepEqual(blocks("complete"), [[rhapsody, 7]]);
  const sections = workMovementTitles(c, rhapsody, true);
  assert.deepEqual(items("complete").map((id) => sections.indexOf(id) + 1), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(items("combined").map((id) => sections.indexOf(id) + 1), [1, 2, 3, 4, 5, 6, 7]);

  match("carnaval");
  match("history");
  const [[work]] = blocks("carnaval");
  assert.deepEqual(blocks("history"), [[work, 21]]);
  const pieces = workMovementTitles(c, work, true);
  // Sphinxes (9) and Paganini's own number (18) are this edition's
  // Réplique and XVIb; everything else by name.
  assert.deepEqual(items("history").map((id) => pieces.indexOf(id) + 1), [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);

  match("first");
  match("second");
  const [[pc2]] = blocks("first");
  assert.deepEqual(blocks("second"), [[pc2, 3]]);
  // The 1.0.22 shape: the second recording's movements listed again.
  const metadata = new Metadata(c);
  const titles = ["I. Moderato - Allegro (Stokowski)", "II. Adagio sostenuto (Stokowski)", "III. Allegro scherzando (Stokowski)"];
  const copies = titles.map((title, i) => {
    const movement = c.createEntity("movement");
    metadata.derived(movement, "title", title);
    c.relate("movement", pc2, movement, { position: 4 + i });
    return movement;
  });
  items("second").forEach((from, i) => {
    c.db.prepare("UPDATE realization_item SET movement_id=? WHERE movement_id=? AND id IN (SELECT i.id FROM realization_item i JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)='second')").run(copies[i], from);
    c.db.prepare("UPDATE recording_content SET movement_id=? WHERE movement_id=? AND recording_id IN (SELECT c.recording_id FROM recording_content c JOIN segment_content x ON x.content_id=c.id JOIN segment s ON s.id=x.segment_id JOIN track_link t ON t.id=s.track_link_id WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)='second')").run(copies[i], from);
  });
  assert.equal(workMovementTitles(c, pc2).length, 6);
  match("later");
  assert.deepEqual(workMovementTitles(c, pc2), ["I. Moderato; Allegro", "II. Adagio sostenuto", "III. Allegro scherzando"]);
  const three = workMovementTitles(c, pc2, true);
  for (const albumId of ["first", "second", "later"]) assert.deepEqual(items(albumId), three);
  assert.equal(mismatches(), 0);
});

// From explain-works on the 1.0.37 install: 1.0.22 matched a box's two
// recordings of a piece as one recording, so the work listed every
// movement twice and the fold (which needs separate recordings) left it.
// The recording is split, then folded; The Seasons, whose second "Troika"
// names the work, then takes a full album's twelve pieces.
test("matching: one recording listing a piece twice splits into two, folds, and the work expands", async (t) => {
  const tag = (composer) => (title) => ({ title, composer: [composer], genres: ["Classical"] });
  const rach = tag("Sergei Rachmaninoff");
  const months = ["January. By the Fireside. Moderato semplice ma espressivo", "February. Carnaval. Allegro giusto", "March. Song of the Lark. Andantino espressivo", "April. Snowdrop. Allegretto con moto e un poco rubato", "May. White Nights. Andantino", "June. Barcarolle. Andante cantabile", "July. Song of the Reaper. Allegro moderato con moto", "August. The Harvest. Allegro vivace", "September. The Hunt. Allegro non troppo", "October. Autumn Song. Andante doloroso e molto cantabile", "November. Troïka. Allegro moderato", "December. Christmas. Tempo di valse"];
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  const c = await catalogueWith(t, [
    { id: "box", album: "The Complete Recordings", albumArtist: "Sergei Rachmaninoff", artist: "Sergei Rachmaninoff", titles: [...["I. Moderato; Allegro", "II. Adagio sostenuto", "III. Allegro scherzando"].map((m) => `Piano Concerto no. 2 in C minor, op. 18: ${m}`), ...["I. Moderato - Allegro (Stokowski)", "II. Adagio sostenuto (Stokowski)", "III. Allegro scherzando (Stokowski)"].map((m) => `Piano Concerto No. 2 in C minor, Op. 18: ${m}`)].map(rach).concat(["The Seasons, op. 37a: Troika (The Seasons: November)", "The Seasons, op. 37a: November: Troika"].map(tag("Pyotr Tchaikovsky"))) },
    { id: "later", album: "Piano Concertos nos. 1 & 2", albumArtist: "Pianist", artist: "Pianist", titles: ["I. Moderato", "II. Adagio sostenuto", "III. Allegro scherzando"].map((m) => `Piano Concerto no. 2 in C minor, op. 18: ${m}`).map(rach) },
    { id: "lim", album: "The Seasons", albumArtist: "Yunchan Lim", artist: "Yunchan Lim", titles: months.map((m, i) => `The Seasons, op. 37a: ${roman[i]}. ${m}`).map(tag("Pyotr Tchaikovsky")) },
  ]);
  const match = (albumId) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  match("box");
  const groups = renderAlbumPresentation(c, "box").groups;
  const pc2 = groups[0].workId;
  const seasons = groups.find((group) => /Seasons/.test(group.title)).workId;
  assert.ok(pc2 && seasons);
  // The 1.0.22 shape: each work's movements listed once per recording, all
  // in one recording of the box.
  const metadata = new Metadata(c);
  const realizationOf = (work) => c.db.prepare("SELECT id,performance_work_id FROM realization WHERE work_id=? ORDER BY rowid").all(work);
  const legacy = (work, titles) => {
    const [keep, ...others] = realizationOf(work);
    let position = workMovementTitles(c, work).length;
    let sequence = c.db.prepare("SELECT max(sequence) AS n FROM realization_item WHERE realization_id=?").get(keep.id).n;
    for (const other of others) {
      const items = c.db.prepare("SELECT * FROM realization_item WHERE realization_id=? ORDER BY sequence").all(other.id);
      items.forEach((item, i) => {
        const movement = c.createEntity("movement");
        metadata.derived(movement, "title", titles[i]);
        c.relate("movement", work, movement, { position: ++position });
        c.db.prepare("UPDATE realization_item SET realization_id=?,movement_id=?,sequence=? WHERE id=?").run(keep.id, movement, ++sequence, item.id);
        c.db.prepare("UPDATE recording_content SET movement_id=?,performance_work_id=? WHERE performance_work_id=? AND movement_id IS ?").run(movement, keep.performance_work_id, other.performance_work_id, item.movement_id);
      });
      const performance = c.db.prepare("SELECT source_id FROM relation WHERE id=?").get(other.performance_work_id).source_id;
      const kept = c.db.prepare("SELECT source_id FROM relation WHERE id=?").get(keep.performance_work_id).source_id;
      c.db.prepare("UPDATE relation SET target_id=? WHERE kind='recording_performance' AND target_id=?").run(kept, performance);
      c.db.prepare("DELETE FROM realization WHERE id=?").run(other.id);
    }
  };
  if (realizationOf(pc2).length === 2) legacy(pc2, ["I. Moderato - Allegro (Stokowski)", "II. Adagio sostenuto (Stokowski)", "III. Allegro scherzando (Stokowski)"]);
  if (realizationOf(seasons).length === 2) legacy(seasons, ["November: Troika"]);
  assert.equal(workMovementTitles(c, pc2).length, 6);
  assert.deepEqual(workMovementTitles(c, seasons), ["Troika (The Seasons: November)", "November: Troika"]);
  assert.equal(realizationOf(pc2).length, 1);

  match("later");
  match("lim");
  assert.deepEqual(workMovementTitles(c, pc2), ["I. Moderato; Allegro", "II. Adagio sostenuto", "III. Allegro scherzando"]);
  assert.equal(realizationOf(pc2).length, 3);
  // Every recording's tracks on the three movements, each its own performance.
  const three = workMovementTitles(c, pc2, true);
  for (const { id } of realizationOf(pc2)) assert.deepEqual(c.db.prepare("SELECT movement_id FROM realization_item WHERE realization_id=? ORDER BY sequence").all(id).map((row) => row.movement_id), three);
  const performances = c.db.prepare("SELECT count(DISTINCT p.source_id) AS n FROM realization r JOIN relation p ON p.id=r.performance_work_id WHERE r.work_id=?").get(pc2).n;
  assert.equal(performances, 3);
  for (const content of c.db.prepare("SELECT c.recording_id,pw.source_id AS performance FROM recording_content c JOIN relation pw ON pw.id=c.performance_work_id WHERE pw.target_id=?").all(pc2))
    assert.ok(c.db.prepare("SELECT 1 FROM relation WHERE kind='recording_performance' AND source_id=? AND target_id=?").get(content.recording_id, content.performance));
  // The Seasons: one Troika, two recordings of it, then all twelve.
  assert.equal(workMovementTitles(c, seasons).length, 12);
  assert.equal(workMovementTitles(c, seasons)[10], "Troika (The Seasons: November)");
  assert.deepEqual(renderAlbumPresentation(c, "lim").groups.map((group) => [group.workId, group.items.length]), [[seasons, 12]]);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").get().n, 0);
});

// The user asked for variation sets with a movement per variation. A work
// an album made with several variations a track (Rachmaninoff's Paganini
// Rhapsody from album 831) held each track as one movement, and albums
// with a track per variation shared those. The library pass now gives the
// work one movement per section and places every recording again; the
// album page still plays each track once.
test("matching: a work made with several variations a movement gets a movement per variation", async (t) => {
  const rach = (title) => ({ title, composer: ["Sergei Rachmaninoff"], genres: ["Classical"] });
  const rhapsody = (m) => `Rhapsody on a Theme of Paganini, op. 43: ${m}`;
  const c = await catalogueWith(t, [
    { id: "combined", album: "Rhapsody on a Theme of Paganini", albumArtist: "Pianist", artist: "Pianist", titles: ["Introduction: Allegro vivace / I. (Precedente)", "Theme: L'istesso tempo / II. L'istesso tempo / III. L'istesso tempo", "IV. Più vivo"].map(rhapsody).map(rach) },
    { id: "complete", album: "The Complete Recordings", albumArtist: "Pianist", artist: "Pianist", titles: ["Introduction: Allegro vivace", "Variation 1: (Precedente)", "Tema: L'istesso tempo", "Variation 2: L'istesso tempo", "Variation 3: L'istesso tempo", "Variation 4: Più vivo"].map(rhapsody).map(rach) },
    { id: "trifonov", album: "Rachmaninoff - Piano Works", albumArtist: "Daniil Trifonov", artist: "Daniil Trifonov", titles: ["Introduction. Allegro vivace - Variation No. 1 (Precedente)", "Tema. L'istesso tempo", "Variation No. 2 L'istesso tempo", "Variation No. 3 L'istesso tempo", "Variation No. 4 Più vivo"].map((m) => `Rachmaninoff: Rhapsody on a Theme of Paganini, Op. 43: ${m}`).map(rach) },
  ]);
  const match = (albumId) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true });
  match("combined");
  match("complete");
  const work = renderAlbumPresentation(c, "combined").groups[0].workId;
  const fine = ["Introduction: Allegro vivace", "I. (Precedente)", "Theme: L'istesso tempo", "II. L'istesso tempo", "III. L'istesso tempo", "IV. Più vivo"];
  assert.deepEqual(workMovementTitles(c, work), fine);
  const itemsOf = (albumId) =>
    c.db
      .prepare(
        `SELECT i.id,i.movement_id,i.segment_id,i.realization_id,i.sequence FROM realization_item i JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
         WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY i.sequence`,
      )
      .all(albumId);
  // The 1.0.37 shape: album 831's tracks are the work's movements, each
  // titled with its sections; the other album's tracks share them.
  const metadata = new Metadata(c);
  const ids = workMovementTitles(c, work, true);
  const groups = [];
  for (const item of itemsOf("combined")) {
    if (groups.at(-1)?.segment === item.segment_id) groups.at(-1).movements.push(item.movement_id);
    else groups.push({ segment: item.segment_id, movements: [item.movement_id] });
  }
  for (const { segment, movements } of groups) {
    const [keep, ...drop] = movements;
    if (!drop.length) continue;
    metadata.derived(keep, "title", movements.map((id) => fine[ids.indexOf(id)]).join(" / "));
    for (const id of drop) {
      for (const extra of c.db.prepare("SELECT id FROM realization_item WHERE segment_id=? AND movement_id=?").all(segment, id)) c.db.prepare("DELETE FROM realization_item WHERE id=?").run(extra.id);
      for (const { content_id } of c.db.prepare("SELECT x.content_id FROM segment_content x JOIN recording_content r ON r.id=x.content_id WHERE x.segment_id=? AND r.movement_id=?").all(segment, id)) {
        c.db.prepare("DELETE FROM segment_content WHERE content_id=?").run(content_id);
        c.db.prepare("DELETE FROM recording_content WHERE id=?").run(content_id);
      }
      c.db.prepare("UPDATE realization_item SET movement_id=? WHERE movement_id=?").run(keep, id);
      c.db.prepare("UPDATE recording_content SET movement_id=? WHERE movement_id=?").run(keep, id);
      c.db.prepare("DELETE FROM relation WHERE kind='movement' AND target_id=?").run(id);
      c.db.prepare("UPDATE entity SET deleted_at=1 WHERE id=?").run(id);
    }
  }
  for (const { id } of c.db.prepare("SELECT id FROM realization WHERE work_id=?").all(work)) {
    const seen = new Map();
    for (const item of c.db.prepare("SELECT id,movement_id FROM realization_item WHERE realization_id=? ORDER BY sequence").all(id)) {
      seen.set(item.movement_id, (seen.get(item.movement_id) || 0) + 1);
      c.db.prepare("UPDATE realization_item SET occurrence=? WHERE id=?").run(seen.get(item.movement_id), item.id);
    }
  }
  assert.equal(workMovementTitles(c, work).length, 3);

  // The library pass splits it; the next album joins variation by variation.
  autoMatchTaggedWorks(c, { actor: "admin", allowStructuredTitles: true });
  match("trifonov");
  assert.deepEqual(workMovementTitles(c, work), fine);
  const position = (albumId) => itemsOf(albumId).map((item) => workMovementTitles(c, work, true).indexOf(item.movement_id) + 1);
  assert.deepEqual(position("combined"), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(position("complete"), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(position("trifonov"), [1, 2, 3, 4, 5, 6]);
  // Every content of the recordings names a live movement of this work.
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM recording_content c JOIN entity e ON e.id=c.movement_id WHERE e.deleted_at IS NOT NULL").get().n, 0);
  // Pages: one row per track, its sections named together; the work page
  // counts every recording complete.
  assert.deepEqual(renderAlbumPresentation(c, "combined").groups.map((group) => group.items.map((item) => item.title)), [["Introduction: Allegro vivace / I. (Precedente)", "Theme: L'istesso tempo / II. L'istesso tempo / III. L'istesso tempo", "IV. Più vivo"]]);
  assert.deepEqual(renderAlbumPresentation(c, "trifonov").groups.map((group) => group.items.length), [5]);
  const page = renderWork(c, work, { id: 1, role: "admin" });
  assert.equal(page.work.movements.length, 6);
  assert.deepEqual(page.recordings.map((recording) => [recording.items.length, recording.complete]).sort(), [[3, true], [5, true], [6, true]]);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").get().n, 0);
});

// From explain-musicbrainz on the user's library: MusicBrainz names the
// work, and matching refused it because two tracks share a title. Pictures
// at an Exhibition has four "Promenade"s MusicBrainz tells apart; a box of
// one pianist's recordings plays the Op. 64 waltzes in two sessions.
test("matching: MusicBrainz tells same-titled movements apart; a set recorded twice in a box is two recordings", async (t) => {
  const tag = (composer, extra = {}) => (title) => ({ title, composer: [composer], genres: ["Classical"], ...extra });
  const pictures = ["Promenade", "I. Gnomus", "Promenade", "II. The Old Castle", "Promenade", "X. The Great Gate of Kiev"];
  const named = ["Promenade. Allegro giusto", "I. Gnomus", "Promenade. Moderato comodo", "II. Il vecchio castello", "Promenade. Moderato non tanto", "X. The Great Gate of Kiev"];
  const c = await catalogueWith(t, [
    { id: "pictures", album: "History of Classical Music", albumArtist: "Various Artists", artist: "Orchestra", titles: pictures.map((m) => `Pictures at an Exhibition: ${m}`).map(tag("Modest Mussorgsky")) },
    {
      id: "box",
      album: "The Complete Recordings",
      albumArtist: "Sergei Rachmaninoff",
      artist: "Sergei Rachmaninoff",
      titles: [
        tag("Frédéric Chopin", { trackNumber: 1, discNumber: 6 })("Waltz in C-sharp minor, Op. 64 No. 2"),
        tag("Frédéric Chopin", { trackNumber: 2, discNumber: 6 })("Waltz in A-flat major, Op. 64 No. 3"),
        tag("Frédéric Chopin", { trackNumber: 9, discNumber: 10 })("Waltz in A-flat major, Op. 64 No. 3"),
      ],
    },
  ]);
  const ids = (albumId) => c.db.prepare("SELECT id FROM track_link WHERE CAST(json_extract(evidence,'$.albumId') AS TEXT)=? ORDER BY json_extract(evidence,'$.hints.discNumber'),json_extract(evidence,'$.hints.trackNumber')").all(albumId).map((row) => row.id);
  const provider = (workId, work, composers, movements) => (id, i) => [id, { workId, work, movement: movements?.[i] ?? null, aliases: [], composers, composerIds: {} }];
  const match = (albumId, matches) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true, providerMatches: new Map(matches) });
  match("pictures", ids("pictures").map(provider("mb-pictures", "Pictures at an Exhibition", ["Modest Mussorgsky"], named)));
  assert.deepEqual(renderAlbumPresentation(c, "pictures").groups.map((group) => [group.title, group.items.length, Boolean(group.workId)]), [["Pictures at an Exhibition", 6, true]]);
  match("box", ids("box").map(provider("mb-op64", "Waltzes, op. 64", ["Frédéric Chopin"])));
  const groups = renderAlbumPresentation(c, "box").groups;
  assert.deepEqual(groups.map((group) => [group.title, group.items.length]), [["Waltzes, op. 64", 2], ["Waltzes, op. 64", 1]]);
  assert.equal(groups[0].workId, groups[1].workId);
  assert.notEqual(groups[0].id, groups[1].id);
});

// The user: a single excerpt now joins its work, as Apple Music Classical
// files it. Excerpts of an opera on two albums, then the whole opera,
// must end up one work in the opera's order, each excerpt on its movement;
// so must the opera first and an excerpt later. MusicBrainz's own work for
// each movement settles it; without one, the excerpt's words do.
test("matching: excerpts of an opera, then the whole opera, are one work; and the other way round", async (t) => {
  const puccini = (title) => ({ title, composer: ["Giacomo Puccini"], genres: ["Classical"] });
  const act = ["Act I. Gira la cote!", "Act I. Signore, ascolta!", "Act II. In questa reggia", "Act III. Nessun dorma!"];
  const leaves = ["mb-gira", "mb-signore", "mb-reggia", "mb-nessun"];
  const c = await catalogueWith(t, [
    { id: "tenors", album: "Great Tenors", albumArtist: "Various Artists", artist: "Tenor", titles: ["Turandot: Atto III. “Nessun dorma”"].map(puccini) },
    { id: "sopranos", album: "Great Sopranos", albumArtist: "Various Artists", artist: "Soprano", titles: ["Turandot, Act I: Signore, ascolta!"].map(puccini) },
    { id: "complete", album: "Turandot", albumArtist: "Orchestra", artist: "Orchestra", titles: act.map((m) => `Turandot: ${m}`).map(puccini) },
    { id: "late", album: "Encores", albumArtist: "Tenor", artist: "Tenor", titles: ["Turandot: Nessun dorma"].map(puccini) },
    // An excerpt, then the whole opera, whose MusicBrainz works for the
    // movements aren't the excerpt's (one is linked to an arrangement).
    { id: "aria", album: "Puccini Arias", albumArtist: "Tenor", artist: "Tenor", titles: ["La bohème: Act I. “Che gelida manina”"].map(puccini) },
    { id: "liszt", album: "The Complete Liszt Piano Music", albumArtist: "Leslie Howard", artist: "Leslie Howard", titles: [{ title: "Isoldens Liebestod – Schlußszene aus Richard Wagners “Tristan und Isolde”, S447", composer: ["Richard Wagner"], genres: ["Classical"] }] },
    { id: "boheme", album: "La bohème", albumArtist: "Orchestra", artist: "Orchestra", titles: ["Act I. Che gelida manina", "Act I. Sì. Mi chiamano Mimì", "Act IV. Sono andati?"].map((m) => `La bohème: ${m}`).map(puccini) },
  ]);
  const ids = (albumId) => c.db.prepare("SELECT id FROM track_link WHERE CAST(json_extract(evidence,'$.albumId') AS TEXT)=? ORDER BY json_extract(evidence,'$.hints.trackNumber')").all(albumId).map((row) => row.id);
  const turandot = (leaf) => ({ workId: "mb-turandot", work: "Turandot", movement: null, leafWorkId: leaf, aliases: [], composers: ["Giacomo Puccini"], composerIds: {} });
  const match = (albumId, leafs) => autoMatchTaggedWorks(c, { albumId, actor: "admin", allowStructuredTitles: true, providerMatches: new Map(leafs ? ids(albumId).map((id, i) => [id, turandot(leafs[i])]) : []) });
  const blocks = (albumId) => renderAlbumPresentation(c, albumId)?.groups.map((group) => [group.workId, group.items.map((item) => item.title), group.missing.length]) ?? [];
  const itemsOf = (albumId) =>
    c.db
      .prepare(
        `SELECT i.movement_id FROM realization_item i JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
         WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY i.sequence`,
      )
      .all(albumId)
      .map((row) => row.movement_id);

  // Two excerpt albums: one work, two movements, nothing listed missing.
  match("tenors", ["mb-nessun"]);
  match("sopranos", ["mb-signore"]);
  const [[work, , missing]] = blocks("tenors");
  assert.ok(work);
  assert.equal(missing, 0);
  assert.deepEqual(blocks("sopranos").map(([id, , gone]) => [id, gone]), [[work, 0]]);
  assert.equal(workMovementTitles(c, work).length, 2);

  // The whole opera: four movements in its order, each excerpt on its own.
  match("complete", leaves);
  assert.deepEqual(blocks("complete").map(([id, rows, gone]) => [id, rows.length, gone]), [[work, 4, 0]]);
  const movements = workMovementTitles(c, work, true);
  assert.equal(movements.length, 4);
  assert.deepEqual(itemsOf("complete"), movements);
  assert.deepEqual(itemsOf("tenors"), [movements[3]]);
  assert.deepEqual(itemsOf("sopranos"), [movements[1]]);

  // An excerpt after the opera, with no MusicBrainz work for its movement
  // here: its words find "Nessun dorma!".
  autoMatchTaggedWorks(c, { albumId: "late", actor: "admin", allowStructuredTitles: true, providerMatches: new Map(ids("late").map((id) => [id, turandot("mb-nessun-arranged")])) });
  assert.deepEqual(itemsOf("late"), [movements[3]]);
  assert.deepEqual(blocks("late").map(([id, , gone]) => [id, gone]), [[work, 0]]);
  assert.equal(workMovementTitles(c, work).length, 4);

  autoMatchTaggedWorks(c, { albumId: "aria", actor: "admin", allowStructuredTitles: true, providerMatches: new Map(ids("aria").map((id) => [id, { workId: "mb-boheme", work: "La bohème", movement: null, leafWorkId: "mb-manina-arranged", aliases: [], composers: ["Giacomo Puccini"], composerIds: {} }])) });
  const boheme = (leaf) => ({ workId: "mb-boheme", work: "La bohème", movement: null, leafWorkId: leaf, aliases: [], composers: ["Giacomo Puccini"], composerIds: {} });
  autoMatchTaggedWorks(c, { albumId: "boheme", actor: "admin", allowStructuredTitles: true, providerMatches: new Map(ids("boheme").map((id, i) => [id, boheme(["mb-manina", "mb-mimi", "mb-andati"][i])])) });
  const [[opera]] = blocks("aria");
  assert.ok(opera);
  assert.deepEqual(blocks("boheme").map(([id, rows]) => [id, rows.length]), [[opera, 3]]);
  assert.deepEqual(itemsOf("aria"), [workMovementTitles(c, opera, true)[0]]);
  // Liszt's transcription, which MusicBrainz files under Wagner's opera,
  // has a number of its own: it stays a track of its own.
  autoMatchTaggedWorks(c, { albumId: "liszt", actor: "admin", allowStructuredTitles: true, providerMatches: new Map(ids("liszt").map((id) => [id, { workId: "mb-tristan", work: "Tristan und Isolde, WWV 90", movement: null, leafWorkId: "mb-liebestod", aliases: [], composers: ["Richard Wagner"], composerIds: {} }])) });
  assert.deepEqual(itemsOf("liszt"), []);
  assert.equal(c.db.prepare("SELECT COUNT(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").get().n, 0);
});

// Works matched before 1.0.41 have no MusicBrainz work on their movements.
// The tracks' MusicBrainz Work Id tags give them one, so a later excerpt
// whose title names nothing in the work still finds its movement.
test("matching: movements take their MusicBrainz work from the tracks' Work Id tags", async (t) => {
  const puccini = (title, workId) => ({ title, composer: ["Giacomo Puccini"], genres: ["Classical"], workId });
  const acts = [["Act I. Gira la cote!", "mb-gira"], ["Act I. Signore, ascolta!", "mb-signore"], ["Act III. Nessun dorma!", "mb-nessun"]];
  const c = await catalogueWith(t, [
    { id: "complete", album: "Turandot", albumArtist: "Orchestra", artist: "Orchestra", titles: acts.map(([m, id]) => puccini(`Turandot: ${m}`, id)) },
    { id: "encore", album: "Encores", albumArtist: "Tenor", artist: "Tenor", titles: [puccini("Turandot: Calaf's aria", "mb-nessun")] },
  ]);
  const ids = (albumId) => c.db.prepare("SELECT id FROM track_link WHERE CAST(json_extract(evidence,'$.albumId') AS TEXT)=? ORDER BY json_extract(evidence,'$.hints.trackNumber')").all(albumId).map((row) => row.id);
  const turandot = (leaf) => ({ workId: "mb-turandot", work: "Turandot", movement: null, ...(leaf && { leafWorkId: leaf }), aliases: [], composers: ["Giacomo Puccini"], composerIds: {} });
  // Matched as before 1.0.41: no MusicBrainz work for the movements.
  autoMatchTaggedWorks(c, { albumId: "complete", actor: "admin", allowStructuredTitles: true, providerMatches: new Map(ids("complete").map((id) => [id, turandot(null)])) });
  c.db.prepare("DELETE FROM external_identity WHERE record_kind='movement-work'").run();
  const work = renderAlbumPresentation(c, "complete").groups[0].workId;
  assert.equal(recordTaggedLeaves(c), 3);
  assert.equal(recordTaggedLeaves(c), 0);
  autoMatchTaggedWorks(c, { albumId: "encore", actor: "admin", allowStructuredTitles: true, providerMatches: new Map(ids("encore").map((id) => [id, turandot("mb-nessun")])) });
  const movement = c.db
    .prepare("SELECT i.movement_id FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE s.track_link_id=?")
    .get(ids("encore")[0])?.movement_id;
  assert.equal(movement, workMovementTitles(c, work, true)[2]);
});
