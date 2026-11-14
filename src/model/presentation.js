import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { transaction } from "./database.js";
import { NUMBERED_SET, isCollectionLike, numberedPiece, movementTitle, splitTitle, withoutComposer } from "./auto-match.js";
import { catalogueNumber } from "../works.js";
import { composersOf } from "./credits.js";

const text = (value, fallback) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
// Pages only read. Every write path stores its resolution in
// field_resolution, so reading it avoids a write transaction per name.
class DisplayValues {
  constructor(c) {
    this.statement = c.db.prepare(
      `SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
       WHERE f.target_id=? AND f.field=?`,
    );
  }
  resolve(id, field) {
    const row = this.statement.get(id, field);
    return { value: row ? JSON.parse(row.value) : undefined };
  }
}
const entityValue = (metadata, id, field, fallback) =>
  text(metadata.resolve(id, field).value, fallback);
const evidenceOf = (row) => JSON.parse(row.evidence);
const trackTitle = (evidence) =>
  text(evidence.hints?.title, path.basename(evidence.path || "Track"));

function actor(input) {
  const user = input?.user;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0)
    throw new Error("A real user account is required");
  return user;
}

function realizationRows(c, realizationId = null, workId = null, albumId = null) {
  // Only the filters in use go into the query, so SQLite can start from the
  // album or work index instead of every realization.
  const filters = [
    [realizationId, "r.id=?"],
    [workId, "r.work_id=?"],
    [albumId, "CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?"],
  ].filter(([value]) => value !== null);
  return c.db
    .prepare(
      `SELECT r.id AS realization_id,r.work_id,r.performance_work_id,r.label AS realization_label,
        i.id AS item_id,i.movement_id,i.sequence,i.occurrence,i.segment_id,s.start_ms,s.end_ms,s.kind AS segment_kind,
        t.id AS track_link_id,t.core_id,t.file_id,t.evidence
      FROM realization r
      JOIN realization_item i ON i.realization_id=r.id
      JOIN segment s ON s.id=i.segment_id
      JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
      JOIN classification c ON c.target_id=t.id AND c.state='classical'
      ${filters.length ? `WHERE ${filters.map(([, sql]) => sql).join(" AND ")}` : ""}
      ORDER BY r.id,i.sequence,i.occurrence,i.id`,
    )
    .all(...filters.map(([value]) => value))
    .reduce((rows, row) => {
      // A track holding several movements in turn ("Theme / II. / III.") is
      // one row and is played once.
      const last = rows.at(-1);
      if (last && last.realization_id === row.realization_id && last.segment_id === row.segment_id) last.movement_ids.push(row.movement_id);
      else rows.push({ ...row, movement_ids: [row.movement_id] });
      return rows;
    }, []);
}

const words = (value) =>
  String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "Ludwig van Beethoven — Igor Levit" -> "Igor Levit": the composer already
// heads the work, so rows name only who plays.
function performerOf(hints) {
  const artist = text(hints?.artist, text(hints?.albumArtist, ""));
  const composers = new Set(composersOf(hints || {}).map(words));
  const performers = artist
    .split(/\s+[—–]\s+|\s*;\s*/)
    .filter((name) => name && !composers.has(words(name)));
  return performers.length ? performers.join(", ") : artist;
}

// `workTitle` is given when this track is one of several parts of one
// movement ("Ia. Maestoso", "Ib. Allegro…"): the row names its own part.
function queueItem(metadata, row, workTitle = null) {
  const evidence = evidenceOf(row);
  return {
    id: row.item_id,
    trackId: String(row.core_id),
    fileId: String(row.file_id),
    albumId: String(evidence.albumId ?? ""),
    title: workTitle
      ? movementTitle({ title: withoutComposer(trackTitle(evidence), composersOf(evidence.hints || {})), work: evidence.hints?.work }, workTitle)
      : row.movement_ids?.length > 1
        ? row.movement_ids.map((id) => entityValue(metadata, id, "title", "")).filter(Boolean).join(" / ")
        : row.movement_id
          ? entityValue(metadata, row.movement_id, "title", trackTitle(evidence))
          : trackTitle(evidence),
    artist: text(evidence.hints?.artist, text(evidence.hints?.albumArtist, "")),
    performer: performerOf(evidence.hints),
    album: text(evidence.hints?.album, ""),
    durationMs: Number(evidence.durationMs) || null,
    startMs: row.start_ms,
    endMs: row.end_ms,
  };
}

