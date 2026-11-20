// A small classical Library for search and page tests: Beethoven's
// Moonlight by Levit (two releases) and Barenboim, Bach by Ma, and Dvořák's
// Ninth under Karajan and under Barenboim, with manual credits.
import fs from "node:fs/promises";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";

export async function setup(t, folder = null) {
  const folders = await tempFolders();
  const c = await openCatalogue(folder ? folder(folders) : folders.dataFolder);
  t.after(async () => {
    try {
      c.close();
    } catch {}
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  return c;
}

let generation = 0;
export const resetGeneration = () => {
  generation = 0;
};
export function album(albumId, work, movements, { composer, artist, durations = [], mbids = [], extra = {} }) {
  return movements.map((title, i) => ({
    coreId: `${albumId}-${i}`,
    fileId: `${albumId}-${i}`,
    path: `/library/${albumId}/${i}.flac`,
    size: 1000,
    durationMs: durations[i] ?? 300000 + i * 1000,
    fingerprint: `audio-sha256-v2:${albumId}-${i}`,
    albumId,
    hints: {
      title: `${work}: ${title}`,
      album: `Album ${albumId}`,
      artist,
      composer: [composer],
      work: `${work}: ${title}`,
      trackNumber: i + 1,
      discNumber: 1,
      genres: ["Classical"],
      recordingMbid: mbids[i] || "",
      ...extra,
    },
  }));
}
export function scan(c, tracks) {
  if (!generation) c.db.prepare("INSERT INTO core_instance VALUES ('i','e',0)").run();
  const rows = reconcile(c, { version: 1, complete: true, instanceId: "i", epoch: "e", generation: ++generation, tracks });
  for (const row of rows) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c, { actor: "test" });
}
export const workId = (c, like) => c.db.prepare("SELECT f.target_id AS id FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id JOIN entity e ON e.id=f.target_id WHERE e.kind='work' AND e.deleted_at IS NULL AND f.field='title' AND a.value LIKE ?").get(`%${like}%`)?.id;
export const realizationsOf = (c, work) => c.db.prepare("SELECT id,performance_work_id FROM realization WHERE work_id=? ORDER BY label").all(work);

export const MOONLIGHT = "Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2";
export const SONATA = ["I. Adagio sostenuto", "II. Allegretto", "III. Presto agitato"];
// `extra` tracks join the one scan (a scan is the whole Library).
export async function library(t, folder = null, extra = []) {
  generation = 0;
  const c = await setup(t, folder);
  const m = new Metadata(c);
  // Credits: Barenboim plays the sonata and conducts the symphony. The people
  // exist before the scan, so the credits it derives from the tags are theirs.
  const person = (name) => {
    const id = c.createEntity("person");
    m.manual(id, "name", name, { actor: "test" });
    return id;
  };
  const barenboim = person("Daniel Barenboim");
  const karajan = person("Herbert von Karajan");
  const levit = person("Igor Levit");
  scan(c, [
    ...album("levit", MOONLIGHT, SONATA, { composer: "Ludwig van Beethoven", artist: "Igor Levit", mbids: ["l1", "l2", "l3"] }),
    // The same Levit recording on a second release (a box set).
    ...album("levit-box", MOONLIGHT, SONATA, { composer: "Ludwig van Beethoven", artist: "Igor Levit", mbids: ["l1", "l2", "l3"] }),
    ...album("barenboim", MOONLIGHT, SONATA, { composer: "Ludwig van Beethoven", artist: "Daniel Barenboim", durations: [360000, 140000, 420000] }),
    ...album("ma", "Cello Suite No. 1 in G major, BWV 1007", ["I. Prélude", "II. Allemande"], { composer: "Johann Sebastian Bach", artist: "Yo-Yo Ma" }),
    ...album("dvorak", "Symphony No. 9 in E minor, Op. 95", ["I. Adagio – Allegro molto", "II. Largo"], { composer: "Antonín Dvořák", artist: "Berliner Philharmoniker; Herbert von Karajan" }),
    ...album("dvorak-db", "Symphony No. 9 in E minor, Op. 95", ["I. Adagio – Allegro molto", "II. Largo"], { composer: "Antonín Dvořák", artist: "Chicago Symphony Orchestra; Daniel Barenboim" }),
    ...extra,
  ]);
  const moonlight = workId(c, "Piano Sonata No. 14");
  m.manual(moonlight, "nickname", "Moonlight", { actor: "test", pin: true });
  m.manual(moonlight, "aliases", ["Sonata quasi una fantasia"], { actor: "test", pin: true });
  m.manual(moonlight, "period", "Classical", { actor: "test", pin: true });
  // An admin's credit says what the tags could not: it replaces the plain
  // "performer" credit the scan derived for that person.
  const credit = (album, contributor, role, source = "manual") => {
    const realization = c.db.prepare("SELECT r.performance_work_id FROM realization r WHERE r.label=?").get(`Album ${album}`);
    const performance = c.db.prepare("SELECT source_id FROM relation WHERE id=?").get(realization.performance_work_id).source_id;
    for (const { id } of c.db.prepare("SELECT id FROM credit WHERE target_id=? AND contributor_id=? AND source='derived' AND state='active'").all(performance, contributor)) c.removeCredit(id);
    return c.credit(performance, contributor, role, { source });
  };
  credit("barenboim", barenboim, "soloist");
  credit("dvorak-db", barenboim, "conductor");
  credit("dvorak", karajan, "conductor");
  credit("levit", levit, "soloist");
  credit("levit-box", levit, "soloist");
  return { c, moonlight, barenboim, karajan, credit };
}
