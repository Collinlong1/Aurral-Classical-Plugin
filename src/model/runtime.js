import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { ModelJobs } from "./jobs.js";
import { reconcile, classify } from "./reconcile.js";
import { UserOperations } from "../user-operations.js";
import { readTags } from "../tags.js";
import { autoMatchTaggedWorks, isCollectionLike } from "./auto-match.js";
import { topWork } from "../works.js";
import { fingerprint } from "./fingerprint.js";

export const modelFolder = (ctx) => path.join(ctx.dataFolder, "model");
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
          coalesce(json_extract(progress,'$.cursor'),0) AS processed,
          coalesce(json_extract(progress,'$.errorCount'),0) AS skipped,
          lease_until AS leaseUntil
          FROM model_job WHERE type='library_scan' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
          )
          .get() || null,
      now: Date.now(),
      jobs: catalogue.db
        .prepare("SELECT state,count(*) AS count FROM model_job GROUP BY state")
        .all(),
    };
  } finally {
    catalogue.close();
  }
}

const PLUGIN_ID = "aurral-classical";
export const SYNC_INTERVAL_MS = 6 * 60 * 60_000;
const syncFlag = (ctx) => path.join(modelFolder(ctx), "sync-requested");

// The fork grants a user action a library snapshot; scheduled runs use the
// plugin's own API key for the same snapshot route.
async function hostLibrary(ctx) {
  if (ctx.userOperations)
    return new UserOperations(ctx.userOperations, ctx.fetch).library();
  if (ctx.api?.url && ctx.api?.key) {
    const response = await (ctx.fetch || fetch)(
      `${ctx.api.url}/plugins/${PLUGIN_ID}/user-operations/library`,
      {
        headers: { "X-Api-Key": ctx.api.key },
        signal: AbortSignal.timeout(60_000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || `Library snapshot failed: ${response.status}`);
    if (data.version !== 1 || data.complete !== true)
      throw new Error("Incomplete library snapshot; scan cancelled");
    return data.library;
  }
  throw new Error(
    "Classical model scans require the host's user-operations capability or plugin API access",
  );
}
export const canReadHostLibrary = (ctx) =>
  !!(ctx.userOperations || (ctx.api?.url && ctx.api?.key));

// Called from download events: cheap, never scans inside the 10 second event window.
export async function requestModelSync(ctx) {
  await fs.mkdir(modelFolder(ctx), { recursive: true });
  await fs.writeFile(syncFlag(ctx), String(Date.now()));
}

// True when a download asked for a sync or the last completed scan is stale.
export async function modelSyncDue(ctx, { now = Date.now() } = {}) {
  const requested = await fs
    .access(syncFlag(ctx))
    .then(() => true, () => false);
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    if (
      catalogue.db
        .prepare(
          "SELECT 1 FROM model_job WHERE key='library_scan' AND state IN ('queued','running','retry')",
        )
        .get()
    )
      return false;
    const last = catalogue.db
      .prepare(
        "SELECT max(created_at) AS at FROM model_job WHERE key='library_scan' AND state='done'",
      )
      .get().at;
    return requested || !last || now - last >= SYNC_INTERVAL_MS;
  } finally {
    catalogue.close();
  }
}

export async function enqueueModelScan(ctx, actor, { system = false } = {}) {
  if (!system && actor?.role !== "admin")
    throw new Error("Classical model scans require a current host admin");
  if (!canReadHostLibrary(ctx))
    throw new Error(
      "Classical model scans require the host's user-operations capability or plugin API access",
    );
  await fs.rm(syncFlag(ctx), { force: true });
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
    const library = await hostLibrary(ctx);
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
            recordingMbid: track.mbid || "",
            album: album?.title || track.albumTitle || "",
            trackNumber: file.trackNumber ?? placement?.trackNumber ?? 0,
            discNumber: file.discNumber ?? placement?.discNumber ?? 0,
          };
        }),
    );
    const jobs = new ModelJobs(catalogue);
    return jobs.enqueue("library_scan", "library_scan", {
      actor: system ? "system" : String(actor.id),
      instanceId: instance.id,
      epoch: ctx.settings.libraryEpoch || "initial",
      generation: instance.generation + 1,
      files,
    });
  } finally {
    catalogue.close();
  }
}

async function scanFile(file, root, prior) {
  const real = await fs.realpath(file.readPath);
  const relative = path.relative(root, real);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Indexed model file is outside the configured library");
  const before = await fs.stat(real);
  const unchanged =
    prior?.fingerprint &&
    prior.observedRealPath === real &&
    prior.size === before.size &&
    prior.mtimeMs === before.mtimeMs &&
    prior.ino === before.ino;
  const hash = unchanged ? prior.fingerprint : await fingerprint(real);
  const tags = readModelTags(real);
  const after = await fs.stat(real);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  )
    throw new Error("Library file changed during model scan; retry required");
  const durationMs = tags.durationMs || file.durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    throw new Error("Missing track duration");
  return {
    ...file,
    observedRealPath: real,
    size: after.size,
    mtimeMs: after.mtimeMs,
    ino: after.ino,
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
      recordingMbid: tags.recordingMbid || file.recordingMbid || "",
      composerDistinct:
        tags.composer.length > 0 && !tags.composer.includes(tags.artist),
    },
  };
}