function workMovements(c, metadata, workId) {
  return c.db
    .prepare(
      `SELECT target_id,position FROM relation
       WHERE kind='movement' AND source_id=? ORDER BY position,occurrence,id`,
    )
    .all(workId)
    .map((row) => ({
      id: row.target_id,
      title: entityValue(metadata, row.target_id, "title", "Untitled movement"),
      position: row.position,
    }));
}

function credits(c, metadata, targetId) {
  return c.db
    .prepare(
      `SELECT role,instrument,contributor_id FROM credit
       WHERE target_id=? ORDER BY position,id`,
    )
    .all(targetId)
    .map((row) => ({
      role: row.role,
      instrument: row.instrument,
      id: row.contributor_id,
      name: entityValue(
        metadata,
        row.contributor_id,
        "name",
        "Unknown contributor",
      ),
    }));
}

const albumPosition = (row) => {
  const hints = evidenceOf(row).hints || {};
  return (Number(hints.discNumber) || 1) * 10000 + (Number(hints.trackNumber) || 9999);
};

const ACT = /,\s*(?:act|akt|atto|acte|part|pt\.?|teil|scene|szene)\s*[ivxlc\d]+\b.*$/i;
// "Tristan und Isolde" and "Tristan und Isolde, WWV 90": the same name before
// the comma, and only one of them carries a catalogue number.
const nameBeforeComma = (title) => words(String(title).split(",")[0]);
function sameNamedWork(a, b) {
  if (a === b) return true;
  const catalogueA = catalogueNumber(a).toLowerCase();
  const catalogueB = catalogueNumber(b).toLowerCase();
  if (catalogueA && catalogueB) return catalogueA === catalogueB;
  // The shorter must be the longer cut at a comma: "Études, Book 1" and
  // "Études, Book 3" are different books.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const name = nameBeforeComma(long);
  return name.length >= 4 && words(short) === name && long.includes(",");
}

// The same people in any order credit the same piece. One catalogue number
// is one work even when its movements credit different completers, as long
// as a composer runs through all of them.
function sameCredits(last, heading, names) {
  const these = new Set(names.map(words));
  if (last.names.length === these.size && last.names.every((name) => these.has(name))) return true;
  const shared = last.names.filter((name) => these.has(name));
  const same = shared.length > 0 && Boolean(catalogueNumber(last.title)) && catalogueNumber(last.title) === catalogueNumber(heading);
  // Later movements must share the composer every earlier one named, and
  // the heading names only those.
  if (same) {
    last.composer = last.credited.filter((name) => shared.includes(words(name))).join(", ");
    last.names = shared;
  }
  return same;
}

