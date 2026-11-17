import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { migrations as shippedMigrations } from "./schema.js";

export const SCHEMA_VERSION = 5;

export function validateDatabase(db) {
  if (
    db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    throw new Error("Classical database integrity check failed");
}

// Native SQLite online backup includes WAL contents. Never copy a live .sqlite file.
export async function backupDatabase(db, destination) {
  const { backup } = await import("node:sqlite");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await backup(db, temporary);
    const { DatabaseSync } = await import("node:sqlite");
    const check = new DatabaseSync(temporary, { readOnly: true });
    try {
      validateDatabase(check);
    } finally {
      check.close();
    }
    await fs.rename(temporary, destination);
  } finally {
    // The check above opens the copy, which leaves SQLite sidecar files
    // under the temporary name.
    for (const file of [temporary, `${temporary}-wal`, `${temporary}-shm`]) await fs.rm(file, { force: true });
  }
  return destination;
}

// Offline operation only: caller must stop every plugin process first.
export async function restoreDatabase(
  backupFile,
  databaseFile,
  { offline = false, maxVersion = SCHEMA_VERSION } = {},
) {
  if (!offline)
    throw new Error("Stop all plugin processes before restoring the database");
  if (path.resolve(backupFile) === path.resolve(databaseFile))
    throw new Error("Restore source and destination must differ");
  const { DatabaseSync } = await import("node:sqlite");
  const source = new DatabaseSync(backupFile, { readOnly: true });
  try {
    validateDatabase(source);
    if (source.prepare("PRAGMA user_version").get().user_version > maxVersion)
      throw new Error("Backup is newer than the requested plugin version");
    // Online backup reads a consistent source, even when its source uses WAL.
    const staged = `${databaseFile}.${randomUUID()}.restore`;
    await backupDatabase(source, staged);
    try {
      // Preserve the previous target if staging/replacement fails after an unclean shutdown.
      // A successful checkpoint makes its main file independent of the old WAL sidecars.
      try {
        await fs.access(databaseFile);
        const previous = new DatabaseSync(databaseFile);
        try {
          const checkpoint = previous
            .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
            .get();
          if (checkpoint.busy)
            throw new Error(
              "Database is still in use; offline restore refused",
            );
        } finally {
          previous.close();
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.rm(`${databaseFile}-wal`, { force: true });
      await fs.rm(`${databaseFile}-shm`, { force: true });
      await fs.rename(staged, databaseFile);
    } finally {
      await fs.rm(staged, { force: true });
    }
  } finally {
    source.close();
  }
}

// A full integrity check reads the whole file, seconds on a large library,
// and each plugin process would pay it on its first request: long enough for
// that request to time out. Opening never runs it. Migrations and backups
// check as they always did, and a library scan checks once per process
// before it writes.
const verified = new Set();
export function verifyOnce(db, filename) {
  if (verified.has(filename)) return;
  validateDatabase(db);
  verified.add(filename);
}

// Upgrades are serialised across every process and worker thread that opens
// the catalogue: a scan worker, page and search calls and the scheduler can
// all open it at once, and each used to copy the whole database before
// upgrading. Four 760 MB copies at once filled a disk and every copy failed.
// Now one opener holds `upgrade.lock` while it backs up and migrates; the
// others wait, then find the schema current and copy nothing.
const LOCK_POLL_MS = 200;
// A lock older than this is abandoned even if its process looks alive (a
// reused PID): no backup and upgrade should take six hours.
const LOCK_STALE_MS = 6 * 3600 * 1000;
// Room a backup needs beyond the database's own size: SQLite's temporary
// files and the migration's WAL growth.
const BACKUP_HEADROOM = 64 * 1024 * 1024;

const alive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

async function staleLock(lockFile) {
  try {
    const [text, stat] = await Promise.all([fs.readFile(lockFile, "utf8"), fs.stat(lockFile)]);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) return true;
    const owner = JSON.parse(text || "{}");
    return !alive(Number(owner.pid));
  } catch (error) {
    // Gone already, or still being written by its owner: try again.
    if (error.code === "ENOENT") return false;
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

async function acquireUpgradeLock(folder, timeoutMs) {
  const lockFile = path.join(folder, "upgrade.lock");
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await fs.open(lockFile, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, at: Date.now() }));
      } finally {
        await handle.close();
      }
      return async () => {
        // Only remove our own lock, never one a waiter took over as stale.
        try {
          if (JSON.parse(await fs.readFile(lockFile, "utf8")).token === token) await fs.rm(lockFile, { force: true });
        } catch {}
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (await staleLock(lockFile)) {
      await fs.rm(lockFile, { force: true });
      continue;
    }
    if (Date.now() > deadline)
      throw new Error("The classical database is being upgraded by another process; try again when it finishes");
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

const mib = (bytes) => `${Math.ceil(bytes / 1024 / 1024).toLocaleString("en-US")} MB`;

// Refuses before copying when the backup can't fit, instead of filling the
// disk and failing part-way.
async function ensureBackupSpace(db, directory, statfs = fs.statfs) {
  const { page_count: pages } = db.prepare("PRAGMA page_count").get();
  const { page_size: pageSize } = db.prepare("PRAGMA page_size").get();
  const needed = pages * pageSize + BACKUP_HEADROOM;
  await fs.mkdir(directory, { recursive: true });
  const disk = await statfs(directory);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < needed)
    throw new Error(
      `Not enough disk space to back up the classical database before upgrading: ${mib(needed)} needed, ${mib(free)} free in ${directory}`,
    );
}

export async function openDatabase(
  folder,
  { migrations = shippedMigrations, maxVersion = SCHEMA_VERSION, lockTimeoutMs = 30 * 60 * 1000, statfs } = {},
) {
  // Lazy import: missing SQLite support must never stop existing playback/source actions.
  const { DatabaseSync } = await import("node:sqlite");
  await fs.mkdir(folder, { recursive: true });
  const filename = path.join(folder, "classical.sqlite");
  const db = new DatabaseSync(filename);
  const versionOf = () => db.prepare("PRAGMA user_version").get().user_version;
  const pending = (version) =>
    migrations.filter((migration) => migration.version > version && migration.version <= maxVersion);
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
    let version = versionOf();
    if (version > maxVersion)
      throw new Error(
        `Classical schema ${version} is newer than supported ${maxVersion}; restore a compatible backup`,
      );
    if (pending(version).length) {
      const release = await acquireUpgradeLock(folder, lockTimeoutMs);
      try {
        // Another opener may have upgraded while this one waited.
        version = versionOf();
        if (version > maxVersion)
          throw new Error(
            `Classical schema ${version} is newer than supported ${maxVersion}; restore a compatible backup`,
          );
        const steps = pending(version);
        if (steps.length) {
          db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
          // Data preservation precedes every upgrade, including initial
          // creation: one copy of the database as it was, named for the
          // first step it precedes, however many steps follow.
          const backups = path.join(folder, "backups");
          await ensureBackupSpace(db, backups, statfs);
          await backupDatabase(db, path.join(backups, `before-v${steps[0].version}-${randomUUID()}.sqlite`));
          for (const migration of steps) {
            db.exec("BEGIN IMMEDIATE");
            try {
              version = versionOf();
              if (version < migration.version) {
                if (migration.version !== version + 1)
                  throw new Error("Non-contiguous classical migration");
                db.exec(migration.sql);
                db.exec(
                  "CREATE TABLE IF NOT EXISTS migration_journal(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
                );
                db.prepare("INSERT INTO migration_journal VALUES (?,?)").run(
                  migration.version,
                  Date.now(),
                );
                db.exec(`PRAGMA user_version=${migration.version}`);
                validateDatabase(db);
              }
              db.exec("COMMIT");
              version = versionOf();
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          }
        }
      } finally {
        await release();
      }
    }
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    if (version !== maxVersion)
      throw new Error(`Missing migration to classical schema ${maxVersion}`);
    return { db, filename };
  } catch (error) {
    db.close();
    throw error;
  }
}

const activeTransactions = new WeakSet();
export function transaction(db, run) {
  const nested = activeTransactions.has(db);
  const savepoint = `nested_${randomUUID().replaceAll("-", "")}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  if (!nested) activeTransactions.add(db);
  try {
    const result = run();
    if (result && typeof result.then === "function")
      throw new Error("No asynchronous work inside classical transactions");
    db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    db.exec(
      nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK",
    );
    throw error;
  } finally {
    if (!nested) activeTransactions.delete(db);
  }
}

// A consistent snapshot for pages that only read: BEGIN (deferred) takes no
// write lock, so a page never waits behind a scan's write, nor holds one up.
// Rendering can still write now and then (a field's resolution settling);
// if a scan committed meanwhile, that write fails on the old snapshot, and
// the page is read again with the write lock, as before.
export function readTransaction(db, run) {
  if (activeTransactions.has(db)) return run();
  db.exec("BEGIN");
  activeTransactions.add(db);
  let result;
  try {
    result = run();
    if (result && typeof result.then === "function")
      throw new Error("No asynchronous work inside classical transactions");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    activeTransactions.delete(db);
    if (/SQLITE_BUSY|database is locked/i.test(`${error?.code || ""} ${error?.message || ""}`)) return transaction(db, run);
    throw error;
  } finally {
    activeTransactions.delete(db);
  }
  return result;
}
