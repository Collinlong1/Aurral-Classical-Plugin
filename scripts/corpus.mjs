// Prints every corpus album as the By work view lays it out.
//   node scripts/corpus.mjs                 print all albums
//   node scripts/corpus.mjs <album id>      print one album
//   node scripts/corpus.mjs --audio <dir>   also write silent, tagged FLAC
//                                           files with real lengths (ffmpeg)
//   node scripts/corpus.mjs --apple         score the real releases in
//                                           test/corpus/apple against Apple Music
//                                           Classical; --update-baseline saves it
//   node scripts/corpus.mjs --nonclassical  run the ordinary-music corpus in
//                                           test/corpus/nonclassical through the
//                                           scan, pins and rescans; --markdown
//                                           prints the full tables,
//                                           --update-baseline saves it (written
//                                           explanations are kept)
//   node scripts/corpus.mjs --serve-musicbrainz <port>
//                                           answer MusicBrainz lookups from the
//                                           corpus; set the plugin's MusicBrainz
//                                           mirror to http://localhost:<port>
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { albums } from "../test/corpus/albums.js";
import { runCorpus, layout } from "../test/corpus/run.js";
import { appleFixtures, baselineFile, scoreApple, summary, toAlbum } from "../test/corpus/apple.js";
import * as nonclassical from "../test/corpus/nonclassical.js";

const args = process.argv.slice(2);
const audioAt = args.indexOf("--audio");
const audio = audioAt >= 0 ? path.resolve(args.splice(audioAt, 2)[1] || "") : null;
const serveAt = args.indexOf("--serve-musicbrainz");
const servePort = serveAt >= 0 ? Number(args.splice(serveAt, 2)[1]) : null;
const flag = (name) => (args.includes(name) ? (args.splice(args.indexOf(name), 1), true) : false);
const apple = flag("--apple");
const updateBaseline = flag("--update-baseline");
const ordinary = flag("--nonclassical");
const asMarkdown = flag("--markdown");
const chosen = args.length ? albums.filter((album) => args.includes(album.id)) : albums;

if (ordinary) {
  const results = await nonclassical.runNonclassical();
  console.log(asMarkdown ? nonclassical.markdown(results) : nonclassical.summary(results).join("\n"));
  if (updateBaseline) {
    let previous = {};
    try {
      previous = JSON.parse(await fs.readFile(nonclassical.baselineFile, "utf8"));
    } catch {}
    const saved = nonclassical.toBaseline(results, previous);
    await fs.writeFile(nonclassical.baselineFile, `${JSON.stringify(saved, null, 1)}\n`);
    const todo = Object.entries(saved.explanations).filter(([, text]) => text.startsWith("TODO"));
    console.log(`Saved ${nonclassical.baselineFile}${todo.length ? `; ${todo.length} failures need an explanation` : ""}`);
  }
} else if (apple) {
  const fixtures = appleFixtures().filter((fixture) => !args.length || args.includes(fixture.id));
  const results = await scoreApple(fixtures);
  // One album's layout per style, to see what a score means.
  if (args.length)
    for (const style of Object.keys(results)) {
      const shown = fixtures.map((fixture) => toAlbum(fixture, style));
      const presentations = await runCorpus(shown);
      for (const album of shown) console.log(`[${style}] ${layout(album, presentations.get(album.id))}\n`);
    }
  for (const [style, scores] of Object.entries(results)) {
    const misses = fixtures.filter((fixture) => !scores[fixture.id].grouping);
    if (!args.length && misses.length)
      console.log(`${style} blocks differ: ${misses.map((fixture) => `${fixture.id} ${fixture.title}`).join("\n  ")}\n`);
  }
  console.log(summary(results).join("\n"));
  if (updateBaseline) {
    await fs.writeFile(baselineFile, `${JSON.stringify(results, null, 1)}\n`);
    console.log(`Saved ${baselineFile}`);
  }
} else {
  const results = await runCorpus(chosen);
  for (const album of chosen) console.log(`${layout(album, results.get(album.id))}\n`);
}

if (audio) {
  for (const album of chosen) {
    const folder = path.join(audio, album.artist.replace(/[\\/:*?"<>|]/g, "_"), album.title.replace(/[\\/:*?"<>|]/g, "_"));
    await fs.mkdir(folder, { recursive: true });
    for (const track of album.tracks) {
      const file = path.join(folder, `${track.disc}-${String(track.number).padStart(2, "0")}.flac`);
      const tags = {
        title: track.title,
        artist: track.artist,
        album_artist: album.artist,
        album: album.title,
        composer: track.composer.join("; "),
        genre: track.genres.join("; "),
        track: String(track.number),
        disc: String(track.disc),
        work: track.work,
        MUSICBRAINZ_TRACKID: track.recordingMbid,
      };
      // Mono 8 kHz silence compresses to a few kilobytes at any length.
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono",
        "-t", String(track.durationMs / 1000),
        "-c:a", "flac",
        ...Object.entries(tags).filter(([, value]) => value).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
        file,
      ]);
    }
  }
  console.log(`Wrote audio for ${chosen.length} albums to ${audio}`);
}

// MusicBrainz's JSON for the corpus: recordings point at their movement,
// movements at their work, and works credit the album's composer.
function musicbrainzRecords() {
  const records = new Map();
  for (const album of albums) {
    const mb = album.musicbrainz || {};
    for (const [recording, work] of Object.entries(mb.recordings || {})) {
      const track = album.tracks.find((entry) => entry.recordingMbid === recording);
      records.set(`recording/${recording}`, {
        id: recording,
        title: track?.title || recording,
        "artist-credit": [{ name: album.artist, artist: { id: `artist-${album.id}`, name: album.artist } }],
        genres: [{ name: "classical", count: 5 }],
        relations: [{ type: "performance", "target-type": "work", direction: "forward", work: { id: work, title: mb.works?.[work]?.title } }],
      });
    }
    const composer = album.tracks[0]?.composer[0] || "";
    for (const [id, work] of Object.entries(mb.works || {})) {
      records.set(`work/${id}`, {
        id,
        title: work.title,
        aliases: work.aliases || [],
        relations: [
          ...(composer ? [{ type: "composer", "target-type": "artist", direction: "backward", artist: { id: `composer-${composer}`, name: composer, "sort-name": composer } }] : []),
          ...(work.parent ? [{ type: "parts", "target-type": "work", direction: "backward", work: { id: work.parent } }] : []),
        ],
      });
      if (composer)
        records.set(`artist/composer-${composer}`, { id: `composer-${composer}`, name: composer, "sort-name": composer, type: "Person", aliases: [], genres: [{ name: "classical", count: 5 }] });
    }
  }
  return records;
}

if (servePort) {
  const records = musicbrainzRecords();
  http
    .createServer((request, response) => {
      const [, entity, id] = new URL(request.url, "http://mb").pathname.match(/^\/ws\/2\/([a-z-]+)\/([^/]+)$/) || [];
      const record = records.get(`${entity}/${id}`);
      response.writeHead(record ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(record || { error: "Not Found" }));
    })
    .listen(servePort, () => console.log(`Fake MusicBrainz on http://localhost:${servePort}`));
}
