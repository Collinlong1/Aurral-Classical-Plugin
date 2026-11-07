import path from "node:path";
import { compareRecordings } from "./compare.js";
import { MusicBrainz, mbBaseUrl, TTL } from "./mb.js";
import { ClassicalResolver } from "./resolver.js";
import { parseOrder, parseSeparator, slskdSettings } from "./settings.js";
import { Slskd } from "./slskd.js";
import { downloadStatus, searchAlbum, searchTrack, startDownload } from "./source.js";
import { describeStats, enqueue, libraryIndex, runQueue, runScheduled } from "./tagger.js";
import { pruneCache, sleep } from "./store.js";

const BACKGROUND_BUDGET_MS = 4 * 60_000; // the process stops 5 idle minutes after a call
const SCHEDULE_BUDGET_MS = 8.5 * 60_000; // a scheduled run has 10 minutes
const ACTION_BUDGET_MS = 25 * 60_000; // a background action has 30 minutes

const log = (...args) => console.log(...args);

export function makeContext(input, { fetchImpl = fetch } = {}) {
  const settings = input.settings || {};
  const mb = new MusicBrainz({ settings, dataFolder: input.dataFolder, fetchImpl, log });
  const resolver = new ClassicalResolver(mb, {
    log,
    separator: parseSeparator(settings.separator),
    order: parseOrder(settings.nameOrder),
  });
  return {
    settings,
    libraryFolder: input.libraryFolder,
    dataFolder: input.dataFolder,
    api: input.api,
    fetch: fetchImpl,
    log,
    mb,
    resolver,
  };
}

// Tagging that runs after an event has answered. One at a time per process;
// another process may hold the lock, and then it works the queue instead.
let background = null;
let again = false;
function tagInBackground(ctx) {
  if (background) {
    again = true;
    return;
  }
  background = (async () => {
    do {
      again = false;
      const stats = await runQueue(ctx, BACKGROUND_BUDGET_MS);
      if (stats && (stats.tagged || stats.failed)) log(`Tagging: ${describeStats(stats)}`);
    } while (again);
  })()
    .catch((error) => console.warn(`Tagging stopped: ${error.message}`))
    .finally(() => {
      background = null;
    });
}

async function tagNow(ctx, paths, what) {
  if (!paths.length) return `No files to tag in ${what}`;
  const ids = new Set(await enqueue(ctx, paths, { force: true, source: "action" }));
  const until = Date.now() + ACTION_BUDGET_MS;
  for (;;) {
    const stats = await runQueue(ctx, until - Date.now(), ids);
    if (stats) return `${what}: ${describeStats(stats)}`.slice(0, 500);
    if (Date.now() > until - 60_000) break;
    await sleep(5000);
  }
  return `Queued ${paths.length} files from ${what}. Tagging is busy and will get to them.`;
}

function artistFiles(index, artist) {
  const albumIds = new Set(artist.albums.flatMap((a) => [a.mbid]).filter(Boolean));
  const name = String(artist.name || "").toLowerCase();
  return Object.entries(index)
    .filter(
      ([, entry]) =>
        (artist.mbid && entry.albumArtistMbids?.includes(artist.mbid)) ||
        albumIds.has(entry.releaseGroupMbid) ||
        albumIds.has(entry.releaseMbid) ||
        (name && String(entry.albumArtist || "").toLowerCase() === name),
    )
    .map(([file]) => file);
}

export default {
  async test(input) {
    const ctx = makeContext(input);
    const parts = [];
    const host = new URL(mbBaseUrl(ctx.settings)).host;
    const reached = await ctx.mb.ping();
    if (reached !== true) throw new Error(`Couldn't reach MusicBrainz at ${host}: ${reached}`);
    parts.push(`MusicBrainz answers at ${host}`);
    if (!String(ctx.settings.mbContact || "").trim()) parts.push("Add a MusicBrainz contact so MusicBrainz can reach you");
    const slskd = slskdSettings(ctx.settings);
    if (slskd.configured) {
      const app = await new Slskd(slskd).application();
      const version = app?.version?.full || app?.version?.current || app?.version || "";
      parts.push(`slskd ${typeof version === "string" ? version : ""} answers`.replace(/\s+/g, " "));
      if (!slskd.downloadFolder) parts.push("set slskd's download folder to download");
    } else parts.push("slskd isn't set up, so the download source is off");
    parts.push(`Artists read like ${ctx.resolver.order.filter((r) => r !== "credited").join(ctx.resolver.separator)}`);
    return { message: parts.join(". ").slice(0, 500) };
  },

  actions: {
    async "tag-album"(input) {
      const ctx = makeContext(input);
      const paths = input.album.tracks.map((t) => t.path).filter(Boolean);
      return { message: await tagNow(ctx, paths, `"${input.album.title}"`) };
    },

    async "tag-artist"(input) {
      const ctx = makeContext(input);
      const index = await libraryIndex(ctx, 10 * 60_000);
      return { message: await tagNow(ctx, artistFiles(index, input.artist), input.artist.name) };
    },

    async "compare-track"(input) {
      const ctx = makeContext(input);
      return { message: await compareRecordings(ctx, input.user, input.tracks) };
    },

    async "compare-album"(input) {
      const ctx = makeContext(input);
      return { message: await compareRecordings(ctx, input.user, input.album.tracks) };
    },
  },

  events: {
    async "download.finished"(input) {
      const ctx = makeContext(input);
      if (!input.track?.path) return;
      await enqueue(ctx, [input.track.path], { source: input.source });
      tagInBackground(ctx);
    },
  },

  async scheduled(input) {
    const ctx = makeContext(input);
    const stats = await runScheduled(ctx, SCHEDULE_BUDGET_MS);
    if (stats) log(`Scheduled tagging: ${describeStats(stats)}`);
    await pruneCache(path.join(ctx.dataFolder, "mb-cache"), TTL.default).catch(() => {});
  },

  downloadSource: {
    search: (input) => searchTrack(makeContext(input), input.track),
    searchAlbum: (input) => searchAlbum(makeContext(input), input.album),
    download: (input) => startDownload(makeContext(input), input.result, "track"),
    downloadAlbum: (input) => startDownload(makeContext(input), input.result, "album"),
    status: (input) => downloadStatus(makeContext(input), input.id, input.directory),
  },
};

