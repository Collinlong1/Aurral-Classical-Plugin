// slskd download source for classical requests. A Soulseek folder qualifies
// only if its files line up with the pinned MusicBrainz release: the same
// number of tracks per disc and every length within 2 seconds.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FAILED_STATES, isSucceeded, Slskd } from "./slskd.js";
import { readJson, writeJson } from "./store.js";
import { readTags, writeTags } from "./tags.js";
import { catalogueNumber, creditString, RELEASE_INC, releaseYear, searchWords, shortWorkTitle, surname, topWork } from "./works.js";
import { slskdSettings } from "./settings.js";

export const LENGTH_TOLERANCE_MS = 2000;
const SEARCH_BUDGET_MS = 48_000;
const SEARCH_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 50;
const SOURCE_EXTENSIONS = new Set(["flac", "mp3", "m4a", "ogg", "oga", "opus"]);
const LOSSLESS = new Set(["flac"]);

// -- the pinned release ------------------------------------------------------

export async function loadRelease(mb, releaseMbid) {
  if (!releaseMbid) return null;
  const release = await mb.get("release", releaseMbid, RELEASE_INC);
  if (!release) return null;
  const discs = (release.media || [])
    .map((medium) => ({
      position: medium.position,
      tracks: (medium.tracks || []).map((track) => ({
        position: track.position,
        number: track.number,
        title: track.title || track.recording?.title || "",
        lengthMs: track.length ?? track.recording?.length ?? null,
        recordingId: track.recording?.id ?? null,
        artist: creditString(track["artist-credit"] || track.recording?.["artist-credit"]),
      })),
    }))
    .filter((disc) => disc.tracks.length > 0);
  return {
    id: release.id,
    title: release.title,
    artist: creditString(release["artist-credit"]),
    artistCredit: release["artist-credit"] || [],
    year: releaseYear(release.date),
    releaseGroupId: release["release-group"]?.id ?? null,
    discs,
  };
}

// -- folders -----------------------------------------------------------------

