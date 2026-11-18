import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks, repairMergedIdentities, mergeDuplicateAutoWorks, distinctKey, repairDuplicateRealizations } from "../src/model/auto-match.js";
import { mutateEditor as mutateRaw } from "../src/model/editor.js";
import { tempFolders } from "./helpers.js";
import { renderAlbumPresentation, applyWorkMutation } from "../src/model/presentation.js";

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
  return { c, read, mutate, ok, trackIds, input };
}
const section = (view, id) => view.sections.find((s) => s.id === id);
async function albumChoice(s, album) {
  const opened = await s.ok("move-tracks-open", { albumId: album, tracks: s.trackIds(album) }, `album:${album}`);
  return { selection: opened.selection, view: (await s.read({ selection: opened.selection })).view };
}
async function newAlbumForm(s, album) {
  const choice = await albumChoice(s, album);
  const create = choice.view.actions.find((action) => action.command === "new-album-work");
  const opened = await s.ok(create.command, create.arguments, choice.selection);
  return { selection: opened.selection, form: section((await s.read({ selection: opened.selection })).view, "new-work") };
}


test("browse tabs, lookups and an album turned into a work through selected tracks", async (t) => {
  const s = await setup(t);
  const page = await s.read();
  assert.equal(page.version, 2);
  assert.deepEqual(page.tabs.map((tab) => tab.id), ["works", "composers", "performers", "albums", "review", "search", "activity"]);
  assert.equal(page.tab, "works");
  // Albums list shows albums with classical tracks; others are found by search.
  const albums = await s.read({ tab: "albums" });
  assert.deepEqual(albums.list.items.map((i) => i.label).sort(), ["Album A", "Album B"]);
  assert.equal((await s.read({ tab: "albums", q: "summer" })).list.items[0].label, "Album C");
  const album = (await s.read({ selection: "album:A" })).view;
  assert.equal(album.title, "Album A");
  const { form: create, selection: creating } = await newAlbumForm(s, "A");
  assert.equal(create.fields.find((f) => f.key === "title").value, "Symphony No. 5 in C minor, Op. 67");
  const result = await s.ok("create-work-from-album", {
    ...create.arguments,
    title: "Symphony No. 5 in C minor, Op. 67",
    composer: "",
    composerName: "Ludwig van Beethoven",
  }, creating);
  assert.equal(result.selection, "album:A");
  const work = s.c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").get().id;
  const workView = (await s.read({ selection: `${work}!movements` })).view;
  assert.deepEqual(section(workView, "movements").rows.map((r) => r.label), titles);
  assert.equal(section((await s.read({ selection: `${work}!recordings` })).view, "recordings").rows[0].badge.label, "Complete");
  // Lookups search on their own, independent of the list search.
  assert.equal((await s.read({ lookup: "works", q: "symphony 5" })).options[0].value, work);
  assert.equal((await s.read({ lookup: "composers", q: "beethoven" })).options.length, 1);
  assert.ok((await s.read({ lookup: "tracks", q: "andante orchestra b" })).options.length >= 1);
  // Second album: choose the existing work; movements are suggested.
  const chosen = await s.ok("choose-album-work", { albumId: "B", work }, "album:B");
  assert.ok(chosen.selection.startsWith(`album:B@${work}!`));
  const assign = section((await s.read({ selection: chosen.selection })).view, "assign");
  const movements = section(workView, "movements").rows.map((r) => r.id);
  assert.deepEqual(assign.fields[0].value, movements);
  await s.ok("assign-album", { ...assign.arguments, mapping: assign.fields[0].value }, chosen.selection);
  const after = (await s.read({ selection: `${work}!recordings` })).view;
  assert.equal(section(after, "recordings").rows.length, 2);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='person' AND deleted_at IS NULL").get().n, 1);
  // Unassign keeps the work and the audio.
  await s.ok("unassign-album", { albumId: "B", work }, "album:B");
  assert.equal(section((await s.read({ selection: `${work}!recordings` })).view, "recordings").rows.length, 1);
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
  let rows = section((await s.read({ selection: `${work}!movements` })).view, "movements").rows;
  assert.deepEqual(rows.map((r) => r.label), ["Prelude", "Allemande", "Courante", "Sarabande"]);
  await s.ok("move-movement", { work, movement: rows[3].id, direction: "up" }, work);
  await s.ok("delete-movement", { work, movement: rows[0].id }, work);
  rows = section((await s.read({ selection: `${work}!movements` })).view, "movements").rows;
  assert.deepEqual(rows.map((r) => r.label), ["Allemande", "Sarabande", "Courante"]);
  const cellist = (await s.ok("create-contributor", { name: "Pierre Fournier", kind: "person" })).selection;
  await s.ok("add-credit", { target: work, contributor: cellist, role: "soloist", instrument: "cello" }, work);
  assert.equal(section((await s.read({ selection: `${work}!credits` })).view, "credits").rows[0].detail, "Soloist · cello");
  assert.equal((await s.read({ selection: cellist })).view.subtitle, "Performer");
  assert.equal((await s.mutate("delete-entity", { target: cellist }, cellist)).ok, false, "in-use people can't be deleted");
  // A credit a scan derived: removing it hides it and keeps it removed;
  // adding it again by hand brings it back as the admin's own.
  const pianist = (await s.ok("create-contributor", { name: "Alfred Brendel", kind: "person" })).selection;
  const derived = s.c.credit(work, pianist, "performer", { position: 2, source: "derived" });
  const creditRows = async () => section((await s.read({ selection: `${work}!credits` })).view, "credits").rows.map((row) => row.label);
  assert.deepEqual(await creditRows(), ["Pierre Fournier", "Alfred Brendel"]);
  await s.ok("remove-credit", { target: work, credit: derived }, work);
  assert.deepEqual(await creditRows(), ["Pierre Fournier"]);
  assert.deepEqual({ ...s.c.db.prepare("SELECT source,state FROM credit WHERE id=?").get(derived) }, { source: "derived", state: "removed" });
  assert.equal((await s.mutate("remove-credit", { target: work, credit: derived }, work)).ok, false, "a removed credit can't be removed again");
  assert.equal((await s.read({ selection: pianist })).view.sections.some((section) => section.rows?.some((row) => row.selection === work)), false);
  await s.ok("add-credit", { target: work, contributor: pianist, role: "performer", instrument: "" }, work);
  assert.deepEqual(await creditRows(), ["Pierre Fournier", "Alfred Brendel"]);
  assert.deepEqual({ ...s.c.db.prepare("SELECT source,state FROM credit WHERE id=?").get(derived) }, { source: "manual", state: "active" });
  // A manual credit is deleted outright.
  const manual = s.c.db.prepare("SELECT id FROM credit WHERE target_id=? AND contributor_id=?").get(work, cellist).id;
  await s.ok("remove-credit", { target: work, credit: manual }, work);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM credit WHERE id=?").get(manual).n, 0);
  assert.equal((await s.mutate("delete-entity", { target: cellist }, cellist)).ok, true);
});

test("the performer list filters by role and shows contributors a scan made that nobody has reviewed", async (t) => {
  const s = await setup(t);
  const m = new Metadata(s.c);
  const contributor = (name, kind, data = {}) => {
    const id = s.c.createEntity(kind, data);
    (data.unreviewed ? m.derived : m.manual).call(m, id, "name", name, ...(data.unreviewed ? [] : [{ actor: "admin" }]));
    return id;
  };
  const work = (await s.ok("create-work", { title: "Fixture Concerto", composer: "", movements: ["I"] })).selection;
  const conductor = contributor("Fixture Conductor", "person", { unreviewed: true });
  const pianist = contributor("Fixture Pianist", "person", { unreviewed: true });
  const orchestra = contributor("Fixture Orchestra", "ensemble", { unreviewed: true });
  const edited = contributor("Edited Violinist", "person", { unreviewed: true });
  m.manual(edited, "name", "Edited Violinist", { actor: "admin" });
  s.c.credit(work, conductor, "conductor", { source: "derived" });
  s.c.credit(work, pianist, "soloist", { position: 2, source: "derived" });
  s.c.credit(work, orchestra, "orchestra", { position: 3, source: "derived" });
  s.c.credit(work, edited, "performer", { position: 4, source: "derived" });
  const rows = async (q = "") => (await s.read({ tab: "performers", q })).list.items.filter((item) => item.label.startsWith("Fixture") || item.label.startsWith("Edited"));
  const labels = async (q) => (await rows(q)).map((item) => item.label).sort();
  assert.deepEqual((await rows()).map((item) => [item.label, item.detail, item.badge?.label ?? null]).sort(), [
    ["Edited Violinist", "Person · Performer", null],
    ["Fixture Conductor", "Person · Conductor", "Unreviewed"],
    ["Fixture Orchestra", "Ensemble · Orchestra", "Unreviewed"],
    ["Fixture Pianist", "Person · Soloist", "Unreviewed"],
  ]);
  assert.deepEqual(await labels("role:conductor"), ["Fixture Conductor"]);
  assert.deepEqual(await labels("role:performer"), ["Edited Violinist", "Fixture Pianist"]);
  assert.deepEqual(await labels("role:ensemble"), ["Fixture Orchestra"]);
  // An admin's edit counts as reviewed; filters and words combine.
  assert.deepEqual(await labels("unreviewed"), ["Fixture Conductor", "Fixture Orchestra", "Fixture Pianist"]);
  assert.deepEqual(await labels("unreviewed pianist"), ["Fixture Pianist"]);
  assert.deepEqual(await labels("role:performer unreviewed"), ["Fixture Pianist"]);
  // An unknown role is just a search word.
  assert.deepEqual(await labels("role:harpist"), []);
  assert.match((await s.read({ tab: "performers" })).list.placeholder, /role:conductor/);
});

test("a recording's page edits who performs it: add, change role or instrument, remove; rescans keep it", async (t) => {
  const s = await setup(t);
  autoMatchTaggedWorks(s.c, { albumId: "A", actor: "admin", allowStructuredTitles: true });
  autoMatchTaggedWorks(s.c, { albumId: "B", actor: "admin", allowStructuredTitles: true });
  const recordingOf = (album) =>
    s.c.db
      .prepare(
        `SELECT DISTINCT rp.source_id AS recording, pw.source_id AS performance FROM realization r JOIN relation pw ON pw.id=r.performance_work_id
         JOIN relation rp ON rp.kind='recording_performance' AND rp.target_id=pw.source_id
         JOIN realization_item i ON i.realization_id=r.id JOIN segment g ON g.id=i.segment_id JOIN track_link l ON l.id=g.track_link_id
         WHERE CAST(json_extract(l.evidence,'$.albumId') AS TEXT)=?`,
      )
      .get(album);
  const { recording, performance } = recordingOf("A");
  const view = async () => (await s.read({ selection: recording })).view;
  const performers = async () => section(await view(), "performers").rows.map((row) => [row.label, row.detail]);
  // The scan read the orchestra from the artist tag.
  assert.deepEqual(await performers(), [["Orchestra A", "Orchestra · from tags"]]);
  const derived = section(await view(), "performers").rows[0].id;

  // Change its role: it is the admin's now, and the page stays the recording's.
  const changed = await s.ok("update-credit", { target: performance, credit: derived, role: "ensemble", instrument: "", back: recording }, recording);
  assert.equal(changed.selection, recording);
  assert.deepEqual(await performers(), [["Orchestra A", "Ensemble"]]);
  assert.deepEqual({ ...s.c.db.prepare("SELECT source,state FROM credit WHERE id=?").get(derived) }, { source: "manual", state: "active" });
  // Add a soloist; an empty instrument on a later change keeps theirs.
  const soloist = (await s.ok("create-contributor", { name: "Fixture Pianist", kind: "person" })).selection;
  await s.ok("add-credit", { target: performance, contributor: soloist, role: "soloist", instrument: "piano", back: recording }, recording);
  const soloCredit = s.c.db.prepare("SELECT id FROM credit WHERE target_id=? AND contributor_id=?").get(performance, soloist).id;
  await s.ok("update-credit", { target: performance, credit: soloCredit, role: "performer", instrument: "", back: recording }, recording);
  assert.deepEqual(await performers(), [["Orchestra A", "Ensemble"], ["Fixture Pianist", "Performer · piano"]]);
  // Wrong kinds and duplicates explain themselves.
  assert.equal((await s.mutate("update-credit", { target: performance, credit: soloCredit, role: "orchestra", back: recording }, recording)).ok, false);
  await s.ok("add-credit", { target: performance, contributor: soloist, role: "soloist", instrument: "piano", back: recording }, recording);
  const second = s.c.db.prepare("SELECT id FROM credit WHERE target_id=? AND contributor_id=? AND role='soloist'").get(performance, soloist).id;
  const duplicate = await s.mutate("update-credit", { target: performance, credit: second, role: "performer", instrument: "", back: recording }, recording);
  assert.deepEqual([duplicate.ok, duplicate.message], [false, "That role credit already exists"]);
  await s.ok("remove-credit", { target: performance, credit: second, back: recording }, recording);
  // Only this recording's performance can be written from its page.
  const other = recordingOf("B");
  const otherCredit = s.c.db.prepare("SELECT id FROM credit WHERE target_id=?").get(other.performance).id;
  const outside = await s.mutate("update-credit", { target: other.performance, credit: otherCredit, role: "ensemble", back: recording }, recording);
  assert.equal(outside.ok, false);
  // A library pass and a rescan of the album keep the admin's credits as set.
  autoMatchTaggedWorks(s.c, { actor: "admin", allowStructuredTitles: true });
  autoMatchTaggedWorks(s.c, { albumId: "A", actor: "admin", allowStructuredTitles: true });
  assert.deepEqual(await performers(), [["Orchestra A", "Ensemble"], ["Fixture Pianist", "Performer · piano"]]);
  // Remove: the page shows who is left.
  await s.ok("remove-credit", { target: performance, credit: soloCredit, back: recording }, recording);
  assert.deepEqual(await performers(), [["Orchestra A", "Ensemble"]]);
  assert.ok(section(await view(), "edit-performer"));
});

