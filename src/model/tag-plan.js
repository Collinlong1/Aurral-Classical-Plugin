// What the catalogue says a track's classical tags should be (v0.3 8.1).
// Read only: values come from resolved fields (field_resolution: an admin's
// value, else a provider's, else what was derived) and active credits.
// Title, album and album artist are never proposed: they are the release's
// and the Library's, not the work's. A track that is not classical, plays no
// work, or plays parts of two works proposes nothing.
import { DisplayValues } from "./presentation.js";

const PERFORMING = ["soloist", "performer", "accompanist", "orchestra", "ensemble", "choir"];

const text = (value) => (typeof value === "string" ? value.trim() : "");
const list = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]).map((entry) => text(String(entry ?? ""))).filter(Boolean);

// { fields: { field: string[] }, workId, reason } — `fields` is empty and
// `reason` says why when nothing is proposed.
export function proposedTags(c, trackLinkId) {
  const none = (reason) => ({ fields: {}, workId: null, reason });
  const track = c.db
    .prepare("SELECT t.id FROM track_link t JOIN classification k ON k.target_id=t.id AND k.state='classical' WHERE t.id=? AND t.state='active'")
    .get(trackLinkId);
  if (!track) return none("Not classical");
  const items = c.db
    .prepare(
      `SELECT i.movement_id,i.sequence,r.id AS realization,r.work_id,r.performance_work_id FROM segment s
       JOIN realization_item i ON i.segment_id=s.id JOIN realization r ON r.id=i.realization_id
       JOIN entity w ON w.id=r.work_id AND w.deleted_at IS NULL
       WHERE s.track_link_id=? ORDER BY r.id,i.sequence`,
    )
    .all(trackLinkId);
  if (!items.length) return none("Not in a work");
  const workId = items[0].work_id;
  if (items.some((item) => item.work_id !== workId)) return none("Plays parts of two works");
  const values = new DisplayValues(c);
  const value = (id, field) => values.resolve(id, field).value;
  const credits = (target, roles) =>
    c.db
      .prepare(`SELECT contributor_id AS id,role,instrument FROM credit WHERE target_id=? AND state='active' AND role IN (${roles.map(() => "?").join(",")}) ORDER BY position,id`)
      .all(target, ...roles)
      .filter((credit) => c.db.prepare("SELECT 1 FROM entity WHERE id=? AND deleted_at IS NULL").get(credit.id))
      .map((credit) => ({ ...credit, name: text(value(credit.id, "name")) }))
      .filter((credit) => credit.name);
  const fields = {};
  const set = (field, entries) => {
    const clean = [...new Set(list(entries))];
    if (clean.length) fields[field] = clean;
  };

  const composers = credits(workId, ["composer"]);
  set("composer", composers.map((credit) => credit.name));
  // Sort names only when every composer has one, so the two lists pair up.
  const sorts = composers.map((credit) => text(value(credit.id, "sortName")));
  if (composers.length && sorts.every(Boolean)) set("composerSort", sorts);
  set("work", [value(workId, "title")]);

  // The movements this track plays, in order.
  const all = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position,occurrence,id").all(workId).map((row) => row.target_id);
  const played = [...new Set(items.map((item) => item.movement_id).filter(Boolean))];
  set("movementName", played.length ? [played.map((id) => text(value(id, "title"))).filter(Boolean).join(" / ")] : []);
  if (played.length === 1 && all.length > 1) {
    set("movementNumber", [String(all.indexOf(played[0]) + 1)]);
    set("movementTotal", [String(all.length)]);
  }

  // Who plays, from the performance's credits: Picard's "Name (instrument)".
  const performance = c.db.prepare("SELECT source_id FROM relation WHERE id=?").get(items[0].performance_work_id)?.source_id;
  if (performance) {
    set(
      "performers",
      credits(performance, PERFORMING).map((credit) => `${credit.name} (${text(credit.instrument) || credit.role})`),
    );
    set("conductor", credits(performance, ["conductor"]).map((credit) => credit.name).slice(0, 1));
  }
  set("catalogue", value(workId, "catalogue"));

  // The MusicBrainz work: the movement's own, when this track plays one
  // movement that has one, else the work's.
  const mbWork = (id) => c.db.prepare("SELECT record_id FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='work' AND state='active' ORDER BY record_id").get(id)?.record_id;
  set("workId", [(played.length === 1 && mbWork(played[0])) || mbWork(workId)]);
  return { fields, workId, reason: Object.keys(fields).length ? "" : "Nothing to propose" };
}
