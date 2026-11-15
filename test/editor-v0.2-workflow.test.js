// v0.2 editor workflow fixes: pages that stay put, moving tracks between
// works, new movements while assigning, merges either way that add missing
// movements, and identity reviews that say what they ask.
import assert from "node:assert/strict";
import test from "node:test";
import { Metadata } from "../src/model/metadata.js";
import { workMovements } from "../src/model/auto-match.js";
import { boxSet } from "./box-set.js";

const section = (view, id) => view.sections.find((s) => s.id === id);
const trackId = (c, core) => c.db.prepare("SELECT id FROM track_link WHERE core_id=?").get(core).id;
const workTitled = (c, title) =>
  c.db
    .prepare(
      `SELECT f.target_id AS id FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
       JOIN entity e ON e.id=f.target_id AND e.kind='work' AND e.deleted_at IS NULL
       WHERE f.field='title' AND json_extract(a.value,'$')=?`,
    )
    .get(title)?.id;
const worksOfTrack = (c, track) =>
  c.db
    .prepare(
      `SELECT r.work_id,i.movement_id FROM segment s JOIN realization_item i ON i.segment_id=s.id
       JOIN realization r ON r.id=i.realization_id WHERE s.track_link_id=?`,
    )
    .all(track)
    .map((row) => ({ ...row }));
function newWork(c, title, movements) {
  const m = new Metadata(c);
  const work = c.createEntity("work");
  m.manual(work, "title", title, { actor: "test", pin: true });
  movements.forEach((name, index) => {
    const movement = c.createEntity("movement");
    m.manual(movement, "title", name, { actor: "test", pin: true });
    c.relate("movement", work, movement, { position: index + 1 });
  });
  return work;
}

test("album grouping selects tracks once, chooses existing or new, then applies only those tracks", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const start = "album:box~6";
  const initial = (await read({ selection: start })).view;
  const tracks = section(initial, "tracks");
  assert.ok(tracks, "one track list replaces split lists and repeated forms");
  assert.equal(tracks.rows.length, 40);
  assert.equal(initial.sections.filter((s) => s.type === "form").length, 0);
  const [a, b, other] = tracks.rows.map((row) => row.id);
  const begin = tracks.select.actions.find((action) => action.command === "move-tracks-open");
  const before = c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n;
  const opened = await mutate(begin.command, { ...begin.arguments, tracks: [b, a] }, start);
  assert.equal(opened.ok, true, opened.message);
  const choice = (await read({ selection: opened.selection })).view;
  assert.equal(section(choice, "tracks"), undefined, "selected tracks aren't repeated alongside the form");
  assert.equal(choice.sections.filter((s) => s.type === "form").length, 1);
  assert.ok(choice.badges.some((badge) => badge.label === "2 tracks selected"));
  const create = choice.actions.find((action) => action.command === "new-album-work");
  assert.ok(create, "create is an explicit choice, not an always-open form");
  const creating = await mutate(create.command, create.arguments, opened.selection);
  assert.equal(creating.ok, true, creating.message);
  const newView = (await read({ selection: creating.selection })).view;
  const form = section(newView, "new-work");
  assert.deepEqual(form.arguments.tracks, [a, b], "album order wins over checkbox click order");
  assert.equal(newView.sections.filter((s) => s.type === "form").length, 1);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n, before, "choosing and canceling never assigns");
  const cancel = newView.actions.find((action) => action.label === "Cancel grouping");
  assert.equal(cancel.arguments.selection, start);
  const back = newView.actions.find((action) => action.label === "Choose a different work");
  assert.equal(back.arguments.selection, opened.selection, "back keeps the selected-track token");

  const done = await mutate(form.command, { ...form.arguments, title: "Selected pieces", composer: "", composerName: "Joseph Haydn", include: ["include", ""] }, creating.selection);
  assert.equal(done.ok, true, done.message);
  assert.equal(done.selection, start, "apply returns to the album page");
  assert.equal(worksOfTrack(c, a).length, 1);
  assert.equal(worksOfTrack(c, b).length, 0, "Skip leaves the track untouched");
  assert.equal(worksOfTrack(c, other).length, 0, "unselected tracks never enter the work");

  const previousWork = worksOfTrack(c, a)[0].work_id;
  const moving = await mutate("move-tracks-open", { albumId: "box", tracks: [a], page: "6" }, start);
  const movingView = (await read({ selection: moving.selection })).view;
  const newAction = movingView.actions.find((action) => action.command === "new-album-work");
  const newStep = await mutate(newAction.command, newAction.arguments, moving.selection);
  const moveForm = section((await read({ selection: newStep.selection })).view, "new-work");
  const moved = await mutate(moveForm.command, { ...moveForm.arguments, title: "Moved selected piece", composer: "", composerName: "", include: ["include"] }, newStep.selection);
  assert.equal(moved.ok, true, moved.message);
  assert.equal(worksOfTrack(c, a).length, 1, "creating a work moves an already assigned selected track once");
  assert.notEqual(worksOfTrack(c, a)[0].work_id, previousWork);
});

