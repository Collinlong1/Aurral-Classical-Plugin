import { tagSensitive } from "./fingerprint.js";

// A container hash changes on retag. The core file row follows source/path,
// while its track row may change with the title. Duration must still agree.
export const sameRetaggedFile = (old, fileId, item) =>
  (tagSensitive(old.fingerprint) || tagSensitive(item.fingerprint)) &&
  fileId === item.fileId && old.path === item.path &&
  old.durationMs != null && old.durationMs === item.durationMs;

// Called inside reconcile's transaction, before candidate ownership is built.
// Only repair the old unambiguous split; user-edited or ambiguous data stays
// available for review rather than being discarded.
export function repairRetaggedLinks(c, snapshot) {
  const db = c.db, resolved = new Set(), blocked = new Set(), proposals = [];
  const reviews = db.prepare(`SELECT v.id AS review_id,v.evidence AS review_evidence,t.*
    FROM review_item v JOIN track_link t ON t.id=v.target_id
    WHERE v.kind='track_link' AND v.status='open' AND t.instance_id=? AND t.state!='active'`).all(snapshot.instanceId);
  if (!reviews.length) return { resolved, blocked };
  const files = new Map();
  for (const item of snapshot.tracks) {
    const key = JSON.stringify([item.fileId, item.path]);
    files.set(key, [...(files.get(key) || []), item]);
  }
  for (const old of reviews) {
    const review = JSON.parse(old.review_evidence), evidence = JSON.parse(old.evidence);
    if (review.epochChanged || review.reused?.length !== 1) continue;
    if (!sameRetaggedFile(evidence, old.file_id, review.reused[0])) continue;
    const current = (files.get(JSON.stringify([old.file_id, evidence.path])) || []).filter((item) => sameRetaggedFile(evidence, old.file_id, item));
    if (current.length !== 1) { blocked.add(old.id); continue; }
    proposals.push({ old, item: current[0] });
  }
  const claims = new Map();
  for (const p of proposals) claims.set(p.item, (claims.get(p.item) || 0) + 1);
  const dirty = (ids) => {
    const marks = ids.map(() => "?").join(",");
    return db.prepare(`SELECT 1 FROM assertion WHERE target_id IN (${marks}) AND source='manual' LIMIT 1`).get(...ids) ||
      db.prepare(`SELECT 1 FROM pinned_override WHERE target_id IN (${marks}) LIMIT 1`).get(...ids) ||
      db.prepare(`SELECT 1 FROM classification WHERE target_id IN (${marks}) AND pinned=1 LIMIT 1`).get(...ids) ||
      db.prepare(`SELECT 1 FROM audit_event WHERE target_id IN (${marks}) AND action LIKE 'editor.%'
        AND action NOT IN ('editor.open','editor.move-tracks-open','editor.choose-album-work','editor.bulk-edit-open','editor.new-album-work') LIMIT 1`).get(...ids);
  };
  for (const { old, item } of proposals) {
    blocked.add(old.id);
    // Multiple old links claiming the same physical file need an admin.
    if (claims.get(item) !== 1) continue;
    const siblings = db.prepare(`SELECT * FROM track_link WHERE instance_id=? AND file_id=?
      AND json_extract(evidence,'$.path')=? AND id!=?`).all(snapshot.instanceId, item.fileId, item.path, old.id);
    if (siblings.length > 1 || (siblings.length === 1 && siblings[0].state !== 'active')) continue;
    const newer = siblings[0];
    if (newer) {
      const next = JSON.parse(newer.evidence);
      if (newer.core_id !== item.coreId || next.durationMs !== item.durationMs) continue;
      const oldItems = db.prepare(`SELECT i.realization_id,i.movement_id,r.work_id,p.source_id AS performance_id FROM realization_item i
        JOIN segment s ON s.id=i.segment_id JOIN realization r ON r.id=i.realization_id
        JOIN relation p ON p.id=r.performance_work_id WHERE s.track_link_id=?`).all(old.id);
      const newItems = db.prepare(`SELECT i.id,i.realization_id,i.movement_id,r.work_id,p.source_id AS performance_id,
        rc.recording_id FROM realization_item i JOIN segment s ON s.id=i.segment_id
        JOIN realization r ON r.id=i.realization_id JOIN relation p ON p.id=r.performance_work_id
        LEFT JOIN segment_content sc ON sc.segment_id=s.id LEFT JOIN recording_content rc ON rc.id=sc.content_id
        WHERE s.track_link_id=?`).all(newer.id);
      const originals = new Set(oldItems.flatMap((i) => [i.movement_id, i.performance_id]).filter(Boolean));
      const ids = [...new Set([newer.id, ...newItems.flatMap((i) => [i.movement_id,i.performance_id,i.recording_id]).filter((id) => id && !originals.has(id))])];
      if (dirty(ids)) continue;
      if (newItems.some((i) => db.prepare(`SELECT 1 FROM audit_event WHERE target_id=? AND created_at>=?
        AND action IN ('editor.move-movement','editor.set-movement-order','editor.reorder-movements','editor.add-movement','editor.delete-movement') LIMIT 1`).get(i.work_id, newer.created_at))) continue;
      if (db.prepare(`SELECT 1 FROM audit_event a,json_each(a.data,'$.values.tracks') t
        WHERE a.action IN ('editor.assign-album','editor.unassign-tracks','editor.create-work-from-album') AND t.value=? LIMIT 1`).get(newer.id)) continue;
      if (newItems.some((i) => !oldItems.some((o) => o.work_id === i.work_id))) continue;
      const oldRealizations = new Set(oldItems.map((i) => i.realization_id));
      if (newItems.some((i) => !oldRealizations.has(i.realization_id) &&
        (db.prepare("SELECT 1 FROM user_work_state WHERE picked_realization_id=?").get(i.realization_id) ||
         db.prepare("SELECT 1 FROM admin_work_pick WHERE realization_id=?").get(i.realization_id)))) continue;
      // Unknown/orphan segment structures are not this automatic-retag split.
      if (db.prepare(`SELECT 1 FROM segment s WHERE s.track_link_id=? AND NOT EXISTS
        (SELECT 1 FROM realization_item i WHERE i.segment_id=s.id) LIMIT 1`).get(newer.id)) continue;
      for (const id of new Set(newItems.map((i) => i.id))) c.detachItem(id, { dropRecording: true });
      const originalMovements = new Set(oldItems.map((i) => i.movement_id)), prunedWorks = new Set();
      for (const movement of new Set(newItems.map((i) => i.movement_id).filter(Boolean))) {
        if (originalMovements.has(movement) || db.prepare(`SELECT 1 FROM realization_item WHERE movement_id=?
          UNION SELECT 1 FROM recording_content WHERE movement_id=?`).get(movement, movement)) continue;
        for (const row of db.prepare("SELECT source_id FROM relation WHERE kind='movement' AND target_id=?").all(movement)) prunedWorks.add(row.source_id);
        db.prepare("DELETE FROM relation WHERE kind='movement' AND target_id=?").run(movement);
        db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), movement);
      }
      for (const work of prunedWorks) {
        const parts = db.prepare("SELECT id,position FROM relation WHERE kind='movement' AND source_id=? ORDER BY position,id").all(work);
        const bump = parts.reduce((max, p) => Math.max(max, p.position), 0) + parts.length + 1;
        db.prepare("UPDATE relation SET position=position+? WHERE kind='movement' AND source_id=?").run(bump, work);
        parts.forEach((part, i) => db.prepare("UPDATE relation SET position=? WHERE id=?").run(i + 1, part.id));
      }
      for (const work of new Set(newItems.map((i) => i.work_id))) c.audit("work.repair_retag", work, { keep: old.id, removed: newer.id });
      for (const table of ['field_resolution','pinned_override','provider_record','classification']) db.prepare(`DELETE FROM ${table} WHERE target_id=?`).run(newer.id);
      db.prepare("DELETE FROM assertion WHERE target_id=?").run(newer.id);
      db.prepare("DELETE FROM metadata_target WHERE track_link_id=?").run(newer.id);
      db.prepare("DELETE FROM track_evidence WHERE track_link_id=?").run(newer.id);
      db.prepare("UPDATE review_item SET status='resolved' WHERE target_id=? AND status='open'").run(newer.id);
      db.prepare("DELETE FROM track_link WHERE id=?").run(newer.id);
      c.audit("track.repair_retag", old.id, { removed: newer.id, generation: snapshot.generation });
    }
    blocked.delete(old.id);
    resolved.add(old.id);
  }
  return { resolved, blocked };
}
