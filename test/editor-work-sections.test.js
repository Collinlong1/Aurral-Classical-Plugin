import assert from "node:assert/strict";
import test from "node:test";
import { boxSet } from "./box-set.js";
import { mutateEditor } from "../src/model/editor.js";

const section = (view, id) => view.sections.find((item) => item.id === id);
const formCount = (view) => view.sections.filter((item) => item.type === "form").length;
async function fixture(t, movements = ["I. Allegro", "II. Adagio"]) {
  const s = await boxSet(t);
  const created = await s.mutate("create-work", { title: "Sectioned suite", movements: movements.slice(0, 100) }, "");
  assert.equal(created.ok, true, created.message);
  if (movements.length > 100) {
    const extra = await s.mutate("add-movement", { work: created.selection, title: movements.slice(100) }, created.selection);
    assert.equal(extra.ok, true, extra.message);
  }
  return { ...s, work: created.selection };
}
async function go(s, selection, label) {
  const view = (await s.read({ selection })).view;
  const action = view.actions.find((item) => item.label === label)
    || view.sections.flatMap((item) => item.actions || []).find((item) => item.label === label);
  assert.ok(action, `${label} is available`);
  const next = await s.mutate(action.command, action.arguments, selection);
  assert.equal(next.ok, true, next.message);
  return next.selection;
}

test("work sections show one task at a time and reveal add/advanced forms only on request", async (t) => {
  const s = await fixture(t);
  const initial = (await s.read({ selection: s.work })).view;
  assert.deepEqual(initial.sections.map((item) => item.id), ["details"]);
  assert.equal(initial.actions.some((item) => item.command === "delete-entity"), false);
  for (const [label, id, addLabel, addId] of [
    ["Movements", "movements", "Add movements", "add-movement"],
    ["Credits", "credits", "Add a credit", "add-credit"],
    ["Recordings", "recordings", "Add a broadcast recording", "broadcast"],
  ]) {
    const selected = await go(s, s.work, label);
    const view = (await s.read({ selection: selected })).view;
    assert.deepEqual(view.sections.map((item) => item.id), [id]);
    assert.equal(formCount(view), 0);
    const adding = await go(s, selected, addLabel);
    const addView = (await s.read({ selection: adding })).view;
    assert.deepEqual(addView.sections.map((item) => item.id), [addId]);
    assert.equal(formCount(addView), 1);
    const back = await go(s, adding, "Cancel");
    assert.equal(back, selected);
  }
  const advanced = await go(s, s.work, "Advanced");
  const view = (await s.read({ selection: advanced })).view;
  assert.equal(formCount(view), 0);
  assert.ok(section(view, "advanced").actions.find((item) => item.command === "delete-entity").confirm);
  const merging = await go(s, advanced, "Merge with another work");
  assert.equal(formCount((await s.read({ selection: merging })).view), 1);
  assert.ok(section((await s.read({ selection: merging })).view, "merge"));
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM relation WHERE source_id=? AND kind='movement'").get(s.work).n, 2);
});

test("work section mutations return to the relevant section and preserve pagination", async (t) => {
  const s = await fixture(t, Array.from({ length: 101 }, (_, i) => `Variation ${i + 1}`));
  const movements = await go(s, s.work, "Movements");
  const page2 = section((await s.read({ selection: movements })).view, "movements").pager.next;
  const adding = await go(s, page2, "Add movements");
  const add = section((await s.read({ selection: adding })).view, "add-movement");
  const added = await s.mutate(add.command, { ...add.arguments, title: ["Finale"] }, adding);
  assert.equal(added.ok, true, added.message);
  const after = section((await s.read({ selection: added.selection })).view, "movements");
  assert.equal(after.rows.length, 2);
  assert.equal(after.pager.label, "Movements 101–102 of 102");
  assert.ok(after.rows.some((row) => row.label === "Finale"));
  const move = after.rows[1].actions.find((item) => item.command === "move-movement");
  const moved = await s.mutate(move.command, move.arguments, added.selection);
  assert.equal(moved.ok, true, moved.message);
  assert.equal(moved.selection, added.selection);
  const credits = await go(s, s.work, "Credits");
  const newPerson = await s.mutate("create-contributor", { name: "Test violinist", kind: "person" }, "");
  const addCredit = await go(s, credits, "Add a credit");
  const creditForm = section((await s.read({ selection: addCredit })).view, "add-credit");
  const credited = await s.mutate(creditForm.command, { ...creditForm.arguments, contributor: newPerson.selection, role: "performer", instrument: "violin" }, addCredit);
  assert.equal(credited.ok, true, credited.message);
  assert.equal(credited.selection, credits);
  assert.equal(section((await s.read({ selection: credits })).view, "credits").rows[0].label, "Test violinist");
});

