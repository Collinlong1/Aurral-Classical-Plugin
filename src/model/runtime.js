import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { transaction, verifyOnce } from "./database.js";
import { ModelJobs } from "./jobs.js";
import { reconcile, classify } from "./reconcile.js";
import { UserOperations } from "../user-operations.js";
import { readTags } from "../tags.js";
import { autoMatchTaggedWorks, catalogueSubject, isCollectionLike, titleHead, withoutComposer } from "./auto-match.js";
import { topWork } from "../works.js";
import { ClassicalResolver, isLatin } from "../resolver.js";
import { fingerprint, tagSensitive } from "./fingerprint.js";

// A work's English title, as artist names pick theirs: a primary English
// alias, or any English alias when MusicBrainz's title isn't Latin script.
function englishTitle(work, fallback = work.title) {
  const alias = ClassicalResolver.bestEnglishAlias(work.aliases);
  return alias && (alias.primary || !isLatin(work.title)) ? alias.name : fallback;
}

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
  grouping: "",
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
    return null;
  }
};
// Tags read on an earlier scan still describe this file unless its audio
// hash proves the audio itself changed. (A whole-file hash changes with any
// tag edit, so a mismatch there proves nothing.)
const sameAudio = (prior, hash) =>
  prior.fingerprint === hash || (tagSensitive(prior.fingerprint) && tagSensitive(hash));
