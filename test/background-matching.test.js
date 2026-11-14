// Matching with no admin clicks (v0.1 completion, step 3): a scan applies
// the full tag and title rules, and MusicBrainz is asked in the background
// only about albums whose unmatched tracks are new or changed. The albums
// already there when this first runs wait for the one-time backlog action.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { tempFolders, copyFixture, json as response, symphonyEntities } from "./helpers.js";
import plugin from "../src/index.js";
import { writeTags } from "../src/tags.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { renderAlbumPresentation } from "../src/model/presentation.js";
import { Metadata } from "../src/model/metadata.js";
import { enqueueModelScan, identifyBacklog, modelStatus, runModelJobs } from "../src/model/runtime.js";

const admin = { id: 1, role: "admin" };
const DEBUSSY = "Claude Debussy";
const recording = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A library the test can grow: each album is its tracks' titles, composer,
// and recording IDs (or none).
async function library(t) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const tracks = [];
  const add = async (album, titles, { composer = DEBUSSY, recordings = [] } = {}) => {
    for (const [i, title] of titles.entries()) {
      const id = tracks.length;
      const file = await copyFixture("sine.flac", path.join(folders.libraryFolder, `${id}.flac`));
      // Distinct audio per file.
      const { size } = await fs.stat(file);
      const fd = await fs.open(file, "r+");
      await fd.write(Buffer.from([id + 1]), 0, 1, size - 50);
      await fd.close();
      await writeTags(file, { title: [title], composer: [composer], artist: ["Pianist"], ...(recordings[i] && { recordingMbid: [recordings[i]] }) });
      tracks.push({ id, title, album, file, trackNumber: i + 1 });
    }
  };
  const lookups = [];
  const works = {
    // MusicBrainz: each recording is a movement of one parent work.
    "work-parent": { id: "work-parent", title: "Suite bergamasque", relations: [{ type: "composer", artist: { id: "artist-debussy", name: DEBUSSY } }] },
    ...Object.fromEntries(
      ["Prélude", "Menuet", "Clair de lune", "Passepied"].map((title, i) => [
        `work-${i + 1}`,
        { id: `work-${i + 1}`, title, relations: [{ type: "parts", direction: "backward", work: { id: "work-parent" } }] },
      ]),
    ),
  };
  const ctx = {
    ...folders,
    settings: {},
    log: () => {},
    userOperations: { version: 1, url: "http://host.test/ops", token: "test-only" },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          albums: [...new Set(tracks.map((track) => track.album))].map((album) => ({ id: album, title: album })),
          tracks: tracks.map((track) => ({
            id: track.id,
            title: track.title,
            files: [{ id: track.id, path: track.file, available: true, durationMs: 1000, albumId: track.album, trackNumber: track.trackNumber, discNumber: 1 }],
          })),
        },
      }),
    resolver: {
      async resolve(id) {
        lookups.push(`recording:${id}`);
        const n = Number(id.slice(-12));
        return { workId: `work-${n}`, composers: [DEBUSSY] };
      },
    },
    mb: {
      async get(kind, id) {
        lookups.push(`${kind}:${id}`);
        return works[id] || null;
      },
    },
  };
  const scan = async () => {
    await enqueueModelScan(ctx, admin);
    await runModelJobs(ctx, { budgetMs: 30_000 });
  };
  const view = async (albumId) => {
    const c = await openCatalogue(path.join(folders.dataFolder, "model"));
    try {
      return renderAlbumPresentation(c, albumId)?.groups.map((group) => [group.title, Boolean(group.workId), group.items.length]) ?? null;
    } finally {
      c.close();
    }
  };
  return { ctx, add, scan, view, lookups, works };
}

test("background matching: a scan applies the full title rules without MusicBrainz", async (t) => {
  const lib = await library(t);
  await lib.add("corner", ["I. Doctor Gradus ad Parnassum", "II. Jimbo’s Lullaby", "III. Serenade for the Doll"].map((m) => `Children’s Corner, L. 113: ${m}`));
  await lib.scan();
  // Before: scans read only WORK and GROUPING tags, so this stayed unmatched.
  assert.deepEqual(await lib.view("corner"), [["Children’s Corner, L. 113", true, 3]]);
  assert.deepEqual(lib.lookups, []);
});

