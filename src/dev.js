// The "classical-dev" build: the plugin plus helpers for testing on a real
// Aurral without writing to the Library. Not part of the released plugin.
import fs from "node:fs/promises";
import path from "node:path";
import plugin, { makeContext } from "./index.js";
import { readTags } from "./tags.js";
import { withTagging } from "./tagger.js";
import { Slskd } from "./slskd.js";
import { slskdSettings } from "./settings.js";

const samples = (ctx) => path.join(ctx.dataFolder, "samples");

function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export default {
  ...plugin,
  dev: {
    // Copies Library files into dataFolder/samples. Reads the Library only.
    async copySamples(input) {
      const ctx = makeContext(input);
      await fs.mkdir(samples(ctx), { recursive: true });
      const copied = [];
      for (const [i, file] of (input.paths || []).slice(0, 20).entries()) {
        if (!inside(ctx.libraryFolder, file)) throw new Error(`${file} isn't in the Library folder`);
        const target = path.join(samples(ctx), `${String(i).padStart(2, "0")}-${path.basename(file)}`);
        await fs.copyFile(file, target);
        copied.push(target);
      }
      return { copied };
    },

    // Deletes the copies in dataFolder/samples (the dev plugin's own files).
    async clearSamples(input) {
      const ctx = makeContext(input);
      await fs.rm(samples(ctx), { recursive: true, force: true });
      return { cleared: samples(ctx) };
    },

    async listSamples(input) {
      const ctx = makeContext(input);
      const names = await fs.readdir(samples(ctx)).catch(() => []);
      return names.map((name) => {
        const file = path.join(samples(ctx), name);
        try {
          const t = readTags(file);
          return { file, artist: t.artist, composer: t.composer, work: t.work, workId: t.workId, recording: t.recordingMbid };
        } catch (error) {
          return { file, error: error.message };
        }
      });
    },

    // Tags copies in dataFolder/samples, through the same code as the queue.
    async tagSamples(input) {
      const ctx = makeContext(input);
      const files = (input.paths || []).filter((file) => inside(samples(ctx), file));
      const stats = await withTagging(ctx, async (session) => {
        for (const file of files) await session.processFile(file, { force: true });
      });
      return { stats, files: await this.listSamples(input) };
    },

    // What the plugin would write for a recording, without writing anything.
    async resolve(input) {
      const ctx = makeContext(input);
      const fields = await ctx.resolver.resolve(input.recordingId, input.options || {});
      if (!fields) return { skipped: ctx.resolver.skipReason };
      const { recording, people, ...rest } = fields;
      return { ...rest, mbRequests: ctx.mb.requests };
    },

    // Reads the Library's tags into the index. Writes nothing to the Library.
    async indexLibrary(input) {
      const ctx = makeContext(input);
      let count = 0;
      const stats = await withTagging(ctx, async (session) => {
        await session.scan(Date.now() + (input.budgetMs || 90_000));
        count = Object.keys(session.index).length;
      });
      return { indexed: count, busy: !stats };
    },

    // Starts a slow call (a search) in the background and saves its answer,
    // for clients whose connection drops before the call ends. Only calls
    // that read: searches and resolving.
    async start(input) {
      const allowed = new Set(["downloadSource.search", "downloadSource.searchAlbum"]);
      if (!allowed.has(input.call)) throw new Error(`dev.start runs only ${[...allowed].join(", ")}`);
      const id = `${Date.now()}`;
      const file = path.join(input.dataFolder, "dev-results", `${id}.json`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const [group, name] = input.call.split(".");
      const started = Date.now();
      plugin[group][name]({ ...input, ...input.args })
        .then((answer) => ({ ok: true, answer }), (error) => ({ ok: false, error: error.message }))
        .then((result) => fs.writeFile(file, JSON.stringify({ ...result, ms: Date.now() - started })));
      return { id };
    },

    async result(input) {
      const file = path.join(input.dataFolder, "dev-results", `${input.id}.json`);
      const text = await fs.readFile(file, "utf8").catch(() => null);
      return text ? JSON.parse(text) : { pending: true };
    },

    // What the plugin recorded for each file it processed.
    async processed(input) {
      const records = JSON.parse(await fs.readFile(path.join(input.dataFolder, "processed.json"), "utf8").catch(() => "{}"));
      const index = JSON.parse(await fs.readFile(path.join(input.dataFolder, "library-index.json"), "utf8").catch(() => "{}"));
      const rows = Object.entries(records).filter(([, r]) => !input.status || r.status === input.status);
      return rows
        .slice(input.offset || 0, (input.offset || 0) + (input.limit || 500))
        .map(([file, r]) => ({ file, ...r, releaseGroupMbid: index[file]?.releaseGroupMbid, albumArtistMbids: index[file]?.albumArtistMbids, album: index[file]?.album, title: index[file]?.title }));
    },

    // Reads from Aurral's API with the plugin's key. GET only.
    async aurralGet(input) {
      const route = String(input.route || "");
      if (!route.startsWith("/")) throw new Error("route must start with /");
      const response = await fetch(`${input.api.url}${route}`, { headers: { "X-Api-Key": input.api.key } });
      const text = await response.text();
      return { status: response.status, body: text.slice(0, input.maxChars || 200_000) };
    },

    // Sizes of the plugin data folders (read only): every plugin's folder
    // beside this one, and the biggest entries inside each.
    async du(input) {
      const root = path.dirname(input.dataFolder);
      const size = async (p) => {
        const st = await fs.lstat(p).catch(() => null);
        if (!st) return { bytes: 0, files: 0 };
        if (!st.isDirectory()) return { bytes: st.size, files: 1 };
        let bytes = 0, files = 0;
        for (const name of await fs.readdir(p).catch(() => [])) {
          const r = await size(path.join(p, name));
          bytes += r.bytes; files += r.files;
        }
        return { bytes, files };
      };
      const out = {};
      for (const name of await fs.readdir(root)) {
        const dir = path.join(root, name);
        const inner = {};
        for (const child of await fs.readdir(dir).catch(() => [])) inner[child] = await size(path.join(dir, child));
        out[name] = inner;
      }
      return { root, out };
    },

    // Reads a file under the plugin data folders (read only).
    async peek(input) {
      const root = path.dirname(input.dataFolder);
      const file = path.resolve(root, String(input.file || ""));
      if (!inside(root, file)) throw new Error("only files under the plugin data folders");
      const st = await fs.stat(file);
      if (st.isDirectory()) return { dir: await fs.readdir(file) };
      return { text: (await fs.readFile(file, "utf8")).slice(0, input.maxChars || 100_000) };
    },

    // A user's transfers in slskd, summarized by state (read only).
    async slskdTransfers(input) {
      const transfers = await new Slskd(slskdSettings(input.settings)).downloads(input.username);
      const states = {};
      for (const t of transfers) states[t.state] = (states[t.state] || 0) + 1;
      const bytes = transfers.reduce((a, t) => a + (t.bytesTransferred || 0), 0);
      const size = transfers.reduce((a, t) => a + (t.size || 0), 0);
      return { count: transfers.length, states, bytes, size, sample: transfers.slice(0, 2).map((t) => ({ state: t.state, requestedAt: t.requestedAt, endedAt: t.endedAt, percent: t.percentComplete })) };
    },

    // Library files from the index (paths and tags only).
    async libraryFiles(input) {
      const ctx = makeContext(input);
      const index = JSON.parse(await fs.readFile(path.join(ctx.dataFolder, "library-index.json"), "utf8").catch(() => "{}"));
      const rows = Object.entries(index).filter(([, e]) => !input.query || JSON.stringify(e).toLowerCase().includes(String(input.query).toLowerCase()));
      return rows.slice(0, input.limit || 20).map(([file, e]) => ({ file, ...e }));
    },
  },
};