test("selected album tracks keep classification defaults and reject a changed selection at apply", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const selection = "album:box~6";
  const a = trackId(c, "box-600");
  const b = trackId(c, "box-601");
  await mutate("set-classification", { tracks: [a], state: "not_classical" }, selection);
  const opened = await mutate("move-tracks-open", { albumId: "box", tracks: [a, b], page: "6" }, selection);
  const target = newWork(c, "Small suite", ["I. Prelude"]);
  const choose = section((await read({ selection: opened.selection })).view, "move");
  const chosen = await mutate(choose.command, { ...choose.arguments, work: target }, opened.selection);
  const assigning = (await read({ selection: chosen.selection })).view;
  const form = section(assigning, "assign");
  assert.equal(form.fields[0].value[0], "", "Not classical starts as Skip");
  assert.deepEqual(form.arguments.tracks, [a, b]);
  const invalid = await mutate(form.command, { ...form.arguments, tracks: [a, trackId(c, "box-602")], mapping: ["", "new"] }, chosen.selection);
  assert.equal(invalid.ok, false, "apply must use the offered selected tracks");
  const done = await mutate(form.command, { ...form.arguments, mapping: ["", "new"] }, chosen.selection);
  assert.equal(done.ok, true, done.message);
  assert.equal(worksOfTrack(c, a).length, 0);
  assert.equal(worksOfTrack(c, b).length, 1);
});

test("the list opens on the page holding the open entry; a track leads back to its album page", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  for (let i = 0; i < 150; i++) newWork(c, `Zz work ${String(i).padStart(3, "0")}`, []);
  const late = workTitled(c, "Zz work 140");
  const located = await read({ selection: late, offset: "" });
  assert.equal(located.tab, "works");
  assert.equal(located.list.offset, 100);
  assert.ok(located.list.items.some((item) => item.selection === late));
  // An explicit page is kept as asked.
  assert.equal((await read({ selection: late, offset: "0" })).list.offset, 0);

  const track = trackId(c, "box-250");
  const view = (await read({ selection: `track:${track}` })).view;
  assert.equal(view.crumbs[0].selection, "album:box~2");
  // Album actions keep the page they were taken on.
  const page = (await read({ selection: "album:box~2" })).view;
  const send = page.actions.find((a) => a.label === "Send all to Classical");
  assert.equal(send.arguments.page, "2");
  const result = await mutate(send.command, send.arguments, "album:box~2");
  assert.equal(result.selection, "album:box~2");
});

test("long sections in an entry page 100 rows at a time, the page kept in the selection", async (t) => {
  const { c, read } = await boxSet(t);
  const names = Array.from({ length: 130 }, (_, i) => `${i + 1}. Variation`);
  const work = newWork(c, "Many variations", names);
  const first = section((await read({ selection: `${work}!movements` })).view, "movements");
  assert.equal(first.rows.length, 100);
  assert.equal(first.pager.label, "Movements 1–100 of 130");
  assert.equal(first.pager.next, `${work}~1!movements`);
  const second = await read({ selection: `${work}~1` });
  assert.equal(section(second.view, "movements").rows.length, 30);
  assert.equal(section(second.view, "movements").pager.previous, `${work}!movements`);
  assert.equal(second.tab, "works");
});

test("ticked tracks move to another work in one step, onto its movements or new ones", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const from = workTitled(c, "Sonata No. 1, Op. 1");
  const to = workTitled(c, "Sonata No. 2, Op. 2");
  assert.ok(from && to, "the tagged sonatas are works");
  const [a, b] = [trackId(c, "box-0"), trackId(c, "box-1")];
  assert.equal(worksOfTrack(c, a)[0].work_id, from);

  const page = (await read({ selection: "album:box" })).view;
  const move = section(page, "tracks").select.actions.find((x) => x.command === "move-tracks-open");
  const opened = await mutate(move.command, { ...move.arguments, tracks: [a, b] }, "album:box");
  assert.equal(opened.ok, true);
  assert.equal(opened.focus, "move");
  assert.match(opened.selection, /^album:box![0-9a-f-]{36}$/);
  const choose = section((await read({ selection: opened.selection })).view, "move");
  assert.equal(choose.title, "Choose a work for 2 tracks");

  const chosen = await mutate(choose.command, { ...choose.arguments, work: to }, opened.selection);
  assert.equal(chosen.focus, "assign");
  const assign = section((await read({ selection: chosen.selection })).view, "assign");
  assert.deepEqual(assign.arguments.tracks, [a, b]);
  const mapping = assign.fields[0];
  assert.ok(mapping.options.some((o) => o.value === "new"), "New movement is offered");
  assert.match(mapping.rows[0].detail, /^Now in Sonata No\. 1/);

  const target = workMovements(c, to);
  const done = await mutate(assign.command, { ...assign.arguments, mapping: [target[0].id, "new"] }, chosen.selection);
  assert.equal(done.ok, true, done.message);
  assert.match(done.message, /^Moved 2 tracks to “Sonata No\. 2, Op\. 2”; added 1 movement/);
  assert.equal(done.focus, "tracks");
  assert.deepEqual(worksOfTrack(c, a), [{ work_id: to, movement_id: target[0].id }]);
  const after = workMovements(c, to);
  assert.equal(after.length, target.length + 1);
  assert.equal(worksOfTrack(c, b)[0].movement_id, after.at(-1).id);
  assert.match(after.at(-1).title, /Adagio/);
});

