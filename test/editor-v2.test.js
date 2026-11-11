import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { tempFolders } from "./helpers.js";

const titles = ["I. Allegro con brio", "II. Andante con moto", "III. Allegro", "IV. Allegro"];
async function setup(t) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const input = { ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 2 } };
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(() => {
    try {
      c.close();
    } catch {}
  });
  // Two albums of the same symphony plus a non-classical album.
  const track = (album, i, title, extra = {}) => ({
    coreId: `${album}-${i}`,
    fileId: `${album}-${i}`,
    path: `/library/${album}/${i}.flac`,
    size: 100,
    durationMs: 60000,
    fingerprint: `audio-sha256-v2:${album}-${i}`,
    albumId: album,
    hints: { title, album: `Album ${album}`, artist: `Orchestra ${album}`, composer: ["Ludwig van Beethoven"], trackNumber: i + 1, discNumber: 1, ...extra },
  });
  c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const rows = reconcile(c, {
    version: 1,
    complete: true,
    instanceId: "i",
    epoch: "e",
    generation: 1,
    tracks: [
      ...titles.map((title, i) => track("A", i, `Symphony No. 5 in C minor, Op. 67: ${title}`)),
      ...titles.map((title, i) => track("B", i, `Symphony No.5: ${title}`)),
      track("C", 0, "Summer song", { composer: [], genres: ["Pop"] }),
    ],
  });
  for (const row of rows) classify(c, row.id, row.hints);
  const read = (query = {}) => readEditor({ ...input, query });
  const mutate = async (command, values, selection = "") =>
    mutateEditor({ ...input, mutation: { revision: (await read({ selection })).revision, command, values } });
  const ok = async (command, values, selection) => {
    const result = await mutate(command, values, selection);
    assert.equal(result.ok, true, result.message);
    return result;
  };
  const trackIds = (album) =>
    c.db.prepare("SELECT id FROM track_link WHERE json_extract(evidence,'$.albumId')=? ORDER BY core_id").all(album).map((r) => r.id);
  return { c, read, mutate, ok, trackIds };
}
const section = (view, id) => view.sections.find((s) => s.id === id);

test("browse tabs, lookups and an album turned into a work in one step", async (t) => {
  const s = await setup(t);
  const page = await s.read();
  assert.equal(page.version, 2);
  assert.deepEqual(page.tabs.map((tab) => tab.id), ["works", "composers", "performers", "albums", "review"]);
  assert.equal(page.tab, "works");
  // Albums list shows albums with classical tracks; others are found by search.
  const albums = await s.read({ tab: "albums" });
  assert.deepEqual(albums.list.items.map((i) => i.label).sort(), ["Album A", "Album B"]);
  assert.equal((await s.read({ tab: "albums", q: "summer" })).list.items[0].label, "Album C");
  const album = (await s.read({ selection: "album:A" })).view;
  assert.equal(album.title, "Album A");
  const create = section(album, "new-work");
  assert.equal(create.fields.find((f) => f.key === "title").value, "Symphony No. 5 in C minor, Op. 67");
  const result = await s.ok("create-work-from-album", {
    ...create.arguments,
    title: "Symphony No. 5 in C minor, Op. 67",
    composer: "",
    composerName: "Ludwig van Beethoven",
  }, "album:A");
  const work = result.selection;
  const workView = (await s.read({ selection: work })).view;
  assert.deepEqual(section(workView, "movements").rows.map((r) => r.label), titles);
  assert.equal(section(workView, "recordings").rows[0].badge.label, "Complete");
  // Lookups search on their own, independent of the list search.
  assert.equal((await s.read({ lookup: "works", q: "symphony 5" })).options[0].value, work);
  assert.equal((await s.read({ lookup: "composers", q: "beethoven" })).options.length, 1);
  assert.ok((await s.read({ lookup: "tracks", q: "andante orchestra b" })).options.length >= 1);
  // Second album: choose the existing work; movements are suggested.
  const chosen = await s.ok("choose-album-work", { albumId: "B", work }, "album:B");
  assert.equal(chosen.selection, `album:B@${work}`);
  const assign = section((await s.read({ selection: chosen.selection })).view, "assign");
  const movements = section(workView, "movements").rows.map((r) => r.id);
  assert.deepEqual(assign.fields[0].value, movements);
  await s.ok("assign-album", { ...assign.arguments, mapping: assign.fields[0].value }, chosen.selection);
  const after = (await s.read({ selection: work })).view;
  assert.equal(section(after, "recordings").rows.length, 2);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='person' AND deleted_at IS NULL").get().n, 1);
  // Unassign keeps the work and the audio.
  await s.ok("unassign-album", { albumId: "B", work }, "album:B");
  assert.equal(section((await s.read({ selection: work })).view, "recordings").rows.length, 1);
});

