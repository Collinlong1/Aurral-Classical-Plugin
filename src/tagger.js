// Tagging: a queue of files in dataFolder, worked through by whichever plugin
// process holds the lock, plus a scan of the Library for classical files no
// one queued (Lidarr imports, files added by hand).
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isAudioPath, readTags, readValues, UnsupportedFormat, writeTags } from "./tags.js";
import { creditString, RELEASE_INC } from "./works.js";
import { readJson, tryLock, writeJson } from "./store.js";

const LOCK_STALE_MS = 2 * 60_000;
const SAVE_EVERY_MS = 30_000;

export const queueDir = (ctx) => path.join(ctx.dataFolder, "queue");
const processedFile = (ctx) => path.join(ctx.dataFolder, "processed.json");
const indexFile = (ctx) => path.join(ctx.dataFolder, "library-index.json");
// Each file's tags before the plugin first changed them.
const originalsFile = (ctx) => path.join(ctx.dataFolder, "originals.json");
// Recordings whose classical tags an admin removed: never tagged again
// unless an admin tags them as classical.
const excludedFile = (ctx) => path.join(ctx.dataFolder, "excluded.json");
export const TAG_FIELDS = ["artist", "composer", "work", "workId"];
const lockDir = (ctx) => path.join(ctx.dataFolder, "tagging.lock");

export async function enqueue(ctx, filePaths, { force = false, source = null } = {}) {
  await fs.mkdir(queueDir(ctx), { recursive: true });
  const ids = [];
  for (const filePath of filePaths) {
    if (!filePath) continue;
    const id = `${Date.now().toString().padStart(15, "0")}-${randomUUID()}`;
    await writeJson(path.join(queueDir(ctx), `${id}.json`), { path: filePath, force, source, at: Date.now() });
    ids.push(id);
  }
  return ids;
}

async function queuedEntries(ctx) {
  const names = (await fs.readdir(queueDir(ctx)).catch(() => [])).filter((n) => n.endsWith(".json")).sort();
  return names.map((name) => ({ name, file: path.join(queueDir(ctx), name) }));
}

export const queueLength = async (ctx) => (await queuedEntries(ctx)).length;

// Only files in the Library or the plugin's own folder are ever written.
async function allowedPath(ctx, filePath) {
  const real = await fs.realpath(filePath).catch(() => null);
  if (!real) return null;
  for (const root of [ctx.libraryFolder, ctx.dataFolder]) {
    if (!root) continue;
    const base = await fs.realpath(root).catch(() => null);
    if (!base) continue;
    const relative = path.relative(base, real);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return real;
  }
  return null;
}

const statKey = (stat) => ({ mtimeMs: Math.round(stat.mtimeMs), size: stat.size });
const sameStat = (record, stat) => record && record.mtimeMs === Math.round(stat.mtimeMs) && record.size === stat.size;

function indexEntry(tags, stat) {
  return {
    ...statKey(stat),
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    albumArtist: tags.albumArtist,
    recordingMbid: tags.recordingMbid,
    releaseMbid: tags.releaseMbid,
    releaseGroupMbid: tags.releaseGroupMbid,
    albumArtistMbids: tags.albumArtistMbids,
    trackNumber: tags.trackNumber,
    discNumber: tags.discNumber,
    durationMs: tags.durationMs,
    workId: tags.workId,
  };
}

// The shared state a worker holds while it has the lock.
class Session {
  constructor(ctx, lock) {
    this.ctx = ctx;
    this.lock = lock;
    this.dirty = 0;
    this.savedAt = Date.now();
    this.stats = { tagged: 0, unchanged: 0, skipped: {}, failed: 0, left: 0 };
  }

  async load() {
    this.processed = await readJson(processedFile(this.ctx), {});
    this.index = await readJson(indexFile(this.ctx), {});
    this.originals = await readJson(originalsFile(this.ctx), {});
    this.excluded = await readJson(excludedFile(this.ctx), {});
  }

  // Saved every 30 seconds while working, and at the end: the index of a
  // large Library is several megabytes.
  async save(force = false) {
    if (!this.dirty || (!force && Date.now() - this.savedAt < SAVE_EVERY_MS)) return;
    this.savedAt = Date.now();
    await writeJson(processedFile(this.ctx), this.processed);
    await writeJson(indexFile(this.ctx), this.index);
    await writeJson(originalsFile(this.ctx), this.originals);
    await writeJson(excludedFile(this.ctx), this.excluded);
    this.dirty = 0;
    await this.lock.touch();
  }

  record(filePath, stat, result) {
    this.processed[filePath] = { ...statKey(stat), ...result, at: Date.now() };
    this.dirty++;
    if (result.status === "skipped") this.stats.skipped[result.reason] = (this.stats.skipped[result.reason] || 0) + 1;
    else this.stats[result.status]++;
  }

