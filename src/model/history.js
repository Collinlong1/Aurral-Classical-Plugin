// Undo for destructive metadata changes (merging and deleting works,
// merging and deleting people and ensembles) and movement reorders.
//
// Before the change, every row that names the works involved (their
// movements, performances, recordings, realizations, segments, credits,
// metadata, picks and reviews) is copied into change_set. Undo puts exactly
// those rows back. It refuses when anything those rows describe changed
// after the change, so it never discards a later edit. Audio files are never
// involved: the catalogue only points at them.
import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { suppressionKeys } from "./auto-match.js";

const list = (ids) => [...ids];
const marks = (ids) => list(ids).map(() => "?").join(",") || "NULL";

// Everything that belongs to these works, as ID sets.
export function workClosure(c, workIds) {
  const db = c.db;
  const entities = new Set(workIds);
  const all = (sql, ids) => (ids.length ? db.prepare(sql.replace("$", marks(ids))).all(...ids) : []);
  for (const row of all("SELECT target_id AS id FROM relation WHERE kind='movement' AND source_id IN ($)", workIds)) entities.add(row.id);
  const pw = all("SELECT id,source_id FROM relation WHERE kind='performance_work' AND target_id IN ($)", workIds);
  const relations = new Set(pw.map((row) => row.id));
  const performances = pw.map((row) => row.source_id);
  for (const id of performances) entities.add(id);
  for (const row of all("SELECT source_id AS id FROM relation WHERE kind='recording_performance' AND target_id IN ($)", performances)) entities.add(row.id);
  const realizations = new Set(all("SELECT id FROM realization WHERE work_id IN ($)", workIds).map((row) => row.id));
  const segments = new Set(all("SELECT segment_id AS id FROM realization_item WHERE realization_id IN ($)", list(realizations)).map((row) => row.id));
  const contents = new Set(
    all("SELECT id FROM recording_content WHERE performance_work_id IN ($)", list(relations)).map((row) => row.id),
  );
  for (const row of all("SELECT content_id AS id FROM segment_content WHERE segment_id IN ($)", list(segments))) contents.add(row.id);
  return { entities, relations, realizations, segments, contents };
}

// A person's or ensemble's own rows: their credits, aliases, identities,
// relations (ensemble membership), metadata and reviews all hang off the
// entity, so the entity is the whole closure.
export function contributorClosure(c, ids) {
  return { entities: new Set(ids), relations: new Set(), realizations: new Set(), segments: new Set(), contents: new Set() };
}
// Every credit naming these contributors, in a stable order: undo compares
// it with the state right after the change.
const creditState = (c, ids) =>
  JSON.stringify(c.db.prepare(`SELECT id,target_id,contributor_id,role,instrument,state FROM credit WHERE contributor_id IN (${marks(ids)}) ORDER BY id`).all(...ids).map((row) => ({ ...row })));
export const CHANGE_KINDS = ["merge", "delete", "merge-person", "delete-person", "reorder"];

// The rows to keep, table by table, with the predicate that finds them.
function predicates(set) {
  const e = list(set.entities),
    r = list(set.realizations),
    s = list(set.segments),
    k = list(set.contents),
    pw = list(set.relations);
  const any = (column, ids) => [`${column} IN (${marks(ids)})`, ids];
  const or = (...parts) => [parts.map(([sql]) => sql).join(" OR "), parts.flatMap(([, ids]) => ids)];
  // Children before parents for deleting; reversed for inserting.
  return [
    ["segment_content", or(any("segment_id", s), any("content_id", k))],
    ["realization_item", or(any("realization_id", r), any("movement_id", e), any("segment_id", s))],
    ["recording_content", or(any("id", k), any("recording_id", e), any("movement_id", e), any("performance_work_id", pw))],
    ["user_work_state", or(any("work_id", e), any("picked_realization_id", r))],
    ["admin_work_pick", or(any("work_id", e), any("realization_id", r))],
    ["realization", or(any("id", r), any("work_id", e))],
    ["segment", any("id", s)],
    ["review_item", any("target_id", e)],
    ["field_resolution", any("target_id", e)],
    ["pinned_override", any("target_id", e)],
    ["provider_record", any("target_id", e)],
    ["credit", or(any("target_id", e), any("contributor_id", e))],
    ["alias", any("entity_id", e)],
    ["catalogue_number", any("entity_id", e)],
    ["assertion", any("target_id", e)],
    ["external_identity", any("entity_id", e)],
    ["relation", or(any("source_id", e), any("target_id", e))],
    ["metadata_target", any("entity_id", e)],
    ["entity", any("id", e)],
  ];
}

