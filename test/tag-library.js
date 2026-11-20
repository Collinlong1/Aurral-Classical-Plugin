// A real Library for tag-writing tests (v0.3 8.3-8.6): Beethoven's Fifth as
// three FLAC files and one MP3, and an Opus file, with tags as a ripper left
// them, scanned and matched the normal way. Nothing here reaches a network.
import fs from "node:fs/promises";
import path from "node:path";
import { copyFixture, json as response, tempFolders } from "./helpers.js";
import { writeTags } from "../src/tags.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { enqueueModelScan, runModelJobs } from "../src/model/runtime.js";
import { readEditor, mutateEditor } from "../src/model/editor.js";

export const WORK = "Symphony No. 5 in C minor, Op. 67";
export const MOVEMENTS = ["I. Allegro con brio", "II. Andante con moto", "III. Scherzo. Allegro", "IV. Allegro"];

export async function tagLibrary(t, { settings = { enableTagWriting: true } } = {}) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const files = [];
  const add = async (fixture, name, title, trackNumber, album = "fifth") => {
    const file = await copyFixture(fixture, path.join(folders.libraryFolder, album, name));
    // Distinct audio per file.
    const { size } = await fs.stat(file);
    const handle = await fs.open(file, "r+");
    await handle.write(Buffer.from([files.length + 1]), 0, 1, size - 50);
    await handle.close();
    await writeTags(file, { title: [title], composer: ["Ludwig van Beethoven"], artist: ["Berliner Philharmoniker; Herbert von Karajan"], work: [], workId: [] });
    files.push({ id: files.length, file, title, album, trackNumber });
  };
  for (const [i, movement] of MOVEMENTS.slice(0, 3).entries()) await add("sine.flac", `0${i + 1}.flac`, `${WORK}: ${movement}`, i + 1);
  await add("sine.mp3", "04.mp3", `${WORK}: ${MOVEMENTS[3]}`, 4);
  await add("sine.opus", "05.opus", "Coriolan Overture, Op. 62", 5, "coriolan");
  const ctx = {
    ...folders,
    settings,
    log: () => {},
    userOperations: { version: 1, url: "http://host.test/ops", token: "test-only" },
    fetch: async () =>
      response({
        version: 1,
        complete: true,
        library: {
          albums: [{ id: "fifth", title: "Fifth" }, { id: "coriolan", title: "Coriolan" }],
          tracks: files.map((track) => ({
            id: track.id,
            title: track.title,
            files: [{ id: track.id, path: track.file, available: true, durationMs: 1000, albumId: track.album, trackNumber: track.trackNumber, discNumber: 1 }],
          })),
        },
      }),
    // Matching from tags alone; MusicBrainz is never asked.
    resolver: { resolve: async () => null },
    mb: { get: async () => null },
  };
  const scan = async () => {
    await enqueueModelScan(ctx, { id: 1, role: "admin" });
    await runModelJobs(ctx, { budgetMs: 30_000 });
  };
  await scan();
  const catalogue = () => openCatalogue(path.join(folders.dataFolder, "model"));
  const started = [];
  const input = (extra = {}) => ({
    ...folders,
    settings: ctx.settings,
    user: { id: 1, role: "admin" },
    pageId: "editor",
    capabilities: { adminForms: 2 },
    maintenance: { startTagWrites: () => started.push(Date.now()), status: async () => null, run: async () => "" },
    ...extra,
  });
  const read = async (selection = "") => (await readEditor({ ...input(), query: { selection } })).view;
  const mutate = async (command, values, selection = "") => {
    const revision = (await readEditor({ ...input(), query: { selection } })).revision;
    return mutateEditor({ ...input(), mutation: { revision, command, values } });
  };
  const linkOf = async (index) => {
    const c = await catalogue();
    try {
      return c.db.prepare("SELECT id FROM track_link WHERE core_id=? AND state='active'").get(String(index))?.id;
    } finally {
      c.close();
    }
  };
  return { folders, files, ctx, scan, catalogue, read, mutate, linkOf, started, input };
}
