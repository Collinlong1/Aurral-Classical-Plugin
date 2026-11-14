// Read-only: what MusicBrainz says about the classical tracks outside every
// work, from the answers the plugin already cached, and what Auto-match
// would do with them. It makes no MusicBrainz request: the client it uses
// has no network and reads the cache whatever the answers' age.
//
//   node scripts/explain-musicbrainz.mjs <plugin data folder> [out dir]
//
// <plugin data folder> holds model/ and mb-cache/. The live catalogue is
// only read; Auto-match runs on a snapshot in the out dir, deleted after.
// Writes musicbrainz.md (by outcome and album) and musicbrainz.json.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sqlite, { DatabaseSync } from "node:sqlite";
import { MusicBrainz } from "../src/mb.js";
import { ClassicalResolver } from "../src/resolver.js";
import { identifyTrack } from "../src/model/runtime.js";
import { autoMatchTaggedWorks, explainMatching } from "../src/model/auto-match.js";
import { openCatalogue } from "../src/model/catalogue.js";

const [folder, outDir = "."] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node scripts/explain-musicbrainz.mjs <plugin data folder> [out dir]");
  process.exit(1);
}

// Every cached answer, by its request ("recording/<id>?fmt=json&inc=…"),
// whichever MusicBrainz server or mirror it came from.
const cached = new Map();
const cacheFolder = path.join(folder, "mb-cache");
for (const dir of await fs.readdir(cacheFolder).catch(() => [])) {
  if (dir.startsWith(".")) continue;
  for (const name of await fs.readdir(path.join(cacheFolder, dir)).catch(() => [])) {
    try {
      const entry = JSON.parse(await fs.readFile(path.join(cacheFolder, dir, name), "utf8"));
      if (typeof entry?.key === "string") cached.set(entry.key.slice(entry.key.indexOf("|") + 1), entry.value);
    } catch {}
  }
}
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "explain-mb-"));
const mb = new MusicBrainz({ settings: {}, dataFolder: scratch, fetchImpl: () => Promise.reject(new Error("offline")), maxRetries: 1, retryWaitMs: 0 });
mb.cache = { get: async (key) => (cached.has(key.slice(key.indexOf("|") + 1)) ? cached.get(key.slice(key.indexOf("|") + 1)) : null), set: async () => {} };
mb.throttle = { run: (dispatch) => dispatch() };
const resolver = new ClassicalResolver(mb, { log: () => {} });
const ctx = { mb, resolver, log: () => {} };
const get = (entity, id, inc) => {
  for (const [key, value] of cached) if (key.startsWith(`${entity}/${id}?`) && (!inc || key.includes(inc))) return value;
  for (const [key, value] of cached) if (key.startsWith(`${entity}/${id}?`)) return value;
  return null;
};

await fs.mkdir(outDir, { recursive: true });
const snapshotFolder = path.join(path.resolve(outDir), `.mb-snapshot-${randomUUID()}`);
await fs.mkdir(snapshotFolder);
const live = new DatabaseSync(path.join(folder, "model", "classical.sqlite"), { readOnly: true });
if (typeof sqlite.backup === "function") await sqlite.backup(live, path.join(snapshotFolder, "classical.sqlite"));
else live.exec(`VACUUM INTO '${path.join(snapshotFolder, "classical.sqlite").replaceAll("'", "''")}'`);
live.close();

