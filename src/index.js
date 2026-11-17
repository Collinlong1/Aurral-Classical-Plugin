import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readEditor, mutateEditor } from "./model/editor.js";
import { readClassical, mutateClassical, PAGE_ID } from "./model/pages.js";
import {
  albumPresentation,
  trackLinks,
  readWork,
  mutateWork,
} from "./model/presentation.js";
import {
  modelStatus,
  enqueueModelScan,
  cancelModelScan,
  queueAlbumMatch,
  albumMatchResult,
  queueEnglishNames,
  englishNamesStatus,
  queueEnrichment,
  enrichmentStatus,
  autoMatchLibrary,
  identifyBacklog,
  runModelJobs,
  requestModelSync,
  modelSyncDue,
  canReadHostLibrary,
} from "./model/runtime.js";
import { readValues } from "./tags.js";
import { albumClassificationSummary } from "./model/classification-report.js";
import { search } from "./search/provider.js";
import { runTagJobs } from "./model/tag-write.js";
import { applyRequest, discardRequest, requestTags } from "./tag-requests.js";
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

// The editor's Maintenance tab: the model's state, and library-wide work
// queued on the model worker (it continues on the plugin schedule).
function maintenance(input) {
  const ctx = makeContext(input);
  const start = () =>
    modelJobs(ctx, { budgetMs: ACTION_BUDGET_MS }).catch((error) => log(`Classical model work stopped: ${error.message}`));
  return {
    // Tag writes and restores an admin confirmed (v0.3 8.4, 8.5): in this
    // process, holding the tagger's lock. Never from a scan or the schedule.
    startTagWrites() {
      runTagJobs(ctx, { budgetMs: ACTION_BUDGET_MS }).catch((error) => log(`Classical tag writing stopped: ${error.message}`));
    },
    async status() {
      const status = await modelStatus(ctx);
      return {
        ...status,
        indexed: status.tracks.reduce((sum, row) => sum + row.count, 0),
        scan: status.scan && {
          ...status.scan,
          state: status.scan.state === "running" && status.scan.leaseUntil <= status.now ? "interrupted (scan again to resume)" : status.scan.state,
        },
        english: await englishNamesStatus(ctx).catch(() => null),
        enrich: await enrichmentStatus(ctx).catch(() => null),
      };
    },
    async run(command, user, values = {}) {
      if (command === "maintenance-scan") {
        const id = await enqueueModelScan(ctx, user);
        start();
        return `Scan ${id} is running in the background; reload to see its progress.`;
      }
      if (command === "maintenance-cancel") {
        await cancelModelScan(ctx, user);
        return "Scan cancellation requested; what it read so far is kept.";
      }
      if (command === "maintenance-backlog") {
        const result = await identifyBacklog(ctx, user);
        start();
        return result.albums
          ? `Queued ${result.albums} album${result.albums === 1 ? "" : "s"} (${result.tracks} tracks) for a one-time MusicBrainz lookup, one request a second.`
          : "No album is waiting for its one-time MusicBrainz lookup. Any lookup still queued continues.";
      }
      if (command === "maintenance-english") {
        const queued = await queueEnglishNames(ctx, user);
        if (!queued.queued && queued.state === "done")
          return `Work names and books were looked up already: ${queued.renamed} of ${queued.total} works renamed, ${queued.filed || 0} filed under their book.`;
        start();
        return "Looking up work names and books on MusicBrainz in the background, one request a second.";
      }
      // A tag request from the album or artist menu, confirmed (v0.3 8.7).
      if (command === "maintenance-tag-request") {
        if (user?.role !== "admin") throw new Error("Writing tags requires a current host admin");
        if (values?.confirm !== true) throw new Error("Confirm writing the tags first");
        const id = String(values.request || "");
        applyRequest(ctx, id, user).catch((error) => log(`Classical tag request stopped: ${error.message}`));
        return { message: "Writing the tags in the background. This page shows the result; reload it in a moment.", selection: `tag-request:${id}` };
      }
      if (command === "maintenance-tag-request-discard") {
        await discardRequest(ctx, String(values?.request || ""));
        return { message: "Discarded; nothing was written.", selection: "" };
      }
      if (command === "maintenance-enrich") {
        const queued = await queueEnrichment(ctx, user);
        if (!queued.queued)
          return queued.state === "done" ? "Every person, ensemble and work with a MusicBrainz ID has its MusicBrainz details already." : "MusicBrainz details are being looked up already; reload to see progress.";
        start();
        return `Looking up dates, sort names and other names for ${queued.waiting} entr${queued.waiting === 1 ? "y" : "ies"} on MusicBrainz in the background, one request a second. Values you set yourself stay.`;
      }
      throw new Error("Unknown maintenance command");
    },
  };
}

