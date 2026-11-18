import assert from "node:assert/strict";
import test from "node:test";
import { boxSet } from "./box-set.js";
import { readEditor } from "../src/model/editor.js";

// A host that shows form footer actions next to Submit (core `formActions`).
const footerHost = (s, selection) =>
  readEditor({ ...s.input, capabilities: { adminForms: 2, formActions: true }, query: { selection } });
const legacyHost = (s, selection) => s.read({ selection });
const formOf = (view) => view.sections.find((section) => section.type === "form");
const find = (actions, label) => (actions || []).find((action) => action.label === label);

async function follow(s, selection, label) {
  const view = (await s.read({ selection })).view;
  const action = find(view.actions, label) || find(view.sections.flatMap((section) => section.actions || []), label);
  assert.ok(action, `${label} is available`);
  const next = await s.mutate(action.command, action.arguments, selection);
  assert.equal(next.ok, true, next.message);
  return next.selection;
}

// Each form names where Cancel goes. A host that shows footer actions gets
// it beside Submit; older hosts drop that field, so they get it in the header.
async function checkCancel(s, selection, label, destination) {
  const footer = (await footerHost(s, selection)).view;
  const legacy = (await legacyHost(s, selection)).view;
  const cancel = find(formOf(footer).actions, label);
  assert.ok(cancel, `${label} sits beside Submit on ${selection}`);
  assert.deepEqual(cancel, { label, command: "open", arguments: { selection: destination } });
  assert.equal(find(footer.actions, label), undefined, "no second Cancel in the header");
  assert.deepEqual(find(legacy.actions, label), cancel, "older hosts keep the header Cancel");
  assert.equal(formOf(legacy).actions, undefined);
  const back = await s.mutate(cancel.command, cancel.arguments, selection);
  assert.equal(back.ok, true, back.message);
  assert.equal(back.selection, destination);
  return footer;
}

test("work add and merge forms offer Cancel beside Submit", async (t) => {
  const s = await boxSet(t);
  const created = await s.mutate("create-work", { title: "Footer suite", movements: ["I. Allegro"] }, "");
  assert.equal(created.ok, true, created.message);
  for (const [section, add] of [
    ["Movements", "Add movements"],
    ["Credits", "Add a credit"],
    ["Recordings", "Add a broadcast recording"],
    ["Advanced", "Merge with another work"],
  ]) {
    const parent = await follow(s, created.selection, section);
    const adding = await follow(s, parent, add);
    const view = await checkCancel(s, adding, "Cancel", parent);
    assert.equal(view.actions.length, 5, "the header keeps only section navigation");
  }
});

test("new entries and bulk edits return to the list on Cancel", async (t) => {
  const s = await boxSet(t);
  for (const kind of ["work", "composer", "performer"]) await checkCancel(s, `new:${kind}`, "Cancel", "");
  const one = await s.mutate("create-work", { title: "First", movements: [] }, "");
  const two = await s.mutate("create-work", { title: "Second", movements: [] }, "");
  const bulk = await s.mutate("bulk-edit-open", { works: [one.selection, two.selection] }, "");
  assert.equal(bulk.ok, true, bulk.message);
  const view = await checkCancel(s, bulk.selection, "Cancel", "");
  assert.ok(find(view.actions, "Delete these works"), "bulk actions stay in the header");
});

test("album grouping forms offer Cancel grouping beside Submit at every step", async (t) => {
  const s = await boxSet(t);
  const start = "album:box";
  const tracks = (await s.read({ selection: start })).view.sections.find((section) => section.id === "tracks").rows.slice(0, 2).map((row) => row.id);
  const opened = await s.mutate("move-tracks-open", { albumId: "box", tracks, page: "0" }, start);
  assert.equal(opened.ok, true, opened.message);
  const destination = (await legacyHost(s, opened.selection)).view.actions.find((action) => action.label === "Cancel grouping").arguments.selection;
  assert.equal(destination, start, "Cancel grouping returns to the album page");
  const choose = await checkCancel(s, opened.selection, "Cancel grouping", destination);
  assert.ok(find(choose.actions, "Create a new work"), "step choices stay in the header");
  const creating = await follow(s, opened.selection, "Create a new work");
  const create = await checkCancel(s, creating, "Cancel grouping", destination);
  assert.ok(find(create.actions, "Choose a different work"));
});

test("rejected saves name the field they are about, so the host can show them there", async (t) => {
  const s = await boxSet(t);
  const work = (await s.mutate("create-work", { title: "Field suite", movements: ["I. Allegro", "II. Adagio"] }, "")).selection;
  const broadcast = await s.mutate("create-broadcast", { work, title: "Radio", date: "2026-99" }, `${work}!broadcast`);
  assert.deepEqual([broadcast.ok, broadcast.status, broadcast.field], [false, 400, "date"]);
  const untitled = await s.mutate("create-broadcast", { work, title: " ", date: "" }, `${work}!broadcast`);
  assert.equal(untitled.field, "title");
  const recording = (await s.mutate("create-broadcast", { work, title: "Radio", date: "2026", description: "" }, `${work}!broadcast`)).selection;
  const details = await s.mutate("save-entity", { target: recording, date: "nope" }, recording);
  assert.deepEqual([details.ok, details.field], [false, "date"]);
  const self = await s.mutate("merge-open", { target: work, into: work }, `${work}!merge`);
  assert.equal(self.field, "into");
  const created = await s.mutate("create-work", { title: "", movements: [] }, "new:work");
  assert.equal(created.field, "title");
  // #32 (E5): empty and over-long values in a save, and in a bulk edit.
  const empty = await s.mutate("save-entity", { target: work, title: "" }, work);
  assert.deepEqual([empty.ok, empty.status, empty.field], [false, 400, "title"]);
  const long = await s.mutate("save-entity", { target: work, title: "x".repeat(10001) }, work);
  assert.deepEqual([long.ok, long.field], [false, "title"]);
  assert.match(long.message, /10,000 characters or fewer/);
  const second = (await s.mutate("create-work", { title: "Field suite two", movements: [] }, "")).selection;
  const bulk = (await s.mutate("bulk-edit-open", { works: [work, second] }, "")).selection;
  const bulkLong = await s.mutate("bulk-edit", { token: bulk.slice("bulk:".length), period: "x".repeat(10001) }, bulk);
  assert.deepEqual([bulkLong.ok, bulkLong.field], [false, "period"]);
  // #32 (U1): a likely duplicate is a question for this form, not a conflict
  // to reload: 400, about "Create anyway".
  const duplicate = await s.mutate("create-work", { title: "Field suite", movements: [] }, "new:work");
  assert.deepEqual([duplicate.ok, duplicate.status, duplicate.field], [false, 400, "createAnyway"]);
  // A refusal about no particular field names none.
  const stale = await s.mutate("set-movement-order", { work, movements: ["x"], positions: ["1"] }, `${work}!reorder`);
  assert.deepEqual([stale.status, stale.field], [409, undefined]);
});
