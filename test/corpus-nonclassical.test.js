// Holds the line on ordinary music: test/corpus/nonclassical runs pop, rock,
// hip-hop, jazz, electronic, film/game scores, mixed soundtracks and
// crossover albums through the real scan, auto-match, pins and rescans.
//
// Classification metrics here are separate from the Apple corpus's grouping
// scores. A track may not do worse than nonclassical-baseline.json, and each
// known failure there needs a written explanation. To save an improvement
// (explanations are kept):
//   node scripts/corpus.mjs --nonclassical --update-baseline
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquisition,
  baselineFile,
  checkFixtures,
  failureOf,
  metrics,
  nonclassicalFixtures,
  runNonclassical,
  severity,
  summary,
} from "./corpus/nonclassical.js";

const fixtures = nonclassicalFixtures();
const results = await runNonclassical(fixtures);
const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));

test("non-classical corpus: fixtures are complete and in scope", () => {
  assert.deepEqual(checkFixtures(fixtures), []);
  const tracks = fixtures.flatMap((album) => album.tracks);
  assert.ok(fixtures.length >= 20 && fixtures.length <= 30, `${fixtures.length} albums`);
  assert.ok(tracks.length >= 100 && tracks.length <= 150, `${tracks.length} tracks`);
  const families = new Set(fixtures.map((album) => album.family));
  for (const family of ["pop", "rock", "hip-hop", "jazz", "electronic", "film-score", "game-score", "soundtrack-mixed", "crossover", "classical-mistagged"])
    assert.ok(families.has(family), `no ${family} album`);
  const scenarios = new Set(results.tracks.flatMap((track) => track.scenarios));
  for (const scenario of ["composer-credit", "no-composer", "missing-genre", "misleading-genre", "generic-work-tag", "misleading-title", "classical-in-mixed", "classical-nonclassical-genre", "crossover"])
    assert.ok(scenarios.has(scenario), `no ${scenario} track`);
});

test("non-classical corpus: the recorded evidence adds up to the classifier's score", () => {
  const drift = results.tracks.filter((track) => track.score !== track.explainedScore);
  assert.deepEqual(drift.map((track) => `${track.key}: stored ${track.score}, explained ${track.explainedScore}`), []);
});

test("non-classical corpus: scans leave media unchanged and unpinned tracks stable", () => {
  assert.equal(results.unchangedMedia, true);
  assert.deepEqual(results.tracks.filter((track) => !track.stableWithoutPin).map((track) => track.key), []);
});

test("non-classical corpus: grouping and tag writes follow the classification", () => {
  const wrong = results.tracks.filter(
    (track) => track.state !== "classical" && (track.grouped || track.inWork || track.tagging),
  );
  assert.deepEqual(wrong.map((track) => track.key), []);
});

test("non-classical corpus: album and track pins survive a retag and rescans", () => {
  const pinned = results.tracks.filter((track) => track.pin);
  assert.ok(pinned.length >= 10);
  const broken = pinned.filter(
    (track) =>
      track.pin.afterRetag !== track.pin.want ||
      track.pin.afterRescan !== track.pin.want ||
      !track.pin.ownPinKept ||
      ((track.pin.groupedAfter || track.pin.taggingAfter) && track.pin.want !== "classical"),
  );
  assert.deepEqual(broken.map((track) => `${track.key}: want ${track.pin.want}, got ${track.pin.afterRetag}/${track.pin.afterRescan}`), []);
  // Track pins win over album pins (Platoon: album removed, Barber kept).
  assert.equal(results.tracks.find((track) => track.key === "platoon-soundtrack#1-1").pin.afterRescan, "classical");
  for (const album of results.albums.filter((entry) => entry.pinned))
    assert.deepEqual([album.pinned.afterRetag, album.pinned.afterRescan], [album.pinned.want, album.pinned.want], album.id);
});

test("non-classical corpus: the acquisition check can see a classical recording", async (t) => {
  // A positive control, so "no acquisition behaviour" is a real result.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aurral-classical-acquisition-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const control = {
    id: "control",
    tracks: [{ disc: 1, number: 1, title: "Symphony No. 5 in C minor, Op. 67: I. Allegro con brio", artist: "Berliner Philharmoniker", composer: ["Ludwig van Beethoven"], genres: ["Classical"], work: "" }],
  };
  assert.notEqual((await acquisition(root, [control])).get("control#1-1"), "none");
});

test("non-classical corpus: no track or album does worse than the saved baseline", () => {
  const worse = [];
  let better = 0;
  for (const track of results.tracks) {
    const before = baseline.tracks[track.key];
    if (!before) {
      worse.push(`${track.key}: not in the baseline; save it with --update-baseline`);
      continue;
    }
    if (severity(track.outcome) > severity(before.outcome)) worse.push(`${track.key}: ${before.outcome} -> ${track.outcome}`);
    if (track.leaks.length > before.leaks.length) worse.push(`${track.key}: new classical behaviour ${track.leaks.join(", ")}`);
    if (severity(track.outcome) < severity(before.outcome) || track.leaks.length < before.leaks.length) better++;
  }
  for (const album of results.albums) {
    const before = baseline.albums[album.id];
    if (before && severity(album.outcome) > severity(before.outcome)) worse.push(`album ${album.id}: ${before.outcome} -> ${album.outcome}`);
  }
  if (better) console.log(`${better} non-classical corpus results improved; save them with --update-baseline.\n${summary(results).join("\n")}`);
  assert.deepEqual(worse, []);
});

test("non-classical corpus: every known failure has a written explanation", () => {
  const missing = results.tracks
    .filter(failureOf)
    .filter((track) => !/\w/.test(baseline.explanations[track.key] || "") || /^TODO/.test(baseline.explanations[track.key]));
  assert.deepEqual(missing.map((track) => track.key), []);
});

// The v0.1 acceptance bar. Reported, not enforced, until a classifier change
// is separately approved; the baseline above stops it getting worse.
test(
  "non-classical corpus: v0.1 acceptance, zero false classical positives",
  { todo: "known false positives are listed in nonclassical-baseline.json and NONCLASSICAL_CORPUS_REPORT.md" },
  () => {
    const m = metrics(results.tracks);
    assert.equal(m.falsePositives, 0, `${m.falsePositives} false classical positives`);
    assert.equal(m.leaks, 0, `${m.leaks} tracks given classical behaviour`);
  },
);
