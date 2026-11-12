import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openCatalogue } from "../src/model/catalogue.js";
import {
  openDatabase,
  restoreDatabase,
  validateDatabase,
  transaction,
} from "../src/model/database.js";
import { Metadata } from "../src/model/metadata.js";
import { ModelJobs } from "../src/model/jobs.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import {
  enqueueModelScan,
  modelStatus,
  runModelJobs,
  cancelModelScan,
  autoMatchWorks,
} from "../src/model/runtime.js";
import { tempFolders, copyFixture, json as response } from "./helpers.js";
import { writeTags } from "../src/tags.js";
import { modelAllowsTagging } from "../src/model/write-guard.js";
import plugin from "../src/index.js";
import { migrations } from "../src/model/schema.js";
import {
  renderAlbumPresentation,
  renderWork,
  applyWorkMutation,
} from "../src/model/presentation.js";
import {
  autoMatchTaggedWorks,
  repairMovementTitles,
  repairWorkTitles,
} from "../src/model/auto-match.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function setup(t) {
  const folders = await tempFolders();
  const c = await openCatalogue(folders.dataFolder);
  t.after(async () => {
    try {
      c.close();
    } catch {}
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  return { c, m: new Metadata(c), folders };
}
const track = (id, extra = {}) => ({
  coreId: `track-${id}`,
  fileId: `file-${id}`,
  path: `/library/${id}.flac`,
  size: 1234,
  durationMs: 2000,
  fingerprint: `file-v1:${id}`,
  ...extra,
});
const snapshot = (tracks, generation = 1, extra = {}) => ({
  version: 1,
  complete: true,
  instanceId: "fixture-installation",
  epoch: "first",
  generation,
  tracks,
  ...extra,
});

test("album works follow the album, and movement titles drop the work's name", async (t) => {
  const { c, m } = await setup(t);
  const on = (id, disc, number, work, title, extra = {}) =>
    track(id, {
      albumId: "cycle-album",
      hints: {
        title,
        album: "Cycle",
        composer: ["Ludwig van Beethoven"],
        work,
        trackNumber: number,
        discNumber: disc,
        ...extra,
      },
    });
  const hammerklavier = "Piano Sonata No. 29 in B-flat major, Op. 106";
  const links = reconcile(
    c,
    snapshot([
      on(1, 2, 1, "Piano Sonata No. 1: I. Allegro", "I. Allegro"),
      on(2, 2, 2, "Piano Sonata No. 1: II. Adagio", "II. Adagio"),
      on(3, 1, 3, hammerklavier, `${hammerklavier} - "Hammerklavier": Allegro`),
      on(4, 1, 4, hammerklavier, `${hammerklavier} - "Hammerklavier": Adagio sostenuto`),
      on(5, 1, 1, "Piano Sonata No. 8", "Piano Sonata No. 8: Grave", { recordingMbid: "pathetique-1" }),
      on(6, 1, 2, "Piano Sonata No. 8", "Piano Sonata No. 8: Rondo", { recordingMbid: "pathetique-2" }),
    ]),
  );
  links.forEach((link) => classify(c, link.id, link.hints));
  const pathetique = "Piano Sonata no. 8 in C minor, op. 13 “Pathétique”";
  autoMatchTaggedWorks(c, {
    actor: "admin",
    providerMatches: new Map([
      [links[4].id, { workId: "pathetique", work: pathetique, movement: `${pathetique}: I. Grave – Allegro di molto e con brio`, composers: [] }],
      [links[5].id, { workId: "pathetique", work: pathetique, movement: `${pathetique}: III. Rondo. Allegro`, composers: [] }],
    ]),
  });
  autoMatchTaggedWorks(c, { actor: "model-scan" });
  const album = renderAlbumPresentation(c, "cycle-album");
  assert.deepEqual(
    album.groups.map((group) => group.title),
    [pathetique, hammerklavier, "Piano Sonata No. 1"],
  );
  assert.deepEqual(
    album.groups.map((group) => group.items.map((item) => item.title)),
    [
      ["I. Grave – Allegro di molto e con brio", "III. Rondo. Allegro"],
      ["Allegro", "Adagio sostenuto"],
      ["I. Allegro", "II. Adagio"],
    ],
  );

  // Fields the title states fill in; an admin's value is never replaced.
  const hammerklavierWork = album.groups[1].workId;
  assert.equal(m.resolve(hammerklavierWork, "key").value, "B-flat major");
  assert.deepEqual(m.resolve(hammerklavierWork, "catalogue").value, ["Op. 106"]);
  assert.equal(m.resolve(hammerklavierWork, "form").value, "sonata");
  assert.deepEqual(m.resolve(hammerklavierWork, "instrumentation").value, ["Piano"]);
  assert.equal(m.resolve(album.groups[0].workId, "nickname").value, "Pathétique");
  m.manual(hammerklavierWork, "form", "grand sonata", { actor: "admin" });
  autoMatchTaggedWorks(c, { actor: "model-scan" });
  assert.equal(m.resolve(hammerklavierWork, "form").value, "grand sonata");

  // Titles derived before this fix are repaired; manual titles stay.
  const movements = c.db
    .prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position")
    .all(album.groups[1].workId)
    .map((row) => row.target_id);
  m.derived(movements[0], "title", `${hammerklavier}: Allegro`);
  m.manual(movements[1], "title", `${hammerklavier}: Kept`, { actor: "admin" });
  assert.equal(repairMovementTitles(c), 1);
  // A MusicBrainz title stored by an older pass gives way to the tags' title.
  m.derived(hammerklavierWork, "title", 'Sonata for Piano no. 29 in B-flat major, op. 106 "Hammer-Klavier"');
  assert.equal(repairWorkTitles(c), 1);
  assert.equal(m.resolve(hammerklavierWork, "title").value, hammerklavier);
  assert.deepEqual(
    renderAlbumPresentation(c, "cycle-album").groups[1].items.map((item) => item.title),
    ["Allegro", `${hammerklavier}: Kept`],
  );
});

test("explicit embedded work metadata creates an idempotent read-only work realization", async (t) => {
  const { c } = await setup(t);
  const tagged = [
    track(1, {
      albumId: "sonata-album",
      hints: {
        title: "I. Allegro",
        album: "Complete Sonatas",
        composer: ["Example Composer"],
        work: "Piano Sonata No. 1: I. Allegro",
        trackNumber: 1,
        discNumber: 1,
      },
    }),
    track(2, {
      albumId: "sonata-album",
      hints: {
        title: "II. Adagio",
        album: "Complete Sonatas",
        composer: ["Example Composer"],
        work: "Piano Sonata No. 1: II. Adagio",
        trackNumber: 2,
        discNumber: 1,
      },
    }),
    track(3, {
      albumId: "etudes-album",
      hints: {
        title: "Étude No. 1",
        composer: ["Example Composer"],
        work: "Transcendental Études: No. 1",
        trackNumber: 1,
        discNumber: 1,
      },
    }),
    track(4, {
      albumId: "etudes-album",
      hints: {
        title: "Étude No. 2",
        composer: ["Example Composer"],
        work: "Transcendental Études: No. 2",
        trackNumber: 2,
        discNumber: 1,
      },
    }),
    track(5, {
      albumId: "symphony-album",
      hints: {
        title: "Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio",
        composer: ["Ludwig van Beethoven"],
        work: "",
        trackNumber: 1,
        discNumber: 1,
        genres: ["Classical"],
      },
    }),
    track(6, {
      albumId: "symphony-album",
      hints: {
        title: "Symphony No. 5 in C Minor, Op. 67: II. Andante con moto",
        composer: ["Ludwig van Beethoven"],
        work: "",
        trackNumber: 2,
        discNumber: 1,
        genres: ["Classical"],
      },
    }),
    track(7, {
      albumId: "provider-album",
      hints: {
        title: "Allegro",
        composer: ["Provider Composer"],
        recordingMbid: "recording-one",
        trackNumber: 1,
        discNumber: 1,
        genres: ["Classical"],
      },
    }),
    track(8, {
      albumId: "provider-album",
      hints: {
        title: "Adagio",
        composer: ["Provider Composer"],
        recordingMbid: "recording-two",
        trackNumber: 2,
        discNumber: 1,
        genres: ["Classical"],
      },
    }),
  ];
  const links = reconcile(c, snapshot(tagged));
  links.forEach((link) => classify(c, link.id, link.hints));
  assert.deepEqual(autoMatchTaggedWorks(c, { actor: "model-scan" }), {
    created: 1,
    candidates: 1,
  });
  assert.deepEqual(autoMatchTaggedWorks(c, { actor: "model-scan" }), {
    created: 0,
    candidates: 0,
  });
  assert.deepEqual(
    autoMatchTaggedWorks(c, {
      actor: "admin",
      allowStructuredTitles: true,
    }),
    { created: 1, candidates: 1 },
  );
  assert.deepEqual(
    autoMatchTaggedWorks(c, {
      actor: "admin",
      allowStructuredTitles: true,
    }),
    { created: 0, candidates: 0 },
  );
  assert.equal(
    renderAlbumPresentation(c, "symphony-album").groups[0].title,
    "Symphony No. 5 in C Minor, Op. 67",
  );
  assert.deepEqual(
    autoMatchTaggedWorks(c, {
      actor: "admin",
      providerMatches: new Map([
        [links[6].id, { workId: "parent-work", work: "Provider Work", composers: [] }],
        [links[7].id, { workId: "parent-work", work: "Provider Work", composers: [] }],
      ]),
    }),
    { created: 1, candidates: 1 },
  );
  assert.equal(
    renderAlbumPresentation(c, "provider-album").groups[0].title,
    "Provider Work",
  );
  assert.deepEqual(autoMatchTaggedWorks(c, { actor: "model-scan" }), {
    created: 0,
    candidates: 0,
  });
  const album = renderAlbumPresentation(c, "sonata-album");
  assert.equal(album.groups.length, 1);
  assert.equal(album.groups[0].title, "Piano Sonata No. 1");
  assert.equal(album.groups[0].composer, "Example Composer");
  assert.deepEqual(
    album.groups[0].items.map((item) => item.title),
    ["I. Allegro", "II. Adagio"],
  );
  // A set of études is not one work, but its neighbouring pieces share a
  // block headed by the set, as Apple Music Classical shows them.
  assert.deepEqual(
    renderAlbumPresentation(c, "etudes-album").groups.map((group) => [group.workId, group.title, group.items.map((item) => item.title)]),
    [[null, "Transcendental Études", ["No. 1", "No. 2"]]],
  );
  assert.equal(
    c.db
      .prepare("SELECT count(*) AS n FROM audit_event WHERE action='work.auto_match'")
      .get().n,
    3,
  );
});

test("explicit album matching resolves saved recording identities without writing files", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const folder = path.join(folders.dataFolder, "model");
  const c = await openCatalogue(folder);
  const links = reconcile(
    c,
    snapshot([
      track(1, {
        albumId: 42,
        hints: {
          title: "I. Allegro",
          composer: ["Known Composer"],
          recordingMbid: "recording-1",
          trackNumber: 1,
          discNumber: 1,
          genres: ["Classical"],
        },
      }),
      track(2, {
        albumId: 42,
        hints: {
          title: "II. Adagio",
          composer: ["Known Composer"],
          recordingMbid: "recording-2",
          trackNumber: 2,
          discNumber: 1,
          genres: ["Classical"],
        },
      }),
    ]),
  );
  links.forEach((link) => classify(c, link.id, link.hints));
  c.close();
  const result = await autoMatchWorks(
    {
      ...folders,
      resolver: {
        resolve: async (id) => ({
          workId: id === "recording-1" ? "movement-1" : "movement-2",
          composers: ["Known Composer"],
        }),
      },
      mb: {
        get: async (_kind, id) =>
          id === "parent-work"
            ? { id, title: "MusicBrainz Parent Work", relations: [] }
            : {
                id,
                title: id,
                relations: [
                  {
                    type: "parts",
                    direction: "backward",
                    work: { id: "parent-work" },
                  },
                ],
              },
      },
      log: () => {},
    },
    { id: 1, role: "admin" },
    42,
  );
  assert.deepEqual(result, { created: 1, candidates: 1 });
  const saved = await openCatalogue(folder);
  try {
    assert.equal(
      renderAlbumPresentation(saved, 42).groups[0].title,
      "MusicBrainz Parent Work",
    );
  } finally {
    saved.close();
  }
});