// Classical tracks outside every work become pieces, as Apple Music
// Classical shows a recital: neighbouring tracks of one set share a block
// headed by the set ("Études, Book 1"), and a lone piece heads itself.
function pieceGroups(c, album, following) {
  const rows = c.db
    .prepare(
      `SELECT t.id AS track_link_id,t.core_id,t.file_id,t.evidence FROM track_link t
       JOIN classification c ON c.target_id=t.id AND c.state='classical'
       WHERE t.state='active' AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?
       AND NOT EXISTS(SELECT 1 FROM segment s WHERE s.track_link_id=t.id)`,
    )
    .all(album)
    .sort((a, b) => albumPosition(a) - albumPosition(b));
  const pieces = [];
  for (const row of rows) {
    const evidence = evidenceOf(row);
    // A WORK tag names the work outright; otherwise the title's head does.
    const workTag = text(evidence.hints?.work, "");
    const work = workTag.split(/\s*:\s*/)[0];
    const title = withoutComposer(trackTitle(evidence), composersOf(evidence.hints || {}));
    const split = splitTitle(title);
    const fullHead = work || split.head;
    const ownTail = work ? movementTitle({ title }, work) : split.tail;
    const taggedTail = work ? movementTitle({ title, work: workTag }, work) : ownTail;
    const fullTail = words(ownTail).endsWith(` ${words(taggedTail)}`) ? taggedTail : ownTail;
    // "24 Préludes, op. 28 no. 6 in B minor" alone is one piece of a set:
    // it heads as the set and reads as "No. 6 in B minor".
    const numbered = fullHead ? null : numberedPiece(fullTail);
    const tail = numbered?.part ?? fullTail;
    const names = composersOf(evidence.hints || {});
    // An opera is one work across its acts: "La traviata, Act II" heads as
    // "La traviata", the way Apple Music Classical shows it.
    const head = numbered?.set ?? fullHead.replace(ACT, "");
    const heading = head || tail;
    const composer = names.join(", ");
    const last = pieces.at(-1);
    const item = {
      id: `piece:${row.track_link_id}`,
      trackId: String(row.core_id),
      fileId: String(row.file_id),
      albumId: String(evidence.albumId ?? ""),
      title: tail,
      artist: text(evidence.hints?.artist, text(evidence.hints?.albumArtist, "")),
      performer: performerOf(evidence.hints),
      album: text(evidence.hints?.album, ""),
      durationMs: Number(evidence.durationMs) || null,
      startMs: 0,
      endMs: null,
      position: albumPosition(row),
    };
    // Neighbours of one work share a block, even spelled differently
    // ("Theme by Paganini, Op. 43" and "Theme of Paganini, Op. 43").
    const sameWork = last && sameNamedWork(last.title, heading);
    if (head && sameWork && sameCredits(last, heading, names) && following.get(last.next) === item.position)
      last.items.push(item);
    else
      pieces.push({ id: item.id, workId: null, title: heading, composer, names: names.map(words), credited: names, items: [item], missing: [] });
    pieces.at(-1).next = item.position;
  }
  return pieces.map(({ next, names, credited, items, ...piece }) => ({
    ...piece,
    first: items[0].position,
    items: items.map(({ position, ...item }) => item),
    movementCount: items.length,
    // Several tracks under one heading look like a work; say when they are
    // not one yet. Sets such as "Études" are never made into works.
    ...(items.length > 1 && !isCollectionLike(piece.title) && !NUMBERED_SET.test(piece.title) && { detail: "Not matched to a work" }),
  }));
}