test("one save edits several fields, pins them, and field actions keep provenance", async (t) => {
  const s = await setup(t);
  const work = (await s.ok("create-work", { title: "Sonata", composer: "", movements: ["I. One", "II. Two", "III. Three"] })).selection;
  new Metadata(s.c).refresh(work, "musicbrainz", "mb-work", { nickname: "Provider nickname" });
  const details = section((await s.read({ selection: work })).view, "details");
  assert.equal(details.fields.find((f) => f.key === "nickname").meta.source, "MusicBrainz");
  const saved = await s.ok("save-entity", { target: work, title: "Piano Sonata No. 14", nickname: "Moonlight", key: "C-sharp minor", catalogue: ["Op. 27 No. 2"], aliases: ["Mondscheinsonate"] }, work);
  assert.match(saved.message, /Saved 5 changes/);
  const m = new Metadata(s.c);
  assert.equal(m.resolve(work, "nickname").pinned, true);
  assert.deepEqual(m.resolve(work, "catalogue").value, ["Op. 27 No. 2"]);
  const nickname = section((await s.read({ selection: work })).view, "details").fields.find((f) => f.key === "nickname");
  assert.equal(nickname.meta.pinned, true);
  assert.match(nickname.meta.provider, /Provider nickname/);
  assert.ok(nickname.actions.some((a) => a.command === "use-provider"));
  await s.ok("set-blank", { target: work, field: "key" }, work);
  assert.equal(m.resolve(work, "key").value, null);
  await s.ok("use-provider", { target: work, field: "nickname" }, work);
  assert.equal(m.resolve(work, "nickname").value, "Provider nickname");
  // An unchanged save is a no-op, and titles can't silently become empty.
  assert.match((await s.ok("save-entity", { target: work, title: "Piano Sonata No. 14" }, work)).message, /No changes/);
  assert.equal((await s.mutate("save-entity", { target: work, title: "" }, work)).ok, false);
});

test("movements reorder, add in bulk and delete; credits use their own lookup", async (t) => {
  const s = await setup(t);
  const work = (await s.ok("create-work", { title: "Suite", composer: "", movements: ["Prelude", "Allemande"] })).selection;
  await s.ok("add-movement", { work, title: ["Courante", "Sarabande"] }, work);
  let rows = section((await s.read({ selection: work })).view, "movements").rows;
  assert.deepEqual(rows.map((r) => r.label), ["Prelude", "Allemande", "Courante", "Sarabande"]);
  await s.ok("move-movement", { work, movement: rows[3].id, direction: "up" }, work);
  await s.ok("delete-movement", { work, movement: rows[0].id }, work);
  rows = section((await s.read({ selection: work })).view, "movements").rows;
  assert.deepEqual(rows.map((r) => r.label), ["Allemande", "Sarabande", "Courante"]);
  const cellist = (await s.ok("create-contributor", { name: "Pierre Fournier", kind: "person" })).selection;
  await s.ok("add-credit", { target: work, contributor: cellist, role: "soloist", instrument: "cello" }, work);
  assert.equal(section((await s.read({ selection: work })).view, "credits").rows[0].detail, "Soloist · cello");
  assert.equal((await s.read({ selection: cellist })).view.subtitle, "Performer");
  assert.equal((await s.mutate("delete-entity", { target: cellist }, cellist)).ok, false, "in-use people can't be deleted");
});

test("send to / remove from Classical overrides detection and closes review items", async (t) => {
  const s = await setup(t);
  const [pop] = s.trackIds("C");
  await s.ok("set-classification", { tracks: [pop], state: "classical" }, `track:${pop}`);
  assert.deepEqual({ ...s.c.db.prepare("SELECT state,pinned FROM classification WHERE target_id=?").get(pop) }, { state: "classical", pinned: 1 });
  assert.equal(classify(s.c, pop, { genres: ["Pop"] }), "classical", "manual choice survives rescans");
  const view = (await s.read({ selection: `track:${pop}` })).view;
  assert.ok(view.actions.some((a) => a.label === "Use automatic detection"));
  await s.ok("set-classification", { tracks: [pop], state: "automatic" }, `track:${pop}`);
  assert.equal(s.c.db.prepare("SELECT state FROM classification WHERE target_id=?").get(pop).state, "not_classical");
  // Review queue: an unsure track is listed and resolved by a classification choice.
  const unsure = s.trackIds("A")[0];
  s.c.db.prepare("UPDATE classification SET state='unsure' WHERE target_id=?").run(unsure);
  s.c.review("classification", unsure, {});
  const review = await s.read({ tab: "review" });
  assert.equal(review.tabs.find((tab) => tab.id === "review").count, 1);
  const item = review.list.items[0];
  const reviewView = (await s.read({ selection: item.selection })).view;
  const send = reviewView.actions.find((a) => a.label === "Send to Classical");
  await s.ok(send.command, send.arguments, item.selection);
  assert.equal((await s.read({ tab: "review" })).list.items.length, 0);
});

test("duplicate works merge, and unused works can be deleted", async (t) => {
  const s = await setup(t);
  const a = (await s.ok("create-work-from-album", { albumId: "A", tracks: s.trackIds("A"), title: "Symphony No. 5", composer: "", composerName: "Ludwig van Beethoven" }, "album:A")).selection;
  const b = (await s.ok("create-work-from-album", { albumId: "B", tracks: s.trackIds("B"), title: "Symphony No. 5 (dup)", composer: "", composerName: "Ludwig van Beethoven" }, "album:B")).selection;
  assert.equal((await s.mutate("merge-entity", { target: b, into: a, confirm: false }, b)).ok, false);
  await s.ok("merge-entity", { target: b, into: a, confirm: true }, b);
  assert.equal(section((await s.read({ selection: a })).view, "recordings").rows.length, 2);
  assert.equal((await s.read({ tab: "works" })).list.items.length, 1);
  const empty = (await s.ok("create-work", { title: "Sketch", composer: "", movements: [] })).selection;
  const del = (await s.read({ selection: empty })).view.actions.find((x) => x.command === "delete-entity");
  assert.ok(del.confirm);
  await s.ok(del.command, del.arguments, empty);
  assert.equal((await s.read({ tab: "works" })).list.items.length, 1);
});

test("v1 hosts still get the v1 editor", async (t) => {
  const s = await setup(t);
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const page = await readEditor({ ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 1 }, query: {} });
  assert.equal(page.version, 1);
  assert.ok(s);
});