test("catalogue models a provider-free broadcast, roles, collections, segments, and reissues", async (t) => {
  const { c, m } = await setup(t);
  const composer = c.createEntity("person"),
    soloist = c.createEntity("person"),
    orchestra = c.createEntity("ensemble");
  const work = c.createEntity("work"),
    movement = c.createEntity("movement"),
    collection = c.createEntity("collection");
  m.manual(composer, "name", "Local Composer", { actor: "admin" });
  m.manual(work, "title", "Private broadcast", { actor: "admin" });
  c.credit(work, composer, "composer");
  c.relate("movement", work, movement);
  c.relate("collection_member", collection, work);
  const performance = c.createEntity("performance", {
    date: "2026-11",
    datePrecision: "month",
    type: "broadcast",
  });
  const pw = c.relate("performance_work", performance, work);
  c.credit(performance, soloist, "soloist");
  c.credit(performance, orchestra, "orchestra", { position: 2 });
  const recording = c.createEntity("recording", { durationMs: 2000 });
  c.relate("recording_performance", recording, performance);
  const content = c.recordingContent(recording, pw, {
    movement,
    startMs: 0,
    endMs: 2000,
  });
  const [link] = reconcile(c, snapshot([track(1)]));
  const segment = c.segment(link.id, { startMs: 0, endMs: 2000 });
  c.segmentContent(segment, content);
  const realization = c.realization(work, pw);
  c.realizationItem(realization, segment, { movement });
  for (let i = 0; i < 2; i++) {
    const release = c.createEntity("release");
    const item = c.releaseItem(release, { position: 1 });
    c.attachRecording(item, recording);
    c.attachTrack(link.id, item);
  }
  c.alias(work, "Broadcast première");
  c.catalogueNumber(work, "Local", "No. 1", "local:1");
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM external_identity").get().n,
    0,
  );
  assert.equal(
    c.db
      .prepare(
        "SELECT count(*) AS n FROM release_item_recording WHERE recording_id=?",
      )
      .get(recording).n,
    2,
  );
  assert.match(work, /^[\da-f]{8}-/);
  assert.equal(m.resolve(work, "title").value, "Private broadcast");
  validateDatabase(c.db);
});

