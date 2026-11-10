import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { json } from "./catalogue.js";

const providerOrder = { musicbrainz: 0, openopus: 1 };
export class Metadata {
  constructor(catalogue) {
    this.catalogue = catalogue;
    this.db = catalogue.db;
  }
  validate(target, field, value) {
    if (
      !this.db.prepare("SELECT 1 FROM metadata_target WHERE id=?").get(target)
    )
      throw new Error("Unknown metadata target");
    const definition = this.db
      .prepare("SELECT type FROM field_definition WHERE key=?")
      .get(field);
    const type = Array.isArray(value) ? "array" : typeof value;
    if (
      !definition ||
      value === undefined ||
      (value !== null &&
        (type !== definition.type ||
          (type === "number" && !Number.isFinite(value))))
    )
      throw new Error("Invalid metadata field/value");
    // Round-trip catches unsupported JSON data rather than storing undefined/NaN as blanks.
    if (JSON.stringify(JSON.parse(json(value))) !== json(value))
      throw new Error("Invalid JSON value");
  }
  append(
    target,
    field,
    value,
    {
      source,
      provider = null,
      recordId = null,
      confidence = null,
      actor = null,
      state = "active",
    },
  ) {
    this.validate(target, field, value);
    const prior = this.db
      .prepare(
        `SELECT id FROM assertion WHERE target_id=? AND field=? AND source=?
      AND provider IS ? AND record_id IS ? AND state!='superseded' ORDER BY rowid DESC LIMIT 1`,
      )
      .get(target, field, source, provider, recordId);
    if (prior)
      this.db
        .prepare("UPDATE assertion SET state='superseded' WHERE id=?")
        .run(prior.id);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO assertion VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        target,
        field,
        json(value),
        source,
        provider,
        recordId,
        state,
        confidence,
        actor,
        Date.now(),
        prior?.id ?? null,
      );
    return id;
  }
  // Editing a provider-filled field pins automatically. Explicit pin=false cannot undo this.
  manual(target, field, value, { actor, pin = false } = {}) {
    if (typeof actor !== "string" || !actor)
      throw new Error("Manual edits require host actor attribution");
    return transaction(this.db, () => {
      const provider = this.db
        .prepare(
          "SELECT 1 FROM assertion WHERE target_id=? AND field=? AND source='provider'",
        )
        .get(target, field);
      const existingPin = this.db
        .prepare("SELECT 1 FROM pinned_override WHERE target_id=? AND field=?")
        .get(target, field);
      const id = this.append(target, field, value, { source: "manual", actor });
      if (pin || provider || existingPin)
        this.db
          .prepare(
            `INSERT INTO pinned_override VALUES (?,?,?,?,?)
        ON CONFLICT(target_id,field) DO UPDATE SET assertion_id=excluded.assertion_id,actor=excluded.actor,updated_at=excluded.updated_at`,
          )
          .run(target, field, id, actor, Date.now());
      this.catalogue.audit(
        "metadata.manual",
        target,
        { field, assertionId: id },
        actor,
      );
      return this.resolve(target, field);
    });
  }
  derived(target, field, value) {
    return transaction(this.db, () => {
      this.append(target, field, value, { source: "derived" });
      return this.resolve(target, field);
    });
  }
  refresh(
    target,
    provider,
    recordId,
    fields,
    { state = "active", confidence = 1, complete = true } = {},
  ) {
    if (
      !Object.hasOwn(providerOrder, provider) ||
      !recordId ||
      !fields ||
      Array.isArray(fields) ||
      typeof fields !== "object" ||
      !["active", "stale", "deleted", "conflict"].includes(state) ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    )
      throw new Error("Invalid provider refresh");
    return transaction(this.db, () => {
      const known = this.db
        .prepare(
          "SELECT DISTINCT field FROM assertion WHERE target_id=? AND provider=? AND record_id=?",
        )
        .all(target, provider, recordId)
        .map((r) => r.field);
      const affected = new Set([...known, ...Object.keys(fields)]);
      // Materialize the prior display so stale/deleted responses cannot choose another provider silently.
      for (const field of affected) this.resolve(target, field);
      if (confidence < 0.95) {
        this.catalogue.review("provider_match", target, {
          provider,
          recordId,
          confidence,
          fields,
        });
        return { review: true };
      }
      if (state !== "active") {
        this.db
          .prepare(
            "UPDATE assertion SET state=? WHERE target_id=? AND provider=? AND record_id=? AND state!='superseded'",
          )
          .run(state, target, provider, recordId);
        this.catalogue.review("provider_state", target, {
          provider,
          recordId,
          state,
        });
      } else {
        for (const [field, value] of Object.entries(fields))
          this.append(target, field, value, {
            source: "provider",
            provider,
            recordId,
            confidence,
          });
        if (complete)
          for (const field of known.filter((f) => !Object.hasOwn(fields, f))) {
            this.db
              .prepare(
                "UPDATE assertion SET state='stale' WHERE target_id=? AND field=? AND provider=? AND record_id=? AND state!='superseded'",
              )
              .run(target, field, provider, recordId);
            this.catalogue.review("provider_omission", target, {
              provider,
              recordId,
              field,
            });
          }
      }
      this.db
        .prepare(
          `INSERT INTO provider_record VALUES (?,?,?,?,?) ON CONFLICT(provider,record_id,target_id)
        DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`,
        )
        .run(provider, recordId, target, state, Date.now());
      const result = Object.fromEntries(
        [...affected].map((field) => [field, this.resolve(target, field)]),
      );
      this.catalogue.audit("provider.refresh", target, {
        provider,
        recordId,
        state,
      });
      return result;
    });
  }
  useProvider(target, field, { actor } = {}) {
    if (!actor) throw new Error("Unpin requires host actor attribution");
    return transaction(this.db, () => {
      this.db
        .prepare("DELETE FROM pinned_override WHERE target_id=? AND field=?")
        .run(target, field);
      this.catalogue.audit("metadata.unpin", target, { field }, actor);
      return this.resolve(target, field, { acceptProviderChange: true });
    });
  }
  resolve(target, field, { acceptProviderChange = false } = {}) {
    return transaction(this.db, () =>
      this.resolveField(target, field, { acceptProviderChange }),
    );
  }
  resolveField(target, field, { acceptProviderChange = false } = {}) {
    const pin = this.db
      .prepare(
        "SELECT assertion_id FROM pinned_override WHERE target_id=? AND field=?",
      )
      .get(target, field);
    const rows = this.db
      .prepare(
        "SELECT *,rowid AS ordinal FROM assertion WHERE target_id=? AND field=? AND state='active' ORDER BY rowid DESC",
      )
      .all(target, field);
    const providers = rows
      .filter((r) => r.source === "provider")
      .sort(
        (a, b) =>
          providerOrder[a.provider] - providerOrder[b.provider] ||
          b.ordinal - a.ordinal,
      );
    const previous = this.db
      .prepare(
        `SELECT a.* FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
      WHERE f.target_id=? AND f.field=?`,
      )
      .get(target, field);
    let chosen;
    if (pin)
      chosen = this.db
        .prepare("SELECT * FROM assertion WHERE id=?")
        .get(pin.assertion_id);
    else if (
      !acceptProviderChange &&
      previous?.source === "provider" &&
      ["stale", "deleted", "conflict"].includes(previous.state)
    )
      chosen = previous;
    else
      chosen =
        providers[0] ||
        rows.find((r) => r.source === "manual") ||
        rows.find((r) => r.source === "derived");
    if (
      providers.length > 1 &&
      providers.some((r) => r.value !== providers[0].value)
    )
      this.catalogue.review("provider_conflict", target, {
        field,
        assertions: providers.map((r) => r.id),
      });
    if (!chosen)
      return {
        value: undefined,
        source: "unknown",
        pinned: false,
        providerValue: undefined,
      };
    this.db
      .prepare(
        `INSERT INTO field_resolution VALUES (?,?,?) ON CONFLICT(target_id,field)
      DO UPDATE SET assertion_id=excluded.assertion_id`,
      )
      .run(target, field, chosen.id);
    return {
      value: JSON.parse(chosen.value),
      source: chosen.source,
      provider: chosen.provider,
      recordId: chosen.record_id,
      pinned: !!pin,
      updatedAt: chosen.updated_at,
      confidence: chosen.confidence,
      state: chosen.state,
      assertionId: chosen.id,
      providerValue: providers[0] ? JSON.parse(providers[0].value) : undefined,
    };
  }
}
