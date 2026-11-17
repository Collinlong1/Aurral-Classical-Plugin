// Every process that opens the catalogue used to copy the whole database
// before upgrading it, with nothing to stop them doing it at once: four
// openers of a 760 MB catalogue started four copies, filled the disk, and
// every copy failed. One opener now backs up and upgrades; the rest wait.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tempFolders } from "./helpers.js";
import { openDatabase } from "../src/model/database.js";
import { migrations } from "../src/model/schema.js";

const database = fileURLToPath(new URL("../src/model/database.js", import.meta.url));
const v4 = { migrations: migrations.filter((m) => m.version <= 4), maxVersion: 4 };

// A schema 4 catalogue big enough that a backup takes a moment.
async function oldCatalogue(t) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const folder = folders.dataFolder;
  const { db } = await openDatabase(folder, v4);
  db.exec("CREATE TABLE bulk(data BLOB)");
  const insert = db.prepare("INSERT INTO bulk VALUES (randomblob(1048576))");
  for (let i = 0; i < 40; i++) insert.run();
  db.close();
  await fs.rm(path.join(folder, "backups"), { recursive: true, force: true });
  return folder;
}

const backups = async (folder) =>
  (await fs.readdir(path.join(folder, "backups")).catch(() => [])).filter((file) => !file.startsWith("."));

// Each child waits for `go`, so all four open the catalogue at the same moment.
function opener(folder, index) {
  const code = `
    import fs from "node:fs";
    import { openDatabase } from ${JSON.stringify(database)};
    fs.writeFileSync(${JSON.stringify(path.join(folder, `ready-${index}`))}, "");
    while (!fs.existsSync(${JSON.stringify(path.join(folder, "go"))})) await new Promise((r) => setTimeout(r, 2));
    const { db } = await openDatabase(${JSON.stringify(folder)});
    console.log(db.prepare("PRAGMA user_version").get().user_version);
    db.close();
  `;
  const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  return new Promise((resolve) => child.on("exit", (status) => resolve({ status, out: out.trim(), err })));
}

test("four processes opening an old catalogue at once make one backup and one upgrade", async (t) => {
  const folder = await oldCatalogue(t);
  const runs = [0, 1, 2, 3].map((index) => opener(folder, index));
  for (;;) {
    const ready = (await fs.readdir(folder)).filter((file) => file.startsWith("ready-")).length;
    if (ready === 4) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await fs.writeFile(path.join(folder, "go"), "");
  const results = await Promise.all(runs);
  for (const result of results) assert.deepEqual([result.status, result.out], [0, "5"], result.err);
  const made = await backups(folder);
  assert.equal(made.length, 1, made.join(", "));
  assert.match(made[0], /^before-v5-.*\.sqlite$/);
  assert.equal((await fs.readdir(folder)).includes("upgrade.lock"), false);
});

test("an upgrade that can't fit its backup is refused before copying, and leaves the catalogue as it was", async (t) => {
  const folder = await oldCatalogue(t);
  const statfs = async () => ({ bavail: 10, bsize: 1024 * 1024 });
  await assert.rejects(openDatabase(folder, { statfs }), /Not enough disk space to back up the classical database before upgrading: [\d,]+ MB needed, 10 MB free/);
  assert.deepEqual(await backups(folder), []);
  assert.equal((await fs.readdir(folder)).includes("upgrade.lock"), false);
  const { db } = await openDatabase(folder, v4);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4);
  db.close();
  // With room, the same catalogue upgrades.
  const { db: upgraded } = await openDatabase(folder);
  assert.equal(upgraded.prepare("PRAGMA user_version").get().user_version, 5);
  upgraded.close();
});

test("a lock left by a process that died is taken over; a live one is waited for", async (t) => {
  const folder = await oldCatalogue(t);
  const lock = path.join(folder, "upgrade.lock");
  // No process has PID 2^22+1 here.
  await fs.writeFile(lock, JSON.stringify({ pid: 4194305, token: "dead", at: Date.now() }));
  const { db } = await openDatabase(folder);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);
  db.close();
  assert.equal((await fs.readdir(folder)).includes("upgrade.lock"), false);
  // A current catalogue opens without the lock, even while one is held.
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: "live", at: Date.now() }));
  const { db: current } = await openDatabase(folder);
  current.close();
  // An old one waits for it, and says so if it runs out of time.
  const older = await oldCatalogue(t);
  await fs.writeFile(path.join(older, "upgrade.lock"), JSON.stringify({ pid: process.pid, token: "live", at: Date.now() }));
  await assert.rejects(openDatabase(older, { lockTimeoutMs: 300 }), /being upgraded by another process/);
  assert.deepEqual(await backups(older), []);
});
