import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
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
  const c = await openCatalogue(folders.dataFolder);
  t.after(async () => {
    try {
      c.close();
    } catch {}
    await fs.rm(folders.root, { recursive: true, force: true });
  });
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
