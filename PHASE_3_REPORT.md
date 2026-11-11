# Phase 3 scan throughput correction

The user's installed search patch was verified, but its first full-library scan had processed only 60 of 12,802 files and remained queued with no committed tracks. The five-second model runner budget was incorrectly used by both the explicit background action and the 15-minute schedule. This is our scan-processing limitation, separate from the pre-existing BrainzMash refresher, which remains unchanged per the user's instruction.

Explicit scans now use the existing 25-minute background-action budget; scheduled model work uses the existing 8.5-minute scheduled budget, shared with any enabled tagging work so the host's 10-minute call limit is respected. Incomplete scans remain durable and resumable. Run Scan again to resume immediately, or enable the plugin schedule for automatic continuation. File hashing/identity checks, read-only media, fenced publication and full-snapshot reconciliation remain in place; no partial scan is published or schema changed.

Resuming an existing scan reuses its original host snapshot without another full-library fetch. Cancellation/checkpoint checks avoid repeatedly parsing all saved input/evidence. Model status and the completion notification now show scan state and processed/total file counts rather than an ambiguous queued-only summary. The editor still becomes searchable after full reconciliation completes.

Validation: **173 plugin tests pass**, including two deterministic regressions that pause a scan after five seconds and then finish it via the actual admin action and scheduled export. Both verify the same job identity, one snapshot fetch, exact counts and unchanged read-only media. Existing lease/rollback/cancellation and editor suites also pass. No production server or credentials were accessed; no core/refresher changes, deployment, merge, upstream writes or subagents.

Update the installed plugin `index.js` from this review revision, restart the test instance, then invoke **Scan classical model (read only)** once to resume the queued scan. No library remount, core rebuild, database deletion or new scan is necessary. Local synthetic Compose scan preparation, exact-title Chromium editor workflow, metadata/media checks and admin/two-user comparison streaming also pass on this correction. Remote CI results remain separate from these local checks.

# Phase 3 editor search correction

The reported `No. 1 Prélude (Presto)` query exposed two gaps: Search items listed only catalogue entities, and scan evidence omitted track titles/album/performer metadata. The plugin now retains those read-only scan hints, searches owned tracks alongside catalogue entries, ignores accents/punctuation and matches query words in any order. Selecting a track shows its metadata and permits attachment to an existing recording/work through the existing guarded command. Scans do not fabricate work identities.

Update the plugin bundle/manifest from `phase3-review`, restart the test instance, then rerun **Scan classical model (read only)** from an album menu and reload the editor. Existing scan evidence needs this explicit rescan for title/album/performer searches; opening Search items does not rescan. No schema migration or core update is required for this correction. Read-only library mounts remain supported.

Local validation: all **171 plugin tests** passed; real Chromium found the exact Liszt/Trifonov title and its unaccented spelling in a synthetic read-only library, then completed the existing editor workflow. Persistence/media checks passed before and after restart, and existing admin/two-user comparison streaming passed afterward. Remote CI for this correction is recorded separately when observed.

The user's BrainzMash cooldown logs come from the existing core release-date refresher. Phase 3 did not modify that code; the user explicitly asked to leave it alone, and no refresher/provider changes were made. Ordinary-user work browsing/grouping remains Phase 4 and is not implemented here. No production server access, deployment, merge, upstream change or subagents.

# Phase 3 — manual editor

## Final implementation CI

