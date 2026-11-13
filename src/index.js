import path from "node:path";
import { readEditor, mutateEditor } from "./model/editor.js";
import {
  albumPresentation,
  readWork,
  mutateWork,
} from "./model/presentation.js";
import {
  modelStatus,
  enqueueModelScan,
  cancelModelScan,
  autoMatchWorks,
  autoMatchLibrary,
  identifyBacklog,
  runModelJobs,
  requestModelSync,
  modelSyncDue,
  canReadHostLibrary,
} from "./model/runtime.js";
import { readValues } from "./tags.js";
import { albumClassificationSummary } from "./model/classification-report.js";
import { compareRecordings } from "./compare.js";
import { MusicBrainz, mbBaseUrl, TTL } from "./mb.js";
import { ClassicalResolver } from "./resolver.js";
import { parseOrder, parseSeparator, slskdSettings } from "./settings.js";
import { Slskd } from "./slskd.js";
import {
  acquisitionIdentity,
  downloadStatus,
  searchAlbum,
  searchTrack,
  startDownload,
} from "./source.js";
import {
  describeStats,
  enqueue,
  libraryIndex,
  runQueue,
  runScheduled,
  untagFiles,
} from "./tagger.js";
import { pruneCache } from "./store.js";

const BACKGROUND_BUDGET_MS = 4 * 60_000; // the process stops 5 idle minutes after a call
const SCHEDULE_BUDGET_MS = 8.5 * 60_000; // a scheduled run has 10 minutes
const ACTION_BUDGET_MS = 25 * 60_000; // a background action has 30 minutes

const log = (...args) => console.log(...args);

export function makeContext(input, { fetchImpl = fetch } = {}) {
  const settings = input.settings || {};
  const mb = new MusicBrainz({
    settings,
    dataFolder: input.dataFolder,
    fetchImpl,
    log,
  });
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
    userOperations: input.userOperations,
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
// Internal lifecycle hook for disposable tests to drain writes before teardown.
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
      if (stats && (stats.tagged || stats.failed))
        log(`Tagging: ${describeStats(stats)}`);
    } while (again);
  })()
    .catch((error) => console.warn(`Tagging stopped: ${error.message}`))
    .finally(() => {
      background = null;
    });
}

async function tagNow(ctx, paths, what) {
  if (!paths.length) return `No files to tag in ${what}`;
  const ids = new Set(
    await enqueue(ctx, paths, { force: true, source: "action" }),
  );
  const stats = await runQueue(ctx, ACTION_BUDGET_MS, ids, { priority: true });
  if (stats) return `${what}: ${describeStats(stats)}`.slice(0, 500);
  return `Queued ${paths.length} files from ${what}. Tagging is busy and will get to them.`;
}

async function untagNow(ctx, paths, what, mode = "restore") {
  if (!paths.length) return `No files in ${what}`;
  {
    const counts = await untagFiles(ctx, paths, ACTION_BUDGET_MS, {
      priority: true,
      mode,
    });
    if (counts) {
      const parts = [`${counts.restored} restored`];
      if (counts.cleared)
        parts.push(
          `${counts.cleared} cleared${mode === "clear" ? " (existing backups retained)" : " (original tags unavailable)"}`,
        );
      if (counts.unchanged)
        parts.push(`${counts.unchanged} already had no classical tags`);
      if (counts["no backup"])
        parts.push(
          `${counts["no backup"]} couldn't be restored (no backup, and MusicBrainz has no credit)`,
        );
      if (counts.skipped) parts.push(`${counts.skipped} skipped`);
      if (counts.left) parts.push(`${counts.left} left: run it again`);
      return `${what}: ${parts.join(", ")}. The plugin won't tag these recordings again unless you tag them as classical.`.slice(
        0,
        500,
      );
    }
    return `Tagging is busy. Try again in a few minutes.`;
  }
}