test("background matching: only new albums are looked up, once, paced and resumable; the backlog waits for the admin", async (t) => {
  const lib = await library(t);
  const titles = ["Prélude", "Menuet", "Clair de lune", "Passepied"];
  // Titles that name no work: only MusicBrainz can.
  await lib.add("earlier", titles, { recordings: [1, 2, 3, 4].map(recording) });
  await lib.scan();
  // Already there on the first run: recorded as the backlog, not looked up.
  assert.deepEqual(lib.lookups, []);
  let status = (await modelStatus(lib.ctx)).identification;
  assert.equal(status.backlog, 1);
  assert.equal(status.queued, 0);

  await lib.add("new", titles, { recordings: [1, 2, 3, 4].map(recording) });
  await lib.scan();
  // The scan finished first; identification runs on the next job run.
  status = (await modelStatus(lib.ctx)).identification;
  assert.equal(status.queued, 1);
  // A run that stops part way keeps what it looked up.
  await runModelJobs(lib.ctx, { budgetMs: 0 });
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  status = (await modelStatus(lib.ctx)).identification;
  assert.deepEqual([status.queued, status.done, status.matched], [0, 1, 1]);
  assert.deepEqual(await lib.view("new"), [["Suite bergamasque", true, 4]]);
  assert.equal(await lib.view("earlier").then((groups) => groups?.some(([, matched]) => matched) ?? false), false);
  assert.ok(lib.lookups.every((lookup) => !lookup.includes("earlier")));

  // A rescan with nothing changed looks nothing up again.
  const before = lib.lookups.length;
  await lib.scan();
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  assert.equal(lib.lookups.length, before);

  // The admin's one-time backlog lookup.
  await assert.rejects(identifyBacklog(lib.ctx, { id: 2, role: "user" }), /admin/);
  assert.deepEqual(await identifyBacklog(lib.ctx, admin), { albums: 1, tracks: 4 });
  assert.deepEqual(await identifyBacklog(lib.ctx, admin), { albums: 0, tracks: 0 });
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  // Both albums share the one work MusicBrainz names.
  const [earlier] = await lib.view("earlier");
  assert.deepEqual(earlier, ["Suite bergamasque", true, 4]);
  status = (await modelStatus(lib.ctx)).identification;
  assert.deepEqual([status.queued, status.backlog, status.done], [0, 0, 2]);
});

test("background matching: an unreachable MusicBrainz retries the album later instead of skipping it", async (t) => {
  const lib = await library(t);
  await lib.add("first", ["Prélude"], { recordings: [recording(1)] });
  await lib.scan();
  await lib.add("later", ["Prélude", "Menuet", "Clair de lune", "Passepied"], { recordings: [1, 2, 3, 4].map(recording) });
  const working = lib.ctx.resolver.resolve;
  lib.ctx.resolver.resolve = async () => {
    throw new Error("fetch failed");
  };
  await lib.scan();
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  const c = await openCatalogue(path.join(lib.ctx.dataFolder, "model"));
  const job = c.db.prepare("SELECT state,error FROM model_job WHERE type='album_identify' AND state!='done'").get();
  c.db.prepare("UPDATE model_job SET next_run_at=0 WHERE type='album_identify'").run();
  c.close();
  assert.equal(job.state, "retry");
  assert.match(job.error, /MusicBrainz unavailable/);
  lib.ctx.resolver.resolve = working;
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  assert.deepEqual(await lib.view("later"), [["Suite bergamasque", true, 4]]);
});

