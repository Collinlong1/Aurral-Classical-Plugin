// "Compare recordings": a static playlist with the same movement from up to N
// recordings, Library copies first. Aurral queues downloads for the rest.
import { Aurral, canRequest } from "./aurral.js";
import { compareCount } from "./settings.js";
import { libraryIndex } from "./tagger.js";
import { readTags } from "./tags.js";
import { creditString, releaseYear } from "./works.js";

const MAX_PLAYLISTS = 10;
const SKIPPED_PERFORMANCE = new Set(["partial", "medley"]);

export const playlistName = (composer, work) => `Recordings: ${composer}: ${work}`.slice(0, 200);

function recordingIdOf(track) {
  if (track.mbid) return track.mbid;
  if (!track.path) return null;
  try {
    return readTags(track.path).recordingMbid || null;
  } catch {
    return null;
  }
}

// Best release for a recording: official first, then the earliest.
export function pickRelease(releases) {
  const rank = (r) => [r.status === "Official" ? 0 : 1, r.date ? r.date : "9999"];
  return [...(releases || [])].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1].localeCompare(y[1]);
  })[0];
}

async function downloadTrack(ctx, recordingId) {
  const data = await ctx.mb.get("recording", recordingId, "releases+release-groups+media+artist-credits");
  const release = pickRelease(data?.releases);
  if (!data || !release) return null;
  let medium = null;
  let track = null;
  for (const m of release.media || []) {
    track = (m.tracks || m.track || []).find((t) => t.id && t.position) || null;
    if (track) {
      medium = m;
      break;
    }
  }
  const credit = release["artist-credit"]?.length ? release["artist-credit"] : data["artist-credit"];
  return {
    artist: creditString(credit) || creditString(data["artist-credit"]),
    artistMbid: credit?.[0]?.artist?.id ?? null,
    title: track?.title || data.title,
    album: release.title,
    albumMbid: release["release-group"]?.id ?? null,
    releaseMbid: release.id,
    trackMbid: recordingId,
    durationMs: track?.length ?? data.length ?? null,
    trackNumber: track?.position ?? null,
    discNumber: medium?.position ?? null,
    releaseYear: releaseYear(release.date),
  };
}

function libraryTrack(path, entry) {
  return {
    artist: entry.albumArtist || entry.artist,
    title: entry.title,
    album: entry.album || null,
    albumMbid: entry.releaseGroupMbid || null,
    releaseMbid: entry.releaseMbid || null,
    trackMbid: entry.recordingMbid,
    durationMs: entry.durationMs || null,
    trackNumber: entry.trackNumber || null,
    discNumber: entry.discNumber || null,
    path,
  };
}

// One movement's playlist. Returns a line for the summary.
async function compareMovement(ctx, aurral, playlists, movement, index) {
  const work = await ctx.mb.get("work", movement.workId, "recording-rels");
  const recordings = [];
  for (const rel of work?.relations || []) {
    if (rel["target-type"] !== "recording" || rel.type !== "performance" || !rel.recording?.id) continue;
    if ((rel.attributes || []).some((a) => SKIPPED_PERFORMANCE.has(String(a).toLowerCase()))) continue;
    if (!recordings.includes(rel.recording.id)) recordings.push(rel.recording.id);
  }
  if (!recordings.includes(movement.recordingId)) recordings.unshift(movement.recordingId);

  const n = compareCount(ctx.settings);
  const inLibrary = new Map();
  for (const [file, entry] of Object.entries(index)) {
    if (entry.recordingMbid && recordings.includes(entry.recordingMbid) && !inLibrary.has(entry.recordingMbid))
      inLibrary.set(entry.recordingMbid, libraryTrack(file, entry));
  }
  // The chosen recording first, then the rest of the Library, then others.
  const ordered = [
    movement.recordingId,
    ...recordings.filter((id) => inLibrary.has(id) && id !== movement.recordingId),
    ...recordings.filter((id) => !inLibrary.has(id) && id !== movement.recordingId),
  ];
  const tracks = [];
  let fromLibrary = 0;
  for (const id of ordered) {
    if (tracks.length >= n) break;
    if (inLibrary.has(id)) {
      tracks.push(inLibrary.get(id));
      fromLibrary++;
      continue;
    }
    const track = await downloadTrack(ctx, id);
    if (track?.artist && track.title) tracks.push(track);
  }
  const name = playlistName(movement.composer, movement.work);
  const existing = playlists.find((p) => p.name === name);
  if (existing) await aurral.updatePlaylist(existing.id, name, tracks);
  else await aurral.createPlaylist(name, tracks);
  const queued = tracks.length - fromLibrary;
  return `${existing ? "Updated" : "Created"} "${name}": ${tracks.length} recordings, ${fromLibrary} in the Library${queued ? `, ${queued} to download` : ""}`;
}

export async function compareRecordings(ctx, user, tracks) {
  const aurral = new Aurral(ctx.api, ctx.fetch);
  if (!(await canRequest(aurral, user))) throw new Error("Only admins and people who can request music can compare recordings");
  // The movements to compare, one per Work.
  const movements = [];
  let notClassical = 0;
  for (const track of tracks) {
    const recordingId = recordingIdOf(track);
    const fields = recordingId ? await ctx.resolver.resolve(recordingId) : null;
    if (!fields?.workId) {
      notClassical++;
      continue;
    }
    if (movements.some((m) => m.workId === fields.workId)) continue;
    movements.push({ recordingId, workId: fields.workId, work: fields.work, composer: fields.composers[0] });
  }
  if (!movements.length)
    throw new Error(
      notClassical === 1 ? "This track has no Work with a composer on MusicBrainz" : "None of these tracks has a Work with a composer on MusicBrainz",
    );
  const index = await libraryIndex(ctx, 60_000);
  const playlists = await aurral.staticPlaylists();
  const lines = [];
  for (const movement of movements.slice(0, MAX_PLAYLISTS)) {
    lines.push(await compareMovement(ctx, aurral, playlists, movement, index));
  }
  if (movements.length > MAX_PLAYLISTS) lines.push(`${movements.length - MAX_PLAYLISTS} more movements left out`);
  return summarize(lines);
}

// Action messages are capped at 500 characters.
export function summarize(lines) {
  let message = lines[0];
  for (const line of lines.slice(1)) {
    if (`${message}. ${line}`.length > 480) {
      message += `. And ${lines.length - lines.indexOf(line)} more`;
      break;
    }
    message += `. ${line}`;
  }
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}
