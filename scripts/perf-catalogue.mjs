// A synthetic 10,000-track classical Library for the page benchmark
// (v0.3 9.1): 2,500 works of four movements by 100 composers, each on its
// own album, played by 300 performers (soloists, orchestras, conductors),
// scanned and matched the normal way. Synthetic names only; no files, no
// network. `node scripts/perf-catalogue.mjs <folder>` builds one to inspect.
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../src/model/auto-match.js";

export const WORKS = 2500;
export const MOVEMENTS = 4;
const FORMS = ["Symphony", "Piano Sonata", "String Quartet", "Piano Trio", "Violin Sonata", "Cello Sonata", "Concerto", "Suite", "Serenade", "Partita"];
const KEYS = ["C major", "D minor", "E-flat major", "F minor", "G major", "A minor", "B-flat major"];
const TEMPI = ["Allegro", "Adagio", "Scherzo. Presto", "Finale. Allegro molto"];

export function tracks({ works = WORKS } = {}) {
  const out = [];
  for (let w = 0; w < works; w++) {
    const composer = `Composer ${String(w % 100).padStart(3, "0")} Synthetic`;
    const form = FORMS[w % FORMS.length];
    const title = `${form} No. ${Math.floor(w / 100) + 1} in ${KEYS[w % KEYS.length]}, Op. ${1000 + w}`;
    const soloist = `Soloist ${String(w % 200).padStart(3, "0")} Example`;
    const orchestra = `Orchestra ${String(w % 60).padStart(2, "0")} Philharmonic`;
    const conductor = `Conductor ${String(w % 40).padStart(2, "0")} Example`;
    for (let m = 0; m < MOVEMENTS; m++) {
      const id = `${w}-${m}`;
      out.push({
        coreId: id,
        fileId: id,
        path: `/library/perf/${w}/${m + 1}.flac`,
        size: 1000,
        durationMs: 300000 + m * 1000,
        fingerprint: `audio-sha256-v2:perf-${id}`,
        albumId: `perf-${w}`,
        hints: {
          title: `${title}: ${["I", "II", "III", "IV"][m]}. ${TEMPI[m]}`,
          album: `Album ${w}`,
          artist: `${soloist}; ${orchestra}`,
          composer: [composer],
          conductor,
          work: `${title}: ${["I", "II", "III", "IV"][m]}. ${TEMPI[m]}`,
          trackNumber: m + 1,
          discNumber: 1,
          genres: ["Classical"],
          date: String(1950 + (w % 70)),
        },
      });
    }
  }
  return out;
}

// Scans and matches `tracks()` into the catalogue in `folder`; returns it open.
export async function buildCatalogue(folder, options) {
  const c = await openCatalogue(folder);
  c.db.prepare("INSERT INTO core_instance VALUES ('perf','e',0)").run();
  const rows = reconcile(c, { version: 1, complete: true, instanceId: "perf", epoch: "e", generation: 1, tracks: tracks(options) });
  for (const row of rows) classify(c, row.id, row.hints);
  autoMatchTaggedWorks(c, { actor: "perf" });
  return c;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = performance.now();
  const c = await buildCatalogue(process.argv[2] || "./.scratch/perf-catalogue");
  const count = (sql) => c.db.prepare(sql).get().n;
  console.log(`Built in ${Math.round(performance.now() - started)} ms: ${count("SELECT count(*) AS n FROM track_link")} tracks, ${count("SELECT count(*) AS n FROM entity WHERE kind='work'")} works, ${count("SELECT count(*) AS n FROM realization")} recordings`);
  c.close();
}
