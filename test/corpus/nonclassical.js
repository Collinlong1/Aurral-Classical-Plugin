// Ordinary music, and the classical recordings hiding in it, run through the
// classification pipeline a real library goes through:
//
//   1. tagged files in a read-only-style library and a host snapshot,
//   2. the admin's "Scan classical model (read only)" (enqueueModelScan +
//      runModelJobs: reconcile, classify, album roll-up, automatic works),
//   3. the admin's "Auto-match classical works" on every album,
//   4. the album page (By work view), the tag-write guard and the Soulseek
//      source's acquisition identity for each track,
//   5. the fixtures' manual pins (album and track), a retag of pinned files,
//      and two more scans, after which the pins must still hold.
//
// Fixtures live in test/corpus/nonclassical/*.json, one album each. Every
// value is hand-written metadata modelled on a real release (track lists are
// trimmed, lengths approximate); the audio is a copy of test/fixtures/sine.flac.
// Each track carries a reviewed expected state (classical, not_classical or
// unsure), and each album its own album-level expectation.
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { File } from "node-taglib-sharp";
import { openCatalogue } from "../../src/model/catalogue.js";
import { applyV2 } from "../../src/model/editor-v2.js";
import { classify } from "../../src/model/reconcile.js";
import { autoMatchWorks, enqueueModelScan, modelStatus, runModelJobs } from "../../src/model/runtime.js";
import { renderAlbumPresentation } from "../../src/model/presentation.js";
import { modelAllowsTagging } from "../../src/model/write-guard.js";
import { acquisitionIdentity } from "../../src/source.js";
import { makeContext } from "../../src/index.js";
import { writeTags } from "../../src/tags.js";
import { FIXTURES, MB, fakeFetch, json } from "../helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixtureFolder = path.join(here, "nonclassical");
export const baselineFile = path.join(here, "nonclassical-baseline.json");
export const STATES = ["classical", "not_classical", "unsure"];
const ADMIN = { id: 1, role: "admin" };

export function nonclassicalFixtures() {
  return fs
    .readdirSync(fixtureFolder)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(fixtureFolder, file), "utf8")));
}

