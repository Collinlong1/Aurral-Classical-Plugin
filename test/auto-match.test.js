import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import {
  autoMatchTaggedWorks,
  mergeDuplicateAutoWorks,
  workKey,
} from "../src/model/auto-match.js";
import { renderWork } from "../src/model/presentation.js";

async function setup(t) {
  const folders = await tempFolders();
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(async () => {
    try {
      c.close();
    } catch {}
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  c.editorInput = { ...folders, pageId: "editor", user: { id: 1, role: "admin" }, capabilities: { adminForms: 2 } };
  return c;
}
let generation = 0;
const movements = ["I. Allegro con brio", "II. Andante con moto", "III. Scherzo. Allegro", "IV. Allegro"];
function album(albumId, base, work, { titles = movements, composer = "Ludwig van Beethoven" } = {}) {
  return titles.map((title, i) => ({
    coreId: `${albumId}-${i}`,
    fileId: `${albumId}-${i}`,
    path: `/library/${albumId}/${i}.flac`,
    size: 1000,
    durationMs: 60000,
    fingerprint: `audio-sha256-v2:${albumId}-${i}`,
    albumId,
    hints: {
      title,
      album: `Album ${albumId}`,
      composer: [composer],
      work: `${work}: ${title}`,
      trackNumber: i + 1,
      discNumber: 1,
      genres: ["Classical"],
    },
  }));
}
function scan(c, tracks) {
  if (!generation) c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const rows = reconcile(c, {
    version: 1,
    complete: true,
    instanceId: "i",
    epoch: "e",
    generation: ++generation,
    tracks,
  });
  for (const row of rows) classify(c, row.id, row.hints);
}
const count = (c, kind) =>
  c.db
    .prepare("SELECT count(*) AS n FROM entity WHERE kind=? AND deleted_at IS NULL")
    .get(kind).n;

test("work keys ignore spelling, key phrases and catalogue punctuation", () => {
  const b = ["Ludwig van Beethoven"];
  assert.equal(
    workKey("Symphony No. 5 in C minor, Op. 67", b),
    workKey("Symphony No.5, op.67", b),
  );
  assert.equal(workKey("Cello Suite No. 1 in G major, BWV 1007", ["J. S. Bach"]), workKey("Suite BWV 1007", ["J S Bach"]));
  assert.notEqual(workKey("String Quartet, Op. 18 No. 1", b), workKey("String Quartet, Op. 18 No. 2", b));
  assert.notEqual(workKey("Symphony No. 5, Op. 67", b), workKey("Symphony No. 5, Op. 67", ["Someone Else"]));
});

test("two albums of the same work share one work, one composer and its movements", async (t) => {
  generation = 0;
  const c = await setup(t);
  scan(c, [
    ...album("A", 0, "Symphony No. 5 in C minor, Op. 67"),
    ...album("B", 0, "Symphony No.5, Op.67"),
  ]);
  assert.deepEqual(autoMatchTaggedWorks(c, { actor: "model-scan" }), { created: 2, candidates: 2 });
  assert.equal(count(c, "work"), 1);
  assert.equal(count(c, "person"), 1);
  assert.equal(count(c, "movement"), 4);
  const work = c.db.prepare("SELECT id FROM entity WHERE kind='work'").get().id;
  const view = renderWork(c, work, { id: 1, role: "user" });
  assert.equal(view.recordings.length, 2);
  assert.ok(view.recordings.every((r) => r.complete));
  assert.deepEqual(
    view.work.movements.map((m) => m.title),
    movements,
    "movement titles drop the work prefix",
  );
  const m = new Metadata(c);
  const recording = c.db.prepare("SELECT id FROM entity WHERE kind='recording' LIMIT 1").get().id;
  assert.notEqual(m.resolve(recording, "title").value ?? null, null, "recordings are titled");
  // A third album, scanned later, attaches too; repeating is idempotent.
  scan(c, [
    ...album("A", 0, "Symphony No. 5 in C minor, Op. 67"),
    ...album("B", 0, "Symphony No.5, Op.67"),
    ...album("C", 0, "Symphony No. 5 in C minor, Op. 67"),
  ]);
  assert.equal(autoMatchTaggedWorks(c, {}).created, 1);
  assert.equal(autoMatchTaggedWorks(c, {}).created, 0);
  assert.equal(count(c, "work"), 1);
  assert.equal(renderWork(c, work, { id: 1, role: "user" }).recordings.length, 3);
});

test("an album whose movements can't be mapped is held for review, not duplicated", async (t) => {
  generation = 0;
  const c = await setup(t);
  scan(c, [
    ...album("A", 0, "Symphony No. 5, Op. 67"),
    ...album("B", 0, "Symphony No. 5, Op. 67", { titles: ["Excerpt one", "Excerpt two"] }),
  ]);
  autoMatchTaggedWorks(c, {});
  assert.equal(count(c, "work"), 1);
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='auto_match' AND status='open'").get().n,
    1,
  );
});

test("different composers or works never merge", async (t) => {
  generation = 0;
  const c = await setup(t);
  scan(c, [
    ...album("A", 0, "Symphony No. 5, Op. 67"),
    ...album("B", 0, "Symphony No. 5, Op. 64", { composer: "Pyotr Ilyich Tchaikovsky" }),
    ...album("C", 0, "Symphony No. 7, Op. 92"),
  ]);
  autoMatchTaggedWorks(c, {});
  assert.equal(count(c, "work"), 3);
  assert.equal(count(c, "person"), 2);
});

test("duplicates created by the old per-album rule are merged without losing picks", async (t) => {
  generation = 0;
  const c = await setup(t);
  scan(c, [...album("A", 0, "Symphony No. 5, Op. 67"), ...album("B", 0, "Symphony No. 5, Op. 67")]);
  // Reproduce the old behaviour: separate work, composer and movements per album.
  const m = new Metadata(c);
  const works = [];
  for (const albumId of ["A", "B"]) {
    const work = c.createEntity("work");
    m.derived(work, "title", "Symphony No. 5, Op. 67");
    const person = c.createEntity("person");
    m.derived(person, "name", "Ludwig van Beethoven");
    c.credit(work, person, "composer");
    c.externalIdentity(work, "embedded-tags", "album-work", `old-${albumId}`);
    const performance = c.createEntity("performance");
    const pw = c.relate("performance_work", performance, work);
    const realization = c.realization(work, pw, `Album ${albumId}`);
    const links = c.db
      .prepare("SELECT id FROM track_link WHERE json_extract(evidence,'$.albumId')=? ORDER BY core_id")
      .all(albumId);
    links.forEach(({ id }, i) => {
      const movement = c.createEntity("movement");
      m.derived(movement, "title", movements[i]);
      c.relate("movement", work, movement, { position: i + 1 });
      const recording = c.createEntity("recording");
      c.relate("recording_performance", recording, performance);
      const content = c.recordingContent(recording, pw, { movement });
      const segment = c.segment(id, { kind: "whole" });
      c.segmentContent(segment, content);
      c.realizationItem(realization, segment, { movement, sequence: i + 1 });
    });
    works.push({ work, realization });
  }
  c.db
    .prepare("INSERT INTO user_work_state VALUES (1,?,1,?,?)")
    .run(works[1].work, works[1].realization, Date.now());
  assert.deepEqual(mergeDuplicateAutoWorks(c), { people: 1, works: 1 });
  assert.equal(count(c, "work"), 1);
  assert.equal(count(c, "person"), 1);
  assert.equal(count(c, "movement"), 4);
  const view = renderWork(c, works[0].work, { id: 1, role: "user" });
  assert.equal(view.recordings.length, 2);
  assert.ok(view.recordings.every((r) => r.complete));
  assert.equal(view.favourite, true);
  assert.equal(view.pickedRealizationId, works[1].realization);
  assert.deepEqual(mergeDuplicateAutoWorks(c), { people: 0, works: 0 });
});

async function edit(c, command, values, selection = values.target) {
  const input = c.editorInput;
  const { revision } = await readEditor({ ...input, query: { selection } });
  const result = await mutateEditor({ ...input, mutation: { revision, command, values } });
  assert.equal(result.ok, true, JSON.stringify(result));
}
const people = (c) => c.db.prepare("SELECT id FROM entity WHERE kind='person' AND deleted_at IS NULL ORDER BY rowid").all().map((p) => p.id);

for (const action of ["merge", "rename"]) {
  test(`composer ${action} survives new albums with the old spelling and rescans`, async (t) => {
    generation = 0;
    const c = await setup(t);
    const old = "J.S. Bach", canonical = "Johann Sebastian Bach", work = "Brandenburg Concerto No. 3, BWV 1048";
    const tracks = album("A", 0, work, { composer: old });
    if (action === "merge") tracks.push(...album("B", 0, work, { composer: canonical }));
    scan(c, tracks);
    autoMatchTaggedWorks(c);
    const [drop, keep] = people(c);
    if (action === "merge") {
      new Metadata(c).manual(drop, "aliases", ["Bach, Johann Sebastian"], { actor: "1", pin: true });
      c.alias(drop, "Joh. Seb. Bach");
      await edit(c, "merge-entity", { target: drop, into: keep, confirm: true }, `merge:${drop}:${keep}`);
    } else await edit(c, "save-entity", { target: drop, name: canonical });
    assert.ok(c.db.prepare("SELECT 1 FROM alias WHERE entity_id=? AND text=?").get(keep || drop, old));
    tracks.push(...album("C", 0, work, { composer: old }));
    if (action === "merge") tracks.push(...album("D", 0, work, { composer: "Bach, Johann Sebastian" }), ...album("E", 0, work, { composer: "Joh. Seb. Bach" }));
    scan(c, tracks);
    autoMatchTaggedWorks(c);
    mergeDuplicateAutoWorks(c);
    assert.equal(count(c, "person"), 1);
    assert.equal(count(c, "work"), 1);
    const recordings = count(c, "performance");
    autoMatchTaggedWorks(c);
    assert.equal(count(c, "performance"), recordings);
    assert.equal(c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n, tracks.length);
  });
}

test("Other spellings match without guessing initials or resolving shared aliases", async (t) => {
  generation = 0;
  const c = await setup(t), m = new Metadata(c);
  const one = c.createEntity("person", { roles: ["composer"] });
  m.manual(one, "name", "Johann Sebastian Bach", { actor: "1" });
  m.manual(one, "aliases", ["Bach, Johann Sebastian"], { actor: "1" });
  scan(c, album("A", 0, "Concerto BWV 1048", { composer: "Bach, Johann Sebastian" }));
  autoMatchTaggedWorks(c);
  assert.equal(count(c, "person"), 1);
  scan(c, [...album("A", 0, "Concerto BWV 1048", { composer: "Bach, Johann Sebastian" }), ...album("B", 0, "Concerto BWV 1048", { composer: "J.S. Bach" })]);
  autoMatchTaggedWorks(c);
  assert.equal(count(c, "person"), 2);
  const two = people(c).find((id) => id !== one);
  c.alias(one, "Shared spelling"); c.alias(two, "Shared spelling");
  mergeDuplicateAutoWorks(c);
  assert.equal(count(c, "person"), 2);
});

test("old album-work keys keep removed tracks out after a composer rename", async (t) => {
  generation = 0;
  const c = await setup(t);
  const tracks = album("A", 0, "Concerto BWV 1048", { composer: "J.S. Bach" });
  scan(c, tracks); autoMatchTaggedWorks(c);
  // Remove attachments without an unassign-album audit: the album-work identity alone must hold.
  for (const { id } of c.db.prepare("SELECT id FROM realization_item").all()) c.detachItem(id, { dropRecording: true });
  await edit(c, "save-entity", { target: people(c)[0], name: "Johann Sebastian Bach" });
  scan(c, tracks); autoMatchTaggedWorks(c);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM realization_item").get().n, 0);
});

test("MusicBrainz IDs override an alias and conflicting IDs stay separate", async (t) => {
  generation = 0;
  const c = await setup(t), m = new Metadata(c);
  const person = c.createEntity("person", { roles: ["composer"] });
  m.manual(person, "name", "Canonical Composer", { actor: "1" });
  c.alias(person, "Old spelling");
  c.externalIdentity(person, "musicbrainz", "artist", "artist-one");
  const tracks = album("A", 0, "Concerto BWV 1048", { composer: "Old spelling" });
  scan(c, tracks); autoMatchTaggedWorks(c);
  tracks.push(...album("B", 0, "Concerto BWV 1048", { composer: "Old spelling" }));
  scan(c, tracks);
  const providerMatches = new Map(c.db.prepare("SELECT id FROM track_link WHERE json_extract(evidence,'$.albumId')='B'").all()
    .map(({ id }) => [id, { work: "Concerto BWV 1048", composers: ["Old spelling"], composerIds: { "Old spelling": "artist-two" } }]));
  autoMatchTaggedWorks(c, { albumId: "B", providerMatches });
  assert.equal(count(c, "person"), 2);
  assert.equal(count(c, "work"), 2);
  const other = people(c).find((id) => id !== person);
  tracks.push(...album("C", 0, "Concerto BWV 1048", { composer: "Another spelling" }));
  scan(c, tracks);
  const identified = new Map(c.db.prepare("SELECT id FROM track_link WHERE json_extract(evidence,'$.albumId')='C'").all()
    .map(({ id }) => [id, { work: "Concerto BWV 1048", composers: ["Another spelling"], composerIds: { "Another spelling": "artist-two" } }]));
  autoMatchTaggedWorks(c, { albumId: "C", providerMatches: identified });
  assert.equal(count(c, "person"), 2);
  assert.equal(count(c, "work"), 2);
  assert.equal(c.db.prepare("SELECT entity_id FROM external_identity WHERE record_id='artist-two'").get().entity_id, other);
});

test("legacy editor renames also retain the old composer spelling", async (t) => {
  generation = 0;
  const c = await setup(t);
  const tracks = album("A", 0, "Concerto BWV 1048", { composer: "J.S. Bach" });
  scan(c, tracks); autoMatchTaggedWorks(c);
  c.editorInput.capabilities.adminForms = 1;
  await edit(c, "edit-field", { target: people(c)[0], field: "name", value: "Johann Sebastian Bach", blank: false, pin: true });
  tracks.push(...album("B", 0, "Concerto BWV 1048", { composer: "J.S. Bach" }));
  scan(c, tracks); autoMatchTaggedWorks(c);
  assert.equal(count(c, "person"), 1);
  assert.equal(count(c, "work"), 1);
});

// Review L12 (#23): once two people share a composer's name, matching makes
// no third; an admin says which one wrote the movement.
test("L12: a movement composer whose name two people share is never made again; it is asked about once", async (t) => {
  generation = 0;
  const c = await setup(t);
  const m = new Metadata(c);
  const twins = [1, 2].map(() => {
    const id = c.createEntity("person");
    m.manual(id, "name", "Franz Xaver Süßmayr", { actor: "admin" });
    return id;
  });
  const requiem = (albumId) =>
    album(albumId, "", "Requiem in D minor, K. 626", { titles: ["I. Introitus", "II. Kyrie", "III. Lacrimosa"], composer: "Wolfgang Amadeus Mozart" }).map((track, i) =>
      i === 2 ? { ...track, hints: { ...track.hints, composer: ["Wolfgang Amadeus Mozart", "Franz Xaver Süßmayr"] } } : track,
    );
  scan(c, [...requiem("a"), ...requiem("b")]);
  for (const albumId of ["a", "b"]) autoMatchTaggedWorks(c, { albumId, actor: "test" });
  autoMatchTaggedWorks(c, { actor: "test" });
  const named = c.db
    .prepare("SELECT e.id FROM entity e JOIN field_resolution f ON f.target_id=e.id AND f.field='name' JOIN assertion a ON a.id=f.assertion_id WHERE e.kind='person' AND e.deleted_at IS NULL AND a.value=?")
    .all(JSON.stringify("Franz Xaver Süßmayr"))
    .map((row) => row.id)
    .sort();
  assert.deepEqual(named, [...twins].sort(), "no third Süßmayr");
  // The work is made, with Mozart; the Lacrimosa's extra composer waits for an admin.
  assert.equal(count(c, "work"), 1);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM credit WHERE role='composer' AND contributor_id IN (?,?)").get(...twins).n, 0);
  const reviews = c.db.prepare("SELECT target_id,evidence FROM review_item WHERE kind='contributor_identity' AND status='open'").all().map((row) => JSON.parse(row.evidence));
  assert.ok(reviews.length >= 1 && reviews.every((evidence) => evidence.reason === "ambiguous-name" && evidence.name === "Franz Xaver Süßmayr" && evidence.role === "composer"), JSON.stringify(reviews));
  // An admin answers each: the Lacrimosa's recording credits the first one.
  for (const { id, target_id: recording } of c.db.prepare("SELECT id,target_id FROM review_item WHERE kind='contributor_identity' AND status='open'").all()) {
    await edit(c, "use-contributor", { id, contributor: twins[0] }, `review:${id}`);
    assert.ok(c.db.prepare("SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role='composer' AND state='active'").get(recording, twins[0]));
  }
  // Matching again asks nothing more and makes no one.
  autoMatchTaggedWorks(c, { actor: "test" });
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='contributor_identity' AND status='open'").get().n, 0);
  assert.equal(count(c, "person"), 3, "Mozart and the two Süßmayrs");
});