  // Returns false when MusicBrainz can't be reached, so the caller stops.
  async processFile(filePath, { force = false, prefilter = false } = {}) {
    const { ctx } = this;
    const real = await allowedPath(ctx, filePath);
    if (!real) {
      ctx.log(`Not tagging ${filePath}: it isn't in the Library folder`);
      this.stats.skipped["outside the Library"] = (this.stats.skipped["outside the Library"] || 0) + 1;
      return true;
    }
    if (!isAudioPath(real)) return true;
    const stat = await fs.stat(real);
    if (!force && sameStat(this.processed[real], stat)) return true;
    let tags;
    try {
      tags = readTags(real);
    } catch (error) {
      this.record(real, stat, { status: "skipped", reason: error instanceof UnsupportedFormat ? "unsupported format" : "unreadable" });
      return true;
    }
    this.index[real] = indexEntry(tags, stat);
    if (!tags.recordingMbid) {
      this.record(real, stat, { status: "skipped", reason: "no recording ID" });
      return true;
    }
    if (this.excluded[tags.recordingMbid]) {
      if (!force) {
        this.record(real, stat, { status: "skipped", reason: "classical tags removed", recording: tags.recordingMbid });
        return true;
      }
      delete this.excluded[tags.recordingMbid];
    }
    // Scanned files whose own genre tags say "not classical" skip the
    // lookups. Aurral writes the album's MusicBrainz genres to its files.
    if (prefilter && ctx.resolver.classifyGenres(new Set(tags.genres.map((g) => g.toLowerCase()))) === false) {
      this.record(real, stat, { status: "skipped", reason: "non-classical", recording: tags.recordingMbid });
      return true;
    }
    const fields = await ctx.resolver.resolve(tags.recordingMbid, {
      trackArtistIds: tags.artistMbids,
      albumArtistIds: tags.albumArtistMbids,
      releaseGroupId: tags.releaseGroupMbid || null,
      confirmed: force,
    });
    if (!fields) {
      const reason = ctx.resolver.skipReason;
      if (reason === "unreachable") return false;
      this.record(real, stat, { status: "skipped", reason, recording: tags.recordingMbid });
      return true;
    }
    const values = { artist: [fields.artist], composer: fields.composers };
    if (fields.workId) Object.assign(values, { work: [fields.work], workId: [fields.workId] });
    let changed;
    try {
      if (!this.originals[real]) {
        this.originals[real] = { ...readValues(real, TAG_FIELDS), recording: tags.recordingMbid };
        this.dirty++;
      }
      changed = await writeTags(real, values);
    } catch (error) {
      ctx.log(`Couldn't tag ${real}: ${error.message}`);
      this.record(real, stat, { status: "skipped", reason: "couldn't write tags", recording: tags.recordingMbid });
      return true;
    }
    const after = await fs.stat(real);
    this.index[real] = { ...this.index[real], ...statKey(after), artist: fields.artist, workId: fields.workId || "" };
    this.record(real, after, {
      status: changed.length ? "tagged" : "unchanged",
      recording: tags.recordingMbid,
      artist: fields.artist,
      workId: fields.workId,
    });
    if (changed.length) ctx.log(`Tagged ${path.basename(real)}: ${fields.artist}`);
    return true;
  }

  // Puts back the tags a file had before the plugin changed them. Files
  // tagged before the plugin kept backups get the artist MusicBrainz credits
  // for that track on its release, which is what Aurral writes.
  async untagFile(filePath) {
    const { ctx } = this;
    const real = await allowedPath(ctx, filePath);
    if (!real || !isAudioPath(real)) return "skipped";
    let tags;
    try {
      tags = readTags(real);
    } catch {
      return "skipped";
    }
    if (tags.recordingMbid) this.excluded[tags.recordingMbid] = { at: Date.now() };
    const original = this.originals[real];
    let values;
    if (original) values = Object.fromEntries(TAG_FIELDS.map((field) => [field, original[field] ?? []]));
    else {
      const credit = await this.trackCredit(tags);
      if (!credit) return "no backup";
      values = { artist: [credit] };
    }
    const changed = await writeTags(real, values);
    delete this.originals[real];
    const after = await fs.stat(real);
    this.index[real] = { ...(this.index[real] ?? {}), ...indexEntry(readTags(real), after) };
    this.record(real, after, { status: "skipped", reason: "classical tags removed", recording: tags.recordingMbid });
    this.stats.skipped["classical tags removed"]--;
    if (changed.length) ctx.log(`Removed classical tags from ${path.basename(real)}`);
    return changed.length ? "restored" : "unchanged";
  }

  // MusicBrainz's artist credit for this recording on the file's release,
  // else on the recording itself.
  async trackCredit(tags) {
    const { mb } = this.ctx;
    if (tags.releaseMbid) {
      const release = await mb.get("release", tags.releaseMbid, RELEASE_INC);
      for (const medium of release?.media || [])
        for (const track of medium.tracks || [])
          if (track.recording?.id === tags.recordingMbid) {
            const credit = creditString(track["artist-credit"] || track.recording["artist-credit"]);
            if (credit) return credit;
          }
    }
    const recording = await mb.get("recording", tags.recordingMbid, "artist-credits");
    return creditString(recording?.["artist-credit"]) || null;
  }

