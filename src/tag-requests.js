// Tag requests (v0.3 8.7, review E6/B12): the album and artist menu actions
// Tag as classical, Restore original tags and Clear classical tags no longer
// write when chosen. They plan, with the tagger's own rules and lookups, what
// each file would get, keep that plan here, and say so. An admin reads the
// plan in the editor (Activity → Tag requests) and confirms it; only then
// are files written, each re-read first and left alone if it changed, with
// exactly the values the plan showed. Background tagging is unchanged and
// stays behind `enableFileWrites`.
//
// Plans are files in the plugin's data folder, not the catalogue: legacy
// tagging never creates the catalogue database.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { isAudioPath, readValues } from "./tags.js";
import { allowedPath, describeStats, withTagging } from "./tagger.js";

export const MODES = { tag: "Tag as classical", restore: "Restore original tags", clear: "Clear classical tags" };
const KEEP_MS = 7 * 86_400_000;
const ID = /^[0-9a-f-]{36}$/;
const folder = (ctx) => path.join(ctx.dataFolder, "tag-requests");
const fileOf = (ctx, id) => path.join(folder(ctx), `${id}.json`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The message an untag run gives, as the actions always have.
export function untagMessage(counts, what, mode) {
  const parts = [`${counts.restored} restored`];
  if (counts.cleared) parts.push(`${counts.cleared} cleared${mode === "clear" ? " (existing backups retained)" : " (original tags unavailable)"}`);
  if (counts.unchanged) parts.push(`${counts.unchanged} already had no classical tags`);
  if (counts["no backup"]) parts.push(`${counts["no backup"]} couldn't be restored (no backup, and MusicBrainz has no credit)`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.changed) parts.push(`${counts.changed} skipped (changed since the request)`);
  if (counts.left) parts.push(`${counts.left} left: run it again`);
  return `${what}: ${parts.join(", ")}. The plugin won't tag these recordings again unless you tag them as classical.`.slice(0, 500);
}

function save(ctx, request) {
  fs.mkdirSync(folder(ctx), { recursive: true });
  const target = fileOf(ctx, request.id);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(request));
  fs.renameSync(`${target}.tmp`, target);
}

export function readRequest(ctx, id) {
  if (!ID.test(String(id || ""))) return null;
  try {
    return JSON.parse(fs.readFileSync(fileOf(ctx, id), "utf8"));
  } catch {
    return null;
  }
}