test("contributor details: sort name, spellings, instruments and dates; renames keep the old name; ensemble members", async (t) => {
  const s = await setup(t);
  const { contributorFor, contributorIndex } = await import("../src/model/contributors.js");
  const pianist = (await s.ok("create-contributor", { name: "Sviatoslav Richter", kind: "person" })).selection;
  const trio = (await s.ok("create-contributor", { name: "Fixture Trio", kind: "ensemble" })).selection;
  const details = async (id) => Object.fromEntries(section((await s.read({ selection: id })).view, "details").fields.map((f) => [f.key, f.value]));
  await s.ok("save-entity", { target: pianist, sortName: "Richter, Sviatoslav", aliases: "Swjatoslaw Richter\nS. Richter", instruments: "piano", date: "1915" }, pianist);
  await s.ok("save-entity", { target: pianist, name: "Sviatoslav Teofilovich Richter" }, pianist);
  assert.deepEqual(await details(pianist), {
    name: "Sviatoslav Teofilovich Richter",
    sortName: "Richter, Sviatoslav",
    aliases: ["Swjatoslaw Richter", "S. Richter"],
    instruments: ["piano"],
    date: "1915",
    description: "",
  });
  // The old name and every spelling are aliases: a tag spelled any of those
  // ways finds this person.
  const aliases = s.c.db.prepare("SELECT text FROM alias WHERE entity_id=? ORDER BY text").all(pianist).map((row) => row.text);
  assert.deepEqual(aliases, ["S. Richter", "Sviatoslav Richter", "Swjatoslaw Richter"]);
  for (const spelling of aliases) assert.equal(contributorFor(s.c, contributorIndex(s.c), spelling), pianist, spelling);
  // Saving the same spellings again adds none.
  await s.ok("save-entity", { target: pianist, aliases: "Swjatoslaw Richter\nS. Richter\nRichter" }, pianist);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM alias WHERE entity_id=?").get(pianist).n, 4);
  // Ensembles: renamed, founded, with members added from either page.
  await s.ok("save-entity", { target: trio, name: "Fixture Piano Trio", date: "1960" }, trio);
  assert.deepEqual(s.c.db.prepare("SELECT text FROM alias WHERE entity_id=?").all(trio).map((row) => row.text), ["Fixture Trio"]);
  const cellist = (await s.ok("create-contributor", { name: "Fixture Cellist", kind: "person" })).selection;
  await s.ok("add-member", { target: trio, other: pianist }, trio);
  await s.ok("add-member", { target: cellist, other: trio }, cellist);
  const rows = async (id) => section((await s.read({ selection: id })).view, "members").rows.map((row) => row.label);
  assert.deepEqual(await rows(trio), ["Fixture Cellist", "Sviatoslav Teofilovich Richter"]);
  assert.deepEqual(await rows(pianist), ["Fixture Piano Trio"]);
  assert.equal(section((await s.read({ selection: pianist })).view, "members").title, "Ensembles");
  assert.equal((await s.mutate("add-member", { target: trio, other: pianist }, trio)).message, "Already a member");
  assert.equal((await s.mutate("add-member", { target: trio, other: trio }, trio)).ok, false);
  await s.ok("remove-member", { target: pianist, other: trio }, pianist);
  assert.deepEqual(await rows(trio), ["Fixture Cellist"]);
  // The people lookup offers people only.
  assert.deepEqual((await s.read({ lookup: "people", q: "fixture" })).options.map((o) => o.label), ["Fixture Cellist"]);
});

test("bulk credits: set performers on ticked album tracks and change a contributor's role everywhere", async (t) => {
  const s = await setup(t);
  for (const album of ["A", "B"]) autoMatchTaggedWorks(s.c, { albumId: album, actor: "admin", allowStructuredTitles: true });
  const performanceOf = (album) =>
    s.c.db
      .prepare(
        `SELECT DISTINCT pw.source_id AS p FROM realization r JOIN relation pw ON pw.id=r.performance_work_id JOIN realization_item i ON i.realization_id=r.id
         JOIN segment g ON g.id=i.segment_id JOIN track_link l ON l.id=g.track_link_id WHERE CAST(json_extract(l.evidence,'$.albumId') AS TEXT)=?`,
      )
      .get(album).p;
  const [a, b] = [performanceOf("A"), performanceOf("B")];
  const performers = (performance) =>
    s.c.db
      .prepare("SELECT a.value AS name,k.role,k.source FROM credit k JOIN field_resolution f ON f.target_id=k.contributor_id AND f.field='name' JOIN assertion a ON a.id=f.assertion_id WHERE k.target_id=? AND k.state='active' ORDER BY k.position")
      .all(performance)
      .map((row) => [JSON.parse(row.name), row.role, row.source]);
  const conductor = (await s.ok("create-contributor", { name: "Fixture Conductor", kind: "person" })).selection;
  const ensemble = (await s.ok("create-contributor", { name: "Fixture Philharmonic", kind: "ensemble" })).selection;

  // Tick album A's tracks, then Set performers…: the page lists the recording
  // they belong to with who performs it now.
  const opened = await s.ok("performers-open", { albumId: "A", tracks: s.trackIds("A"), page: "0" }, "album:A");
  assert.match(opened.selection, /^performers:/);
  const view = (await s.read({ selection: opened.selection })).view;
  assert.equal(view.title, "Set performers on 1 recording");
  assert.deepEqual(section(view, "recordings").rows.map((row) => row.detail), ["Orchestra A (Orchestra)"]);
  await s.ok("set-performers", { token: opened.selection.slice(11), contributor: conductor, role: "conductor", instrument: "", mode: "add" }, opened.selection);
  assert.deepEqual(performers(a), [["Orchestra A", "orchestra", "derived"], ["Fixture Conductor", "conductor", "manual"]]);
  // Replace: the tag-made orchestra is removed (and stays removed), the new one is the admin's.
  await s.ok("set-performers", { token: opened.selection.slice(11), contributor: ensemble, role: "orchestra", instrument: "", mode: "replace" }, opened.selection);
  assert.deepEqual(performers(a), [["Fixture Philharmonic", "orchestra", "manual"]]);
  assert.equal(s.c.db.prepare("SELECT state FROM credit WHERE target_id=? AND source='derived'").get(a).state, "removed");
  // A role the contributor can't hold is refused before anything changes.
  assert.equal((await s.mutate("set-performers", { token: opened.selection.slice(11), contributor: ensemble, role: "conductor", mode: "add" }, opened.selection)).ok, false);
  // A recording that can't be changed is reported, and its old performers stay.
  s.c.db.exec(`CREATE TRIGGER block_a BEFORE INSERT ON credit WHEN NEW.target_id='${a}' BEGIN SELECT RAISE(ABORT,'blocked for the test'); END`);
  const blocked = await s.ok("set-performers", { token: opened.selection.slice(11), contributor: conductor, role: "soloist", instrument: "", mode: "replace" }, opened.selection);
  assert.match(blocked.message, /Updated 0 of 1 recording\. Not changed: .*blocked for the test/);
  assert.deepEqual(performers(a), [["Fixture Philharmonic", "orchestra", "manual"]]);
  s.c.db.exec("DROP TRIGGER block_a");

  // Change role on all credits: a preview, then each credit on its own.
  s.c.credit(a, conductor, "performer", { position: 5 });
  s.c.credit(b, conductor, "performer", { position: 5, source: "derived" });
  const roles = (await s.read({ selection: conductor })).view.actions.find((item) => item.label === "Change role on all credits…");
  assert.equal(roles.arguments.selection, `roles:${conductor}`);
  const preview = (await s.read({ selection: `roles:${conductor}` })).view;
  assert.deepEqual(section(preview, "credits").rows.map((row) => row.detail).sort(), ["Performer", "Performer · from tags"]);
  assert.deepEqual(section(preview, "change-roles").fields[0].options.map((o) => o.label), ["Performer (2)"]);
  s.c.db.exec(`CREATE TRIGGER block_b BEFORE UPDATE ON credit WHEN OLD.target_id='${b}' BEGIN SELECT RAISE(ABORT,'blocked for the test'); END`);
  const changed = await s.ok("change-roles", { target: conductor, from: "performer", to: "soloist" }, `roles:${conductor}`);
  assert.match(changed.message, /Changed 1 of 2 credits to soloist\. Not changed: .*blocked for the test/);
  s.c.db.exec("DROP TRIGGER block_b");
  assert.deepEqual(performers(a).filter(([name]) => name === "Fixture Conductor"), [["Fixture Conductor", "soloist", "manual"]]);
  assert.deepEqual(performers(b).filter(([name]) => name === "Fixture Conductor"), [["Fixture Conductor", "performer", "derived"]]);
  await s.ok("change-roles", { target: conductor, from: "performer", to: "soloist" }, `roles:${conductor}`);
  assert.deepEqual(performers(b).filter(([name]) => name === "Fixture Conductor"), [["Fixture Conductor", "soloist", "manual"]]);
  // A role an ensemble can't hold is refused.
  assert.equal((await s.mutate("change-roles", { target: ensemble, from: "orchestra", to: "soloist" }, `roles:${ensemble}`)).ok, false);
  // Contributor pages label a recording by work and album, and open the recording.
  const row = section((await s.read({ selection: conductor })).view, "credits").rows[0];
  assert.match(row.label, /Symphony No\. ?5.* · Album [AB]/);
  assert.equal(s.c.db.prepare("SELECT kind FROM entity WHERE id=?").get(row.selection).kind, "recording");
});

test("This is…: an unreviewed name from tags becomes another spelling of a known contributor", async (t) => {
  const s = await setup(t);
  autoMatchTaggedWorks(s.c, { albumId: "A", actor: "admin", allowStructuredTitles: true });
  const derived = s.c.db.prepare("SELECT contributor_id AS id FROM credit WHERE source='derived'").get().id;
  const known = (await s.ok("create-contributor", { name: "Fixture Philharmonic", kind: "ensemble" })).selection;
  const person = (await s.ok("create-contributor", { name: "Fixture Person", kind: "person" })).selection;
  const form = section((await s.read({ selection: derived })).view, "map");
  assert.equal(form.title, "This is…");
  assert.equal(form.fields[0].lookup, "ensembles");
  // A record nobody made from tags has no such question.
  assert.equal(section((await s.read({ selection: known })).view, "map"), undefined);
  assert.equal((await s.mutate("map-contributor", { target: derived, into: person }, derived)).ok, false);
  const mapped = await s.ok("map-contributor", { target: derived, into: known }, derived);
  assert.equal(mapped.selection, known);
  assert.match(mapped.message, /“Orchestra A” is now “Fixture Philharmonic”/);
  assert.equal(s.c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(derived).deleted_at !== null, true);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM credit WHERE contributor_id=? AND state='active'").get(known).n, 1);
  assert.deepEqual(s.c.db.prepare("SELECT text FROM alias WHERE entity_id=?").all(known).map((row) => row.text), ["Orchestra A"]);
});