// Listener state on these works: favourites, picks and admin picks. Users set
// them from the work page, which writes no audit row, so undo compares them
// with how they stood right after the change.
function listenerState(c, set) {
  const tables = new Map(predicates(set));
  const rows = (table) => {
    const [where, ids] = tables.get(table);
    return c.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...ids).map((row) => ({ ...row }));
  };
  return { user_work_state: rows("user_work_state"), admin_work_pick: rows("admin_work_pick") };
}
// What listeners did after the change: rows that differ from just after it.
// Changes recorded before the state was saved compare by time instead.
function laterListenerEdits(c, set, data, createdAt) {
  const now = listenerState(c, set);
  const userKey = (row) => `${row.user_id}|${row.work_id}`;
  if (!data.listeners) {
    return {
      users: now.user_work_state.filter((row) => row.updated_at > createdAt).map((row) => ({ row, before: null, legacy: true })),
      picks: now.admin_work_pick.filter((row) => row.updated_at > createdAt).map((row) => ({ row, before: null })),
      removedPicks: [],
    };
  }
  const was = new Map(data.listeners.user_work_state.map((row) => [userKey(row), row]));
  const users = now.user_work_state
    .filter((row) => JSON.stringify(row) !== JSON.stringify(was.get(userKey(row))))
    .map((row) => ({ row, before: was.get(userKey(row)) || null }));
  const picks = new Map(now.admin_work_pick.map((row) => [row.work_id, row]));
  return {
    users,
    picks: now.admin_work_pick
      .filter((row) => JSON.stringify(row) !== JSON.stringify(data.listeners.admin_work_pick.find((old) => old.work_id === row.work_id)))
      .map((row) => ({ row })),
    removedPicks: data.listeners.admin_work_pick.filter((row) => !picks.has(row.work_id)),
  };
}
// Puts listeners' later edits back on the restored works. A favourite stays on
// the work it was given to (a favourite taken away from a merged work is
// taken from each work it held); a pick goes with its recording, to the work
// that recording belongs to again.
function reapplyListenerEdits(c, set, edits) {
  const liveWork = (id) => Boolean(id && c.db.prepare("SELECT 1 FROM entity WHERE id=? AND kind='work' AND deleted_at IS NULL").get(id));
  const workOf = (realization) => realization && c.db.prepare("SELECT work_id FROM realization WHERE id=?").get(realization)?.work_id;
  const works = list(set.entities).filter(liveWork);
  const upsert = (user, work, column, value, at) => {
    c.db
      .prepare(
        `INSERT INTO user_work_state(user_id,work_id,favourite,picked_realization_id,updated_at) VALUES (?,?,0,NULL,?)
         ON CONFLICT(user_id,work_id) DO UPDATE SET updated_at=max(updated_at,excluded.updated_at)`,
      )
      .run(user, work, at);
    c.db.prepare(`UPDATE user_work_state SET ${column}=? WHERE user_id=? AND work_id=?`).run(value, user, work);
  };
  for (const { row, before, legacy } of edits.users) {
    if ((before?.favourite ?? 0) !== row.favourite) {
      if (row.favourite && liveWork(row.work_id)) upsert(row.user_id, row.work_id, "favourite", 1, row.updated_at);
      else if (!row.favourite && !legacy)
        for (const work of works) c.db.prepare("UPDATE user_work_state SET favourite=0 WHERE user_id=? AND work_id=?").run(row.user_id, work);
    }
    if ((before?.picked_realization_id ?? null) !== row.picked_realization_id) {
      const work = workOf(row.picked_realization_id);
      if (row.picked_realization_id && liveWork(work)) upsert(row.user_id, work, "picked_realization_id", row.picked_realization_id, row.updated_at);
      else if (!row.picked_realization_id && !legacy && liveWork(row.work_id))
        c.db.prepare("UPDATE user_work_state SET picked_realization_id=NULL WHERE user_id=? AND work_id=?").run(row.user_id, row.work_id);
    }
  }
  for (const { row } of edits.picks) {
    const work = workOf(row.realization_id);
    if (liveWork(work))
      c.db
        .prepare(
          `INSERT INTO admin_work_pick VALUES (?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET
           realization_id=excluded.realization_id,actor_id=excluded.actor_id,updated_at=excluded.updated_at`,
        )
        .run(work, row.realization_id, row.actor_id, row.updated_at);
  }
  for (const row of edits.removedPicks) c.db.prepare("DELETE FROM admin_work_pick WHERE work_id=?").run(row.work_id);
}

