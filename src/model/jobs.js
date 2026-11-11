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
  claim(owner, { now = Date.now(), leaseMs = 30_000 } = {}) {
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
        ((state IN ('queued','retry') AND next_run_at<=?) OR (state='running' AND lease_until<=?)) ORDER BY created_at LIMIT 1`,
        )
        .get(now, now);
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
  checkpoint(
    job,
    progress,
    { done = false, now = Date.now(), leaseMs = 30_000, commit } = {},
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
        return false;
      }
      // Commit callback is synchronous SQL only, covered by the same fence/transaction.
      if (commit) commit();
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
