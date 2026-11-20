// Album page headings: consecutive tracks of one work, from the works the
// tagger kept when it planned or tagged them, by the path Aurral gives. No
// disk access per track: Aurral waits on this while the page loads.
import fs from "node:fs/promises";
import path from "node:path";
import { readWorks } from "./tagger.js";
import { movementTitle } from "./titles.js";

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
  const add = (group, track, entry) => {
    group.trackIds.push(track.id);
    group.titles.push(movementTitle({ title: track.title || "", work: entry?.movement || "" }, group.title) || track.title || "");
  };
  for (const track of album?.tracks || []) {
    if (!track.path) {
      if (current) gap.push(track);
      continue;
    }
    const entry = known[track.path];
    if (!entry?.work?.id) {
      current = null;
      gap = [];
      continue;
    }
    if (current?.workId === entry.work.id) {
      for (const missing of gap) add(current, missing, null);
      add(current, track, entry);
      gap = [];
      continue;
    }
    gap = [];
    current = {
      workId: entry.work.id,
      title: entry.work.title || "Untitled work",
      ...(entry.composer && { subtitle: entry.composer }),
      trackIds: [],
      titles: [],
    };
    add(current, track, entry);
    groups.push(current);
  }
  if (!groups.length) return null;
  return { label: "By work", groups: groups.map(({ workId, ...group }) => group) };
}
