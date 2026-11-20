// v0.3 9.2: a schema 4 catalogue made by the real last schema 4 build
// (the plugin bundle before #48, from git) migrates to schema 5; the
// automatic backup, restored offline, opens again in that old build with
// its data. Before the restore, the old build refuses the schema 5 file.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { restoreDatabase } from "../src/model/database.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The commit that moved the catalogue to schema 5; its parent is the last
// schema 4 build. CI checks out full history for this.
const SCHEMA_5 = "58dd615";

async function oldBuild() {
  let source;
  try {
    source = execFileSync("git", ["show", `${SCHEMA_5}^:index.js`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`The schema 4 build (${SCHEMA_5}^:index.js) isn't in this checkout's git history; fetch full history: ${error.message}`);
  }
  // Inside the plugin folder, so it finds the same node_modules.
  const file = path.join(root, ".scratch", "schema4-build", "index.js");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, source);
  return (await import(`${pathToFileURL(file).href}?${Date.now()}`)).default;
}

test("a schema 4 catalogue from the old build migrates, and its backup opens in the old build again", { timeout: 120_000 }, async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const old = await oldBuild();
  const admin = { id: 1, username: "admin", role: "admin" };
  const editor = { ...folders, settings: {}, user: admin, pageId: "editor", capabilities: { adminForms: 2 } };
  const read = (query) => old.pages.read({ ...editor, query });

  // The old build makes a work in its own (schema 4) catalogue.
  const first = await read({ tab: "works" });
  const made = await old.pages.mutate({ ...editor, mutation: { revision: first.revision, command: "create-work", values: { title: "Rollback Sonata", composer: "", movements: ["I. Allegro", "II. Adagio"] } } });
  assert.equal(made.ok, true, made.message);
  const work = made.selection;
  const filename = path.join(folders.dataFolder, "model", "classical.sqlite");
  const version = async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      return db.prepare("PRAGMA user_version").get().user_version;
    } finally {
      db.close();
    }
  };
  assert.equal(await version(), 4);

  // This build migrates it to schema 5 and keeps a backup of the schema 4 file.
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  assert.equal(c.db.prepare("PRAGMA user_version").get().user_version, 5);
  assert.equal(c.db.prepare("SELECT kind FROM entity WHERE id=?").get(work).kind, "work");
  // Schema 5 data the old build has no table for.
  c.db.prepare("INSERT INTO saved_queue(id,user_id,name,work_id,items,created_at) VALUES ('q',1,'Saved',?, '[]', 1)").run(work);
  c.close();

  // Without a restore, the old build refuses the newer file, and says why.
  await assert.rejects(read({ tab: "works" }), /newer than supported 4; restore a compatible backup/);

  // Restored offline from the automatic backup, the old build opens it with its work.
  const backups = path.join(folders.dataFolder, "model", "backups");
  const backup = (await fs.readdir(backups)).find((name) => name.startsWith("before-v5-"));
  assert.ok(backup, "a before-v5 backup was made");
  await restoreDatabase(path.join(backups, backup), filename, { offline: true, maxVersion: 4 });
  assert.equal(await version(), 4);
  const list = await read({ tab: "works" });
  assert.ok(list.list.items.some((item) => item.selection === work && /Rollback Sonata/.test(item.label)), "the work is listed");
  const view = await read({ tab: "works", selection: work });
  assert.match(view.view.title, /Rollback Sonata/);
  // Its v1 work page reads too.
  const page = await old.pages.read({ ...folders, settings: {}, user: admin, pageId: "work", resourceId: work, query: {} });
  assert.deepEqual(page.work.movements.map((movement) => movement.title), ["I. Allegro", "II. Adagio"]);
});
