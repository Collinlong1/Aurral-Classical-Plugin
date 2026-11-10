# Classical model version 1

Phase 2 implements the backend model. The manual editor, album grouping and work pages remain Phases 3 and 4.

## Storage and identity

`dataFolder/model/classical.sqlite` belongs exclusively to the plugin. SQLite uses WAL, foreign keys, full synchronous commits and a five-second busy timeout. Node 22.16 or newer supplies `node:sqlite` and its online backup API; no native package or additional service is required. The current dev image is Node 26.12. The SQLite import is lazy: unsupported runtimes produce a model error without stopping established playback or source actions.

Catalogue entities have random internal UUIDs and a checked kind: person, ensemble, work, movement, collection, performance, recording or release. Composer is a person credited as composer. `Catalogue` in `src/model/catalogue.js` is the internal backend repository API, not an unauthenticated network API. `createEntity('work')` needs no external identifier. Editable display metadata belongs in `Metadata` assertions; `entity.data` holds structural attributes such as partial event dates and recording duration.

The executable schema is `src/model/schema.js`. Common typed entities and checked relation edges implement the draft's subtype/link tables. Movement membership is exclusive; collection membership rejects cycles; performances and works have repeated occurrences; recordings can capture several performances and appear on several releases. Release placements and playable track links are separate. Segments use track-local coordinates; recording content uses recording coordinates. Realizations cannot mix performances or wrong-parent movements. Explicit repeated occurrences and overlap approval are required for repeated/overlapping play spans. No segment playback hook is introduced.

Aliases, catalogue numbers, role credits, external identity evidence, review items and audit history are plugin-owned. Low-confidence provider identity assignments and conflicting identity mappings create review items; they never merge local entities. Structural mutators are trusted internal methods; future editor endpoints must authorize through the host before calling them. Entity merges and their UI are deferred.

## Metadata precedence

`Metadata.manual`, `derived`, `refresh`, `resolve` and `useProvider` implement:

1. Pinned manual assertion, including empty strings, empty lists and intentional nulls.
2. Active provider assertion: MusicBrainz before Open Opus for fields they actually supply.
3. Unpinned manual assertion.
4. Derived assertion, or unknown.

Every assertion retains source, provider record, timestamp, confidence, actor, state and prior assertion. Editing a previously provider-filled field pins automatically. Refresh appends provider history and never changes the pin. Unpin is explicit and audited. Conflicting providers are retained for review. A stale, deleted, conflicting or omitted provider value stays displayed with its status rather than silently switching to a different provider. Refresh is an atomic storage operation, not a network client; this phase does not start automatic MusicBrainz/Open Opus identification or import their catalogues.

## Rescans and classification

The admin-only **Scan classical model (read only)** album action queues a full-library scan using the Phase 1 delegated snapshot. The selected album is only the host action entry point. Non-admins cannot run it; stock hosts without the delegated capability fail before creating a job. **Classical model status** and **Cancel classical model scan** are admin actions. The schedule resumes existing jobs; enabling the plugin never starts identification or a scan. Scans read media and write only plugin storage. Existing JSON caches, exclusions and tag backups are not imported, rewritten or deleted.

The scanner uses one file reader, persists cursor/evidence batches and publishes reconciliation/classification only when the complete scan succeeds. Jobs have deduplicated keys, bounded attempts, retry delay, cancellation, leases and generation fencing. A stale worker cannot publish its result. SQLite transactions never span file reads or provider calls. A failed/incomplete scan does not mark old tracks missing. Status reports durable job states; queued is not reported as completed.

The plugin establishes an installation binding in its own data folder. The Phase 1 host does not expose a database epoch; change the **Library database epoch** setting after replacing/restoring the host database or moving plugin data to another installation. Epoch changes hold old links for review. There is no claim of automatic host-restore detection. File paths must resolve under the configured library root; external mapped roots are refused rather than scanned implicitly.

Unchanged core track/file identities must agree with path, size and duration. Unique versioned full-file SHA-256 evidence supports renames and moves even if core IDs change. The internal reconciliation API also accepts namespaced stable-file identifiers. Fingerprint or duration disagreement rejects a candidate. Several matching files or old links become ambiguous, never a first-match assignment. Titles and MusicBrainz recording IDs cannot choose a file. Missing links retain their metadata and catalogue associations. Full-file hashes change after retagging; such a move/retag needs review unless separate sufficient evidence exists. Audio-only fingerprint extraction is not implemented.

Scored classification stores classical/not_classical/unsure per track and aggregate album decisions. Mixed albums stay unsure as a whole; their classical tracks remain distinct. Manual classification pins survive scan/provider refresh. Unknown/unsure tracks do not opt into classical presentation. Stored non-classical, unsure or unreviewed links block existing tag/clear/restore actions; unknown legacy files continue through the established resolver. Model scans never write tags. Artist/folder override rules and a classification review UI remain future work.

## Migrations, backup and rollback

Schema migration 1 creates only plugin tables. Each migration gets a consistent online SQLite backup under `model/backups`, then runs in one immediate transaction with its schema version and journal entry. Integrity and foreign-key checks must pass before commit. Failed DDL rolls back; a newer unsupported schema is refused without downgrade. Model actions fail clearly, and scheduled model errors are isolated from the existing schedule/playback.

With the plugin source available locally:

```sh
node scripts/model-admin.mjs status /path/to/plugin-data/model
node scripts/model-admin.mjs backup /path/to/plugin-data/model /path/to/backup.sqlite
# Stop ALL host/plugin processes first, then restore with the matching old plugin code:
node scripts/model-admin.mjs restore /path/to/plugin-data/model /path/to/backup.sqlite --offline
```

Backup uses SQLite's online backup API and validates the result. Offline restore validates compatibility, stages the replacement and checkpoints the previous target before replacing it. `--offline` is an operator assertion, not a process supervisor; never pass it with a host or worker still running. Do not copy a live `.sqlite` file without its WAL. Disabling retains the data; disabling is not a schema downgrade. File-tag backups remain separate.

## Validation limits

Tests cover provider-free works/broadcasts, reissues, multi-work segments, precedence/pins/blanks/conflicts, full rescans, ambiguous/reused identities, mixed libraries, failed migrations, process death, verified restore, concurrent writers and job fencing. The isolated Node container uses a read-only source mount and no network. Existing Phase 1 real-HTTP Compose CI is separately recorded in PHASE_2_REPORT.md.

No production library or server is accessed. An anonymized real-library snapshot, automatic core epoch/generation detection, audio-only fingerprinting, large-library throughput and complete stock-host UI compatibility are not claimed. The model has no editor, work page, classification-rule UI or new playback behavior yet. A scan remains read-only after its initiating admin action; it persists no session/grant token and does not perform deferred remote/user mutations.
