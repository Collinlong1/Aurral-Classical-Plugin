// Files in dataFolder. Aurral runs a copy of the plugin in each of its
// processes (the app, the downloads worker, the maintenance worker), so
// anything shared goes through files, written atomically, and locks are
// directories (mkdir is atomic).
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value));
  await fs.rename(temp, file);
}

// A lock held by one process at a time. `staleMs` frees a lock whose holder
// died: the holder refreshes the directory's mtime while it works.
export async function tryLock(dir, staleMs) {
  try {
    await fs.mkdir(dir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.stat(dir).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs < staleMs) return null;
    await fs.rm(dir, { recursive: true, force: true });
    try {
      await fs.mkdir(dir);
    } catch {
      return null;
    }
  }
  let released = false;
  return {
    async touch() {
      if (released) return;
      const now = new Date();
      await fs.utimes(dir, now, now).catch(() => {});
    },
    async release() {
      released = true;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function withLock(dir, staleMs, run, { waitMs = 30_000 } = {}) {
  const until = Date.now() + waitMs;
  for (;;) {
    const lock = await tryLock(dir, staleMs);
    if (lock) {
      try {
        return await run(lock);
      } finally {
        await lock.release();
      }
    }
    if (Date.now() > until) throw new Error(`Timed out waiting for ${path.basename(dir)}`);
    await sleep(50 + Math.random() * 100);
  }
}

// One request per interval across every process of the plugin.
export class Throttle {
  constructor(folder, intervalMs) {
    this.lockDir = path.join(folder, "mb-throttle.lock");
    this.stateFile = path.join(folder, "mb-throttle.json");
    this.intervalMs = intervalMs;
  }

  async wait() {
    if (!this.intervalMs) return;
    const slot = await withLock(this.lockDir, 5_000, async () => {
      const state = await readJson(this.stateFile, { next: 0 });
      const at = Math.max(Date.now(), Number(state.next) || 0);
      await writeJson(this.stateFile, { next: at + this.intervalMs });
      return at;
    });
    const wait = slot - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

// One JSON file per entry, so processes never fight over one big file.
export class FileCache {
  constructor(folder) {
    this.folder = folder;
  }

  file(key) {
    const hash = createHash("sha1").update(key).digest("hex");
    return path.join(this.folder, hash.slice(0, 2), `${hash}.json`);
  }

  async get(key, ttlMs) {
    const entry = await readJson(this.file(key), null);
    if (!entry || Date.now() - entry.time > ttlMs) return null;
    return entry.value;
  }

  async set(key, value) {
    await writeJson(this.file(key), { time: Date.now(), key, value }).catch(() => {});
  }
}

// Deletes cache files older than maxAgeMs, at most once a day.
export async function pruneCache(folder, maxAgeMs) {
  const stamp = path.join(folder, ".pruned");
  const last = (await fs.stat(stamp).catch(() => null))?.mtimeMs ?? 0;
  if (Date.now() - last < 24 * 60 * 60_000) return 0;
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(stamp, "");
  let removed = 0;
  for (const dir of await fs.readdir(folder).catch(() => [])) {
    const sub = path.join(folder, dir);
    for (const name of await fs.readdir(sub).catch(() => [])) {
      const file = path.join(sub, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > maxAgeMs) {
        await fs.rm(file, { force: true });
        removed++;
      }
    }
  }
  return removed;
}