Implementation plugin commit `84ea58d39362532f1f3551906e4fef01a7eda77b` and pinned core commit `7ea6b2211f469d9c1342fee998fe82d2289232ff` passed remote validation. [Standard CI run 42934882603](https://github.com/Collinlong1/Aurral-Classical-Plugin/actions/runs/42934882603) passed all four Node matrix jobs and isolated model/editor tests, including bundle/source consistency. [Editor integration run 42934882763](https://github.com/Collinlong1/Aurral-Classical-Plugin/actions/runs/42934882763) passed required core checks/build, Chromium editor/permissions, existing comparison streams, restart persistence and read-only media checks; browser evidence was uploaded. All six implementation jobs passed. Follow-up documentation commits record this observed result without changing runtime source.

November 10, 2026 (America/Chicago). The user explicitly authorized beginning and continuing Phase 3. The manual editor and its generic host bridge are complete for review. Phase 4 is not authorized by this report.

## Result and acceptance

| Acceptance | Implementation and validation |
| --- | --- |
| Create composer, multi-movement work and broadcast without MusicBrainz | Admin forms create internal person/work/movement/performance/recording identities and structured credits. No external identifier or provider request is required. A broadcast preserves year/month/day precision rather than inventing a date. Backend and real browser tests create these records. |
| Reorder movements and attach tracks | Keyboard-accessible Up/Down controls submit an exact permutation in one transaction. Owned files attach to a chosen recording's work performance and movement, with parent/identity/classification checks; duplicate or wrong-parent attachments roll back. An explicit detach preserves audio and evidence. Browser and backend tests cover both ordering and attachment. |
| Provider versus pinned values, with use-provider | Editable values display their source/pin/state and underlying provider value. Provider-filled corrections pin automatically. An explicit Use provider value action unpins without deleting history. Text/list/null overrides are supported. |
| Read-only media | Editor code writes only plugin storage. Fixture media is set read-only; hashes and permissions are checked after editing and after a real host restart. No tag writer runs through editor forms. |
| Pinned blanks and provider conflicts survive refresh | Tests edit/pin an empty title and intentional nulls, inject recorded provider updates/conflicts, reload, unpin and verify history. Browser checks cover a pinned blank surviving multiple refreshes. |

The editor also creates performers/ensembles and structured role credits, supports search/pagination and typed list fields, and rejects stale tabs with HTTP 409. Within the editor, a dirty form stays intact until saved/cancelled; background refetch and item navigation cannot silently discard it. Validation errors keep drafts editable. Unknown commands/fields, wrong entity kinds, missing/ambiguous tracks and invalid dates fail without partial writes.

## Where to find it

On the matching Phase 3 fork and plugin source, open **Settings → Plugins → Aurral Classical → Pages → Open Classical metadata editor**. The route is `/plugins/aurral-classical/editor`. The plugin and `page:editor` capability must be enabled, and the caller must be a real admin account. Use **Create new** for new catalogue records, or select an entry to edit. The composer detail offers contextual work creation; the work detail offers broadcast creation. Use Search items to find catalogue entries or track filenames/albums.

To attach owned tracks, first run the existing **Scan classical model (read only)** action from an album menu. This explicitly queued scan populates plugin-owned track evidence; opening the editor never scans, identifies, downloads or writes media. Confirm classical classification when attaching a not-classical/unsure track. Track pins override album pins and survive subsequent scans.

This is a source review checkpoint, not a tagged production release. The existing manifest version is preserved until release packaging.

## Generic core delta

D01's first implemented subset is **admin forms v1**. The core accepts optional page declarations and passes authenticated read/mutate requests to `pages.read`/`pages.mutate`, with a real admin and `capabilities.adminForms: 1`. The browser receives only bounded, validated declarative form data. It does not load plugin scripts, HTML, arbitrary assets, filesystem paths, API keys, settings or grants.

Core changes are generic: manifest/capability support, bounded API transport, one lazy host-rendered form page, a Settings link, types/docs and tests. No classical entity, provider, role or title parsing exists in core. There is no new core SQL schema or direct plugin write to core tables. Old manifests default to no pages; disabled/missing capabilities and safe mode hide/deny pages. User and synthetic-admin API-key access is rejected. Same-origin checks and request/result size limits apply.

The plugin retains all catalogue CRUD, provenance, validation, association and ordering rules. Editor writes use the Phase 2 schema **1**; no migration or automatic JSON import is added. Audit events retain the host actor and command values, while optimistic revision checks run in the same write transaction.

D01 is not claimed complete for arbitrary pages/resources: this version serves admin forms only. Ordinary-user work browsing, grouping, queue ranges and work pages remain Phase 4/later. No standalone metadata service, iframe or new player is introduced.

## Validation record

- Core full unit suite: **406 files / 2,755 tests passed** on Phase 3 runtime source. Later refinements changed CSS, documentation and response narrowing in new tests; focused tests and required checks cover those refinements, rather than claiming another full-suite run at every documentation commit.
- Core plugin/permission suites: **23 tests passed**, including opt-in capability, real-admin checks, regular/synthetic denial, unknown/disabled pages, safe mode, cross-origin rejection, payload bounds, conflicts and malformed plugin output.
- Required core checks: formatting/lint, CSS design tokens, generated DB types, **zero type errors**, and unsafe-any checks pass. The unsafe-any baseline stays **1,236**, without increases. Initial new-test JSON narrowing and CSS-token failures were corrected; no check was bypassed.
- Plugin full suite: **168 tests passed** locally on Node24, including **9 editor tests**. Native SQLite and the existing Phase 1/2 regression suites are exercised. The separate remote matrix result is recorded when observed, not inferred from this local run.
- Production frontend and docs builds pass. Plugin production/development bundles build from source.
- Real Chromium browser: composer/work/broadcast creation, date validation with editable draft, movement reordering, owned-file attachment, provider refresh, pins/unpin, pinned blank, conflict preservation, stale-tab draft/409 handling, phone-width overflow and regular-user denial pass. No unexpected page errors were observed.
- Disposable Compose: existing admin/two-user comparison streaming and isolation/zero-acquisition smoke passes before and after restart. Editor records, pinned blank, movement order, attachment and all read-only fixture media hashes/permissions survive restart.

The container's published port is unavailable in this managed workspace. Browser tests use a test-only loopback HTTP relay over `docker exec` into the synthetic instance. The relay checks the fixture marker, exposes no plugin service and is not part of production. It does not relay WebSockets; no new live playback/WebSocket behavior is claimed. Existing playback smoke runs inside Compose through real HTTP. The synthetic network blocks outside provider access, and provider updates in editor tests use recorded data only.

A dedicated Phase 3 CI workflow pins the companion core source, runs required checks/build, starts the internal-network fixture, runs Chromium through the same fixture relay, verifies permissions and unchanged media, then restarts and repeats persistence/playback checks. Standard plugin CI also runs all supported Node versions plus isolated model/editor tests. Remote conclusions are separate from local validation.

## Files and source boundaries

Plugin: `src/model/editor.js`, `src/index.js`, manifest page declaration, `test/editor.test.js`, Playwright dev dependency/lock, `dev/editor-browser.mjs`, `dev/editor-fixtures.mjs`, test relay, CI and documentation. The dev seed now copies media only when a fixture library is first created, preserving read-only media on restart.

Core: `pluginManifest.ts`, `pluginPages.ts`, plugin routes/types/reference; lazy `PluginPage.tsx`/CSS, App route, Settings link; plugin tests and user/developer docs. Existing fork features, main, upstream and preservation branches are untouched.

Implementation stays on the existing local `aurral-classical` branches. Separate `phase3-review` snapshots in the user's repositories preserve review without merging Phase 1/2 PRs or moving remote classical/main. Prerequisites are plugin Phase 2 `bf47025` and core Phase 2 `d93cd812`. No new PR is automatically opened or merged. The CI pins companion core implementation `7ea6b2211f469d9c1342fee998fe82d2289232ff`.

## Remaining limits and rollback

- Stock hosts without admin forms v1 have no editor entry; model/tag/source actions retain their documented behavior. Full stock editor compatibility is not claimed.
- Catalogue selections/track choices are bounded and searchable. This editor does not add fuzzy search, automatic matching, entity merges, collection membership editing, artist templates or file-tag writing.
- Movement reordering changes the canonical work order and preserves its audio associations. New playback planning/segment controls remain Phase 4; no new playback behavior is claimed here.
- The Phase 2 installation/epoch, full-file-hash and scan limitations still apply. The editor rejects unresolved/missing links; it does not silently reconcile them or rescan on page requests.
- No production credentials, user server, production deploy, real-library dry-run or anonymized real-library snapshot was used. Those operational checks remain outstanding before a release deployment.

Disable the page capability or plugin to remove the editor. Plugin catalogue data remains intact. No new migration needs reversal; restore only compatible SQLite backups with every plugin process stopped when a data rollback is needed. Reopen the editor after restoration. File-tag backups remain separate.

Stop at Phase 3 review before grouping, playback and the work page in Phase 4.
