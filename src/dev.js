// The "classical-dev" build: the plugin plus helpers for testing on a real
// Aurral without writing to the Library. Not part of the released plugin.
import fs from "node:fs/promises";
import path from "node:path";
import plugin, { makeContext } from "./index.js";
import { readTags } from "./tags.js";
import { withTagging } from "./tagger.js";

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

    // Library files from the index (paths and tags only).
    async libraryFiles(input) {
      const ctx = makeContext(input);
      const index = JSON.parse(await fs.readFile(path.join(ctx.dataFolder, "library-index.json"), "utf8").catch(() => "{}"));
      const rows = Object.entries(index).filter(([, e]) => !input.query || JSON.stringify(e).toLowerCase().includes(String(input.query).toLowerCase()));
      return rows.slice(0, input.limit || 20).map(([file, e]) => ({ file, ...e }));
    },
  },
};
