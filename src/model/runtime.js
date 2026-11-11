import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { ModelJobs } from "./jobs.js";
import { reconcile, classify } from "./reconcile.js";
import { UserOperations } from "../user-operations.js";
import { readTags } from "../tags.js";
import { autoMatchTaggedWorks } from "./auto-match.js";

export const modelFolder = (ctx) => path.join(ctx.dataFolder, "model");
const fingerprint = async (file) => {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  // Full-file evidence is versioned. A retag needs review unless other evidence agrees.
  return `file-sha256-v1:${hash.digest("hex")}`;
};
const emptyTags = () => ({
  title: "",
  artist: "",
  albumArtist: "",
  album: "",
  recordingMbid: "",
  releaseMbid: "",
  releaseGroupMbid: "",
  albumArtistMbids: [],
  artistMbids: [],
  genres: [],
  composer: [],
  work: "",
  workId: "",
  trackNumber: 0,
  discNumber: 0,
  durationMs: 0,
});
const readModelTags = (file) => {
  try {
    return readTags(file);
  } catch {
    // A full-file hash was read immediately before this. If optional tag
    // parsing rejects an owned file (unsupported format, malformed header,
    // or an unusual encoder), keep it searchable from the host's trusted
    // metadata instead of failing an otherwise read-only model scan.
    return emptyTags();
  }
};
export async function modelStatus(ctx) {
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    return {
      ...catalogue.diagnostics(),
      scan:
        catalogue.db
          .prepare(
            `SELECT id,state,CASE WHEN state IN ('retry','failed') THEN error ELSE NULL END AS error,
          json_array_length(input,'$.files') AS total,
          coalesce(json_extract(progress,'$.cursor'),0) AS processed
          FROM model_job WHERE type='library_scan' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
          )
          .get() || null,
      jobs: catalogue.db
        .prepare("SELECT state,count(*) AS count FROM model_job GROUP BY state")
        .all(),
    };
  } finally {
    catalogue.close();
  }
}

export async function enqueueModelScan(ctx, actor) {
  if (actor?.role !== "admin")
    throw new Error("Classical model scans require a current host admin");
  const operations = new UserOperations(ctx.userOperations, ctx.fetch);
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    // Resume an existing scan without requesting another full host snapshot.
    const pending = catalogue.db
      .prepare(
        "SELECT id FROM model_job WHERE key='library_scan' AND state IN ('queued','running','retry') LIMIT 1",
      )
      .get();
    if (pending) return pending.id;
    const latest = catalogue.db
      .prepare(
        "SELECT id,state FROM model_job WHERE key='library_scan' ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get();
    if (latest?.state === "failed") {
      catalogue.db
        .prepare(
          `UPDATE model_job SET state='queued',owner=NULL,lease_until=0,attempt=0,
          next_run_at=0,cancel_requested=0,error=NULL WHERE id=? AND state='failed'`,
        )
        .run(latest.id);
      return latest.id;
    }
    const library = await operations.library();
    // A local binding lives with the plugin data/config. File hashes still guard reused core IDs.
    let instance = catalogue.db
      .prepare("SELECT * FROM core_instance LIMIT 1")
      .get();
    if (!instance) {
      const id = randomUUID();
      catalogue.db
        .prepare("INSERT INTO core_instance VALUES (?,?,0)")
        .run(id, ctx.settings.libraryEpoch || "initial");
      instance = { id, generation: 0 };
    }
    const albums = new Map(
      (library.albums || []).map((album) => [String(album.id), album]),
    );
    const files = library.tracks.flatMap((track) =>
      track.files
        .filter((f) => f.available && f.source !== "flow")
        .map((file) => {
          const placement = (track.albums || []).find(
            (album) => String(album.albumId ?? album.id) === String(file.albumId),
          );
          const album = albums.get(String(file.albumId));
          return {
            coreId: String(track.id),
            fileId: String(file.id ?? file.path),
            path: file.path,
            readPath: file.readPath || file.path,
            durationMs: file.durationMs ?? track.durationMs,
            albumId: file.albumId,
            title: track.title || "",
            artist: track.artistName || "",
            album: album?.title || track.albumTitle || "",
            trackNumber: file.trackNumber ?? placement?.trackNumber ?? 0,
            discNumber: file.discNumber ?? placement?.discNumber ?? 0,
          };
        }),
    );
    const jobs = new ModelJobs(catalogue);
    return jobs.enqueue("library_scan", "library_scan", {
      actor: String(actor.id),
      instanceId: instance.id,
      epoch: ctx.settings.libraryEpoch || "initial",
      generation: instance.generation + 1,
      files,
    });
  } finally {
    catalogue.close();
  }
}

// File reads happen outside the writer transaction. Only a fenced checkpoint may publish them.
export async function runModelJobs(
  ctx,
  { budgetMs = 5000, batchSize = 10 } = {},
) {
  const catalogue = await openCatalogue(modelFolder(ctx));
  const jobs = new ModelJobs(catalogue),
    owner = randomUUID(),
    deadline = Date.now() + budgetMs;
  try {
    const job = jobs.claim(owner, { leaseMs: 60_000 });
    if (!job) return;
    try {
      if (job.type !== "library_scan")
        throw new Error("Unknown model job type");
      const input = job.input;
      let cursor = job.progress.cursor || 0;
      const collected = job.progress.collected || [];
      const root = await fs.realpath(ctx.libraryFolder);
      while (cursor < input.files.length && Date.now() < deadline) {
        const stop = Math.min(cursor + batchSize, input.files.length);
        for (; cursor < stop && Date.now() < deadline; cursor++) {
          if (
            catalogue.db
              .prepare("SELECT cancel_requested FROM model_job WHERE id=?")
              .get(job.id).cancel_requested
          )
            break;
          const file = input.files[cursor];
          const real = await fs.realpath(file.readPath);
          const relative = path.relative(root, real);
          if (
            !relative ||
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          )
            throw new Error(
              "Indexed model file is outside the configured library",
            );
          const before = await fs.stat(real);
          const hash = await fingerprint(real);
          const tags = readModelTags(real);
          const after = await fs.stat(real);
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ino !== after.ino
          )
            throw new Error(
              "Library file changed during model scan; retry required",
            );
          const durationMs = tags.durationMs || file.durationMs;
          if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
            throw new Error("Missing track duration");
          collected.push({
            ...file,
            observedRealPath: real,
            size: after.size,
            durationMs,
            fingerprint: hash,
            hints: {
              title: tags.title || file.title || "",
              album: tags.album || file.album || "",
              artist: tags.artist || file.artist || "",
              albumArtist: tags.albumArtist,
              composer: tags.composer,
              trackNumber: tags.trackNumber || file.trackNumber || 0,
              discNumber: tags.discNumber || file.discNumber || 0,
              genres: tags.genres,
              work: tags.work,
              workId: tags.workId,
              recordingMbid: tags.recordingMbid,
              composerDistinct:
                tags.composer.length > 0 &&
                !tags.composer.includes(tags.artist),
            },
          });
        }
        if (!jobs.checkpoint(job, { cursor, collected }, { leaseMs: 60_000 }))
          return;
      }
      const done = cursor === input.files.length;
      const committed = jobs.checkpoint(
        job,
        { cursor, collected },
        {
          done,
          leaseMs: 60_000,
          commit: done
            ? () => {
                const rows = reconcile(catalogue, {
                  version: 1,
                  complete: true,
                  instanceId: input.instanceId,
                  epoch: input.epoch,
                  generation: input.generation,
                  tracks: collected,
                });
                const albums = new Map();
                for (const row of rows) {
                  const albumTarget =
                    row.albumId == null
                      ? null
                      : catalogue.albumTarget(input.instanceId, row.albumId);
                  const albumPin =
                    albumTarget &&
                    catalogue.db
                      .prepare(
                        "SELECT state,pinned FROM classification WHERE target_id=?",
                      )
                      .get(albumTarget);
                  const inherited = albumPin?.pinned ? albumPin.state : null;
                  const state = classify(
                    catalogue,
                    row.id,
                    {
                      ...row.hints,
                      ...(inherited && { albumOverride: inherited }),
                    },
                    { inherited },
                  );
                  if (row.albumId != null) {
                    if (!albums.has(row.albumId)) albums.set(row.albumId, []);
                    albums.get(row.albumId).push(state);
                  }
                }
                for (const [albumId, states] of albums) {
                  const target = catalogue.albumTarget(
                    input.instanceId,
                    albumId,
                  );
                  // Mixed albums stay unsure as a whole; only their confirmed tracks opt in.
                  const state = states.every((s) => s === "classical")
                    ? "classical"
                    : states.every((s) => s === "not_classical")
                      ? "not_classical"
                      : "unsure";
                  const prior = catalogue.db
                    .prepare(
                      "SELECT pinned FROM classification WHERE target_id=?",
                    )
                    .get(target);
                  if (!prior?.pinned)
                    catalogue.db
                      .prepare(
                        `INSERT INTO classification VALUES (?,?,0,0,?,1,?)
            ON CONFLICT(target_id) DO UPDATE SET state=excluded.state,evidence=excluded.evidence,updated_at=excluded.updated_at`,
                      )
                      .run(
                        target,
                        state,
                        JSON.stringify({ trackStates: states }),
                        Date.now(),
                      );
                }
                autoMatchTaggedWorks(catalogue, { actor: "model-scan" });
              }
            : undefined,
        },
      );
      if (committed && !done) jobs.yield(job);
    } catch (error) {
      jobs.fail(job, error.message);
      throw error;
    }
  } finally {
    catalogue.close();
  }
}

export async function autoMatchWorks(ctx, actor, albumId = null) {
  if (actor?.role !== "admin")
    throw new Error("Automatic work matching requires a current host admin");
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    return autoMatchTaggedWorks(catalogue, {
      albumId,
      actor: String(actor.id),
    });
  } finally {
    catalogue.close();
  }
}

export async function cancelModelScan(ctx, actor) {
  if (actor?.role !== "admin")
    throw new Error("Cancelling model scans requires a current host admin");
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    const jobs = new ModelJobs(catalogue);
    for (const row of catalogue.db
      .prepare(
        "SELECT id FROM model_job WHERE state IN ('queued','running','retry')",
      )
      .all())
      jobs.cancel(row.id);
  } finally {
    catalogue.close();
  }
}