function artistFiles(index, artist) {
  const albumIds = new Set(
    artist.albums.flatMap((a) => [a.mbid]).filter(Boolean),
  );
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
  pages: {
    read: (input) =>
      input.pageId === "work" ? readWork(input) : readEditor(input),
    mutate: (input) =>
      input.pageId === "work" ? mutateWork(input) : mutateEditor(input),
  },
  albumPresentation,
  async test(input) {
    const ctx = makeContext(input);
    const parts = [];
    const host = new URL(mbBaseUrl(ctx.settings)).host;
    const reached = await ctx.mb.ping();
    if (reached !== true)
      throw new Error(`Couldn't reach MusicBrainz at ${host}: ${reached}`);
    parts.push(`MusicBrainz answers at ${host}`);
    const slskd = slskdSettings(ctx.settings);
    if (slskd.configured) {
      const app = await new Slskd(slskd).application();
      const version =
        app?.version?.full || app?.version?.current || app?.version || "";
      parts.push(
        `slskd ${typeof version === "string" ? version : ""} answers`.replace(
          /\s+/g,
          " ",
        ),
      );
      if (!slskd.downloadFolder)
        parts.push("set slskd's download folder to download");
    } else parts.push("slskd isn't set up, so the download source is off");
    parts.push(
      `Artists read like ${ctx.resolver.order.filter((r) => r !== "credited").join(ctx.resolver.separator)}`,
    );
    return { message: parts.join(". ").slice(0, 500) };
  },

  actions: {
    async "classical-model-status"(input) {
      if (input.user?.role !== "admin")
        throw new Error("Classical diagnostics require a host admin");
      const status = await modelStatus(makeContext(input));
      const indexed = status.tracks.reduce((sum, row) => sum + row.count, 0);
      const id = status.identification;
      const identification = id
        ? ` MusicBrainz identification: ${id.queued} album${id.queued === 1 ? "" : "s"} queued, ${id.done} done (${id.matched} work group${id.matched === 1 ? "" : "s"} made${id.errors ? `, ${id.errors} lookup${id.errors === 1 ? "" : "s"} failed` : ""})${id.failed ? `, ${id.failed} stopped after retries` : ""}${id.backlog ? `; ${id.backlog} earlier album${id.backlog === 1 ? "" : "s"} wait for the one-time lookup` : ""}.`
        : "";
      const scan = status.scan && {
        ...status.scan,
        // A running scan whose lease lapsed lost its process; say so.
        state:
          status.scan.state === "running" && status.scan.leaseUntil <= status.now
            ? "interrupted (run Scan again to resume)"
            : status.scan.state,
      };
      return {
        message:
          `Classical model schema ${status.schema}; indexed tracks: ${indexed}. ${scan ? `Scan ${scan.id}: ${scan.state}; processed ${scan.processed}/${scan.total} files.${scan.skipped ? ` ${scan.skipped} unreadable file${scan.skipped === 1 ? "" : "s"} skipped.` : ""}${scan.error ? ` Error: ${scan.error}` : ""}` : "No scan has been queued."}${identification}`.slice(
            0,
            500,
          ),
      };
    },
    async "classical-model-scan"(input) {
      const ctx = makeContext(input);
      const id = await enqueueModelScan(ctx, input.user);
      await runModelJobs(ctx, { budgetMs: ACTION_BUDGET_MS });
      const { scan } = await modelStatus(ctx);
      return {
        message:
          `Classical model scan ${id}: ${scan?.state || "saved"}; processed ${scan?.processed ?? 0}/${scan?.total ?? 0} files.${scan?.skipped ? ` ${scan.skipped} unreadable file${scan.skipped === 1 ? "" : "s"} skipped.` : ""} ${scan?.state === "done" ? "Reload the editor to search indexed tracks." : "Existing progress is saved. Run Scan again to resume immediately, or enable the plugin schedule for automatic continuation."}`.slice(
            0,
            500,
          ),
      };
    },
    async "classical-classification-report"(input) {
      if (input.user?.role !== "admin")
        throw new Error("Classical diagnostics require a host admin");
      return { message: await albumClassificationSummary(makeContext(input), input.album?.id) };
    },
    async "classical-model-cancel"(input) {
      await cancelModelScan(makeContext(input), input.user);
      return {
        message:
          "Model scan cancellation requested; catalogue data is retained.",
      };
    },
    async "classical-auto-match-library"(input) {
      const result = await autoMatchLibrary(makeContext(input), input.user);
      return {
        message: `Checked ${result.albums} album${result.albums === 1 ? "" : "s"} with unmatched classical tracks; created ${result.created} work group${result.created === 1 ? "" : "s"} from WORK and GROUPING tags and titles. Scans now do this by themselves, and look up new or changed albums on MusicBrainz in the background.`,
      };
    },
    async "classical-identify-backlog"(input) {
      const result = await identifyBacklog(makeContext(input), input.user);
      return {
        message: result.albums
          ? `Queued ${result.albums} album${result.albums === 1 ? "" : "s"} (${result.tracks} track${result.tracks === 1 ? "" : "s"}) for a one-time MusicBrainz lookup. It runs in the background on the plugin schedule, one request a second on public MusicBrainz, and resumes after a restart. Classical model status shows its progress.`
          : "No album is waiting for its one-time MusicBrainz lookup: each was looked up already, or has no track with a recording ID outside a work.",
      };
    },
    async "classical-auto-match"(input) {
      const result = await autoMatchWorks(
        makeContext(input),
        input.user,
        input.album?.id,
      );
      return {
        message:
          result.created > 0
            ? `Created ${result.created} work group${result.created === 1 ? "" : "s"} from classical WORK/title, composer and track-order evidence. Reload the album to use Works view.`
            : "No new groups matched this album's WORK tags, structured titles or MusicBrainz parent-work evidence. Tracks remain available in the metadata editor.",
      };
    },
    async "preview-remove"(input) {
      const fields = ["composer", "work", "workId"];
      const counts = Object.fromEntries(fields.map((field) => [field, 0]));
      for (const track of input.album.tracks.filter((t) => t.path)) {
        const values = readValues(track.path, fields);
        for (const field of fields) counts[field] += values[field].length;
      }
      return {
        message: `Clear classical fields will remove ${counts.composer} composer, ${counts.work} work and ${counts.workId} work-ID values. Restore originals uses backups instead; original values may remain. No files changed.`,
      };
    },
    async "clear-classical"(input) {
      return {
        message: await untagNow(
          makeContext(input),
          input.album.tracks.map((t) => t.path).filter(Boolean),
          `"${input.album.title}"`,
          "clear",
        ),
      };
    },
    async "tag-album"(input) {
      const ctx = makeContext(input);
      const paths = input.album.tracks.map((t) => t.path).filter(Boolean);
      return { message: await tagNow(ctx, paths, `"${input.album.title}"`) };
    },

    async "untag-album"(input) {
      const ctx = makeContext(input);
      const paths = input.album.tracks.map((t) => t.path).filter(Boolean);
      return { message: await untagNow(ctx, paths, `"${input.album.title}"`) };
    },

    async "tag-artist"(input) {
      const ctx = makeContext(input);
      // Reads the Library first, so a fresh install finds the artist's files.
      const index = await libraryIndex(ctx, 10 * 60_000, { priority: true });
      return {
        message: await tagNow(
          ctx,
          artistFiles(index, input.artist),
          input.artist.name,
        ),
      };
    },

    async "compare-track"(input) {
      const ctx = makeContext(input);
      return {
        message: await compareRecordings(ctx, input.user, input.tracks),
      };
    },

    async "compare-album"(input) {
      const ctx = makeContext(input);
      return {
        message: await compareRecordings(ctx, input.user, input.album.tracks),
      };
    },
  },

  events: {
    async "download.finished"(input) {
      const ctx = makeContext(input);
      // New files reach the classical model on the next scheduled run.
      await requestModelSync(ctx).catch((error) =>
        log(`Classical model sync request failed: ${error.message}`),
      );
      if (ctx.settings.enableFileWrites !== true) return;
      if (!input.track?.path) return;
      await enqueue(ctx, [input.track.path], { source: input.source });
      tagInBackground(ctx);
    },
  },

  async scheduled(input) {
    const ctx = makeContext(input);
    const deadline = Date.now() + SCHEDULE_BUDGET_MS;
    // Use the scheduled call's budget, sharing it with optional file tagging.
    // Model failures never suppress the established source/tagging schedule.
    // Continue a queued scan, then start an incremental one when a download
    // asked for it or the last completed scan is older than the sync interval.
    try {
      await runModelJobs(ctx, { budgetMs: SCHEDULE_BUDGET_MS });
      if (canReadHostLibrary(ctx) && (await modelSyncDue(ctx))) {
        await enqueueModelScan(ctx, null, { system: true });
        const left = deadline - Date.now();
        if (left > 0) await runModelJobs(ctx, { budgetMs: left });
      }
    } catch (error) {
      log(`Classical model unavailable: ${error.message}`);
    }
    if (ctx.settings.enableFileWrites !== true) return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return;
    const stats = await runScheduled(ctx, remainingMs);
    if (stats) log(`Scheduled tagging: ${describeStats(stats)}`);
    await pruneCache(path.join(ctx.dataFolder, "mb-cache"), TTL.default).catch(
      () => {},
    );
  },

  downloadSource: {
    acquisitionIdentity: (input) =>
      acquisitionIdentity(makeContext(input), input.track),
    search: (input) => searchTrack(makeContext(input), input.track),
    searchAlbum: (input) => searchAlbum(makeContext(input), input.album),
    download: (input) =>
      startDownload(makeContext(input), input.result, "track"),
    downloadAlbum: (input) =>
      startDownload(makeContext(input), input.result, "album"),
    status: (input) =>
      downloadStatus(makeContext(input), input.id, input.directory),
  },
};
