// Builds the Apple part of the test corpus from real releases. Not run by
// tests: run it by hand to add albums, then commit the files it writes.
//
//   node scripts/corpus-apple.mjs discover   search the store for albums per
//                                            category in test/corpus/apple-queries.json
//                                            and save their ids
//   node scripts/corpus-apple.mjs fetch      fetch each saved album that has no
//                                            file yet in test/corpus/apple/
//
// Each album keeps the store's track titles, numbers and lengths (what a
// downloaded file is tagged with) and Apple Music Classical's grouping:
// the composer, work and part it shows for every track. Requests are paced.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "corpus");
const listFile = path.join(root, "apple-albums.json");
const folder = path.join(root, "apple");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, { json = true } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await pause(1200 + attempt * 4000);
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (aurral-classical corpus)" } });
    if (response.ok) return json ? response.json() : response.text();
    if (response.status === 404) return null;
  }
  return null;
}

async function discover() {
  const queries = JSON.parse(await fs.readFile(path.join(root, "apple-queries.json"), "utf8"));
  const albums = [];
  const seen = new Set();
  for (const { category, terms, take = 2 } of queries) {
    const data = await get(`https://itunes.apple.com/search?term=${encodeURIComponent(terms)}&entity=album&limit=25&country=us`);
    const picks = (data?.results || [])
      .filter((album) => album.primaryGenreName === "Classical" && album.trackCount >= 2 && album.trackCount <= 200)
      .filter((album) => !seen.has(album.collectionId))
      .slice(0, take);
    for (const album of picks) {
      seen.add(album.collectionId);
      albums.push({ id: String(album.collectionId), category, title: album.collectionName, artist: album.artistName });
    }
    console.log(`${category}: ${picks.map((album) => album.collectionName).join(" | ") || "nothing"}`);
  }
  await fs.writeFile(listFile, `${JSON.stringify(albums, null, 1)}\n`);
  console.log(`Saved ${albums.length} albums`);
}

function classicalGrouping(html) {
  const match = html.match(/<script type="application\/json" id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  const sections = JSON.parse(match[1])?.data?.[0]?.data?.sections || [];
  const tracks = new Map();
  let block = 0;
  for (const section of sections) {
    if (section.itemKind !== "trackLockup") continue;
    block++;
    for (const item of section.items || []) {
      const trackId = String(item.id || "").split(" - ").at(-1);
      tracks.set(trackId, {
        block,
        composer: item.composer || section.header?.item?.firstRowText || "",
        work: item.workName || section.header?.item?.secondRowText || "",
        part: item.title || "",
        performers: item.artistName || "",
      });
    }
  }
  return tracks;
}

async function fetchAlbums() {
  const albums = JSON.parse(await fs.readFile(listFile, "utf8"));
  await fs.mkdir(folder, { recursive: true });
  for (const entry of albums) {
    const file = path.join(folder, `${entry.id}.json`);
    if (await fs.stat(file).catch(() => null)) continue;
    const lookup = await get(`https://itunes.apple.com/lookup?id=${entry.id}&entity=song&limit=200&country=us`);
    const songs = (lookup?.results || []).filter((result) => result.wrapperType === "track");
    const html = await get(`https://classical.music.apple.com/us/album/${entry.id}`, { json: false });
    const grouping = html && classicalGrouping(html);
    if (!songs.length || !grouping?.size) {
      console.log(`skip ${entry.id} ${entry.title}: ${songs.length} tracks, ${grouping?.size || 0} grouped`);
      continue;
    }
    const tracks = songs
      .map((song) => ({ song, apple: grouping.get(String(song.trackId)) }))
      .filter(({ apple }) => apple)
      .map(({ song, apple }) => ({
        disc: song.discNumber || 1,
        number: song.trackNumber,
        title: song.trackName,
        durationMs: song.trackTimeMillis || 0,
        artist: song.artistName,
        apple,
      }))
      .sort((a, b) => a.disc - b.disc || a.number - b.number);
    if (tracks.length < songs.length * 0.9) {
      console.log(`skip ${entry.id} ${entry.title}: Apple Classical shows ${tracks.length} of ${songs.length} tracks`);
      continue;
    }
    await fs.writeFile(
      file,
      `${JSON.stringify({ id: entry.id, category: entry.category, title: lookup.results[0].collectionName, artist: lookup.results[0].artistName, tracks }, null, 1)}\n`,
    );
    console.log(`saved ${entry.id} ${entry.title} (${tracks.length} tracks)`);
  }
}

const command = process.argv[2];
if (command === "discover") await discover();
else if (command === "fetch") await fetchAlbums();
else console.log("Use: discover | fetch");
