import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { tempFolders, copyFixture } from "./helpers.js";

async function setup(t) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const input = {
    ...folders,
    user: { id: 1, role: "admin" },
    pageId: "editor",
    capabilities: { adminForms: 1 },
  };
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(() => {
    try {
      c.close();
    } catch {}
  });
  const read = (selection = "", query = {}) =>
    readEditor({ ...input, query: { selection, ...query } });
  const mutate = async (command, values, options = {}) =>
    mutateEditor({
      ...input,
      mutation: { revision: (await read()).revision, command, values },
      ...options,
    });
  const create = async (command, values) => {
    const r = await mutate(command, values);
    assert.equal(r.ok, true, r.message);
    return r.selection;
  };
  const composer = () => create("create-composer", { name: "Local composer" });
  const work = (
    composer = "",
    movements = "I. First\nII. Second\nIII. Third",
  ) => create("create-work", { title: "Private sonata", composer, movements });
  const broadcast = (work) =>
    create("create-broadcast", {
      work,
      title: "Private broadcast",
      date: "2026-11",
      description: "No external match",
    });
  return { folders, input, c, read, mutate, create, composer, work, broadcast };
}

test("admin creates composer, multi-movement work and broadcast with no external catalogue", async (t) => {
  const s = await setup(t),
    composer = await s.composer(),
    work = await s.work(composer),
    recording = await s.broadcast(work);
  const m = new Metadata(s.c);
  assert.equal(m.resolve(composer, "name").value, "Local composer");
  assert.equal(m.resolve(recording, "date").value, "2026-11");
  assert.equal(
    s.c.db
      .prepare(
        "SELECT count(*) AS n FROM relation WHERE kind='movement' AND source_id=?",
      )
      .get(work).n,
    3,
  );
  assert.equal(
    s.c.db
      .prepare(
        "SELECT count(*) AS n FROM credit WHERE target_id=? AND role='composer'",
      )
      .get(work).n,
    1,
  );
  assert.equal(
    s.c.db.prepare("SELECT count(*) AS n FROM external_identity").get().n,
    0,
  );
  const view = await s.read(work);
  assert.ok(view.forms.some((f) => f.command === "create-broadcast"));
  const performance = s.c.db
    .prepare(
      "SELECT target_id FROM relation WHERE kind='recording_performance' AND source_id=?",
    )
    .get(recording).target_id;
  assert.equal(s.c.entity(performance).data.datePrecision, "month");
});

test("movement reorder accepts only an exact permutation, remains atomic and supports later additions", async (t) => {
  const s = await setup(t),
    work = await s.work();
  const before = s.c.db
    .prepare(
      "SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position",
    )
    .all(work)
    .map((r) => r.target_id);
  const reversed = [...before].reverse();
  assert.equal(
    (await s.mutate("reorder-movements", { work, order: reversed })).ok,
    true,
  );
  for (const order of [
    [reversed[0], reversed[0], reversed[2]],
    reversed.slice(1),
    [...reversed, "other"],
  ])
    assert.equal(
      (await s.mutate("reorder-movements", { work, order })).ok,
      false,
    );
  const actual = s.c.db
    .prepare(
      "SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position",
    )
    .all(work)
    .map((r) => r.target_id);
  assert.deepEqual(actual, reversed);
  assert.equal(
    (await s.mutate("add-movement", { work, title: "IV. Finale" })).ok,
    true,
  );
  assert.equal(
    s.c.db
      .prepare(
        "SELECT max(position) AS n FROM relation WHERE kind='movement' AND source_id=?",
      )
      .get(work).n,
    4,
  );
});

