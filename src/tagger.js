// Tagging: a queue of files in dataFolder, worked through by whichever plugin
// process holds the lock, plus a scan of the Library for classical files no
// one queued (Lidarr imports, files added by hand).
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isAudioPath, readTags, readValues, UnsupportedFormat, writeTags } from "./tags.js";
import { creditString, RELEASE_INC } from "./works.js";
import { Aurral } from "./aurral.js";
import { readJson, sleep, tryLock, writeJson } from "./store.js";

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
export const TAG_FIELDS = ["artist", "albumArtist", "composer", "work", "workId"];
// Raised when the plugin writes more than before, so files it already
// tagged are tagged once more by the schedule (2: the album artist).
const TAGGING_VERSION = 2;
const outdated = (record) => record && (record.status === "tagged" || record.status === "unchanged") && (record.v ?? 1) < TAGGING_VERSION;
const lockDir = (ctx) => path.join(ctx.dataFolder, "tagging.lock");
// Left by an admin action waiting for the lock: background work stops at the
// next file and picks up later.
const yieldFile = (ctx) => path.join(ctx.dataFolder, "tagging.yield");
const YIELD_FRESH_MS = 10 * 60_000;
const PRIORITY_WAIT_MS = 5 * 60_000;
const ACTION_CLAIM_MS = 2 * 60_000;

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

// What a process holds while it has the tagging lock. Every tagging call in
// the process shares it: an admin action that comes while another runs
// works alongside it instead of waiting.
class State {
  constructor(ctx, lock) {
    this.ctx = ctx;
    this.lock = lock;
    this.dirty = 0;
    this.savedAt = Date.now();
    this.refs = 0;
    this.admins = 0;
    this.background = 0;
    this.claimed = new Set();
    this.busyPaths = new Map();
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
    this.dirty = 0;
    await writeJson(processedFile(this.ctx), this.processed);
    await writeJson(indexFile(this.ctx), this.index);
    await writeJson(originalsFile(this.ctx), this.originals);
    await writeJson(excludedFile(this.ctx), this.excluded);
    await this.lock.touch();
  }

  // One call at a time works on a file.
  async exclusive(file, work) {
    while (this.busyPaths.has(file)) await this.busyPaths.get(file).catch(() => {});
    const running = work();
    this.busyPaths.set(file, running);
    try {
      return await running;
    } finally {
      this.busyPaths.delete(file);
    }
  }
}

// One tagging call: its own counts, on the shared state.
class Session {
  constructor(ctx, state, priority) {
    this.ctx = ctx;
    this.state = state;
    this.priority = priority;
    this.changedFiles = 0;
    this.stats = { tagged: 0, unchanged: 0, skipped: {}, failed: 0, left: 0 };
  }

  get processed() {
    return this.state.processed;
  }
  get index() {
    return this.state.index;
  }
  get originals() {
    return this.state.originals;
  }
  get excluded() {
    return this.state.excluded;
  }
  get dirty() {
    return this.state.dirty;
  }
  set dirty(value) {
    this.state.dirty = value;
  }
  save(force = false) {
    return this.state.save(force);
  }

  // True when an admin action wants the lock and this is background work:
  // one in this process, or one waiting in another.
  async shouldYield() {
    if (this.priority) return false;
    if (this.state.admins > 0) this.yielding = true;
    else if (!this.yieldCheckedAt || Date.now() - this.yieldCheckedAt >= 500) {
      this.yieldCheckedAt = Date.now();
      const stat = await fs.stat(yieldFile(this.ctx)).catch(() => null);
      this.yielding = Boolean(stat && Date.now() - stat.mtimeMs < YIELD_FRESH_MS);
    }
    if (this.yielding && !this.yieldLogged) {
      this.yieldLogged = true;
      this.ctx.log("Pausing background tagging for an admin action");
    }
    return this.yielding;
  }

  record(filePath, stat, result) {
    this.processed[filePath] = { ...statKey(stat), ...result, at: Date.now() };
    this.dirty++;
    if (result.status === "skipped") this.stats.skipped[result.reason] = (this.stats.skipped[result.reason] || 0) + 1;
    else this.stats[result.status]++;
  }

  // Returns false when MusicBrainz can't be reached, so the caller stops.
  async processFile(filePath, options = {}) {
    const real = await allowedPath(this.ctx, filePath);
    if (!real) {
      this.ctx.log(`Not tagging ${filePath}: it isn't in the Library folder`);
      this.stats.skipped["outside the Library"] = (this.stats.skipped["outside the Library"] || 0) + 1;
      return true;
    }
    if (!isAudioPath(real)) return true;
    return this.state.exclusive(real, () => this.processReal(real, options));
  }

