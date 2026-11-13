// Read-only: where a library scan spends its time.
//
//   node scripts/scan-timing.mjs <plugin data folder>/model [sample size]
//
// Prints the last scans (state, files, files reused without opening,
// unreadable files, how long they have run), then takes a sample of indexed
// files and, for each, says whether a rescan would reuse it (and if not,
// which check failed) and times each step a scan takes for it: resolving
// the path, stat, reading tags, hashing the audio. Never writes: the
// catalogue opens read-only and media files are only read.
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readTags } from "../src/tags.js";
import { fingerprint } from "../src/model/fingerprint.js";

const [folder, sampleArg = "200"] = process.argv.slice(2);
if (!folder) {
  console.error("Usage: node scripts/scan-timing.mjs <model folder> [sample size]");
  process.exit(1);
}
const db = new DatabaseSync(path.join(folder, "classical.sqlite"), { readOnly: true });
const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;

console.log("## Last scans");
for (const job of db
  .prepare("SELECT id,state,created_at,input,progress,lease_until FROM model_job WHERE type='library_scan' ORDER BY created_at DESC LIMIT 5")
  .all()) {
  const input = JSON.parse(job.input);
  const progress = JSON.parse(job.progress);
  const total = input.total ?? input.files?.length ?? "?";
  console.log(
    `- ${new Date(job.created_at).toISOString()} ${job.state}: ${progress.cursor ?? 0}/${total} files, reused ${progress.reused ?? "not counted (before 1.0.31)"}, unreadable ${progress.errorCount ?? 0}; ${job.state === "running" ? `running ${minutes(Date.now() - job.created_at)}` : `last activity ${minutes(Math.max(0, job.lease_until - 60_000 - job.created_at))} after start`}`,
  );
}

const links = db.prepare("SELECT evidence FROM track_link WHERE state='active'").all().map((row) => JSON.parse(row.evidence));
console.log(`\n## Indexed files: ${links.length}`);
const sample = links.filter((_, i) => i % Math.max(1, Math.floor(links.length / Number(sampleArg))) === 0).slice(0, Number(sampleArg));
const reasons = new Map();
const timing = { realpath: 0, stat: 0, readTags: 0, fingerprint: 0 };
const time = async (step, run) => {
  const start = performance.now();
  try {
    return await run();
  } finally {
    timing[step] += performance.now() - start;
  }
};
let failed = 0;
for (const prior of sample) {
  try {
    const real = await time("realpath", () => fs.realpath(prior.readPath || prior.path));
    const stat = await time("stat", () => fs.stat(real));
    const why =
      prior.ctimeMs == null
        ? "no ctime stored (last scan before 1.0.31)"
        : prior.observedRealPath !== real
          ? "path differs"
          : prior.size !== stat.size
            ? "size differs"
            : prior.mtimeMs !== stat.mtimeMs
              ? "modified time differs"
              : prior.ctimeMs !== stat.ctimeMs
                ? `ctime differs (stored ${new Date(prior.ctimeMs).toISOString()}, now ${stat.ctime.toISOString()})`
                : prior.hints?.tagsUnreadable
                    ? "tags were unreadable"
                  : `reusable (if the host lists it the same way)${prior.ino !== stat.ino ? "; its inode number changed, which 1.0.33 ignores" : ""}`;
    const key = why.replace(/ \(stored.*$/, "");
    reasons.set(key, [...(reasons.get(key) || []), why]);
    await time("readTags", async () => readTags(real));
    await time("fingerprint", () => fingerprint(real));
  } catch (error) {
    failed++;
    reasons.set(`error: ${error.code || error.message}`, [...(reasons.get(`error: ${error.code || error.message}`) || []), ""]);
  }
}
console.log(`\n## Would a rescan reuse them? (sample of ${sample.length})`);
for (const [reason, list] of [...reasons].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`- ${reason}: ${list.length}`);
  if (reason.startsWith("ctime")) for (const example of list.slice(0, 3)) console.log(`  - ${example}`);
}
const done = sample.length - failed;
console.log(`\n## Time per file (average of ${done}; whole library of ${links.length} at that rate)`);
for (const [step, ms] of Object.entries(timing))
  console.log(`- ${step}: ${(ms / Math.max(1, done)).toFixed(1)} ms per file, ${minutes((ms / Math.max(1, done)) * links.length)} for the library`);
db.close();