test("section addresses retain entry identity and stale/cross-entry protection", async (t) => {
  const s = await fixture(t);
  const movements = await go(s, s.work, "Movements");
  const adding = await go(s, movements, "Add movements");
  const snapshot = await s.read({ selection: adding });
  const another = await s.mutate("create-work", { title: "Other suite", movements: [] }, "");
  const cross = await mutateEditor({ ...s.input, mutation: { revision: snapshot.revision, command: "add-movement", values: { work: another.selection, title: ["Wrong work"] } } });
  assert.equal(cross.ok, false);
  assert.equal(cross.status, 409);
  await s.mutate("save-entity", { target: s.work, title: "Edited elsewhere" }, s.work);
  const stale = await mutateEditor({ ...s.input, mutation: { revision: snapshot.revision, command: "add-movement", values: { work: s.work, title: ["Stale"] } } });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  const listed = await s.read({ selection: adding, offset: "" });
  assert.ok(listed.list.items.some((item) => item.selection === s.work));
  const legacy = (await s.read({ selection: `${s.work}~1` })).view;
  assert.ok(section(legacy, "movements"), "legacy paged work links still open movements");
});

test("Reorder movements moves several at once and keeps the rest in order", async (t) => {
  const s = await fixture(t, ["A", "B", "C", "D", "E"]);
  const names = () => s.c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(s.work).map((row) => row.target_id);
  const ids = names();
  const movements = await go(s, s.work, "Movements");
  const reordering = await go(s, movements, "Reorder movements");
  const view = (await s.read({ selection: reordering })).view;
  assert.deepEqual(view.sections.map((item) => item.id), ["reorder"]);
  const form = section(view, "reorder");
  assert.deepEqual(form.arguments.movements, ids);
  assert.deepEqual(form.fields[0].value, ["1", "2", "3", "4", "5"]);
  assert.equal(form.fields[0].rows[4].label, "5. E");

  // Unchanged positions write nothing.
  const same = await s.mutate(form.command, { ...form.arguments, positions: ["1", "2", "3", "4", "5"] }, reordering);
  assert.equal(same.message, "The order is unchanged.");
  assert.deepEqual(names(), ids);

  // E to 1 and A to 3: the others keep their order around them.
  const saved = await s.mutate(form.command, { ...form.arguments, positions: ["3", "2", "3", "4", "1"] }, reordering);
  assert.equal(saved.ok, true, saved.message);
  assert.match(saved.message, /moved 2 movements/);
  assert.equal(saved.selection, movements, "returns to Movements");
  assert.equal(saved.focus, "movements");
  const [a, b, c, d, e] = ids;
  assert.deepEqual(names(), [e, b, a, c, d]);

  // A stale page (the movements changed) and invalid positions are refused.
  const stale = await s.mutate(form.command, { ...form.arguments, positions: ["2", "1", "3", "4", "5"] }, reordering);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  const fresh = section((await s.read({ selection: reordering })).view, "reorder");
  const invalid = await s.mutate(fresh.command, { ...fresh.arguments, positions: ["1", "2", "3", "4", "9"] }, reordering);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
  assert.deepEqual(names(), [e, b, a, c, d]);

  // A single movement has nothing to reorder.
  const single = await fixture(t, ["Only"]);
  const only = await go(single, single.work, "Movements");
  assert.equal(section((await single.read({ selection: only })).view, "movements").actions.some((item) => item.label === "Reorder movements"), false);
});
