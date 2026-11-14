import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { tempFolders } from "./helpers.js";

// A box set of 640 tracks: 160 sonatas of four movements, the first 40 of
// them tagged with their work, the rest with titles only.
export async function boxSet(t, { tracks = 640 } = {}) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(() => {
    try {
      c.close();
    } catch {}
  });
  c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const movements = ["I. Allegro", "II. Adagio", "III. Menuetto", "IV. Rondo"];
  const rows = reconcile(c, {
    version: 1,
    complete: true,
    instanceId: "i",
    epoch: "e",
    generation: 1,
    tracks: Array.from({ length: tracks }, (_, i) => {
      const work = `Sonata No. ${Math.floor(i / 4) + 1}, Op. ${Math.floor(i / 4) + 1}`;
      return {
        coreId: `box-${i}`,
        fileId: `box-${i}`,
        path: `/library/box/${i}.flac`,
        size: 100,
        durationMs: 200000 + i,
        fingerprint: `audio-sha256-v2:box-${i}`,
        albumId: "box",
        hints: {
          title: `${work}: ${movements[i % 4]}`,
          album: "The Complete Sonatas",
          artist: "Box Pianist",
          composer: ["Joseph Haydn"],
          ...(i < 160 && { work: `${work}: ${movements[i % 4]}` }),
          trackNumber: (i % 100) + 1,
          discNumber: Math.floor(i / 100) + 1,
          genres: ["Classical"],
        },
      };
    }),
  });
  for (const row of rows) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c, { actor: "test" });
  const input = { ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 2 } };
  const read = (query = {}) => readEditor({ ...input, query });
  const mutate = async (command, values, selection = "") =>
    mutateEditor({ ...input, mutation: { revision: (await read({ selection })).revision, command, values } });
  return { c, read, mutate };
}

const rowsIn = (view) =>
  view.sections.reduce((n, section) => n + (section.rows?.length || 0) + (section.fields || []).reduce((m, f) => m + (f.rows?.length || 0), 0), 0);

test("an album of 640 tracks opens a page at a time, never past the 500-row limit", async (t) => {
  const { read } = await boxSet(t);
  const first = (await read({ selection: "album:box" })).view;
  assert.equal(first.subtitle, "Box Pianist · 640 tracks");
  const sections = Object.fromEntries(first.sections.map((section) => [section.id, section]));
  assert.ok(sections.works.rows.length >= 40, "tagged works are listed");
  assert.ok(rowsIn(first) <= 500, `${rowsIn(first)} rows`);
  const tracksOnPage = (sections.unmatched?.rows.length || 0) + (sections["in-works"]?.rows.length || 0);
  assert.equal(tracksOnPage, 100);
  const pager = (sections["in-works"] || sections.unmatched).pager;
  assert.equal(pager.label, "Tracks 1–100 of 640");
  assert.equal(pager.previous, undefined);
  assert.equal(pager.next, "album:box~1");
  // The last page holds the last 40 tracks, all outside a work.
  const last = (await read({ selection: "album:box~6" })).view;
  const lastSections = Object.fromEntries(last.sections.map((section) => [section.id, section]));
  assert.equal(lastSections.unmatched.rows.length, 40);
  assert.equal(lastSections.unmatched.pager.label, "Tracks 601–640 of 640");
  assert.equal(lastSections.unmatched.pager.next, undefined);
  assert.ok(rowsIn(last) <= 500);
  // A page past the end shows the last page.
  assert.equal((await read({ selection: "album:box~99" })).view.sections.find((s) => s.id === "unmatched").pager.label, "Tracks 601–640 of 640");
});