test("contributor merges and deletions are undoable from Activity, exactly, unless a credit changed since", async (t) => {
  const s = await setup(t);
  autoMatchTaggedWorks(s.c, { albumId: "A", actor: "admin", allowStructuredTitles: true });
  const performance = s.c.db.prepare("SELECT target_id AS id FROM credit WHERE source='derived'").get().id;
  const work = (await s.ok("create-work", { title: "Fixture Concerto", composer: "", movements: ["I"] })).selection;
  const keep = (await s.ok("create-contributor", { name: "Fixture Pianist", kind: "person" })).selection;
  const drop = (await s.ok("create-contributor", { name: "F. Pianist", kind: "person" })).selection;
  const trio = (await s.ok("create-contributor", { name: "Fixture Trio", kind: "ensemble" })).selection;
  await s.ok("save-entity", { target: drop, aliases: "Pianist F." }, drop);
  await s.ok("add-member", { target: trio, other: drop }, trio);
  s.c.credit(performance, drop, "soloist", { instrument: "piano", position: 5 });
  s.c.credit(work, keep, "soloist", { position: 2 });
  s.c.externalIdentity(drop, "musicbrainz", "artist", "pianist-mbid", { evidence: { source: "test" } });
  const dump = () =>
    JSON.stringify(
      ["entity", "credit", "alias", "external_identity", "relation", "assertion", "field_resolution"].map((table) => [
        table,
        s.c.db
          .prepare(`SELECT * FROM ${table} WHERE ${table === "entity" ? "id" : table === "credit" ? "contributor_id" : table === "relation" ? "source_id" : ["alias", "external_identity"].includes(table) ? "entity_id" : "target_id"} IN (?,?) ORDER BY 1`)
          .all(keep, drop)
          .map((row) => ({ ...row })),
      ]),
    );
  const before = dump();
  const merged = await s.ok("merge-entity", { target: drop, into: keep, confirm: true }, drop);
  assert.equal(merged.message, "Merged. Undo it from Activity.");
  assert.notEqual(dump(), before);
  // Activity lists it; undo puts every row back as it was.
  const change = (await s.read({ tab: "activity" })).list.items.find((item) => item.label === "Merged “F. Pianist” into “Fixture Pianist”");
  assert.ok(change);
  assert.equal(section((await s.read({ selection: change.selection })).view, "change").items[0].value, "Merge of two people or ensembles");
  await s.ok("undo-change", { id: change.selection.slice(7) }, change.selection);
  assert.equal(dump(), before);

  // A credit given to either record since blocks the undo, and nothing changes.
  await s.ok("merge-entity", { target: drop, into: keep, confirm: true }, drop);
  const second = (await s.read({ tab: "activity" })).list.items.find((item) => item.label === "Merged “F. Pianist” into “Fixture Pianist”" && !item.badge);
  s.c.credit(work, keep, "performer", { position: 3 });
  const after = dump();
  const refused = await s.mutate("undo-change", { id: second.selection.slice(7) }, second.selection);
  assert.deepEqual([refused.ok, /changed after this/.test(refused.message)], [false, true]);
  assert.equal(dump(), after);

  // Deleting an unused person is undoable too.
  const spare = (await s.ok("create-contributor", { name: "Spare Person", kind: "person" })).selection;
  const deleted = await s.ok("delete-entity", { target: spare }, spare);
  assert.match(deleted.message, /Undo it from Activity/);
  const removal = (await s.read({ tab: "activity" })).list.items.find((item) => item.label === "Deleted “Spare Person”");
  await s.ok("undo-change", { id: removal.selection.slice(7) }, removal.selection);
  assert.equal(s.c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(spare).deleted_at, null);

  // E11: a work restored after its composer was deleted has its composer back.
  const composer = (await s.ok("create-contributor", { name: "Fixture Composer", kind: "person" })).selection;
  const piece = (await s.ok("create-work", { title: "Fixture Sonata", composer, movements: ["I"] })).selection;
  await s.ok("delete-entity", { target: piece }, piece);
  await s.ok("delete-entity", { target: composer }, composer);
  const workChange = (await s.read({ tab: "activity" })).list.items.find((item) => item.label === "Deleted “Fixture Sonata”").selection;
  await s.ok("undo-change", { id: workChange.slice(7) }, workChange);
  assert.equal(s.c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(composer).deleted_at, null);
  assert.deepEqual(s.c.db.prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer'").all(piece).map((row) => row.contributor_id), [composer]);
});

test("a name mapped with This is… stays mapped through rescans, and the mapping can be undone", async (t) => {
  const s = await setup(t);
  for (const album of ["A", "B"]) autoMatchTaggedWorks(s.c, { albumId: album, actor: "admin", allowStructuredTitles: true });
  const named = (name) => s.c.db.prepare("SELECT a.value FROM entity e JOIN field_resolution f ON f.target_id=e.id AND f.field='name' JOIN assertion a ON a.id=f.assertion_id WHERE e.deleted_at IS NULL AND a.value=?").all(JSON.stringify(name)).length;
  const derived = s.c.db.prepare("SELECT k.contributor_id AS id FROM credit k JOIN field_resolution f ON f.target_id=k.contributor_id AND f.field='name' JOIN assertion a ON a.id=f.assertion_id WHERE a.value=?").get(JSON.stringify("Orchestra A")).id;
  const known = (await s.ok("create-contributor", { name: "Fixture Philharmonic", kind: "ensemble" })).selection;
  await s.ok("map-contributor", { target: derived, into: known }, derived);
  autoMatchTaggedWorks(s.c, { actor: "admin", allowStructuredTitles: true });
  autoMatchTaggedWorks(s.c, { albumId: "A", actor: "admin", allowStructuredTitles: true });
  // No "Orchestra A" comes back: the spelling is the Philharmonic's.
  assert.equal(named("Orchestra A"), 0);
  const change = (await s.read({ tab: "activity" })).list.items.find((item) => item.label === "Merged “Orchestra A” into “Fixture Philharmonic”");
  await s.ok("undo-change", { id: change.selection.slice(7) }, change.selection);
  assert.equal(named("Orchestra A"), 1);
  assert.equal(s.c.db.prepare("SELECT contributor_id AS id FROM credit WHERE source='derived' AND target_id=(SELECT target_id FROM credit WHERE contributor_id=?)").get(derived).id, derived);
});

test("identity and credit reviews: merge or keep apart, use one record, keep or replace a conductor; dismissals hold", async (t) => {
  const s = await setup(t);
  const { contributorFor, contributorIndex } = await import("../src/model/contributors.js");
  const m = new Metadata(s.c);
  const make = (name, kind) => {
    const id = s.c.createEntity(kind);
    m.manual(id, "name", name, { actor: "admin" });
    return id;
  };
  const open = () => s.c.db.prepare("SELECT id,kind,target_id,json_extract(evidence,'$.reason') AS reason FROM review_item WHERE status='open' AND kind IN ('contributor_identity','credit_conflict') ORDER BY created_at").all();
  const decide = async (review) => section((await s.read({ selection: `review:${review}` })).view, "decide").rows;
  const rescan = () => {
    autoMatchTaggedWorks(s.c, { actor: "admin", allowStructuredTitles: true });
    for (const album of ["A", "B"]) autoMatchTaggedWorks(s.c, { albumId: album, actor: "admin", allowStructuredTitles: true });
  };

  // Same name, different MusicBrainz IDs: merge or keep apart for good.
  const first = contributorFor(s.c, contributorIndex(s.c), "John Williams", { mbid: "jw-guitar" });
  const second = contributorFor(s.c, contributorIndex(s.c), "John Williams", { mbid: "jw-composer" });
  const [identity] = open();
  assert.deepEqual([identity.kind, identity.target_id, identity.reason], ["contributor_identity", second, "same-name-different-id"]);
  assert.deepEqual((await decide(identity.id)).map((row) => row.id), [`merge-${first}`, "separate"]);
  await s.ok("keep-distinct", { id: identity.id }, `review:${identity.id}`);
  assert.ok(s.c.db.prepare("SELECT 1 FROM match_suppression WHERE key=?").get(`distinct:${[first, second].sort().join("|")}`));

  // A tag name two records share: the scan credits neither and asks.
  const [orchestraA, orchestraA2] = [make("Orchestra A", "ensemble"), make("Orchestra A", "ensemble")];
  const [orchestraB] = [make("Orchestra B", "ensemble"), make("Orchestra B", "ensemble")];
  rescan();
  const ambiguous = open().filter((review) => review.reason === "ambiguous-name");
  assert.equal(ambiguous.length, 2);
  const onA = ambiguous.find((review) => s.c.db.prepare("SELECT 1 FROM review_item WHERE id=? AND json_extract(evidence,'$.name')='Orchestra A'").get(review.id));
  const onB = ambiguous.find((review) => review !== onA);
  assert.deepEqual((await decide(onA.id)).filter((row) => row.id.startsWith("use-")).map((row) => row.selection).sort(), [orchestraA, orchestraA2].sort());
  await s.ok("use-contributor", { id: onA.id, contributor: orchestraA2 }, `review:${onA.id}`);
  assert.deepEqual(
    s.c.db.prepare("SELECT contributor_id,role,source FROM credit WHERE target_id=? AND state='active'").all(onA.target_id).map((row) => ({ ...row })),
    [{ contributor_id: orchestraA2, role: "orchestra", source: "manual" }],
  );
  // Dismissed on B: the next scans don't ask again about the same thing.
  await s.ok("resolve-review", { id: onB.id }, `review:${onB.id}`);
  rescan();
  assert.equal(open().filter((review) => review.reason === "ambiguous-name").length, 0);
  assert.ok(orchestraB);

  // Tags name a different conductor than the one an admin credited.
  const performance = onA.target_id;
  const conductor = make("Fixture Conductor", "person");
  s.c.credit(performance, conductor, "conductor", { position: 9 });
  const tagConductor = (name) =>
    s.c.db.prepare("UPDATE track_link SET evidence=json_set(evidence,'$.hints.conductor',?) WHERE CAST(json_extract(evidence,'$.albumId') AS TEXT)='A'").run(name);
  tagConductor("Tag Conductor");
  rescan();
  let [conflict] = open();
  assert.deepEqual([conflict.kind, conflict.target_id], ["credit_conflict", performance]);
  assert.deepEqual((await decide(conflict.id)).map((row) => row.label), ["Keep “Fixture Conductor”", "Use “Tag Conductor”"]);
  // Keep: remembered until the tags change.
  await s.ok("resolve-review", { id: conflict.id }, `review:${conflict.id}`);
  rescan();
  assert.deepEqual(open(), []);
  tagConductor("Other Conductor");
  rescan();
  [conflict] = open();
  assert.equal(conflict.kind, "credit_conflict");
  await s.ok("use-contributor", { id: conflict.id, contributor: "tagged" }, `review:${conflict.id}`);
  const conductors = s.c.db
    .prepare("SELECT a.value FROM credit k JOIN field_resolution f ON f.target_id=k.contributor_id AND f.field='name' JOIN assertion a ON a.id=f.assertion_id WHERE k.target_id=? AND k.role='conductor' AND k.state='active'")
    .all(performance)
    .map((row) => JSON.parse(row.value));
  assert.deepEqual(conductors, ["Other Conductor"]);
  rescan();
  assert.deepEqual(open(), []);
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
  assert.equal(section((await s.read({ selection: `${a}!recordings` })).view, "recordings").rows.length, 2);
  assert.equal((await s.read({ tab: "works" })).list.items.length, 1);
  const empty = (await s.ok("create-work", { title: "Sketch", composer: "", movements: [] })).selection;
  const del = section((await s.read({ selection: `${empty}!advanced` })).view, "advanced").actions.find((x) => x.command === "delete-entity");
  assert.ok(del.confirm);
  await s.ok(del.command, del.arguments, empty);
  assert.equal((await s.read({ tab: "works" })).list.items.length, 1);
});

// ---- v0.1 data-integrity regressions -----------------------------------------

const createFrom = (s, album, title) =>
  s.ok("create-work-from-album", { albumId: album, tracks: s.trackIds(album), title, composer: "", composerName: "Ludwig van Beethoven" }, `album:${album}`);
const realizationOf = (s, work) => s.c.db.prepare("SELECT id FROM realization WHERE work_id=?").get(work)?.id;
const live = (s, id) => s.c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(id).deleted_at == null;
const workOfTrack = (s, track) =>
  s.c.db
    .prepare("SELECT r.work_id FROM segment g JOIN realization_item i ON i.segment_id=g.id JOIN realization r ON r.id=i.realization_id WHERE g.track_link_id=?")
    .all(track)
    .map((row) => row.work_id);

test("#1 unassign removes the whole attachment, so the album can be matched again", async (t) => {
  const s = await setup(t);
  const work = (await createFrom(s, "A", "Symphony No. 5 in C minor, Op. 67")).selection;
  const realization = realizationOf(s, work);
  const recordings = s.c.db.prepare("SELECT source_id FROM relation WHERE kind='recording_performance'").all().map((r) => r.source_id);
  s.c.db.prepare("INSERT INTO user_work_state VALUES (2,?,1,?,1)").run(work, realization);
  s.c.db.prepare("INSERT INTO admin_work_pick VALUES (?,?,1,1)").run(work, realization);
  await s.ok("unassign-album", { albumId: "A", work }, "album:A");
  for (const table of ["segment", "segment_content", "recording_content", "realization", "admin_work_pick"])
    assert.equal(s.c.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} left behind`);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM relation WHERE kind IN ('performance_work','recording_performance')").get().n, 0);
  assert.ok(recordings.every((id) => !live(s, id)), "per-track recordings are removed");
  assert.deepEqual({ ...s.c.db.prepare("SELECT favourite,picked_realization_id FROM user_work_state WHERE user_id=2").get() }, { favourite: 1, picked_realization_id: null });
  assert.ok(live(s, work), "the work stays");
  // The movement is no longer "in use", and the album shows as unassigned.
  const movement = s.c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").get(work).target_id;
  const album = (await s.read({ selection: "album:A" })).view;
  assert.ok(section(album, "tracks").rows.every((track) => track.detail.startsWith("Not in a work")));
  // A rescan respects the unassign: no re-attachment, no duplicate work.
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "A", allowStructuredTitles: true }).created, 0);
  assert.ok(s.trackIds("A").every((track) => !workOfTrack(s, track).length));
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='work' AND deleted_at IS NULL").get().n, 1);
  // Rematch: the admin assigns the album again, then a later rescan extends it normally.
  const chosen = await s.ok("choose-album-work", { albumId: "A", work }, "album:A");
  const assign = section((await s.read({ selection: chosen.selection })).view, "assign");
  assert.deepEqual(assign.arguments.tracks, s.trackIds("A"), "every track is offered again");
  await s.ok("assign-album", { ...assign.arguments, mapping: assign.fields[0].value }, chosen.selection);
  assert.ok(s.trackIds("A").every((track) => workOfTrack(s, track).join() === work));
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM realization WHERE work_id=?").get(work).n, 1);
  // Unassigning again lets an admin delete a movement it no longer covers.
  await s.ok("unassign-album", { albumId: "A", work }, "album:A");
  await s.ok("delete-movement", { work, movement }, work);
  // And with nothing attached the work itself can be deleted.
  await s.ok("delete-entity", { target: work }, work);
});

test("#2/#3 merging keeps provider identities and every user's favourites and picks", async (t) => {
  const s = await setup(t);
  const a = (await createFrom(s, "A", "Symphony No. 5")).selection;
  const b = (await createFrom(s, "B", "Symphony No. 5 (dup)")).selection;
  const [ra, rb] = [realizationOf(s, a), realizationOf(s, b)];
  assert.equal(s.c.externalIdentity(b, "musicbrainz", "work", "mb-sym5"), true);
  const bMovement = s.c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? AND position=1").get(b).target_id;
  s.c.externalIdentity(bMovement, "musicbrainz", "work", "mb-sym5-i");
  const state = s.c.db.prepare("INSERT INTO user_work_state VALUES (?,?,?,?,?)");
  state.run(2, b, 1, null, 5); // favourite only on the dropped work
  state.run(3, a, 0, null, 5); // row on both; the pick lives on the dropped work
  state.run(3, b, 1, rb, 6);
  state.run(4, a, 1, ra, 7); // the kept work's own pick wins
  state.run(4, b, 0, rb, 8);
  await s.ok("merge-entity", { target: b, into: a, confirm: true }, b);
  const row = (user) => ({ ...s.c.db.prepare("SELECT favourite,picked_realization_id AS pick FROM user_work_state WHERE user_id=? AND work_id=?").get(user, a) });
  assert.deepEqual(row(2), { favourite: 1, pick: null });
  assert.deepEqual(row(3), { favourite: 1, pick: rb });
  assert.deepEqual(row(4), { favourite: 1, pick: ra });
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM user_work_state WHERE work_id=?").get(b).n, 0);
  const owner = (record) => s.c.db.prepare("SELECT entity_id FROM external_identity WHERE record_id=? AND state='active'").get(record)?.entity_id;
  assert.equal(owner("mb-sym5"), a);
  const aMovement = s.c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? AND position=1").get(a).target_id;
  assert.equal(owner("mb-sym5-i"), aMovement);
  // Post-merge matching by MusicBrainz finds the kept work, not the deleted one.
  // Free album B without an admin Unassign (which rescans would honour).
  for (const track of s.trackIds("B"))
    for (const { id } of s.c.db.prepare("SELECT i.id FROM realization_item i JOIN segment g ON g.id=i.segment_id WHERE g.track_link_id=?").all(track))
      s.c.detachItem(id, { dropRecording: true });
  const providerMatches = new Map(s.trackIds("B").map((track) => [track, { workId: "mb-sym5", work: "Symphony No. 5", aliases: [], composers: ["Ludwig van Beethoven"] }]));
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "B", providerMatches }).created, 1);
  assert.ok(s.trackIds("B").every((track) => workOfTrack(s, track).join() === a));
  // Catalogues merged before this fix: identities left on the deleted work move over.
  s.c.db.prepare("UPDATE external_identity SET entity_id=? WHERE record_id='mb-sym5'").run(b);
  assert.equal(repairMergedIdentities(s.c), 1);
  assert.equal(owner("mb-sym5"), a);
});

test("#2 merging people moves their provider identities too", async (t) => {
  const s = await setup(t);
  const keep = (await s.ok("create-contributor", { name: "Carlos Kleiber", kind: "person" })).selection;
  const drop = (await s.ok("create-contributor", { name: "C. Kleiber", kind: "person" })).selection;
  s.c.externalIdentity(drop, "musicbrainz", "artist", "mb-kleiber");
  await s.ok("merge-entity", { target: drop, into: keep, confirm: true }, drop);
  assert.equal(s.c.db.prepare("SELECT entity_id FROM external_identity WHERE record_id='mb-kleiber'").get().entity_id, keep);
});

test("#15 tracks marked Not classical are skipped when creating a work, and Skip works per track", async (t) => {
  const s = await setup(t);
  const tracks = s.trackIds("A");
  await s.ok("set-classification", { tracks: [tracks[3]], state: "not_classical" }, "album:A");
  const { form } = await newAlbumForm(s, "A");
  const include = form.fields.find((f) => f.key === "include");
  assert.equal(include.type, "mapping");
  assert.deepEqual(include.value, ["include", "include", "include", ""]);
  // Without per-track choices (older hosts), the removed track is still left out.
  const { include: _skip, ...legacy } = form.arguments;
  const work = (await s.ok("create-work-from-album", { ...legacy, title: "Symphony No. 5", composer: "", composerName: "Ludwig van Beethoven" }, "album:A")).selection;
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM relation WHERE kind='movement' AND source_id=?").get(work).n, 3);
  assert.deepEqual(workOfTrack(s, tracks[3]), []);
  assert.deepEqual({ ...s.c.db.prepare("SELECT state,pinned FROM classification WHERE target_id=?").get(tracks[3]) }, { state: "not_classical", pinned: 1 });
  // An explicit Skip leaves out a classical track as well.
  const b = s.trackIds("B");
  const second = (await s.ok("create-work-from-album", { albumId: "B", tracks: b, include: ["include", "", "include", "include"], title: "Symphony No. 5 B", composer: "", composerName: "" }, "album:B")).selection;
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM relation WHERE kind='movement' AND source_id=?").get(second).n, 3);
  assert.deepEqual(workOfTrack(s, b[1]), []);
  assert.equal((await s.mutate("create-work-from-album", { albumId: "B", tracks: [b[1]], include: [""], title: "Nothing", composer: "", composerName: "" }, "album:B")).ok, false);
  assert.equal((await s.mutate("create-work-from-album", { albumId: "B", tracks: [b[1]], include: [], title: "Nothing", composer: "", composerName: "" }, "album:B")).ok, false);
});

test("#7 an ambiguous match queues a review and creates no work or composer", async (t) => {
  const s = await setup(t);
  // Two same-key works already exist (say, an admin kept them apart on purpose).
  const first = (await s.ok("create-work", { title: "Symphony No. 5 in C minor, Op. 67", composer: "", movements: titles })).selection;
  const second = (await s.ok("create-work", { title: "Symphony No. 5 in C minor, Op. 67", composer: "", movements: titles, createAnyway: true })).selection;
  const beethoven = (await s.ok("create-contributor", { name: "Ludwig van Beethoven", kind: "person" })).selection;
  for (const work of [first, second]) await s.ok("add-credit", { target: work, contributor: beethoven, role: "composer", instrument: "" }, work);
  const count = (kind) => s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind=? AND deleted_at IS NULL").get(kind).n;
  const before = { works: count("work"), people: count("person") };
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "A", allowStructuredTitles: true }).created, 0);
  assert.deepEqual({ works: count("work"), people: count("person") }, before);
  const review = s.c.db.prepare("SELECT * FROM review_item WHERE kind='auto_match' AND status='open'").get();
  assert.deepEqual(JSON.parse(review.evidence).candidates.sort(), [first, second].sort());
  // Rescans don't pile up duplicates either.
  autoMatchTaggedWorks(s.c, { albumId: "A", allowStructuredTitles: true });
  assert.equal(count("work"), before.works);
  // The review names the choice and links each candidate; assigning resolves it.
  const items = (await s.read({ tab: "review" })).list.items;
  const view = (await s.read({ selection: items[0].selection })).view;
  assert.match(view.subtitle, /Several works match/);
  assert.deepEqual(view.actions.filter((a) => a.label.startsWith("Open “Symphony")).map((a) => a.arguments.selection).sort(), [first, second].sort());
  const chosen = await s.ok("choose-album-work", { albumId: "A", work: first }, "album:A");
  const assign = section((await s.read({ selection: chosen.selection })).view, "assign");
  await s.ok("assign-album", { ...assign.arguments, mapping: assign.fields[0].value }, chosen.selection);
  assert.equal(s.c.db.prepare("SELECT status FROM review_item WHERE id=?").get(review.id).status, "resolved");
});

test("#7 a composer name several people share queues a review instead of adding another", async (t) => {
  const s = await setup(t);
  // Two different people the admin keeps apart, both credited as composers.
  for (const title of ["Sketch 1", "Sketch 2"]) {
    const work = (await s.ok("create-work", { title, composer: "", movements: [] })).selection;
    const person = (await s.ok("create-contributor", { name: "Ludwig van Beethoven", kind: "person" })).selection;
    await s.ok("add-credit", { target: work, contributor: person, role: "composer", instrument: "" }, work);
  }
  const people = s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='person' AND deleted_at IS NULL").get().n;
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "A", allowStructuredTitles: true }).created, 0);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='person' AND deleted_at IS NULL").get().n, people);
  const review = s.c.db.prepare("SELECT evidence FROM review_item WHERE kind='auto_match' AND status='open'").get();
  assert.equal(JSON.parse(review.evidence).reason, "ambiguous-composer");
});

// Matching reads track hints straight from the catalogue; these set them.
const setHints = (s, track, hints) => {
  const row = s.c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(track);
  const evidence = JSON.parse(row.evidence);
  Object.assign(evidence.hints, hints);
  s.c.db.prepare("UPDATE track_link SET evidence=? WHERE id=?").run(JSON.stringify(evidence), track);
};
const liveWorks = (s) => s.c.db.prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL").all().map((r) => r.id);

test("#11 every role the editor offers saves, Lyricist included, and wrong kinds explain themselves", async (t) => {
  const s = await setup(t);
  const work = (await s.ok("create-work", { title: "Lieder", composer: "", movements: [] })).selection;
  const poet = (await s.ok("create-contributor", { name: "Wilhelm Müller", kind: "person" })).selection;
  const choir = (await s.ok("create-contributor", { name: "RIAS Kammerchor", kind: "ensemble" })).selection;
  const form = section((await s.read({ selection: `${work}!add-credit` })).view, "add-credit");
  const roles = form.fields.find((f) => f.key === "role").options.map((o) => o.value);
  assert.ok(roles.includes("lyricist"));
  for (const role of roles) {
    const who = ["orchestra", "ensemble", "choir"].includes(role) ? choir : poet;
    const saved = await s.mutate("add-credit", { target: work, contributor: who, role, instrument: "" }, work);
    assert.equal(saved.ok, true, `${role}: ${saved.message}`);
  }
  const wrong = await s.mutate("add-credit", { target: work, contributor: choir, role: "lyricist", instrument: "x" }, work);
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /ensemble can't be credited as lyricist/);
});

test("#6 stale tokens and tokens for another page can't write", async (t) => {
  const s = await setup(t);
  const a = (await s.ok("create-work", { title: "Sonata A", composer: "", movements: [] })).selection;
  const b = (await s.ok("create-work", { title: "Sonata B", composer: "", movements: [] })).selection;
  const raw = (revision, command, values) =>
    mutateRaw({ ...s.input, mutation: { revision, command, values } });
  const save = (revision, target, title) => raw(revision, "save-entity", { target, title });
  // A token for work A (or for a blank page) can't edit work B.
  const tokenA = (await s.read({ selection: a })).revision;
  assert.equal((await save(tokenA, b, "Hijacked")).status, 409);
  assert.equal((await save((await s.read()).revision, b, "Hijacked")).status, 409);
  assert.equal((await save(`${a}|0:0:0:0:0:0`, a, "Forged")).status, 409);
  // Two tabs on one album: the second assign is rejected, not merged in.
  const work = (await s.ok("create-work", { title: "Symphony No. 5 in C minor, Op. 67", composer: "", movements: titles })).selection;
  const chosen = await s.ok("choose-album-work", { albumId: "A", work }, "album:A");
  const page = await s.read({ selection: chosen.selection });
  const assign = section(page.view, "assign");
  const movement = assign.fields[0].value[0];
  await s.ok("save-entity", { target: movement, title: "Renamed in another tab" }, movement);
  assert.equal((await raw(page.revision, "assign-album", { ...assign.arguments, mapping: assign.fields[0].value })).status, 409,
    "a chosen work's movement labels belong to the album token");
  const refreshed = await s.read({ selection: chosen.selection });
  const first = await raw(refreshed.revision, "assign-album", { ...assign.arguments, mapping: assign.fields[0].value });
  assert.equal(first.ok, true, first.message);
  const attached = await s.read({ selection: "album:A" });
  await s.ok("save-entity", { target: movement, title: "Renamed after attachment" }, movement);
  assert.equal((await raw(attached.revision, "unassign-album", { albumId: "A", work })).status, 409,
    "attached works' movement labels belong to the album token too");
  await s.ok("unassign-album", { albumId: "A", work }, "album:A");
  assert.equal((await raw(page.revision, "assign-album", { ...assign.arguments, mapping: assign.fields[0].value })).status, 409);
  // A rescan that changes nothing leaves an open album page valid.
  const before = (await s.read({ selection: "album:A" })).revision;
  for (const track of s.trackIds("A")) classify(s.c, track, JSON.parse(s.c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(track).evidence).hints);
  assert.equal((await s.read({ selection: "album:A" })).revision, before);
  // Classification changes on an album page make its token stale too.
  const album = (await s.read({ selection: "album:A" })).revision;
  await s.ok("set-classification", { tracks: [s.trackIds("A")[0]], state: "not_classical" }, "album:A");
  assert.equal((await raw(album, "set-classification", { tracks: [s.trackIds("A")[1]], state: "not_classical" })).status, 409);
});

test("#21/#16 every conflicting provider field is kept and can be settled from the review", async (t) => {
  const s = await setup(t);
  const work = (await s.ok("create-work", { title: "Quartet", composer: "", movements: [] })).selection;
  const m = new Metadata(s.c);
  m.refresh(work, "musicbrainz", "mb-q", { nickname: "Emperor", key: "C major" });
  m.refresh(work, "openopus", "oo-q", { nickname: "Kaiser", key: "C minor" });
  m.resolve(work, "nickname");
  m.resolve(work, "key");
  const review = s.c.db.prepare("SELECT * FROM review_item WHERE kind='provider_conflict' AND status='open'").get();
  assert.deepEqual(Object.keys(JSON.parse(review.evidence).entries).sort(), ["key", "nickname"]);
  const view = (await s.read({ selection: `review:${review.id}` })).view;
  assert.ok(section(view, "evidence").items.some((i) => i.label === "Conflicting key" && /C minor/.test(i.value)));
  const choose = (pattern) => view.actions.find((a) => a.command === "choose-provider-value" && pattern.test(a.label));
  await s.ok("choose-provider-value", choose(/key: use Open Opus/).arguments, `review:${review.id}`);
  assert.equal(m.resolve(work, "key").value, "C minor");
  assert.equal(m.resolve(work, "key").pinned, true);
  assert.equal(s.c.db.prepare("SELECT status FROM review_item WHERE id=?").get(review.id).status, "open", "nickname still waits");
  await s.ok("choose-provider-value", choose(/nickname: use MusicBrainz/).arguments, `review:${review.id}`);
  assert.equal(m.resolve(work, "nickname").value, "Emperor");
  assert.equal(s.c.db.prepare("SELECT status FROM review_item WHERE id=?").get(review.id).status, "resolved");
});

test("#16 duplicate-work and same-name reviews offer the merge that settles them", async (t) => {
  const s = await setup(t);
  const a = (await s.ok("create-work", { title: "Sketch", composer: "", movements: [] })).selection;
  const b = (await s.ok("create-work", { title: "Sketch", composer: "", movements: [], createAnyway: true })).selection;
  s.c.review("identity", b, { reason: "duplicate-work", keep: a });
  let review = s.c.db.prepare("SELECT id FROM review_item WHERE target_id=?").get(b).id;
  let view = (await s.read({ selection: `review:${review}` })).view;
  // Side by side; Merge leads to a step that shows both outcomes and asks
  // which work stays.
  assert.deepEqual(section(view, "compare").rows.find((r) => r.id === "Title").badge.label, "Same");
  const decide = section(view, "decide");
  assert.deepEqual(decide.rows.map((row) => row.id), [`merge-${a}`, "separate"]);
  const step = decide.rows[0].actions[0].arguments.selection;
  assert.equal(step, `merge:${b}:${a}:${review}`);
  const stepView = (await s.read({ selection: step })).view;
  assert.equal(section(stepView, "keep-second").items[0].selection, a);
  let merge = section(stepView, "merge");
  assert.deepEqual(merge.arguments, { target: b, into: a, confirm: true, review });
  assert.deepEqual(stepView.actions.find((x) => x.label === "Cancel").arguments, { selection: `review:${review}` }, "Cancel returns to the review");
  const merged = await s.ok(merge.command, { ...merge.arguments, direction: "into" }, step);
  assert.equal(merged.selection, "", "the queue is empty, so the list comes back");
  assert.deepEqual(liveWorks(s), [a]);
  // The merge is undoable from History.
  const history = await s.read({ tab: "activity" });
  history.list.items.shift();
  assert.match(history.list.items[0].label, /^Merged “Sketch” into “Sketch”$/);
  const undo = (await s.read({ selection: history.list.items[0].selection })).view.actions.find((x) => x.command === "undo-change");
  await s.ok("undo-change", undo.arguments, history.list.items[0].selection);
  assert.deepEqual(liveWorks(s).sort(), [a, b].sort());
  // Keep both: resolved, and remembered.
  const again = s.c.db.prepare("SELECT id FROM review_item WHERE target_id=? AND status='open'").get(b)?.id;
  assert.ok(again, "the review comes back with the work");
  view = (await s.read({ selection: `review:${again}` })).view;
  await s.ok("keep-distinct", section(view, "decide").rows.find((row) => row.id === "separate").actions[0].arguments, `review:${again}`);
  assert.ok(s.c.db.prepare("SELECT 1 FROM match_suppression WHERE key LIKE 'distinct:%'").get());
  const p1 = (await s.ok("create-contributor", { name: "Johann Strauss", kind: "person" })).selection;
  const p2 = (await s.ok("create-contributor", { name: "Johann Strauss", kind: "person" })).selection;
  s.c.review("identity", p2, { reason: "same-name-composers", name: "Johann Strauss" });
  review = s.c.db.prepare("SELECT id FROM review_item WHERE target_id=?").get(p2).id;
  const choice = section((await s.read({ selection: `review:${review}` })).view, "decide").rows[0].actions[0].arguments.selection;
  merge = section((await s.read({ selection: choice })).view, "merge");
  assert.deepEqual(merge.arguments, { target: p2, into: p1, confirm: true, review });
  const people = await s.ok(merge.command, { ...merge.arguments, direction: "into" }, choice);
  assert.equal(people.selection, "", "the last review is settled");
  assert.ok(s.c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(p2).deleted_at);
});

test("#22 creating a work that already exists asks first, and the album page points to it", async (t) => {
  const s = await setup(t);
  const work = (await s.ok("create-work-from-album", { albumId: "A", tracks: s.trackIds("A"), title: "Symphony No. 5 in C minor, Op. 67", composer: "", composerName: "Ludwig van Beethoven" }, "album:A")).selection;
  const album = (await albumChoice(s, "B")).view;
  assert.deepEqual(section(album, "likely-works").rows.map((r) => r.id), [work]);
  assert.ok((await newAlbumForm(s, "B")).form.fields.some((f) => f.key === "createAnyway"));
  const values = { albumId: "B", tracks: s.trackIds("B"), title: "Symphony No.5, Op. 67", composer: "", composerName: "Ludwig van Beethoven" };
  const refused = await s.mutate("create-work-from-album", values, "album:B");
  assert.equal(refused.ok, false);
  assert.match(refused.message, /similar work already exists: “Symphony No. 5 in C minor, Op. 67”/);
  assert.equal((await s.mutate("create-work", { title: "Symphony no. 5 in C minor, op. 67", composer: "", movements: [] })).ok, false);
  assert.deepEqual(liveWorks(s), [work]);
  assert.equal((await s.mutate("create-work-from-album", { ...values, createAnyway: true }, "album:B")).ok, true);
});

test("#5 a whole piece on one track becomes a work; a lone movement does not", async (t) => {
  const s = await setup(t);
  const [piece] = s.trackIds("C");
  setHints(s, piece, { title: "Danse macabre, Op. 40", work: "Danse macabre, Op. 40", composer: ["Camille Saint-Saëns"], genres: ["Classical"] });
  classify(s.c, piece, {}, { manual: "classical", actor: "1" });
  // Album B with one track left: a movement of a larger work, not a whole piece.
  for (const track of s.trackIds("B").slice(1)) s.c.db.prepare("UPDATE track_link SET state='missing' WHERE id=?").run(track);
  setHints(s, s.trackIds("B")[0], { work: "Symphony No. 5 in C minor, Op. 67" });
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "C" }).created, 1);
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "B" }).created, 0);
  const [work] = liveWorks(s);
  assert.equal(new Metadata(s.c).resolve(work, "title").value, "Danse macabre, Op. 40");
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM relation WHERE kind='movement' AND source_id=?").get(work).n, 0);
  assert.deepEqual(workOfTrack(s, piece), [work]);
  const presentation = renderAlbumPresentation(s.c, "C");
  assert.ok(presentation, "a matched whole work keeps its album's work view");
  assert.equal(presentation.groups[0].workId, work);
  assert.equal(presentation.groups[0].movementCount, 1);
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "C" }).created, 0);
  assert.deepEqual(renderAlbumPresentation(s.c, "C"), presentation);
  // GROUPING names a whole piece the same way WORK does.
  const [grouped, ...rest] = s.trackIds("A");
  for (const track of rest) s.c.db.prepare("UPDATE track_link SET state='missing' WHERE id=?").run(track);
  setHints(s, grouped, { title: "Danse macabre, Op. 40", work: "", grouping: "Danse macabre, Op. 40", composer: ["Camille Saint-Saëns"], genres: ["Classical"] });
  classify(s.c, grouped, {}, { manual: "classical", actor: "1" });
  autoMatchTaggedWorks(s.c, { albumId: "A" });
  assert.deepEqual(workOfTrack(s, grouped), [work]);
  assert.deepEqual(liveWorks(s), [work]);
});

test("#8 tag-made and MusicBrainz-identified albums of one work share it", async (t) => {
  const s = await setup(t);
  for (const track of s.trackIds("A")) setHints(s, track, { work: "Symphony No. 5 in C minor, Op. 67" });
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "A" }).created, 1);
  const [work] = liveWorks(s);
  // Album B is identified through MusicBrainz under its catalogue title and an alias.
  const providerMatches = new Map(
    s.trackIds("B").map((track) => [track, { workId: "mb-sym5", work: "Symphony no. 5 in C minor, op. 67", aliases: ["Schicksalssinfonie"], composers: ["Ludwig van Beethoven"] }]),
  );
  assert.equal(autoMatchTaggedWorks(s.c, { albumId: "B", providerMatches }).created, 1);
  assert.deepEqual(liveWorks(s), [work]);
  assert.equal(s.c.db.prepare("SELECT entity_id FROM external_identity WHERE record_id='mb-sym5'").get().entity_id, work);
  assert.ok(s.trackIds("B").every((track) => workOfTrack(s, track).join() === work));
});

test("#20 MusicBrainz composer IDs keep same-named composers apart", async (t) => {
  const s = await setup(t);
  const mb = (album, workId, composerId, title) =>
    new Map(s.trackIds(album).map((track) => [track, { workId, work: title, aliases: [], composers: ["Ludwig van Beethoven"], composerIds: { "Ludwig van Beethoven": composerId } }]));
  autoMatchTaggedWorks(s.c, { albumId: "A", providerMatches: mb("A", "mb-w1", "mb-artist-1", "Symphony No. 5 in C minor, Op. 67") });
  // Same name, different verified person, same-looking title: kept apart.
  autoMatchTaggedWorks(s.c, { albumId: "B", providerMatches: mb("B", "mb-w2", "mb-artist-2", "Symphony No. 5 in C minor, Op. 67") });
  const people = s.c.db
    .prepare("SELECT x.record_id FROM entity e JOIN external_identity x ON x.entity_id=e.id WHERE e.kind='person' AND e.deleted_at IS NULL AND x.record_kind='artist' ORDER BY x.record_id")
    .all()
    .map((r) => r.record_id);
  assert.deepEqual(people, ["mb-artist-1", "mb-artist-2"]);
  assert.equal(liveWorks(s).length, 2);
  const original = liveWorks(s).sort();
  for (let pass = 0; pass < 2; pass++) {
    autoMatchTaggedWorks(s.c, { actor: "model-scan" });
    assert.deepEqual(liveWorks(s).sort(), original, "later scans must preserve distinct verified works");
  }
  s.c.db.prepare("DELETE FROM external_identity WHERE provider='musicbrainz' AND record_kind='work'").run();
  autoMatchTaggedWorks(s.c, { actor: "model-scan" });
  assert.deepEqual(liveWorks(s).sort(), original, "different verified composers also protect works without provider work IDs");
});

test("#16 a moved-file review can be settled by linking the right file", async (t) => {
  const s = await setup(t);
  const work = (await createFrom(s, "A", "Symphony No. 5 in C minor, Op. 67")).selection;
  const [old] = s.trackIds("A");
  const candidate = { ...JSON.parse(s.c.db.prepare("SELECT evidence FROM track_link WHERE id=?").get(old).evidence), coreId: "A-0-moved", fileId: "A-0-moved", path: "/library/A/moved.flac" };
  s.c.db.prepare("UPDATE track_link SET state='review' WHERE id=?").run(old);
  s.c.review("track_link", old, { epochChanged: false, candidates: [candidate, { ...candidate, coreId: "other", fileId: "other", path: "/library/A/copy.flac" }], reused: [] });
  const review = s.c.db.prepare("SELECT id FROM review_item WHERE kind='track_link'").get().id;
  const view = (await s.read({ selection: `review:${review}` })).view;
  const link = view.actions.find((a) => a.label === "Link to moved.flac");
  await s.ok(link.command, link.arguments, `review:${review}`);
  const row = s.c.db.prepare("SELECT core_id,state FROM track_link WHERE id=?").get(old);
  assert.deepEqual({ ...row }, { core_id: "A-0-moved", state: "active" });
  assert.deepEqual(workOfTrack(s, old), [work], "the link keeps its work");
  assert.equal(s.c.db.prepare("SELECT status FROM review_item WHERE id=?").get(review).status, "resolved");
});

test("v1 hosts still get the v1 editor", async (t) => {
  const s = await setup(t);
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const page = await readEditor({ ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 1 }, query: {} });
  assert.equal(page.version, 1);
  assert.ok(s);
});

const composerCredits = (s, work) => s.c.db.prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer' ORDER BY position,id").all(work).map((r) => r.contributor_id);
async function spellingWorks(t) {
  const s = await setup(t);
  for (const track of s.trackIds("B")) setHints(s, track, { composer: ["L. van Beethoven"], work: "Symphony No. 5 in C minor, Op. 67" });
  for (const track of s.trackIds("A")) setHints(s, track, { work: "Symphony No. 5 in C minor, Op. 67" });
  autoMatchTaggedWorks(s.c);
  const [a, b] = ["A", "B"].map((album) => workOfTrack(s, s.trackIds(album)[0])[0]);
  assert.notEqual(a, b);
  return { ...s, a, b };
}
function addSpellingAlbum(s, album, composer, generation) {
  const existing = s.c.db.prepare("SELECT evidence FROM track_link").all().map((row) => JSON.parse(row.evidence));
  const tracks = existing.filter((track) => track.albumId === "A").map((track, i) => ({
    ...track, coreId: `${album}-${i}`, fileId: `${album}-${i}`, path: `/library/${album}/${i}.flac`, fingerprint: `audio-sha256-v2:${album}-${i}`,
    albumId: album, hints: { ...track.hints, album: `Album ${album}`, composer: [composer] },
  }));
  const rows = reconcile(s.c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation, tracks: [...existing, ...tracks] });
  for (const row of rows) classify(s.c, row.id, row.hints);
  autoMatchTaggedWorks(s.c);
}

// #29 (review E4): a merge changes the entry it keeps, so a page opened on
// that entry before the merge can neither save nor delete.
test("#29 a page of the kept work or person opened before a merge is stale", async (t) => {
  const s = await spellingWorks(t);
  const raw = (revision, command, values) => mutateRaw({ ...s.input, mutation: { revision, command, values } });
  const staleWork = (await s.read({ selection: s.a })).revision;
  await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, `merge:${s.b}:${s.a}`);
  assert.notEqual((await s.read({ selection: s.a })).revision, staleWork);
  assert.equal((await raw(staleWork, "delete-entity", { target: s.a })).status, 409);
  assert.equal((await raw(staleWork, "save-entity", { target: s.a, title: "Stale save" })).status, 409);
  assert.ok(live(s, s.a));
  // The undo still works: the kept work's own merge row is the merge's.
  await s.ok("undo-change", { id: latestMerge(s).id }, `change:${latestMerge(s).id}`);
  assert.ok(live(s, s.b));

  const keep = (await s.ok("create-contributor", { name: "Fixture Pianist", kind: "person" })).selection;
  const drop = (await s.ok("create-contributor", { name: "F. Pianist", kind: "person" })).selection;
  const stalePerson = (await s.read({ selection: keep })).revision;
  await s.ok("merge-entity", { target: drop, into: keep, confirm: true }, drop);
  assert.equal((await raw(stalePerson, "save-entity", { target: keep, name: "Stale name" })).status, 409);
  assert.equal((await raw(stalePerson, "delete-entity", { target: keep })).status, 409);
});

// #37 (U2): the merge step names both entries, explains a composer
// difference, and says person merges undo like work merges.
test("#37 the merge step names its choices, explains differing composers and offers undo for people", async (t) => {
  const s = await spellingWorks(t);
  const view = (await s.read({ selection: `merge:${s.b}:${s.a}` })).view;
  assert.match(section(view, "compare").note, /composers differ: the work that stays keeps its own composers/);
  const keep = (await s.ok("create-contributor", { name: "Fixture Pianist", kind: "person" })).selection;
  const drop = (await s.ok("create-contributor", { name: "F. Pianist", kind: "person" })).selection;
  const people = (await s.read({ selection: `merge:${drop}:${keep}` })).view;
  const form = section(people, "merge");
  assert.match(form.note, /undo it from Activity/);
  assert.deepEqual(form.fields[0].options.map((o) => o.label), ["“F. Pianist” (0 credits)", "“Fixture Pianist” (0 credits)"]);
  assert.match(section(people, "keep-first").items.find((item) => item.label === "Undo").value, /From Activity/);
  assert.equal(people.sections.at(-1).id, "merge");
});

test("#13 a work merge keeps its composers, previews both directions, and later albums join", async (t) => {
  const s = await spellingWorks(t);
  const [keptPerson] = composerCredits(s, s.a), [droppedPerson] = composerCredits(s, s.b);
  const merge = `merge:${s.b}:${s.a}`;
  const view = (await s.read({ selection: merge })).view;
  for (const [id, kept, dropped] of [["keep-first", "L. van Beethoven", "Ludwig van Beethoven"], ["keep-second", "Ludwig van Beethoven", "L. van Beethoven"]]) {
    const items = section(view, id).items;
    const composers = items.find((item) => item.label === "Composers");
    assert.ok(composers, "the preview explains composer credits");
    assert.ok(composers.value.includes(kept));
    assert.ok(composers.value.includes(`“${dropped}” is not added`));
    const link = items.find((item) => item.selection?.startsWith("merge:"));
    assert.ok(link, "the preview links to merging the composer entries");
    assert.equal((await s.read({ selection: link.selection })).view.title, "Merge two entries");
  }
  await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, merge);
  assert.deepEqual(composerCredits(s, s.a), [keptPerson]);
  addSpellingAlbum(s, "D", "Ludwig van Beethoven", 2);
  assert.deepEqual(liveWorks(s), [s.a]);
  assert.ok(s.trackIds("D").every((id) => workOfTrack(s, id).join() === s.a));
  // L2 covers the other spelling once the admin explicitly merges the people.
  await s.ok("merge-entity", { target: droppedPerson, into: keptPerson, confirm: true }, `merge:${droppedPerson}:${keptPerson}`);
  addSpellingAlbum(s, "E", "L. van Beethoven", 3);
  assert.deepEqual(liveWorks(s), [s.a]);
  assert.deepEqual(composerCredits(s, s.a), [keptPerson]);
  assert.ok(s.trackIds("E").every((id) => workOfTrack(s, id).join() === s.a));
});

test("#13 dropped co-composers are disclosed, other roles move, and undo restores credits", async (t) => {
  const s = await spellingWorks(t);
  const co = (await s.ok("create-contributor", { name: "Genuine co-composer", kind: "person" })).selection;
  s.c.credit(s.b, co, "composer", { position: 2 });
  s.c.credit(s.b, co, "arranger", { position: 3 });
  const before = s.c.db.prepare("SELECT * FROM credit WHERE target_id IN (?,?) ORDER BY id").all(s.a, s.b);
  const step = `merge:${s.b}:${s.a}`;
  const view = (await s.read({ selection: step })).view;
  assert.match(section(view, "keep-second").items.find((item) => item.label === "Composers").value, /“Genuine co-composer” is not added/);
  await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, step);
  assert.equal(composerCredits(s, s.a).length, 1);
  assert.equal(s.c.db.prepare("SELECT target_id FROM credit WHERE contributor_id=? AND role='arranger'").get(co).target_id, s.a);
  const history = await s.read({ tab: "activity" });
  const change = history.list.items.find((item) => item.selection.startsWith("change:"));
  const undo = (await s.read({ selection: change.selection })).view.actions.find((item) => item.command === "undo-change");
  await s.ok(undo.command, undo.arguments, change.selection);
  assert.deepEqual(s.c.db.prepare("SELECT * FROM credit WHERE target_id IN (?,?) ORDER BY id").all(s.a, s.b), before);
});

test("#13 when the kept work has no composer, all dropped composers move", async (t) => {
  const s = await spellingWorks(t);
  s.c.db.prepare("DELETE FROM credit WHERE target_id=? AND role='composer'").run(s.a);
  const co = (await s.ok("create-contributor", { name: "Second composer", kind: "person" })).selection;
  s.c.credit(s.b, co, "composer", { position: 2 });
  const composers = composerCredits(s, s.b);
  const step = `merge:${s.b}:${s.a}`;
  const view = (await s.read({ selection: step })).view;
  assert.match(section(view, "keep-second").items.find((item) => item.label === "Composers").value, /move to the kept work/);
  await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, step);
  assert.deepEqual(composerCredits(s, s.a), composers);
});

for (const mode of ["album", "standalone"]) {
  test(`#12 Create anyway keeps ${mode} work distinct across scans and new ambiguous albums`, async (t) => {
    const s = await setup(t);
    const title = "Symphony No. 5 in C minor, Op. 67";
    for (const album of ["A", "B"]) for (const track of s.trackIds(album)) setHints(s, track, { work: title });
    autoMatchTaggedWorks(s.c);
    const [original] = liveWorks(s);
    const [composer] = composerCredits(s, original);
    if (mode === "album") {
      const { form, selection } = await newAlbumForm(s, "B");
      const values = { ...form.arguments, title, composer, composerName: "" };
      assert.equal((await s.mutate("create-work-from-album", values, selection)).ok, false);
      await s.ok("create-work-from-album", { ...values, createAnyway: true }, selection);
    } else {
      assert.equal((await s.mutate("create-work", { title, composer, movements: titles })).ok, false);
      await s.ok("create-work", { title, composer, movements: titles, createAnyway: true });
    }
    const made = liveWorks(s).find((id) => id !== original);
    const suppression = s.c.db.prepare("SELECT reason,actor FROM match_suppression WHERE key=?").get(distinctKey(original, made));
    assert.equal(suppression?.reason, "distinct");
    assert.equal(suppression.actor, "1");
    const before = ["A", "B"].map((album) => s.trackIds(album).map((id) => workOfTrack(s, id)));
    for (let pass = 0; pass < 3; pass++) {
      autoMatchTaggedWorks(s.c);
      assert.deepEqual(liveWorks(s).sort(), [original, made].sort());
      assert.deepEqual(["A", "B"].map((album) => s.trackIds(album).map((id) => workOfTrack(s, id))), before);
    }
    assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='identity' AND status='open' AND json_extract(evidence,'$.reason')='duplicate-work'").get().n, 0);
    addSpellingAlbum(s, "D", "Ludwig van Beethoven", 2);
    assert.deepEqual(liveWorks(s).sort(), [original, made].sort());
    assert.ok(s.trackIds("D").every((id) => workOfTrack(s, id).length === 0));
    const review = s.c.db.prepare("SELECT evidence FROM review_item WHERE kind='auto_match' AND json_extract(evidence,'$.reason')='ambiguous-work' AND json_extract(evidence,'$.albumId')='D'").get();
    assert.deepEqual(JSON.parse(review.evidence).candidates.sort(), [original, made].sort());
  });
}