test("Phase 4 groups an album by work and isolates user picks with an admin fallback", async (t) => {
  const { c, m, folders } = await setup(t);
  const composer = c.createEntity("person");
  m.manual(composer, "name", "Fixture Composer", { actor: "admin" });
  const work = c.createEntity("work");
  m.manual(work, "title", "Fixture Symphony", { actor: "admin" });
  const collection = c.createEntity("collection");
  m.manual(collection, "title", "Fixture Cycle", { actor: "admin" });
  c.relate("collection_member", collection, work);
  c.credit(work, composer, "composer");
  const movements = ["I. First", "II. Second", "III. Third"].map(
    (title, index) => {
      const movement = c.createEntity("movement");
      m.manual(movement, "title", title, { actor: "admin" });
      c.relate("movement", work, movement, { position: index + 1 });
      return movement;
    },
  );
  const tracks = reconcile(
    c,
    snapshot(
      movements.map((movement, index) =>
        track(index + 1, {
          coreId: String(index + 1),
          fileId: String(index + 1),
          albumId: "album-1",
          durationMs: 10000,
          hints: {
            title: `Movement ${index + 1}`,
            album: "Fixture Album",
            artist: "Fixture Orchestra",
          },
        }),
      ),
    ),
  );
  for (const link of tracks)
    classify(c, link.id, {}, { manual: "classical", actor: "admin" });
  const makeRealization = (suffix, included) => {
    const performance = c.createEntity("performance");
    const performanceWork = c.relate("performance_work", performance, work);
    const recording = c.createEntity("recording");
    c.relate("recording_performance", recording, performance);
    const realization = c.realization(work, performanceWork, suffix);
    included.forEach((movementIndex, sequence) => {
      const content = c.recordingContent(recording, performanceWork, {
        movement: movements[movementIndex],
        position: sequence + 1,
      });
      const segment = c.segment(tracks[movementIndex].id, {
        startMs: movementIndex === 0 ? 1000 : 0,
        endMs: movementIndex === 0 ? 9000 : 10000,
      });
      c.segmentContent(segment, content);
      c.realizationItem(realization, segment, {
        movement: movements[movementIndex],
        sequence: sequence + 1,
      });
    });
    return realization;
  };
  const complete = makeRealization("Complete recording", [0, 1, 2]);
  const incomplete = makeRealization("Incomplete recording", [0, 2]);
  const presentation = renderAlbumPresentation(c, "album-1");
  assert.equal(presentation.supportsToggle, true);
  assert.equal(presentation.groups.length, 2);
  const completeGroup = presentation.groups.find(
    (group) => group.items.length === 3,
  );
  const incompleteGroup = presentation.groups.find(
    (group) => group.items.length === 2,
  );
  assert.ok(completeGroup);
  assert.ok(incompleteGroup);
  assert.deepEqual(
    completeGroup.items.map((item) => item.title),
    ["I. First", "II. Second", "III. Third"],
  );
  assert.deepEqual(completeGroup.items[0], {
    id: completeGroup.items[0].id,
    trackId: "1",
    fileId: "1",
    albumId: "album-1",
    title: "I. First",
    artist: "Fixture Orchestra",
    performer: "Fixture Orchestra",
    album: "Fixture Album",
    durationMs: 10000,
    startMs: 1000,
    endMs: 9000,
  });
  assert.deepEqual(
    incompleteGroup.missing.map((item) => item.title),
    ["II. Second"],
  );
  const input = { resourceId: work };
  applyWorkMutation(
    c,
    { ...input, mutation: { command: "admin-pick", realizationId: complete } },
    { id: 1, role: "admin" },
  );
  assert.equal(
    renderWork(c, work, { id: 2, role: "user" }).pickedRealizationId,
    complete,
  );
  assert.equal(renderWork(c, work, { id: 2, role: "user" }).pickScope, "admin");
  applyWorkMutation(
    c,
    { ...input, mutation: { command: "pick", realizationId: incomplete } },
    { id: 2, role: "user" },
  );
  applyWorkMutation(
    c,
    { ...input, mutation: { command: "favourite", value: true } },
    { id: 2, role: "user" },
  );
  const secondUser = renderWork(c, work, { id: 2, role: "user" });
  assert.equal(secondUser.pickedRealizationId, incomplete);
  assert.equal(secondUser.pickScope, "user");
  assert.equal(secondUser.favourite, true);
  const thirdUser = renderWork(c, work, { id: 3, role: "user" });
  assert.equal(thirdUser.pickedRealizationId, complete);
  assert.equal(thirdUser.favourite, false);
  assert.deepEqual(thirdUser.work.collections, [
    { id: collection, title: "Fixture Cycle" },
  ]);
});

test("wrong kinds, cycles, parent movements, sequence slots and cross-performance play plans fail", async (t) => {
  const { c } = await setup(t);
  const w = c.createEntity("work"),
    other = c.createEntity("work"),
    mv = c.createEntity("movement");
  const a = c.createEntity("collection"),
    b = c.createEntity("collection");
  c.relate("collection_member", a, b);
  assert.throws(() => c.relate("collection_member", b, a), /cycle/);
  assert.throws(() => c.relate("movement", a, mv), /kind/);
  c.relate("movement", w, mv);
  assert.throws(() => c.relate("movement", other, mv), /already/);
  assert.throws(() => c.credit(w, a, "composer"), /kind/);
  const p = c.createEntity("performance"),
    r = c.createEntity("recording");
  const pw = c.relate("performance_work", p, other);
  c.relate("recording_performance", r, p);
  assert.throws(
    () => c.recordingContent(r, pw, { movement: mv }),
    /different work/,
  );
  const [link] = reconcile(c, snapshot([track(1)]));
  assert.throws(() => c.segment(link.id, { startMs: 100, endMs: 90 }), /range/);
  assert.throws(() => c.segment(link.id, { endMs: 2100 }), /range/);
  assert.throws(() => c.segment(link.id, { endMs: null }), /range/);
  const seg = c.segment(link.id, { startMs: 0, endMs: null, kind: "whole" });
  assert.throws(() => c.realization(w, pw), /mismatch/);
  const realization = c.realization(other, pw);
  assert.throws(
    () => c.realizationItem(realization, seg),
    /another interpretation/,
  );
});