export const trackKey = (album, track) => `${album.id}#${track.disc}-${track.number}`;
const fileName = (track) => `${track.disc}-${String(track.number).padStart(2, "0")}.flac`;
// A stable fake MusicBrainz recording ID per track, used only by the
// acquisition check (the files themselves carry no MusicBrainz IDs).
const mbid = (key) => {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const slug = (name) => String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-");

// Fixture lint: every track must state what a reviewer expects of it.
export function checkFixtures(fixtures) {
  const problems = [];
  const keys = new Set();
  for (const album of fixtures) {
    if (!STATES.includes(album.expect?.album)) problems.push(`${album.id}: album expectation missing`);
    if (!album.family) problems.push(`${album.id}: family missing`);
    for (const track of album.tracks) {
      const key = trackKey(album, track);
      if (keys.has(key)) problems.push(`${key}: duplicate track`);
      keys.add(key);
      if (!STATES.includes(track.expect)) problems.push(`${key}: track expectation missing`);
      for (const field of ["title", "artist"]) if (!track[field]) problems.push(`${key}: ${field} missing`);
      if (!Array.isArray(track.composer) || !Array.isArray(track.genres)) problems.push(`${key}: composer/genres must be lists`);
    }
    for (const number of Object.keys(album.pins?.tracks || {}))
      if (!album.tracks.some((track) => String(track.number) === number)) problems.push(`${album.id}: pin for missing track ${number}`);
    for (const number of Object.keys(album.retag || {}))
      if (!album.tracks.some((track) => String(track.number) === number)) problems.push(`${album.id}: retag for missing track ${number}`);
  }
  return problems;
}

// Scenario labels: the hand-written ones plus what the tags plainly show.
export function scenariosOf(track) {
  const labels = new Set(track.scenarios || []);
  labels.add(track.composer.length ? "composer-credit" : "no-composer");
  if (!track.genres.length) labels.add("missing-genre");
  return [...labels].sort();
}

// --- why the classifier scored what it did ---------------------------------
// A reading of the score terms in src/model/reconcile.js classify(). The
// harness checks that these terms add up to the score the pipeline stored,
// so a classifier change can't silently leave this explanation stale.
const TEMPO =
  /\b(allegr(?:o|etto)|adagi(?:o|etto)|andant(?:e|ino)|larghetto|largo|lento|grave|prestissimo|presto|vivace|moderato|scherzo|menuetto|minuet|menuet|rondo|finale|maestoso|sostenuto|cantabile)\b/i;
const CATALOGUE_NUMBER = /\b(op(?:us)?\.?|bwv|kv?\.?|d\.|hob\.?|rv|woo|hwv|sz\.?|twv)\s*\d/i;
const FORM =
  /\b(symphon(?:y|ie)|sinfonia|sonata|concerto|suite|partita|string quartet|piano trio|quintet|nocturne|mazurka|polonaise|etude|prelude|fugue|toccata|cantata|oratorio|requiem|mass in|missa|motet|madrigal|lieder|impromptu|ballade|rhapsody|overture)(?:s|es)?\b/i;
const CLASSICAL_GENRE = /\b(classical|baroque|opera|chamber|romantic|choral)\b/;
export function explain(hints) {
  const text = [hints.title, hints.work, hints.album]
    .filter((value) => typeof value === "string")
    .join(" \n ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  const genres = (hints.genres || []).map((genre) => genre.toLowerCase());
  const match = (re) => text.match(re)?.[0];
  const genre = genres.find((g) => CLASSICAL_GENRE.test(g));
  const signals = [];
  if (hints.work) signals.push({ points: 4, signal: "WORK tag", value: hints.work });
  if (hints.movement) signals.push({ points: 4, signal: "movement tag", value: hints.movement });
  else if (match(TEMPO)) signals.push({ points: 3, signal: "tempo word", value: match(TEMPO) });
  if (genre) signals.push({ points: 4, signal: "classical genre word", value: genre });
  if (hints.classicalComposerRelation) signals.push({ points: 4, signal: "classical composer relation" });
  if (hints.catalogueNumber || match(CATALOGUE_NUMBER))
    signals.push({ points: 2, signal: "catalogue number", value: hints.catalogueNumber || match(CATALOGUE_NUMBER) });
  if (match(FORM)) signals.push({ points: 2, signal: "form word", value: match(FORM) });
  if (hints.composerDistinct) signals.push({ points: 1, signal: "composer differs from artist", value: (hints.composer || []).join("; ") });
  return { signals, score: signals.reduce((sum, s) => sum + s.points, 0) };
}

// --- the library -------------------------------------------------------------
async function tagFile(file, album, track) {
  const tagged = File.createFromPath(file);
  try {
    tagged.tag.title = track.title;
    tagged.tag.performers = [track.artist];
    tagged.tag.albumArtists = [album.artist];
    tagged.tag.album = album.title;
    tagged.tag.composers = track.composer;
    tagged.tag.genres = track.genres;
    tagged.tag.track = track.number;
    tagged.tag.disc = track.disc;
    tagged.save();
  } finally {
    tagged.dispose();
  }
  await writeTags(file, { work: track.work ? [track.work] : [] });
}

async function buildLibrary(root, fixtures) {
  const libraryFolder = path.join(root, "library");
  const files = new Map();
  for (const album of fixtures)
    for (const track of album.tracks) {
      const file = path.join(libraryFolder, album.id, fileName(track));
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.copyFile(path.join(FIXTURES, "sine.flac"), file);
      await tagFile(file, album, track);
      files.set(trackKey(album, track), file);
    }
  return { libraryFolder, files };
}

function hostLibrary(fixtures, files) {
  let id = 0;
  const tracks = [];
  for (const album of fixtures)
    for (const track of album.tracks) {
      id++;
      tracks.push({
        id,
        title: track.title,
        artistName: track.artist,
        durationMs: track.durationMs,
        albums: [{ albumId: album.id, trackNumber: track.number, discNumber: track.disc }],
        files: [{ id, path: files.get(trackKey(album, track)), albumId: album.id, durationMs: track.durationMs, available: true }],
      });
    }
  return {
    version: 1,
    complete: true,
    library: { albums: fixtures.map((album) => ({ id: album.id, title: album.title })), tracks },
  };
}

async function scan(ctx) {
  await enqueueModelScan(ctx, ADMIN);
  await runModelJobs(ctx, { budgetMs: 600_000 });
  const status = await modelStatus(ctx);
  if (status.scan?.state !== "done") throw new Error(`Corpus scan did not finish: ${JSON.stringify(status.scan)}`);
  for (const album of ctx.fixtures) await autoMatchWorks(ctx, ADMIN, album.id);
}

// --- acquisition: MusicBrainz as the Soulseek source would see each track ----
// Each track's recording, as MusicBrainz would hold it given the file's own
// tags: the performer credit, the tags' genres, and a work crediting the
// tagged composers. No work types, dates or artist genres are invented.
function musicbrainzEntities(fixtures) {
  const entities = {};
  for (const album of fixtures)
    for (const track of album.tracks) {
      const id = mbid(trackKey(album, track));
      const workId = `work-${id}`;
      entities[`recording:${id}`] = {
        id,
        title: track.title,
        "artist-credit": [{ name: track.artist, artist: { id: `artist-${slug(track.artist)}`, name: track.artist } }],
        genres: track.genres.map((name) => ({ name: name.toLowerCase(), count: 1 })),
        relations: track.composer.length
          ? [{ type: "performance", "target-type": "work", direction: "forward", work: { id: workId, title: track.work || track.title } }]
          : [],
      };
      if (track.composer.length)
        entities[`work:${workId}`] = {
          id: workId,
          title: track.work || track.title,
          relations: track.composer.map((name) => ({
            type: "composer",
            "target-type": "artist",
            direction: "backward",
            artist: { id: `artist-${slug(name)}`, name, "sort-name": name },
          })),
        };
    }
  return entities;
}

export async function acquisition(root, fixtures) {
  const dataFolder = path.join(root, "acquisition");
  await fsp.mkdir(dataFolder, { recursive: true });
  const ctx = makeContext({ settings: { mbMirror: MB }, dataFolder }, { fetchImpl: fakeFetch({ entities: musicbrainzEntities(fixtures) }) });
  const result = new Map();
  for (const album of fixtures)
    for (const track of album.tracks) {
      const identity = await acquisitionIdentity(ctx, { trackMbid: mbid(trackKey(album, track)), artist: track.artist, title: track.title });
      result.set(trackKey(album, track), identity == null ? "none" : identity.blocked ? "classical-blocked" : "classical-identity");
    }
  return result;
}

// --- reading the model back ----------------------------------------------------
async function observe(ctx, files) {
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    const instance = c.db.prepare("SELECT id FROM core_instance").get().id;
    const linkOf = new Map(
      c.db
        .prepare("SELECT id,core_id,evidence FROM track_link WHERE state='active'")
        .all()
        .map((row) => [JSON.parse(row.evidence).path, row]),
    );
    const classificationOf = c.db.prepare("SELECT state,pinned,score,evidence FROM classification WHERE target_id=?");
    const inWork = c.db.prepare(
      `SELECT count(*) AS n FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE s.track_link_id=?`,
    );
    const tracks = new Map();
    const albums = new Map();
    for (const album of ctx.fixtures) {
      const presentation = renderAlbumPresentation(c, album.id);
      const grouped = new Set((presentation?.groups || []).flatMap((group) => group.items.map((item) => item.trackId)));
      const albumTarget = c.albumTarget(instance, album.id);
      const albumRow = classificationOf.get(albumTarget);
      albums.set(album.id, { state: albumRow?.state ?? null, pinned: !!albumRow?.pinned, workView: !!presentation });
      for (const track of album.tracks) {
        const key = trackKey(album, track);
        const file = files.get(key);
        const link = linkOf.get(file);
        if (!link) throw new Error(`${key}: no active track link after the scan`);
        const row = classificationOf.get(link.id);
        const hints = JSON.parse(link.evidence).hints;
        tracks.set(key, {
          state: row.state,
          pinned: !!row.pinned,
          score: row.score,
          hints,
          grouped: grouped.has(String(link.core_id)),
          inWork: inWork.get(link.id).n > 0,
          tagging: await modelAllowsTagging(ctx, file),
          linkId: link.id,
          albumTarget,
        });
      }
    }
    return { tracks, albums };
  } finally {
    c.close();
  }
}

// Pins as an admin sets them: album pins on the album's classification
// target, track pins through the editor's "Send to / Remove from Classical".
async function applyPins(ctx, observed) {
  const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
  try {
    for (const album of ctx.fixtures) {
      if (!album.pins) continue;
      const first = observed.tracks.get(trackKey(album, album.tracks[0]));
      if (album.pins.album) classify(c, first.albumTarget, {}, { manual: album.pins.album, actor: "corpus-admin" });
      for (const [number, state] of Object.entries(album.pins.tracks || {})) {
        const track = album.tracks.find((entry) => String(entry.number) === number);
        const { linkId } = observed.tracks.get(trackKey(album, track));
        applyV2(c, { command: "set-classification", values: { tracks: [linkId], state } }, "corpus-admin");
      }
    }
  } finally {
    c.close();
  }
}

async function retag(ctx, files) {
  for (const album of ctx.fixtures)
    for (const [number, change] of Object.entries(album.retag || {})) {
      const track = album.tracks.find((entry) => String(entry.number) === number);
      const tagged = File.createFromPath(files.get(trackKey(album, track)));
      try {
        if (change.genres) tagged.tag.genres = change.genres;
        tagged.save();
      } finally {
        tagged.dispose();
      }
    }
}

// What a pin should leave each track as: its own pin, else its album's pin,
// else whatever the first scan decided.
export function pinnedExpectation(album, track, before) {
  const own = album.pins?.tracks?.[track.number];
  if (own) return own;
  if (album.pins?.album) return album.pins.album;
  return before;
}

// --- outcomes ------------------------------------------------------------------
export function outcomeOf(expect, state) {
  if (expect === state) return "match";
  if (state === "unsure") return "unsure";
  if (expect === "not_classical") return "false_positive";
  if (expect === "classical") return "false_negative";
  return state === "classical" ? "crossover_classical" : "crossover_not_classical";
}

// How bad an outcome is, for regression checks: 0 is right, 2 is wrong.
export const severity = (outcome) =>
  ({ match: 0, unsure: 1, crossover_classical: 1, crossover_not_classical: 1, false_positive: 2, false_negative: 2 })[outcome];

// A not-classical-or-unsure track given classical behaviour.
export function behaviourLeaks(expect, result) {
  if (expect === "classical") return [];
  return [
    result.grouped && "grouped in a work view",
    result.inWork && "attached to a work",
    result.tagging && "classical tag writes allowed",
    result.acquisition !== "none" && `acquisition: ${result.acquisition}`,
  ].filter(Boolean);
}

// Runs every fixture through the pipeline and returns the full results.
export async function runNonclassical(fixtures = nonclassicalFixtures()) {
  const problems = checkFixtures(fixtures);
  if (problems.length) throw new Error(`Bad non-classical fixtures:\n${problems.join("\n")}`);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "aurral-classical-nonclassical-"));
  try {
    const { libraryFolder, files } = await buildLibrary(root, fixtures);
    const dataFolder = path.join(root, "data");
    await fsp.mkdir(dataFolder, { recursive: true });
    const snapshot = hostLibrary(fixtures, files);
    const ctx = {
      fixtures,
      libraryFolder,
      dataFolder,
      settings: {},
      log: () => {},
      userOperations: { version: 1, url: "http://host.test/ops", token: "corpus-only" },
      fetch: async () => json(snapshot),
      // Auto-match has no MusicBrainz IDs to look up; nothing leaves the test.
      resolver: { resolve: async () => null },
      mb: { get: async () => null },
    };
    const media = new Map(await Promise.all([...files].map(async ([key, file]) => [key, await fsp.readFile(file)])));

    await scan(ctx);
    const first = await observe(ctx, files);
    const acquired = await acquisition(root, fixtures);
    for (const [key, result] of first.tracks) result.acquisition = acquired.get(key);
    const unchangedMedia = [...files].every(([key, file]) => fs.readFileSync(file).equals(media.get(key)));

    await applyPins(ctx, first);
    await retag(ctx, files);
    await scan(ctx);
    const pinned = await observe(ctx, files);
    await scan(ctx);
    const rescanned = await observe(ctx, files);

    const tracks = [];
    const albums = [];
    for (const album of fixtures) {
      const albumResult = first.albums.get(album.id);
      albums.push({
        id: album.id,
        family: album.family,
        expect: album.expect.album,
        state: albumResult.state,
        outcome: outcomeOf(album.expect.album, albumResult.state),
        workView: albumResult.workView,
        pinned: album.pins?.album
          ? { want: album.pins.album, afterRetag: pinned.albums.get(album.id).state, afterRescan: rescanned.albums.get(album.id).state }
          : null,
      });
      for (const track of album.tracks) {
        const key = trackKey(album, track);
        const result = first.tracks.get(key);
        const { signals, score } = explain(result.hints);
        const want = pinnedExpectation(album, track, result.state);
        const hasPin = !!(album.pins?.album || album.pins?.tracks?.[track.number]);
        tracks.push({
          key,
          album: album.id,
          family: album.family,
          title: track.title,
          scenarios: scenariosOf(track),
          expect: track.expect,
          state: result.state,
          score: result.score,
          explainedScore: score,
          signals,
          outcome: outcomeOf(track.expect, result.state),
          grouped: result.grouped,
          inWork: result.inWork,
          tagging: result.tagging,
          acquisition: result.acquisition,
          leaks: behaviourLeaks(track.expect, result),
          pin: hasPin
            ? {
                want,
                afterRetag: pinned.tracks.get(key).state,
                afterRescan: rescanned.tracks.get(key).state,
                ownPinKept: !album.pins?.tracks?.[track.number] || (pinned.tracks.get(key).pinned && rescanned.tracks.get(key).pinned),
                groupedAfter: rescanned.tracks.get(key).grouped,
                taggingAfter: rescanned.tracks.get(key).tagging,
              }
            : null,
          // Tracks with no pin must come back the same on every rescan.
          stableWithoutPin: hasPin || (pinned.tracks.get(key).state === result.state && rescanned.tracks.get(key).state === result.state),
        });
      }
    }
    return { tracks, albums, unchangedMedia };
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

// --- reporting -----------------------------------------------------------------
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "–");

