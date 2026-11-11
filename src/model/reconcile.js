import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { json } from "./catalogue.js";
import { tagSensitive } from "./fingerprint.js";

const sameAudio = (a, b) =>
  a.size != null &&
  a.size === b.size &&
  a.durationMs != null &&
  a.durationMs === b.durationMs;
const sameDuration = (a, b) =>
  a.durationMs != null && a.durationMs === b.durationMs;
function match(previous, candidate) {
  const old = JSON.parse(previous.evidence);
  // An audio fingerprint mismatch means different audio. A whole-file hash
  // mismatch only means the file changed, which includes a tag edit, so it is
  // not decisive on its own.
  const decisive =
    old.fingerprint &&
    candidate.fingerprint &&
    !tagSensitive(old.fingerprint) &&
    !tagSensitive(candidate.fingerprint);
  if (
    (decisive && old.fingerprint !== candidate.fingerprint) ||
    (old.durationMs != null &&
      candidate.durationMs != null &&
      old.durationMs !== candidate.durationMs)
  )
    return false;
  if (old.fingerprint && old.fingerprint === candidate.fingerprint) return true;
  if (
    old.stableFileId &&
    old.stableFileId === candidate.stableFileId &&
    sameAudio(old, candidate)
  )
    return true;
  // Paths alone, provider recording IDs and titles never establish identity.
  // The same host track/file at the same path with the same duration is the
  // same recording even when a tag edit changed its size or container hash.
  return (
    previous.core_id === candidate.coreId &&
    previous.file_id === candidate.fileId &&
    old.path === candidate.path &&
    sameDuration(old, candidate)
  );
}

export function reconcile(catalogue, snapshot) {
  if (
    snapshot?.version !== 1 ||
    snapshot.complete !== true ||
    !snapshot.instanceId ||
    !snapshot.epoch ||
    !Number.isSafeInteger(snapshot.generation) ||
    snapshot.generation < 1 ||
    !Array.isArray(snapshot.tracks)
  )
    throw new Error(
      "A complete, versioned installation/epoch snapshot is required",
    );
  const tracks = snapshot.tracks;
  const keys = new Set();
  for (const item of tracks) {
    if (
      typeof item.coreId !== "string" ||
      !item.coreId ||
      typeof item.fileId !== "string" ||
      !item.fileId ||
      typeof item.path !== "string" ||
      !item.path ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      !Number.isSafeInteger(item.durationMs) ||
      item.durationMs <= 0 ||
      (item.fingerprint != null && typeof item.fingerprint !== "string") ||
      (item.stableFileId != null && typeof item.stableFileId !== "string")
    )
      throw new Error("Invalid track evidence");
    const key = json([item.coreId, item.fileId]);
    if (keys.has(key))
      throw new Error("Duplicate snapshot track/file identity");
    keys.add(key);
  }
  return transaction(catalogue.db, () => {
    const db = catalogue.db;
    const instance = db
      .prepare("SELECT * FROM core_instance WHERE id=?")
      .get(snapshot.instanceId);
    if (instance && snapshot.generation <= instance.generation)
      throw new Error("Stale or repeated scan generation");
    const changedEpoch = instance && instance.epoch !== snapshot.epoch;
    db.prepare(
      `INSERT INTO core_instance VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,generation=excluded.generation`,
    ).run(snapshot.instanceId, snapshot.epoch, snapshot.generation);
    const previous = db
      .prepare("SELECT * FROM track_link WHERE instance_id=?")
      .all(snapshot.instanceId);
    const index = new Map();
    for (const item of tracks) {
      for (const key of [
        json(["core", item.coreId, item.fileId]),
        ...(item.fingerprint ? [json(["hash", item.fingerprint])] : []),
        ...(item.stableFileId ? [json(["stable", item.stableFileId])] : []),
      ]) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(item);
      }
    }
    const candidates = previous.map((old) => {
      const evidence = JSON.parse(old.evidence);
      const pool = new Set([
        ...(index.get(json(["core", old.core_id, old.file_id])) || []),
        ...(index.get(json(["hash", evidence.fingerprint])) || []),
        ...(index.get(json(["stable", evidence.stableFileId])) || []),
      ]);
      const exact = [...pool].find(
        (item) =>
          item.coreId === old.core_id &&
          item.fileId === old.file_id &&
          item.path === evidence.path &&
          match(old, item),
      );
      return {
        old,
        items: changedEpoch
          ? []
          : exact
            ? [exact]
            : [...pool].filter((item) => match(old, item)),
      };
    });
    const demand = new Map();
    for (const c of candidates)
      for (const item of c.items) demand.set(item, (demand.get(item) || 0) + 1);
    const claimed = new Set(),
      rows = [],
      now = Date.now();
    db.prepare("UPDATE track_link SET state='missing' WHERE instance_id=?").run(
      snapshot.instanceId,
    );
    for (const { old, items } of candidates) {
      if (items.length === 1 && demand.get(items[0]) === 1) {
        const item = items[0];
        claimed.add(item);
        // An unchanged file needs no new evidence row or audit event; repeated
        // scans otherwise grow the database by one of each per track.
        if (
          old.state === "active" &&
          old.core_id === item.coreId &&
          old.file_id === item.fileId &&
          old.evidence === json(item)
        ) {
          db.prepare("UPDATE track_link SET state='active' WHERE id=?").run(old.id);
          rows.push({ ...item, id: old.id });
          continue;
        }
        db.prepare(
          "UPDATE track_link SET core_id=?,file_id=?,state='active',evidence=?,revision=revision+1,updated_at=? WHERE id=?",
        ).run(item.coreId, item.fileId, json(item), now, old.id);
        db.prepare(
          "INSERT INTO track_evidence(track_link_id,generation,evidence,observed_at) VALUES (?,?,?,?)",
        ).run(old.id, snapshot.generation, json(item), now);
        catalogue.audit("track.reconcile", old.id, {
          previous: JSON.parse(old.evidence),
          next: item,
          generation: snapshot.generation,
        });
        rows.push({ ...item, id: old.id });
      } else {
        const reused = tracks.filter(
          (t) =>
            t.coreId === old.core_id ||
            t.path === JSON.parse(old.evidence).path,
        );
        if (changedEpoch || items.length || reused.length) {
          db.prepare(
            "UPDATE track_link SET state='review',updated_at=? WHERE id=?",
          ).run(now, old.id);
          catalogue.review("track_link", old.id, {
            epochChanged: !!changedEpoch,
            candidates: items,
            reused,
          });
        }
      }
    }
    for (const item of tracks.filter((t) => !claimed.has(t))) {
      // Keep ambiguous candidate files unassigned. They cannot acquire the old link's metadata.
      if (demand.has(item)) continue;
      const id = randomUUID();
      db.prepare(
        "INSERT INTO track_link VALUES (?,?,?,?,'active',?,1,?,?)",
      ).run(
        id,
        snapshot.instanceId,
        item.coreId,
        item.fileId,
        json(item),
        now,
        now,
      );
      db.prepare(
        "INSERT INTO metadata_target(id,track_link_id) VALUES (?,?)",
      ).run(id, id);
      db.prepare(
        "INSERT INTO track_evidence(track_link_id,generation,evidence,observed_at) VALUES (?,?,?,?)",
      ).run(id, snapshot.generation, json(item), now);
      catalogue.audit("track.create", id, { generation: snapshot.generation });
      rows.push({ ...item, id });
    }
    return rows;
  });
}