test("field precedence, deterministic provider priority and pinned empty/null/list values survive refresh and reopen", async (t) => {
  const { c, m, folders } = await setup(t),
    w = c.createEntity("work");
  m.derived(w, "title", "derived");
  m.manual(w, "title", "manual fallback", { actor: "admin" });
  assert.equal(m.resolve(w, "title").value, "manual fallback");
  m.refresh(w, "openopus", "opus-1", { title: "Open Opus" });
  m.refresh(w, "musicbrainz", "mb-1", { title: "MusicBrainz" });
  assert.equal(m.resolve(w, "title").value, "MusicBrainz");
  assert.equal(m.resolve(w, "title").pinned, false);
  m.manual(w, "title", "", { actor: "admin" });
  m.manual(w, "nickname", null, { actor: "admin", pin: true });
  m.manual(w, "instrumentation", [], { actor: "admin", pin: true });
  m.refresh(w, "musicbrainz", "mb-1", {
    title: "Refreshed",
    nickname: "Provider name",
    instrumentation: ["piano"],
  });
  assert.equal(m.resolve(w, "title").value, "");
  assert.equal(m.resolve(w, "title").providerValue, "Refreshed");
  assert.equal(m.resolve(w, "nickname").value, null);
  assert.deepEqual(m.resolve(w, "instrumentation").value, []);
  const second = await openCatalogue(folders.dataFolder);
  try {
    assert.equal(new Metadata(second).resolve(w, "title").pinned, true);
    assert.equal(
      new Metadata(second).useProvider(w, "title", { actor: "admin" }).value,
      "Refreshed",
    );
    assert.ok(
      second.db
        .prepare("SELECT count(*) AS n FROM assertion WHERE target_id=?")
        .get(w).n > 8,
    );
  } finally {
    second.close();
  }
});

test("invalid or low-confidence refresh is atomic; deleted/stale/conflict and omissions retain displayed provider", async (t) => {
  const { c, m } = await setup(t),
    w = c.createEntity("work");
  m.refresh(w, "musicbrainz", "mb", { title: "Original", nickname: "Known" });
  assert.throws(
    () =>
      m.refresh(w, "musicbrainz", "mb", {
        title: "Partial",
        notAField: "invalid",
      }),
    /Invalid/,
  );
  assert.equal(m.resolve(w, "title").value, "Original");
  assert.equal(
    m.refresh(
      w,
      "musicbrainz",
      "maybe",
      { title: "Uncertain" },
      { confidence: 0.4 },
    ).review,
    true,
  );
  for (const state of ["stale", "deleted", "conflict"]) {
    m.refresh(w, "musicbrainz", "mb", {}, { state });
    m.refresh(w, "openopus", "oo", { title: "Alternate" });
    assert.equal(m.resolve(w, "title").value, "Original");
    assert.equal(m.resolve(w, "title").state, state);
  }
  m.refresh(w, "musicbrainz", "mb", { title: "Recovered" });
  assert.equal(m.resolve(w, "title").value, "Recovered");
  assert.equal(m.resolve(w, "nickname").value, "Known");
  assert.equal(m.resolve(w, "nickname").state, "stale");
  assert.throws(() => m.manual(w, "title", 42, { actor: "admin" }), /Invalid/);
  assert.throws(() => m.manual(w, "title", "x"), /actor/);
});

test("external identity conflicts and low confidence queue review without merging local entities", async (t) => {
  const { c } = await setup(t),
    a = c.createEntity("work"),
    b = c.createEntity("work");
  assert.equal(c.externalIdentity(a, "musicbrainz", "work", "same"), true);
  assert.equal(c.externalIdentity(b, "musicbrainz", "work", "same"), false);
  assert.equal(
    c.externalIdentity(b, "musicbrainz", "work", "uncertain", {
      confidence: 0.7,
    }),
    false,
  );
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM entity").get().n, 2);
});

test("full rescans preserve link IDs, metadata, classification and release associations through renames", async (t) => {
  const { c, m } = await setup(t);
  const [link] = reconcile(c, snapshot([track(1)]));
  m.manual(link.id, "title", "Pinned title", { actor: "admin", pin: true });
  classify(c, link.id, {}, { manual: "not_classical", actor: "admin" });
  const release = c.createEntity("release"),
    item = c.releaseItem(release, { position: 1 });
  c.attachTrack(link.id, item);
  const [updated] = reconcile(
    c,
    snapshot(
      [track(8, { path: "/renamed/moved.flac", fingerprint: "file-v1:1" })],
      2,
    ),
  );
  assert.equal(updated.id, link.id);
  assert.equal(m.resolve(link.id, "title").value, "Pinned title");
  assert.equal(classify(c, link.id, { work: "Sonata" }), "not_classical");
  assert.equal(
    c.db
      .prepare("SELECT item_id FROM track_release_item WHERE track_link_id=?")
      .get(link.id).item_id,
    item,
  );
  assert.throws(
    () => reconcile(c, snapshot([], 3, { complete: false })),
    /complete/,
  );
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(link.id).state,
    "active",
  );
  assert.throws(() => reconcile(c, snapshot([], 2)), /Stale/);
});

test("ambiguous duplicate moves, reused IDs, missing files and changed epochs never silently reassign", async (t) => {
  const { c } = await setup(t);
  const [old] = reconcile(c, snapshot([track(1)]));
  reconcile(
    c,
    snapshot(
      [
        track(2, { fingerprint: "file-v1:1" }),
        track(3, { fingerprint: "file-v1:1" }),
      ],
      2,
    ),
  );
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(old.id).state,
    "review",
  );
  assert.equal(
    c.db
      .prepare("SELECT count(*) AS n FROM track_link WHERE state='active'")
      .get().n,
    0,
  );
  reconcile(c, snapshot([track(1, { fingerprint: "different-audio" })], 3));
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(old.id).state,
    "review",
  );
  const next = reconcile(c, snapshot([track(9)], 4));
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(old.id).state,
    "missing",
  );
  reconcile(c, snapshot([track(9)], 5, { epoch: "replacement" }));
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(next[0].id)
      .state,
    "review",
  );
});

