import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";

// Leases use a generation fence, not a process-local mutex or expiring directory.
export class ModelJobs {
  constructor(catalogue) {
    this.db = catalogue.db;
  }
  enqueue(type, key, input, { maxAttempts = 3 } = {}) {
    if (!type || !key || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
      throw new Error("Invalid job");
    return transaction(this.db, () => {
      const existing = this.db
        .prepare(
          "SELECT id FROM model_job WHERE key=? AND state IN ('queued','running','retry')",
        )
        .get(key);
      if (existing) return existing.id;
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO model_job(id,type,key,input,state,max_attempts,created_at)
        VALUES (?,?,?,?,'queued',?,?)`,
        )
        .run(id, type, key, JSON.stringify(input), maxAttempts, Date.now());
      return id;
    });
  }
  // A scan goes before background identification; `type` claims only that kind.
  claim(owner, { now = Date.now(), leaseMs = 30_000, type = null } = {}) {
    if (!owner || !Number.isFinite(leaseMs) || leaseMs <= 0)
      throw new Error("Invalid job lease");
    return transaction(this.db, () => {
      this.db
        .prepare(
          "UPDATE model_job SET state='cancelled' WHERE cancel_requested=1 AND (state!='running' OR lease_until<=?)",
        )
        .run(now);
      this.db
        .prepare(
          "UPDATE model_job SET state='failed',error='ATTEMPTS_EXHAUSTED' WHERE attempt>=max_attempts AND state='running' AND lease_until<=?",
        )
        .run(now);
      const row = this.db
        .prepare(
          `SELECT * FROM model_job WHERE cancel_requested=0 AND attempt<max_attempts AND
        ((state IN ('queued','retry') AND next_run_at<=?) OR (state='running' AND lease_until<=?))
        ${type ? "AND type=?" : ""} ORDER BY type='library_scan' DESC,created_at LIMIT 1`,
        )
        .get(now, now, ...(type ? [type] : []));
      if (!row) return null;
      this.db
        .prepare(
          "UPDATE model_job SET state='running',owner=?,lease_until=?,generation=generation+1,attempt=attempt+1,error=NULL WHERE id=?",
        )
        .run(owner, now + leaseMs, row.id);
      return this.get(row.id);
    });
  }
  get(id) {
    const row = this.db.prepare("SELECT * FROM model_job WHERE id=?").get(id);
    return (
      row && {
        ...row,
        input: JSON.parse(row.input),
        progress: JSON.parse(row.progress),
      }
    );
  }
  // Evidence a scan has read, saved a chunk at a time with each checkpoint
  // so a checkpoint never rewrites everything read so far. Chunks are
  // model_job rows of their own (no schema change), never claimed: they are
  // born 'done'.
  static chunkKey = (id) => `scan-chunk:${id}`;
  chunks(id, count) {
    return this.db
      .prepare("SELECT input FROM model_job WHERE key=? ORDER BY id LIMIT ?")
      .all(ModelJobs.chunkKey(id), count)
      .flatMap((row) => JSON.parse(row.input));
  }
  // A finished or cancelled scan keeps only its summary: the file list and
  // the evidence it read are already in the catalogue, and keeping them made
  // every scan add tens of megabytes that integrity checks then had to read.
  compactFinished() {
    for (const row of this.db
      .prepare(
        `SELECT id,state FROM model_job WHERE type='library_scan' AND state IN ('done','cancelled')
         AND (length(input)>4096 OR length(progress)>65536 OR EXISTS(SELECT 1 FROM model_job c WHERE c.key='scan-chunk:'||model_job.id))`,
      )
      .all())
      transaction(this.db, () => this.#compact(row.id));
  }
  #compact(id) {
    this.db.prepare("DELETE FROM model_job WHERE key=?").run(ModelJobs.chunkKey(id));
    this.db
      .prepare(
        `UPDATE model_job SET
          input=json_object('instanceId',json_extract(input,'$.instanceId'),'epoch',json_extract(input,'$.epoch'),
            'generation',json_extract(input,'$.generation'),'total',coalesce(json_extract(input,'$.total'),json_array_length(input,'$.files'))),
          progress=json_object('cursor',coalesce(json_extract(progress,'$.cursor'),0),'errorCount',coalesce(json_extract(progress,'$.errorCount'),0),
            'reused',coalesce(json_extract(progress,'$.reused'),0),
            'errors',json(coalesce(json_extract(progress,'$.errors'),'[]')))
         WHERE id=?`,
      )
      .run(id);
  }
  checkpoint(
    job,
    progress,
    { done = false, now = Date.now(), leaseMs = 30_000, commit, chunk = null } = {},
  ) {
    return transaction(this.db, () => {
      // Do not parse the full library snapshot and collected evidence at every checkpoint.
      const row = this.db
        .prepare(
          "SELECT state,owner,generation,lease_until,cancel_requested FROM model_job WHERE id=?",
        )
        .get(job.id);
      if (
        !row ||
        row.state !== "running" ||
        row.owner !== job.owner ||
        row.generation !== job.generation ||
        row.lease_until <= now
      )
        throw new Error("Stale job lease");
      if (row.cancel_requested) {
        this.db
          .prepare("UPDATE model_job SET state='cancelled' WHERE id=?")
          .run(job.id);
        if (job.type === "library_scan") this.#compact(job.id);
        return false;
      }
      // Commit callback is synchronous SQL only, covered by the same fence/transaction.
      if (commit) commit();
      if (chunk?.items.length && !done)
        this.db
          .prepare(
            `INSERT INTO model_job(id,type,key,input,state,max_attempts,created_at)
             VALUES (?,'scan_chunk',?,?,'done',1,?)`,
          )
          .run(`${job.id}#${String(chunk.seq).padStart(6, "0")}`, ModelJobs.chunkKey(job.id), JSON.stringify(chunk.items), now);
      this.db
        .prepare(
          "UPDATE model_job SET progress=?,state=?,lease_until=?,error=NULL WHERE id=?",
        )
        .run(
          JSON.stringify(progress),
          done ? "done" : "running",
          now + leaseMs,
          job.id,
        );
      if (done && job.type === "library_scan") this.#compact(job.id);
      return true;
    });
  }
  yield(job) {
    this.db
      .prepare(
        `UPDATE model_job SET state='queued',owner=NULL,lease_until=0,attempt=attempt-1
      WHERE id=? AND owner=? AND generation=? AND state='running'`,
      )
      .run(job.id, job.owner, job.generation);
  }
  fail(job, error, { now = Date.now() } = {}) {
    this.db
      .prepare(
        `UPDATE model_job SET state=CASE WHEN attempt>=max_attempts THEN 'failed' ELSE 'retry' END,
      error=?,next_run_at=?,lease_until=0 WHERE id=? AND owner=? AND generation=? AND state='running' AND lease_until>?`,
      )
      .run(
        String(error).slice(0, 500),
        now + 1000 * 2 ** job.attempt,
        job.id,
        job.owner,
        job.generation,
        now,
      );
  }
  cancel(id) {
    this.db
      .prepare(
        "UPDATE model_job SET cancel_requested=1 WHERE id=? AND state IN ('queued','running','retry')",
      )
      .run(id);
  }
}