test("provider/pinned fields and explicit use-provider preserve blank/null and conflict history", async (t) => {
  const s = await setup(t),
    work = await s.work(),
    m = new Metadata(s.c);
  m.refresh(work, "musicbrainz", "fixture", {
    title: "Provider title",
    nickname: "Provider name",
  });
  const edit = (field, value, blank = false) =>
    s.mutate("edit-field", { target: work, field, value, blank, pin: true });
  assert.equal((await edit("title", "")).ok, true);
  assert.equal((await edit("nickname", "", true)).ok, true);
  m.refresh(work, "openopus", "other", { title: "Conflicting title" });
  m.refresh(work, "musicbrainz", "fixture", {
    title: "Updated provider",
    nickname: "Updated name",
  });
  const view = await s.read(work),
    title = view.forms.find((f) => f.id === "edit-title");
  assert.equal(title.fields.find((f) => f.key === "value").value, "");
  assert.match(title.fields[0].help, /Pinned override/);
  assert.match(title.fields[0].help, /Updated provider/);
  assert.equal(m.resolve(work, "nickname").value, null);
  assert.equal(
    (await s.mutate("use-provider", { target: work, field: "title" })).ok,
    true,
  );
  assert.equal(m.resolve(work, "title").value, "Updated provider");
  assert.equal(m.resolve(work, "title").pinned, false);
  assert.ok(
    s.c.db
      .prepare("SELECT 1 FROM review_item WHERE kind='provider_conflict'")
      .get(),
  );
  assert.equal(
    (await s.mutate("use-provider", { target: work, field: "unknown" })).ok,
    false,
  );
});

test("stale tabs and intervening provider refresh cannot overwrite newer metadata", async (t) => {
  const s = await setup(t),
    work = await s.work(),
    old = (await s.read(work)).revision;
  new Metadata(s.c).refresh(work, "musicbrainz", "fixture", {
    title: "Provider changed",
  });
  const r = await s.mutate(
    "edit-field",
    { target: work, field: "title", value: "Old tab", blank: false, pin: true },
    {
      mutation: {
        revision: old,
        command: "edit-field",
        values: {
          target: work,
          field: "title",
          value: "Old tab",
          blank: false,
          pin: true,
        },
      },
    },
  );
  assert.equal(r.status, 409);
  assert.equal(
    new Metadata(s.c).resolve(work, "title").value,
    "Provider changed",
  );
});

test("owned read-only files attach to one recording interpretation; duplicate, missing and wrong-parent links fail", async (t) => {
  const s = await setup(t),
    work = await s.work(),
    recording = await s.broadcast(work),
    other = await s.work();
  const file = await copyFixture(
    "sine.flac",
    path.join(s.folders.libraryFolder, "readonly.flac"),
  );
  const before = await fs.readFile(file);
  await fs.chmod(file, 0o444);
  const [link] = reconcile(s.c, {
    version: 1,
    complete: true,
    instanceId: "fixture",
    epoch: "1",
    generation: 1,
    tracks: [
      {
        coreId: "1",
        fileId: "1",
        path: file,
        size: before.length,
        durationMs: 2000,
        fingerprint: "test:1",
      },
    ],
  });
  classify(s.c, link.id, { genres: ["Rock"] });
  const pw = s.c.db
    .prepare(
      "SELECT pw.* FROM relation rp JOIN relation pw ON pw.source_id=rp.target_id WHERE rp.source_id=? AND rp.kind='recording_performance' AND pw.kind='performance_work'",
    )
    .get(recording);
  const movement = s.c.db
    .prepare(
      "SELECT target_id FROM relation WHERE source_id=? AND kind='movement' ORDER BY position",
    )
    .get(work).target_id;
  const values = {
    recording,
    performanceWork: pw.id,
    movement,
    track: link.id,
    confirmClassical: false,
  };
  assert.equal((await s.mutate("attach-track", values)).ok, false);
  assert.equal(
    (await s.mutate("attach-track", { ...values, confirmClassical: true })).ok,
    true,
  );
  assert.equal(
    (await s.mutate("attach-track", { ...values, confirmClassical: true })).ok,
    false,
  );
  assert.equal(
    s.c.db.prepare("SELECT count(*) AS n FROM segment").get().n,
    1,
    "duplicate attachment rolls all intermediate writes back",
  );
  const wrong = s.c.db
    .prepare(
      "SELECT target_id FROM relation WHERE source_id=? AND kind='movement'",
    )
    .get(other).target_id;
  assert.equal(
    (await s.mutate("attach-track", { ...values, movement: wrong })).ok,
    false,
  );
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o444);
  const item = s.c.db.prepare("SELECT id FROM realization_item").get().id;
  assert.equal((await s.mutate("detach-track", { recording, item })).ok, true);
  assert.equal(
    s.c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n,
    0,
  );
  assert.deepEqual(await fs.readFile(file), before);
});

