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
import { splitTitle, stripWorkPrefix, autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { renderAlbumPresentation } from "../src/model/presentation.js";
import { renderV2 } from "../src/model/editor-v2.js";

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
    titles.map((title, i) => ({
      coreId: `${id}-${i}`,
      fileId: `${id}-${i}`,
      path: `/library/${id}/${i}.flac`,
      size: 1000,
      durationMs: 60000,
      fingerprint: `audio-sha256-v2:${id}-${i}`,
      albumId: id,
      hints: { title, album, albumArtist, artist, composer: [], genres: [], work: "", trackNumber: i + 1, discNumber: 1 },
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