test("#12 Create anyway records all similar works, including unnumbered ones", async (t) => {
  const s = await setup(t);
  const first = (await s.ok("create-work", { title: "Prelude", movements: [] })).selection;
  const second = (await s.ok("create-work", { title: "Prelude", movements: [], createAnyway: true })).selection;
  const third = (await s.ok("create-work", { title: "Prelude", movements: [], createAnyway: true })).selection;
  for (const other of [first, second])
    assert.ok(s.c.db.prepare("SELECT 1 FROM match_suppression WHERE key=?").get(distinctKey(third, other)));
  assert.deepEqual(mergeDuplicateAutoWorks(s.c), { people: 0, works: 0 });
  assert.equal(liveWorks(s).length, 3);
});

for (const manualFirst of [false, true]) {
  test(`#12 duplicate repair reviews a work without an album-work identity (manual first: ${manualFirst})`, async (t) => {
    const s = await setup(t), m = new Metadata(s.c);
    const composer = s.c.createEntity("person", { roles: ["composer"] });
    m.derived(composer, "name", "Ludwig van Beethoven");
    const works = [];
    for (const isManual of manualFirst ? [true, false] : [false, true]) {
      const work = s.c.createEntity("work");
      // Deliberately no manual assertion or suppression: identity is the guard.
      m.derived(work, "title", "Symphony No. 5, Op. 67");
      s.c.credit(work, composer, "composer");
      if (!isManual) s.c.externalIdentity(work, "embedded-tags", "album-work", `old-${work}`);
      works.push(work);
    }
    for (let pass = 0; pass < 2; pass++) assert.deepEqual(mergeDuplicateAutoWorks(s.c), { people: 0, works: 0 });
    assert.deepEqual(liveWorks(s).sort(), works.sort());
    assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='identity' AND status='open' AND json_extract(evidence,'$.reason')='duplicate-work'").get().n, 1);
  });
}

