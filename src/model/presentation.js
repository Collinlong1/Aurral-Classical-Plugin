import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { Metadata } from "./metadata.js";
import { transaction } from "./database.js";

const text = (value, fallback) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
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
  return c.db
    .prepare(
      `SELECT r.id AS realization_id,r.work_id,r.performance_work_id,r.label AS realization_label,
        i.id AS item_id,i.movement_id,i.sequence,i.occurrence,s.start_ms,s.end_ms,s.kind AS segment_kind,
        t.id AS track_link_id,t.core_id,t.file_id,t.evidence
      FROM realization r
      JOIN realization_item i ON i.realization_id=r.id
      JOIN segment s ON s.id=i.segment_id
      JOIN track_link t ON t.id=s.track_link_id AND t.state='active'
      JOIN classification c ON c.target_id=t.id AND c.state='classical'
      WHERE (? IS NULL OR r.id=?) AND (? IS NULL OR r.work_id=?)
        AND (? IS NULL OR CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?)
      ORDER BY r.id,i.sequence,i.occurrence,i.id`,
    )
    .all(realizationId, realizationId, workId, workId, albumId, albumId);
}

function queueItem(metadata, row) {
  const evidence = evidenceOf(row);
  return {
    id: row.item_id,
    trackId: String(row.core_id),
    fileId: String(row.file_id),
    albumId: String(evidence.albumId ?? ""),
    title: row.movement_id
      ? entityValue(metadata, row.movement_id, "title", trackTitle(evidence))
      : trackTitle(evidence),
    artist: text(evidence.hints?.artist, text(evidence.hints?.albumArtist, "")),
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

export function renderAlbumPresentation(c, albumId) {
  const metadata = new Metadata(c);
  const album = String(albumId);
  // Filter in SQL: this runs on every album page view.
  const allRows = realizationRows(c, null, null, album);
  if (!allRows.length) return null;
  const grouped = new Map();
  for (const row of allRows) {
    const group = grouped.get(row.realization_id) || [];
    group.push(row);
    grouped.set(row.realization_id, group);
  }
  const groups = [...grouped.entries()].map(([realizationId, rows]) => {
    const workId = rows[0].work_id;
    const movements = workMovements(c, metadata, workId);
    const present = new Set(rows.map((row) => row.movement_id).filter(Boolean));
    return {
      id: realizationId,
      workId,
      title: entityValue(metadata, workId, "title", "Untitled work"),
      composer:
        credits(c, metadata, workId).find(
          (credit) => credit.role === "composer",
        )?.name || "",
      items: rows.map((row) => queueItem(metadata, row)),
      missing: movements.filter((movement) => !present.has(movement.id)),
      movementCount: movements.length,
    };
  });
  const supportsToggle = groups.some((group) => group.movementCount > 1);
  if (!supportsToggle) return null;
  return { version: 1, albumId: album, supportsToggle, groups };
}

export function renderWork(c, workId, user) {
  c.entity(workId, "work");
  const metadata = new Metadata(c);
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
    pickScope: state?.picked_realization_id
      ? "user"
      : adminPick
        ? "admin"
        : null,
    recordings: [...byRealization.entries()].map(([id, entries], index) => {
      const present = new Set(
        entries.map((entry) => entry.movement_id).filter(Boolean),
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
        items: entries.map((entry) => queueItem(metadata, entry)),
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
