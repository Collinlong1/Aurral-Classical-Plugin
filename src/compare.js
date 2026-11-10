import { UserOperations } from "./user-operations.js";
import { readTags, readValues } from "./tags.js";
import { writeJson } from "./store.js";
import path from "node:path";

export const playlistName = (composer, work) => `Recordings: ${composer}: ${work}`.slice(0, 200);

// Explicit work IDs are evidence; titles alone never join performances.
async function evidence(ctx, track) {
  let tags = null;
  if (track.path) {
    tags = readTags(track.path);
    const workIds = [...new Set(readValues(track.path, ["workId"]).workId)];
    if (workIds.length > 1) return { ambiguous: true };
    if (workIds.length === 1) return {
      workId: workIds[0], work: tags.work || workIds[0],
      composer: tags.composer.join("; ") || "Unknown composer",
      recordingId: tags.recordingMbid || track.mbid || null,
    };
  }
  const recordingId = tags?.recordingMbid || track.mbid;
  const fields = recordingId ? await ctx.resolver.resolve(recordingId) : null;
  return fields?.workId ? { workId: fields.workId, work: fields.work, composer: fields.composers[0], recordingId } : null;
}

export async function compareRecordings(ctx, user, selected) {
  const api = new UserOperations(ctx.userOperations, ctx.fetch);
  const library = await api.library();
  const movements = new Map();
  for (const track of selected) {
    const indexed = library.tracks.find((entry) => entry.id === track.id);
    const file = indexed?.files.find((entry) => entry.available && entry.path === track.path) || indexed?.files.find((entry) => entry.available);
    const info = await evidence(ctx, { ...track, path: file?.readPath || track.path });
    if (info?.ambiguous) throw new Error("Selected track has multiple work IDs; resolve its identity before comparing");
    if (info) movements.set(info.workId, info);
  }
  if (!movements.size) throw new Error("No explicit Work identity was found; title matching is not sufficient");
  const groups = new Map([...movements.keys()].map((id) => [id, new Map()]));
  let ambiguous = 0;
  for (const track of library.tracks) {
    for (const file of track.files.filter((f) => f.available && f.source !== "flow")) {
      const info = await evidence(ctx, { ...track, path: file.readPath || file.path });
      if (info?.ambiguous) { ambiguous++; continue; }
      const group = info && groups.get(info.workId);
      if (!group) continue;
      const key = info.recordingId ? `${info.recordingId}:${file.durationMs ?? track.durationMs ?? "unknown"}` : `file:${file.id ?? file.path}`;
      const current = group.get(key);
      if (current) { current.releases.push({ albumId: file.albumId, path: file.path }); continue; }
      group.set(key, {
        path: file.path, artist: track.artistName || info.composer, title: track.title,
        recordingId: info.recordingId, releases: [{ albumId: file.albumId, path: file.path }],
      });
    }
  }
  const lines = [];
  const diagnostics = [];
  for (const [id, info] of movements) {
    const items = [...groups.get(id).values()].sort((a,b) => Number(b.recordingId === info.recordingId) - Number(a.recordingId === info.recordingId));
    if (!items.length) throw new Error(`No owned recordings found for ${info.work}`);
    const playlistId = await api.playlist(`work:${id}`, playlistName(info.composer, info.work), items);
    diagnostics.push({ workId: id, playlistId, recordings: items });
    lines.push(`Completed "${playlistName(info.composer, info.work)}": ${items.length} owned recordings`);
  }
  await writeJson(path.join(ctx.dataFolder, `comparison-${user.id}.json`), { version: 1, ambiguous, comparisons: diagnostics });
  if (ambiguous) lines.push(`${ambiguous} files have ambiguous work IDs and need review`);
  return summarize(lines);
}

export function pickRelease(releases) {
  return [...(releases || [])].sort((a,b) => Number(b.status === "Official") - Number(a.status === "Official") || String(a.date || "9999").localeCompare(String(b.date || "9999")))[0];
}

export function summarize(lines) {
  let message = lines[0] || "No comparisons";
  for (const [index, line] of lines.entries()) {
    if (!index) continue;
    if (`${message}. ${line}`.length > 480) { message += `. And ${lines.length - index} more`; break; }
    message += `. ${line}`;
  }
  return message.length > 500 ? `${message.slice(0,497)}...` : message;
}
