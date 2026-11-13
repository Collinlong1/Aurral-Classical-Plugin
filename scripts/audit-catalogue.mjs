// Read-only audit of a classical catalogue: every album as its page shows
// it, what looks wrong, and what Auto-match would do about it.
//
//   node scripts/audit-catalogue.mjs <plugin data folder>/model [out dir]
//
// The live database is only read: a consistent snapshot of it (SQLite's
// online backup) goes to the out dir, the report reads the snapshot, and
// Auto-match runs on the snapshot for every album to show what it would
// match, send to review (and why) or refuse. The snapshot is deleted after.
// The plugin catalogue holds no credentials; those live in Aurral's own
// database, which this never opens.
//
// Writes audit.md (summary and flagged albums) and audit.json (every album).
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sqlite, { DatabaseSync } from "node:sqlite";
import { renderAlbumPresentation } from "../src/model/presentation.js";
import { autoMatchTaggedWorks, explainMatching, nameKey, workKey } from "../src/model/auto-match.js";
import { openCatalogue } from "../src/model/catalogue.js";

const [folder, outDir = "."] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node scripts/audit-catalogue.mjs <model folder> [out dir]");
  process.exit(1);
}
await fs.mkdir(outDir, { recursive: true });
const snapshotFolder = path.join(path.resolve(outDir), `.audit-snapshot-${randomUUID()}`);
await fs.mkdir(snapshotFolder);
const snapshot = path.join(snapshotFolder, "classical.sqlite");
const live = new DatabaseSync(path.join(folder, "classical.sqlite"), { readOnly: true });
if (typeof sqlite.backup === "function") await sqlite.backup(live, snapshot);
else live.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
live.close();
try {
const db = new DatabaseSync(snapshot, { readOnly: true });
const c = { db };

const words = (value) =>
  String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const resolved = db.prepare(
  "SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id WHERE f.target_id=? AND f.field=?",
);
const valueOf = (id, field) => {
  const row = resolved.get(id, field);
  return row ? JSON.parse(row.value) : null;
};

const tracks = db
  .prepare(
    `SELECT t.id,t.evidence,COALESCE(c.state,'unclassified') AS state FROM track_link t
     LEFT JOIN classification c ON c.target_id=t.id WHERE t.state='active'`,
  )
  .all()
  .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
const albums = new Map();
for (const track of tracks) {
  const id = track.evidence.albumId;
  if (id == null) continue;
  const album = albums.get(String(id)) || { id: String(id), tracks: [] };
  album.tracks.push(track);
  albums.set(String(id), album);
}

const attachedTo = new Map(
  db
    .prepare(
      `SELECT s.track_link_id AS id,r.work_id FROM segment s JOIN realization_item i ON i.segment_id=s.id
       JOIN realization r ON r.id=i.realization_id`,
    )
    .all()
    .map((row) => [row.id, row.work_id]),
);

const reviews = db
  .prepare("SELECT kind,target_id,evidence FROM review_item WHERE status='open'")
  .all()
  .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
const reviewsByAlbum = new Map();
for (const review of reviews) {
  const albumId = review.evidence.albumId;
  if (albumId == null) continue;
  reviewsByAlbum.set(String(albumId), [...(reviewsByAlbum.get(String(albumId)) || []), review]);
}

// Live works that share an identity key: the same piece made twice.
const workIdentities = new Map();
for (const { id } of db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").all()) {
  const title = valueOf(id, "title");
  const composers = db
    .prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer' ORDER BY position")
    .all(id)
    .map((row) => valueOf(row.contributor_id, "name"))
    .filter((name) => typeof name === "string");
  if (typeof title !== "string") continue;
  const key = workKey(title, composers);
  workIdentities.set(key, [...(workIdentities.get(key) || []), { id, title, composers }]);
}
const duplicateWorks = [...workIdentities.values()].filter((list) => list.length > 1);

const mostCommon = (values) => {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};

const report = [];
for (const album of albums.values()) {
  const hints = album.tracks.map((track) => track.evidence.hints || {});
  const states = Object.fromEntries(
    ["classical", "unsure", "not_classical", "unclassified"].map((state) => [state, album.tracks.filter((t) => t.state === state).length]),
  );
  if (!states.classical && !states.unsure) continue;
  let presentation = null;
  let error = null;
  try {
    presentation = renderAlbumPresentation(c, album.id);
  } catch (e) {
    error = e.message;
  }
  const blocks = (presentation?.groups || []).map((group) => ({
    matched: Boolean(group.workId),
    title: group.title,
    composer: group.composer,
    detail: group.detail || null,
    missing: group.missing.map((movement) => movement.title),
    rows: group.items.map((item) => item.title),
  }));
  const flags = [];
  if (error) flags.push(`page fails to render: ${error}`);
  if (!presentation && states.classical > 1) flags.push("no work view");
  const unmatched = blocks.filter((block) => block.detail === "Not matched to a work");
  if (unmatched.length) flags.push(`${unmatched.length} unmatched block(s) of several tracks`);
  const missing = blocks.filter((block) => block.matched && block.missing.length);
  if (missing.length) flags.push(`${missing.length} work(s) missing movements`);
  const titles = blocks.map((block) => words(block.title));
  const repeated = [...new Set(titles.filter((title, i) => titles.indexOf(title) !== i))];
  if (repeated.length) flags.push(`${repeated.length} heading(s) appear in more than one block`);
  // A row that repeats its heading, or still starts with its composer
  // ("Rachmaninoff: …"); a lone piece's row is its own heading, as expected.
  const composerPrefix = (row, composer) => {
    const prefix = row.match(/^([^:]{2,60}):\s/)?.[1];
    return Boolean(prefix) && composer.split(/,\s*/).some((name) => {
      const full = nameKey(name);
      return full && (nameKey(prefix) === full || nameKey(prefix) === full.split(" ").at(-1));
    });
  };
  const wordy = blocks.flatMap((block) =>
    block.rows.filter((row) => words(row).startsWith(`${words(block.title)} `) || composerPrefix(row, block.composer)),
  );
  if (wordy.length) flags.push(`${wordy.length} row(s) repeat their heading or start with the composer`);
  if (states.unsure) flags.push(`${states.unsure} track(s) unsure whether classical`);
  // Numbered rows that start again inside one work ("1. Lento … 1.
  // Andante"): sections of movements read as movements.
  const restarts = blocks.filter((block) => {
    const numbers = block.rows.map((row) => Number(row.match(/^(\d+)\.\s/)?.[1] || 0)).filter(Boolean);
    return numbers.some((n, i) => i > 0 && n <= numbers[i - 1]);
  });
  if (restarts.length) flags.push(`${restarts.length} work(s) whose row numbers start again`);
  // Why each classical track outside a work stays out.
  const explained = explainMatching(c, album.id);
  const unmatchedTracks = album.tracks
    .filter((track) => track.state === "classical" && !attachedTo.get(track.id))
    .map((track) => {
      const h = track.evidence.hints || {};
      const why = explained.get(track.id) || { work: null, reason: "not considered" };
      return {
        id: track.id,
        title: h.title || "",
        disc: h.discNumber || 1,
        track: h.trackNumber || 0,
        work: h.work || "",
        grouping: h.grouping || "",
        composer: h.composer || [],
        recordingId: Boolean(h.recordingMbid),
        proposedWork: why.work,
        // The dry run makes no MusicBrainz requests; Auto-match does.
        reason:
          !why.work && h.recordingMbid
            ? `${why.reason}; it has a recording ID, so MusicBrainz may still name its work when Auto-match runs`
            : why.reason,
      };
    })
    .sort((a, b) => a.disc - b.disc || a.track - b.track);
  const ready = unmatchedTracks.filter((track) => track.reason === "matches when Auto-match runs").length;
  if (ready) flags.push(`${ready} track(s) match as soon as Auto-match runs on this album`);
  const named = unmatchedTracks.filter((track) => track.proposedWork && track.reason !== "matches when Auto-match runs").length;
  if (named) flags.push(`${named} track(s) name a work but stay unmatched`);
  const albumReviews = reviewsByAlbum.get(album.id) || [];
  if (albumReviews.length) flags.push(`open review: ${[...new Set(albumReviews.map((r) => r.evidence.reason || r.kind))].join(", ")}`);
  report.push({
    albumId: album.id,
    title: mostCommon(hints.map((h) => h.album)),
    albumArtist: mostCommon(hints.map((h) => h.albumArtist)),
    tracks: album.tracks.length,
    states,
    matchedTracks: blocks.filter((b) => b.matched).reduce((sum, b) => sum + b.rows.length, 0),
    flags,
    blocks,
    review: albumReviews.map((r) => ({ kind: r.kind, reason: r.evidence.reason || null })),
    unmatchedTracks,
    sample: hints
      .slice(0, 3)
      .map((h) => ({ title: h.title, work: h.work || "", grouping: h.grouping || "", composer: h.composer || [], hasRecordingId: Boolean(h.recordingMbid) })),
  });
}
report.sort((a, b) => b.flags.length - a.flags.length || a.title.localeCompare(b.title));

// What the next scan and Auto-match would do: run them on the snapshot (the
// scan's library-wide pass, then every album with unmatched tracks, in the
// order "Auto-match every album" would) and see where each track ends up.
// This is the dry run of the repairs too: every merge, split and expansion
// it makes is listed from the snapshot's audit trail.
const sim = await openCatalogue(snapshotFolder);
const simulated = new Map();
const dryRun = { merges: [], splits: [], expansions: [], duplicateReviews: 0, duplicatesAfter: [] };
try {
  const firstEvent = sim.db.prepare("SELECT coalesce(max(id),0) AS id FROM audit_event").get().id;
  const reviewsBefore = sim.db.prepare("SELECT count(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='duplicate-work'").get().n;
  autoMatchTaggedWorks(sim, { actor: "audit", allowStructuredTitles: true });
  for (const album of report)
    if (album.unmatchedTracks.length)
      autoMatchTaggedWorks(sim, { albumId: album.albumId, actor: "audit", allowStructuredTitles: true });
  const nameOf = (id, field) => {
    const row = sim.db
      .prepare("SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id WHERE f.target_id=? AND f.field=?")
      .get(id, field);
    return row ? JSON.parse(row.value) : null;
  };
  const workOf = new Map(
    sim.db
      .prepare(
        `SELECT s.track_link_id AS id,r.work_id FROM segment s JOIN realization_item i ON i.segment_id=s.id
         JOIN realization r ON r.id=i.realization_id`,
      )
      .all()
      .map((row) => [row.id, row.work_id]),
  );
  const titleOf = (id) => nameOf(id, "title") ?? id;
  for (const event of sim.db.prepare("SELECT action,target_id,data FROM audit_event WHERE id>? ORDER BY id").all(firstEvent)) {
    const data = JSON.parse(event.data);
    if (event.action === "work.merge") dryRun.merges.push({ drop: titleOf(event.target_id), into: titleOf(data.into), reason: data.reason || "same identity" });
    if (event.action === "work.split_sibling") dryRun.splits.push({ work: titleOf(event.target_id), albumId: data.albumId, workIdentity: data.subject, tracksName: data.tracks });
    if (event.action === "work.auto_match_expand") dryRun.expansions.push({ work: titleOf(event.target_id), albumId: data.albumId, from: data.from, to: data.to });
  }
  dryRun.duplicateReviews =
    sim.db.prepare("SELECT count(*) AS n FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='duplicate-work'").get().n - reviewsBefore;
  const after = new Map();
  for (const { id } of sim.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").all()) {
    const title = nameOf(id, "title");
    const composers = sim.db
      .prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer' ORDER BY position")
      .all(id)
      .map((row) => nameOf(row.contributor_id, "name"))
      .filter((name) => typeof name === "string");
    if (typeof title !== "string") continue;
    const key = workKey(title, composers);
    after.set(key, [...(after.get(key) || []), { id, title, composers }]);
  }
  dryRun.duplicatesAfter = [...after.values()].filter((list) => list.length > 1);
  const reviewOf = new Map();
  for (const row of sim.db.prepare("SELECT target_id,evidence FROM review_item WHERE status='open' AND kind='auto_match'").all()) {
    const evidence = JSON.parse(row.evidence);
    for (const id of evidence.tracks || [row.target_id]) reviewOf.set(id, evidence);
  }
  const movementsOf = (work) =>
    sim.db
      .prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position")
      .all(work)
      .map((row) => nameOf(row.target_id, "title"));
  for (const album of report)
    for (const track of album.unmatchedTracks) {
      const work = workOf.get(track.id);
      const review = reviewOf.get(track.id);
      track.autoMatch = work
        ? `matches "${nameOf(work, "title")}"`
        : review
          ? `review: ${review.reason}${
              review.reason === "movement-mismatch" && review.work
                ? ` (existing work "${nameOf(review.work, "title")}" has ${movementsOf(review.work).length} movements: ${movementsOf(review.work).slice(0, 6).join(" / ")})`
                : review.reason === "ambiguous-work"
                  ? ` (${(review.candidates || []).length} works fit: ${(review.candidates || []).map((id) => nameOf(id, "title")).join(" / ")})`
                  : ""
            }`
          : track.reason === "matches when Auto-match runs"
            ? "refused without a review: this album already made this work once and its tracks were later taken out of it"
            : track.proposedWork
              ? "stays out: " + track.reason
              : "stays out: nothing in its tags or title names a work";
      simulated.set(track.autoMatch.replace(/ \(.*$/, "").replace(/"[^"]*"/, '"…"'), (simulated.get(track.autoMatch.replace(/ \(.*$/, "").replace(/"[^"]*"/, '"…"')) || 0) + 1);
    }
} finally {
  sim.close();
}

