// Regressions for messy-tag matching: composers read from mixed artist
// fields, comma-separated movements, colon-before-quote titles and opera
// headings with and without a catalogue number. Each test fails on the
// source before these fixes.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { tempFolders } from "./helpers.js";
import { artistCredits, composersOf } from "../src/model/credits.js";
import { classificationEvidence } from "../src/model/classify-evidence.js";
import { splitTitle, stripWorkPrefix, autoMatchTaggedWorks, withoutComposer, mapToMovements, movementParts } from "../src/model/auto-match.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { renderAlbumPresentation } from "../src/model/presentation.js";
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