test("#12 duplicate repair asks for a decision when neither work has an album-work identity", async (t) => {
  const s = await setup(t), m = new Metadata(s.c);
  const composer = s.c.createEntity("person", { roles: ["composer"] });
  m.derived(composer, "name", "Ludwig van Beethoven");
  const works = [0, 1].map(() => {
    const work = s.c.createEntity("work");
    m.derived(work, "title", "Symphony No. 5, Op. 67");
    s.c.credit(work, composer, "composer");
    return work;
  });
  for (let pass = 0; pass < 2; pass++) assert.deepEqual(mergeDuplicateAutoWorks(s.c), { people: 0, works: 0 });
  assert.deepEqual(liveWorks(s).sort(), works.sort());
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='identity' AND status='open' AND json_extract(evidence,'$.reason')='duplicate-work'").get().n, 1);
});

async function removalFixture(t) {
  const s = await setup(t);
  s.workTitle = "Symphony No. 5 in C minor, Op. 67";
  for (const album of ["A", "B"]) for (const track of s.trackIds(album)) setHints(s, track, { work: s.workTitle });
  autoMatchTaggedWorks(s.c);
  [s.work] = liveWorks(s);
  return s;
}
function appendATrack(s, title, generation = 2) {
  const tracks = s.c.db.prepare("SELECT evidence FROM track_link").all().map((row) => JSON.parse(row.evidence));
  const source = tracks.find((track) => track.albumId === "A");
  const i = tracks.filter((track) => track.albumId === "A").length;
  tracks.push({ ...source, coreId: `A-${i}`, fileId: `A-${i}`, path: `/library/A/${i}.flac`, fingerprint: `audio-sha256-v2:A-${i}`,
    hints: { ...source.hints, title: `${s.workTitle}: ${title}`, trackNumber: i + 1 } });
  const rows = reconcile(s.c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation, tracks });
  for (const row of rows) classify(s.c, row.id, row.hints);
  return s.trackIds("A").at(-1);
}
const workParts = (s) => s.c.db.prepare("SELECT target_id,position FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(s.work);
const detachTrack = (s, track) => {
  for (const { id } of s.c.db.prepare("SELECT i.id FROM realization_item i JOIN segment g ON g.id=i.segment_id WHERE g.track_link_id=?").all(track))
    s.c.detachItem(id, { dropRecording: true });
};

test("#11 a removed Applause track stays out across scans until manually assigned", async (t) => {
  const s = await removalFixture(t);
  const applause = appendATrack(s, "Applause");
  autoMatchTaggedWorks(s.c);
  assert.deepEqual(workOfTrack(s, applause), [s.work]);
  const movement = workParts(s).at(-1).target_id;
  await s.ok("unassign-tracks", { albumId: "A", tracks: [applause] }, "album:A");
  for (let pass = 0; pass < 3; pass++) {
    autoMatchTaggedWorks(s.c);
    assert.deepEqual(workOfTrack(s, applause), []);
  }
  assert.equal(workParts(s).length, 5, "removal does not delete the catalogue movement");
  await s.ok("assign-album", { albumId: "A", work: s.work, tracks: [applause], mapping: [movement] }, "album:A");
  assert.deepEqual(workOfTrack(s, applause), [s.work]);
  // Simulate a missing attachment after the newer explicit assignment: the old
  // removal must no longer prevent filling an existing catalogue movement.
  detachTrack(s, applause);
  autoMatchTaggedWorks(s.c);
  assert.deepEqual(workOfTrack(s, applause), [s.work]);
  await s.ok("unassign-tracks", { albumId: "A", tracks: [applause] }, "album:A");
  autoMatchTaggedWorks(s.c);
  assert.deepEqual(workOfTrack(s, applause), []);
});

test("#11 one removed track does not prevent a different new track from extending an unedited work", async (t) => {
  const s = await removalFixture(t);
  const removed = s.trackIds("A")[1];
  await s.ok("unassign-tracks", { albumId: "A", tracks: [removed] }, "album:A");
  const applause = appendATrack(s, "Applause");
  autoMatchTaggedWorks(s.c);
  assert.deepEqual(workOfTrack(s, removed), []);
  assert.deepEqual(workOfTrack(s, applause), [s.work]);
});

for (const edit of ["work", "movement", "order"]) {
  test(`#11 extension of a work with an edited ${edit} is atomic when a new movement is needed`, async (t) => {
    const s = await removalFixture(t);
    const parts = workParts(s);
    if (edit === "work") await s.ok("save-entity", { target: s.work, description: "Keep this movement list" }, s.work);
    else if (edit === "movement") await s.ok("save-entity", { target: parts[3].target_id, title: "IV. Finale" }, parts[3].target_id);
    else await s.ok("move-movement", { work: s.work, movement: parts[3].target_id, direction: "up" }, s.work);
    const missing = s.trackIds("A")[1];
    detachTrack(s, missing);
    const applause = appendATrack(s, "Applause");
    const before = { parts: workParts(s), recordings: s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='recording'").get().n };
    for (let pass = 0; pass < 2; pass++) {
      autoMatchTaggedWorks(s.c);
      assert.deepEqual(workOfTrack(s, missing), [], "no partial attachment before the mismatch");
      assert.deepEqual(workOfTrack(s, applause), []);
      assert.deepEqual(workParts(s), before.parts);
      assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM entity WHERE kind='recording'").get().n, before.recordings);
    }
    const reviews = s.c.db.prepare("SELECT evidence FROM review_item WHERE kind='auto_match' AND status='open' AND json_extract(evidence,'$.reason')='movement-mismatch'").all();
    assert.equal(reviews.length, 1);
    assert.equal(JSON.parse(reviews[0].evidence).work, s.work);
  });
}

test("#11 edited works can still fill an existing movement without changing their structure", async (t) => {
  const s = await removalFixture(t);
  await s.ok("save-entity", { target: s.work, description: "Keep this movement list" }, s.work);
  const missing = s.trackIds("A")[1], before = workParts(s);
  detachTrack(s, missing);
  autoMatchTaggedWorks(s.c);
  assert.deepEqual(workOfTrack(s, missing), [s.work]);
  assert.deepEqual(workParts(s), before);
});

test("#11 a skipped mapping does not cancel removal when another track is explicitly assigned", async (t) => {
  const s = await removalFixture(t);
  const [removed, assigned] = s.trackIds("A"), parts = workParts(s);
  await s.ok("unassign-tracks", { albumId: "A", tracks: [removed] }, "album:A");
  await s.ok("assign-album", { albumId: "A", work: s.work, tracks: [removed, assigned], mapping: ["", parts[1].target_id] }, "album:A");
  // The newer event names both tracks, but only one was assigned. Recovering
  // its missing attachment must not turn the skipped removal into permission.
  detachTrack(s, assigned);
  autoMatchTaggedWorks(s.c);
  assert.deepEqual(workOfTrack(s, removed), []);
  assert.deepEqual(workOfTrack(s, assigned), [s.work]);
});

const deletionChange = (s) => s.c.db.prepare("SELECT id FROM change_set WHERE kind='delete' ORDER BY rowid DESC").get().id;
for (const reuse of ["match", "manual"]) {
  test(`#15 deletion undo refuses tracks reused by ${reuse} without changing the catalogue`, async (t) => {
    const s = await removalFixture(t);
    await s.ok("delete-entity", { target: s.work }, s.work);
    const change = deletionChange(s);
    if (reuse === "match") {
      autoMatchTaggedWorks(s.c);
      const review = s.c.db.prepare("SELECT id FROM review_item WHERE status='open' AND json_extract(evidence,'$.reason')='deleted-work'").get();
      await s.ok("allow-work", { id: review.id }, `review:${review.id}`);
      autoMatchTaggedWorks(s.c);
    } else {
      const work = (await s.ok("create-work", { title: "Different work", movements: [] })).selection;
      const opened = await s.ok("choose-album-work", { albumId: "A", work }, "album:A");
      const form = section((await s.read({ selection: opened.selection })).view, "assign");
      await s.ok("assign-album", { ...form.arguments, mapping: form.arguments.tracks.map((_, i) => i === 0 ? "new" : "") }, opened.selection);
    }
    const before = s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all();
    const result = await s.mutate("undo-change", { id: change }, `change:${change}`);
    assert.equal(result.ok, false);
    assert.match(result.message, /tracks are in a work again; take them out first, then undo/);
    assert.deepEqual(s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all(), before);
    assert.equal(s.c.db.prepare("SELECT undone_at FROM change_set WHERE id=?").get(change).undone_at, null);
    assert.deepEqual(s.c.db.prepare("PRAGMA foreign_key_check").all(), []);
  });
}

test("#15 deletion undo still succeeds when tracks remain free, including after scans", async (t) => {
  const s = await removalFixture(t);
  const before = s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all();
  await s.ok("delete-entity", { target: s.work }, s.work);
  const change = deletionChange(s);
  autoMatchTaggedWorks(s.c); autoMatchTaggedWorks(s.c);
  await s.ok("undo-change", { id: change }, `change:${change}`);
  assert.deepEqual(s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all(), before);
});

function duplicateRecording(s, source, { ranges = false, reverse = false, partial = false } = {}) {
  const performance = s.c.createEntity("performance");
  const pw = s.c.relate("performance_work", performance, s.work);
  const realization = s.c.realization(s.work, pw, "Duplicate fixture");
  const rows = s.c.db.prepare(`SELECT i.*,s.track_link_id FROM realization_item i
    JOIN segment s ON s.id=i.segment_id WHERE i.realization_id=? ORDER BY i.sequence`).all(source);
  if (reverse) rows.reverse();
  if (partial) rows.pop();
  rows.forEach((row, i) => {
    const recording = s.c.createEntity("recording", { durationMs: 60000 });
    s.c.relate("recording_performance", recording, performance);
    const content = s.c.recordingContent(recording, pw, { movement: row.movement_id });
    const segment = s.c.segment(row.track_link_id, ranges ? { startMs: 100, endMs: 50000, kind: "range" } : { kind: "whole" });
    s.c.segmentContent(segment, content);
    s.c.realizationItem(realization, segment, { movement: row.movement_id, sequence: i + 1 });
  });
  return realization;
}

test("#15 repair drops only the later exact duplicate recording and preserves picks", async (t) => {
  const s = await removalFixture(t);
  const original = realizationOf(s, s.work), duplicate = duplicateRecording(s, original);
  const ranges = duplicateRecording(s, original, { ranges: true });
  const reordered = duplicateRecording(s, original, { reverse: true });
  const partial = duplicateRecording(s, original, { partial: true });
  s.c.db.prepare("INSERT INTO user_work_state VALUES (2,?,1,?,1)").run(s.work, duplicate);
  s.c.db.prepare("INSERT INTO admin_work_pick VALUES (?,?,1,1)").run(s.work, duplicate);
  assert.equal(repairDuplicateRealizations(s.c), 1);
  assert.equal(s.c.db.prepare("SELECT 1 FROM realization WHERE id=?").get(duplicate), undefined);
  for (const id of [original, ranges, reordered, partial]) assert.ok(s.c.db.prepare("SELECT 1 FROM realization WHERE id=?").get(id));
  assert.equal(s.c.db.prepare("SELECT picked_realization_id FROM user_work_state WHERE user_id=2").get().picked_realization_id, original);
  assert.equal(s.c.db.prepare("SELECT realization_id FROM admin_work_pick WHERE work_id=?").get(s.work).realization_id, original);
  assert.equal(repairDuplicateRealizations(s.c), 0);
  assert.deepEqual(s.c.db.prepare("PRAGMA foreign_key_check").all(), []);
  // The library pass runs the same repair, while a different album's files remain.
  duplicateRecording(s, original);
  autoMatchTaggedWorks(s.c);
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM realization WHERE work_id=?").get(s.work).n, 5);
});

const latestMerge = (s) => s.c.db.prepare("SELECT id,created_at FROM change_set WHERE kind='merge' ORDER BY rowid DESC").get();
for (const selection of ["group", "group-preselected", "choose-work", "bulk"]) {
  test(`#17 opening and cancelling ${selection} does not block merge undo`, async (t) => {
    const s = await spellingWorks(t);
    const before = s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all();
    await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, `merge:${s.b}:${s.a}`);
    const change = latestMerge(s);
    let opened = selection === "bulk"
      ? await s.ok("bulk-edit-open", { works: [s.a] })
      : await s.ok("move-tracks-open", { albumId: "A", tracks: [s.trackIds("A")[0]], ...(selection === "group-preselected" && { work: s.a }) }, "album:A");
    if (selection === "choose-work") opened = await s.ok("choose-album-work", { albumId: "A", work: s.a, move: opened.selection.split("!").at(-1) }, opened.selection);
    await s.ok("open", { selection: selection === "group-preselected" || selection === "choose-work" ? s.a : "" }, opened.selection);
    await s.ok("undo-change", { id: change.id }, `change:${change.id}`);
    assert.deepEqual(liveWorks(s).sort(), [s.a, s.b].sort());
    assert.deepEqual(s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all(), before);
    assert.ok(s.c.db.prepare("SELECT 1 FROM change_set WHERE kind='selection'").get(), "selection still exists; no expiry or purge required");
  });
}

for (const kind of ["merge", "delete"]) {
  test(`#17 a later unrelated ${kind} does not block an earlier merge undo`, async (t) => {
    const s = await spellingWorks(t);
    await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, `merge:${s.b}:${s.a}`);
    const change = latestMerge(s);
    const other = (await s.ok("create-work", { title: "Unrelated sketch", movements: [] })).selection;
    if (kind === "delete") await s.ok("delete-entity", { target: other }, other);
    else {
      const extra = (await s.ok("create-work", { title: "Another unrelated sketch", movements: [] })).selection;
      await s.ok("merge-entity", { target: extra, into: other, confirm: true }, `merge:${extra}:${other}`);
    }
    const later = s.c.db.prepare("SELECT id FROM change_set WHERE kind=? ORDER BY rowid DESC").get(kind).id;
    // Ensure the former global timestamp guard sees this later row.
    s.c.db.prepare("UPDATE change_set SET created_at=? WHERE id=?").run(change.created_at + 1, later);
    const unrelatedBefore = s.c.db.prepare("SELECT * FROM entity WHERE id=?").get(other);
    await s.ok("undo-change", { id: change.id }, `change:${change.id}`);
    assert.deepEqual(s.c.db.prepare("SELECT * FROM entity WHERE id=?").get(other), unrelatedBefore);
    assert.equal(s.c.db.prepare("SELECT undone_at FROM change_set WHERE id=?").get(later).undone_at, null);
    assert.ok(live(s, s.a) && live(s, s.b));
  });
}

