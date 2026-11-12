import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks, repairMergedIdentities } from "../src/model/auto-match.js";
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
  assert.ok(section(album, "new-work"));
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
  const form = section((await s.read({ selection: "album:A" })).view, "new-work");
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
  const second = (await s.ok("create-work", { title: "Symphony No. 5 in C minor, Op. 67", composer: "", movements: titles })).selection;
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

test("v1 hosts still get the v1 editor", async (t) => {
  const s = await setup(t);
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const page = await readEditor({ ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 1 }, query: {} });
  assert.equal(page.version, 1);
  assert.ok(s);
});