test("rock/jazz/pop/electronic/soundtrack are ordinary; crossover tracks classify independently", async (t) => {
  const { c, m } = await setup(t);
  const links = reconcile(
    c,
    snapshot(Array.from({ length: 7 }, (_, i) => track(i))),
  );
  for (const [i, genre] of [
    "Rock",
    "Jazz",
    "Pop",
    "Electronic",
    "Soundtrack",
  ].entries())
    assert.equal(
      classify(c, links[i].id, { genres: [genre] }),
      "not_classical",
    );
  // A WORK tag alone doesn't make a soundtrack track classical; a verified
  // classical work (catalogue number, credited composer) on one does.
  assert.equal(
    classify(c, links[5].id, { genres: ["Soundtrack"], work: "Bach suite" }),
    "unsure",
  );
  assert.equal(
    classify(c, links[5].id, {
      genres: ["Soundtrack"],
      title: "Cello Suite No. 1 in G major, BWV 1007: I. Prélude",
      composer: ["Johann Sebastian Bach"],
      composerDistinct: true,
    }),
    "classical",
  );
  assert.equal(classify(c, links[6].id, { composerDistinct: true }), "unsure");
  classify(c, links[5].id, {}, { manual: "not_classical", actor: "admin" });
  m.refresh(links[5].id, "musicbrainz", "some-track", {
    title: "New provider title",
  });
  assert.equal(
    classify(c, links[5].id, { genres: ["Classical"] }),
    "not_classical",
  );
});

test("failed migrations roll back DDL and versions; consistent backups restore an earlier compatible schema", async (t) => {
  const { c, folders } = await setup(t),
    work = c.createEntity("work");
  const backup = path.join(folders.root, "snapshot.sqlite");
  await c.backup(backup);
  c.close();
  const bad = {
    version: 4,
    sql: "CREATE TABLE should_rollback(id); INSERT INTO no_such_table VALUES (1);",
  };
  await assert.rejects(
    openDatabase(folders.dataFolder, { migrations: [bad], maxVersion: 4 }),
    /no such table/,
  );
  const restored = await openCatalogue(folders.dataFolder);
  assert.equal(restored.entity(work).kind, "work");
  assert.equal(
    restored.db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name='should_rollback'",
      )
      .get().n,
    0,
  );
  assert.equal(
    restored.db.prepare("PRAGMA user_version").get().user_version,
    3,
  );
  restored.close();
  const upgraded = await openDatabase(folders.dataFolder, {
    migrations: [{ version: 4, sql: "CREATE TABLE future(id);" }],
    maxVersion: 4,
  });
  upgraded.db.close();
  await assert.rejects(openCatalogue(folders.dataFolder), /newer/);
  await assert.rejects(restoreDatabase(backup, c.filename), /Stop all/);
  await restoreDatabase(backup, c.filename, { offline: true });
  const old = await openCatalogue(folders.dataFolder);
  assert.equal(old.entity(work).kind, "work");
  old.close();
});

test("schema 1 upgrades to user-scoped Phase 4 state without changing catalogue data", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const old = await openDatabase(folders.dataFolder, {
    migrations: [migrations[0]],
    maxVersion: 1,
  });
  const work = "00000000-0000-4000-8000-000000000004";
  old.db
    .prepare("INSERT INTO entity VALUES (?, 'work', '{}', 1, 1, 1, NULL)")
    .run(work);
  old.db.close();
  const upgraded = await openCatalogue(folders.dataFolder);
  assert.equal(
    upgraded.db.prepare("PRAGMA user_version").get().user_version,
    3,
  );
  assert.equal(upgraded.entity(work).kind, "work");
  assert.ok(
    upgraded.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_work_state'",
      )
      .get(),
  );
  upgraded.close();
  assert.ok(
    (await fs.readdir(path.join(folders.dataFolder, "backups"))).some((file) =>
      file.startsWith("before-v2-"),
    ),
  );
});

test("process death during DDL leaves the old schema recoverable", async (t) => {
  const { c, folders } = await setup(t);
  c.close();
  const script = `import { DatabaseSync } from 'node:sqlite';const d=new DatabaseSync(${JSON.stringify(c.filename)});d.exec('BEGIN IMMEDIATE; CREATE TABLE interrupted(id); PRAGMA user_version=4');process.kill(process.pid,'SIGKILL');`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(child.signal, "SIGKILL");
  const reopened = await openCatalogue(folders.dataFolder);
  assert.equal(
    reopened.db.prepare("PRAGMA user_version").get().user_version,
    3,
  );
  assert.equal(
    reopened.db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name='interrupted'",
      )
      .get().n,
    0,
  );
  reopened.close();
});

test("independent processes serialize writers and migrations with persistent WAL storage", async (t) => {
  const { c, folders } = await setup(t);
  const worker = `import {openCatalogue} from ${JSON.stringify(new URL("../src/model/catalogue.js", import.meta.url).href)};const c=await openCatalogue(${JSON.stringify(folders.dataFolder)});for(let i=0;i<20;i++)c.createEntity('work');c.close();`;
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", worker],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      let error = "";
      child.stderr.on("data", (s) => (error += s));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(error)),
      );
    });
  await Promise.all([run(), run(), run()]);
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM entity").get().n, 60);
  validateDatabase(c.db);
});

test("persistent jobs fence expired owners, cancel safely, checkpoint atomically and survive restart", async (t) => {
  const { c, folders } = await setup(t),
    jobs = new ModelJobs(c);
  const id = jobs.enqueue("scan", "same-key", { fixture: true });
  assert.equal(jobs.enqueue("scan", "same-key", {}), id);
  c.db
    .prepare("UPDATE model_job SET error='stale failure' WHERE id=?")
    .run(id);
  const first = jobs.claim("one", { now: 100, leaseMs: 10 });
  assert.equal(first.error, null);
  const other = await openCatalogue(folders.dataFolder),
    secondJobs = new ModelJobs(other);
  try {
    const second = secondJobs.claim("two", { now: 111, leaseMs: 100 });
    assert.equal(second.generation, first.generation + 1);
    assert.throws(() => jobs.checkpoint(first, {}, { now: 112 }), /Stale/);
    assert.throws(
      () =>
        secondJobs.checkpoint(
          second,
          {},
          {
            now: 112,
            commit: () => {
              c.db
                .prepare(
                  "INSERT INTO audit_event(action,target_id,data,created_at) VALUES (?,?,?,?)",
                )
                .run("x", "x", "{}", 1);
            },
          },
        ),
      /locked/,
    );
    assert.equal(
      secondJobs.checkpoint(second, { cursor: 2 }, { now: 113 }),
      true,
    );
    assert.equal(secondJobs.get(id).error, null);
    secondJobs.cancel(id);
    assert.equal(
      secondJobs.checkpoint(second, {}, { now: 114, done: true }),
      false,
    );
    assert.equal(jobs.get(id).state, "cancelled");
  } finally {
    other.close();
  }
});

test("transactions roll back catalogue and job changes together", async (t) => {
  const { c } = await setup(t),
    jobs = new ModelJobs(c);
  jobs.enqueue("scan", "atomic", {});
  const job = jobs.claim("worker");
  assert.throws(
    () =>
      jobs.checkpoint(
        job,
        {},
        {
          done: true,
          commit: () => {
            c.createEntity("work");
            throw new Error("injected after catalogue write");
          },
        },
      ),
    /injected/,
  );
  assert.equal(c.db.prepare("SELECT count(*) AS n FROM entity").get().n, 0);
  assert.equal(jobs.get(job.id).state, "running");
});