// Classification metrics only; the Apple corpus's grouping scores are separate.
export function metrics(tracks) {
  const of = (expect) => tracks.filter((t) => t.expect === expect);
  const count = (list, outcome) => list.filter((t) => t.outcome === outcome).length;
  const nc = of("not_classical");
  const cl = of("classical");
  const un = of("unsure");
  return {
    tracks: tracks.length,
    expected: { not_classical: nc.length, classical: cl.length, unsure: un.length },
    falsePositives: count(nc, "false_positive"),
    falseNegatives: count(cl, "false_negative"),
    notClassicalUnsure: count(nc, "unsure"),
    classicalUnsure: count(cl, "unsure"),
    classicalRecognised: count(cl, "match"),
    crossoverClassical: count(un, "crossover_classical"),
    unsureRate: tracks.filter((t) => t.state === "unsure").length / (tracks.length || 1),
    leaks: tracks.filter((t) => t.leaks.length).length,
  };
}

export function breakdown(tracks, by) {
  const groups = new Map();
  for (const track of tracks)
    for (const label of by === "scenario" ? track.scenarios : [track[by]]) {
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(track);
    }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => ({ label, ...metrics(list) }));
}

export function summary(results) {
  const m = metrics(results.tracks);
  return [
    `${m.tracks} tracks on ${results.albums.length} albums (expected: ${m.expected.not_classical} not classical, ${m.expected.classical} classical, ${m.expected.unsure} unsure)`,
    `false classical positives ${m.falsePositives}/${m.expected.not_classical}; not-classical tracks left unsure ${m.notClassicalUnsure}`,
    `classical recognised ${m.classicalRecognised}/${m.expected.classical}, unsure ${m.classicalUnsure}, false negatives ${m.falseNegatives}`,
    `crossover tracks classified classical ${m.crossoverClassical}/${m.expected.unsure}; overall unsure rate ${pct(m.unsureRate * m.tracks, m.tracks)}`,
    `non-classical or unsure tracks given classical behaviour ${m.leaks}`,
  ];
}

