// Audits the Apple corpus: for every album in every tag style, how Aurral's
// work blocks differ from Apple Music Classical's. Read only; writes nothing
// unless --json <file> is given.
//
//   node scripts/corpus-apple-audit.mjs                 summary per style
//   node scripts/corpus-apple-audit.mjs --style messy   also list each miss
//   node scripts/corpus-apple-audit.mjs --json out.json save every result
//   node scripts/corpus-apple-audit.mjs <album id>...   only these albums
//
// Each adjacent pair of tracks (album order) is either joined (same block)
// or split. Against Apple's answer a pair is:
//   false join  we joined two tracks Apple shows in different blocks — an
//               incorrect automatic match;
//   missed join Apple joins them and we don't — grouping left undone.
// An album is "exact" when it has neither. Movement-title agreement is the
// share of rows whose title reads like Apple's part title.
import fs from "node:fs/promises";
import { appleFixtures, auditAlbum, styles, toAlbum } from "../test/corpus/apple.js";
import { runCorpus } from "../test/corpus/run.js";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : null;
};
const onlyStyle = option("--style");
const jsonFile = option("--json");
const fixtures = appleFixtures().filter((fixture) => !args.length || args.includes(fixture.id));

const results = {};
for (const style of Object.keys(styles)) {
  if (onlyStyle && style !== onlyStyle && !jsonFile) continue;
  const albums = fixtures.map((fixture) => toAlbum(fixture, style));
  const presentations = await runCorpus(albums);
  results[style] = Object.fromEntries(albums.map((album) => [album.appleId, auditAlbum(album, presentations.get(album.id))]));
}

const percent = (n, d) => `${d ? Math.round((n / d) * 1000) / 10 : 0}%`;
for (const [style, albums] of Object.entries(results)) {
  const list = Object.values(albums);
  const exact = list.filter((a) => a.exact).length;
  const falseAlbums = list.filter((a) => a.falseJoins).length;
  const falseJoins = list.reduce((s, a) => s + a.falseJoins, 0);
  const missedJoins = list.reduce((s, a) => s + a.missedJoins, 0);
  const appleJoins = list.reduce((s, a) => s + a.appleJoins, 0);
  const parts = list.reduce((s, a) => s + a.parts, 0) / (list.length || 1);
  console.log(
    `${style.padEnd(10)} exact ${exact}/${list.length} (${percent(exact, list.length)}); ` +
      `movement titles ${percent(parts, 1)}; false joins ${falseJoins} on ${falseAlbums} albums; ` +
      `missed joins ${missedJoins}/${appleJoins}`,
  );
  if (style !== onlyStyle) continue;
  for (const [id, a] of Object.entries(albums)) {
    if (a.exact) continue;
    const fixture = fixtures.find((f) => f.id === id);
    console.log(`\n${id} ${fixture.title} [${fixture.category}] false ${a.falseJoins} missed ${a.missedJoins}`);
    for (const row of a.rows) console.log(`  ${row.ours.padEnd(3)} ${String(row.apple).padEnd(3)} ${row.mark} ${row.title}  →  ${row.shown}`);
  }
}
if (jsonFile) await fs.writeFile(jsonFile, `${JSON.stringify(results, null, 1)}\n`);