test("role-aware credits validate contributor kinds and keep actor attribution", async (t) => {
  const s = await setup(t),
    work = await s.work();
  const performer = await s.create("create-contributor", {
    name: "Solo pianist",
    kind: "person",
  });
  const orchestra = await s.create("create-contributor", {
    name: "Local orchestra",
    kind: "ensemble",
  });
  const values = {
    target: work,
    contributor: performer,
    role: "soloist",
    instrument: "piano",
  };
  assert.equal((await s.mutate("add-credit", values)).ok, true);
  assert.equal((await s.mutate("add-credit", values)).ok, false);
  assert.equal(
    (
      await s.mutate("add-credit", {
        ...values,
        contributor: orchestra,
        role: "conductor",
      })
    ).ok,
    false,
  );
  const audit = s.c.db
    .prepare("SELECT * FROM audit_event WHERE action='editor.add-credit'")
    .get();
  assert.equal(audit.actor, "1");
  assert.equal(JSON.parse(audit.data).values.role, "soloist");
});

test("regular/synthetic users, missing page capability, forged fields and malformed commands cannot mutate", async (t) => {
  const s = await setup(t);
  for (const input of [
    { ...s.input, user: { id: 2, role: "user" } },
    { ...s.input, user: { id: -1, role: "admin" } },
    { ...s.input, capabilities: {} },
    { ...s.input, pageId: "other" },
  ]) {
    await assert.rejects(readEditor(input), /requires/);
    await assert.rejects(mutateEditor(input), /requires/);
  }
  assert.equal(
    (
      await s.mutate("create-composer", {
        name: "Forbidden extra",
        user: { role: "admin" },
      })
    ).ok,
    false,
  );
  assert.equal((await s.mutate("unknown", {})).ok, false);
  assert.equal(
    (
      await s.mutate("create-work", {
        title: "Bad",
        composer: "not-a-real-person",
        movements: "One",
      })
    ).ok,
    false,
  );
  assert.equal(s.c.db.prepare("SELECT count(*) AS n FROM entity").get().n, 0);
});

test("catalogue pagination/search keeps all entries accessible and typed list fields editable", async (t) => {
  const s = await setup(t);
  let last;
  for (let i = 0; i < 105; i++)
    last = await s.create("create-composer", {
      name: `Composer ${String(i).padStart(3, "0")}`,
    });
  const first = await s.read(),
    next = await s.read("", { offset: "100" });
  assert.equal(first.navigation.items.length, 100);
  assert.equal(next.navigation.items.length, 5);
  assert.equal(
    (await s.read("", { q: "Composer 104" })).navigation.items[0].id,
    last,
  );
  const work = await s.work();
  assert.equal(
    (
      await s.mutate("edit-field", {
        target: work,
        field: "instrumentation",
        value: "piano\nviolin",
        blank: false,
        pin: true,
      })
    ).ok,
    true,
  );
  assert.deepEqual(new Metadata(s.c).resolve(work, "instrumentation").value, [
    "piano",
    "violin",
  ]);
});

test("long metadata remains editable with bounded choice labels and no unrelated creation forms", async (t) => {
  const s = await setup(t),
    work = await s.work();
  assert.equal(
    (
      await s.mutate("edit-field", {
        target: work,
        field: "title",
        value: "A".repeat(9000),
        blank: false,
        pin: true,
      })
    ).ok,
    true,
  );
  const page = await s.read(work);
  assert.ok(page.navigation.items.every((item) => item.label.length <= 500));
  assert.ok(
    page.forms.every(
      (f) =>
        !["create-work", "create-composer", "create-contributor"].includes(
          f.command,
        ),
    ),
  );
  assert.equal(page.forms[0].id, "edit-title");
});
