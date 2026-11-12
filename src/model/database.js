import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { migrations as shippedMigrations } from "./schema.js";

export const SCHEMA_VERSION = 3;

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
    await fs.rm(temporary, { force: true });
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

const validated = new Set();

export async function openDatabase(
  folder,
  { migrations = shippedMigrations, maxVersion = SCHEMA_VERSION } = {},
) {
  // Lazy import: missing SQLite support must never stop existing playback/source actions.
  const { DatabaseSync } = await import("node:sqlite");
  await fs.mkdir(folder, { recursive: true });
  const filename = path.join(folder, "classical.sqlite");
  const db = new DatabaseSync(filename);
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
    let version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > maxVersion)
      throw new Error(
        `Classical schema ${version} is newer than supported ${maxVersion}; restore a compatible backup`,
      );
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    for (const migration of migrations) {
      if (migration.version <= version || migration.version > maxVersion)
        continue;
      // Data preservation precedes *every* migration, including initial creation.
      await backupDatabase(
        db,
        path.join(
          folder,
          "backups",
          `before-v${migration.version}-${randomUUID()}.sqlite`,
        ),
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        version = db.prepare("PRAGMA user_version").get().user_version;
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
        version = db.prepare("PRAGMA user_version").get().user_version;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version !== maxVersion)
      throw new Error(`Missing migration to classical schema ${maxVersion}`);
    // A full integrity check reads the whole file. Every album page opens
    // the database, so check once per process; migrations check above.
    if (!validated.has(filename)) {
      validateDatabase(db);
      validated.add(filename);
    }
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