// Works and pieces follow the album: by each one's first disc and track.
// Two recordings can start on the same track (one complete, one a
// fragment); the longer block comes first, then the id, so the order never
// depends on the random ids alone.
export function compareAlbumGroups(a, b) {
  return (
    a.first - b.first ||
    b.items.length - a.items.length ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function renderAlbumPresentation(c, albumId) {
  const metadata = new DisplayValues(c);
  const album = String(albumId);
  // Filter in SQL: this runs on every album page view.
  const allRows = realizationRows(c, null, null, album);
  const grouped = new Map();
  for (const row of allRows) {
    const group = grouped.get(row.realization_id) || [];
    group.push(row);
    grouped.set(row.realization_id, group);
  }
  // A work's tracks share a block only while they sit together on the
  // album; a work that returns later gets another block there, as Apple
  // Music Classical shows Iberia twice on a recital.
  const positions = c.db
    .prepare(
      `SELECT evidence FROM track_link WHERE state='active'
       AND CAST(json_extract(evidence,'$.albumId') AS TEXT)=?`,
    )
    .all(album)
    .map(albumPosition)
    .sort((a, b) => a - b)
    .filter((position, index, all) => position !== all[index - 1]);
  const following = new Map(positions.map((position, index) => [position, positions[index + 1]]));
  const works = [...grouped.entries()].flatMap(([realizationId, rows]) => {
    const workId = rows[0].work_id;
    const movements = workMovements(c, metadata, workId);
    const present = new Set(rows.flatMap((row) => row.movement_ids).filter(Boolean));
    const runs = [];
    for (const row of [...rows].sort((a, b) => albumPosition(a) - albumPosition(b))) {
      const run = runs.at(-1);
      const last = run && albumPosition(run.at(-1));
      if (run && (last === albumPosition(row) || following.get(last) === albumPosition(row))) run.push(row);
      else runs.push([row]);
    }
    // A set of independent pieces ("13 Preludes, Op. 32") an album plays
    // only a few of is no incomplete recording: its other pieces are not
    // listed as missing on the album page (the work's own page has them).
    const title = entityValue(metadata, workId, "title", "Untitled work");
    // Nor is one excerpt (an overture, an aria) a recording of the rest.
    const excerpts =
      (NUMBERED_SET.test(title) && present.size * 2 < movements.length) ||
      Boolean(
        c.db
          .prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND record_kind='album-work' AND json_extract(evidence,'$.albumId')=? AND json_extract(evidence,'$.excerpt')=1")
          .get(workId, album),
      );
    return runs.map((run, index) => ({
      id: index ? `${realizationId}:${index}` : realizationId,
      workId,
      title,
      composer:
        credits(c, metadata, workId).find(
          (credit) => credit.role === "composer",
        )?.name || "",
      items: run.map((row) =>
        queueItem(
          metadata,
          row,
          row.movement_id && rows.filter((other) => other.movement_id === row.movement_id).length > 1
            ? entityValue(metadata, workId, "title", "")
            : null,
        ),
      ),
      missing: index || excerpts ? [] : movements.filter((movement) => !present.has(movement.id)),
      movementCount: Math.max(1, movements.length),
      first: albumPosition(run[0]),
    }));
  });
  const groups = [...works, ...pieceGroups(c, album, following)]
    .sort(compareAlbumGroups)
    .map(({ first, ...group }) => group);
  // Matched works have work pages even when each work occupies one track.
  if (!groups.some((group) => group.workId || group.items.length > 1)) return null;
  return { version: 1, albumId: album, supportsToggle: true, groups };
}

export function renderWork(c, workId, user) {
  c.entity(workId, "work");
  const metadata = new DisplayValues(c);
  const movements = workMovements(c, metadata, workId);
  const rows = realizationRows(c, null, workId);
  const byRealization = new Map();
  for (const row of rows) {
    const current = byRealization.get(row.realization_id) || [];
    current.push(row);
    byRealization.set(row.realization_id, current);
  }
  const state = c.db
    .prepare("SELECT * FROM user_work_state WHERE user_id=? AND work_id=?")
    .get(user.id, workId);
  const adminPick = c.db
    .prepare("SELECT realization_id FROM admin_work_pick WHERE work_id=?")
    .get(workId)?.realization_id;
  return {
    version: 1,
    work: {
      id: workId,
      title: entityValue(metadata, workId, "title", "Untitled work"),
      nickname: entityValue(metadata, workId, "nickname", ""),
      description: entityValue(metadata, workId, "description", ""),
      credits: credits(c, metadata, workId),
      movements,
      collections: c.db
        .prepare(
          `SELECT source_id FROM relation
           WHERE kind='collection_member' AND target_id=? ORDER BY position,id`,
        )
        .all(workId)
        .map((row) => ({
          id: row.source_id,
          title: entityValue(
            metadata,
            row.source_id,
            "title",
            "Untitled collection",
          ),
        })),
    },
    favourite: state?.favourite === 1,
    pickedRealizationId: state?.picked_realization_id || adminPick || null,
    adminPickId: adminPick || null,
    pickScope: state?.picked_realization_id
      ? "user"
      : adminPick
        ? "admin"
        : null,
    recordings: [...byRealization.entries()].map(([id, entries], index) => {
      const present = new Set(
        entries.flatMap((entry) => entry.movement_ids).filter(Boolean),
      );
      const performanceId = c.db
        .prepare("SELECT source_id FROM relation WHERE id=?")
        .get(entries[0].performance_work_id)?.source_id;
      const recordingIds = c.db
        .prepare(
          "SELECT source_id FROM relation WHERE kind='recording_performance' AND target_id=? ORDER BY source_id",
        )
        .all(performanceId)
        .map((row) => row.source_id);
      const performers = credits(c, metadata, performanceId).filter(
        (credit) => credit.role !== "composer",
      );
      const first = evidenceOf(entries[0]);
      const album = text(entries[0].realization_label, text(first.hints?.album, ""));
      const artist = performers.length
        ? performers.map((credit) => credit.name).join(", ")
        : text(first.hints?.artist, text(first.hints?.albumArtist, ""));
      return {
        id,
        label:
          [artist, album].filter(Boolean).join(" · ") ||
          `Recording ${index + 1}`,
        albumId: first.albumId == null ? null : String(first.albumId),
        recordingIds,
        credits: credits(c, metadata, performanceId),
        items: entries.map((entry) =>
          queueItem(
            metadata,
            entry,
            entry.movement_id && entries.filter((other) => other.movement_id === entry.movement_id).length > 1
              ? entityValue(metadata, workId, "title", "")
              : null,
          ),
        ),
        missing: movements.filter((movement) => !present.has(movement.id)),
        complete:
          movements.length === 0 ||
          movements.every((movement) => present.has(movement.id)),
      };
    }),
  };
}

export async function readWork(input) {
  const user = actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return renderWork(c, input.resourceId, user);
  } finally {
    c.close();
  }
}

export async function mutateWork(input) {
  const user = actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return applyWorkMutation(c, input, user);
  } finally {
    c.close();
  }
}

