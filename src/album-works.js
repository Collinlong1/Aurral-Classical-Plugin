// Album page headings: consecutive tracks of one work, from the works the
// tagger kept when it planned or tagged them. Answers from the data folder
// only, since Aurral waits on it while the page loads.
import fs from "node:fs/promises";
import path from "node:path";
import { readWorks } from "./tagger.js";

const cached = new Map();

async function works(ctx) {
  const file = path.join(ctx.dataFolder, "works.json");
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return {};
  const hit = cached.get(file);
  if (hit?.mtimeMs === stat.mtimeMs) return hit.works;
  const value = await readWorks(ctx);
  cached.set(file, { mtimeMs: stat.mtimeMs, works: value });
  return value;
}

export async function albumPresentation(ctx, album) {
  const known = await works(ctx);
  const groups = [];
  let current = null;
  // Tracks with no file yet (still downloading, or missing) between two
  // tracks of one work stay under its heading.
  let gap = [];
  for (const track of album?.tracks || []) {
    if (!track.path) {
      if (current) gap.push(track.id);
      continue;
    }
    const real = await fs.realpath(track.path).catch(() => track.path);
    const entry = known[real];
    if (!entry?.work?.id) {
      current = null;
      gap = [];
      continue;
    }
    if (current?.workId === entry.work.id) {
      current.trackIds.push(...gap, track.id);
      gap = [];
      continue;
    }
    gap = [];
    current = {
      workId: entry.work.id,
      title: entry.work.title || "Untitled work",
      ...(entry.composer && { subtitle: entry.composer }),
      ...(entry.performers && { detail: entry.performers }),
      trackIds: [track.id],
    };
    groups.push(current);
  }
  if (!groups.length) return null;
  return { label: "By work", groups: groups.map(({ workId, ...group }) => group) };
}