test("host scan runs only by admin action, resumes from durable batches and never changes media", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const files = [];
  for (let i = 0; i < 3; i++) {
    const file = await copyFixture(
      "sine.flac",
      path.join(folders.libraryFolder, `${i}.flac`),
    );
    await writeTags(file, {
      title: [`track-${i}`],
      work: i === 1 ? ["Sonata"] : [],
    });
    files.push(file);
  }
  const before = await Promise.all(files.map((f) => fs.readFile(f)));
  const ctx = {
    ...folders,
    settings: {},
    userOperations: {
      version: 1,
      url: "http://host.test/ops",
      token: "test-only",
    },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          tracks: files.map((file, i) => ({
            id: i,
            files: [{ id: i, path: file, available: true }],
          })),
        },
      }),
  };
  await runModelJobs(ctx);
  assert.deepEqual((await modelStatus(ctx)).tracks, []);
  await assert.rejects(enqueueModelScan(ctx, { id: 1, role: "user" }), /admin/);
  const id = await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 0 });
  const folder = path.join(folders.dataFolder, "model"),
    c = await openCatalogue(folder);
  assert.equal(new ModelJobs(c).get(id).state, "queued");
  c.close();
  await runModelJobs(ctx, { budgetMs: 10000, batchSize: 1 });
  assert.equal((await modelStatus(ctx)).tracks[0].count, 3);
  for (let i = 0; i < files.length; i++)
    assert.deepEqual(await fs.readFile(files[i]), before[i]);
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await cancelModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx);
  const done = await openCatalogue(folder);
  assert.equal(
    done.db
      .prepare("SELECT count(*) AS n FROM model_job WHERE state='cancelled'")
      .get().n,
    1,
  );
  done.close();
});

test("read-only model scans index WAV files using host metadata without opening them for tagging", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = await copyFixture(
    "sine.flac",
    path.join(folders.libraryFolder, "host-track.wav"),
  );
  await fs.chmod(file, 0o444);
  const before = await fs.readFile(file);
  const ctx = {
    ...folders,
    settings: {},
    userOperations: {
      version: 1,
      url: "http://host.test/ops",
      token: "test-only",
    },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          tracks: [
            {
              id: 17,
              mbid: "00000000-0000-4000-8000-000000000017",
              title: "Host WAV title",
              artistName: "Host WAV artist",
              durationMs: 2000,
              files: [
                {
                  id: 71,
                  path: file,
                  albumId: 9,
                  durationMs: 2000,
                  available: true,
                },
              ],
            },
          ],
        },
      }),
  };
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 10000 });
  const status = await modelStatus(ctx);
  assert.equal(status.scan.state, "done");
  assert.equal(status.tracks.find((row) => row.state === "active").count, 1);
  const catalogue = await openCatalogue(path.join(folders.dataFolder, "model"));
  try {
    const evidence = JSON.parse(
      catalogue.db.prepare("SELECT evidence FROM track_link").get().evidence,
    );
    assert.equal(evidence.hints.title, "Host WAV title");
    assert.equal(evidence.hints.artist, "Host WAV artist");
    assert.equal(
      evidence.hints.recordingMbid,
      "00000000-0000-4000-8000-000000000017",
    );
    assert.equal(evidence.durationMs, 2000);
  } finally {
    catalogue.close();
  }
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o444);
});

test("read-only model scans survive a tag parser rejecting an owned MPEG file", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = path.join(folders.libraryFolder, "unusual.mp3");
  await fs.writeFile(file, "host-readable fixture with no MPEG audio header");
  await fs.chmod(file, 0o444);
  const before = await fs.readFile(file);
  const ctx = {
    ...folders,
    settings: {},
    userOperations: {
      version: 1,
      url: "http://host.test/ops",
      token: "test-only",
    },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          tracks: [
            {
              id: 18,
              title: "Host MPEG title",
              artistName: "Host MPEG artist",
              durationMs: 3000,
              files: [
                {
                  id: 81,
                  path: file,
                  albumId: 10,
                  durationMs: 3000,
                  available: true,
                },
              ],
            },
          ],
        },
      }),
  };
  await enqueueModelScan(ctx, { id: 1, role: "admin" });
  await runModelJobs(ctx, { budgetMs: 10000 });
  const status = await modelStatus(ctx);
  assert.equal(status.scan.state, "done");
  assert.equal(status.tracks.find((row) => row.state === "active").count, 1);
  const catalogue = await openCatalogue(path.join(folders.dataFolder, "model"));
  try {
    const evidence = JSON.parse(
      catalogue.db.prepare("SELECT evidence FROM track_link").get().evidence,
    );
    assert.equal(evidence.hints.title, "Host MPEG title");
    assert.equal(evidence.hints.artist, "Host MPEG artist");
    assert.equal(evidence.durationMs, 3000);
  } finally {
    catalogue.close();
  }
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o444);
});

test("#9 a rescan that can't parse a file keeps the tag evidence an earlier scan read", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = path.join(folders.libraryFolder, "unusual.mp3");
  await fs.writeFile(file, "host-readable fixture with no MPEG audio header");
  await fs.chmod(file, 0o444);
  const ctx = {
    ...folders,
    settings: {},
    userOperations: { version: 1, url: "http://host.test/ops", token: "test-only" },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          tracks: [
            {
              id: 18,
              title: "Host title",
              artistName: "Host artist",
              durationMs: 3000,
              files: [{ id: 81, path: file, albumId: 10, durationMs: 3000, available: true }],
            },
          ],
        },
      }),
  };
  const scan = async () => {
    await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 10000 });
    assert.equal((await modelStatus(ctx)).scan.state, "done");
  };
  const stored = async (change) => {
    const catalogue = await openCatalogue(path.join(folders.dataFolder, "model"));
    try {
      const row = catalogue.db.prepare("SELECT id,evidence FROM track_link WHERE state='active'").get();
      const evidence = JSON.parse(row.evidence);
      if (change) {
        change(evidence);
        catalogue.db.prepare("UPDATE track_link SET evidence=? WHERE id=?").run(JSON.stringify(evidence), row.id);
      }
      return { evidence, state: catalogue.db.prepare("SELECT state FROM classification WHERE target_id=?").get(row.id)?.state };
    } finally {
      catalogue.close();
    }
  };
  await scan();
  // As if an earlier parser had read this file's tags successfully.
  const tags = {
    title: "Symphony No. 5 in C minor, Op. 67: I. Allegro con brio",
    composer: ["Ludwig van Beethoven"],
    work: "Symphony No. 5 in C minor, Op. 67",
    workId: "mb-work-5",
    recordingMbid: "mb-recording-1",
    genres: ["Classical"],
    composerDistinct: true,
  };
  await stored((evidence) => Object.assign(evidence.hints, tags));
  await scan();
  const { evidence, state } = await stored();
  for (const [key, value] of Object.entries(tags)) assert.deepEqual(evidence.hints[key], value, key);
  assert.equal(evidence.hints.tagsUnreadable, true);
  assert.equal(evidence.hints.artist, "Host artist", "host metadata fills fields the tags never had");
  assert.equal(state, "classical", "classification still sees the retained evidence");
  // Different audio under the same host IDs gets no inherited tags.
  await stored((evidence) => {
    evidence.fingerprint = "audio-sha256-v2:other-audio";
    evidence.mtimeMs = 1; // force a rehash, which no longer matches that audio
  });
  await scan();
  assert.deepEqual((await stored()).evidence.hints.composer, []);
});