for (const kind of ["merge", "delete"]) {
  test(`#17 a later overlapping ${kind} still blocks undo, even with equal timestamps`, async (t) => {
    const s = await spellingWorks(t);
    await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, `merge:${s.b}:${s.a}`);
    const first = latestMerge(s);
    if (kind === "delete") await s.ok("delete-entity", { target: s.a }, s.a);
    else {
      const extra = (await s.ok("create-work", { title: "Another version", movements: [] })).selection;
      // The merge's audit targets the dropped extra work, so overlap with the
      // retained work must also be detected from the saved entity sets.
      await s.ok("merge-entity", { target: extra, into: s.a, confirm: true }, `merge:${extra}:${s.a}`);
    }
    const later = s.c.db.prepare("SELECT id FROM change_set WHERE kind=? ORDER BY rowid DESC").get(kind).id;
    s.c.db.prepare("UPDATE change_set SET created_at=? WHERE id=?").run(first.created_at, later);
    const before = s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all();
    const refused = await s.mutate("undo-change", { id: first.id }, `change:${first.id}`);
    assert.equal(refused.ok, false);
    assert.match(refused.message, /entries changed after this/);
    assert.deepEqual(s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all(), before);
    assert.equal(s.c.db.prepare("SELECT undone_at FROM change_set WHERE id=?").get(first.id).undone_at, null);
    await s.ok("undo-change", { id: later }, `change:${later}`);
    assert.deepEqual(s.c.db.prepare("PRAGMA foreign_key_check").all(), []);
  });
}

