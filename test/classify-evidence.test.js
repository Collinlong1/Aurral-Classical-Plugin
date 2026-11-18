import assert from "node:assert/strict";
import test from "node:test";
import { classificationEvidence, genreKinds } from "../src/model/classify-evidence.js";

const decide = (hints) => classificationEvidence(hints).decision;

test("classification: popular genres outweigh credits, titles and WORK tags", () => {
  // Synthetic hip-hop at its most misleading: a classical title, a WORK tag,
  // a credited classical composer. Still not classical.
  assert.equal(
    decide({ title: "Symphony No. 9 (Prelude)", work: "Ode Suite", genres: ["Hip-Hop/Rap"], composer: ["Nasir Jones", "Ludwig van Beethoven"], composerDistinct: true }),
    "not_classical",
  );
  assert.equal(decide({ title: "I Can", genres: ["Hip Hop"], composer: ["Nasir Jones", "Ludwig van Beethoven"], composerDistinct: true }), "not_classical");
  assert.equal(decide({ title: "Rolling in the Deep", genres: ["Pop"], composer: ["Adele Adkins", "Paul Epworth"], composerDistinct: true }), "not_classical");
  assert.equal(decide({ title: "Blue Rondo à la Turk", genres: ["Jazz"], composer: ["Dave Brubeck"], composerDistinct: true }), "not_classical");
  assert.equal(decide({ title: "Adagio for Strings", genres: ["Trance"], composer: ["Samuel Barber"], composerDistinct: true }), "not_classical");
  assert.equal(decide({ title: "II. About to Crash", work: "Six Degrees of Inner Turbulence", genres: ["Progressive Metal"] }), "not_classical");
  // Verifiable evidence against a popular genre goes to review, not classical.
  assert.equal(decide({ title: "Prelude No. 1 in C Major, BWV 846", genres: ["Jazz"], composer: ["Johann Sebastian Bach"], composerDistinct: true }), "unsure");
  assert.equal(decide({ title: "Piano Sonata K. 331", genres: ["Classical", "Pop"] }), "unsure");
});

test("classification: genre names are matched whole, not by substring", () => {
  for (const genre of ["Rock Opera", "Baroque Pop", "Chamber Pop", "New Romantic", "Synthpop"])
    assert.deepEqual(genreKinds([genre]).classical, [], genre);
  for (const genre of ["Classical", "Chamber Music", "Baroque", "Opera", "Modern Classical", "Contemporary Classical", "Choral"])
    assert.deepEqual(genreKinds([genre]).classical, [genre], genre);
  assert.deepEqual(genreKinds(["Classical Crossover"]).context, ["Classical Crossover"]);
  assert.deepEqual(genreKinds(["Video Game Music", "Soundtrack", "Score"]).context.length, 3);
  assert.equal(decide({ title: "Rio", genres: ["New Romantic"], composer: ["Duran Duran"] }), "not_classical");
  assert.equal(decide({ title: "Pinball Wizard", genres: ["Rock Opera"], composer: ["Pete Townshend"], composerDistinct: true }), "not_classical");
});

test("classification: a WORK tag naming the song is no evidence", () => {
  const picard = classificationEvidence({ title: "Get Lucky", work: "Get Lucky", composer: ["Pharrell Williams"], composerDistinct: true });
  assert.ok(!picard.signals.some((s) => s.signal === "WORK tag"));
  assert.equal(picard.decision, "unsure");
  // A real work above its movement still counts.
  assert.equal(decide({ title: "Symphony No. 5: I. Allegro con brio", work: "Symphony No. 5 in C minor, op. 67" }), "classical");
});

test("classification: soundtracks allow verified classical works only", () => {
  const soundtrack = (title, composer, artist = "Berliner Philharmoniker") => ({
    title,
    genres: ["Soundtrack"],
    composer: [composer],
    artist,
    composerDistinct: true,
  });
  assert.equal(decide(soundtrack("Also sprach Zarathustra, Op. 30: Einleitung", "Richard Strauss")), "classical");
  assert.equal(decide(soundtrack("Requiem in D Minor, K. 626: Lacrimosa", "Wolfgang Amadeus Mozart")), "classical");
  assert.equal(decide(soundtrack("Gayane Ballet Suite: Adagio", "Aram Khachaturian")), "classical");
  // Plausible but unverified: left for review.
  assert.equal(decide(soundtrack("Adagio for Strings", "Samuel Barber")), "unsure");
  assert.equal(decide(soundtrack("Lux Aeterna", "György Ligeti")), "unsure");
  assert.equal(decide(soundtrack("Main Title", "John Williams", "London Symphony Orchestra")), "unsure");
  // Composer is the performer and nothing classical: ordinary.
  assert.equal(decide({ title: "Cornfield Chase", genres: ["Soundtrack"], composer: ["Hans Zimmer"], artist: "Hans Zimmer" }), "not_classical");
  assert.equal(decide({ title: "Dragonborn", genres: ["Video Game Music"], composer: ["Jeremy Soule"], artist: "Jeremy Soule" }), "not_classical");
  // Crossover never classifies classical automatically.
  assert.equal(decide({ title: "Con te partirò", genres: ["Classical Crossover"], composer: ["Francesco Sartori"], composerDistinct: true }), "unsure");
});

