// Read-only: why matching treats some works the way it does. For every live
// work whose title contains one of the given texts, prints what the repairs
// and the incomplete-work expansion look at: whether matching made it, its
// manual edits and editor actions (either keeps both away), merges into it,
// identities, and its recordings by album.
//
//   node scripts/explain-works.mjs <plugin data folder>/model "S215" "op. 39"
//
// Opens the catalogue read-only; never writes.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [folder, ...texts] = process.argv.slice(2);
if (!folder || !texts.length) {
  console.error('Usage: node scripts/explain-works.mjs <model folder> "<title text>" ...');
  process.exit(1);
}
const db = new DatabaseSync(path.join(folder, "classical.sqlite"), { readOnly: true });
const value = (id, field) => {
  const row = db
    .prepare("SELECT a.value,a.source FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id JOIN metadata_target m ON m.id=f.target_id WHERE m.entity_id=? AND f.field=?")
    .get(id, field);
  return row ? { value: JSON.parse(row.value), source: row.source } : null;
};
const works = db
  .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL")
  .all()
  .map(({ id }) => ({ id, title: value(id, "title") }))
  .filter(({ title }) => typeof title?.value === "string" && texts.some((text) => title.value.includes(text)));
for (const { id, title } of works) {
  const movements = db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(id).map((row) => row.target_id);
  const ids = [id, ...movements];
  const marks = ids.map(() => "?").join(",");
  console.log(`\n## ${title.value}  (${id}, title from ${title.source})`);
  console.log(`- made by matching: ${db.prepare("SELECT count(*) AS n FROM external_identity WHERE entity_id=? AND record_kind='album-work' AND state='active'").get(id).n} active album records`);
  console.log(`- MusicBrainz work IDs: ${db.prepare("SELECT group_concat(record_id) AS ids FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='work' AND state='active'").get(id).ids || "none"}`);
  console.log(`- movements: ${movements.length}`);
  const manual = db
    .prepare(`SELECT m.entity_id AS target,a.field,a.value,a.actor,a.updated_at FROM assertion a JOIN metadata_target m ON m.id=a.target_id WHERE a.source='manual' AND m.entity_id IN (${marks}) ORDER BY a.updated_at`)
    .all(...ids);
  console.log(`- manual edits: ${manual.length}`);
  for (const row of manual) console.log(`  - ${row.target === id ? "work" : "movement"} ${row.field} = ${row.value} by ${row.actor} at ${new Date(row.updated_at).toISOString()}`);
  const events = db.prepare(`SELECT action,target_id,actor,created_at,data FROM audit_event WHERE target_id IN (${marks}) AND action LIKE 'editor.%' ORDER BY id`).all(...ids);
  console.log(`- editor actions: ${events.length}`);
  for (const row of events) console.log(`  - ${row.action} by ${row.actor} at ${new Date(row.created_at).toISOString()}: ${row.data.slice(0, 160)}`);
  const merges = db.prepare("SELECT target_id,actor,data,created_at FROM audit_event WHERE action='work.merge' AND json_extract(data,'$.into')=? ORDER BY id").all(id);
  console.log(`- works merged into it: ${merges.length}`);
  for (const row of merges) console.log(`  - "${value(row.target_id, "title")?.value ?? row.target_id}" by ${row.actor} at ${new Date(row.created_at).toISOString()}`);
  const recordings = db
    .prepare(
      `SELECT r.id,CAST(json_extract(t.evidence,'$.albumId') AS TEXT) AS album,json_extract(t.evidence,'$.hints.title') AS title
       FROM realization r JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
       WHERE r.work_id=? ORDER BY r.id,i.sequence`,
    )
    .all(id);
  console.log(`- recordings: ${new Set(recordings.map((row) => row.id)).size}`);
  for (const row of recordings) console.log(`  - album ${row.album}: ${row.title}`);
}
console.log(`\n${works.length} work(s) matched.`);
db.close();