const extensionOf = (filename) => (filename.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
export const remoteDir = (filename) => filename.replace(/[\\/][^\\/]*$/, "");
export const remoteBase = (filename) => filename.split(/[\\/]/).pop();
const naturalCompare = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;

// Soulseek responses grouped into folders of audio files, sorted by name.
export function groupFolders(responses) {
  const folders = new Map();
  for (const response of responses || []) {
    for (const file of response.files || []) {
      const extension = extensionOf(file.filename || "");
      if (!SOURCE_EXTENSIONS.has(extension) || file.isLocked) continue;
      const directory = remoteDir(file.filename);
      const key = `${response.username}\u0000${directory}`;
      if (!folders.has(key))
        folders.set(key, {
          username: response.username,
          directory,
          files: [],
          freeSlot: response.hasFreeUploadSlot !== false,
          queueLength: Number(response.queueLength) || 0,
          speed: Number(response.uploadSpeed) || 0,
        });
      folders.get(key).files.push({
        filename: file.filename,
        size: file.size,
        lengthMs: Number.isFinite(file.length) ? file.length * 1000 : null,
        bitRate: file.bitRate ?? null,
        extension,
      });
    }
  }
  for (const folder of folders.values()) {
    folder.files.sort((a, b) => naturalCompare(remoteBase(a.filename), remoteBase(b.filename)));
    const extensions = new Set(folder.files.map((f) => f.extension));
    folder.format = extensions.size === 1 ? [...extensions][0] : null;
  }
  return [...folders.values()];
}

// Does this folder's file list line up with these tracks, in order?
export function linesUp(files, tracks) {
  if (files.length !== tracks.length) return false;
  return files.every((file, i) => {
    const expected = tracks[i].lengthMs;
    return file.lengthMs != null && expected != null && Math.abs(file.lengthMs - expected) <= LENGTH_TOLERANCE_MS;
  });
}

// A folder can hold one disc, or the whole release with the discs in order.
// Returns the disc positions it covers, or null.
export function folderDiscs(folder, release) {
  const all = release.discs.flatMap((disc) => disc.tracks);
  if (release.discs.length > 1 && linesUp(folder.files, all)) return release.discs.map((d) => d.position);
  const disc = release.discs.find((d) => linesUp(folder.files, d.tracks));
  return disc ? [disc.position] : null;
}

const folderScore = (folder) =>
  (folder.freeSlot ? 0 : 1e9) + folder.queueLength * 1e6 + (LOSSLESS.has(folder.format) ? 0 : 1e5) - Math.min(folder.speed, 99_999);

// Where each file goes: [{ file, disc, track }].
function mapFiles(folder, release, discPositions) {
  const tracks = discPositions.flatMap((position) => {
    const disc = release.discs.find((d) => d.position === position);
    return disc.tracks.map((track) => ({ disc: position, track }));
  });
  return folder.files.map((file, i) => ({ file, ...tracks[i] }));
}

// For an album: one user's folders that together cover every disc once.
export function albumCandidates(folders, release) {
  const byUser = new Map();
  for (const folder of folders) {
    const discs = folderDiscs(folder, release);
    if (!discs) continue;
    if (!byUser.has(folder.username)) byUser.set(folder.username, []);
    byUser.get(folder.username).push({ folder, discs });
  }
  const wanted = release.discs.map((d) => d.position);
  const candidates = [];
  for (const [username, matches] of byUser) {
    matches.sort((a, b) => b.discs.length - a.discs.length || folderScore(a.folder) - folderScore(b.folder));
    const chosen = [];
    const covered = new Set();
    for (const match of matches) {
      if (match.discs.some((d) => covered.has(d))) continue;
      chosen.push(match);
      match.discs.forEach((d) => covered.add(d));
    }
    if (!wanted.every((d) => covered.has(d))) continue;
    const files = chosen.flatMap(({ folder, discs }) => mapFiles(folder, release, discs));
    const first = chosen[0].folder;
    candidates.push({ username, folders: chosen.map((c) => c.folder), files, score: Math.max(...chosen.map((c) => folderScore(c.folder))), format: first.format, bitRate: first.files[0]?.bitRate ?? null });
  }
  return candidates.sort((a, b) => a.score - b.score);
}

// For a track: each folder holding its disc, and the file at its position.
export function trackCandidates(folders, release, discPosition, trackIndexInDisc) {
  const out = [];
  for (const folder of folders) {
    const discs = folderDiscs(folder, release);
    if (!discs?.includes(discPosition)) continue;
    const mapped = mapFiles(folder, release, discs);
    const hit = mapped.find((m) => m.disc === discPosition && m.track === release.discs.find((d) => d.position === discPosition).tracks[trackIndexInDisc]);
    if (hit) out.push({ folder, ...hit, score: folderScore(folder) });
  }
  return out.sort((a, b) => a.score - b.score);
}

// -- what to search for ------------------------------------------------------

// The classical picture of a recording, or null when it isn't classical.
export async function classicalInfo(ctx, recordingId, { albumArtistIds = [], releaseGroupId = null } = {}) {
  if (!recordingId) return null;
  const fields = await ctx.resolver.resolve(recordingId, { albumArtistIds, releaseGroupId });
  if (!fields) return null;
  const movement = fields.workId ? await ctx.mb.get("work", fields.workId, "artist-rels+work-rels") : null;
  const work = movement ? await topWork(ctx.mb, movement) : null;
  const people = fields.people;
  const performer = people.conductors[0] || people.soloists[0] || people.ensembles[0] || null;
  return {
    fields,
    composer: people.composers[0] || null,
    performer,
    workTitle: work?.title || fields.work || "",
    movementTitle: fields.work || "",
  };
}

// Search texts, most specific first: composer + work + catalogue number +
// performer, then shorter ones Soulseek is likelier to match.
export function searchQueries(info, extra = []) {
  const composer = surname(info.composer);
  const performer = surname(info.performer);
  const work = shortWorkTitle(info.workTitle);
  const catalogue = catalogueNumber(info.workTitle) || catalogueNumber(info.movementTitle);
  const candidates = [
    [composer, work, catalogue, performer],
    [composer, catalogue, performer],
    [composer, work, performer],
    ...extra.map((words) => [composer, ...words]),
  ];
  const seen = new Set();
  const queries = [];
  for (const parts of candidates) {
    const query = searchWords(parts.filter(Boolean).join(" "));
    if (query.split(" ").length < 3 || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
  }
  return queries;
}

async function searchFolders(ctx, slskd, queries, accept, started) {
  const deadline = started + SEARCH_BUDGET_MS;
  let folders = [];
  for (const query of queries) {
    if (Date.now() + SEARCH_TIMEOUT_MS + 2000 > deadline) break;
    ctx.log(`Searching Soulseek for "${query}"`);
    const responses = await slskd.search(query, { searchTimeoutMs: SEARCH_TIMEOUT_MS, deadline: Math.min(deadline, Date.now() + SEARCH_TIMEOUT_MS + 6000) });
    folders = folders.concat(groupFolders(responses));
    if (accept(folders)) break;
  }
  return folders;
}

// -- the download source -----------------------------------------------------

function slskdFor(ctx) {
  const settings = slskdSettings(ctx.settings);
  if (!settings.configured) throw new Error("Set the slskd URL and API key on the plugin's page");
  return new Slskd(settings, ctx.fetch);
}

// The requested track on the release: by recording, else by disc and number.
export function locateTrack(release, track) {
  for (const disc of release.discs) {
    const index = disc.tracks.findIndex((t) => t.recordingId === track.trackMbid);
    if (index >= 0) return { discPosition: disc.position, index };
  }
  const disc = release.discs.find((d) => d.position === (track.discNumber || 1));
  const index = disc ? disc.tracks.findIndex((t) => t.position === track.trackNumber) : -1;
  return { discPosition: disc?.position ?? null, index };
}

export async function searchTrack(ctx, track) {
  const started = Date.now();
  // The release pins what a folder must look like. Aurral may clear a
  // recording ID it couldn't verify; the release's track at the requested
  // disc and position stands in for it.
  if (!track?.releaseMbid) return [];
  const release = await loadRelease(ctx.mb, track.releaseMbid);
  if (!release) return [];
  const { discPosition, index } = locateTrack(release, track);
  if (index < 0) return [];
  const recordingId = track.trackMbid || release.discs.find((d) => d.position === discPosition).tracks[index].recordingId;
  const info = await classicalInfo(ctx, recordingId, { releaseGroupId: release.releaseGroupId });
  if (!info) return [];
  const slskd = slskdFor(ctx);
  const queries = searchQueries(info, [[searchWords(release.title)]]);
  const folders = await searchFolders(ctx, slskd, queries, (found) => trackCandidates(found, release, discPosition, index).length >= 3, started);
  const target = release.discs.find((d) => d.position === discPosition).tracks[index];
  const seen = new Set();
  return trackCandidates(folders, release, discPosition, index)
    .filter((c) => !seen.has(`${c.folder.username}\u0000${c.file.filename}`) && seen.add(`${c.folder.username}\u0000${c.file.filename}`))
    .slice(0, MAX_RESULTS)
    .map((c) => ({
      id: `${c.folder.username}:${c.file.filename}`.slice(0, 500),
      title: track.title || target.title,
      artist: track.artist || release.artist,
      album: track.album || release.title,
      durationMs: c.file.lengthMs,
      format: c.file.extension,
      bitrate: c.file.bitRate,
      data: {
        username: c.folder.username,
        files: [{ filename: c.file.filename, size: c.file.size, title: target.title, artist: target.artist, recordingId: target.recordingId, lengthMs: target.lengthMs }],
      },
    }));
}

export async function searchAlbum(ctx, album) {
  const started = Date.now();
  if (!album?.releaseMbid) return [];
  const release = await loadRelease(ctx.mb, album.releaseMbid);
  if (!release) return [];
  const firstTracks = release.discs.flatMap((d) => d.tracks).slice(0, 3);
  let info = null;
  const albumArtistIds = release.artistCredit.map((c) => c.artist?.id).filter(Boolean);
  for (const t of firstTracks) {
    info = await classicalInfo(ctx, t.recordingId, { albumArtistIds, releaseGroupId: release.releaseGroupId });
    if (info) break;
  }
  if (!info) return [];
  const slskd = slskdFor(ctx);
  const queries = searchQueries(info, [[searchWords(release.title)]]);
  const folders = await searchFolders(ctx, slskd, queries, (found) => albumCandidates(found, release).length >= 3, started);
  return albumCandidates(folders, release)
    .slice(0, MAX_RESULTS)
    .map((c) => ({
      id: `${c.username}:${c.folders.map((f) => f.directory).join("|")}`.slice(0, 500),
      title: album.title || release.title,
      artist: album.artist || release.artist,
      year: release.year,
      trackCount: c.files.length,
      format: c.format,
      bitrate: c.bitRate,
      data: {
        username: c.username,
        files: c.files.map((m) => ({
          filename: m.file.filename,
          size: m.file.size,
          disc: m.disc,
          title: m.track.title,
          artist: m.track.artist,
          recordingId: m.track.recordingId,
          lengthMs: m.track.lengthMs,
        })),
      },
    }));
}

const downloadsDir = (ctx) => path.join(ctx.dataFolder, "downloads");

export async function startDownload(ctx, result, kind) {
  const data = result?.data;
  if (!data?.username || !Array.isArray(data.files) || !data.files.length) throw new Error("The result has no files to download");
  const { downloadFolder } = slskdSettings(ctx.settings);
  if (!downloadFolder) throw new Error("Set slskd's download folder on the plugin's page");
  const slskd = slskdFor(ctx);
  await slskd.enqueue(data.username, data.files.map((f) => ({ filename: f.filename, size: f.size })));
  const id = randomUUID();
  await writeJson(path.join(downloadsDir(ctx), `${id}.json`), { kind, username: data.username, files: data.files, startedAt: Date.now() });
  return { pending: id };
}

// Finds a finished download in slskd's folder: <folder>/<remote folder>/<file>,
// or anywhere below it with the same name and size.
async function locate(downloadFolder, file) {
  const base = remoteBase(file.filename);
  const direct = path.join(downloadFolder, remoteBase(remoteDir(file.filename)), base);
  const stat = await fs.stat(direct).catch(() => null);
  if (stat?.isFile()) return direct;
  let seen = 0;
  const walk = async (dir, depth) => {
    if (depth > 4) return null;
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (++seen > 50_000) return null;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(full, depth + 1);
        if (found) return found;
      } else if (entry.isFile() && (entry.name === base || entry.name.replace(/_\d{15,}(?=\.[^.]+$)/, "") === base)) {
        const s = await fs.stat(full).catch(() => null);
        if (s && (!file.size || s.size === file.size)) return full;
      }
    }
    return null;
  };
  return walk(downloadFolder, 0);
}