function snapshot(c, set) {
  const rows = {};
  for (const [table, [where, ids]] of predicates(set)) rows[table] = c.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...ids).map((row) => ({ ...row }));
  return rows;
}

const serialSet = (set) => Object.fromEntries(Object.entries(set).map(([key, ids]) => [key, list(ids)]));
const parseSet = (data) => Object.fromEntries(Object.entries(data).map(([key, ids]) => [key, new Set(ids)]));

// Runs `change` with a snapshot taken first, and records it for undo. `works`
// snapshots works and all they hold; `contributors`, people and ensembles.
export function recordChange(c, { kind, summary, works = [], contributors = [], actor, extra = {} }, change) {
  return transaction(c.db, () => {
    const set = contributors.length ? contributorClosure(c, contributors) : workClosure(c, works);
    const rows = snapshot(c, set);
    const result = change();
    // Rows the change wrote count as "its own" when checking later edits.
    const after = c.db.prepare("SELECT coalesce(max(id),0) AS n FROM audit_event").get().n;
    const id = randomUUID();
    c.db
      .prepare("INSERT INTO change_set(id,kind,actor,summary,data,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, kind, actor, summary.slice(0, 500), JSON.stringify({ set: serialSet(set), rows, after, listeners: listenerState(c, set), ...(contributors.length && { contributors, credits: creditState(c, contributors) }), ...extra }), Date.now());
    return { result, changeId: id };
  });
}

// Puts the rows back. Refused when a later change touched the same entries.
export function undoChange(c, id, actor) {
  return transaction(c.db, () => {
    const row = c.db.prepare("SELECT * FROM change_set WHERE id=?").get(id);
    if (!row) throw new Error("That change isn't in the history");
    if (row.undone_at) throw new Error("That change was undone already");
    const data = JSON.parse(row.data);
    const set = parseSet(data.set);
    if (row.kind === "delete") {
      const tracks = [...new Set((data.rows.segment || []).map((segment) => segment.track_link_id))];
      const attached = c.db.prepare(`SELECT 1 FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE s.track_link_id=? LIMIT 1`);
      if (tracks.some((track) => attached.get(track)))
        throw new Error("These tracks are in a work again; take them out first, then undo");
    }
    const ids = list(set.entities);
    const later = c.db
      .prepare(`SELECT 1 FROM audit_event WHERE id>? AND target_id IN (${marks(ids)})
         AND action NOT IN ('editor.open','editor.move-tracks-open','editor.bulk-edit-open',
           'editor.choose-album-work','editor.new-album-work') LIMIT 1`)
      .get(data.after, ...ids);
    // Selection tokens are not edits. Only a later live destructive snapshot
    // sharing these entities blocks undo; insertion order handles tied clocks.
    const laterChange = c.db.prepare(`SELECT 1 FROM change_set c
      WHERE c.rowid > (SELECT rowid FROM change_set WHERE id=?)
        AND c.kind IN ('merge','delete','merge-person','delete-person') AND c.undone_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(c.data, '$.set.entities') e
          WHERE e.value IN (${marks(ids)})) LIMIT 1`).get(id, ...ids);
    // A credit given to or taken from these people since, from any page.
    const creditsChanged = data.contributors && creditState(c, data.contributors) !== data.credits;
    if (later || laterChange || creditsChanged) throw new Error("These entries changed after this, so undoing it would lose that change. Undo the later changes first, or fix it by hand.");
    const listeners = laterListenerEdits(c, set, data, row.created_at);
    c.db.exec("PRAGMA defer_foreign_keys=ON");
    const tables = predicates(set);
    for (const [table, [where, args]] of tables) c.db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...args);
    for (const [table] of [...tables].reverse())
      for (const saved of data.rows[table] || []) {
        const columns = Object.keys(saved);
        c.db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((key) => saved[key]));
      }
    // People and ensembles a restored credit names come back too: a work
    // restored after its composer was deleted still has its composer.
    const named = [...new Set((data.rows.credit || []).map((credit) => credit.contributor_id))];
    if (named.length)
      c.db.prepare(`UPDATE entity SET deleted_at=NULL,updated_at=? WHERE kind IN ('person','ensemble') AND deleted_at IS NOT NULL AND id IN (${marks(named)})`).run(Date.now(), ...named);
    reapplyListenerEdits(c, set, listeners);
    if (c.db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Undo would break the catalogue's links; nothing was changed");
    for (const key of data.suppressions || []) c.db.prepare("DELETE FROM match_suppression WHERE key=?").run(key);
    // A merge matching made and an admin undid: the two stay apart.
    for (const key of data.keepApart || [])
      c.db.prepare("INSERT INTO match_suppression VALUES (?,?,?,?,?) ON CONFLICT(key) DO NOTHING").run(key, row.summary.slice(0, 200), "distinct", actor, Date.now());
    c.db.prepare("UPDATE change_set SET undone_at=? WHERE id=?").run(Date.now(), id);
    c.audit("change.undo", data.set.entities[0] || id, { change: id, kind: row.kind }, actor);
    return { kind: row.kind, summary: row.summary, works: data.works || [] };
  });
}

