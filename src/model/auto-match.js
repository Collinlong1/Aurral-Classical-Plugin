import { createHash } from "node:crypto";
import { Metadata } from "./metadata.js";
import { transaction } from "./database.js";

const MULTI_MOVEMENT =
  /\b(symphony|sonata|concerto|suite|partita|quartet|quintet|sextet|septet|octet|trio|serenade|divertimento)\b/i;
const COLLECTION_LIKE = /\b(etudes?|études?|preludes?|préludes?|songs?|lieder)\b/i;
const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalized = (value) =>
  clean(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const identity = (...values) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

function proposedWork(work) {
  const tagged = clean(work);
  if (!tagged || COLLECTION_LIKE.test(tagged)) return null;
  const parent = clean(tagged.split(/\s*:\s*/, 1)[0]);
  const candidate = MULTI_MOVEMENT.test(parent) ? parent : tagged;
  return MULTI_MOVEMENT.test(candidate) ? candidate : null;
}

function candidates(catalogue, albumId = null) {
  const rows = catalogue.db
    .prepare(
      `SELECT t.id,t.instance_id,t.evidence,
        EXISTS(SELECT 1 FROM segment s WHERE s.track_link_id=t.id) AS attached
       FROM track_link t
       JOIN classification c ON c.target_id=t.id AND c.state='classical'
       WHERE t.state='active'`,
    )
    .all()
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }))
    .filter(
      (row) =>
        row.evidence.albumId != null &&
        (albumId == null || String(row.evidence.albumId) === String(albumId)),
    );
  const groups = new Map();
  for (const row of rows) {
    const hints = row.evidence.hints || {};
    const work = proposedWork(hints.work);
    const composers = [
      ...new Set((hints.composer || []).map(clean).filter(Boolean)),
    ];
    const trackNumber = Number(hints.trackNumber);
    const discNumber = Number(hints.discNumber) || 1;
    if (
      !work ||
      !composers.length ||
      !Number.isSafeInteger(trackNumber) ||
      trackNumber < 1
    )
      continue;
    const key = JSON.stringify([
      row.instance_id,
      String(row.evidence.albumId),
      normalized(work),
      composers.map(normalized).sort(),
    ]);
    if (!groups.has(key))
      groups.set(key, {
        key,
        work,
        composers,
        albumId: String(row.evidence.albumId),
        album: clean(hints.album),
        tracks: [],
      });
    groups.get(key).tracks.push({
      ...row,
      title: clean(hints.title),
      discNumber,
      trackNumber,
    });
  }
  return [...groups.values()].filter((group) => {
    if (group.tracks.length < 2 || group.tracks.some((track) => track.attached))
      return false;
    const positions = group.tracks.map(
      (track) => `${track.discNumber}:${track.trackNumber}`,
    );
    return (
      new Set(positions).size === positions.length &&
      new Set(group.tracks.map((track) => normalized(track.title))).size ===
        group.tracks.length
    );
  });
}

function existingIdentity(catalogue, recordKind, recordId) {
  return catalogue.db
    .prepare(
      `SELECT entity_id FROM external_identity
       WHERE provider='embedded-tags' AND record_kind=? AND record_id=? AND state='active'`,
    )
    .get(recordKind, recordId)?.entity_id;
}

function composerEntity(catalogue, metadata, name) {
  // A matching name is evidence, not a safe global person identity. Keep this
  // import local to the proposed work until a provider or admin resolves it.
  const person = catalogue.createEntity("person");
  metadata.derived(person, "name", name);
  return person;
}

function createGroup(catalogue, group, actor) {
  const metadata = new Metadata(catalogue);
  const recordId = identity("album-work", group.key);
  if (existingIdentity(catalogue, "album-work", recordId)) return false;
  return transaction(catalogue.db, () => {
    const work = catalogue.createEntity("work");
    metadata.derived(work, "title", group.work);
    catalogue.externalIdentity(work, "embedded-tags", "album-work", recordId, {
      evidence: {
        albumId: group.albumId,
        work: group.work,
        composers: group.composers,
      },
    });
    group.composers.forEach((name, index) =>
      catalogue.credit(
        work,
        composerEntity(catalogue, metadata, name),
        "composer",
        { position: index + 1 },
      ),
    );
    const performance = catalogue.createEntity("performance");
    const performanceWork = catalogue.relate(
      "performance_work",
      performance,
      work,
    );
    const ordered = group.tracks.sort(
      (a, b) =>
        a.discNumber - b.discNumber ||
        a.trackNumber - b.trackNumber ||
        a.id.localeCompare(b.id),
    );
    const realization = catalogue.realization(
      work,
      performanceWork,
      group.album || null,
    );
    ordered.forEach((track, index) => {
      const movement = catalogue.createEntity("movement");
      metadata.derived(movement, "title", track.title || `Movement ${index + 1}`);
      metadata.derived(movement, "movementNumber", String(index + 1));
      catalogue.relate("movement", work, movement, { position: index + 1 });
      const recording = catalogue.createEntity("recording", {
        durationMs: track.evidence.durationMs,
      });
      catalogue.relate("recording_performance", recording, performance);
      const content = catalogue.recordingContent(recording, performanceWork, {
        movement,
      });
      const segment = catalogue.segment(track.id, { kind: "whole" });
      catalogue.segmentContent(segment, content);
      catalogue.realizationItem(realization, segment, {
        movement,
        sequence: index + 1,
      });
    });
    catalogue.audit(
      "work.auto_match",
      work,
      {
        rule: "embedded-work-composer-album-v1",
        albumId: group.albumId,
        tracks: ordered.map((track) => track.id),
      },
      actor,
    );
    return true;
  });
}

// This only changes the plugin catalogue. It never writes the indexed media.
export function autoMatchTaggedWorks(
  catalogue,
  { albumId = null, actor = null } = {},
) {
  const groups = candidates(catalogue, albumId);
  let created = 0;
  for (const group of groups) if (createGroup(catalogue, group, actor)) created++;
  return { created, candidates: groups.length };
}