// #31 (review E8): favourites and picks set on the merged work after the
// merge survive its undo; a pick goes back with its recording.
test("#31 undoing a merge keeps favourites and picks made after it", async (t) => {
  const s = await spellingWorks(t);
  const fromB = s.c.db.prepare("SELECT id FROM realization WHERE work_id=?").get(s.b).id;
  const act = (user, command, extra = {}) => applyWorkMutation(s.c, { resourceId: s.a, mutation: { command, ...extra } }, user);
  const listener = (id) => ({ id, role: "user" });
  // Before the merge: user 5 likes B, user 6 likes A.
  applyWorkMutation(s.c, { resourceId: s.b, mutation: { command: "favourite", value: true } }, listener(5));
  act(listener(6), "favourite", { value: true });
  await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, `merge:${s.b}:${s.a}`);
  const change = latestMerge(s);
  act(listener(2), "favourite", { value: true });
  act(listener(3), "pick", { realizationId: fromB });
  act({ id: 1, role: "admin" }, "admin-pick", { realizationId: fromB });
  act(listener(5), "favourite", { value: false });
  await s.ok("undo-change", { id: change.id }, `change:${change.id}`);
  const state = (user, work) => s.c.db.prepare("SELECT favourite,picked_realization_id AS pick FROM user_work_state WHERE user_id=? AND work_id=?").get(user, work);
  assert.equal(state(2, s.a)?.favourite, 1, "a favourite on the merged work stays on the kept work");
  assert.equal(state(3, s.b)?.pick, fromB, "a pick goes back with its recording");
  assert.equal(state(3, s.a)?.pick ?? null, null);
  assert.equal(s.c.db.prepare("SELECT realization_id FROM admin_work_pick WHERE work_id=?").get(s.b)?.realization_id, fromB);
  assert.equal(state(5, s.b).favourite, 0, "a favourite taken from the merged work is taken from both");
  assert.equal(state(6, s.a).favourite, 1, "an earlier favourite is restored as it was");
  assert.deepEqual(s.c.db.prepare("PRAGMA foreign_key_check").all(), []);
  // A merge recorded before listener state was saved compares by time.
  await s.ok("merge-entity", { target: s.b, into: s.a, confirm: true }, `merge:${s.b}:${s.a}`);
  const old = latestMerge(s);
  s.c.db.prepare("UPDATE change_set SET data=json_remove(data,'$.listeners'),created_at=created_at-1000 WHERE id=?").run(old.id);
  act(listener(7), "favourite", { value: true });
  await s.ok("undo-change", { id: old.id }, `change:${old.id}`);
  assert.equal(state(7, s.a)?.favourite, 1);
  assert.equal(state(6, s.a).favourite, 1);
});

