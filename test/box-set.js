// Shared fixture: a box set album indexed, classified and matched.
import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, mutateEditor } from "../src/model/editor.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { tempFolders } from "./helpers.js";

// A box set of 640 tracks: 160 sonatas of four movements, the first 40 of
// them tagged with their work, the rest with titles only.
export async function boxSet(t, { tracks = 640 } = {}) {
  const folders = await tempFolders();
  t.after(() => fs.rm(folders.root, { recursive: true, force: true }));
  const c = await openCatalogue(path.join(folders.dataFolder, "model"));
  t.after(() => {
    try {
      c.close();
    } catch {}
  });
  c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const movements = ["I. Allegro", "II. Adagio", "III. Menuetto", "IV. Rondo"];
  const rows = reconcile(c, {
    version: 1,
    complete: true,
    instanceId: "i",
    epoch: "e",
    generation: 1,
    tracks: Array.from({ length: tracks }, (_, i) => {
      const work = `Sonata No. ${Math.floor(i / 4) + 1}, Op. ${Math.floor(i / 4) + 1}`;
      return {
        coreId: `box-${i}`,
        fileId: `box-${i}`,
        path: `/library/box/${i}.flac`,
        size: 100,
        durationMs: 200000 + i,
        fingerprint: `audio-sha256-v2:box-${i}`,
        albumId: "box",
        hints: {
          title: `${work}: ${movements[i % 4]}`,
          album: "The Complete Sonatas",
          artist: "Box Pianist",
          composer: ["Joseph Haydn"],
          ...(i < 160 && { work: `${work}: ${movements[i % 4]}` }),
          trackNumber: (i % 100) + 1,
          discNumber: Math.floor(i / 100) + 1,
          genres: ["Classical"],
        },
      };
    }),
  });
  for (const row of rows) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c, { actor: "test" });
  const input = { ...folders, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 2 } };
  const read = (query = {}) => readEditor({ ...input, query });
  const mutate = async (command, values, selection = "") =>
    mutateEditor({ ...input, mutation: { revision: (await read({ selection })).revision, command, values } });
  return { c, read, mutate };
}