export function markdown(results) {
  const lines = ["## Summary", "", ...summary(results).map((line) => `- ${line}`), ""];
  const table = (title, rows) => {
    lines.push(`## By ${title}`, "", "| | tracks | not classical exp. | false positives | NC unsure | classical exp. | recognised | C unsure | false negatives | crossover → classical | leaks |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows)
      lines.push(`| ${r.label} | ${r.tracks} | ${r.expected.not_classical} | ${r.falsePositives} | ${r.notClassicalUnsure} | ${r.expected.classical} | ${r.classicalRecognised} | ${r.classicalUnsure} | ${r.falseNegatives} | ${r.crossoverClassical} | ${r.leaks} |`);
    lines.push("");
  };
  table("genre family", breakdown(results.tracks, "family"));
  table("scenario", breakdown(results.tracks, "scenario"));
  lines.push("## Albums", "", "| album | family | expected | pipeline | outcome | pin |", "|---|---|---|---|---|---|");
  for (const a of results.albums)
    lines.push(`| ${a.id} | ${a.family} | ${a.expect} | ${a.state} | ${a.outcome} | ${a.pinned ? `${a.pinned.want} → ${a.pinned.afterRetag}/${a.pinned.afterRescan}` : ""} |`);
  lines.push("", "## Mismatches", "", "| track | expected | pipeline | score | evidence | behaviour |", "|---|---|---|---|---|---|");
  for (const t of results.tracks.filter((t) => t.outcome !== "match"))
    lines.push(`| ${t.key} ${t.title} | ${t.expect} | ${t.state} | ${t.score} | ${t.signals.map((s) => `${s.signal}${s.value ? ` "${s.value}"` : ""} +${s.points}`).join("; ") || "none"} | ${t.leaks.join("; ")} |`);
  lines.push("", "## Pins", "", "| track | pinned/inherited | after retag scan | after rescan |", "|---|---|---|---|");
  for (const t of results.tracks.filter((t) => t.pin)) lines.push(`| ${t.key} ${t.title} | ${t.pin.want} | ${t.pin.afterRetag} | ${t.pin.afterRescan} |`);
  return `${lines.join("\n")}\n`;
}

// The saved record: each track's state, score and outcome, plus the written
// explanation each known failure needs.
export function toBaseline(results, previous = {}) {
  const explanations = previous.explanations || {};
  const tracks = {};
  const keep = {};
  for (const t of results.tracks) {
    tracks[t.key] = { expect: t.expect, state: t.state, score: t.score, outcome: t.outcome, leaks: t.leaks };
    if (failureOf(t)) keep[t.key] = explanations[t.key] || "TODO: explain this failure";
  }
  const albums = Object.fromEntries(results.albums.map((a) => [a.id, { expect: a.expect, state: a.state, outcome: a.outcome }]));
  return { summary: summary(results), metrics: metrics(results.tracks), tracks, albums, explanations: keep };
}

// The failures a sign-off must explain: wrong side, or classical behaviour
// on a track that isn't expected classical.
export const failureOf = (t) => severity(t.outcome) === 2 || t.leaks.length > 0;
