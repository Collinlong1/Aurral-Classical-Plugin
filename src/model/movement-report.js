// A read-only list of tracks whose title numbers a different movement than
// the one they are on: "II. Allemande" on a suite's "I. Prélude". Before
// v0.3 Phase 0.10, an album with as many tracks as a work's movements was
// lined up by order even when its numbers disagreed, so excerpts from two
// albums could land on each other's movements. Nothing repairs those
// automatically; this lists them so an admin can move each track in the
// editor.
//
// db: a node:sqlite database (read-only is enough). Nothing is written.
import { movementParts, splitTitle } from "./auto-match.js";

export function movementNumberReport(db) {
  const title = db.prepare(
    `SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
     WHERE f.target_id=? AND f.field='title'`,
  );
  const titleOf = (id) => {
    const row = title.get(id);
    return row ? String(JSON.parse(row.value) ?? "") : "";
  };
  const rows = db
    .prepare(
      `SELECT r.work_id,i.movement_id,m.position,t.core_id,t.evidence
       FROM realization r
       JOIN realization_item i ON i.realization_id=r.id
       JOIN relation m ON m.kind='movement' AND m.source_id=r.work_id AND m.target_id=i.movement_id
       JOIN segment s ON s.id=i.segment_id
       JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
       ORDER BY r.work_id,json_extract(t.evidence,'$.albumId'),i.sequence`,
    )
    .all();
  const tracks = [];
  for (const row of rows) {
    const evidence = JSON.parse(row.evidence);
    const trackTitle = String(evidence.hints?.title || "");
    const track = movementParts(splitTitle(trackTitle).tail || trackTitle);
    // A piece numbered within its set ("No. 3") is not a movement number.
    if (!track.index || track.piece) continue;
    const movementTitle = titleOf(row.movement_id);
    const movement = movementParts(movementTitle);
    const number = movement.index ?? row.position;
    if (track.index === number) continue;
    tracks.push({
      workId: row.work_id,
      work: titleOf(row.work_id),
      albumId: evidence.albumId == null ? null : String(evidence.albumId),
      album: String(evidence.hints?.album || ""),
      trackId: String(row.core_id),
      title: trackTitle,
      movementId: row.movement_id,
      movement: movementTitle,
    });
  }
  return tracks;
}

export function formatMovementNumberReport(tracks) {
  if (!tracks.length) return "Movement numbers (read only): every track's number matches its movement.";
  const lines = [`Movement numbers (read only): ${tracks.length} tracks name a different movement than the one they are on.`, ""];
  let work = null;
  for (const t of tracks) {
    if (t.workId !== work) {
      work = t.workId;
      lines.push(`${t.work || "(untitled work)"} [work ${t.workId}]`);
    }
    lines.push(`  ${t.title} — on "${t.movement}" (${t.album || "no album"}, album ${t.albumId ?? "none"}, track ${t.trackId})`);
  }
  lines.push(
    "",
    "Editions that number pieces differently, or a track holding several movements, can be listed correctly. Move the others in the editor.",
  );
  return lines.join("\n");
}
