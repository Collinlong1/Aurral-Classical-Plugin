// One performance on several releases, stored: a `same_recording` relation
// links two performances the reissue rule (`sameRecording`) joins, so the
// grouping holds when tags or the rule change, and an admin can take a link
// apart for good. Pages and search read the stored links first.
import { classicalTracks, ownedRecordings, reissueState, resolvedValues, sameRecording } from "../search/engine.js";

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function link(c, a, b) {
  const [source, target] = a < b ? [a, b] : [b, a];
  const position = c.db.prepare("SELECT coalesce(max(position),0)+1 AS n FROM relation WHERE kind='same_recording' AND source_id=?").get(source).n;
  c.relate("same_recording", source, target, { position });
}

// Link the performances the rule joins, for the works on an album (or every
// work), skipping pairs already linked and pairs an admin took apart.
export function linkReissues(c, { albumId = null } = {}) {
  const works =
    albumId == null
      ? null
      : c.db
          .prepare(
            `SELECT DISTINCT r.work_id FROM realization r JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id
             JOIN track_link t ON t.id=s.track_link_id WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?`,
          )
          .all(String(albumId))
          .map((row) => row.work_id);
  if (works && !works.length) return 0;
  const tracks = classicalTracks(c);
  const values = resolvedValues(c);
  const recordings = works ? works.flatMap((workId) => ownedRecordings(c, tracks, values, { workId })) : ownedRecordings(c, tracks, values);
  const { linked, unlinked } = reissueState(c);
  let added = 0;
  const byWork = new Map();
  for (const recording of recordings) byWork.set(recording.workId, [...(byWork.get(recording.workId) || []), recording]);
  for (const list of byWork.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        const key = pair(a.performanceId, b.performanceId);
        if (a.performanceId === b.performanceId || linked.has(key) || unlinked.has(key) || !sameRecording(a, b)) continue;
        link(c, a.performanceId, b.performanceId);
        linked.add(key);
        added++;
      }
  return added;
}

// An admin's decision that two performances are, or are not, one recording.
export function unlinkReissue(c, a, b, actor = null) {
  c.db.prepare("DELETE FROM relation WHERE kind='same_recording' AND ((source_id=? AND target_id=?) OR (source_id=? AND target_id=?))").run(a, b, b, a);
  c.audit("reissue.unlink", a, { a, b }, actor);
}
export function relinkReissue(c, a, b, actor = null) {
  if (!reissueState(c).linked.has(pair(a, b))) link(c, a, b);
  c.audit("reissue.link", a, { a, b }, actor);
}

