import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { openCatalogue } from "./catalogue.js";
import { ModelJobs } from "./jobs.js";
import { reconcile, classify } from "./reconcile.js";
import { UserOperations } from "../user-operations.js";
import { readTags } from "../tags.js";

export const modelFolder = (ctx) => path.join(ctx.dataFolder, "model");
const fingerprint = async (file) => {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  // Full-file evidence is versioned. A retag needs review unless other evidence agrees.
  return `file-sha256-v1:${hash.digest("hex")}`;
};
export async function modelStatus(ctx) {
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    return {
      ...catalogue.diagnostics(),
      jobs: catalogue.db
        .prepare("SELECT state,count(*) AS count FROM model_job GROUP BY state")
        .all(),
    };
  } finally {
    catalogue.close();
  }
}

export async function enqueueModelScan(ctx, actor) {
  if (actor?.role !== "admin")
    throw new Error("Classical model scans require a current host admin");
  const library = await new UserOperations(
    ctx.userOperations,
    ctx.fetch,
  ).library();
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    // A local binding lives with the plugin data/config. File hashes still guard reused core IDs.
    let instance = catalogue.db
      .prepare("SELECT * FROM core_instance LIMIT 1")
      .get();
    if (!instance) {
      const id = randomUUID();
      catalogue.db
        .prepare("INSERT INTO core_instance VALUES (?,?,0)")
        .run(id, ctx.settings.libraryEpoch || "initial");
      instance = { id, generation: 0 };
    }
    const files = library.tracks.flatMap((track) =>
      track.files
        .filter((f) => f.available && f.source !== "flow")
        .map((file) => ({
          coreId: String(track.id),
          fileId: String(file.id ?? file.path),
          path: file.path,
          readPath: file.readPath || file.path,
          durationMs: file.durationMs ?? track.durationMs,
          albumId: file.albumId,
        })),
    );
    const jobs = new ModelJobs(catalogue);
    return jobs.enqueue("library_scan", "library_scan", {
      actor: String(actor.id),
      instanceId: instance.id,
      epoch: ctx.settings.libraryEpoch || "initial",
      generation: instance.generation + 1,
      files,
    });
  } finally {
    catalogue.close();
  }
}

// File reads happen outside the writer transaction. Only a fenced checkpoint may publish them.
export async function runModelJobs(
  ctx,
  { budgetMs = 5000, batchSize = 10 } = {},
) {
  const catalogue = await openCatalogue(modelFolder(ctx));
  const jobs = new ModelJobs(catalogue),
    owner = randomUUID(),
    deadline = Date.now() + budgetMs;
  try {
    const job = jobs.claim(owner, { leaseMs: 60_000 });
    if (!job) return;
    try {
      if (job.type !== "library_scan")
        throw new Error("Unknown model job type");
      const input = job.input;
      let cursor = job.progress.cursor || 0;
      const collected = job.progress.collected || [];
      const root = await fs.realpath(ctx.libraryFolder);
      while (cursor < input.files.length && Date.now() < deadline) {
        const stop = Math.min(cursor + batchSize, input.files.length);
        for (; cursor < stop; cursor++) {
          if (jobs.get(job.id).cancel_requested) break;
          const file = input.files[cursor];
          const real = await fs.realpath(file.readPath);
          const relative = path.relative(root, real);
          if (
            !relative ||
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          )
            throw new Error(
              "Indexed model file is outside the configured library",
            );
          const before = await fs.stat(real);
          const hash = await fingerprint(real);
          const tags = readTags(real);
          const after = await fs.stat(real);
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            before.ino !== after.ino
          )
            throw new Error(
              "Library file changed during model scan; retry required",
            );
          const durationMs = tags.durationMs || file.durationMs;
          if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
            throw new Error("Missing track duration");
          collected.push({
            ...file,
            observedRealPath: real,
            size: after.size,
            durationMs,
            fingerprint: hash,
            hints: {
              genres: tags.genres,
              work: tags.work,
              composerDistinct:
                tags.composer.length > 0 &&
                !tags.composer.includes(tags.artist),
            },
          });
        }
        if (!jobs.checkpoint(job, { cursor, collected }, { leaseMs: 60_000 }))
          return;
      }
      const done = cursor === input.files.length;
      const committed = jobs.checkpoint(
        job,
        { cursor, collected },
        {
          done,
          leaseMs: 60_000,
          commit: done
            ? () => {
                const rows = reconcile(catalogue, {
                  version: 1,
                  complete: true,
                  instanceId: input.instanceId,
                  epoch: input.epoch,
                  generation: input.generation,
                  tracks: collected,
                });
                const albums = new Map();
                for (const row of rows) {
                  const albumTarget =
                    row.albumId == null
                      ? null
                      : catalogue.albumTarget(input.instanceId, row.albumId);
                  const albumPin =
                    albumTarget &&
                    catalogue.db
                      .prepare(
                        "SELECT state,pinned FROM classification WHERE target_id=?",
                      )
                      .get(albumTarget);
                  const inherited = albumPin?.pinned ? albumPin.state : null;
                  const state = classify(
                    catalogue,
                    row.id,
                    {
                      ...row.hints,
                      ...(inherited && { albumOverride: inherited }),
                    },
                    { inherited },
                  );
                  if (row.albumId != null) {
                    if (!albums.has(row.albumId)) albums.set(row.albumId, []);
                    albums.get(row.albumId).push(state);
                  }
                }
                for (const [albumId, states] of albums) {
                  const target = catalogue.albumTarget(
                    input.instanceId,
                    albumId,
                  );
                  // Mixed albums stay unsure as a whole; only their confirmed tracks opt in.
                  const state = states.every((s) => s === "classical")
                    ? "classical"
                    : states.every((s) => s === "not_classical")
                      ? "not_classical"
                      : "unsure";
                  const prior = catalogue.db
                    .prepare(
                      "SELECT pinned FROM classification WHERE target_id=?",
                    )
                    .get(target);
                  if (!prior?.pinned)
                    catalogue.db
                      .prepare(
                        `INSERT INTO classification VALUES (?,?,0,0,?,1,?)
            ON CONFLICT(target_id) DO UPDATE SET state=excluded.state,evidence=excluded.evidence,updated_at=excluded.updated_at`,
                      )
                      .run(
                        target,
                        state,
                        JSON.stringify({ trackStates: states }),
                        Date.now(),
                      );
                }
              }
            : undefined,
        },
      );
      if (committed && !done) jobs.yield(job);
    } catch (error) {
      jobs.fail(job, error.message);
      throw error;
    }
  } finally {
    catalogue.close();
  }
}

export async function cancelModelScan(ctx, actor) {
  if (actor?.role !== "admin")
    throw new Error("Cancelling model scans requires a current host admin");
  const catalogue = await openCatalogue(modelFolder(ctx));
  try {
    const jobs = new ModelJobs(catalogue);
    for (const row of catalogue.db
      .prepare(
        "SELECT id FROM model_job WHERE state IN ('queued','running','retry')",
      )
      .all())
      jobs.cancel(row.id);
  } finally {
    catalogue.close();
  }
}