export async function modelStatus(ctx) {
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    return {
      ...catalogue.diagnostics(),
      scan:
        catalogue.db
          .prepare(
            `SELECT id,state,CASE WHEN state IN ('retry','failed') THEN error ELSE NULL END AS error,
          coalesce(json_extract(input,'$.total'),json_array_length(input,'$.files')) AS total,
          coalesce(json_extract(progress,'$.cursor'),0) AS processed,
          coalesce(json_extract(progress,'$.errorCount'),0) AS skipped,
          lease_until AS leaseUntil
          FROM model_job WHERE type='library_scan' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
          )
          .get() || null,
      now: Date.now(),
      jobs: catalogue.db
        // Markers of albums seen without a lookup are no jobs.
        .prepare(
          `SELECT state,count(*) AS count FROM model_job WHERE type NOT IN ('scan_chunk','album_identify_baseline')
           AND NOT (type='album_identify' AND json_extract(progress,'$.baseline')=1) GROUP BY state`,
        )
        .all(),

      identification: identificationStatus(catalogue),
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
  // Unique per request, so a request made while a scan starts is never
  // mistaken for the one that scan already covers.
  await fs.writeFile(syncFlag(ctx), `${Date.now()}:${randomUUID()}`);
}
const readSyncFlag = (ctx) => fs.readFile(syncFlag(ctx), "utf8").catch(() => null);
// Only a fresh snapshot answers a request, and only the request it saw.
async function clearSyncFlag(ctx, seen) {
  if (seen != null && (await readSyncFlag(ctx)) === seen) await fs.rm(syncFlag(ctx), { force: true });
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
  // A pending or resumed scan uses an older snapshot, and fetching a new one
  // can fail: the request stays until a fresh snapshot is actually queued.
  const requested = await readSyncFlag(ctx);
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    // Resume an existing scan without requesting another full host snapshot.
    const pending = catalogue.db
      .prepare(
        "SELECT id FROM model_job WHERE key='library_scan' AND state IN ('queued','running','retry') LIMIT 1",
      )
      .get();
    if (pending) return pending.id;
    new ModelJobs(catalogue).compactFinished();
    const latest = catalogue.db
      .prepare(
        "SELECT id,state,created_at FROM model_job WHERE key='library_scan' ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get();
    // A failed scan resumes from its saved snapshot, unless the library was
    // asked to sync after that snapshot was taken.
    const requestedAt = Number(String(requested ?? "").split(":")[0]) || 0;
    if (latest?.state === "failed" && !(requestedAt > latest.created_at)) {
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
    const id = jobs.enqueue("library_scan", "library_scan", {
      actor: system ? "system" : String(actor.id),
      instanceId: instance.id,
      epoch: ctx.settings.libraryEpoch || "initial",
      generation: instance.generation + 1,
      files,
    });
    await clearSyncFlag(ctx, requested);
    return id;
  } finally {
    catalogue.close();
  }
}

const REUSED = Symbol("reused");
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
  // Same file, not written since the last scan. Any write or replacement
  // moves ctime, so where the last scan stored one it decides; the inode is
  // the fallback for evidence from before 1.0.31. Some filesystems (mergerfs,
  // network shares, some container mounts) report a new inode number for an
  // unchanged file, which made every rescan re-hash half the library.
  const unchanged =
    prior?.fingerprint &&
    prior.observedRealPath === real &&
    prior.size === before.size &&
    prior.mtimeMs === before.mtimeMs &&
    (prior.ctimeMs != null ? prior.ctimeMs === before.ctimeMs : prior.ino === before.ino);
  // Nothing wrote to the file since the last scan read it: any write,
  // a tag edit that keeps the modified time included, moves its ctime. And
  // the host still places it the same way. What that scan read still holds,
  // so the file is not opened again; a rescan of an unchanged library only
  // stats its files.
  if (
    unchanged &&
    prior.hints &&
    !prior.hints.tagsUnreadable &&
    prior.ctimeMs != null &&
    ["title", "album", "artist", "albumId", "trackNumber", "discNumber", "recordingMbid"].every((key) => prior[key] === file[key])
  )
    return { ...prior, ...file, ino: before.ino, durationMs: prior.durationMs, [REUSED]: true };
  const hash = unchanged ? prior.fingerprint : await fingerprint(real);
  const parsed = readModelTags(real);
  const tags = parsed || emptyTags();
  const after = await fs.stat(real);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  )
    throw new Error("Library file changed during model scan; retry required");
  // The parser rejected the file this time: keep what it read before rather
  // than erasing composer, WORK, MusicBrainz and genre evidence.
  const kept = !parsed && prior?.hints && sameAudio(prior, hash) ? prior : null;
  const durationMs = tags.durationMs || file.durationMs || kept?.durationMs;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    throw new Error("Missing track duration");
  if (kept)
    return {
      ...file,
      observedRealPath: real,
      size: after.size,
      mtimeMs: after.mtimeMs,
      ino: after.ino,
      ctimeMs: after.ctimeMs,
      durationMs,
      fingerprint: hash,
      hints: {
        ...kept.hints,
        title: kept.hints.title || file.title || "",
        album: kept.hints.album || file.album || "",
        artist: kept.hints.artist || file.artist || "",
        tagsUnreadable: true,
      },
    };
  return {
    ...file,
    observedRealPath: real,
    size: after.size,
    mtimeMs: after.mtimeMs,
    ino: after.ino,
    ctimeMs: after.ctimeMs,
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
      // Only when set, so files without it keep their stored evidence.
      ...(tags.grouping && { grouping: tags.grouping }),
      workId: tags.workId,
      recordingMbid: tags.recordingMbid || file.recordingMbid || "",
      composerDistinct:
        tags.composer.length > 0 && !tags.composer.includes(tags.artist),
    },
  };
}

// Background MusicBrainz identification, one album at a time.
//
// A scan queues an album when it has classical tracks outside every work
// that carry a recording or work ID, and that set of tracks is new: the
// job's key holds a hash of it, and a key that ever ran is never queued
// again. So only what changed is looked up (core rule 5). The first time
// this runs it records the albums already there as seen without looking
// them up; the one-time backfill of those (`identifyBacklog`) is an admin
// action, never automatic.
const IDENTIFY = "album_identify";
// The identification rules' version is part of every key. When the rules
// change (1.0.35 accepted whole works in one movement), the next scan records
// the albums still pending as seen again, without looking them up, and the
// admin's backlog action asks MusicBrainz about them once more.
const RULES = "r2";
const BASELINE_KEY = `album-identify-baseline:${RULES}`;

function pendingIdentification(catalogue) {
  const albums = new Map();
  for (const row of catalogue.db
    .prepare(
      `SELECT t.id,CAST(json_extract(t.evidence,'$.albumId') AS TEXT) AS album,
         json_extract(t.evidence,'$.hints.recordingMbid') AS recording,json_extract(t.evidence,'$.hints.workId') AS work
       FROM track_link t JOIN classification c ON c.target_id=t.id AND c.state='classical'
       WHERE t.state='active' AND json_extract(t.evidence,'$.albumId') IS NOT NULL
       AND (coalesce(json_extract(t.evidence,'$.hints.recordingMbid'),'')!='' OR coalesce(json_extract(t.evidence,'$.hints.workId'),'')!='')
       AND NOT EXISTS(SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=t.id)
       ORDER BY t.id`,
    )
    .all()) {
    if (!albums.has(row.album)) albums.set(row.album, []);
    albums.get(row.album).push(`${row.id}|${row.recording || ""}|${row.work || ""}`);
  }
  return [...albums].map(([albumId, tracks]) => ({
    albumId,
    tracks: tracks.length,
    key: `${IDENTIFY}:${RULES}:${albumId}:${createHash("sha256").update(tracks.join("\n")).digest("hex").slice(0, 32)}`,
  }));
}

const keyRan = (catalogue, key) => Boolean(catalogue.db.prepare("SELECT 1 FROM model_job WHERE key=? LIMIT 1").get(key));
// A finished marker: never claimed, it only says this key was handled.
function markSeen(catalogue, album, progress) {
  catalogue.db
    .prepare(
      `INSERT INTO model_job(id,type,key,input,state,progress,max_attempts,created_at)
       VALUES (?,?,?,?,'done',?,1,?)`,
    )
    .run(randomUUID(), IDENTIFY, album.key, JSON.stringify({ albumId: album.albumId }), JSON.stringify(progress), Date.now());
}

export function queueAlbumIdentification(catalogue, { now = Date.now() } = {}) {
  return transaction(catalogue.db, () => {
    const pending = pendingIdentification(catalogue);
    if (!keyRan(catalogue, BASELINE_KEY)) {
      // Albums already in the library when this first runs are the backlog.
      for (const album of pending) if (!keyRan(catalogue, album.key)) markSeen(catalogue, album, { baseline: true, tracks: album.tracks });
      catalogue.db
        .prepare(`INSERT INTO model_job(id,type,key,input,state,max_attempts,created_at) VALUES (?,?,?,'{}','done',1,?)`)
        .run(randomUUID(), `${IDENTIFY}_baseline`, BASELINE_KEY, now);
      return 0;
    }
    const jobs = new ModelJobs(catalogue);
    let queued = 0;
    for (const album of pending)
      if (!keyRan(catalogue, album.key)) {
        jobs.enqueue(IDENTIFY, album.key, { albumId: album.albumId }, { maxAttempts: 5 });
        queued++;
      }
    return queued;
  });
}

// The one-time backfill (Option A in the v0.1 scope, an explicit exception
// to rule 5 that the admin starts): every album the baseline recorded as
// seen, and still pending, is looked up once, paced like any other.
export async function identifyBacklog(ctx, actor) {
  if (actor?.role !== "admin")
    throw new Error("MusicBrainz identification requires a current host admin");
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    return transaction(catalogue.db, () => {
      const jobs = new ModelJobs(catalogue);
      let queued = 0,
        tracks = 0;
      for (const album of pendingIdentification(catalogue)) {
        const prior = catalogue.db
          .prepare("SELECT json_extract(progress,'$.baseline') AS baseline FROM model_job WHERE key=? ORDER BY created_at DESC LIMIT 1")
          .get(album.key);
        // Already looked up (or queued): nothing to repeat.
        if (prior && !prior.baseline) continue;
        catalogue.db.prepare("DELETE FROM model_job WHERE key=? AND state='done' AND json_extract(progress,'$.baseline')=1").run(album.key);
        jobs.enqueue(IDENTIFY, album.key, { albumId: album.albumId, backfill: true }, { maxAttempts: 5 });
        catalogue.audit("work.identify_backlog", album.albumId, { tracks: album.tracks }, String(actor.id));
        queued++;
        tracks += album.tracks;
      }
      return { albums: queued, tracks };
    });
  } finally {
    catalogue.close();
  }
}

export function identificationStatus(catalogue) {
  const rows = catalogue.db
    .prepare(
      `SELECT state,json_extract(progress,'$.baseline') AS baseline,count(*) AS albums,
         coalesce(sum(json_extract(progress,'$.matched')),0) AS matched,coalesce(sum(json_extract(progress,'$.errors')),0) AS errors
       FROM model_job WHERE type=? AND key LIKE ? GROUP BY state,baseline`,
    )
    .all(IDENTIFY, `${IDENTIFY}:${RULES}:%`);
  const sum = (test, field = "albums") => rows.filter(test).reduce((total, row) => total + row[field], 0);
  return {
    queued: sum((row) => ["queued", "running", "retry"].includes(row.state)),
    done: sum((row) => row.state === "done" && !row.baseline),
    backlog: sum((row) => row.state === "done" && row.baseline),
    failed: sum((row) => row.state === "failed"),
    matched: sum(() => true, "matched"),
    errors: sum(() => true, "errors"),
  };
}

// Works an identification job: its album's pending tracks, one MusicBrainz
// lookup chain at a time, saving progress after each, so an interrupted run
// resumes where it stopped (and the disk cache makes repeats free). Then
// the album is matched with what MusicBrainz said. Further jobs follow
// while the budget lasts.
async function runIdentification(ctx, catalogue, jobs, first, owner, deadline) {
  for (let job = first; job; job = Date.now() < deadline ? jobs.claim(owner, { leaseMs: 60_000, type: IDENTIFY }) : null) {
    try {
      const { albumId } = job.input;
      const rows = catalogue.db
        .prepare(
          `SELECT t.id,t.evidence FROM track_link t JOIN classification c ON c.target_id=t.id AND c.state='classical'
           WHERE t.state='active' AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?
           AND NOT EXISTS(SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=t.id)
           ORDER BY t.id`,
        )
        .all(String(albumId));
      const progress = { cursor: 0, matches: [], failed: [], errors: 0, ...job.progress };
      const lookUp = async (row) => {
        const match = await identifyTrack(ctx, JSON.parse(row.evidence).hints || {});
        if (match) progress.matches.push([row.id, match]);
      };
      let streak = [];
      while (progress.cursor < rows.length) {
        if (Date.now() >= deadline) break;
        const row = rows[progress.cursor];
        try {
          await lookUp(row);
          streak = [];
        } catch (error) {
          streak.push(row.id);
          // MusicBrainz down: stop and try the album again later from the
          // first lookup that failed, instead of skipping those tracks.
          if (streak.length >= 3) {
            progress.cursor -= streak.length - 1;
            progress.failed = progress.failed.filter((id) => !streak.includes(id));
            jobs.checkpoint(job, progress, { leaseMs: 60_000 });
            throw new Error(`MusicBrainz unavailable: ${error.message}`);
          }
          progress.failed.push(row.id);
          ctx.log(`Classical work identification of one track failed: ${error.message}`);
        }
        progress.cursor++;
        jobs.checkpoint(job, progress, { leaseMs: 60_000 });
      }
      if (progress.cursor < rows.length) {
        jobs.yield(job);
        return;
      }
      // A lookup that failed on its own gets one more try.
      for (const id of progress.failed.splice(0)) {
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) continue;
        try {
          await lookUp(row);
        } catch (error) {
          progress.errors++;
          ctx.log(`Classical work identification skipped: ${error.message}`);
        }
      }
      const result = autoMatchTaggedWorks(catalogue, {
        albumId,
        actor: "model-identify",
        allowStructuredTitles: true,
        providerMatches: new Map(progress.matches),
      });
      jobs.checkpoint(job, { cursor: progress.cursor, identified: progress.matches.length, matched: result.created, errors: progress.errors }, { done: true, leaseMs: 60_000 });
    } catch (error) {
      jobs.fail(job, error.message);
      ctx.log(`Classical identification of album ${job.input.albumId} failed: ${error.message}`);
      return;
    }
  }
}

// File reads happen outside the writer transaction. Only a fenced checkpoint may publish them.
export async function runModelJobs(
  ctx,
  { budgetMs = 5000, batchSize = 200, checkpointMs = 10_000 } = {},
) {
  const catalogue = await openCatalogue(modelFolder(ctx));
  // Background work may wait for a page's or the editor's write; a minute,
  // not the 5 seconds a request on the plugin's own thread can afford.
  catalogue.db.exec("PRAGMA busy_timeout=60000");
  const jobs = new ModelJobs(catalogue),
    owner = randomUUID(),
    deadline = Date.now() + budgetMs;
  try {
    const job = jobs.claim(owner, { leaseMs: 60_000 });
    if (!job) return;
    if (job.type === IDENTIFY) return await runIdentification(ctx, catalogue, jobs, job, owner, deadline);
    try {
      if (job.type !== "library_scan")
        throw new Error("Unknown model job type");
      // A scan already runs off any page's clock, so it checks the database.
      verifyOnce(catalogue.db, catalogue.filename);
      const input = job.input;
      let cursor = job.progress.cursor || 0;
      // Evidence read so far: saved chunk by chunk (older scans kept it all
      // in progress.collected; that is saved again as the first chunk).
      let chunks = job.progress.chunks || 0;
      const legacy = job.progress.collected || [];
      const collected = [...legacy, ...jobs.chunks(job.id, chunks)];
      let saved = legacy.length ? 0 : collected.length;
      const save = (extra = {}) => {
        const items = collected.slice(saved);
        const ok = jobs.checkpoint(
          job,
          { cursor, chunks: chunks + (items.length && !extra.done ? 1 : 0), errors, errorCount, reused, total: input.files.length },
          { leaseMs: 60_000, chunk: { seq: chunks, items }, ...extra },
        );
        if (ok && items.length && !extra.done) {
          chunks++;
          saved = collected.length;
        }
        return ok;
      };
      const errors = job.progress.errors || [];
      let errorCount = job.progress.errorCount || 0;
      // Files an earlier scan read that were not opened again.
      let reused = job.progress.reused || 0;
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
            const evidence = await scanFile(file, root, prior);
            if (evidence[REUSED]) reused++;
            collected.push(evidence);
          } catch (error) {
            skip(file, error, prior);
          }
          // Tag reading is synchronous; let album pages and the editor get
          // answers between files instead of waiting behind the whole scan.
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (!save()) return;
        if (cancelled) break;
      }
      const done = cursor === input.files.length;
      const committed = save({
          done,
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
                // The same tag and title rules as Auto-match every album, with
                // no network. Then MusicBrainz is asked, in the background,
                // only about albums whose unmatched tracks changed.
                autoMatchTaggedWorks(catalogue, { actor: "model-scan", allowStructuredTitles: true });
                queueAlbumIdentification(catalogue);
              }
            : undefined,
      });
      if (committed && !done) jobs.yield(job);
    } catch (error) {
      jobs.fail(job, error.message);
      throw error;
    }
  } finally {
    catalogue.close();
  }
}

// An arrangement ("arr. Daniil Trifonov for piano") is a work of its own on
// MusicBrainz, linked to the movement it arranges instead of to a parent.
// Matching follows that link once, so the recording joins the original work.
async function arrangedWork(mb, work, inc) {
  const relations = work?.relations || [];
  if (relations.some((rel) => rel.type === "parts" && rel.direction === "backward")) return work;
  const originals = relations.filter(
    (rel) => rel.type === "arrangement" && rel.direction === "backward" && rel.work?.id,
  );
  if (originals.length !== 1) return work;
  return (await mb.get("work", originals[0].work.id, inc)) || work;
}

// MusicBrainz's work for one unmatched track, from its WORK ID tag or its
// recording ID: the parent work (or the work itself, when it is a whole
// piece), its English title, aliases and composers' IDs. Null when there
// is none. Every request goes through the shared throttle and disk cache.
async function identifyTrack(ctx, hints) {
  let workId = hints.workId;
  let composers = hints.composer || [];
  if (!workId && hints.recordingMbid) {
    const fields = await ctx.resolver.resolve(hints.recordingMbid, {
      confirmed: true,
    });
    workId = fields?.workId;
    if (!composers.length) composers = fields?.composers || [];
  }
  if (!workId) return null;
  // Aliases come in the same requests, for English titles.
  const inc = "aliases+artist-rels+work-rels";
  const leaf = await arrangedWork(ctx.mb, await ctx.mb.get("work", workId, inc), inc);
  // A book of a set (Debussy's "Préludes, Livre I") is the work, not
  // the set above it: stop below a set-named parent once the work has
  // parts of its own.
  const hasParts = (work) => (work.relations || []).some((rel) => rel.type === "parts" && rel.direction === "forward");
  const parent = leaf && (await topWork(ctx.mb, leaf, 0, inc, { stop: (above, below) => isCollectionLike(above.title) && hasParts(below) }));
  // A work with no parent is a whole piece only when the track's own
  // title reads as one, not as a movement of something MusicBrainz
  // hasn't linked up.
  // A title's head naming this very work by its number, with a tempo or
  // nickname after it, is the whole of a work in one movement: Scriabin's
  // "Piano Sonata no. 7, op. 64 "Messe blanche": Allegro", which MusicBrainz
  // knows as a work with no parts.
  const title = withoutComposer(hints.title, hints.composer);
  const headSubject = catalogueSubject(titleHead(title) || "");
  const namesThisWork = Boolean(headSubject) && headSubject === catalogueSubject(leaf?.title || "");
  const standalone =
    parent?.id === leaf.id &&
    !(leaf.relations || []).some((rel) => rel.type === "parts" && rel.direction === "backward") &&
    !isCollectionLike(leaf.title) &&
    (!String(title).includes(":") || (namesThisWork && !hasParts(leaf))) &&
    !/^(?:[IVXLCDM]+|\d+)[.)]\s/i.test(String(title).trim());
  // A set MusicBrainz identifies is a work like any other; only a
  // free-text set name in the tags ("Études") is too loose to be one.
  if (!parent?.id || (parent.id === leaf.id && !standalone)) return null;
  return {
    workId: parent.id,
    work: englishTitle(parent),
    movement: standalone ? null : englishTitle(leaf, null),
    ...(standalone && { standalone: true }),
    aliases: [
      ...new Set(
        (parent.aliases || [])
          .filter((alias) => alias.name && alias.type !== "Search hint")
          .map((alias) => alias.name)
          .filter((name) => name !== englishTitle(parent)),
      ),
    ].slice(0, 20),
    composers,
    // MusicBrainz's own composer IDs tell same-named people apart.
    composerIds: Object.fromEntries(
      [...(parent.relations || []), ...(leaf.relations || [])]
        .filter((rel) => rel.type === "composer" && rel.artist?.id && rel.artist?.name)
        .map((rel) => [rel.artist.name, rel.artist.id]),
    ),
  };
}

export async function autoMatchWorks(ctx, actor, albumId = null) {
  if (actor?.role !== "admin")
    throw new Error("Automatic work matching requires a current host admin");
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    const local = autoMatchTaggedWorks(catalogue, {
      albumId,
      actor: String(actor.id),
      // Structured classical titles count, as they do after every scan.
      allowStructuredTitles: true,
    });
    const providerMatches = new Map();
    const rows = catalogue.db
      .prepare(
        `SELECT t.id,t.evidence FROM track_link t
         JOIN classification c ON c.target_id=t.id AND c.state='classical'
         WHERE t.state='active'
         AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?
         AND NOT EXISTS(SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=t.id)`,
      )
      .all(String(albumId));
    for (const row of rows) {
      const hints = JSON.parse(row.evidence).hints || {};
      try {
        const match = await identifyTrack(ctx, hints);
        if (match) providerMatches.set(row.id, match);
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

// Auto-match for every album at once, from tags and titles only. MusicBrainz
// is asked only about what changed, by `queueAlbumIdentification` after a
// scan: a lookup for every track of a library is the kind of load the
// shared service can't take.
export async function autoMatchLibrary(ctx, actor) {
  if (actor?.role !== "admin")
    throw new Error("Automatic work matching requires a current host admin");
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    const albums = catalogue.db
      .prepare(
        `SELECT DISTINCT CAST(json_extract(t.evidence,'$.albumId') AS TEXT) AS id FROM track_link t
         JOIN classification c ON c.target_id=t.id AND c.state='classical'
         WHERE t.state='active' AND json_extract(t.evidence,'$.albumId') IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=t.id)`,
      )
      .all()
      .map((row) => row.id);
    let created = 0;
    for (const albumId of albums)
      created += autoMatchTaggedWorks(catalogue, { albumId, actor: String(actor.id), allowStructuredTitles: true }).created;
    return { albums: albums.length, created };
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