export function applyWorkMutation(c, input, user) {
  return transaction(c.db, () => {
    const workId = String(input.resourceId || "");
    c.entity(workId, "work");
    const command = input.mutation?.command;
    const realizationId = input.mutation?.realizationId || null;
    if (realizationId) {
      const row = c.db
        .prepare("SELECT 1 FROM realization WHERE id=? AND work_id=?")
        .get(realizationId, workId);
      if (!row) throw new Error("Recording does not belong to this work");
    }
    if (command === "favourite") {
      const favourite = input.mutation?.value === true ? 1 : 0;
      c.db
        .prepare(
          `INSERT INTO user_work_state(user_id,work_id,favourite,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(user_id,work_id) DO UPDATE SET favourite=excluded.favourite,updated_at=excluded.updated_at`,
        )
        .run(user.id, workId, favourite, Date.now());
    } else if (command === "pick") {
      c.db
        .prepare(
          `INSERT INTO user_work_state(user_id,work_id,favourite,picked_realization_id,updated_at)
           VALUES (?,?,0,?,?) ON CONFLICT(user_id,work_id) DO UPDATE SET
           picked_realization_id=excluded.picked_realization_id,updated_at=excluded.updated_at`,
        )
        .run(user.id, workId, realizationId, Date.now());
    } else if (command === "admin-pick" && user.role === "admin") {
      if (realizationId)
        c.db
          .prepare(
            `INSERT INTO admin_work_pick VALUES (?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET
             realization_id=excluded.realization_id,actor_id=excluded.actor_id,updated_at=excluded.updated_at`,
          )
          .run(workId, realizationId, user.id, Date.now());
      else
        c.db.prepare("DELETE FROM admin_work_pick WHERE work_id=?").run(workId);
    } else if (command === "admin-pick")
      throw new Error("Only admins can set the admin pick");
    else throw new Error("Unknown work action");
    return { ok: true };
  });
}

export async function albumPresentation(input) {
  actor(input);
  const c = await openCatalogue(path.join(input.dataFolder, "model"));
  try {
    return renderAlbumPresentation(c, input.album.id);
  } finally {
    c.close();
  }
}