// File reads happen outside the writer transaction. Only a fenced checkpoint may publish them.
export async function runModelJobs(
  ctx,
  { budgetMs = 5000, batchSize = 200, checkpointMs = 10_000 } = {},
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
      const errors = job.progress.errors || [];
      let errorCount = job.progress.errorCount || 0;
      const root = await fs.realpath(ctx.libraryFolder);
      // Last known evidence per host file: unchanged files skip re-hashing,
      // and a file that can't be read this time keeps its previous evidence.
      const previous = new Map(
        catalogue.db
          .prepare(
            "SELECT core_id,file_id,evidence FROM track_link WHERE instance_id=? AND state='active'",
          )
          .all(input.instanceId)
          .map((row) => [
            JSON.stringify([row.core_id, row.file_id]),
            JSON.parse(row.evidence),
          ]),
      );
      const skip = (file, error, prior) => {
        errorCount++;
        if (errors.length < 50)
          errors.push({ path: file.path, error: String(error).slice(0, 200) });
        if (prior && error?.code !== "ENOENT")
          collected.push({
            ...file,
            observedRealPath: prior.observedRealPath,
            size: prior.size,
            durationMs: prior.durationMs,
            fingerprint: prior.fingerprint,
            ...(prior.mtimeMs != null && { mtimeMs: prior.mtimeMs, ino: prior.ino }),
            hints: prior.hints,
          });
      };
      while (cursor < input.files.length && Date.now() < deadline) {
        const stop = Math.min(cursor + batchSize, input.files.length);
        const checkpointAt = Date.now() + checkpointMs;
        let cancelled = false;
        for (
          ;
          cursor < stop && Date.now() < deadline && Date.now() < checkpointAt;
          cursor++
        ) {
          if (
            catalogue.db
              .prepare("SELECT cancel_requested FROM model_job WHERE id=?")
              .get(job.id).cancel_requested
          ) {
            cancelled = true;
            break;
          }
          const file = input.files[cursor];
          const prior = previous.get(JSON.stringify([file.coreId, file.fileId]));
          try {
            collected.push(await scanFile(file, root, prior));
          } catch (error) {
            skip(file, error, prior);
          }
          // Tag reading is synchronous; let album pages and the editor get
          // answers between files instead of waiting behind the whole scan.
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (
          !jobs.checkpoint(
            job,
            { cursor, collected, errors, errorCount },
            { leaseMs: 60_000 },
          )
        )
          return;
        if (cancelled) break;
      }
      const done = cursor === input.files.length;
      const committed = jobs.checkpoint(
        job,
        { cursor, collected, errors, errorCount },
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
    const local = autoMatchTaggedWorks(catalogue, {
      albumId,
      actor: String(actor.id),
      // This is an explicit admin action. A structured classical title may be
      // accepted with matching composer, album, classification and ordering;
      // unattended scans continue to require an embedded WORK tag.
      allowStructuredTitles: true,
    });
    const providerMatches = new Map();
    const rows = catalogue.db
      .prepare(
        `SELECT t.id,t.evidence FROM track_link t
         JOIN classification c ON c.target_id=t.id AND c.state='classical'
         WHERE t.state='active'
         AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?
         AND NOT EXISTS(SELECT 1 FROM segment s WHERE s.track_link_id=t.id)`,
      )
      .all(String(albumId));
    for (const row of rows) {
      const hints = JSON.parse(row.evidence).hints || {};
      try {
        let workId = hints.workId;
        let composers = hints.composer || [];
        if (!workId && hints.recordingMbid) {
          const fields = await ctx.resolver.resolve(hints.recordingMbid, {
            confirmed: true,
          });
          workId = fields?.workId;
          if (!composers.length) composers = fields?.composers || [];
        }
        if (!workId) continue;
        const leaf = await ctx.mb.get(
          "work",
          workId,
          "artist-rels+work-rels",
        );
        const parent = leaf && (await topWork(ctx.mb, leaf));
        if (
          !parent?.id ||
          parent.id === leaf.id ||
          isCollectionLike(parent.title)
        )
          continue;
        providerMatches.set(row.id, {
          workId: parent.id,
          work: parent.title,
          composers,
        });
      } catch (error) {
        ctx.log(`Classical work identification skipped: ${error.message}`);
      }
    }
    const provider = autoMatchTaggedWorks(catalogue, {
      albumId,
      actor: String(actor.id),
      allowStructuredTitles: true,
      providerMatches,
    });
    return {
      created: local.created + provider.created,
      candidates: local.candidates + provider.candidates,
    };
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
