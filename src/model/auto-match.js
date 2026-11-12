import { createHash } from "node:crypto";
import { Metadata } from "./metadata.js";
import { transaction } from "./database.js";
import { catalogueNumber } from "../works.js";

const MULTI_MOVEMENT =
  /\b(symphon(?:y|ie)|sinfonia|sonata|sonatina|concerto|suite|partita|quartet|quintet|sextet|septet|octet|nonet|trio|serenade|divertimento|cassation|mass|missa|requiem|stabat mater|magnificat|te deum|vespers|cantata|oratorio|passion|variations?|ballet)\b/i;
const COLLECTION_LIKE = /\b(etudes?|études?|preludes?|préludes?|songs?|lieder)\b/i;
export const isCollectionLike = (value) => COLLECTION_LIKE.test(clean(value));
const MOVEMENT_PREFIX = /^(?:[IVXLCDM]+|\d+)[.)\s:-]/i;
const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalized = (value) =>
  clean(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const sameCatalogue = (a, b) => {
  const number = catalogueNumber(a).toLowerCase();
  return Boolean(number) && number === catalogueNumber(b).toLowerCase();
};
const identity = (...values) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

// The work part of a structured title: text before the first ":", ";" or
// spaced dash. "B-flat" has no spaces, so it stays in the work.
const WORK_HEAD = /^(.+?)(?:\s*[:;]|\s+[–—-])\s+(.+)$/;
export const titleHead = (title) => splitTitle(title).head;
export function splitTitle(title) {
  const match = clean(title).match(WORK_HEAD);
  return match ? { head: clean(match[1]), tail: clean(match[2]) } : { head: "", tail: clean(title) };
}

function proposedWork(work, title, allowStructuredTitles) {
  const tagged = clean(work);
  if (tagged && !isCollectionLike(tagged)) {
    const parent = clean(tagged.split(/\s*:\s*/, 1)[0]);
    // A WORK tag names a work outright when it reads like one or carries
    // a catalogue number, as song cycles do ("Winterreise, D. 911").
    if (MULTI_MOVEMENT.test(parent) || catalogueNumber(parent))
      return { title: parent, evidence: "work-tag" };
  }
  if (!allowStructuredTitles) return null;
  // Every track of a work shares the head, numbered or not ("Theme: Largo").
  const candidate = titleHead(title);
  return candidate && MULTI_MOVEMENT.test(candidate) && !isCollectionLike(candidate)
    ? { title: candidate, evidence: "structured-title" }
    : null;
}

function candidates(
  catalogue,
  albumId = null,
  allowStructuredTitles = false,
  providerMatches = new Map(),
) {
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
    const provider = providerMatches.get(row.id);
    const local = proposedWork(hints.work, hints.title, true);
    const proposal = provider
      ? {
          // The tags' own title wins when it names the same catalogue number.
          title:
            local && sameCatalogue(local.title, provider.work)
              ? local.title
              : clean(provider.work),
          evidence: "musicbrainz-parent",
          identity: provider.workId,
        }
      : proposedWork(hints.work, hints.title, allowStructuredTitles);
    const composers = [
      ...new Set(
        (hints.composer?.length ? hints.composer : provider?.composers || [])
          .map(clean)
          .filter(Boolean),
      ),
    ];
    const trackNumber = Number(hints.trackNumber);
    const discNumber = Number(hints.discNumber) || 1;
    if (
      !proposal ||
      !composers.length ||
      !Number.isSafeInteger(trackNumber) ||
      trackNumber < 1
    )
      continue;
    const key = JSON.stringify([
      row.instance_id,
      String(row.evidence.albumId),
      proposal.identity || workKey(proposal.title, composers),
      composers.map(normalized).sort(),
      proposal.evidence,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        key,
        work: proposal.title,
        titles: new Map(),
        evidence: proposal.evidence,
        providerWorkId: proposal.identity || null,
        providerAliases: provider?.aliases || [],
        composers,
        albumId: String(row.evidence.albumId),
        album: clean(hints.album),
        tracks: [],
      });
    const group = groups.get(key);
    group.titles.set(proposal.title, (group.titles.get(proposal.title) || 0) + 1);
    group.tracks.push({
      ...row,
      providerMovement: provider?.movement ? clean(provider.movement) : null,
      title: clean(hints.title),
      discNumber,
      trackNumber,
    });
  }
  return [...groups.values()].filter((group) => {
    // The title most of the work's tracks use, so one typo doesn't name it.
    group.work = [...group.titles].sort((a, b) => b[1] - a[1])[0][0];
    if (group.tracks.length < 2 || group.tracks.every((track) => track.attached))
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

// Identity keys shared across albums. Album placement never changes which
// work a performance realizes, so two albums of the same work share it.
const words = (value) =>
  normalized(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const CATALOGUE =
  /\b(op|opus|bwv|kv|k|d|hob|rv|woo|hwv|sz|twv|bb)\s*((?:[ivxlc]+\s+)?\d+[a-z]?)(?:\s+(?:no|nr|n)\s*(\d+))?\b/;
const KEY_PHRASE =
  /\bin\s+[a-h](?:\s*(?:flat|sharp|b|#))?(?:\s+(?:major|minor|dur|moll))?\b/g;
export function workKey(title, composers) {
  const text = words(title);
  const cat = text.match(CATALOGUE);
  const subject = cat
    ? `cat:${cat[1] === "opus" ? "op" : cat[1] === "kv" ? "k" : cat[1]}:${cat[2].replace(/\s+/g, "")}${cat[3] ? `:${cat[3]}` : ""}`
    : `title:${text.replace(KEY_PHRASE, " ").replace(/\s+/g, " ").trim()}`;
  return JSON.stringify([
    [...new Set(composers.map(words))].filter(Boolean).sort(),
    subject,
  ]);
}

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanValue(value) {
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const n = ROMAN[value[i]],
      next = ROMAN[value[i + 1]] || 0;
    if (!n) return null;
    total += n < next ? -n : n;
  }
  return total || null;
}
// "II. Andante con moto" -> { index: 2, text: "andante con moto" }
export function movementParts(title) {
  const text = words(title);
  const match = text.match(/^((?:[ivxlc]+)|\d+)\s+(.*)$/);
  if (!match) return { index: null, text };
  const index = /^\d+$/.test(match[1])
    ? Number(match[1])
    : romanValue(match[1]);
  return index ? { index, text: match[2] } : { index: null, text };
}
// The movement part of a structured track title or WORK tag.
export function movementTitle(track, workTitle) {
  // The track title usually spells the movement out in full; a WORK tag
  // holds MusicBrainz's shorter name, so it is the fallback.
  const fromTitle = stripWorkPrefix(clean(track.title), workTitle);
  if (fromTitle !== clean(track.title) || MOVEMENT_PREFIX.test(fromTitle)) return fromTitle;
  const work = clean(track.work);
  if (work.includes(":")) {
    const tail = clean(work.slice(work.indexOf(":") + 1));
    if (tail) return stripWorkPrefix(tail, workTitle);
  }
  return fromTitle;
}

const SEPARATOR = /[:;]\s*|\s+[–—-]\s+/g;
const NICKNAME = /^["“„«'‘][^"”»'’]+["”»'’]\s*(?:[:;]|\s[–—-])\s*(.+)$/;
// "Piano Sonata No. 29, Op. 106 - "Hammerklavier": Allegro" -> "Allegro".
// A head names the work when it matches its words or catalogue number.
export function stripWorkPrefix(title, workTitle) {
  const text = clean(title);
  const separators = [...text.matchAll(SEPARATOR)];
  const tailAt = (match) => clean(text.slice(match.index + match[0].length));
  // A numbered movement starts the movement part: "…: I. Allegro".
  for (const match of separators) {
    const tail = tailAt(match);
    if (tail && MOVEMENT_PREFIX.test(tail)) return tail;
  }
  const workWords = words(workTitle);
  const workCatalogue = catalogueNumber(workTitle).toLowerCase();
  for (const match of separators) {
    const head = text.slice(0, match.index);
    const tail = tailAt(match);
    const headWords = words(head);
    const namesWork =
      (workWords && (headWords === workWords || headWords.startsWith(`${workWords} `) || workWords.startsWith(`${headWords} `))) ||
      (workCatalogue && catalogueNumber(head).toLowerCase() === workCatalogue);
    if (!tail || !namesWork) continue;
    return clean(tail.match(NICKNAME)?.[1] ?? tail);
  }
  return text;
}

function resolvedName(catalogue, id, field) {
  const row = catalogue.db
    .prepare(
      `SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
       WHERE f.target_id=? AND f.field=?`,
    )
    .get(id, field);
  return row ? JSON.parse(row.value) : null;
}
function composerNames(catalogue, work) {
  return catalogue.db
    .prepare(
      `SELECT c.contributor_id AS id FROM credit c JOIN entity e ON e.id=c.contributor_id
       WHERE c.target_id=? AND c.role='composer' AND e.deleted_at IS NULL ORDER BY c.position`,
    )
    .all(work)
    .map((row) => resolvedName(catalogue, row.id, "name"))
    .filter((name) => typeof name === "string" && name.trim());
}

// Index existing works and composers once per pass, so manual works the admin
// created also absorb matching albums.
export function catalogueIndex(catalogue) {
  const works = new Map(),
    people = new Map();
  for (const { id } of catalogue.db
    .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL")
    .all()) {
    const title = resolvedName(catalogue, id, "title");
    const composers = composerNames(catalogue, id);
    if (typeof title !== "string" || !composers.length) continue;
    const key = workKey(title, composers);
    works.set(key, [...(works.get(key) || []), id]);
  }
  for (const { id } of catalogue.db
    .prepare(
      `SELECT id FROM entity WHERE kind='person' AND deleted_at IS NULL
       AND (json_extract(data,'$.roles') LIKE '%composer%'
         OR EXISTS(SELECT 1 FROM credit WHERE contributor_id=entity.id AND role='composer'))
       ORDER BY created_at,id`,
    )
    .all()) {
    const name = resolvedName(catalogue, id, "name");
    if (typeof name !== "string" || !words(name)) continue;
    people.set(words(name), [...(people.get(words(name)) || []), id]);
  }
  return { works, people };
}

function composerEntity(catalogue, metadata, index, name) {
  const key = words(name);
  const existing = index.people.get(key) || [];
  // Reuse a composer only when exactly one person has this name; two
  // same-named composers stay separate until an admin resolves them.
  if (existing.length === 1) return existing[0];
  const person = catalogue.createEntity("person", { roles: ["composer"] });
  metadata.derived(person, "name", name);
  if (existing.length > 1)
    catalogue.review("identity", person, { reason: "same-name-composers", name });
  index.people.set(key, [...existing, person]);
  return person;
}

export function workMovements(catalogue, work) {
  return catalogue.db
    .prepare(
      `SELECT r.target_id AS id,r.position FROM relation r JOIN entity e ON e.id=r.target_id
       WHERE r.kind='movement' AND r.source_id=? AND e.deleted_at IS NULL ORDER BY r.position`,
    )
    .all(work)
    .map((row) => ({
      ...row,
      ...movementParts(resolvedName(catalogue, row.id, "title") || ""),
    }));
}

// Map an album's tracks to an existing work's movements: by title, then by
// numbered prefix, then by order when the counts agree. Null when unsure.
export function mapToMovements(movements, tracks) {
  const used = new Set(),
    result = [];
  for (const track of tracks) {
    const parts = movementParts(track.movementTitle);
    let found = movements.filter(
      (m) => !used.has(m.id) && m.text && m.text === parts.text,
    );
    if (found.length !== 1 && parts.index)
      found = movements.filter(
        (m) => !used.has(m.id) && (m.index ?? m.position) === parts.index,
      );
    if (found.length !== 1) {
      result.push(null);
      continue;
    }
    used.add(found[0].id);
    result.push(found[0].id);
  }
  if (result.every(Boolean)) return result;
  if (movements.length === tracks.length) return movements.map((m) => m.id);
  return null;
}

const albumOrder = (a, b) =>
  a.discNumber - b.discNumber || a.trackNumber - b.trackNumber || a.id.localeCompare(b.id);

// Moves rows at or after `from` up one, through a gap, so unique positions
// never collide mid-update.
function shiftUp(catalogue, table, column, where, args, from) {
  catalogue.db
    .prepare(`UPDATE ${table} SET ${column}=${column}+1000000 WHERE ${where} AND ${column}>=?`)
    .run(...args, from);
  catalogue.db
    .prepare(`UPDATE ${table} SET ${column}=${column}-999999 WHERE ${where} AND ${column}>=1000000`)
    .run(...args);
}

// A work this album already has gains the album's other tracks of it, such
// as a theme or intermezzo an earlier pass left out. Each new movement goes
// right after the movement of the track before it on the album.
function extendRealization(catalogue, group, actor) {
  const attached = group.tracks.filter((track) => track.attached);
  const found = catalogue.db
    .prepare(
      `SELECT DISTINCT i.realization_id AS id,r.work_id,r.performance_work_id FROM realization_item i
       JOIN segment s ON s.id=i.segment_id JOIN realization r ON r.id=i.realization_id
       WHERE s.track_link_id IN (${attached.map(() => "?").join(",")})`,
    )
    .all(...attached.map((track) => track.id));
  if (found.length !== 1) return false;
  const [realization] = found;
  const metadata = new Metadata(catalogue);
  return transaction(catalogue.db, () => {
    const workTitle = resolvedName(catalogue, realization.work_id, "title") || group.work;
    const performance = catalogue.db
      .prepare("SELECT source_id FROM relation WHERE id=?")
      .get(realization.performance_work_id).source_id;
    const itemOf = catalogue.db.prepare(
      `SELECT i.movement_id,i.sequence FROM realization_item i JOIN segment s ON s.id=i.segment_id
       WHERE i.realization_id=? AND s.track_link_id=?`,
    );
    const ordered = [...group.tracks].sort(albumOrder);
    let added = 0;
    for (const [index, track] of ordered.entries()) {
      if (track.attached) continue;
      const before = ordered
        .slice(0, index)
        .reverse()
        .map((other) => itemOf.get(realization.id, other.id))
        .find(Boolean);
      const position = before?.movement_id
        ? catalogue.db
            .prepare("SELECT position FROM relation WHERE kind='movement' AND source_id=? AND target_id=?")
            .get(realization.work_id, before.movement_id).position + 1
        : 1;
      shiftUp(catalogue, "relation", "position", "kind='movement' AND source_id=?", [realization.work_id], position);
      const movement = catalogue.createEntity("movement");
      metadata.derived(
        movement,
        "title",
        movementTitle({ title: track.title, work: track.evidence.hints?.work }, workTitle) ||
          `Movement ${position}`,
      );
      catalogue.relate("movement", realization.work_id, movement, { position });
      const sequence = (before?.sequence || 0) + 1;
      shiftUp(catalogue, "realization_item", "sequence", "realization_id=?", [realization.id], sequence);
      const recording = catalogue.createEntity("recording", { durationMs: track.evidence.durationMs });
      metadata.derived(recording, "title", track.title);
      catalogue.relate("recording_performance", recording, performance);
      const content = catalogue.recordingContent(recording, realization.performance_work_id, { movement });
      const segment = catalogue.segment(track.id, { kind: "whole" });
      catalogue.segmentContent(segment, content);
      catalogue.realizationItem(realization.id, segment, { movement, sequence });
      track.attached = 1;
      added++;
    }
    catalogue.audit(
      "work.auto_match_extend",
      realization.work_id,
      { albumId: group.albumId, added, tracks: ordered.map((track) => track.id) },
      actor,
    );
    return added > 0;
  });
}

function createGroup(catalogue, group, actor, index) {
  if (group.tracks.some((track) => track.attached))
    return extendRealization(catalogue, group, actor);
  const metadata = new Metadata(catalogue);
  const recordId = identity("album-work", group.key);
  if (existingIdentity(catalogue, "album-work", recordId)) return false;
  return transaction(catalogue.db, () => {
    const ordered = group.tracks
      .sort(
        (a, b) =>
          a.discNumber - b.discNumber ||
          a.trackNumber - b.trackNumber ||
          a.id.localeCompare(b.id),
      )
      .map((track) => ({
        ...track,
        movementTitle: track.providerMovement
          ? stripWorkPrefix(track.providerMovement, group.work)
          : movementTitle(
              { title: track.title, work: track.evidence.hints?.work },
              group.work,
            ),
      }));
    const key = group.providerWorkId
      ? JSON.stringify(["musicbrainz", group.providerWorkId])
      : workKey(group.work, group.composers);
    const providerWork =
      group.providerWorkId &&
      catalogue.db
        .prepare(
          `SELECT entity_id FROM external_identity WHERE provider='musicbrainz'
           AND record_kind='work' AND record_id=? AND state='active'`,
        )
        .get(group.providerWorkId)?.entity_id;
    const known = providerWork
      ? [providerWork]
      : index.works.get(workKey(group.work, group.composers)) || [];
    let work = known.length === 1 ? known[0] : null;
    let movements = null;
    if (work) {
      const existing = workMovements(catalogue, work);
      movements = existing.length
        ? mapToMovements(existing, ordered)
        : null;
      if (!movements && existing.length) {
        // Same work, but the album's movements can't be mapped safely.
        catalogue.review("auto_match", ordered[0].id, {
          reason: "movement-mismatch",
          work,
          albumId: group.albumId,
          tracks: ordered.map((t) => t.id),
        });
        return false;
      }
    } else {
      work = catalogue.createEntity("work");
      metadata.derived(work, "title", group.work);
      group.composers.forEach((name, i) =>
        catalogue.credit(
          work,
          composerEntity(catalogue, metadata, index, name),
          "composer",
          { position: i + 1 },
        ),
      );
      if (group.providerAliases?.length)
        metadata.derived(work, "aliases", group.providerAliases);
      if (group.providerWorkId)
        catalogue.externalIdentity(
          work,
          "musicbrainz",
          "work",
          group.providerWorkId,
          { evidence: { source: "parent-work" } },
        );
      index.works.set(workKey(group.work, group.composers), [work]);
      if (known.length > 1)
        catalogue.review("identity", work, { reason: "ambiguous-work", key });
    }
    if (!movements)
      movements = ordered.map((track, i) => {
        const movement = catalogue.createEntity("movement");
        metadata.derived(movement, "title", track.movementTitle || `Movement ${i + 1}`);
        metadata.derived(movement, "movementNumber", String(i + 1));
        catalogue.relate("movement", work, movement, { position: i + 1 });
        return movement;
      });
    catalogue.externalIdentity(work, "embedded-tags", "album-work", recordId, {
      evidence: {
        albumId: group.albumId,
        work: group.work,
        composers: group.composers,
        providerWorkId: group.providerWorkId,
      },
    });
    const performance = catalogue.createEntity("performance");
    const performanceWork = catalogue.relate(
      "performance_work",
      performance,
      work,
    );
    const realization = catalogue.realization(
      work,
      performanceWork,
      group.album || null,
    );
    ordered.forEach((track, i) => {
      const movement = movements[i];
      const recording = catalogue.createEntity("recording", {
        durationMs: track.evidence.durationMs,
      });
      metadata.derived(recording, "title", track.title || track.movementTitle);
      catalogue.relate("recording_performance", recording, performance);
      const content = catalogue.recordingContent(recording, performanceWork, {
        movement,
      });
      const segment = catalogue.segment(track.id, { kind: "whole" });
      catalogue.segmentContent(segment, content);
      catalogue.realizationItem(realization, segment, {
        movement,
        sequence: i + 1,
      });
    });
    catalogue.audit(
      "work.auto_match",
      work,
      {
        rule: "classical-grouping-v2",
        evidence: group.evidence,
        albumId: group.albumId,
        reused: known.length === 1,
        tracks: ordered.map((track) => track.id),
      },
      actor,
    );
    return true;
  });
}

const hasManualEdits = (catalogue, ids) =>
  ids.some((id) =>
    catalogue.db
      .prepare(
        "SELECT 1 FROM assertion WHERE target_id=? AND source='manual' LIMIT 1",
      )
      .get(id),
  );

// Fold one person or ensemble into another: credits move, duplicates drop.
export function mergeContributor(catalogue, keep, drop, actor) {
  for (const credit of catalogue.db
    .prepare("SELECT * FROM credit WHERE contributor_id=?")
    .all(drop)) {
    const duplicate = catalogue.db
      .prepare(
        "SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role=? AND instrument IS ?",
      )
      .get(credit.target_id, keep, credit.role, credit.instrument);
    if (duplicate)
      catalogue.db.prepare("DELETE FROM credit WHERE id=?").run(credit.id);
    else
      catalogue.db
        .prepare("UPDATE credit SET contributor_id=? WHERE id=?")
        .run(keep, credit.id);
  }
  catalogue.db
    .prepare("UPDATE external_identity SET entity_id=? WHERE entity_id=? AND provider='embedded-tags'")
    .run(keep, drop);
  catalogue.db
    .prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?")
    .run(Date.now(), Date.now(), drop);
  catalogue.audit("person.merge", drop, { into: keep }, actor);
}

// Merge composers that earlier auto-match passes created once per album.
function mergeDuplicateComposers(catalogue, index, actor) {
  let merged = 0;
  for (const [name, ids] of index.people) {
    if (ids.length < 2) continue;
    const auto = ids.filter(
      (id) =>
        !hasManualEdits(catalogue, [id]) &&
        !catalogue.db
          .prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND provider!='embedded-tags'")
          .get(id),
    );
    // Keep the oldest (or the one with manual/provider identity) and fold auto copies in.
    const keep = ids.find((id) => !auto.includes(id)) || auto[0];
    const drop = auto.filter((id) => id !== keep);
    if (ids.filter((id) => !auto.includes(id)).length > 1) continue;
    for (const id of drop) {
      for (const credit of catalogue.db
        .prepare("SELECT * FROM credit WHERE contributor_id=?")
        .all(id)) {
        const duplicate = catalogue.db
          .prepare(
            "SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role=? AND instrument IS ?",
          )
          .get(credit.target_id, keep, credit.role, credit.instrument);
        if (duplicate)
          catalogue.db.prepare("DELETE FROM credit WHERE id=?").run(credit.id);
        else
          catalogue.db
            .prepare("UPDATE credit SET contributor_id=? WHERE id=?")
            .run(keep, credit.id);
      }
      catalogue.db
        .prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?")
        .run(Date.now(), Date.now(), id);
      catalogue.audit("person.merge", id, { into: keep }, actor);
      merged++;
    }
    index.people.set(name, [keep]);
  }
  return merged;
}

// Fold a duplicate auto-created work into another work with the same identity.
export function mergeWork(catalogue, keep, drop, actor) {
  const keepMovements = workMovements(catalogue, keep),
    dropMovements = workMovements(catalogue, drop);
  let map = new Map();
  if (dropMovements.length) {
    const mapped = mapToMovements(
      keepMovements,
      dropMovements.map((m) => ({ movementTitle: resolvedName(catalogue, m.id, "title") || "" })),
    );
    if (!mapped) return false;
    map = new Map(dropMovements.map((m, i) => [m.id, mapped[i]]));
  }
  const db = catalogue.db;
  db.prepare("UPDATE relation SET target_id=? WHERE kind='performance_work' AND target_id=?").run(keep, drop);
  db.prepare("UPDATE OR IGNORE relation SET target_id=? WHERE kind='collection_member' AND target_id=?").run(keep, drop);
  db.prepare("DELETE FROM relation WHERE kind='collection_member' AND target_id=?").run(drop);
  db.prepare("UPDATE realization SET work_id=? WHERE work_id=?").run(keep, drop);
  for (const [from, to] of map) {
    db.prepare("UPDATE realization_item SET movement_id=? WHERE movement_id=?").run(to, from);
    db.prepare("UPDATE recording_content SET movement_id=? WHERE movement_id=?").run(to, from);
    db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), from);
  }
  db.prepare("DELETE FROM relation WHERE kind='movement' AND source_id=?").run(drop);
  for (const credit of db.prepare("SELECT * FROM credit WHERE target_id=?").all(drop)) {
    if (
      db
        .prepare("SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role=? AND instrument IS ?")
        .get(keep, credit.contributor_id, credit.role, credit.instrument)
    )
      db.prepare("DELETE FROM credit WHERE id=?").run(credit.id);
    else db.prepare("UPDATE credit SET target_id=? WHERE id=?").run(keep, credit.id);
  }
  db.prepare("UPDATE OR IGNORE user_work_state SET work_id=? WHERE work_id=?").run(keep, drop);
  db.prepare("DELETE FROM user_work_state WHERE work_id=?").run(drop);
  db.prepare("UPDATE OR IGNORE admin_work_pick SET work_id=? WHERE work_id=?").run(keep, drop);
  db.prepare("DELETE FROM admin_work_pick WHERE work_id=?").run(drop);
  db.prepare("UPDATE external_identity SET entity_id=? WHERE entity_id=? AND provider='embedded-tags'").run(keep, drop);
  db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), drop);
  catalogue.audit("work.merge", drop, { into: keep }, actor);
  return true;
}

// Repairs catalogues built by the per-album grouping rule: same-named composers
// and same works that were created once per album. Only auto-created entities
// without manual edits are merged; anything else is left for review.
export function mergeDuplicateAutoWorks(catalogue, { actor = null } = {}) {
  return transaction(catalogue.db, () => {
    let index = catalogueIndex(catalogue);
    const people = mergeDuplicateComposers(catalogue, index, actor);
    if (people) index = catalogueIndex(catalogue);
    let works = 0;
    for (const ids of index.works.values()) {
      if (ids.length < 2) continue;
      const auto = (id) =>
        catalogue.db
          .prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND record_kind='album-work'")
          .get(id) &&
        !hasManualEdits(catalogue, [id, ...workMovements(catalogue, id).map((m) => m.id)]);
      const keep = ids.find((id) => !auto(id)) || ids[0];
      if (ids.filter((id) => !auto(id)).length > 1) continue;
      for (const id of ids.filter((id) => id !== keep))
        if (mergeWork(catalogue, keep, id, actor)) works++;
        else catalogue.review("identity", id, { reason: "duplicate-work", keep });
    }
    return { people, works };
  });
}

// This only changes the plugin catalogue. It never writes the indexed media.
const INSTRUMENT =
  /\b(piano|violin|viola|cello|violoncello|double bass|flute|oboe|clarinet|bassoon|horn|trumpet|trombone|organ|harpsichord|guitar|harp|string|wind|piano and violin|violin and piano|cello and piano)\s+(?=(?:sonata|sonatina|concerto|quartet|quintet|trio|sextet|octet|suite|partita)\b)/i;
const KEY = /\bin\s+([a-h])(?:[\s-]?(flat|sharp|♭|♯))?\s+(major|minor)\b/i;
const CATALOGUE_TEXT =
  /\b(?:op(?:us|\.)?\s*\d+[a-z]?(?:\s*,?\s*no\.?\s*\d+)?|(?:BWV|HWV|RV|WoO|TWV|K(?:V|\.)?|D\.?|Hob\.?\s*[IVXL]+[a-z]?:?)\s*\d+[a-z]?)/gi;
const tidyCatalogue = (value) =>
  clean(value)
    .replace(/^op(?:us|\.)?\s*/i, "Op. ")
    .replace(/\s*,?\s*no\.?\s*(\d)/i, " No. $1");
// Fields a work's title states outright: "Piano Sonata no. 1 in F minor, op. 2 no. 1".
export function workFieldsFromTitle(title) {
  const text = clean(title);
  const fields = {};
  const key = text.match(KEY);
  if (key)
    fields.key = `${key[1].toUpperCase()}${key[2] ? `-${key[2].toLowerCase().replace("♭", "flat").replace("♯", "sharp")}` : ""} ${key[3].toLowerCase()}`;
  const catalogue = [...new Set((text.match(CATALOGUE_TEXT) || []).map(tidyCatalogue))];
  if (catalogue.length) fields.catalogue = catalogue;
  const form = text.match(MULTI_MOVEMENT);
  if (form) fields.form = form[1].toLowerCase();
  const nickname = text.match(/["“„«]([^"”»]+)["”»]/);
  if (nickname) fields.nickname = clean(nickname[1]);
  const instrument = text.match(INSTRUMENT);
  if (instrument)
    fields.instrumentation = instrument[1]
      .toLowerCase()
      .split(/\s+and\s+/)
      .map((name) => name[0].toUpperCase() + name.slice(1));
  return fields;
}

// Fill a work's empty fields from its title. Fields with any value are kept.
export function deriveWorkFields(catalogue, work, metadata = new Metadata(catalogue)) {
  const title = resolvedName(catalogue, work, "title");
  if (typeof title !== "string") return 0;
  const known = catalogue.db.prepare("SELECT 1 FROM field_resolution WHERE target_id=? AND field=?");
  let filled = 0;
  for (const [field, value] of Object.entries(workFieldsFromTitle(title)))
    if (!known.get(work, field)) {
      metadata.derived(work, field, value);
      filled++;
    }
  return filled;
}

// Movement titles derived before stripWorkPrefix understood a title can
// still carry the work's name. Manual and provider titles are left alone.
export function repairMovementTitles(catalogue) {
  const metadata = new Metadata(catalogue);
  const rows = catalogue.db
    .prepare(
      `SELECT r.source_id AS work,r.target_id AS movement,a.value,a.source
       FROM relation r JOIN field_resolution f ON f.target_id=r.target_id AND f.field='title'
       JOIN assertion a ON a.id=f.assertion_id
       WHERE r.kind='movement' AND a.source='derived'`,
    )
    .all();
  const titles = new Map();
  let repaired = 0;
  for (const row of rows) {
    if (!titles.has(row.work)) titles.set(row.work, resolvedName(catalogue, row.work, "title"));
    const workTitle = titles.get(row.work);
    const current = JSON.parse(row.value);
    if (typeof workTitle !== "string" || typeof current !== "string") continue;
    const stripped = stripWorkPrefix(current, workTitle);
    if (stripped && stripped !== current) {
      metadata.derived(row.movement, "title", stripped);
      repaired++;
    }
  }
  return repaired;
}

// Work titles taken from MusicBrainz before the tags' own title won: when
// every track of a work agrees on a title naming the same catalogue number,
// use it. Manual and provider titles are left alone.
export function repairWorkTitles(catalogue) {
  const metadata = new Metadata(catalogue);
  const works = catalogue.db
    .prepare(
      `SELECT DISTINCT r.work_id AS id,a.value FROM realization r
       JOIN field_resolution f ON f.target_id=r.work_id AND f.field='title'
       JOIN assertion a ON a.id=f.assertion_id WHERE a.source='derived'`,
    )
    .all();
  const tracks = catalogue.db.prepare(
    `SELECT t.evidence FROM realization r JOIN realization_item i ON i.realization_id=r.id
     JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
     WHERE r.work_id=?`,
  );
  let repaired = 0;
  for (const work of works) {
    const current = JSON.parse(work.value);
    const heads = new Set(
      tracks.all(work.id).map((row) => {
        const hints = JSON.parse(row.evidence).hints || {};
        return proposedWork(hints.work, hints.title, true)?.title || "";
      }),
    );
    const [head] = heads;
    if (heads.size === 1 && head && head !== current && sameCatalogue(head, current)) {
      metadata.derived(work.id, "title", head);
      repaired++;
    }
  }
  return repaired;
}

export function autoMatchTaggedWorks(
  catalogue,
  {
    albumId = null,
    actor = null,
    allowStructuredTitles = false,
    providerMatches = new Map(),
  } = {},
) {
  const groups = candidates(
    catalogue,
    albumId,
    allowStructuredTitles,
    providerMatches,
  );
  mergeDuplicateAutoWorks(catalogue, { actor });
  repairWorkTitles(catalogue);
  repairMovementTitles(catalogue);
  const metadata = new Metadata(catalogue);
  for (const { id } of catalogue.db
    .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL")
    .all())
    deriveWorkFields(catalogue, id, metadata);
  const index = catalogueIndex(catalogue);
  let created = 0;
  for (const group of groups)
    if (createGroup(catalogue, group, actor, index)) created++;
  return { created, candidates: groups.length };
}