export default {
  pages: {
    read: (input) =>
      input.pageId === PAGE_ID
        ? readClassical(input)
        : input.pageId === "work"
          ? readWork(input)
          : readEditor({ ...input, maintenance: maintenance(input) }),
    mutate: (input) =>
      input.pageId === PAGE_ID
        ? mutateClassical(input)
        : input.pageId === "work"
          ? mutateWork(input)
          : mutateEditor({ ...input, maintenance: maintenance(input) }),
  },
  albumPresentation,
  trackLinks,
  search,
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
      await modelJobs(ctx, { budgetMs: ACTION_BUDGET_MS });
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
      const ctx = makeContext(input);
      const result = await identifyBacklog(ctx, input.user);
      // Work the queue now, in this action's budget, rather than waiting for
      // the plugin schedule (which may be off).
      await modelJobs(ctx, { budgetMs: ACTION_BUDGET_MS });
      const { identification: id } = await modelStatus(ctx);
      const progress = `${id.done} album${id.done === 1 ? "" : "s"} looked up, ${id.matched} work group${id.matched === 1 ? "" : "s"} made${id.queued ? `; ${id.queued} still queued: run this again, or enable the plugin schedule, to continue` : ""}.`;
      return {
        message: result.albums
          ? `Queued ${result.albums} album${result.albums === 1 ? "" : "s"} (${result.tracks} track${result.tracks === 1 ? "" : "s"}) for a one-time MusicBrainz lookup, one request a second on public MusicBrainz. ${progress}`
          : id.queued
            ? `Continuing the MusicBrainz lookup. ${progress}`
            : "No album is waiting for its one-time MusicBrainz lookup: each was looked up already, or has no track with a recording ID outside a work.",
      };
    },
    async "classical-english-names"(input) {
      // Once: a lookup per work, one request a second on public MusicBrainz,
      // on the model worker; run again to continue.
      const ctx = makeContext(input);
      const queued = await queueEnglishNames(ctx, input.user);
      if (!queued.queued && queued.state === "done")
        return { message: `Work names and books were looked up already: ${queued.renamed} of ${queued.total} works renamed, ${queued.filed || 0} filed under their book.` };
      await modelJobs(ctx, { budgetMs: ACTION_BUDGET_MS });
      const status = await englishNamesStatus(ctx);
      return {
        message:
          status?.state === "done"
            ? `Looked up ${status.total} works on MusicBrainz: ${status.renamed} renamed to their English names, ${status.filed || 0} filed under their book (such as The Well-Tempered Clavier, Book I). Titles you set yourself were left alone.`
            : `Looked up ${status?.cursor ?? 0} of ${status?.total ?? "?"} works so far (${status?.renamed ?? 0} renamed): run this again, or enable the plugin schedule, to continue.`,
      };
    },
    async "classical-auto-match"(input) {
      // On the model worker: a large album's MusicBrainz lookups no longer
      // keep the plugin from answering (it was reported "busy").
      const ctx = makeContext(input);
      const key = await queueAlbumMatch(ctx, input.user, input.album?.id);
      await modelJobs(ctx, { budgetMs: ACTION_BUDGET_MS });
      const result = await albumMatchResult(ctx, key);
      if (result?.state !== "done")
        return { message: "Still looking this album up on MusicBrainz in the background (one request a second). Reload the album in a few minutes, or run this again to continue." };
      return {
        message:
          result.matched > 0
            ? `Created ${result.matched} work group${result.matched === 1 ? "" : "s"} from classical WORK/title, composer and MusicBrainz evidence. Reload the album to use Works view.`
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
    // These four only plan what they would write (v0.3 8.7); an admin
    // confirms the plan in the editor's Activity → Tag requests.
    async "clear-classical"(input) {
      const paths = input.album.tracks.map((t) => t.path).filter(Boolean);
      return { message: (await requestTags(makeContext(input), paths, { mode: "clear", what: `"${input.album.title}"`, actor: input.user })).message };
    },
    async "tag-album"(input) {
      const paths = input.album.tracks.map((t) => t.path).filter(Boolean);
      return { message: (await requestTags(makeContext(input), paths, { mode: "tag", what: `"${input.album.title}"`, actor: input.user })).message };
    },

    async "untag-album"(input) {
      const paths = input.album.tracks.map((t) => t.path).filter(Boolean);
      return { message: (await requestTags(makeContext(input), paths, { mode: "restore", what: `"${input.album.title}"`, actor: input.user })).message };
    },

    async "tag-artist"(input) {
      const ctx = makeContext(input);
      // Reads the Library first, so a fresh install finds the artist's files.
      const index = await libraryIndex(ctx, 10 * 60_000, { priority: true });
      return { message: (await requestTags(ctx, artistFiles(index, input.artist), { mode: "tag", what: input.artist.name, actor: input.user })).message };
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
      // A scan or lookup an admin started is still running: it carries on
      // with the queue; a second run beside it would only contend for the
      // database.
      if (modelRun) throw Object.assign(new Error("busy"), { skip: true });
      await modelJobs(ctx, { budgetMs: SCHEDULE_BUDGET_MS });
      if (canReadHostLibrary(ctx) && (await modelSyncDue(ctx))) {
        await enqueueModelScan(ctx, null, { system: true });
        const left = deadline - Date.now();
        if (left > 0) await modelJobs(ctx, { budgetMs: left });
      }
      // A run that finished a scan goes on with MusicBrainz identification.
      const left = deadline - Date.now();
      if (left > 0) await modelJobs(ctx, { budgetMs: left });
    } catch (error) {
      if (!error.skip) log(`Classical model unavailable: ${error.message}`);
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
    search: (input) => searchTrack(makeContext(input), input.track, { manual: input.manual === true }),
    // `manual` (fork): a person is choosing, so ambiguous results are offered.
    searchAlbum: (input) => searchAlbum(makeContext(input), input.album, { manual: input.manual === true }),
    download: (input) =>
      startDownload(makeContext(input), input.result, "track"),
    downloadAlbum: (input) =>
      startDownload(makeContext(input), input.result, "album"),
    status: (input) =>
      downloadStatus(makeContext(input), input.id, input.directory),
  },
};

// Scans and MusicBrainz identification run on a worker thread. Their last
// steps (publishing a scan, the library-wide matching pass) are seconds of
// synchronous SQLite work; on the plugin's own thread every album page and
// editor call waited behind them ("was busy and didn't answer within 15
// seconds"). The worker opens the catalogue itself (SQLite WAL lets pages
// read meanwhile) and builds its own MusicBrainz client from the settings.
// One run at a time in this process: two workers writing to one catalogue
// made a scan's final step fail with "database is locked". A later run waits
// for the one before it.
let modelRun = null;
function modelJobs(ctx, options) {
  const run = (modelRun || Promise.resolve()).catch(() => {}).then(() => modelJobsWorker(ctx, options));
  const tracked = run.finally(() => {
    if (modelRun === tracked) modelRun = null;
  });
  modelRun = tracked;
  return run;
}
function modelJobsWorker(ctx, options) {
  const input = {
    settings: ctx.settings,
    dataFolder: ctx.dataFolder,
    libraryFolder: ctx.libraryFolder,
    api: ctx.api,
    userOperations: ctx.userOperations,
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { classicalModelJobs: { input, options } } });
    worker.once("message", (message) => (message?.error ? reject(new Error(message.error)) : resolve()));
    worker.once("error", reject);
    worker.once("exit", (code) => (code ? reject(new Error(`Classical model worker stopped (${code})`)) : resolve()));
  });
}

if (!isMainThread && workerData?.classicalModelJobs) {
  const { input, options } = workerData.classicalModelJobs;
  runModelJobs(makeContext(input), options).then(
    () => parentPort.postMessage({}),
    (error) => parentPort.postMessage({ error: error?.message || String(error) }),
  );
}