test("classification: untagged classical still needs two kinds of evidence", () => {
  assert.equal(decide({ title: "II. Adagio sostenuto", album: "Piano Sonatas" }), "classical");
  assert.equal(decide({ title: "Seasons (Spring) - I. Allegro", album: "Vivaldi: The Four Seasons" }), "classical");
  assert.equal(decide({ title: "Etudes pour Piano - I. Désordre", album: "Ligeti: Études" }), "classical");
  // One supporting signal is not proof.
  assert.equal(decide({ title: "Eldorado Finale", album: "Eldorado – A Symphony by the Electric Light Orchestra", composer: ["Jeff Lynne"], composerDistinct: true }), "unsure");
  assert.equal(decide({ title: "Prelude" }), "unsure");
  assert.equal(decide({ title: "Aria", album: "Bach: The Goldberg Variations" }), "unsure");
  // "The Elder Scrolls V:" and "2001:" are not composers.
  assert.equal(decide({ title: "Awake", album: "The Elder Scrolls V: Skyrim" }), "not_classical");
  assert.equal(decide({ title: "Lux Aeterna", album: "2001: A Space Odyssey" }), "not_classical");
});

test("classification: the evidence adds up to the score and says why", () => {
  const result = classificationEvidence({ title: "Mass in C Minor, K. 427: Kyrie", genres: ["Soundtrack"], composer: ["Mozart"], composerDistinct: true });
  assert.equal(result.score, result.signals.reduce((sum, s) => sum + s.points, 0));
  assert.match(result.reason, /verified classical work/);
  assert.ok(result.signals.every((s) => ["strong", "supporting"].includes(s.kind)));
});

// L15 (#34): moods, radio formats and score genres support classical
// evidence but never decide alone; such a track with nothing else is unsure.
test("classification: Romantic, Contemporary, Avant-Garde and Orchestral alone are unsure", () => {
  for (const genre of ["Romantic", "Contemporary", "Avant-Garde", "Modern Composition", "Orchestral", "Symphony", "Minimalism"])
    assert.deepEqual([genreKinds([genre]).classical, genreKinds([genre]).ambiguous], [[], [genre]], genre);
  assert.equal(decide({ title: "Always Be Mine", artist: "A Singer", album: "Love Songs", genres: ["Romantic"] }), "unsure");
  assert.equal(decide({ title: "Shine On", artist: "A Band", album: "Greatest Hits", genres: ["Contemporary"] }), "unsure");
  assert.equal(decide({ title: "Holy Mountain", artist: "A Band", album: "Noise", genres: ["Avant-Garde"] }), "unsure");
  assert.equal(decide({ title: "The Imperial March", artist: "John Williams", composer: ["John Williams"], album: "The Empire Strikes Back", genres: ["Orchestral"] }), "unsure");
  assert.equal(decide({ title: "Dragonborn", artist: "Jeremy Soule", album: "Skyrim", genres: ["Orchestral"] }), "unsure");
  // One more signal of its own makes it classical.
  assert.equal(decide({ title: "Nocturne in E-flat, Op. 9 No. 2", artist: "Arthur Rubinstein", composer: ["Frédéric Chopin"], album: "Nocturnes", genres: ["Romantic"] }), "classical");
  assert.equal(decide({ title: "Symphony No. 5: IV. Adagietto", artist: "Berliner Philharmoniker", composer: ["Gustav Mahler"], album: "Mahler 5", genres: ["Orchestral"] }), "classical");
  assert.equal(decide({ title: "Song", genres: ["Classical", "Romantic"] }), "classical");
  assert.equal(decide({ title: "Always Be Mine", genres: ["Pop", "Romantic"] }), "not_classical");
});

// L16 (#36): a WORK tag that a live or remastered release's title only adds to
// names the song, as one equal to the title does.
test("classification: a WORK tag repeated in a live or remastered title is no evidence", () => {
  const work = (hints) => classificationEvidence(hints).signals.some((s) => s.signal === "WORK tag");
  for (const title of ["Finale (Live at Wembley)", "Finale - 2009 Remaster", "Finale [Single Version]", "Finale – Live"])
    assert.equal(work({ title, work: "Finale", composer: ["Freddie Mercury"] }), false, title);
  assert.notEqual(decide({ title: "Finale (Live at Wembley)", work: "Finale", composer: ["Freddie Mercury"] }), "classical");
  // Still evidence: a different piece, an arrangement, a movement after it.
  assert.equal(decide({ title: "Gute Nacht", work: "Winterreise, D. 911", composer: ["Franz Schubert"] }), "classical");
  assert.equal(work({ title: "Adagio for Strings (Arr. for choir)", work: "Adagio for Strings" }), true);
  assert.equal(work({ title: "Symphony No. 5: I. Trauermarsch (Live)", work: "Symphony No. 5" }), true);
  assert.equal(work({ title: "Finale of the Night", work: "Finale" }), true);
});