const count = (test) => report.filter(test).length;
const reasons = new Map();
for (const review of reviews) {
  const reason = review.evidence.reason || review.kind;
  reasons.set(reason, (reasons.get(reason) || 0) + 1);
}
// <data dir>/plugin-data/aurral-classical/model -> <data dir>/plugins/aurral-classical
const installed = await fs
  .readFile(path.join(folder, "..", "..", "..", "plugins", "aurral-classical", "manifest.json"), "utf8")
  .then((text) => JSON.parse(text).version)
  .catch(() => "unknown");
const lines = [
  "# Classical catalogue audit",
  "",
  `Installed plugin ${installed}; schema ${db.prepare("PRAGMA user_version").get().user_version}; audited ${new Date().toISOString()}`,
  "",
  `Albums with classical tracks: ${report.length}`,
  `- every classical track in a matched work: ${count((a) => a.matchedTracks === a.states.classical && a.states.classical > 0)}`,
  `- some tracks matched: ${count((a) => a.matchedTracks > 0 && a.matchedTracks < a.states.classical)}`,
  `- nothing matched: ${count((a) => a.matchedTracks === 0)}`,
  `- no work view at all: ${count((a) => a.flags.includes("no work view"))}`,
  `- flagged: ${count((a) => a.flags.length)}`,
  "",
  `Duplicate works (same title and composers, made more than once): ${duplicateWorks.length}`,
  ...duplicateWorks.slice(0, 30).map((list) => `- ${list[0].title} — ${list[0].composers.join(", ")} (${list.length})`),
  "",
  "Classical tracks outside every work, by why Auto-match leaves them out:",
  ...[...report.flatMap((a) => a.unmatchedTracks).reduce((m, t) => m.set(t.reason, (m.get(t.reason) || 0) + 1), new Map())]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `- ${reason}: ${n}`),
  "",
  "What the next scan and Auto-match every album would do with those tracks now (run on a snapshot):",
  ...[...simulated].sort((a, b) => b[1] - a[1]).map(([outcome, n]) => `- ${outcome}: ${n}`),
  "",
  "Dry run of the repairs (on the snapshot; nothing was written to the catalogue):",
  `- works split from a work an old merge joined across sibling numbers: ${dryRun.splits.length}`,
  ...dryRun.splits.slice(0, 40).map((x) => `  - album ${x.albumId}: "${x.work}" (${x.workIdentity}) gives back tracks naming ${x.tracksName}`),
  `- duplicate works merged: ${dryRun.merges.length}`,
  ...dryRun.merges.slice(0, 40).map((x) => `  - "${x.drop}" into "${x.into}" (${x.reason})`),
  `- incomplete works expanded from a fuller album: ${dryRun.expansions.length}`,
  ...dryRun.expansions.slice(0, 40).map((x) => `  - "${x.work}": ${x.from} → ${x.to} movements, from album ${x.albumId}`),
  `- new duplicate-work reviews (same title, no number): ${dryRun.duplicateReviews}`,
  `- duplicate works left after the run: ${dryRun.duplicatesAfter.length}`,
  ...dryRun.duplicatesAfter.slice(0, 30).map((list) => `  - ${list.map((w) => w.title).join(" | ")} — ${list[0].composers.join(", ")}`),
  "",
  "Open review items by reason:",
  ...[...reasons].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `- ${reason}: ${n}`),
  "",
  "## Flagged albums",
];
for (const album of report.filter((a) => a.flags.length)) {
  lines.push("", `### ${album.title} — ${album.albumArtist} (album ${album.albumId}, ${album.tracks} tracks, ${album.matchedTracks}/${album.states.classical} matched)`);
  for (const flag of album.flags) lines.push(`- ${flag}`);
  for (const block of album.blocks.slice(0, 12))
    lines.push(
      `  - [${block.matched ? "work" : "piece"}] ${block.composer} | ${block.title}${block.detail ? ` (${block.detail})` : ""}${block.missing.length ? ` — missing ${block.missing.length}` : ""}: ${block.rows.slice(0, 4).join(" / ")}${block.rows.length > 4 ? " / …" : ""}`,
    );
  if (album.blocks.length > 12) lines.push(`  - … ${album.blocks.length - 12} more blocks`);
  if (album.unmatchedTracks.length) {
    lines.push("  - unmatched tracks:");
    for (const t of album.unmatchedTracks.slice(0, 15))
      lines.push(
        `    - ${t.disc}.${t.track} "${t.title}"${t.work ? `, WORK "${t.work}"` : ""}${t.grouping ? `, GROUPING "${t.grouping}"` : ""}, composer ${t.composer.length ? t.composer.join("; ") : "none"}${t.recordingId ? ", recording ID" : ""} → ${t.proposedWork ? `"${t.proposedWork}": ` : ""}${t.reason}${t.autoMatch && t.reason === "matches when Auto-match runs" ? `; Auto-match now: ${t.autoMatch}` : ""}`,
      );
    if (album.unmatchedTracks.length > 15) lines.push(`    - … ${album.unmatchedTracks.length - 15} more`);
  }
  if (!album.blocks.length && !album.unmatchedTracks.length) for (const s of album.sample) lines.push(`  - tags: title "${s.title}", work "${s.work}", grouping "${s.grouping}", composer ${JSON.stringify(s.composer)}, recording ID ${s.hasRecordingId ? "yes" : "no"}`);
}
await fs.writeFile(path.join(outDir, "audit.md"), `${lines.join("\n")}\n`);
await fs.writeFile(path.join(outDir, "audit.json"), JSON.stringify({ albums: report, duplicateWorks, dryRun, reviews: Object.fromEntries(reasons) }, null, 1));
db.close();
console.log(`Audited ${report.length} albums: ${path.join(outDir, "audit.md")}, ${path.join(outDir, "audit.json")}`);
} finally {
  await fs.rm(snapshotFolder, { recursive: true, force: true });
}
