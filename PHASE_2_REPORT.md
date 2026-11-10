# Phase 2 — data model review

## Final implementation CI

GitHub Actions run [42887705310](https://github.com/Collinlong1/Aurral-Classical-Plugin/actions/runs/42887705310) passed all five jobs on implementation commit `eb997d521ccf1aad2d1f611b0fd5b62bcba6e8eb`: full 159-test suites on Node22.16/22/24/26.12, bundle/source consistency in every matrix job, and the isolated no-network model tests. Both repositories have a separate `phase2-review` source branch. Core snapshot `bae8d4bace3ea4541d0c76da533f3de25e78eb78` contains checkpoint documentation only. Follow-up commits record this observed result without changing runtime source. No PR was opened or merged.

November 10, 2026. The user's request explicitly authorized verifying Phase 1 and building Phase 2. Phase 2 backend implementation is complete for review. Stop before Phase 3.

## Phase 1 verification and source prerequisites

Phase 1 code was on `phase1-review`, not yet in remote classical. Plugin PR6 and core PR36 remain open and unmerged. The existing local `aurral-classical` branches were fast-forwarded to plugin `e1a980ad768af6c8d3e5122e85f05a6e68b3629b` and core `581e8b6ca32908652eecb673620ee6f1389a96b5`. These are the Phase 2 prerequisites. No remote classical/main ref was moved and no PR was merged.

Fresh local Phase 1 plugin tests passed 138/138. GitHub core head checks passed: validation, production container, both unit shards, Perf, integration tests and docs. Latest disposable integration run 42882247625 passed. Plugin push run 42882238505 passed its full Node matrix. PR run 42882247578 failed Node22 and cancelled the other jobs; connected GitHub job logs identify an `ENOTEMPTY` after-hook failure in background Opus-tagging test cleanup. The test had observed tags before the background writer fully finished. Teardown now explicitly awaits the writer before removing its directory or resetting fetch.

A later loaded local Node26 run exposed the existing rate limiter's future-slot race: requests dispatched 173ms apart in the 300ms fixture. Rate slots were reserved before sleeping, so delayed callers could bunch together. Provider requests now hold the shared rate lock through actual dispatch/response headers and preserve the next dispatch time. HTTP requests remain bounded by existing timeouts, and the lock has a conservative recovery window. An additional delayed-response concurrency test verifies serialization. The failed observations are retained here; they are not relabeled as passes.

## Phase 2 acceptance

| Requirement | Implemented evidence |
| --- | --- |
| All entities use internal IDs; provider-free works | Plugin-owned typed person/ensemble/work/movement/collection/performance/recording/release UUID entities; role credits, aliases, catalogue numbers and optional external identities. Tests construct a composer, multi-movement work, broadcast performance/recording and releases with no external IDs. |
| Provider-first fields and pinned overrides | Typed append-only assertion history, provider record state, provenance, manual pins including blank/null/list values, deterministic provider priority and explicit audited unpin. Atomic refresh preserves pins, stale/deleted/omitted/conflicting data and low-confidence review. |
| Track links survive complete rescans | Independent UUID links, versioned evidence, recording/release/segment associations, complete-snapshot validation, generation checks, unique stable/hash moves and explicit epoch changes. Exact unchanged duplicates retain their own links. Ambiguous/reused identities remain review/missing; title/provider-ID matching never chooses a file. |
| Transactional migrations and compatible restore | Native SQLite WAL, FK/integrity checks, online backup before migration, version/journal committed with DDL, injected failure rollback, killed-process recovery, future-version refusal and verified offline backup restoration. |
| Mixed-library acceptance added to Phase 2 | Classical/not_classical/unsure per-track and aggregate album decisions; track pins override album pins and survive rescans/refresh. Rock/jazz/pop/electronic/soundtrack and crossover tests pass. Stored non-classical/unsure/unresolved links veto tag mutations; model scans never write media. |

All classical storage is independent of the core schema. Common typed entities and validated relation edges implement the design without separate empty subtype tables. The manual editor, merge UI, work page, grouping, favourites/picks and actual segment playback are not implemented by this phase.

## Files and integration

- `src/model/schema.js`, `database.js`: plugin migration 1, transactions/savepoints, consistent backup, compatibility checks and offline restore.
- `catalogue.js`, `metadata.js`: typed entities/relations, credits, placements/content/segments/realizations, optional identities, assertions/provenance/pins and diagnostics.
- `reconcile.js`, `jobs.js`, `runtime.js`, `write-guard.js`: conservative links, classification, durable leases/fencing/retries/cancellation, bounded read-only scan batches, admin entry points and tag guards.
- `src/index.js`, `manifest.json`: admin model scan/status/cancel actions, explicit library-epoch setting, isolated scheduled processing and internal background-drain lifecycle hook. Existing source/tagging remains available if model initialization fails; model-dependent writes fail closed.
- `src/store.js`, `src/mb.js`, `test/mb.test.js`, `test/tagger.test.js`: the two verification fixes described above.
- `test/model.test.js`: 20 acceptance/failure/concurrency tests, including every committed synthetic fixture and repeated read-only scans.
- `scripts/model-admin.mjs`, `MODEL_V1.md`, README and shared handoffs/contracts/inventory/delta: maintenance commands, exact semantics and current checkpoint.
- `package.json`/lock: minimum Node 22.16 for native online backup; no added package dependencies. `index.js` rebuilt, including the development build.
- `.github/workflows/ci.yml`: minimum-runtime matrix entry and isolated read-only/no-network model test job.

Core has **no Phase 2 runtime, API, dependency or schema change**. Only its checkpoint documents change. Existing 16 preservation branches remain untouched. Work was implemented on the existing local classical branches; `phase2-review` snapshots carry the reviewable result in the user's two repositories. No new PR was requested or opened. Do not merge automatically.

## Validation

| Check | Actual result |
| --- | --- |
| Fresh Phase 1 plugin baseline, Node24.22.1 | 138/138 passed |
| Final Phase 2 full suite, Node22.23.4 | 159/159 passed |
| Final Phase 2 full suite, Node24.22.1 | 159/159 passed |
| Final Phase 2 full suite, Node26.12.0 | 159/159 passed |
| Minimum Node22.16.0 model suite | 20/20 passed |
| Pinned Node26 container, read-only plugin source, `--network none` | 20/20 model tests passed |
| Production/development bundle | Both built successfully |
| Plugin/core patch whitespace | Passed |
| Core runtime checks | Existing head CI verified green; no redundant local core suite/build claimed |

The model suite tests actual SQLite, three independent writers, killed processes and failed migrations; these are not mocked storage tests. Existing comparison/tag/source regressions remain in the full suite. All committed synthetic cases scan and rescan unchanged byte-for-byte, with crossover tracks classified separately and album/track pins preserved. No live provider API is used.

A standalone synthetic 10,000-link run on Node24 measured initial reconciliation 4,031ms and rescan 1,667ms, with 263MiB process RSS and a 1,275,561-byte evidence snapshot. This measures model reconciliation with synthetic evidence, not host query cost, media hashing throughput, page latency or a production-library guarantee. Source baseline for this measurement preceded the later provider/test cleanup fixes; the reconciliation algorithm was unchanged afterward.

Remote Phase 2 implementation CI was separately observed passing in run 42887705310; the final addendum above identifies the exact source commit. A later documentation-only update may trigger another run. No new real-HTTP model integration or browser UI is claimed; this phase adds a backend, and the Phase 1 disposable HTTP integration result is separately recorded above.

## Migrations, rollback and limits

Migration **1** creates only `dataFolder/model/classical.sqlite`. Existing JSON caches, exclusions and tag backups are preserved without automatic import. Pre-migration backups are validated SQLite snapshots in the plugin model backup folder. A failed migration leaves the prior schema; newer unsupported schemas are refused. Offline restoration requires stopping every plugin process and restoring a backup compatible with the intended plugin version. Disabling retains storage; it is not a database downgrade. Media/tag backups are separate.

Known limits:

- The Phase 1 host snapshot has no automatic installation/epoch/generation detection. The plugin binds the local installation, uses its own scan generations and exposes an admin epoch setting for host database replacement/restore. Hashes guard reused IDs; this is not a claim of automatic restore detection.
- Full-file SHA-256 evidence supports unique renames/moves. Audio-only fingerprints are not extracted. A retagged move or ambiguous duplicate goes to review, never silent reassignment. External mapped roots outside the configured library are refused.
- Provider refresh here is the transactional storage API, not automatic catalogue identification/enrichment. Existing recorded-provider clients remain; no new provider network jobs are started.
- Identification/scans start only from an admin action and are read-only toward media/core. No grant/session token is persisted for deferred remote/user mutations. Artist/folder classification rules, review UI and manual edit UI remain later work; album/track pins are supported in the backend.
- Jobs are bounded by batches and attempts; individual file hashing can exceed a short batch budget. Long/expired reads cannot publish after lease loss and may need retry/review. Model transactions never span I/O.
- No production credentials, user server, real-library dry-run or anonymized real-library migration snapshot was available or used. Those operational checks remain outstanding before deployment.

No main/upstream writes, upstream activity, release tag, deployment or PR merge. Stop at Phase 2 review.
