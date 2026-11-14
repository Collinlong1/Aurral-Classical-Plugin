// Times every editor tab and a large album on a synthetic catalogue of
// TRACKS tracks (default 10,000, one box set of 640). Never touches a real
// library: it builds a disposable catalogue in a temporary folder.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";
import { readEditor } from "../src/model/editor.js";

const TRACKS = Number(process.env.TRACKS || 10000);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "editor-timing-"));
const dataFolder = path.join(root, "data");
const c = await openCatalogue(path.join(dataFolder, "model"));
c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
const composers = ["Ludwig van Beethoven", "Wolfgang Amadeus Mozart", "Franz Schubert", "Johannes Brahms", "Antonín Dvořák", "Johann Sebastian Bach"];
const tracks = [];
const add = (albumId, i, work, title, composer, artist) =>
  tracks.push({ coreId: `${albumId}-${i}`, fileId: `${albumId}-${i}`, path: `/l/${albumId}/${i}.flac`, size: 1, durationMs: 200000 + ((i * 7919) % 90000), fingerprint: `audio-sha256-v2:${albumId}-${i}`, albumId,
    hints: { title: `${work}: ${title}`, album: `Album ${albumId}`, artist, composer: [composer], work: `${work}: ${title}`, trackNumber: i + 1, discNumber: 1, genres: ["Classical"] } });
// A box set of 640 tracks: 160 four-movement works.
for (let i = 0; i < 640; i++) add("box", i, `Sonata No. ${Math.floor(i / 4) + 1}, Op. ${Math.floor(i / 4) + 1}`, ["I. Allegro", "II. Adagio", "III. Menuetto", "IV. Rondo"][i % 4], composers[Math.floor(i / 4) % 6], "Box Pianist");
for (let a = 0; tracks.length < TRACKS; a++)
  for (let m = 0; m < 4; m++) add(`a${a}`, m, `Symphony No. ${(a % 40) + 1} in C minor, Op. ${a % 300}`, ["I. Allegro", "II. Andante", "III. Scherzo", "IV. Finale"][m], composers[a % 6], `Orchestra ${a % 200}; Conductor ${a % 90}`);
let t = performance.now();
const rows = reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: 1, tracks });
for (const row of rows) classify(c, row.id, row.hints);
autoMatchTaggedWorks(c, { actor: "timing" });
c.close();
console.log(`catalogue: ${tracks.length} tracks in ${Math.round(performance.now() - t)} ms`);
const input = { dataFolder, user: { id: 1, role: "admin" }, pageId: "editor", capabilities: { adminForms: 2 } };
const time = async (label, query) => {
  const start = performance.now();
  let page;
  let error = "";
  try {
    page = await readEditor({ ...input, query });
  } catch (e) {
    error = e.message;
  }
  const ms = Math.round(performance.now() - start);
  const bytes = page ? Buffer.byteLength(JSON.stringify(page)) : 0;
  const rowsShown = page?.view?.sections?.reduce((n, s) => n + (s.rows?.length || 0), 0) ?? 0;
  console.log(`${label.padEnd(28)} ${String(ms).padStart(6)} ms ${String(Math.round(bytes / 1024)).padStart(6)} KB list ${page?.list?.items?.length ?? "-"}/${page?.list?.total ?? "-"} rows ${rowsShown}${error ? ` ERROR ${error}` : ""}`);
  return page;
};
for (const tab of ["works", "composers", "performers", "albums", "review"]) await time(`tab ${tab}`, { tab });
await time("tab works q=symphony 12", { tab: "works", q: "symphony 12" });
await time("tab search q=op 27", { tab: "search", q: "op 27" });
const works = await time("tab works page 2", { tab: "works", offset: "100" });
if (works?.list?.items?.[0]) await time("open a work", { selection: works.list.items[0].selection });
await time("open album a1", { selection: "album:a1" });
await time("open box set (640)", { selection: "album:box" });
await fs.rm(root, { recursive: true, force: true });