test("assigning to an existing work can add a movement for a track it lacks", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const work = newWork(c, "Short suite", ["I. Prelude"]);
  const lone = trackId(c, "box-600");
  const chosen = await mutate("choose-album-work", { albumId: "box", work, page: "6" }, "album:box~6");
  assert.ok(chosen.selection.startsWith(`album:box@${work}~6!`));
  const assign = section((await read({ selection: chosen.selection })).view, "assign");
  const mapping = assign.arguments.tracks.map((id) => (id === lone ? "new" : ""));
  const done = await mutate(assign.command, { ...assign.arguments, mapping }, chosen.selection);
  assert.equal(done.ok, true, done.message);
  assert.equal(done.selection, "album:box~6");
  assert.equal(workMovements(c, work).length, 2);
});

test("a merge adds the movements the kept work lacks and opens them; either way round; undoable", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const keep = workTitled(c, "Sonata No. 3, Op. 3");
  const extra = newWork(c, "Sonata No. 3 (copy)", ["I. Allegro", "V. Finale"]);
  const form = section((await read({ selection: `${keep}!merge` })).view, "merge");
  assert.deepEqual(form.fields.find((f) => f.key === "direction").options.map((o) => o.value), ["into", "from"]);
  // On the kept work: merge the other into this.
  const merged = await mutate("merge-entity", { target: keep, into: extra, direction: "from", confirm: true }, keep);
  assert.equal(merged.ok, true, merged.message);
  assert.equal(merged.selection, `${keep}!movements`);
  assert.equal(merged.focus, "movements");
  assert.match(merged.message, /Added 1 movement .*“V\. Finale”/);
  const titles = workMovements(c, keep).map((m) => m.title);
  assert.deepEqual(titles, ["I. Allegro", "II. Adagio", "III. Menuetto", "IV. Rondo", "V. Finale"]);
  assert.ok(c.db.prepare("SELECT deleted_at FROM entity WHERE id=?").get(extra).deleted_at);
  const change = c.db.prepare("SELECT id FROM change_set WHERE kind='merge' ORDER BY created_at DESC").get().id;
  assert.equal((await mutate("undo-change", { id: change }, `change:${change}`)).ok, true);
  assert.equal(workMovements(c, keep).length, 4);
  assert.deepEqual(workMovements(c, extra).map((m) => m.title), ["I. Allegro", "V. Finale"]);
});

test("identity reviews say what they ask and offer the fixes", async (t) => {
  const { c, read, mutate } = await boxSet(t);
  const holder = workTitled(c, "Sonata No. 4, Op. 4");
  const other = workTitled(c, "Sonata No. 5, Op. 5");
  c.externalIdentity(holder, "musicbrainz", "work", "11111111-1111-1111-1111-111111111111");
  assert.equal(c.externalIdentity(other, "musicbrainz", "work", "11111111-1111-1111-1111-111111111111", { evidence: { via: "test" } }), false);
  const unsure = workTitled(c, "Sonata No. 6, Op. 6");
  c.externalIdentity(unsure, "musicbrainz", "work", "22222222-2222-2222-2222-222222222222", { confidence: 0.8 });
  const reviews = (await read({ tab: "review" })).list.items;
  const details = reviews.map((item) => item.detail);
  assert.ok(details.includes("This MusicBrainz work is already linked to “Sonata No. 4, Op. 4”: the same piece twice, or the wrong match?"), details.join("\n"));
  assert.ok(details.includes("Matched a MusicBrainz work only 80% sure; not linked until you confirm"), details.join("\n"));
  const id = c.db.prepare("SELECT id FROM review_item WHERE kind='identity' AND target_id=?").get(other).id;
  const view = (await read({ selection: `review:${id}` })).view;
  const labels = view.actions.map((a) => a.label);
  for (const label of ["Merge into “Sonata No. 4, Op. 4”", "Merge “Sonata No. 4, Op. 4” into this", "Link here instead", "Dismiss"]) assert.ok(labels.includes(label), labels.join(", "));
  const facts = Object.fromEntries(section(view, "evidence").items.map((item) => [item.label, item.value]));
  assert.equal(facts["Now linked to"], "Sonata No. 4, Op. 4");
  assert.equal(facts["MusicBrainz work"], "https://musicbrainz.org/work/11111111-1111-1111-1111-111111111111");
  assert.ok(section(view, "compare"), "both works side by side");
  const link = view.actions.find((a) => a.label === "Link here instead");
  assert.equal((await mutate(link.command, link.arguments, `review:${id}`)).ok, true);
  const active = c.db.prepare("SELECT entity_id FROM external_identity WHERE record_id=? AND state='active'").all("11111111-1111-1111-1111-111111111111").map((row) => ({ ...row }));
  assert.deepEqual(active, [{ entity_id: other }]);
});
