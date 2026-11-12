import { randomUUID } from "node:crypto";
import { openDatabase, backupDatabase, transaction } from "./database.js";

const kinds = new Set([
  "person",
  "ensemble",
  "work",
  "movement",
  "collection",
  "performance",
  "recording",
  "release",
]);
const roles = new Set([
  "composer",
  "soloist",
  "performer",
  "conductor",
  "orchestra",
  "ensemble",
  "choir",
  "arranger",
]);
const relations = {
  movement: [["work"], ["movement"]],
  collection_member: [["collection"], ["work", "collection"]],
  performance_work: [["performance"], ["work"]],
  recording_performance: [["recording"], ["performance"]],
  work_relation: [["work"], ["work"]],
  recording_relation: [["recording"], ["recording"]],
};
export const json = (value) => JSON.stringify(value);
const parse = (row) => row && { ...row, data: JSON.parse(row.data) };
export const positive = (value) => Number.isSafeInteger(value) && value > 0;
const range = (start, end) =>
  Number.isSafeInteger(start) &&
  start >= 0 &&
  (end === null || (Number.isSafeInteger(end) && end > start));

export class Catalogue {
  constructor(db, filename) {
    this.db = db;
    this.filename = filename;
  }
  close() {
    this.db.close();
  }
  backup(destination) {
    return backupDatabase(this.db, destination);
  }
  audit(action, target, data = {}, actor = null) {
    this.db
      .prepare(
        "INSERT INTO audit_event(actor,action,target_id,data,created_at) VALUES (?,?,?,?,?)",
      )
      .run(actor, action, target, json(data), Date.now());
  }
  review(kind, target, evidence) {
    this.db
      .prepare(
        `INSERT INTO review_item VALUES (?,?,?,?, 'open',?)
      ON CONFLICT(kind,target_id) WHERE status='open' DO UPDATE SET evidence=excluded.evidence`,
      )
      .run(randomUUID(), kind, target, json(evidence), Date.now());
  }
  entity(id, expected) {
    const row = parse(
      this.db
        .prepare("SELECT * FROM entity WHERE id=? AND deleted_at IS NULL")
        .get(id),
    );
    if (!row || (expected && ![].concat(expected).includes(row.kind)))
      throw new Error("Missing entity or wrong entity kind");
    return row;
  }
  createEntity(kind, data = {}) {
    if (
      !kinds.has(kind) ||
      !data ||
      Array.isArray(data) ||
      typeof data !== "object"
    )
      throw new Error("Invalid entity");
    if (data.durationMs != null && !positive(data.durationMs))
      throw new Error("Invalid entity duration");
    if (
      data.date != null &&
      (typeof data.date !== "string" ||
        !/^\d{4}(-(?:0[1-9]|1[0-2])(-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(
          data.date,
        ))
    )
      throw new Error("Use a partial ISO date, without invented precision");
    return transaction(this.db, () => {
      const id = randomUUID(),
        now = Date.now();
      this.db
        .prepare(
          "INSERT INTO entity(id,kind,data,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
        .run(id, kind, json(data), now, now);
      this.db
        .prepare("INSERT INTO metadata_target(id,entity_id) VALUES (?,?)")
        .run(id, id);
      this.audit("entity.create", id, { kind });
      return id;
    });
  }
  relate(kind, source, target, { position = 1, occurrence = 1, ...data } = {}) {
    return transaction(this.db, () => {
      const rule = relations[kind];
      if (
        !rule ||
        !positive(position) ||
        !positive(occurrence) ||
        source === target
      )
        throw new Error("Invalid relation");
      this.entity(source, rule[0]);
      this.entity(target, rule[1]);
      if (
        kind === "movement" &&
        this.db
          .prepare(
            "SELECT 1 FROM relation WHERE kind='movement' AND target_id=?",
          )
          .get(target)
      )
        throw new Error("Movement already belongs to a work");
      if (
        kind === "collection_member" &&
        this.db
          .prepare(
            `WITH RECURSIVE descendants(id) AS
        (SELECT ? UNION SELECT r.target_id FROM relation r JOIN descendants d ON r.source_id=d.id
         WHERE r.kind='collection_member') SELECT 1 FROM descendants WHERE id=?`,
          )
          .get(target, source)
      )
        throw new Error("Collection cycle");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO relation VALUES (?,?,?,?,?,?,?)")
        .run(id, kind, source, target, position, occurrence, json(data));
      this.audit("relation.create", id, { kind, source, target });
      return id;
    });
  }
  credit(
    target,
    contributor,
    role,
    { instrument = null, position = 1, assertionId = null } = {},
  ) {
    return transaction(this.db, () => {
      this.entity(target);
      const person = this.entity(contributor, ["person", "ensemble"]);
      if (
        !roles.has(role) ||
        !positive(position) ||
        (["composer", "soloist", "conductor", "arranger"].includes(role) &&
          person.kind !== "person") ||
        (["orchestra", "ensemble", "choir"].includes(role) &&
          person.kind !== "ensemble")
      )
        throw new Error("Invalid role/contributor");
      if (assertionId) {
        const assertion = this.db
          .prepare("SELECT target_id FROM assertion WHERE id=?")
          .get(assertionId);
        if (assertion?.target_id !== target)
          throw new Error("Credit provenance target mismatch");
      }
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO credit VALUES (?,?,?,?,?,?,?)")
        .run(id, target, contributor, role, instrument, position, assertionId);
      return id;
    });
  }
  externalIdentity(
    entity,
    provider,
    recordKind,
    recordId,
    { confidence = 1, threshold = 0.95, evidence = {} } = {},
  ) {
    return transaction(this.db, () => {
      this.entity(entity);
      if (
        !provider ||
        !recordKind ||
        !recordId ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1 ||
        !Number.isFinite(threshold) ||
        threshold < 0.95 ||
        threshold > 1
      )
        throw new Error("Invalid provider identity");
      const existing = this.db
        .prepare(
          `SELECT entity_id FROM external_identity WHERE provider=? AND record_kind=? AND record_id=? AND state='active'`,
        )
        .get(provider, recordKind, recordId);
      if (
        confidence < threshold ||
        (existing && existing.entity_id !== entity)
      ) {
        this.review("identity", entity, {
          provider,
          recordKind,
          recordId,
          confidence,
          evidence,
        });
        return false;
      }
      this.db
        .prepare(
          `INSERT INTO external_identity VALUES (?,?,?,?,'active',?)
        ON CONFLICT(entity_id,provider,record_kind,record_id) DO UPDATE SET state='active',evidence=excluded.evidence`,
        )
        .run(entity, provider, recordKind, recordId, json(evidence));
      return true;
    });
  }
  releaseItem(release, { disc = 1, position }) {
    this.entity(release, "release");
    if (!positive(disc) || !positive(position))
      throw new Error("Invalid release placement");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO release_item VALUES (?,?,?,?)")
      .run(id, release, disc, position);
    return id;
  }
  attachRecording(
    item,
    recording,
    { occurrence = 1, startMs = 0, endMs = null } = {},
  ) {
    this.entity(recording, "recording");
    if (!positive(occurrence) || !range(startMs, endMs))
      throw new Error("Invalid recording range");
    this.db
      .prepare("INSERT INTO release_item_recording VALUES (?,?,?,?,?)")
      .run(item, recording, occurrence, startMs, endMs);
  }
  attachTrack(track, item) {
    this.db
      .prepare("INSERT INTO track_release_item VALUES (?,?)")
      .run(track, item);
  }
  performanceWork(id) {
    const row = this.db
      .prepare("SELECT * FROM relation WHERE id=? AND kind='performance_work'")
      .get(id);
    if (!row) throw new Error("Missing performance/work");
    return row;
  }
  checkMovement(work, movement) {
    if (
      movement !== null &&
      !this.db
        .prepare(
          "SELECT 1 FROM relation WHERE kind='movement' AND source_id=? AND target_id=?",
        )
        .get(work, movement)
    )
      throw new Error("Movement belongs to a different work");
  }
  recordingContent(
    recording,
    performanceWork,
    { movement = null, position = 1, startMs = 0, endMs = null } = {},
  ) {
    return transaction(this.db, () => {
      this.entity(recording, "recording");
      const pw = this.performanceWork(performanceWork);
      this.checkMovement(pw.target_id, movement);
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM relation WHERE kind='recording_performance' AND source_id=? AND target_id=?",
          )
          .get(recording, pw.source_id)
      )
        throw new Error("Recording does not capture this performance");
      const duration = this.entity(recording).data.durationMs;
      if (
        !positive(position) ||
        !range(startMs, endMs) ||
        (duration != null && (startMs >= duration || endMs > duration))
      )
        throw new Error("Invalid content range");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO recording_content VALUES (?,?,?,?,?,?,?)")
        .run(
          id,
          recording,
          performanceWork,
          movement,
          position,
          startMs,
          endMs,
        );
      return id;
    });
  }
  segment(track, { startMs = 0, endMs = null, kind = "range" } = {}) {
    return transaction(this.db, () => {
      const row = this.db
        .prepare("SELECT evidence FROM track_link WHERE id=?")
        .get(track);
      if (!row) throw new Error("Missing track link");
      const duration = JSON.parse(row.evidence).durationMs;
      if (
        !range(startMs, endMs) ||
        !["range", "whole"].includes(kind) ||
        (kind === "range" && endMs === null) ||
        (kind === "whole" && startMs !== 0) ||
        (duration != null && (startMs >= duration || endMs > duration))
      )
        throw new Error("Invalid track range");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO segment VALUES (?,?,?,?,?)")
        .run(id, track, startMs, endMs, kind);
      return id;
    });
  }
  segmentContent(segment, content, occurrence = 1) {
    if (!positive(occurrence)) throw new Error("Invalid occurrence");
    this.db
      .prepare("INSERT INTO segment_content VALUES (?,?,?)")
      .run(segment, content, occurrence);
  }
  realization(work, performanceWork, label = null) {
    this.entity(work, "work");
    if (this.performanceWork(performanceWork).target_id !== work)
      throw new Error("Work/performance mismatch");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO realization VALUES (?,?,?,?)")
      .run(id, work, performanceWork, label);
    return id;
  }
  realizationItem(
    realization,
    segment,
    {
      movement = null,
      sequence = 1,
      occurrence = 1,
      intentionalOverlap = false,
    } = {},
  ) {
    return transaction(this.db, () => {
      const row = this.db
        .prepare("SELECT * FROM realization WHERE id=?")
        .get(realization);
      if (!row || !positive(sequence) || !positive(occurrence))
        throw new Error("Invalid realization item");
      this.checkMovement(row.work_id, movement);
      const content = this.db
        .prepare(
          `SELECT c.* FROM segment_content s JOIN recording_content c ON c.id=s.content_id
      WHERE s.segment_id=? AND c.performance_work_id=? AND c.movement_id IS ?`,
        )
        .all(segment, row.performance_work_id, movement);
      if (!content.length)
        throw new Error("Segment belongs to another interpretation/movement");
      const repeated = this.db
        .prepare(
          "SELECT 1 FROM realization_item WHERE realization_id=? AND movement_id IS ? AND occurrence=?",
        )
        .get(realization, movement, occurrence);
      if (repeated)
        throw new Error("Repeated movement requires explicit new occurrence");
      const audio = this.db
        .prepare("SELECT * FROM segment WHERE id=?")
        .get(segment);
      const overlaps = this.db
        .prepare(
          `SELECT s.* FROM realization_item i JOIN segment s ON s.id=i.segment_id
      WHERE i.realization_id=? AND s.track_link_id=? AND s.start_ms<coalesce(?,9223372036854775807)
      AND coalesce(s.end_ms,9223372036854775807)>?`,
        )
        .all(realization, audio.track_link_id, audio.end_ms, audio.start_ms);
      if (overlaps.length && !intentionalOverlap)
        throw new Error(
          "Overlapping playback requires explicit artistic occurrence approval",
        );
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO realization_item VALUES (?,?,?,?,?,?)")
        .run(id, realization, movement, segment, sequence, occurrence);
      return id;
    });
  }
  // Remove one track attachment and everything that existed only for it: the
  // segment and its content links, an emptied realization (and picks of it)
  // and, with dropRecording, a per-track recording and its emptied performance.
  // Leaving any of these behind kept the track "attached" for auto-match and
  // kept the work and movement "in use".
  detachItem(itemId, { dropRecording = false } = {}) {
    return transaction(this.db, () => {
      const db = this.db;
      const item = db.prepare("SELECT * FROM realization_item WHERE id=?").get(itemId);
      if (!item) return false;
      db.prepare("DELETE FROM realization_item WHERE id=?").run(itemId);
      const now = Date.now();
      if (!db.prepare("SELECT 1 FROM realization_item WHERE segment_id=?").get(item.segment_id)) {
        const contents = db
          .prepare(
            `SELECT c.id,c.recording_id,c.performance_work_id FROM segment_content s
             JOIN recording_content c ON c.id=s.content_id WHERE s.segment_id=?`,
          )
          .all(item.segment_id);
        db.prepare("DELETE FROM segment_content WHERE segment_id=?").run(item.segment_id);
        db.prepare("DELETE FROM segment WHERE id=?").run(item.segment_id);
        for (const content of contents) {
          if (db.prepare("SELECT 1 FROM segment_content WHERE content_id=?").get(content.id)) continue;
          db.prepare("DELETE FROM recording_content WHERE id=?").run(content.id);
          if (!dropRecording || db.prepare("SELECT 1 FROM recording_content WHERE recording_id=?").get(content.recording_id))
            continue;
          db.prepare("DELETE FROM relation WHERE kind='recording_performance' AND source_id=?").run(content.recording_id);
          db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(now, now, content.recording_id);
        }
      }
      if (!db.prepare("SELECT 1 FROM realization_item WHERE realization_id=?").get(item.realization_id)) {
        const realization = db.prepare("SELECT * FROM realization WHERE id=?").get(item.realization_id);
        db.prepare("UPDATE user_work_state SET picked_realization_id=NULL,updated_at=? WHERE picked_realization_id=?").run(now, realization.id);
        db.prepare("DELETE FROM admin_work_pick WHERE realization_id=?").run(realization.id);
        db.prepare("DELETE FROM realization WHERE id=?").run(realization.id);
        const pw = db.prepare("SELECT * FROM relation WHERE id=?").get(realization.performance_work_id);
        if (
          dropRecording &&
          pw &&
          !db.prepare("SELECT 1 FROM realization WHERE performance_work_id=?").get(pw.id) &&
          !db.prepare("SELECT 1 FROM recording_content WHERE performance_work_id=?").get(pw.id) &&
          !db.prepare("SELECT 1 FROM relation WHERE kind='recording_performance' AND target_id=?").get(pw.source_id)
        ) {
          db.prepare("DELETE FROM relation WHERE id=?").run(pw.id);
          if (!db.prepare("SELECT 1 FROM relation WHERE source_id=? OR target_id=?").get(pw.source_id, pw.source_id)) {
            db.prepare("DELETE FROM credit WHERE target_id=?").run(pw.source_id);
            db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL").run(now, now, pw.source_id);
          }
        }
      }
      return true;
    });
  }
  alias(
    entity,
    text,
    { language = null, kind = "alternate", assertionId = null } = {},
  ) {
    this.entity(entity);
    if (typeof text !== "string" || !text.trim())
      throw new Error("Invalid alias");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO alias VALUES (?,?,?,?,?,?,?)")
      .run(
        id,
        entity,
        text,
        text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase(),
        language,
        kind,
        assertionId,
      );
    return id;
  }
  catalogueNumber(entity, system, display, normalized) {
    this.entity(entity, ["work", "collection"]);
    if (
      ![system, display, normalized].every(
        (v) => typeof v === "string" && v.length,
      )
    )
      throw new Error("Invalid catalogue number");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO catalogue_number VALUES (?,?,?,?,?,NULL)")
      .run(id, entity, system, display, normalized);
    return id;
  }
  albumTarget(instance, album) {
    const ref = json([instance, String(album)]);
    const existing = this.db
      .prepare("SELECT id FROM metadata_target WHERE album_ref=?")
      .get(ref);
    if (existing) return existing.id;
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO metadata_target(id,album_ref) VALUES (?,?)")
      .run(id, ref);
    return id;
  }
  diagnostics() {
    return {
      schema: this.db.prepare("PRAGMA user_version").get().user_version,
      entities: this.db
        .prepare("SELECT kind,count(*) AS count FROM entity GROUP BY kind")
        .all(),
      tracks: this.db
        .prepare(
          "SELECT state,count(*) AS count FROM track_link GROUP BY state",
        )
        .all(),
      reviews: this.db
        .prepare(
          "SELECT kind,count(*) AS count FROM review_item WHERE status='open' GROUP BY kind",
        )
        .all(),
    };
  }
}

export async function openCatalogue(folder, options) {
  const { db, filename } = await openDatabase(folder, options);
  return new Catalogue(db, filename);
}