try {
  const sim = await openCatalogue(snapshotFolder);
  const nameOf = (id) => {
    const row = sim.db.prepare("SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id WHERE f.target_id=? AND f.field='title'").get(id);
    return row ? JSON.parse(row.value) : null;
  };
  const outside = sim.db
    .prepare(
      `SELECT t.id,t.evidence FROM track_link t JOIN classification c ON c.target_id=t.id AND c.state='classical'
       WHERE t.state='active' AND NOT EXISTS(SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=t.id)`,
    )
    .all()
    .map((row) => ({ id: row.id, evidence: JSON.parse(row.evidence) }))
    .filter((track) => track.evidence.hints?.recordingMbid);

  // What MusicBrainz says, track by track.
  const tracks = [];
  const providerMatches = new Map();
  for (const track of outside) {
    const hints = track.evidence.hints;
    const recording = get("recording", hints.recordingMbid);
    const works = (recording?.relations || []).filter((rel) => rel.type === "performance" && rel.work?.id).map((rel) => rel.work);
    const leaf = works[0] ? get("work", works[0].id) : null;
    const parents = (leaf?.relations || []).filter((rel) => rel.type === "parts" && rel.direction === "backward" && rel.work).map((rel) => rel.work.title);
    let match = null;
    try {
      match = await identifyTrack(ctx, hints);
    } catch {}
    const tagged = hints.workId ? get("work", hints.workId) : null;
    const says = hints.workId && !works.length
      ? match
        ? match.standalone
          ? `a whole work: "${match.work}" (work ID in its tags)`
          : `"${match.movement ?? tagged?.title ?? hints.workId}" of "${match.work}" (work ID in its tags)`
        : tagged
          ? `work "${tagged.title}" (work ID in its tags), refused: no parent, and the title reads as a movement`
          : "work ID in its tags, not cached"
      : !recording
      ? "no cached answer for its recording"
      : !works.length
        ? "the recording names no work"
        : !leaf
          ? `work "${works[0].title}", not cached`
          : match
            ? match.standalone
              ? `a whole work: "${match.work}"`
              : `"${match.movement ?? leaf.title}" of "${match.work}"`
            : parents.length
              ? `work "${leaf.title}" under "${parents[0]}", refused`
              : `work "${leaf.title}" with no parent, refused: the title reads as a movement of a work MusicBrainz doesn't name`;
    if (match) providerMatches.set(track.id, match);
    tracks.push({ id: track.id, albumId: String(track.evidence.albumId ?? ""), album: hints.album || "", disc: hints.discNumber, number: hints.trackNumber, title: hints.title || "", composer: hints.composer || [], says, work: match?.work || null, movement: match?.movement || null });
  }

  // What Auto-match would then do, album by album, on the snapshot.
  // Why the matching step leaves a track out, before Auto-match runs.
  const albums = [...new Set(tracks.map((track) => track.albumId))];
  const why = new Map();
  for (const albumId of albums) {
    const matches = new Map(tracks.filter((t) => t.albumId === albumId && providerMatches.has(t.id)).map((t) => [t.id, providerMatches.get(t.id)]));
    if (!matches.size) continue;
    for (const [id, { reason, work }] of explainMatching(sim, albumId, matches)) why.set(id, { reason, work });
    autoMatchTaggedWorks(sim, { albumId, actor: "explain", allowStructuredTitles: true, providerMatches: matches });
  }
  const workOf = sim.db.prepare(
    `SELECT r.work_id FROM segment s JOIN realization_item i ON i.segment_id=s.id JOIN realization r ON r.id=i.realization_id WHERE s.track_link_id=? LIMIT 1`,
  );
  const reviews = new Map();
  for (const row of sim.db.prepare("SELECT evidence FROM review_item WHERE status='open' AND kind='auto_match'").all()) {
    const evidence = JSON.parse(row.evidence);
    for (const id of evidence.tracks || []) reviews.set(id, evidence.reason);
  }
  for (const track of tracks) {
    const work = workOf.get(track.id)?.work_id;
    const reason = why.get(track.id)?.reason;
    track.reason = reason || null;
    track.outcome = work
      ? `matches "${nameOf(work)}"`
      : reviews.has(track.id)
        ? `review: ${reviews.get(track.id)}`
        : !track.work
          ? "stays out"
          : !reason || reason === "matches when Auto-match runs"
            ? "stays out: the match was refused when made (an earlier match of this album was undone, or an admin took the album out)"
            : `stays out: ${reason}`;
  }
  sim.close();

  const count = (key) => [...tracks.reduce((m, t) => m.set(key(t), (m.get(key(t)) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const kind = (says) => says.replace(/"[^"]*"/g, "…");
  const lines = [
    "# What MusicBrainz says about classical tracks outside every work",
    "",
    `From ${cached.size} cached MusicBrainz answers; no request was made. ${tracks.length} classical tracks outside every work have a recording ID.`,
    "",
    "MusicBrainz says:",
    ...count((t) => kind(t.says)).map(([k, n]) => `- ${k}: ${n}`),
    "",
    "Auto-match with those answers (on a snapshot):",
    ...count((t) => t.outcome.replace(/"[^"]*"/g, "…")).map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## By album",
  ];
  for (const albumId of albums) {
    const list = tracks.filter((t) => t.albumId === albumId).sort((a, b) => (a.disc || 1) - (b.disc || 1) || (a.number || 0) - (b.number || 0));
    lines.push("", `### ${list[0].album} (album ${albumId}, ${list.length} tracks)`);
    for (const t of list) lines.push(`- ${t.disc || 1}.${t.number ?? "?"} "${t.title}" — MusicBrainz: ${t.says} → ${t.outcome}`);
  }
  await fs.writeFile(path.join(outDir, "musicbrainz.md"), `${lines.join("\n")}\n`);
  await fs.writeFile(path.join(outDir, "musicbrainz.json"), JSON.stringify({ cachedAnswers: cached.size, tracks }, null, 1));
  console.log(lines.slice(0, lines.indexOf("## By album")).join("\n"));
} finally {
  await fs.rm(snapshotFolder, { recursive: true, force: true });
  await fs.rm(scratch, { recursive: true, force: true });
}