test("bulk actions change only the ticked tracks, and the album-wide action every track", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const last = (await read({ selection: "album:box~6" })).view;
  const unmatched = last.sections.find((section) => section.id === "unmatched");
  const send = unmatched.select.actions.find((a) => a.label === "Remove from Classical");
  const ticked = unmatched.rows.slice(0, 3).map((row) => row.id);
  const result = await mutate(send.command, { ...send.arguments, tracks: ticked }, "album:box~6");
  assert.equal(result.ok, true, result.message);
  const states = c.db.prepare("SELECT target_id,state FROM classification WHERE state='not_classical'").all();
  assert.deepEqual(states.map((row) => row.target_id).sort(), [...ticked].sort());
  // Take three tracks out of their works.
  const page = (await read({ selection: "album:box" })).view;
  const inWorks = page.sections.find((section) => section.id === "in-works");
  const out = inWorks.select.actions.find((a) => a.command === "unassign-tracks");
  const pick = inWorks.rows.slice(0, 2).map((row) => row.id);
  const before = c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n;
  assert.equal((await mutate(out.command, { ...out.arguments, tracks: pick }, "album:box")).ok, true);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n, before - 2);
  // Every track, without sending 640 IDs.
  const all = page.actions.find((a) => a.label === "Send all to Classical");
  assert.deepEqual(Object.keys(all.arguments).sort(), ["albumId", "state"]);
  assert.equal((await mutate(all.command, all.arguments, "album:box")).ok, true);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM classification WHERE state='classical' AND pinned=1").get().n, 640);
});

const liveWork = (c, title) =>
  c.db
    .prepare(
      `SELECT e.id FROM entity e JOIN field_resolution f ON f.target_id=e.id AND f.field='title' JOIN assertion a ON a.id=f.assertion_id
       WHERE e.kind='work' AND e.deleted_at IS NULL AND json_extract(a.value,'$')=?`,
    )
    .get(title)?.id;

test("deleting works in use keeps tracks and files, isn't undone by matching, and can be undone", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const first = liveWork(c, "Sonata No. 1, Op. 1");
  const second = liveWork(c, "Sonata No. 2, Op. 2");
  assert.ok(first && second);
  const tracksBefore = c.db.prepare("SELECT id,evidence,state FROM track_link ORDER BY id").all();
  const view = (await read({ selection: first })).view;
  const remove = view.actions.find((a) => a.command === "delete-entity");
  assert.match(remove.confirm, /4 movements and 1 recording.*4 tracks stay in your library.*Audio files are never deleted/);
  // Both, from the list's bulk action.
  const bulk = (await read({ tab: "works" })).list.select.actions.find((a) => a.command === "delete-works");
  const done = await mutate(bulk.command, { ...bulk.arguments, works: [first, second] });
  assert.equal(done.ok, true, done.message);
  assert.equal(liveWork(c, "Sonata No. 1, Op. 1"), undefined);
  assert.deepEqual(c.db.prepare("SELECT id,evidence,state FROM track_link ORDER BY id").all(), tracksBefore, "tracks and their files are untouched");
  // Background matching won't make them again; it asks instead.
  autoMatchTaggedWorks(c, { actor: "scan" });
  assert.equal(liveWork(c, "Sonata No. 1, Op. 1"), undefined);
  const review = c.db.prepare("SELECT * FROM review_item WHERE kind='auto_match' AND status='open' AND json_extract(evidence,'$.reason')='deleted-work'").all();
  assert.equal(review.length, 2);
  // Undo puts both back, with their recordings.
  const history = await read({ tab: "activity" });
  assert.equal(history.list.items[0].label, "Maintenance", "maintenance is pinned first");
  history.list.items.shift();
  assert.equal(history.list.items[0].label, "Deleted 2 works");
  const undo = (await read({ selection: history.list.items[0].selection })).view.actions[0];
  const undone = await mutate(undo.command, undo.arguments, history.list.items[0].selection);
  assert.equal(undone.ok, true, undone.message);
  assert.equal(liveWork(c, "Sonata No. 1, Op. 1"), first);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM realization WHERE work_id IN (?,?)").get(first, second).n, 2);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM match_suppression WHERE key LIKE 'work:%'").get().n, 0);
  // Deleting again, then allowing one: matching makes it again.
  await mutate("delete-entity", { target: first }, first);
  autoMatchTaggedWorks(c, { actor: "scan" });
  const asked = c.db.prepare("SELECT id FROM review_item WHERE kind='auto_match' AND status='open' AND json_extract(evidence,'$.reason')='deleted-work'").get();
  const allow = (await read({ selection: `review:${asked.id}` })).view.actions.find((a) => a.command === "allow-work");
  assert.equal((await mutate(allow.command, allow.arguments, `review:${asked.id}`)).ok, true);
  autoMatchTaggedWorks(c, { actor: "scan" });
  assert.ok(liveWork(c, "Sonata No. 1, Op. 1"), "allowed again, matching recreates it");
});