export function recentChanges(c, limit = 50) {
  return c.db
    .prepare(`SELECT id,kind,actor,summary,created_at,undone_at FROM change_set WHERE kind IN (${CHANGE_KINDS.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT ?`)
    .all(...CHANGE_KINDS, limit);
}

// What deleting these works would take with them, for the confirmation.
export function deletionImpact(c, workIds) {
  const set = workClosure(c, workIds);
  const count = (sql, ids) => (ids.length ? c.db.prepare(sql.replace("$", marks(ids))).get(...ids).n : 0);
  return {
    works: workIds.length,
    movements: count("SELECT count(*) AS n FROM relation WHERE kind='movement' AND source_id IN ($)", workIds),
    recordings: set.realizations.size,
    tracks: count("SELECT count(DISTINCT s.track_link_id) AS n FROM segment s WHERE s.id IN ($)", list(set.segments)),
  };
}

// Deletes works from the catalogue: their recordings let go of their tracks
// (the tracks and their files stay), their movements and credits go, and
// matching won't make them again until an admin allows it. Undoable.
export function deleteWorks(c, workIds, actor, { names }) {
  const impact = deletionImpact(c, workIds);
  const keys = [];
  return recordChange(
    c,
    { kind: "delete", summary: `Deleted ${workIds.length === 1 ? `“${names[0]}”` : `${workIds.length} works`}`, works: workIds, actor, extra: { works: workIds, impact, get suppressions() { return keys; } } },
    () => {
      const now = Date.now();
      for (const work of workIds) {
        for (const item of c.db.prepare("SELECT i.id FROM realization_item i JOIN realization r ON r.id=i.realization_id WHERE r.work_id=?").all(work))
          c.detachItem(item.id, { dropRecording: true });
        c.db.prepare("DELETE FROM realization WHERE work_id=?").run(work);
        for (const { target_id: movement } of c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=?").all(work))
          c.db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(now, now, movement);
        c.db.prepare("DELETE FROM relation WHERE kind='movement' AND source_id=?").run(work);
        c.db.prepare("DELETE FROM relation WHERE kind='collection_member' AND (source_id=? OR target_id=?)").run(work, work);
        c.db.prepare("UPDATE user_work_state SET favourite=0,picked_realization_id=NULL,updated_at=? WHERE work_id=?").run(now, work);
        c.db.prepare("DELETE FROM admin_work_pick WHERE work_id=?").run(work);
        c.db.prepare("UPDATE review_item SET status='resolved' WHERE target_id=? AND status='open'").run(work);
        const composers = c.db
          .prepare(
            `SELECT a.value FROM credit k JOIN field_resolution f ON f.target_id=k.contributor_id AND f.field='name'
             JOIN assertion a ON a.id=f.assertion_id WHERE k.target_id=? AND k.role='composer' AND k.state='active'`,
          )
          .all(work)
          .map((row) => JSON.parse(row.value));
        const mb = c.db.prepare("SELECT record_id FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='work' AND state='active'").all(work);
        for (const key of [
          ...suppressionKeys(names[workIds.indexOf(work)], composers),
          ...mb.map((row) => `musicbrainz:${row.record_id}`),
        ]) {
          keys.push(key);
          c.db.prepare("INSERT INTO match_suppression VALUES (?,?,?,?,?) ON CONFLICT(key) DO NOTHING").run(key, names[workIds.indexOf(work)], "deleted", actor, now);
        }
        c.db.prepare("DELETE FROM credit WHERE target_id=?").run(work);
        c.db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(now, now, work);
        c.audit("work.delete", work, { impact }, actor);
      }
      return impact;
    },
  );
}
