// Writing classical tags to files (v0.3 8.3-8.5), only ever by an admin:
//
//   preview  reads each chosen file and stores, per file, every planned
//            field's current and proposed value (tag-plan.js) with what can
//            and can't be written; nothing is changed.
//   write    for a stored preview, `confirm: true` and the enableTagWriting
//            setting: per file, re-read and stop if it changed since the
//            preview; save the old values in tag_backup; write (a copy
//            renamed into place, so a crash leaves the old or the new file);
//            read back; the audio fingerprint must not change.
//   restore  puts a run's or one file's old values back, when the file still
//            holds what was written.
//
// Runs are model jobs of type `tag_write` so their progress is kept, but
// they run only here, from an admin's request: ModelJobs.claim never hands
// one to a scan or the schedule. They hold the tagger's lock (withTagging,
// priority), so background tagging in any process pauses meanwhile.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readValues, writeTags, writableFields } from "../tags.js";
import { allowedPath, withTagging } from "../tagger.js";
import { proposedTags } from "./tag-plan.js";
import { AUDIO_PREFIX, fingerprint } from "./fingerprint.js";
import { openCatalogue } from "./catalogue.js";
import { ModelJobs } from "./jobs.js";

export const TAG_JOB = "tag_write";
export const PREVIEW_LIMIT = 500;
// A preview is a snapshot of files; one older than this is read again.
export const PREVIEW_TTL_MS = 60 * 60_000;
export const FIELD_LABELS = {
  composer: "Composer",
  composerSort: "Composer sort",
  work: "Work",
  movementName: "Movement",
  movementNumber: "Movement number",
  movementTotal: "Movements in the work",
  performers: "Performers",
  conductor: "Conductor",
  catalogue: "Catalogue number",
  workId: "MusicBrainz work",
};
export const STATUS = {
  change: "Will change",
  unchanged: "Already up to date",
  nothing: "Nothing to write",
  unsupported: "Format not supported yet",
  unreadable: "Couldn't be read",
  "read-only": "Read only",
  missing: "No longer in the Library",
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const writable = (file) => {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    // The new file is renamed into place, so its folder must be writable too.
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// One file's preview entry.
export function previewTrack(c, link) {
  const row = c.db.prepare("SELECT id,evidence FROM track_link WHERE id=? AND state='active'").get(link);
  if (!row) return { link, file: "", name: "", title: "", status: "missing", reason: STATUS.missing, fields: [] };
  const evidence = JSON.parse(row.evidence);
  const file = evidence.readPath || evidence.path || "";
  const name = path.basename(evidence.path || file);
  const base = { link, file, name, title: evidence.hints?.title || name, albumId: evidence.albumId == null ? null : String(evidence.albumId) };
  const plan = proposedTags(c, link);
  const planned = Object.keys(plan.fields);
  if (!planned.length) return { ...base, workId: plan.workId, status: "nothing", reason: plan.reason, fields: [] };
  const fields = writableFields(file);
  const entry = (field, current) => ({ field, current, proposed: plan.fields[field], writable: fields.includes(field) });
  if (!fields.length)
    return { ...base, workId: plan.workId, status: "unsupported", reason: `Classical tags can't be written to ${path.extname(file).slice(1).toUpperCase() || "these"} files yet`, fields: planned.map((field) => entry(field, null)) };
  let current;
  try {
    current = readValues(file, planned.filter((field) => fields.includes(field)));
  } catch (error) {
    return { ...base, workId: plan.workId, status: "unreadable", reason: String(error.message || error).slice(0, 200), fields: [] };
  }
  const entries = planned.map((field) => entry(field, fields.includes(field) ? current[field] : null));
  const changes = entries.filter((field) => field.writable && !same(field.current, field.proposed));
  const status = !changes.length ? "unchanged" : writable(file) ? "change" : "read-only";
  return { ...base, workId: plan.workId, status, reason: status === "read-only" ? "The file or its folder can't be written" : "", fields: entries };
}

// Reads every chosen file and keeps what it showed. Returns the token.
export function createPreview(c, links, who, { scope = "" } = {}) {
  const ids = [...new Set(links)];
  if (!ids.length) throw new Error("Choose tracks to preview");
  if (ids.length > PREVIEW_LIMIT) throw new Error(`Preview at most ${PREVIEW_LIMIT} files at a time`);
  const tracks = ids.map((id) => previewTrack(c, id));
  c.db.prepare("DELETE FROM change_set WHERE kind='tag_preview' AND created_at<?").run(Date.now() - 7 * 86_400_000);
  const token = randomUUID();
  const changing = tracks.filter((track) => track.status === "change").length;
  c.db
    .prepare("INSERT INTO change_set(id,kind,actor,summary,data,created_at) VALUES (?,?,?,?,?,?)")
    .run(token, "tag_preview", who, `${changing} of ${tracks.length} files would change`, JSON.stringify({ scope, tracks }), Date.now());
  return token;
}
export function loadPreview(c, token) {
  const row = c.db.prepare("SELECT data,created_at,actor FROM change_set WHERE id=? AND kind='tag_preview'").get(String(token || ""));
  return row ? { ...JSON.parse(row.data), createdAt: row.created_at, actor: row.actor } : null;
}

// Queues a write of a preview's changing files; the caller starts the run.
export function queueWrite(c, token, who, now = Date.now()) {
  const preview = loadPreview(c, token);
  if (!preview) throw new Error("This preview is gone. Open it again.");
  if (now - preview.createdAt > PREVIEW_TTL_MS) throw new Error("This preview is more than an hour old. Open it again so it shows the files as they are now.");
  const files = preview.tracks.filter((track) => track.status === "change").length;
  if (!files) throw new Error("No file in this preview would change.");
  const key = `${TAG_JOB}:${token}`;
  const prior = c.db.prepare("SELECT id FROM model_job WHERE key=? ORDER BY created_at DESC LIMIT 1").get(key);
  if (prior) return { id: prior.id, files, again: true };
  const id = new ModelJobs(c).enqueue(TAG_JOB, key, { mode: "write", preview: token, actor: who }, { maxAttempts: 3 });
  return { id, files, again: false };
}
// Queues putting a run's (or one file's) old values back.
export function queueRestore(c, { run = null, backup = null }, who) {
  const rows = backup
    ? c.db.prepare("SELECT id FROM tag_backup WHERE id=? AND restored_at IS NULL").all(String(backup))
    : c.db.prepare("SELECT id FROM tag_backup WHERE run_id=? AND restored_at IS NULL").all(String(run || ""));
  if (!rows.length) throw new Error(backup ? "This file's tags were restored already." : "Every file of this run was restored already.");
  const id = new ModelJobs(c).enqueue(TAG_JOB, `${TAG_JOB}:restore:${randomUUID()}`, { mode: "restore", backups: rows.map((row) => row.id), run, actor: who }, { maxAttempts: 3 });
  return { id, files: rows.length };
}

async function writeOne(ctx, c, job, session, entry, actor) {
  const real = await allowedPath(ctx, entry.file);
  if (!real) return { status: "failed", reason: "Not in the Library folder" };
  return session.state.exclusive(real, async () => {
    const fields = entry.fields.filter((field) => field.writable);
    const names = fields.map((field) => field.field);
    let now;
    try {
      now = readValues(real, names);
    } catch (error) {
      return { status: "failed", reason: `Couldn't be read: ${error.message}` };
    }
    // What the admin confirmed is what the preview showed.
    if (!same(now, Object.fromEntries(fields.map((field) => [field.field, field.current])))) return { status: "skipped", reason: "Its tags changed since the preview" };
    const proposed = Object.fromEntries(fields.map((field) => [field.field, field.proposed]));
    if (same(now, proposed)) return { status: "unchanged" };
    const before = await fingerprint(real);
    const backup = randomUUID();
    c.db.prepare("INSERT INTO tag_backup VALUES (?,?,?,?,?,?,?,?,?,?)").run(backup, entry.link, real, before, JSON.stringify(now), JSON.stringify(proposed), job.id, actor || "admin", Date.now(), null);
    try {
      await writeTags(real, proposed);
    } catch (error) {
      // writeTags replaces the file only once its copy verified: unchanged.
      c.db.prepare("DELETE FROM tag_backup WHERE id=?").run(backup);
      return { status: "failed", reason: String(error.message || error).slice(0, 200) };
    }
    session.changedFiles++;
    const after = await fingerprint(real);
    const read = readValues(real, names);
    if (!same(read, proposed) || (before?.startsWith(AUDIO_PREFIX) && after !== before)) {
      await writeTags(real, now);
      c.db.prepare("UPDATE tag_backup SET restored_at=? WHERE id=?").run(Date.now(), backup);
      return { status: "failed", reason: !same(read, proposed) ? "The written tags didn't read back; the old ones were put back" : "The audio changed; the old tags were put back" };
    }
    return { status: "written", backup };
  });
}

async function restoreOne(ctx, c, session, backup) {
  const row = c.db.prepare("SELECT * FROM tag_backup WHERE id=?").get(backup);
  if (!row) return { status: "failed", reason: "No backup" };
  const base = { link: row.track_link_id, name: path.basename(row.path), backup };
  if (row.restored_at) return { ...base, status: "unchanged", reason: "Restored already" };
  const real = await allowedPath(ctx, row.path);
  if (!real) return { ...base, status: "failed", reason: "Not in the Library folder" };
  return session.state.exclusive(real, async () => {
    const written = JSON.parse(row.written);
    const old = JSON.parse(row.tags);
    let now;
    try {
      now = readValues(real, Object.keys(written));
    } catch (error) {
      return { ...base, status: "failed", reason: `Couldn't be read: ${error.message}` };
    }
    if (!same(now, written)) return { ...base, status: "skipped", reason: "Its tags changed since they were written; nothing was put back" };
    await writeTags(real, old);
    session.changedFiles++;
    if (!same(readValues(real, Object.keys(old)), old)) return { ...base, status: "failed", reason: "The old tags didn't read back" };
    c.db.prepare("UPDATE tag_backup SET restored_at=? WHERE id=?").run(Date.now(), backup);
    return { ...base, status: "restored" };
  });
}

// A run that can't go ahead stops for good: retried later, it would write a
// preview older than the files.
const stop = (c, job, error) =>
  c.db.prepare("UPDATE model_job SET state='failed',error=?,lease_until=0 WHERE id=? AND owner=? AND generation=? AND state='running'").run(error, job.id, job.owner, job.generation);

async function runOne(ctx, c, jobs, job, session, deadline) {
  const input = job.input;
  const progress = { cursor: 0, results: [], ...job.progress };
  let items;
  if (input.mode === "write") {
    if (ctx.settings?.enableTagWriting !== true) return stop(c, job, "Tag writing is off in the plugin's settings");
    const preview = loadPreview(c, input.preview);
    if (!preview) return stop(c, job, "The preview is gone");
    items = preview.tracks.filter((track) => track.status === "change");
  } else if (input.mode === "restore") items = input.backups || [];
  else return stop(c, job, "Unknown tag job");
  progress.total = items.length;
  while (progress.cursor < items.length) {
    if (Date.now() >= deadline) {
      jobs.checkpoint(job, progress, { leaseMs: 120_000 });
      jobs.yield(job);
      return;
    }
    const item = items[progress.cursor];
    let result;
    try {
      result =
        input.mode === "write"
          ? { link: item.link, name: item.name, ...(await writeOne(ctx, c, job, session, item, input.actor)) }
          : await restoreOne(ctx, c, session, item);
    } catch (error) {
      result = { link: item.link, name: item.name || "", status: "failed", reason: String(error.message || error).slice(0, 200) };
    }
    progress.results.push(result);
    progress.cursor++;
    jobs.checkpoint(job, progress, { leaseMs: 120_000 });
  }
  jobs.checkpoint(job, progress, { done: true, leaseMs: 120_000 });
}

// Runs queued tag jobs for up to `budgetMs`. False when another process holds
// the tagging lock and didn't pause: the jobs wait for the next request.
export async function runTagJobs(ctx, { budgetMs = 25 * 60_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const stats = await withTagging(
    ctx,
    async (session) => {
      const c = await openCatalogue(path.join(ctx.dataFolder, "model"));
      c.db.exec("PRAGMA busy_timeout=60000");
      try {
        const jobs = new ModelJobs(c);
        const owner = randomUUID();
        for (let job; Date.now() < deadline && (job = jobs.claim(owner, { leaseMs: 120_000, type: TAG_JOB })); ) await runOne(ctx, c, jobs, job, session, deadline);
      } finally {
        c.close();
      }
    },
    { priority: true },
  );
  return stats !== null;
}

export function tagRun(c, id) {
  const row = c.db.prepare("SELECT * FROM model_job WHERE id=? AND type=?").get(String(id || ""), TAG_JOB);
  if (!row) return null;
  return { id: row.id, state: row.state, error: row.error, input: JSON.parse(row.input), progress: JSON.parse(row.progress || "{}"), createdAt: row.created_at };
}
