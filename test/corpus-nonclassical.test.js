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
  // At least the v0.1 scope (20 albums, 100 tracks); later releases add more.
  assert.ok(fixtures.length >= 20, `${fixtures.length} albums`);
  assert.ok(tracks.length >= 100, `${tracks.length} tracks`);
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

test("non-classical corpus: the read-only report matches the pipeline and writes nothing", () => {
  assert.equal(results.reportReadOnly, true);
  const byTitle = new Map(results.report.tracks.map((t) => [`${t.albumId}|${t.title}`, t]));
  assert.equal(results.report.summary.tracks, results.tracks.length);
  for (const track of results.tracks) {
    const entry = byTitle.get(`${track.album}|${track.title}`);
    assert.ok(entry, track.key);
    // After the final rescan, the stored state is what the report predicts.
    assert.equal(entry.stored, track.pin ? track.pin.afterRescan : track.state, track.key);
    assert.equal(entry.changes, false, track.key);
    assert.equal(entry.source, track.pin ? (fixtures.find((a) => a.id === track.album).pins.tracks?.[track.key.split("-").pop()] ? "track pin" : "album pin") : "automatic", track.key);
  }
  assert.equal(results.report.summary.pinned, 3);
});

test("non-classical corpus: the report flags a stale classical decision as a dry run", async (t) => {
  // A library scanned by the old rules: Get Lucky stored as classical. The
  // report must show it changing to not_classical, from a read-only database.
  const { DatabaseSync } = await import("node:sqlite");
  const { classificationReport } = await import("../src/model/classification-report.js");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aurral-classical-dryrun-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const { openCatalogue } = await import("../src/model/catalogue.js");
  const { reconcile } = await import("../src/model/reconcile.js");
  const c = await openCatalogue(path.join(root, "model"));
  const hints = { title: "Get Lucky", album: "Random Access Memories", artist: "Daft Punk", work: "Get Lucky", genres: ["Electronic"], composer: ["Pharrell Williams"], composerDistinct: true };
  const [link] = reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: 1, tracks: [{ coreId: "1", fileId: "1", albumId: "ram", path: "/library/1.flac", size: 1, durationMs: 1, hints }] });
  c.db.prepare("INSERT INTO classification VALUES (?,?,0,5,?,1,?)").run(link.id, "classical", JSON.stringify(hints), Date.now());
  c.close();
  const db = new DatabaseSync(path.join(root, "model", "classical.sqlite"), { readOnly: true });
  try {
    const [entry] = classificationReport(db).tracks;
    assert.deepEqual([entry.stored, entry.next, entry.changes], ["classical", "not_classical", true]);
    assert.match(entry.reason, /Electronic genre/);
  } finally {
    db.close();
  }
  // The admin album action gives the same answer, and refuses non-admins.
  const { default: plugin } = await import("../src/index.js");
  const action = plugin.actions["classical-classification-report"];
  const input = { dataFolder: root, libraryFolder: root, settings: {}, album: { id: "ram" } };
  const { message } = await action({ ...input, user: { id: 1, role: "admin" } });
  assert.match(message, /Read only\. 1 tracks: 1 classical\. 1 change on the next scan\. Get Lucky: classical → not_classical/);
  assert.ok(message.length <= 500);
  await assert.rejects(action({ ...input, user: { id: 2, role: "user" } }), /admin/);
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

// The v0.1 acceptance bar: no clearly non-classical track is classical or
// gets classical behaviour, and no expected-classical track is lost.
test("non-classical corpus: v0.1 acceptance, zero false classical positives or negatives", () => {
  const m = metrics(results.tracks);
  assert.equal(m.falsePositives, 0, `${m.falsePositives} false classical positives`);
  assert.equal(m.leaks, 0, `${m.leaks} tracks given classical behaviour`);
  assert.equal(m.falseNegatives, 0, `${m.falseNegatives} classical tracks classified not classical`);
});
