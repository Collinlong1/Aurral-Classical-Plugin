import path from "node:path";
import { albumPresentation } from "./album-works.js";
import { MusicBrainz, mbBaseUrl, TTL } from "./mb.js";
import { ClassicalResolver } from "./resolver.js";
import { parseOrder, parseSeparator, slskdSettings } from "./settings.js";
import { Slskd } from "./slskd.js";
import { downloadStatus, searchAlbum, searchTrack, startDownload } from "./source.js";
import { applyRequest, requestTags, waitingRequest } from "./tag-requests.js";
import { describeStats, enqueue, libraryIndex, runQueue, runScheduled } from "./tagger.js";
import { pruneCache } from "./store.js";

const BACKGROUND_BUDGET_MS = 4 * 60_000; // the process stops 5 idle minutes after a call
const SCHEDULE_BUDGET_MS = 8.5 * 60_000; // a scheduled run has 10 minutes

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
export async function waitForBackgroundTagging() {
  while (background) await background;
}
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

const albumPaths = (album) => album.tracks.map((t) => t.path).filter(Boolean);

async function writePlanned(ctx, target, what, user) {
  const request = waitingRequest(ctx, target);
  if (!request) return `${what}: nothing is planned. Choose Tag as classical or Remove classical tags first.`;
  return (await applyRequest(ctx, request.id, user)).message;
}

export default {
  async test(input) {
    const ctx = makeContext(input);
    const parts = [];
    const host = new URL(mbBaseUrl(ctx.settings)).host;
    const reached = await ctx.mb.ping();
    if (reached !== true) throw new Error(`Couldn't reach MusicBrainz at ${host}: ${reached}`);
    parts.push(`MusicBrainz answers at ${host}`);
    const slskd = slskdSettings(ctx.settings);
    if (slskd.configured) {
      const app = await new Slskd(slskd).application();
      const version = app?.version?.full || app?.version?.current || app?.version || "";
      parts.push(`slskd ${typeof version === "string" ? version : ""} answers`.replace(/\s+/g, " "));
      if (!slskd.downloadFolder) parts.push("set slskd's download folder to download");
    } else parts.push("slskd isn't set up, so the download source is off");
    parts.push(`Artists read like ${ctx.resolver.order.filter((r) => r !== "credited").join(ctx.resolver.separator)}`);
    parts.push(ctx.settings.enableFileWrites === true ? "new downloads are tagged automatically" : "new downloads aren't tagged automatically");
    return { message: parts.join(". ").slice(0, 500) };
  },

  actions: {
    async "tag-album"(input) {
      const ctx = makeContext(input);
      const what = `"${input.album.title}"`;
      return { message: (await requestTags(ctx, albumPaths(input.album), { mode: "tag", what, actor: input.user, target: `album:${input.album.id}` })).message };
    },

    async "untag-album"(input) {
      const ctx = makeContext(input);
      const what = `"${input.album.title}"`;
      return { message: (await requestTags(ctx, albumPaths(input.album), { mode: "restore", what, actor: input.user, target: `album:${input.album.id}` })).message };
    },

    async "write-album"(input) {
      const ctx = makeContext(input);
      return { message: await writePlanned(ctx, `album:${input.album.id}`, `"${input.album.title}"`, input.user) };
    },

    async "tag-artist"(input) {
      const ctx = makeContext(input);
      // Reads the Library first, so a fresh install finds the artist's files.
      const index = await libraryIndex(ctx, 10 * 60_000, { priority: true });
      return { message: (await requestTags(ctx, artistFiles(index, input.artist), { mode: "tag", what: input.artist.name, actor: input.user, target: `artist:${input.artist.id}` })).message };
    },

    async "write-artist"(input) {
      const ctx = makeContext(input);
      return { message: await writePlanned(ctx, `artist:${input.artist.id}`, input.artist.name, input.user) };
    },
  },

  events: {
    async "download.finished"(input) {
      const ctx = makeContext(input);
      if (ctx.settings.enableFileWrites !== true || !input.track?.path) return;
      await enqueue(ctx, [input.track.path], { source: input.source });
      tagInBackground(ctx);
    },
  },

  async scheduled(input) {
    const ctx = makeContext(input);
    if (ctx.settings.enableFileWrites === true) {
      const stats = await runScheduled(ctx, SCHEDULE_BUDGET_MS);
      if (stats) log(`Scheduled tagging: ${describeStats(stats)}`);
    }
    await pruneCache(path.join(ctx.dataFolder, "mb-cache"), TTL.default).catch(() => {});
  },

  albumPresentation: (input) => albumPresentation(makeContext(input), input.album),

  downloadSource: {
    search: (input) => searchTrack(makeContext(input), input.track, { manual: input.manual === true }),
    searchAlbum: (input) => searchAlbum(makeContext(input), input.album, { manual: input.manual === true }),
    download: (input) => startDownload(makeContext(input), input.result, "track"),
    downloadAlbum: (input) => startDownload(makeContext(input), input.result, "album"),
    status: (input) => downloadStatus(makeContext(input), input.id, input.directory),
  },
};