test("an explicit scan resumes failed saved progress after a reader fix", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  let snapshotRequests = 0;
  const ctx = {
    ...folders,
    settings: {},
    userOperations: {
      version: 1,
      url: "http://host.test/ops",
      token: "test-only",
    },
    fetch: async () => {
      snapshotRequests++;
      return response({ version: 1, complete: true, library: { tracks: [] } });
    },
  };
  const id = await enqueueModelScan(ctx, { id: 1, role: "admin" });
  const catalogue = await openCatalogue(path.join(folders.dataFolder, "model"));
  catalogue.db
    .prepare(
      `UPDATE model_job SET state='failed',progress=?,attempt=max_attempts,
      error='old reader failure' WHERE id=?`,
    )
    .run(JSON.stringify({ cursor: 4130, collected: [] }), id);
  catalogue.close();
  assert.equal(
    await enqueueModelScan(ctx, { id: 1, role: "admin" }),
    id,
  );
  const resumed = await openCatalogue(path.join(folders.dataFolder, "model"));
  try {
    const job = new ModelJobs(resumed).get(id);
    assert.equal(job.state, "queued");
    assert.equal(job.attempt, 0);
    assert.equal(job.error, null);
    assert.equal(job.progress.cursor, 4130);
    assert.equal(snapshotRequests, 1);
  } finally {
    resumed.close();
  }
});

test("model status shows errors only while a scan is retrying or failed", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const catalogue = await openCatalogue(path.join(folders.dataFolder, "model"));
  const id = new ModelJobs(catalogue).enqueue("library_scan", "library_scan", {
    files: [],
  });
  catalogue.db
    .prepare("UPDATE model_job SET state='running',error='old failure' WHERE id=?")
    .run(id);
  catalogue.close();
  assert.equal((await modelStatus(folders)).scan.error, null);
  const retrying = await openCatalogue(path.join(folders.dataFolder, "model"));
  retrying.db
    .prepare("UPDATE model_job SET state='retry',error='current failure' WHERE id=?")
    .run(id);
  retrying.close();
  assert.equal(
    (await modelStatus(folders)).scan.error,
    "current failure",
  );
});

test("stored ordinary/unsure decisions block explicit file writes, even with provider classical evidence", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const file = await copyFixture(
    "sine.flac",
    path.join(folders.libraryFolder, "ordinary.flac"),
  );
  await writeTags(file, {
    recordingMbid: ["00000000-0000-4000-8000-000000000001"],
  });
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  const [link] = reconcile(c, snapshot([track(1, { path: file })]));
  const ctx = { ...folders, log: () => {} };
  for (const state of ["not_classical", "unsure"]) {
    classify(c, link.id, {}, { manual: state, actor: "admin" });
    assert.equal(await modelAllowsTagging(ctx, file), false);
    const before = await fs.readFile(file);
    const result = await plugin.actions["tag-album"]({
      ...folders,
      settings: {},
      user: { id: 1, role: "admin" },
      album: { title: "Ordinary", tracks: [{ path: file }] },
    });
    assert.match(result.message, /skipped/);
    assert.deepEqual(await fs.readFile(file), before);
  }
  classify(c, link.id, {}, { manual: "classical", actor: "admin" });
  assert.equal(await modelAllowsTagging(ctx, file), true);
  c.close();
});

test("stock host capabilities and non-admin model actions fail without mutations", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const input = { ...folders, settings: {}, user: { id: 1, role: "user" } };
  for (const action of [
    "classical-model-status",
    "classical-model-scan",
    "classical-model-cancel",
  ])
    await assert.rejects(plugin.actions[action](input), /admin/);
  await assert.rejects(
    enqueueModelScan({ ...folders, settings: {} }, { id: 1, role: "admin" }),
    /capability/,
  );
  assert.deepEqual(await fs.readdir(folders.dataFolder), []);
});

test("multi-work attacca tracks retain separate ranges and reject overlap or mixed interpretations", async (t) => {
  const { c } = await setup(t);
  const [link] = reconcile(c, snapshot([track(1)]));
  const p = c.createEntity("performance"),
    recording = c.createEntity("recording", { durationMs: 2000 });
  c.relate("recording_performance", recording, p);
  const works = [c.createEntity("work"), c.createEntity("work")];
  const plans = [];
  for (let i = 0; i < 2; i++) {
    const pw = c.relate("performance_work", p, works[i], { position: i + 1 });
    const content = c.recordingContent(recording, pw, {
      position: i + 1,
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
    });
    const seg = c.segment(link.id, {
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
    });
    c.segmentContent(seg, content);
    const plan = c.realization(works[i], pw);
    c.realizationItem(plan, seg);
    plans.push({ plan, seg });
  }
  assert.throws(
    () =>
      c.realizationItem(plans[0].plan, plans[1].seg, {
        sequence: 2,
        occurrence: 2,
      }),
    /another interpretation/,
  );
  assert.throws(
    () =>
      c.realizationItem(plans[0].plan, plans[0].seg, {
        sequence: 2,
        occurrence: 2,
      }),
    /Overlapping/,
  );
  c.realizationItem(plans[0].plan, plans[0].seg, {
    sequence: 2,
    occurrence: 2,
    intentionalOverlap: true,
  });
  assert.equal(
    c.db
      .prepare(
        "SELECT count(*) AS n FROM realization_item WHERE realization_id=?",
      )
      .get(plans[0].plan).n,
    2,
  );
});

test("reconciliation distinguishes reissues, changed audio, interrupted evidence and stable-file moves", async (t) => {
  const { c } = await setup(t);
  const [first, second] = reconcile(
    c,
    snapshot([
      track(1, { fingerprint: null, stableFileId: "fs-v1:one" }),
      track(2),
    ]),
  );
  const rows = reconcile(
    c,
    snapshot(
      [track(10, { fingerprint: null, stableFileId: "fs-v1:one" }), track(2)],
      2,
    ),
  );
  assert.equal(rows[0].id, first.id);
  assert.equal(rows[1].id, second.id);
  const count = c.db
    .prepare("SELECT count(*) AS n FROM track_evidence")
    .get().n;
  assert.throws(
    () => reconcile(c, snapshot([track(10), track(10)], 3)),
    /Duplicate/,
  );
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM track_evidence").get().n,
    count,
  );
  reconcile(
    c,
    snapshot(
      [
        track(10, {
          fingerprint: null,
          stableFileId: "fs-v1:one",
          durationMs: 9999,
        }),
      ],
      3,
    ),
  );
  assert.equal(
    c.db.prepare("SELECT state FROM track_link WHERE id=?").get(first.id).state,
    "review",
  );
});