// On the user's server the backlog stayed "queued": the action only queued
// it, and the plugin schedule runs the queue. The action now works the
// queue itself, in its background budget, on the model worker thread.
test("background matching: the backlog action looks the albums up itself, without the schedule", async (t) => {
  const lib = await library(t);
  await lib.add("earlier", ["I. Allegro con brio", "II. Andante con moto"], { composer: "Ludwig van Beethoven", recordings: [recording(1), recording(2)] });
  await lib.scan();
  // MusicBrainz as the plugin's own client reads it, through the mirror setting.
  const entities = symphonyEntities(recording(1));
  entities[`recording:${recording(2)}`] = {
    ...entities[`recording:${recording(1)}`],
    id: recording(2),
    relations: [{ type: "performance", "target-type": "work", direction: "forward", work: { id: "mvt2", title: "Symphony No. 5: II" } }],
  };
  entities["work:mvt2"] = { ...entities["work:mvt1"], id: "mvt2", title: "Symphony No. 5 in C minor, op. 67: II. Andante con moto" };
  // Served over HTTP as a MusicBrainz mirror: the lookups run on the
  // model worker thread, which reaches the network itself.
  const server = http.createServer((request, response) => {
    const [, , , entity, id] = new URL(request.url, "http://mirror").pathname.split("/");
    const data = entities[`${entity}:${id}`];
    response.writeHead(data ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(data || { error: "Not Found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const mirror = `http://127.0.0.1:${server.address().port}`;
  const input = { ...lib.ctx, settings: { mbMirror: mirror }, user: { id: 1, role: "admin" } };
  const { message } = await plugin.actions["classical-identify-backlog"](input);
  assert.match(message, /Queued 1 album \(2 tracks\).* 1 album looked up, 1 work group made/);
  assert.deepEqual(await lib.view("earlier"), [["Symphony No. 5 in C minor, op. 67", true, 2]]);
});

// From the user's library: Scriabin's late sonatas are one movement each,
// titled "Piano Sonata no. 7, op. 64 "Messe blanche": Allegro". MusicBrainz
// names the sonata itself, a work with no parts, but the colon made the track
// read as one movement of a bigger work, and one movement alone is refused.
test("background matching: a whole work in one movement, titled with its tempo, matches from MusicBrainz", async (t) => {
  const lib = await library(t);
  await lib.add("earlier", ["Prélude"], { recordings: [recording(1)] });
  await lib.scan();
  lib.works["work-7"] = { id: "work-7", title: "Piano Sonata no. 7, op. 64 “White Mass”", relations: [{ type: "composer", artist: { id: "artist-scriabin", name: "Alexander Scriabin" } }] };
  // A symphony movement that MusicBrainz files under its symphony joins it
  // as an excerpt (1.0.41), as Apple Music Classical shows it.
  lib.works["work-8"] = { id: "work-8", title: "Symphony no. 5, op. 67: I. Allegro con brio", relations: [{ type: "parts", direction: "backward", work: { id: "work-sym" } }] };
  lib.works["work-sym"] = { id: "work-sym", title: "Symphony no. 5, op. 67", relations: [{ type: "parts", direction: "forward", work: { id: "work-8" } }] };
  await lib.add("scriabin", ['Piano Sonata no. 7, op. 64 "Messe blanche": Allegro', "Symphony no. 5, op. 67: Allegro con brio"], { composer: "Alexander Scriabin", recordings: [recording(7), recording(8)] });
  await lib.scan();
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  const groups = await lib.view("scriabin");
  assert.deepEqual(groups.find(([title]) => /Sonata no\. 7/.test(title)), ['Piano Sonata no. 7, op. 64 "Messe blanche"', true, 1]);
  assert.deepEqual(groups.find(([title]) => /Symphony no\. 5/.test(title)), ["Symphony no. 5, op. 67", true, 1]);
});

// From the user's library on 1.0.42: three preludes and fugues on one album
// were filed under "The Well-Tempered Clavier, BWV 846–893" (identification
// climbed MusicBrainz's tree into the range of works above them), and works
// kept German names because their English alias wasn't the primary one.
test("background matching: no climbing into a range of works; English names; the admin action runs on the worker", async (t) => {
  const lib = await library(t);
  await lib.add("earlier", ["Prélude"], { recordings: [recording(1)] });
  await lib.scan();
  const part = (id, title, parent) => ({ id, title, relations: [{ type: "parts", direction: "backward", work: { id: parent } }] });
  Object.assign(lib.works, {
    "work-31": part("work-31", "Prelude", "pf855"),
    "work-32": part("work-32", "Fugue", "pf855"),
    pf855: {
      id: "pf855",
      title: "Präludium und Fuge e-Moll, BWV 855",
      aliases: [{ locale: "en", name: "Prelude and Fugue in E minor, BWV 855", primary: false, type: "Work name" }],
      relations: [
        { type: "parts", direction: "backward", work: { id: "wtc1" } },
        { type: "parts", direction: "forward", work: { id: "work-31" } },
        { type: "parts", direction: "forward", work: { id: "work-32" } },
      ],
    },
    wtc1: part("wtc1", "Das Wohltemperierte Klavier I, BWV 846–869", "wtc"),
    wtc: { id: "wtc", title: "The Well-Tempered Clavier, BWV 846–893", relations: [] },
    "work-33": part("work-33", "Präludium", "pf902"),
    pf902: { id: "pf902", title: "Präludium und Fughetta G-Dur, BWV 902", relations: [] },
  });
  await lib.add("bach", ["Prelude", "Fugue", "Prelude & Fughetta in G major, BWV 902: I. Prelude"], { composer: "Johann Sebastian Bach", recordings: [recording(31), recording(32), recording(33)] });
  await lib.scan();
  await runModelJobs(lib.ctx, { budgetMs: 30_000 });
  assert.deepEqual(await lib.view("bach"), [
    ["Prelude and Fugue in E minor, BWV 855", true, 2],
    ["Prelude & Fughetta in G major, BWV 902", true, 1],
  ]);

  // A work titled before 1.0.43 takes the English name when its album is
  // matched again, through the admin action, which now runs on the worker.
  const c = await openCatalogue(path.join(lib.ctx.dataFolder, "model"));
  const work = c.db.prepare("SELECT entity_id AS id FROM external_identity WHERE record_kind='work' AND record_id='pf855' AND state='active'").get().id;
  new Metadata(c).derived(work, "title", "Präludium und Fuge e-Moll, BWV 855");
  c.close();
  // MusicBrainz as a mirror over HTTP: the worker makes its own client.
  const server = http.createServer((request, response) => {
    const [, , , entity, id] = new URL(request.url, "http://mirror").pathname.split("/");
    const data = entity === "work" ? lib.works[id] : null;
    response.writeHead(data ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(data || { error: "Not Found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const settings = { mbMirror: `http://127.0.0.1:${server.address().port}` };
  const { message } = await plugin.actions["classical-auto-match"]({ ...lib.ctx, settings, user: admin, album: { id: "bach" } });
  assert.match(message, /No new groups|Created/);
  assert.equal((await lib.view("bach"))[0][0], "Prelude and Fugue in E minor, BWV 855");
});
