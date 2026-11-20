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
  // Every track of a work under one heading, wherever it sits on the album
  // (files from different editions number a work's movements apart).
  const byWork = new Map();
  let previous = null;
  // Tracks with no file yet (still downloading, or missing) between two
  // tracks of one work stay with it.
  let gap = [];
  const add = (group, track, entry) => {
    group.trackIds.push(track.id);
    group.titles.push(movementTitle({ title: track.title || "", work: entry?.movement || "" }, group.title) || track.title || "");
  };
  for (const track of album?.tracks || []) {
    if (!track.path) {
      if (previous) gap.push(track);
      continue;
    }
    const entry = known[track.path];
    if (!entry?.work?.id) {
      previous = null;
      gap = [];
      continue;
    }
    let group = byWork.get(entry.work.id);
    if (!group) {
      group = {
        title: entry.work.title || "Untitled work",
        ...(entry.composer && { subtitle: entry.composer }),
        trackIds: [],
        titles: [],
      };
      byWork.set(entry.work.id, group);
    }
    if (previous === entry.work.id) for (const missing of gap) add(group, missing, null);
    gap = [];
    add(group, track, entry);
    previous = entry.work.id;
  }
  if (!byWork.size) return null;
  return { label: "By work", groups: [...byWork.values()] };
}
