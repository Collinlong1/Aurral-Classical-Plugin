// Read-only: an album's classification as the model holds it. For each album
// id given: the album's own classification (an album pin passes down to its
// tracks at every scan), how many tracks are in each state and pinned, and
// every manual classification change on the album or its tracks, with time.
//
//   node scripts/explain-classification.mjs <plugin data folder>/model <album id> ...
//
// Opens the catalogue read-only; never writes.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [folder, ...albums] = process.argv.slice(2);
if (!folder || !albums.length) {
  console.error("Usage: node scripts/explain-classification.mjs <model folder> <album id> ...");
  process.exit(1);
}
const db = new DatabaseSync(path.join(folder, "classical.sqlite"), { readOnly: true });
const when = (ms) => new Date(ms).toISOString();
for (const album of albums) {
  const tracks = db
    .prepare(
      `SELECT t.id,t.state AS link,json_extract(t.evidence,'$.hints.title') AS title,json_extract(t.evidence,'$.hints.album') AS album,
         c.state,c.pinned,c.updated_at FROM track_link t LEFT JOIN classification c ON c.target_id=t.id
       WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=? ORDER BY t.id`,
    )
    .all(String(album));
  console.log(`\n## Album ${album}: ${tracks[0]?.album ?? "(no tracks)"}`);
  const targets = db.prepare("SELECT id,album_ref FROM metadata_target WHERE album_ref LIKE ?").all(`%"${album}"]`);
  for (const target of targets) {
    const row = db.prepare("SELECT state,pinned,updated_at FROM classification WHERE target_id=?").get(target.id);
    console.log(`- album classification ${target.album_ref}: ${row ? `${row.state}${row.pinned ? " (pinned)" : ""}, ${when(row.updated_at)}` : "none"}`);
  }
  const counts = new Map();
  for (const t of tracks) {
    const key = `${t.link} ${t.state ?? "unclassified"}${t.pinned ? " pinned" : ""}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  console.log(`- tracks: ${tracks.length} (${[...counts].map(([k, n]) => `${n} ${k}`).join(", ")})`);
  const ids = [...tracks.map((t) => t.id), ...targets.map((t) => t.id)];
  if (!ids.length) continue;
  const events = db
    .prepare(
      `SELECT action,target_id,actor,data,created_at FROM audit_event
       WHERE target_id IN (${ids.map(() => "?").join(",")}) AND (action LIKE 'classification%' OR action LIKE 'editor.%classification%')
       ORDER BY id`,
    )
    .all(...ids);
  console.log(`- manual classification changes: ${events.length}`);
  for (const e of events.slice(-15)) console.log(`  - ${when(e.created_at)} ${e.action} by ${e.actor}: ${e.data.slice(0, 120)}`);
  const reviews = db.prepare(`SELECT status,count(*) AS n FROM review_item WHERE kind='classification' AND target_id IN (${ids.map(() => "?").join(",")}) GROUP BY status`).all(...ids);
  console.log(`- classification reviews: ${reviews.map((r) => `${r.n} ${r.status}`).join(", ") || "none"}`);
}
db.close();
