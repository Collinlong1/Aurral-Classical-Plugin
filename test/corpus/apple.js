// Real releases with Apple Music Classical's grouping as the answer key.
// Each album runs in three tag styles, each in its own library, and is
// scored on two things: whether its tracks fall into the same blocks as
// Apple's (composer + work, in album order), and how many rows read the
// same as Apple's part titles.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCorpus, trackId } from "./run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const baselineFile = path.join(here, "apple-baseline.json");

export function appleFixtures() {
  const folder = path.join(here, "apple");
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")));
}

const withoutNickname = (work) => work.replace(/\s+·\s+.*$/, "");

// The ways a library's files are commonly tagged.
export const styles = {
  // A store download: "Work: Part" titles, a composer tag, the performer.
  store: (track) => ({ title: track.title, composer: [track.apple.composer], artist: track.artist, genres: ["Classical"], work: "" }),
  // iTunes "Use work & movement": the part as title, the work in WORK.
  "work-tags": (track) => ({ title: track.apple.part, composer: [track.apple.composer], artist: track.artist, genres: ["Classical"], work: withoutNickname(track.apple.work) }),
  // A careless rip: dashes for colons, no composer tag or genre, and the
  // composer folded into the artist.
  messy: (track) => ({ title: track.title.replace(/:\s+/, " - "), composer: [], artist: `${track.apple.composer}; ${track.artist}`, genres: [], work: "" }),
};

export function toAlbum(fixture, style) {
  return {
    id: `${style}-${fixture.id}`,
    appleId: fixture.id,
    title: fixture.title,
    artist: fixture.artist,
    kind: fixture.category,
    tracks: fixture.tracks.map((track) => ({
      disc: track.disc,
      number: track.number,
      durationMs: track.durationMs,
      recordingMbid: "",
      apple: track.apple,
      ...styles[style](track),
    })),
  };
}

const words = (value) =>
  String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Score one album: the blocks as Aurral shows them against Apple's.
export function score(album, presentation) {
  const ordered = [...album.tracks].sort((a, b) => a.disc - b.disc || a.number - b.number);
  const blockOf = new Map();
  const rowTitle = new Map();
  for (const group of presentation?.groups || [])
    for (const item of group.items) {
      blockOf.set(item.trackId, group.id);
      rowTitle.set(item.trackId, item.title);
    }
  const ours = [];
  const apple = [];
  let parts = 0;
  ordered.forEach((track, index) => {
    const id = trackId(album, track);
    const previous = ordered[index - 1];
    ours.push(!previous || !blockOf.has(id) || blockOf.get(id) !== blockOf.get(trackId(album, previous)));
    apple.push(!previous || track.apple.block !== previous.apple.block);
    if (words(rowTitle.get(id) ?? track.title) === words(track.apple.part)) parts++;
  });
  return {
    grouping: ours.every((start, index) => start === apple[index]),
    parts: ordered.length ? Math.round((parts / ordered.length) * 1000) / 1000 : 1,
  };
}

// Pair-by-pair comparison of one album's blocks with Apple's, for audits and
// the false-join gate. A false join is two adjacent tracks we put in one
// block that Apple shows apart: an incorrect automatic match.
export function auditAlbum(album, presentation) {
  const ordered = [...album.tracks].sort((a, b) => a.disc - b.disc || a.number - b.number);
  const blockOf = new Map();
  const rowTitle = new Map();
  const groupTitle = new Map();
  for (const group of presentation?.groups || [])
    for (const item of group.items) {
      blockOf.set(item.trackId, group.id);
      rowTitle.set(item.trackId, item.title);
      groupTitle.set(item.trackId, group.title);
    }
  let falseJoins = 0;
  let missedJoins = 0;
  let appleJoins = 0;
  const label = new Map();
  const rows = ordered.map((track, index) => {
    const id = trackId(album, track);
    const previous = ordered[index - 1];
    const ours = previous && blockOf.has(id) && blockOf.get(id) === blockOf.get(trackId(album, previous));
    const apple = previous && track.apple.block === previous.apple.block;
    if (apple) appleJoins++;
    if (ours && !apple) falseJoins++;
    if (apple && !ours) missedJoins++;
    if (blockOf.has(id) && !label.has(blockOf.get(id))) label.set(blockOf.get(id), `w${label.size + 1}`);
    return {
      ours: blockOf.has(id) ? label.get(blockOf.get(id)) : "-",
      apple: track.apple.block,
      mark: ours && !apple ? "FALSE" : apple && !ours ? "miss " : "     ",
      title: track.title,
      shown: blockOf.has(id) ? `${groupTitle.get(id)} | ${rowTitle.get(id)}` : "(single)",
    };
  });
  const { parts } = score(album, presentation);
  return { exact: !falseJoins && !missedJoins, falseJoins, missedJoins, appleJoins, parts, rows };
}

// Every style's results: { style: { appleId: { grouping, parts, falseJoins } } }.
export async function scoreApple(fixtures = appleFixtures()) {
  const results = {};
  for (const style of Object.keys(styles)) {
    const albums = fixtures.map((fixture) => toAlbum(fixture, style));
    const presentations = await runCorpus(albums);
    results[style] = Object.fromEntries(
      albums.map((album) => {
        const presentation = presentations.get(album.id);
        return [album.appleId, { ...score(album, presentation), falseJoins: auditAlbum(album, presentation).falseJoins }];
      }),
    );
  }
  return results;
}

export function summary(results) {
  return Object.entries(results).map(([style, albums]) => {
    const scores = Object.values(albums);
    const grouped = scores.filter((entry) => entry.grouping).length;
    const parts = scores.reduce((sum, entry) => sum + entry.parts, 0) / (scores.length || 1);
    const falseJoins = scores.reduce((sum, entry) => sum + (entry.falseJoins || 0), 0);
    return `${style.padEnd(10)} blocks match Apple on ${grouped}/${scores.length} albums; rows read like Apple's ${Math.round(parts * 100)}%; false joins ${falseJoins}`;
  });
}