const TEMPO =
  /\b(allegr(?:o|etto)|adagi(?:o|etto)|andant(?:e|ino)|larghetto|largo|lento|grave|prestissimo|presto|vivace|moderato|scherzo|menuetto|minuet|menuet|rondo|finale|maestoso|sostenuto|cantabile)\b/i;
const CATALOGUE_NUMBER =
  /\b(op(?:us)?\.?|bwv|kv?\.?|d\.|hob\.?|rv|woo|hwv|sz\.?|twv)\s*\d/i;
const FORM =
  /\b(symphon(?:y|ie)|sinfonia|sonata|concerto|suite|partita|string quartet|piano trio|quintet|nocturne|mazurka|polonaise|etude|prelude|fugue|toccata|cantata|oratorio|requiem|mass in|missa|motet|madrigal|lieder|impromptu|ballade|rhapsody|overture)(?:s|es)?\b/i;
// Text signals from the track's own title, WORK tag and album title.
function textEvidence(hints) {
  const text = [hints.title, hints.work, hints.album]
    .filter((v) => typeof v === "string")
    .join(" \n ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  return {
    movement: TEMPO.test(text),
    catalogueNumber: CATALOGUE_NUMBER.test(text),
    form: FORM.test(text),
  };
}

// Model-only decision; this function never writes tags or changes stock search/playback.
export function classify(
  catalogue,
  target,
  hints,
  { manual = null, actor = null, inherited = null } = {},
) {
  return transaction(catalogue.db, () => {
    const prior = catalogue.db
      .prepare("SELECT * FROM classification WHERE target_id=?")
      .get(target);
    if (!manual && prior?.pinned) return prior.state;
    if (
      inherited &&
      !["classical", "not_classical", "unsure"].includes(inherited)
    )
      throw new Error("Invalid inherited classification");
    if (
      manual &&
      (!actor || !["classical", "not_classical", "unsure"].includes(manual))
    )
      throw new Error("Invalid classification override");
    const genres = (hints.genres || []).map((s) => s.toLowerCase());
    const classicalGenre = genres.some((s) =>
      /\b(classical|baroque|opera|chamber|romantic|choral)\b/.test(s),
    );
    const ordinaryGenre = genres.some((s) =>
      /\b(rock|jazz|pop|electronic|soundtrack)\b/.test(s),
    );
    const derived = textEvidence(hints);
    const score =
      (hints.work ? 4 : 0) +
      (hints.movement ? 4 : derived.movement ? 3 : 0) +
      (classicalGenre ? 4 : 0) +
      (hints.classicalComposerRelation ? 4 : 0) +
      (hints.catalogueNumber || derived.catalogueNumber ? 2 : 0) +
      (derived.form ? 2 : 0) +
      (hints.composerDistinct ? 1 : 0);
    // No classical evidence at all, not even a composer tag, is not an
    // uncertain match; leave the review queue for genuinely unsure tracks.
    const noEvidence =
      score === 0 && !(Array.isArray(hints.composer) && hints.composer.length);
    const state =
      manual ||
      inherited ||
      (score >= 4
        ? "classical"
        : (ordinaryGenre && score === 0) || noEvidence
          ? "not_classical"
          : "unsure");
    catalogue.db
      .prepare(
        `INSERT INTO classification VALUES (?,?,?,?,?,1,?) ON CONFLICT(target_id)
      DO UPDATE SET state=excluded.state,pinned=excluded.pinned,score=excluded.score,evidence=excluded.evidence,updated_at=excluded.updated_at`,
      )
      .run(target, state, manual ? 1 : 0, score, json(hints), Date.now());
    if (state === "unsure")
      catalogue.review("classification", target, { hints, score });
    else
      catalogue.db
        .prepare(
          "UPDATE review_item SET status='resolved' WHERE kind='classification' AND target_id=? AND status='open'",
        )
        .run(target);
    if (manual) catalogue.audit("classification.pin", target, { state }, actor);
    return state;
  });
}