test("unchanged physical duplicates retain their own exact links and never accept a caller-supplied local ID", async (t) => {
  const { c } = await setup(t);
  const items = [
    track(1, { fingerprint: "identical", id: "external-id" }),
    track(2, { fingerprint: "identical" }),
  ];
  const original = reconcile(c, snapshot(items));
  assert.notEqual(original[0].id, "external-id");
  const scanned = reconcile(c, snapshot(items, 2));
  assert.deepEqual(
    scanned.map((x) => x.id),
    original.map((x) => x.id),
  );
  assert.equal(
    c.db
      .prepare("SELECT count(*) AS n FROM track_link WHERE state='active'")
      .get().n,
    2,
  );
});

test("the complete committed synthetic library scans and rescans without changing media", async (t) => {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const cases = JSON.parse(
    await fs.readFile(new URL("../dev/fixtures.json", import.meta.url), "utf8"),
  );
  const libraryFolder = fileURLToPath(
    new URL("../dev/library", import.meta.url),
  );
  const files = cases.flatMap((f) =>
    Array.from({ length: f.tracks }, (_, i) => ({
      fixture: f.id,
      path: path.join(libraryFolder, f.id, `${i + 1}.flac`),
    })),
  );
  const before = await Promise.all(files.map((f) => fs.readFile(f.path)));
  const ctx = {
    ...folders,
    libraryFolder,
    settings: {},
    userOperations: {
      version: 1,
      url: "http://host.test/ops",
      token: "fixture-only",
    },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          tracks: files.map((f, i) => ({
            id: i,
            files: [
              { id: i, path: f.path, albumId: f.fixture, available: true },
            ],
          })),
        },
      }),
  };
  for (let i = 0; i < 2; i++) {
    await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 30000 });
  }
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  try {
    assert.equal(
      c.db
        .prepare("SELECT count(*) AS n FROM track_link WHERE state='active'")
        .get().n,
      files.length,
    );
    const state = (file) =>
      c.db
        .prepare(
          `SELECT c.state FROM track_link t JOIN classification c ON c.target_id=t.id
      WHERE json_extract(t.evidence,'$.path')=?`,
        )
        .get(path.join(libraryFolder, file)).state;
    assert.equal(state("non-classical/1.flac"), "not_classical");
    assert.equal(state("crossover/1.flac"), "classical");
    assert.equal(state("crossover/2.flac"), "not_classical");
    const album = c.albumTarget(
      c.db.prepare("SELECT id FROM core_instance").get().id,
      "crossover",
    );
    assert.equal(
      c.db
        .prepare("SELECT state FROM classification WHERE target_id=?")
        .get(album).state,
      "unsure",
    );
    classify(c, album, {}, { manual: "not_classical", actor: "admin" });
    const classicalTrack = c.db
      .prepare(
        "SELECT id FROM track_link WHERE json_extract(evidence,'$.path')=?",
      )
      .get(path.join(libraryFolder, "crossover/1.flac"));
    classify(c, classicalTrack.id, {}, { manual: "classical", actor: "admin" });
    await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 30000 });
    assert.equal(
      state("crossover/1.flac"),
      "classical",
      "track pin overrides album pin",
    );
    assert.equal(state("crossover/2.flac"), "not_classical");
    assert.equal(
      c.db
        .prepare("SELECT state FROM classification WHERE target_id=?")
        .get(album).state,
      "not_classical",
    );
  } finally {
    c.close();
  }
  for (let i = 0; i < files.length; i++)
    assert.deepEqual(await fs.readFile(files[i].path), before[i]);
});

for (const resumeWith of ["action", "schedule"]) {
  test(`a partial read-only scan resumes beyond five seconds through ${resumeWith}`, async (t) => {
    const folders = await tempFolders();
    t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
    const files = [];
    for (let i = 0; i < 30; i++) {
      const file = await copyFixture(
        "sine.flac",
        path.join(folders.libraryFolder, `${i}.flac`),
      );
      await fs.chmod(file, 0o444);
      files.push(file);
    }
    const before = await Promise.all(files.map((file) => fs.readFile(file)));
    let snapshotRequests = 0;
    const ctx = {
      ...folders,
      settings: { enableFileWrites: false },
      userOperations: {
        version: 1,
        url: "http://host.test/ops",
        token: "test-only",
      },
      fetch: async () => {
        snapshotRequests++;
        return response({
          version: 1,
          complete: true,
          library: {
            tracks: files.map((file, i) => ({
              id: i,
              files: [{ id: i, path: file, available: true }],
            })),
          },
        });
      },
    };
    const id = await enqueueModelScan(ctx, { id: 1, role: "admin" });
    let clock = Date.now();
    t.mock.method(Date, "now", () => clock);
    const originalStat = fs.stat;
    t.mock.method(fs, "stat", async (...args) => {
      const result = await originalStat(...args);
      if (files.includes(args[0])) clock += 600;
      return result;
    });
    await runModelJobs(ctx);
    const partial = await modelStatus(ctx);
    assert.equal(partial.scan.state, "queued");
    assert.equal(partial.scan.processed, 5);
    assert.equal(partial.scan.total, 30);
    assert.deepEqual(
      partial.tracks,
      [],
      "partial scans do not publish incomplete snapshots",
    );
    const input = { ...ctx, user: { id: 1, role: "admin" } };
    const status = await plugin.actions["classical-model-status"](input);
    assert.match(status.message, /queued; processed 5\/30 files/);
    // Resuming the admin action must reuse its original complete snapshot.
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("unexpected snapshot/provider request");
    });
    if (resumeWith === "action") {
      const result = await plugin.actions["classical-model-scan"](input);
      assert.match(result.message, /done; processed 30\/30 files/);
    } else {
      await plugin.scheduled(input);
    }
    const done = await modelStatus(ctx);
    assert.equal(done.scan.id, id);
    assert.equal(done.scan.state, "done");
    assert.equal(done.scan.processed, 30);
    assert.equal(done.tracks.find((row) => row.state === "active").count, 30);
    assert.equal(snapshotRequests, 1);
    assert.match(
      (await plugin.actions["classical-model-status"](input)).message,
      /indexed tracks: 30/,
    );
    for (let i = 0; i < files.length; i++) {
      assert.deepEqual(await fs.readFile(files[i]), before[i]);
      assert.equal((await fs.stat(files[i])).mode & 0o777, 0o444);
    }
  });
}
