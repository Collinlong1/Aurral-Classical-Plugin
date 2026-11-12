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
  for (const genre of ["Classical", "Chamber Music", "Baroque", "Opera", "Modern Classical", "Romantic", "Choral"])
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