  // `queuedAt`: when the request to tag was made. Classical tags an admin
  // removed after that stay removed.
  async processReal(real, { force = false, prefilter = false, upgrade = false, queuedAt = null } = {}) {
    const { ctx } = this;
    const stat = await fs.stat(real);
    if (!force && sameStat(this.processed[real], stat) && !(upgrade && outdated(this.processed[real]))) return true;
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
      if (!force || (queuedAt && (this.excluded[tags.recordingMbid].at ?? 0) > queuedAt)) {
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
    // Aurral files an album under one album artist and names it after the
    // album artist tag. That name in English, as in the artist tag; albums
    // credited to several artists (as beets tags them) are left as they are.
    const albumArtist = await this.englishAlbumArtist(tags);
    if (albumArtist) values.albumArtist = [albumArtist];
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
      v: TAGGING_VERSION,
      status: changed.length ? "tagged" : "unchanged",
      recording: tags.recordingMbid,
      artist: fields.artist,
      workId: fields.workId,
    });
    if (changed.length) {
      this.changedFiles++;
      ctx.log(`Tagged ${path.basename(real)}: ${fields.artist}`);
    }
    return true;
  }

  // Puts back the tags a file had before the plugin changed them. Files
  // tagged before the plugin kept backups get the artist MusicBrainz credits
  // for that track on its release, which is what Aurral writes.
  async untagFile(filePath) {
    const real = await allowedPath(this.ctx, filePath);
    if (!real || !isAudioPath(real)) return "skipped";
    return this.state.exclusive(real, () => this.untagReal(real));
  }

  async untagReal(real) {
    const { ctx } = this;
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
      if (tags.albumArtistMbids.length === 1) {
        const name = (await ctx.mb.get("artist", tags.albumArtistMbids[0], "aliases+genres"))?.name;
        if (name) values.albumArtist = [name];
      }
    }
    const changed = await writeTags(real, values);
    delete this.originals[real];
    const after = await fs.stat(real);
    this.index[real] = { ...(this.index[real] ?? {}), ...indexEntry(readTags(real), after) };
    this.record(real, after, { status: "skipped", reason: "classical tags removed", recording: tags.recordingMbid });
    this.stats.skipped["classical tags removed"]--;
    if (changed.length) {
      this.changedFiles++;
      ctx.log(`Removed classical tags from ${path.basename(real)}`);
    }
    return changed.length ? "restored" : "unchanged";
  }

  async englishAlbumArtist(tags) {
    if (tags.albumArtistMbids.length !== 1) return null;
    const artist = await this.ctx.resolver.getArtist(tags.albumArtistMbids[0]);
    if (!artist?.name) return null;
    const [name] = await this.ctx.resolver.englishNames(artist);
    return name || null;
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
      if (Date.now() > until || (await this.shouldYield())) return false;
      if (onlyIds && !onlyIds.has(entry.name.replace(/\.json$/, ""))) continue;
      // Another call in this process has it.
      if (this.state.claimed.has(entry.name)) continue;
      this.state.claimed.add(entry.name);
      try {
        const job = await readJson(entry.file, null);
        // An admin action tags the files it queued itself.
        if (!this.priority && job?.source === "action" && Date.now() - (job.at || 0) < ACTION_CLAIM_MS) continue;
        if (job?.path) {
          const reachable = await this.processFile(job.path, { force: job.force, queuedAt: job.at });
          if (!reachable) return false;
        }
        await fs.rm(entry.file, { force: true });
      } finally {
        this.state.claimed.delete(entry.name);
      }
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
      if (Date.now() > until || (await this.shouldYield())) {
        complete = false;
        return;
      }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (Date.now() > until || (await this.shouldYield())) {
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
          if (this.index[full].recordingMbid && (!sameStat(this.processed[full], stat) || outdated(this.processed[full]))) pending.push(full);
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

// The state this process holds the lock for, by data folder.
const held = new Map();

async function openState(ctx, priority) {
  let lock = await tryLock(lockDir(ctx), LOCK_STALE_MS);
  if (!lock && priority) {
    // Another Aurral process has it (Aurral runs schedules, downloads and
    // actions in separate processes). Its background work stops at the
    // next file when it sees this file.
    ctx.log("Waiting for background tagging in another process to pause");
    const until = Date.now() + PRIORITY_WAIT_MS;
    while (!lock && Date.now() < until) {
      await writeJson(yieldFile(ctx), { at: Date.now() });
      await sleep(500);
      lock = await tryLock(lockDir(ctx), LOCK_STALE_MS);
    }
    await fs.rm(yieldFile(ctx), { force: true });
    if (!lock) ctx.log("Tagging in another process didn't pause within 5 minutes");
  }
  if (!lock) return null;
  const state = new State(ctx, lock);
  try {
    await state.load();
  } catch (error) {
    await lock.release();
    throw error;
  }
  state.heartbeat = setInterval(() => lock.touch(), 30_000);
  return state;
}

// Runs `work` with the tagging state, or returns null when it's busy:
// another process holds the lock, or (for background work) other
// background work in this process is running. Admin actions (`priority`)
// join whatever runs in this process, and wait for another process's
// background work to pause.
export async function withTagging(ctx, work, { priority = false } = {}) {
  const key = path.resolve(ctx.dataFolder);
  let entry;
  for (;;) {
    entry = held.get(key);
    if (!entry) {
      entry = { opening: openState(ctx, priority), state: null };
      held.set(key, entry);
      try {
        entry.state = await entry.opening;
      } catch (error) {
        held.delete(key);
        throw error;
      }
      if (!entry.state) {
        held.delete(key);
        return null;
      }
      break;
    }
    if (!entry.state) {
      // Being opened by another call.
      if (!priority) return null;
      await entry.opening.catch(() => {});
      if (held.get(key) === entry && entry.state) break;
      continue;
    }
    if (!priority && entry.state.background > 0) return null;
    break;
  }
  const { state } = entry;
  const session = new Session(ctx, state, priority);
  state.refs++;
  if (priority) state.admins++;
  else state.background++;
  try {
    await work(session);
    return session.stats;
  } finally {
    if (priority) state.admins--;
    else state.background--;
    if (--state.refs === 0) {
      held.delete(key);
      clearInterval(state.heartbeat);
      await state.save(true).catch((error) => ctx.log(`Couldn't save progress: ${error.message}`));
      await state.lock.release();
    } else {
      await state.save().catch(() => {});
    }
    if (session.changedFiles) await refreshLibrary(ctx);
  }
}

// Aurral read the files before the plugin changed their tags. A quick
// Library scan reads the changed ones again, so the Library shows the new
// artist. Needs the plugin's Aurral API access.
async function refreshLibrary(ctx) {
  if (!ctx.api?.url || !ctx.api?.key) return;
  try {
    await new Aurral(ctx.api, ctx.fetch).refreshLibrary();
  } catch (error) {
    ctx.log(`Couldn't ask Aurral to rescan the Library: ${error.message}`);
  }
}

export async function runQueue(ctx, budgetMs, onlyIds = null, { priority = false } = {}) {
  const until = Date.now() + budgetMs;
  return withTagging(
    ctx,
    async (session) => {
      await session.drainQueue(until, onlyIds);
      session.stats.left = onlyIds
        ? (await queuedEntries(ctx)).filter((e) => onlyIds.has(e.name.replace(/\.json$/, ""))).length
        : await queueLength(ctx);
    },
    { priority },
  );
}

// The schedule: the queue first, then the Library scan.
export async function runScheduled(ctx, budgetMs) {
  const until = Date.now() + budgetMs;
  return withTagging(ctx, async (session) => {
    if (!(await session.drainQueue(until))) return;
    const pending = await session.scan(until);
    session.stats.found = pending.length;
    for (const file of pending) {
      if (Date.now() > until || (await session.shouldYield())) break;
      if (!(await session.processFile(file, { prefilter: true, upgrade: true }))) break;
      await session.save();
    }
    session.stats.left = (await queueLength(ctx)) + pending.filter((f) => !session.processed[f]).length;
  });
}

// Library files from the index, refreshed first.
export async function libraryIndex(ctx, budgetMs, { priority = false } = {}) {
  let index = null;
  await withTagging(
    ctx,
    async (session) => {
      await session.scan(Date.now() + budgetMs);
      index = session.index;
    },
    { priority },
  );
  return index ?? (await readJson(indexFile(ctx), {}));
}

export async function untagFiles(ctx, paths, budgetMs, { priority = false } = {}) {
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
  }, { priority });
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
