import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { json } from "./catalogue.js";
import { tagSensitive } from "./fingerprint.js";
import { sameRetaggedFile, repairRetaggedLinks } from "./retag-repair.js";
import { classificationEvidence, albumMajority } from "./classify-evidence.js";

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
  if (sameRetaggedFile(old, previous.file_id, candidate)) return true;
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
    const repair = changedEpoch ? { resolved: new Set(), blocked: new Set() } : repairRetaggedLinks(catalogue, snapshot);
    const previous = db
      .prepare("SELECT * FROM track_link WHERE instance_id=?")
      .all(snapshot.instanceId);
    const index = new Map();
    for (const item of tracks) {
      for (const key of [
        json(["core", item.coreId, item.fileId]),
        json(["file", item.fileId, item.path]),
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
        ...(index.get(json(["file", old.file_id, evidence.path])) || []),
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
      const sameFile = [...pool].filter((item) => item.fileId === old.file_id && item.path === evidence.path && match(old, item));
      return {
        old,
        exact: changedEpoch ? null : exact,
        sameFile: !changedEpoch && sameFile.length === 1 ? sameFile[0] : null,
        items: changedEpoch
          ? []
          : exact
            ? [exact]
            : [...pool].filter((item) => match(old, item)),
      };
    });
    // Reserve unambiguous exact identities before considering audio-based
    // moves. An unchanged duplicate must not compete with a moved/deleted one.
    const claimed = new Set(), owners = new Set();
    for (const key of ["exact", "sameFile"]) {
      const demand = new Map();
      for (const c of candidates)
        if (!owners.has(c) && c[key] && !claimed.has(c[key])) demand.set(c[key], (demand.get(c[key]) || 0) + 1);
      for (const c of candidates)
        if (!owners.has(c) && c[key] && !claimed.has(c[key]) && demand.get(c[key]) === 1) {
          c.items = [c[key]]; claimed.add(c[key]); owners.add(c);
        }
    }
    const exactClaims = new Set(claimed);
    for (const c of candidates)
      if (!owners.has(c))
        c.items = c.items.filter((item) => !claimed.has(item));
    const demand = new Map();
    for (const c of candidates)
      for (const item of c.items) demand.set(item, (demand.get(item) || 0) + 1);
    const rows = [],
      now = Date.now();
    db.prepare("UPDATE track_link SET state='missing' WHERE instance_id=?").run(
      snapshot.instanceId,
    );
    for (const { old, items } of candidates) {
      if (items.length === 1 && demand.get(items[0]) === 1) {
        const item = items[0];
        claimed.add(item);
        if (repair.resolved.has(old.id)) db.prepare("UPDATE review_item SET status='resolved' WHERE kind='track_link' AND target_id=? AND status='open'").run(old.id);
        // An unchanged file needs no new evidence row or audit event; repeated
        // scans otherwise grow the database by one of each per track.
        // The ctime a scan keeps only says whether the file was written
        // since; a new ctime alone is refreshed in place, not new evidence.
        if (
          old.state === "active" &&
          old.core_id === item.coreId &&
          old.file_id === item.fileId &&
          withoutCtime(old.evidence) === withoutCtime(json(item))
        ) {
          db.prepare("UPDATE track_link SET state='active',evidence=? WHERE id=?").run(json(item), old.id);
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
            !exactClaims.has(t) &&
            (t.coreId === old.core_id || t.path === JSON.parse(old.evidence).path),
        );
        if (repair.blocked.has(old.id) && !items.length && !reused.length) {
          db.prepare("UPDATE track_link SET state='review' WHERE id=?").run(old.id);
          continue;
        }
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

// What a scan keeps only to tell whether a file was written since (its
// ctime, and an inode number some filesystems change at will) is no new
// evidence when it alone changes.
function withoutCtime(evidence) {
  const { ctimeMs, ino, ...rest } = JSON.parse(evidence);
  return JSON.stringify(rest);
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
    // Track-level decision from the track's own evidence; see
    // classify-evidence.js. Pins (above) and an album pin passed down as
    // `inherited` take precedence.
    const { score, decision, reason } = classificationEvidence(hints);
    const state = manual || inherited || decision;
    // A composer credit is all most tagged pop has; such a track stays
    // unsure (lieder and early music are often tagged no better) but asks no
    // one. An admin sends its album to Classical, or the album's majority does.
    const ask = state === "unsure" && (manual || inherited || reason !== "composer credit only");
    catalogue.db
      .prepare(
        `INSERT INTO classification VALUES (?,?,?,?,?,1,?) ON CONFLICT(target_id)
      DO UPDATE SET state=excluded.state,pinned=excluded.pinned,score=excluded.score,evidence=excluded.evidence,updated_at=excluded.updated_at`,
      )
      .run(target, state, manual ? 1 : 0, score, json(hints), Date.now());
    if (ask)
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

// After each track of an album is classified: when the album's majority is
// classical (`albumMajority`), its other tracks are too, unless pinned. They
// keep the track's own hints, marked with where the decision came from, and
// their classification reviews close. `tracks`: [{ id, hints, state }], the
// album's tracks with the states just given; returns their states after.
export function liftAlbumMajority(catalogue, tracks) {
  if (!albumMajority(tracks)) return tracks.map((track) => track.state);
  return tracks.map((track) =>
    track.state === "classical"
      ? track.state
      : classify(catalogue, track.id, { ...track.hints, inheritedFrom: "album majority" }, { inherited: "classical" }),
  );
}