export async function downloadStatus(ctx, id, directory) {
  const record = await readJson(path.join(downloadsDir(ctx), `${id}.json`), null);
  if (!record) throw new Error("This download is unknown to the plugin");
  const slskd = slskdFor(ctx);
  const transfers = await slskd.downloads(record.username);
  const states = record.files.map((file) => {
    const matches = transfers.filter((t) => t.filename === file.filename);
    const latest = matches.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))[0];
    return latest?.state || "";
  });
  const failed = states.find((state) => FAILED_STATES.test(state));
  if (failed) throw new Error(`slskd: ${remoteBase(record.files[states.indexOf(failed)].filename)} ${failed.replace(/^Completed,\s*/, "").toLowerCase()}`);
  if (!states.every(isSucceeded)) return { done: false };

  const { downloadFolder } = slskdSettings(ctx.settings);
  const copied = [];
  for (const [i, file] of record.files.entries()) {
    const local = await locate(downloadFolder, file);
    if (!local) throw new Error(`Couldn't find ${remoteBase(file.filename)} in slskd's download folder`);
    const name = `${String(file.disc || 1).padStart(2, "0")}-${String(i + 1).padStart(3, "0")} ${remoteBase(file.filename)}`.replace(/[\\/]/g, "_");
    const target = path.join(directory, record.kind === "album" ? name : remoteBase(file.filename));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(local, target);
    copied.push({ target, file });
  }
  // Tag the files we can vouch for: their length still matches the release.
  let tagged = 0;
  for (const { target, file } of copied) {
    let identified = false;
    try {
      const { durationMs } = readTags(target);
      identified = Boolean(file.recordingId) && file.lengthMs != null && durationMs > 0 && Math.abs(durationMs - file.lengthMs) <= LENGTH_TOLERANCE_MS;
    } catch {
      identified = false;
    }
    if (!identified) continue;
    try {
      await writeTags(target, { title: [file.title], artist: [file.artist].filter(Boolean), recordingMbid: [file.recordingId] });
      tagged++;
    } catch (error) {
      ctx.log(`Couldn't tag ${path.basename(target)}: ${error.message}`);
    }
  }
  ctx.log(`Download ${id}: ${copied.length} file(s) copied, ${tagged} identified and tagged`);
  await fs.rm(path.join(downloadsDir(ctx), `${id}.json`), { force: true });
  return record.kind === "album" ? { done: true } : { done: true, path: path.basename(copied[0].target) };
}
