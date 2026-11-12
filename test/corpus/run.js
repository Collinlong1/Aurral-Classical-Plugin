// Runs corpus albums through the same steps a library goes through: a scan
// (reconcile, classify, automatic work pass), then the admin's "Auto-match
// classical works" on each album with MusicBrainz answering from the corpus.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openCatalogue } from "../../src/model/catalogue.js";
import { reconcile, classify } from "../../src/model/reconcile.js";
import { autoMatchTaggedWorks } from "../../src/model/auto-match.js";
import { autoMatchWorks } from "../../src/model/runtime.js";
import { renderAlbumPresentation } from "../../src/model/presentation.js";

export const trackId = (album, track) => `${album.id}-${track.disc}-${track.number}`;

function snapshot(albums) {
  return {
    version: 1,
    complete: true,
    instanceId: "corpus",
    epoch: "first",
    generation: 1,
    tracks: albums.flatMap((album) =>
      album.tracks.map((track) => ({
        coreId: trackId(album, track),
        fileId: `file-${trackId(album, track)}`,
        albumId: album.id,
        path: `/library/${album.id}/${track.disc}-${String(track.number).padStart(2, "0")}.flac`,
        size: 4096,
        durationMs: track.durationMs,
        fingerprint: `corpus:${trackId(album, track)}`,
        hints: {
          title: track.title,
          album: album.title,
          artist: track.artist,
          albumArtist: album.artist,
          composer: track.composer,
          trackNumber: track.number,
          discNumber: track.disc,
          genres: track.genres,
          work: track.work,
          workId: "",
          recordingMbid: track.recordingMbid,
          composerDistinct:
            track.composer.length > 0 && !track.composer.includes(track.artist),
        },
      })),
    ),
  };
}

// MusicBrainz as the matcher sees it, answered from every album's data.
function musicbrainz(albums) {
  const recordings = {};
  const works = {};
  for (const album of albums) {
    Object.assign(recordings, album.musicbrainz?.recordings);
    Object.assign(works, album.musicbrainz?.works);
  }
  const composersOf = new Map(
    albums.flatMap((album) =>
      album.tracks.map((track) => [track.recordingMbid, track.composer]),
    ),
  );
  return {
    resolver: {
      resolve: async (id) =>
        recordings[id]
          ? { workId: recordings[id], composers: composersOf.get(id) || [] }
          : null,
    },
    mb: {
      get: async (kind, id) => {
        const work = kind === "work" && works[id];
        if (!work) return null;
        return {
          id,
          title: work.title,
          aliases: work.aliases || [],
          relations: work.parent
            ? [{ type: "parts", direction: "backward", work: { id: work.parent } }]
            : [],
        };
      },
    },
  };
}

// Returns each album's presentation, keyed by album id.
// `heldBack` track ids stay out of the first pass, as tracks an older
// matcher left out of their works; a second pass then lets them in.
export async function runCorpus(albums, { heldBack = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aurral-classical-corpus-"));
  try {
    const dataFolder = path.join(root, "data");
    const c = await openCatalogue(path.join(dataFolder, "model"));
    try {
      const links = reconcile(c, snapshot(albums));
      for (const link of links)
        classify(c, link.id, link.hints, heldBack.includes(link.coreId) ? { manual: "unsure", actor: "corpus" } : {});
      autoMatchTaggedWorks(c, { actor: "model-scan" });
    } finally {
      c.close();
    }
    const ctx = { dataFolder, libraryFolder: root, log: () => {}, ...musicbrainz(albums) };
    const matchAll = async () => {
      for (const album of albums) await autoMatchWorks(ctx, { id: 1, role: "admin" }, album.id);
    };
    await matchAll();
    if (heldBack.length) {
      const c1 = await openCatalogue(path.join(dataFolder, "model"));
      try {
        for (const row of c1.db.prepare("SELECT id,core_id,evidence FROM track_link").all())
          if (heldBack.includes(row.core_id))
            classify(c1, row.id, JSON.parse(row.evidence).hints, { manual: "classical", actor: "corpus" });
      } finally {
        c1.close();
      }
      await matchAll();
    }
    const c2 = await openCatalogue(path.join(dataFolder, "model"));
    try {
      return new Map(albums.map((album) => [album.id, renderAlbumPresentation(c2, album.id)]));
    } finally {
      c2.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;

// The album as the By work view lays it out: album order, a heading for each
// work at its first track, single pieces where they fall.
export function layout(album, presentation) {
  const lines = [`${album.title} — ${album.artist}  [${album.kind}]`];
  if (!presentation) {
    lines.push("  (no work view)");
    return lines.join("\n");
  }
  const groupOf = new Map();
  for (const group of presentation.groups)
    for (const item of group.items) groupOf.set(item.trackId, group);
  const shown = new Set();
  const ordered = [...album.tracks].sort((a, b) => a.disc - b.disc || a.number - b.number);
  for (const track of ordered) {
    const group = groupOf.get(trackId(album, track));
    if (!group) {
      lines.push(`  · ${track.title}  (${track.composer.join(", ")})  ${clock(track.durationMs)}`);
      continue;
    }
    if (shown.has(group.id)) continue;
    shown.add(group.id);
    lines.push(`  ${group.title} — ${group.composer}`);
    group.items.forEach((item, index) =>
      lines.push(`    ${index + 1}. ${item.title}  ${clock(item.durationMs)}`),
    );
    if (group.missing.length)
      lines.push(`    missing: ${group.missing.map((m) => m.title).join(", ")}`);
  }
  return lines.join("\n");
}