test("#17 group selection does not block deletion undo while tracks remain free", async (t) => {
  const s = await removalFixture(t);
  const before = s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all();
  await s.ok("delete-entity", { target: s.work }, s.work);
  const change = deletionChange(s);
  await s.ok("move-tracks-open", { albumId: "A", tracks: s.trackIds("A") }, "album:A");
  await s.ok("undo-change", { id: change }, `change:${change}`);
  assert.deepEqual(s.c.db.prepare("SELECT * FROM realization_item ORDER BY id").all(), before);
});

// v0.3 6.6: a track holding three movements, as matching makes it (one
// whole segment, one recording, a content per movement), divided by time.
test("movement boundaries divide a shared track into ranges; the album view and the queue agree", async (t) => {
  const s = await setup(t);
  const { c } = s;
  const m = new Metadata(c);
  const work = c.createEntity("work");
  m.manual(work, "title", "Three Pieces", { actor: "test" });
  const movements = ["I. Lento", "II. Vivace", "III. Adagio"].map((title, i) => {
    const id = c.createEntity("movement");
    m.manual(id, "title", title, { actor: "test" });
    c.relate("movement", work, id, { position: i + 1 });
    return id;
  });
  const performance = c.createEntity("performance");
  const pw = c.relate("performance_work", performance, work);
  const realization = c.realization(work, pw, "Album A");
  const [track] = s.trackIds("A");
  const recording = c.createEntity("recording", { durationMs: 60000 });
  c.relate("recording_performance", recording, performance);
  const whole = c.segment(track, { kind: "whole" });
  movements.forEach((movement, j) => {
    const content = c.recordingContent(recording, pw, { movement, position: j + 1 });
    c.segmentContent(whole, content);
    c.realizationItem(realization, whole, { movement, sequence: j + 1, intentionalOverlap: j > 0 });
  });
  const items = c.db.prepare("SELECT id FROM realization_item WHERE realization_id=? ORDER BY sequence").all(realization).map((r) => r.id);

  // The track page asks where II and III start.
  const form = (await s.read({ selection: `track:${track}` })).view.sections.find((section) => section.id === "boundaries-0");
  assert.equal(form.command, "set-boundaries");
  assert.deepEqual(form.arguments, { track, realization, items });
  assert.deepEqual(form.fields.map((f) => [f.key, f.label, f.value]), [["start-1", "II. Vivace starts at", ""], ["start-2", "III. Adagio starts at", ""]]);
  assert.match(form.note, /I\. Lento starts at 0:00.*\(1:00\)/);

  // Refused: out of order, past the end of the file, not a time, stale items.
  const save = (values) => s.mutate("set-boundaries", { ...form.arguments, ...values }, `track:${track}`);
  for (const [values, field, message] of [
    [{ "start-1": "0:30", "start-2": "0:20" }, "start-2", /after the previous movement \(0:30\)/],
    [{ "start-1": "0:30", "start-2": "1:00" }, "start-2", /before the end of the file \(1:00\)/],
    [{ "start-1": "half", "start-2": "0:40" }, "start-1", /m:ss/],
    [{ "start-1": "0:00", "start-2": "0:40" }, "start-1", /after the previous movement \(0:00\)/],
  ]) {
    const result = await save(values);
    assert.deepEqual([result.ok, result.field], [false, field], JSON.stringify(values));
    assert.match(result.message, message);
  }
  const stale = await s.mutate("set-boundaries", { ...form.arguments, items: items.slice(0, 2), "start-1": "0:20" }, `track:${track}`);
  assert.match(stale.message, /changed since the page was read/);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM segment WHERE track_link_id=?").get(track).n, 1, "a refused save changes nothing");

  // Saved: three ranges, each with its own content, and the old segment gone.
  const ok = await s.ok("set-boundaries", { ...form.arguments, "start-1": "0:12.5", "start-2": "41" }, `track:${track}`);
  assert.equal(ok.selection, `track:${track}`);
  const ranges = c.db
    .prepare("SELECT i.id,s.start_ms,s.end_ms,s.kind,(SELECT count(*) FROM segment_content x WHERE x.segment_id=s.id) AS contents FROM realization_item i JOIN segment s ON s.id=i.segment_id WHERE i.realization_id=? ORDER BY i.sequence")
    .all(realization)
    .map((r) => ({ ...r }));
  assert.deepEqual(ranges.map((r) => [r.id, r.start_ms, r.end_ms, r.kind, r.contents]), [
    [items[0], 0, 12500, "range", 1],
    [items[1], 12500, 41000, "range", 1],
    [items[2], 41000, 60000, "range", 1],
  ]);
  assert.equal(c.db.prepare("SELECT 1 FROM segment WHERE id=?").get(whole), undefined);
  assert.deepEqual(c.db.prepare("SELECT start_ms,end_ms FROM recording_content WHERE recording_id=? ORDER BY position").all(recording).map((r) => [r.start_ms, r.end_ms]), [[0, 12500], [12500, 41000], [41000, 60000]]);

  // The album page and the work page's queue play the same three ranges.
  const album = renderAlbumPresentation(c, "A").groups.find((group) => group.workId === work);
  assert.deepEqual(album.items.map((i) => [i.title, i.startMs, i.endMs]), [["I. Lento", 0, 12500], ["II. Vivace", 12500, 41000], ["III. Adagio", 41000, 60000]]);
  const { workData } = await import("../src/model/presentation.js");
  const queued = workData(c, work, { id: 1 }).recordings[0].items;
  assert.deepEqual(queued.map((i) => [i.title, i.startMs, i.endMs]), album.items.map((i) => [i.title, i.startMs, i.endMs]));

  // The form shows the saved times, and moving one boundary keeps the rest.
  const again = (await s.read({ selection: `track:${track}` })).view.sections.find((section) => section.id === "boundaries-0");
  assert.deepEqual(again.fields.map((f) => f.value), ["0:12.500", "0:41"]);
  await s.ok("set-boundaries", { ...again.arguments, "start-1": "0:15", "start-2": "0:41" }, `track:${track}`);
  assert.deepEqual(renderAlbumPresentation(c, "A").groups.find((group) => group.workId === work).items.map((i) => [i.startMs, i.endMs]), [[0, 15000], [15000, 41000], [41000, 60000]]);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM segment WHERE track_link_id=?").get(track).n, 3, "replaced segments are removed");
  // An audit entry records it, as every editor change.
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM audit_event WHERE action='editor.set-boundaries'").get().n, 2);
});

test("times parse as m:ss, h:mm:ss or seconds, and print back the same", async () => {
  const { parseTime, formatTime } = await import("../src/model/editor-v2.js");
  assert.deepEqual(["4:07", "1:02:03", "4:07.25", "247", "0:00", "9:60", "1:60:00", "", "4.07.1", "-1"].map(parseTime), [247000, 3723000, 247250, 247000, 0, null, null, null, null, null]);
  assert.deepEqual([247000, 3723000, 247250, 0].map(formatTime), ["4:07", "1:02:03", "4:07.250", "0:00"]);
});

// v0.3 8.3: a preview of classical tags, per file, before anything is written.
test("tag preview: current and proposed values per file, and files that can't or needn't be written", async (t) => {
  const { tagLibrary, WORK } = await import("./tag-library.js");
  const lib = await tagLibrary(t);
  const c = await lib.catalogue();
  t.after(() => c.close());
  const m = new Metadata(c);
  const work = renderAlbumPresentation(c, "fifth").groups[0].workId;
  m.manual(work, "catalogue", ["Op. 67"], { actor: "admin", pin: true });
  // The Opus file is a work of its own (matching made it one), to show an
  // unsupported format.
  const opus = await lib.linkOf(4);
  assert.ok(c.db.prepare("SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=?").get(opus), "the overture is a work");
  const before = await Promise.all(lib.files.map((file) => fs.readFile(file.file)));

  // The album: four files would change; the view lists what changes.
  const opened = await lib.mutate("tag-preview-open", { albumId: "fifth" }, "album:fifth");
  assert.equal(opened.ok, true, opened.message);
  assert.match(opened.selection, /^tags:/);
  const preview = await lib.read(opened.selection);
  assert.equal(preview.subtitle.split(" · ")[0], "4 of 4 files would change");
  assert.deepEqual(preview.actions.map((a) => [a.label, a.command, a.arguments.confirm]), [["Write 4 files", "tag-write", true]]);
  const changing = preview.sections.find((s) => s.id === "status-change");
  assert.match(changing.rows[0].detail, new RegExp(`Work: — → ${WORK.replace(/[.()]/g, "\\$&")}`));
  assert.match(changing.rows[0].detail, /Catalogue number: — → Op\. 67/);
  // The MP3 gets no movement or performer tags.
  assert.doesNotMatch(changing.rows[3].detail, /Movement|Performers/);
  // One file: every field, current → proposed, and what this format can't take.
  const mp3 = await lib.read(changing.rows[3].selection);
  const fields = Object.fromEntries(mp3.sections[0].items.map((item) => [item.label, item.value]));
  assert.equal(fields.Composer, "Ludwig van Beethoven → Ludwig van Beethoven (same)");
  assert.equal(fields.Movement, "Not written to this format → IV. Allegro");
  assert.equal(fields["Catalogue number"], "— → Op. 67");

  // Ticked tracks, a work and one track open the same kind of preview.
  const ticked = await lib.mutate("tag-preview-open", { albumId: "fifth", tracks: [await lib.linkOf(0)] }, "album:fifth");
  assert.equal((await lib.read(ticked.selection)).subtitle.split(" · ")[0], "1 of 1 file would change");
  const forged = await lib.mutate("tag-preview-open", { albumId: "fifth", tracks: [opus] }, "album:fifth");
  // A track from elsewhere is refused (by the page's revision check first).
  assert.equal(forged.ok, false);
  assert.match(forged.message, /no longer on this album|out of date/);
  assert.equal((await lib.read((await lib.mutate("tag-preview-open", { work }, work)).selection)).subtitle.split(" · ")[0], "4 of 4 files would change");
  const opusView = await lib.read((await lib.mutate("tag-preview-open", { track: opus }, `track:${opus}`)).selection);
  assert.deepEqual(opusView.actions, []);
  assert.equal(opusView.sections[0].title, "Format not supported yet (1)");
  assert.match(opusView.sections[0].rows[0].detail, /can't be written to OPUS files yet/);
  // A file that can't be read, and one not classical.
  await fs.writeFile(lib.files[2].file, "not audio");
  c.db.prepare("UPDATE classification SET state='not_classical' WHERE target_id=?").run(await lib.linkOf(1));
  const mixed = await lib.read((await lib.mutate("tag-preview-open", { albumId: "fifth", tracks: await Promise.all([0, 1, 2].map(lib.linkOf)) }, "album:fifth")).selection);
  assert.deepEqual(mixed.sections.map((s) => s.title), ["Will change (1)", "Nothing to write (1)", "Couldn't be read (1)"]);
  assert.match(mixed.sections[1].rows[0].detail, /Not classical/);
  // Previews never write: the other files are byte for byte as they were.
  for (const i of [0, 1, 3, 4]) assert.deepEqual(await fs.readFile(lib.files[i].file), before[i], `file ${i}`);
  // Track pages offer the preview; a stale or unknown preview says so.
  assert.ok((await lib.read(`track:${opus}`)).actions.some((a) => a.command === "tag-preview-open"));
  await assert.rejects(lib.read("tags:nothing"), /preview is gone/);
});

// #39 (U4): a new work's catalogue number, key and form come from its title
// at once, from the new-work form and from an album's tracks alike.
test("#39 a new work has its catalogue number, key and form at once", async (t) => {
  const s = await setup(t);
  const m = new Metadata(s.c);
  const fields = (work) => Object.fromEntries(["catalogue", "key", "form"].map((field) => [field, m.resolve(work, field).value]));
  const made = (await s.ok("create-work", { title: "Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2", composer: "", movements: [] })).selection;
  const own = fields(made);
  assert.ok(own.catalogue && own.key && own.form, JSON.stringify(own));
  assert.match(String(own.catalogue), /27/);
  assert.match(String(own.key), /C.sharp minor/i);
  const fromAlbum = (await s.ok("create-work-from-album", { albumId: "A", tracks: s.trackIds("A"), title: "Symphony No. 5 in C minor, Op. 67", composer: "", composerName: "Ludwig van Beethoven" }, "album:A")).selection;
  assert.ok(fields(fromAlbum).catalogue && fields(fromAlbum).key, JSON.stringify(fields(fromAlbum)));
  // Derived, so the admin's own values still win and a later edit replaces them.
  await s.ok("save-entity", { target: made, key: "C-sharp minor (Moonlight)" }, made);
  assert.equal(fields(made).key, "C-sharp minor (Moonlight)");
});