test("several works edited together; one that fails keeps the others' edits", async (t) => {
  const { c, read, mutate } = await boxSet(t, { tracks: 40 });
  const works = c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL ORDER BY id").all().map((row) => row.id);
  assert.ok(works.length >= 3);
  const open = (await read({ tab: "works" })).list.select.actions.find((a) => a.command === "bulk-edit-open");
  const opened = await mutate(open.command, { ...open.arguments, works: works.slice(0, 3) });
  assert.match(opened.selection, /^bulk:/);
  const view = (await read({ selection: opened.selection })).view;
  assert.equal(view.title, "Edit 3 works together");
  // A work deleted meanwhile is left out, not an error for the rest.
  c.db.prepare("UPDATE entity SET deleted_at=1 WHERE id=?").run(works[2]);
  const form = view.sections.find((section) => section.id === "bulk");
  const result = await mutate(form.command, { ...form.arguments, period: "Classical", form: "Sonata" }, opened.selection);
  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /Updated 2 of 2 works/);
  for (const work of works.slice(0, 2))
    assert.deepEqual(
      c.db.prepare("SELECT field FROM pinned_override WHERE target_id=? AND field IN ('period','form') ORDER BY field").all(work).map((row) => row.field),
      ["form", "period"],
    );
  assert.equal(c.db.prepare("SELECT 1 FROM pinned_override WHERE target_id=?").get(works[2]), undefined);
  const unpin = (await read({ selection: opened.selection })).view.actions.find((a) => a.command === "bulk-unpin");
  assert.match((await mutate(unpin.command, unpin.arguments, opened.selection)).message, /Unpinned 4 fields on 2 works/);
});

test("the review queue opens the next item after each decision, and resolves many at once", async (t) => {
  const { c, read, mutate } = await boxSet(t, { tracks: 12 });
  const tracks = c.db.prepare("SELECT id FROM track_link ORDER BY id").all().map((row) => row.id);
  tracks.slice(0, 5).forEach((track, i) => c.db.prepare("INSERT INTO review_item VALUES (?,?,?,?,'open',?)").run(`r${i}`, "classification", track, "{}", 100 - i));
  // r0 is newest: the queue starts there.
  const first = (await read({ selection: "review:r0" })).view;
  assert.ok(first.actions.some((a) => a.label === "Skip" && a.arguments.selection === "review:r1"));
  const send = first.actions.find((a) => a.label === "Send to Classical");
  const after = await mutate(send.command, send.arguments, "review:r0");
  assert.equal(after.selection, "review:r1", "the next item opens");
  assert.match(after.message, /Next item:/);
  // Bulk: two dismissed, two resolved as classical.
  const list = await read({ tab: "review" });
  assert.equal(list.list.total, 4);
  const [toClassical, , toDismiss] = list.list.select.actions;
  assert.match((await mutate(toClassical.command, { ...toClassical.arguments, ids: ["r1", "r2"] })).message, /Resolved 2 items/);
  assert.match((await mutate(toDismiss.command, { ...toDismiss.arguments, ids: ["r3", "r4"] })).message, /Dismissed 2 items/);
  const tabs = (await read({ tab: "review" })).tabs;
  assert.equal(tabs.find((tab) => tab.id === "review").count, 0, "counts update at once");
});

test("Activity opens on Maintenance, whose commands queue library work through the runtime", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const ran = [];
  const maintenance = {
    status: async () => ({ schema: 4, indexed: 12, scan: { state: "running", processed: 3, total: 12, leaseUntil: Date.now() + 60_000 }, identification: null, english: null }),
    run: async (command, user) => (ran.push([command, user.role]), `ran ${command}`),
  };
  const input = { ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 2 }, maintenance };
  const page = await readEditor({ ...input, query: { tab: "activity" } });
  assert.equal(page.view.title, "Maintenance");
  assert.equal(page.view.badges[0].label, "Scan running");
  assert.deepEqual(page.view.actions.map((a) => a.command), ["maintenance-scan", "maintenance-cancel"]);
  const result = await mutateEditor({ ...input, mutation: { revision: page.revision, command: "maintenance-scan", values: {} } });
  assert.deepEqual(result, { ok: true, message: "ran maintenance-scan", selection: "maintenance" });
  assert.deepEqual(ran, [["maintenance-scan", "admin"]]);
  // Regular users never reach it.
  await assert.rejects(readEditor({ ...input, user: { id: 2, role: "user" }, query: { tab: "activity" } }));
});