// Newest first; requests older than a week are removed.
export function listRequests(ctx) {
  let names = [];
  try {
    names = fs.readdirSync(folder(ctx)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const request = readRequest(ctx, name.slice(0, -5));
    if (!request) continue;
    if (Date.now() - request.createdAt > KEEP_MS) fs.rmSync(fileOf(ctx, request.id), { force: true });
    else out.push(request);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
}

// Plans `mode` ("tag", "restore" or "clear") for `paths`; writes nothing.
export async function requestTags(ctx, paths, { mode, what, actor }) {
  if (!MODES[mode]) throw new Error("Unknown tag request");
  if (!paths.length) return { message: mode === "tag" ? `No files to tag in ${what}` : `No files in ${what}` };
  const plan = [];
  let unreachable = false;
  const stats = await withTagging(
    ctx,
    async (session) => {
      for (const file of paths) {
        const real = await allowedPath(ctx, file);
        if (!real || !isAudioPath(real)) {
          plan.push({ file, status: "skipped", reason: real ? "not an audio file" : "outside the Library" });
          continue;
        }
        if (mode === "tag") {
          if (!(await session.processReal(real, { force: true, plan }))) {
            unreachable = true;
            break;
          }
        } else await session.untagReal(real, mode, { plan });
      }
    },
    { priority: true },
  );
  if (!stats) return { message: "Tagging is busy. Try again in a few minutes." };
  const files = plan.map((entry) => (entry.status === "planned" ? { ...entry, status: same(entry.current, entry.values) ? "unchanged" : "change" } : entry));
  const count = (status) => files.filter((entry) => entry.status === status).length;
  const changing = count("change");
  // Skips by reason, as the tagger reports them: "1 skipped (non-classical)".
  const reasons = {};
  for (const entry of files) if (entry.status === "skipped") reasons[entry.reason] = (reasons[entry.reason] || 0) + 1;
  const notes = [
    count("unchanged") && `${count("unchanged")} already right`,
    ...Object.entries(reasons).map(([reason, n]) => `${n} skipped (${reason})`),
    unreachable && "MusicBrainz couldn't be reached, so the rest wait",
  ].filter(Boolean);
  if (!changing) return { message: `${what}: nothing to write${notes.length ? ` (${notes.join(", ")})` : ""}.`.slice(0, 500) };
  const request = { id: randomUUID(), mode, what, actor: String(actor?.id ?? ""), createdAt: Date.now(), state: "waiting", files };
  save(ctx, request);
  return {
    id: request.id,
    message: `${what}: nothing written yet. ${changing} file${changing === 1 ? "" : "s"} would change${notes.length ? `; ${notes.join(", ")}` : ""}. To write them, open Classical metadata → Activity → Tag requests and confirm.`.slice(0, 500),
  };
}

// Writes a request's planned values, file by file, once.
export async function applyRequest(ctx, id, actor) {
  const request = readRequest(ctx, id);
  if (!request) throw new Error("This tag request is gone. Choose the action again.");
  if (request.state !== "waiting") return { message: request.message || "This tag request was written already." };
  request.state = "writing";
  save(ctx, request);
  const counts = { restored: 0, cleared: 0, unchanged: 0, "no backup": 0, skipped: 0, changed: 0, left: 0 };
  let session;
  const stats = await withTagging(
    ctx,
    async (current) => {
      session = current;
      for (const entry of request.files) {
        if (entry.status !== "change") continue;
        const real = await allowedPath(ctx, entry.file);
        if (!real) {
          entry.result = { status: "skipped", reason: "outside the Library" };
          counts.skipped++;
          continue;
        }
        entry.result = await session.state
          .exclusive(real, async () => {
          let now;
          try {
            now = readValues(real, Object.keys(entry.values));
          } catch {
            return { status: "skipped", reason: "unreadable" };
          }
          // What the admin confirmed is what the request showed.
          if (!same(now, entry.current)) return { status: "skipped", reason: "changed since the request", changed: true };
          if (request.mode === "tag") {
            await session.processReal(real, { force: true, values: entry.values });
            const record = session.processed[real];
            return { status: record?.status || "failed", reason: record?.reason };
          }
          return { status: await session.untagReal(real, request.mode, { values: entry.values }) };
          })
          // A file that can't be written is left as it was (writeTags
          // replaces it only once its copy is verified) and counted.
          .catch((error) => {
            ctx.log(`Couldn't write tags to ${real}: ${error.message}`);
            if (request.mode === "tag") session.stats.failed++;
            return { status: "skipped", reason: String(error.message || error).slice(0, 200) };
          });
        if (entry.result.changed) {
          counts.changed++;
          session.stats.skipped["changed since the request"] = (session.stats.skipped["changed since the request"] || 0) + 1;
        } else if (request.mode !== "tag") counts[entry.result.status] = (counts[entry.result.status] || 0) + 1;
      }
    },
    { priority: true },
  );
  if (!stats) {
    request.state = "waiting";
    save(ctx, request);
    return { message: "Tagging is busy. Try again in a few minutes." };
  }
  request.state = "done";
  request.writtenAt = Date.now();
  request.writtenBy = String(actor?.id ?? "");
  request.message = request.mode === "tag" ? `${request.what}: ${describeStats(stats)}`.slice(0, 500) : untagMessage(counts, request.what, request.mode);
  save(ctx, request);
  return { message: request.message };
}

// Removes a request without writing it.
export async function discardRequest(ctx, id) {
  if (!ID.test(String(id || ""))) throw new Error("This tag request is gone.");
  await fsp.rm(fileOf(ctx, id), { force: true });
}