  async drainQueue(until, onlyIds = null) {
    for (const entry of await queuedEntries(this.ctx)) {
      if (Date.now() > until) return false;
      if (onlyIds && !onlyIds.has(entry.name.replace(/\.json$/, ""))) continue;
      const job = await readJson(entry.file, null);
      if (job?.path) {
        const reachable = await this.processFile(job.path, { force: job.force });
        if (!reachable) return false;
      }
      await fs.rm(entry.file, { force: true });
      await this.save();
    }
    return true;
  }

  // Walks the Library, refreshing the index, and returns files that have a
  // recording ID and were never processed (or changed since). Stops at
  // `until`; unchanged files cost only a stat, so the next run gets further.
  async scan(until) {
    const root = this.ctx.libraryFolder;
    const pending = [];
    const seen = new Set();
    let complete = true;
    const walk = async (dir) => {
      if (Date.now() > until) {
        complete = false;
        return;
      }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (Date.now() > until) {
          complete = false;
          return;
        }
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && isAudioPath(full)) {
          seen.add(full);
          const stat = await fs.stat(full).catch(() => null);
          if (!stat) continue;
          if (!sameStat(this.index[full], stat)) {
            try {
              this.index[full] = indexEntry(readTags(full), stat);
            } catch {
              delete this.index[full];
              continue;
            }
            this.dirty++;
            await this.save();
          }
          if (this.index[full].recordingMbid && !sameStat(this.processed[full], stat)) pending.push(full);
        }
      }
    };
    if (root) await walk(root);
    // Files that left the Library leave the index, once a walk finishes.
    if (complete)
      for (const file of Object.keys(this.index)) if (file.startsWith(root) && !seen.has(file)) delete this.index[file];
    this.scanComplete = complete;
    return pending;
  }
}

// Runs `work` while holding the tagging lock, or returns null if another
// process has it.
export async function withTagging(ctx, work) {
  const lock = await tryLock(lockDir(ctx), LOCK_STALE_MS);
  if (!lock) return null;
  const heartbeat = setInterval(() => lock.touch(), 30_000);
  const session = new Session(ctx, lock);
  try {
    await session.load();
    await work(session);
    return session.stats;
  } finally {
    clearInterval(heartbeat);
    await session.save(true).catch((error) => ctx.log(`Couldn't save progress: ${error.message}`));
    await lock.release();
  }
}

export async function runQueue(ctx, budgetMs, onlyIds = null) {
  const until = Date.now() + budgetMs;
  return withTagging(ctx, async (session) => {
    await session.drainQueue(until, onlyIds);
    session.stats.left = await queueLength(ctx);
  });
}

// The schedule: the queue first, then the Library scan.
export async function runScheduled(ctx, budgetMs) {
  const until = Date.now() + budgetMs;
  return withTagging(ctx, async (session) => {
    if (!(await session.drainQueue(until))) return;
    const pending = await session.scan(until);
    session.stats.found = pending.length;
    for (const file of pending) {
      if (Date.now() > until) break;
      if (!(await session.processFile(file, { prefilter: true }))) break;
      await session.save();
    }
    session.stats.left = (await queueLength(ctx)) + pending.filter((f) => !session.processed[f]).length;
  });
}

// Library files from the index, refreshed first.
export async function libraryIndex(ctx, budgetMs) {
  let index = null;
  await withTagging(ctx, async (session) => {
    await session.scan(Date.now() + budgetMs);
    index = session.index;
  });
  return index ?? (await readJson(indexFile(ctx), {}));
}

export async function untagFiles(ctx, paths, budgetMs) {
  const until = Date.now() + budgetMs;
  const counts = { restored: 0, unchanged: 0, "no backup": 0, skipped: 0, left: 0 };
  const stats = await withTagging(ctx, async (session) => {
    for (const file of paths) {
      if (Date.now() > until) {
        counts.left++;
        continue;
      }
      try {
        counts[await session.untagFile(file)]++;
      } catch (error) {
        ctx.log(`Couldn't remove classical tags from ${file}: ${error.message}`);
        counts.skipped++;
      }
    }
  });
  return stats ? counts : null;
}

export const readProcessed = (ctx) => readJson(processedFile(ctx), {});
export const readIndex = (ctx) => readJson(indexFile(ctx), {});

export function describeStats(stats) {
  if (!stats) return "Another tagging run is in progress";
  const parts = [`${stats.tagged} tagged`];
  if (stats.unchanged) parts.push(`${stats.unchanged} already right`);
  for (const [reason, count] of Object.entries(stats.skipped)) parts.push(`${count} skipped (${reason})`);
  if (stats.failed) parts.push(`${stats.failed} failed`);
  if (stats.left) parts.push(`${stats.left} left for the next run`);
  return parts.join(", ");
}
