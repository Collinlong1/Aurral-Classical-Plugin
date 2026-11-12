// A read-only classification report: for each indexed track, the stored
// decision, where it came from (a track pin, an album pin or the automatic
// classifier), the evidence and score behind it, and what the current
// classifier would decide from the same stored evidence on the next scan.
//
// The model database is opened read-only; nothing is written, rescanned or
// fetched, and no media is touched. scripts/model-admin.mjs prints it for a
// whole library ("dry run"); the album action shows a short summary.
import path from "node:path";
import { classificationEvidence } from "./classify-evidence.js";

export async function openModelReadOnly(folder) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(path.join(folder, "classical.sqlite"), { readOnly: true });
}

const describe = (signal) => `${signal.signal}${signal.value ? ` "${signal.value}"` : ""} +${signal.points}`;

// db: a node:sqlite database (read-only is enough). Returns { tracks, summary }.
export function classificationReport(db, { albumId = null, all = false } = {}) {
  const albumPins = new Map(
    db
      .prepare(
        `SELECT m.album_ref,c.state FROM metadata_target m JOIN classification c ON c.target_id=m.id
         WHERE m.album_ref IS NOT NULL AND c.pinned=1`,
      )
      .all()
      .map((row) => [JSON.parse(row.album_ref)[1], row.state]),
  );
  const rows = db
    .prepare(
      `SELECT t.id,t.core_id,t.instance_id,t.evidence,c.state,c.pinned,c.score
       FROM track_link t LEFT JOIN classification c ON c.target_id=t.id
       WHERE t.state='active' ${albumId == null ? "" : "AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?"}
       ORDER BY json_extract(t.evidence,'$.albumId'),json_extract(t.evidence,'$.hints.discNumber'),json_extract(t.evidence,'$.hints.trackNumber'),t.id`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]));
  const tracks = [];
  const summary = { tracks: 0, stored: {}, next: {}, changes: 0, pinned: 0, albumPinned: 0 };
  for (const row of rows) {
    const evidence = JSON.parse(row.evidence);
    const { albumOverride, ...hints } = evidence.hints || {};
    const album = evidence.albumId == null ? null : String(evidence.albumId);
    const albumPin = album == null ? null : albumPins.get(album) ?? null;
    const automatic = classificationEvidence(hints);
    const source = row.pinned ? "track pin" : albumPin ? "album pin" : "automatic";
    const next = row.pinned ? row.state : albumPin || automatic.decision;
    const stored = row.state || "unclassified";
    const entry = {
      trackId: String(row.core_id),
      albumId: album,
      album: hints.album || "",
      title: hints.title || path.basename(evidence.path || ""),
      artist: hints.artist || "",
      genres: hints.genres || [],
      composer: hints.composer || [],
      work: hints.work || "",
      stored,
      source,
      storedScore: row.score,
      score: automatic.score,
      automatic: automatic.decision,
      reason: automatic.reason,
      evidence: automatic.signals.map(describe),
      next,
      changes: next !== stored,
    };
    summary.tracks++;
    summary.stored[stored] = (summary.stored[stored] || 0) + 1;
    summary.next[next] = (summary.next[next] || 0) + 1;
    if (entry.changes) summary.changes++;
    if (source === "track pin") summary.pinned++;
    if (source === "album pin") summary.albumPinned++;
    // Flagged: anything classical or unsure, pinned, or about to change.
    if (all || stored !== "not_classical" || next !== "not_classical" || source !== "automatic") tracks.push(entry);
  }
  return { tracks, summary };
}

export function formatReport({ tracks, summary }) {
  const count = (states) => Object.entries(states).map(([state, n]) => `${state} ${n}`).join(", ") || "none";
  const lines = [
    `Classification report (read only): ${summary.tracks} indexed tracks.`,
    `Stored now: ${count(summary.stored)}. After the next scan: ${count(summary.next)}. ${summary.changes} would change; ${summary.pinned} track pins and ${summary.albumPinned} tracks under album pins are kept.`,
    "",
  ];
  let album = null;
  for (const t of tracks) {
    if (t.albumId !== album) {
      album = t.albumId;
      lines.push(`${t.album || "(no album)"} [album ${t.albumId ?? "none"}]`);
    }
    lines.push(
      `  ${t.changes ? "*" : " "} ${t.title} — ${t.artist}`,
      `      stored ${t.stored} (${t.source}); next scan ${t.next}; automatic ${t.automatic}, score ${t.score}: ${t.reason}`,
      `      genres: ${t.genres.join("; ") || "none"}; composer: ${t.composer.join("; ") || "none"}${t.work ? `; WORK: ${t.work}` : ""}`,
      `      evidence: ${t.evidence.join("; ") || "none"}`,
    );
  }
  if (!tracks.length) lines.push("No classical, unsure, pinned or changing tracks.");
  lines.push("", "* = classification changes on the next scan. Pins are never changed by a scan.");
  return lines.join("\n");
}

// The album action's answer: counts and the first flagged tracks, within the
// host's 500-character message limit. The full report is the CLI's.
export async function albumClassificationSummary(ctx, albumId) {
  const folder = path.join(ctx.dataFolder, "model");
  let db;
  try {
    db = await openModelReadOnly(folder);
  } catch {
    return "No classical model yet. Run Scan classical model (read only) first.";
  }
  try {
    const { tracks, summary } = classificationReport(db, { albumId, all: true });
    if (!summary.tracks) return "This album has no indexed tracks. Run Scan classical model (read only) first.";
    const counts = Object.entries(summary.stored).map(([state, n]) => `${n} ${state.replace("_", " ")}`).join(", ");
    const flagged = tracks
      .filter((t) => t.stored !== "not_classical" || t.changes || t.source !== "automatic")
      .map((t) => `${t.title.slice(0, 40)}: ${t.stored}${t.source === "automatic" ? "" : ` (${t.source})`}${t.changes ? ` → ${t.next}` : ""}, score ${t.score}`);
    const message = `Read only. ${summary.tracks} tracks: ${counts}.${summary.changes ? ` ${summary.changes} change on the next scan.` : ""} ${flagged.join("; ")}`;
    return message.length > 500 ? `${message.slice(0, 440)}… Full report: node scripts/model-admin.mjs classification` : message;
  } finally {
    db.close();
  }
}
