# Phase 4 inventory addendum

Phase 4 adds generic fork hooks for opt-in album presentation, authenticated regular-user resource pages and bounded native queue segments. Classical grouping/work content and user state remain plugin-owned. Main, upstream and preservation branches remain untouched; the review snapshots remain separate and unmerged. See `PHASE_4_REPORT.md` and the Phase 4 section in `UPSTREAM_DELTA.md`.

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

# Phase 3 addendum

Existing fork preservation branches/main/upstream remain untouched. New D01 admin-forms v1 is a generic, opt-in core hook for the plugin-owned editor: manifest pages/capability, authenticated read/mutate transport, host forms, route/Settings entry and types/docs/tests. No core SQL schema or classical business logic is added. All classical mutations stay in independent plugin storage. The central plugin UPSTREAM_DELTA.md records exact files and limitations. Phase 3 is complete for review; no upstream PR or automatic merge.

# Phase 2 inventory addendum

The current user authorized Phase 2 after Phase 1 verification. Phase 2 adds no core runtime changes or additional fork features. The 16 preservation branches and main/upstream are untouched. Local classical branches include the Phase 1 review commits as prerequisites, without merging their remote PRs. Model/storage/migration/reconciliation/classification/job changes are plugin-owned. See PHASE_2_REPORT.md and central plugin MODEL_V1.md. Historical inventory follows.

# Fork feature inventory — Phase 0.5 execution record

Current status: Phase 1 is implemented in fork-only core PR36 and plugin PR6, targeting aurral-classical. Read PHASE_1_REPORT.md and the Phase 1 inventory addendum at the end for current source/test state. The Phase 0.5 records below are preserved historical evidence; the 16 preservation branches are unchanged. Live main's matching upstream advanced externally to 021b1f03, with the same 52 net paths and 111 historical fork-only commits.

## Final-verification drift correction

Fork main advanced **externally to this task** from `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` to `c0deb211eba929424b608ca1c2449c7242892d9c` via merge PR #31, bringing upstream `656475b92be36b6834002da2407e7d9d50c2e0c2` (the owned-albums artist-page fix). No agent write or merge targeted main. The live fork now matches upstream `656475b92be36b6834002da2407e7d9d50c2e0c2` with **110 historical fork-only commits and the same 52 net changed paths**.

Preservation branches remain independently tested one-commit branches on the matching upstream base selected at Phase 0.5 entry, `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`. Classical runtime source remains the frozen entry fork main `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` plus documentation; it does not silently absorb the later update. The user-created classical branches are reused. Reconcile this newly observed nightly drift on classical only after the next phase is approved. Do not reset, overwrite or try to restore live main to the older audited SHA.

All references below to an unchanged main mean **no main edits by this task**, with source/test baseline SHAs explicitly pinned. They do not claim the live fork main stayed stationary while another upstream merge occurred.

**Status: all 16 preservation branches published and independently validated. No PRs opened. Phase 1 not started.**

Matching upstream base: `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`. Frozen entry fork-main baseline: `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee`. Unchanged plugin main: `506e5259e1442b8cfe072a75b129abb428c6bcf7`. The refresh added an upstream-only merge to fork history: **109 fork-only historical commits; 52 net changed paths, +3,130/−181 lines**. All issue branches have exactly one new commit with the matching upstream SHA as their sole parent.

[Current matching-base comparison](https://github.com/lklynet/aurral/compare/7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef...Collinlong1:aa643d316e9e00fb8622ab60b2fb2cb8b76661ee). Later observed upstream main `656475b92be36b6834002da2407e7d9d50c2e0c2` is one commit beyond the matching base; no automatic rebase or main sync was performed.

User approval covers Phase 0.5 and reuse of the already-created classical branches. Upstream is read-only; all new issue branches are in Collinlong1/aurral. Existing fork classical is reused and advanced only through the already-existing fork-main ancestry, followed by handoff documentation. Plugin classical receives documentation only. Neither main is modified.

## Actual branches and validation

| Issue | Branch                                                                                                                              | Commit                                                                                                  | Focused tests                            | Required checks/builds           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| F01   | [feature/optional-fork-container-image](https://github.com/Collinlong1/aurral/tree/feature/optional-fork-container-image)           | [`8991619c5eee`](https://github.com/Collinlong1/aurral/commit/8991619c5eee68520af1ce3ec846a3dc6baf622f) | actionlint + unchanged upstream baseline | Passed; docs build where changed |
| F02   | [fix/missing-track-download-status](https://github.com/Collinlong1/aurral/tree/fix/missing-track-download-status)                   | [`c31abe13cd60`](https://github.com/Collinlong1/aurral/commit/c31abe13cd60b5ffdcac587d216d454b89a16bfe) | 3 passed                                 | Passed; docs build where changed |
| F03   | [feature/numbered-library-pagination](https://github.com/Collinlong1/aurral/tree/feature/numbered-library-pagination)               | [`f16b4e057f03`](https://github.com/Collinlong1/aurral/commit/f16b4e057f034c99ed7fc2949c8a13402b116b25) | 3 passed                                 | Passed; docs build where changed |
| F04   | [feature/library-page-size](https://github.com/Collinlong1/aurral/tree/feature/library-page-size)                                   | [`100864c635cd`](https://github.com/Collinlong1/aurral/commit/100864c635cde498541c147a32ec89cac7d6ed21) | 1 passed                                 | Passed; docs build where changed |
| F05   | [fix/album-scoped-track-ownership](https://github.com/Collinlong1/aurral/tree/fix/album-scoped-track-ownership)                     | [`183b22ca3388`](https://github.com/Collinlong1/aurral/commit/183b22ca3388b9adff0568f135002591fcc59e04) | 22 passed                                | Passed; docs build where changed |
| F06   | [fix/wanted-cancelled-tracks](https://github.com/Collinlong1/aurral/tree/fix/wanted-cancelled-tracks)                               | [`a9c9a2abd64c`](https://github.com/Collinlong1/aurral/commit/a9c9a2abd64cd2dd290b66ccb43dcff832061372) | 8 passed                                 | Passed; docs build where changed |
| F07   | [feature/playlist-track-reorder](https://github.com/Collinlong1/aurral/tree/feature/playlist-track-reorder)                         | [`29b9baf0d36a`](https://github.com/Collinlong1/aurral/commit/29b9baf0d36ac629bc3d1d01192211cae064eb17) | 4 passed                                 | Passed; docs build where changed |
| F08   | [feature/link-missing-track-library-file](https://github.com/Collinlong1/aurral/tree/feature/link-missing-track-library-file)       | [`8886ca2c8a4b`](https://github.com/Collinlong1/aurral/commit/8886ca2c8a4b61dd3f9d9e2b4e3af3ac08a06d2e) | 5 passed                                 | Passed; docs build where changed |
| F09   | [feature/import-disk-file-for-missing-track](https://github.com/Collinlong1/aurral/tree/feature/import-disk-file-for-missing-track) | [`e2e55bd09e2e`](https://github.com/Collinlong1/aurral/commit/e2e55bd09e2ee21898794956d42ca5a7a83f4d65) | 5 passed                                 | Passed; docs build where changed |
| F10   | [fix/playlist-local-album-artwork](https://github.com/Collinlong1/aurral/tree/fix/playlist-local-album-artwork)                     | [`1b8358d53363`](https://github.com/Collinlong1/aurral/commit/1b8358d53363b63aa4842a3d57902af9a80a8475) | 1 passed                                 | Passed; docs build where changed |
| F11   | [fix/playlist-current-library-names](https://github.com/Collinlong1/aurral/tree/fix/playlist-current-library-names)                 | [`ca666ca9c24d`](https://github.com/Collinlong1/aurral/commit/ca666ca9c24d2a64e915c097716c46c3f7a455ea) | 1 passed                                 | Passed; docs build where changed |
| F12   | [fix/subsonic-playlist-file-identity](https://github.com/Collinlong1/aurral/tree/fix/subsonic-playlist-file-identity)               | [`576ef4b266e1`](https://github.com/Collinlong1/aurral/commit/576ef4b266e1cb7758c1b26862fecba6cd9bdee3) | 40 passed                                | Passed; docs build where changed |
| F13   | [fix/subsonic-playlist-rescan-timestamp](https://github.com/Collinlong1/aurral/tree/fix/subsonic-playlist-rescan-timestamp)         | [`d2151224bf94`](https://github.com/Collinlong1/aurral/commit/d2151224bf94511888fc24b4b62390e39ea8a533) | 1 passed                                 | Passed; docs build where changed |
| F14   | [fix/wake-running-download-worker](https://github.com/Collinlong1/aurral/tree/fix/wake-running-download-worker)                     | [`2607fd60f558`](https://github.com/Collinlong1/aurral/commit/2607fd60f5581d85d38caa116b4a2aa38ad9759e) | 30 passed                                | Passed; docs build where changed |
| F15   | [fix/plugin-install-cross-device-rollback](https://github.com/Collinlong1/aurral/tree/fix/plugin-install-cross-device-rollback)     | [`963b3bc97c08`](https://github.com/Collinlong1/aurral/commit/963b3bc97c0875944f7f0f83513ec9377aa8d2e7) | 8 passed                                 | Passed; docs build where changed |
| F16   | [fix/recording-id-artist-contradiction](https://github.com/Collinlong1/aurral/tree/fix/recording-id-artist-contradiction)           | [`ab1f64f53f39`](https://github.com/Collinlong1/aurral/commit/ab1f64f53f39d833bba3ece45d48292cf728d1b4) | 17 passed                                | Passed; docs build where changed |

All branches passed formatting/lint, UI CSS policy, DB generated-type validation, zero-error typecheck and unsafe-any budget checks. Application builds passed on all 16; documentation builds passed on all 13 branches changing docs. Focused suites passed 149 tests across the 15 runtime-changing branches, including 40 Subsonic integration tests. Workflow-only F01 passed actionlint; no runtime source changed. `PHASE_05_VALIDATION.json` records exact commands/results.

## Independence, adaptations and actual files

### F01 — Optional container image publishing

The old workflow was explicitly fork-only. The preserved branch uses generic repository identity and explicit ENABLE_CONTAINER_PUBLISHING opt-in, with feature/** support. It stays disabled; its actual GitHub run was skipped. Original main workflow is unchanged.

Original commit provenance: `11739f0945e388bfc40f88de30cb1c6538dcf7fa`, `34d17c9cd8eeacb5d63a17a949090d649f0f7698`, `34bbedba1f07307bf24d182acde91387454582c4`.

Actual isolated files:

- `.github/workflows/fork-image.yml`
- `docs/src/content/docs/admin/optional-container-publishing.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F02 — Missing-track download indicator scope

Only missing-track indicator helpers/hooks/actions and their test; no pagination code.

Original commit provenance: `cd409bad9c0fa14a950c6e1cb0dbab3188a58e26`.

Actual isolated files:

- `.tests/frontend/active-downloads.test.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/hooks/useActiveDownloads.ts`
- `frontend/src/pages/library/useLibraryActions.tsx`
- `frontend/src/utils/activeDownloads.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F03 — Numbered Library pages and item range

Removed page-size selector from numbered navigation; uses stock page size. No URL/query-size changes. Existing pagination CSS relocation is accounted for here.

Original commit provenance: `2d8e625fc99536f84be34a269e4244ab4b96a299`, `ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a`, `cfa5fe26c6a7e4c1ffb37d6190294b6c74bcb122`, `3bdb4e702d1e1befc4330b5f910e41b72f0d808f`.

Actual isolated files:

- `.tests/frontend/pagination.test.ts`
- `docs/src/content/docs/using/library.mdx`
- `frontend/src/components/Pagination.css`
- `frontend/src/components/Pagination.tsx`
- `frontend/src/index.css`
- `frontend/src/pages/LibraryPage.tsx`
- `frontend/src/utils/pagination.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F04 — Selectable Library page size

Page-size selection uses upstream previous/next navigation, not F03 component. Retains URL/query/prefetch behavior and pageSizeParams test.

Original commit provenance: `ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a`, `3bdb4e702d1e1befc4330b5f910e41b72f0d808f`.

Actual isolated files:

- `.tests/frontend/pagination.test.ts`
- `docs/src/content/docs/using/library.mdx`
- `frontend/src/navigation/routePrefetch.ts`
- `frontend/src/pages/LibraryPage.tsx`
- `frontend/src/pages/libraryViewQuery.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F05 — Ownership check for a requested album placement

Album-placement ownership query and request callers, with both original library regression suites. No manual-link dependency.

Original commit provenance: `e2d4272770fd64b89ff917af6c31e945d03cfb09`.

Actual isolated files:

- `.tests/library/media-query.test.ts`
- `.tests/library/track-album-context.test.ts`
- `backend/services/libraryQueryService.ts`
- `backend/services/libraryTrackRequests.ts`
- `docs/src/content/docs/using/activity.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F06 — Cancelled individual tracks remain Wanted/Missing

Only Wanted eligibility, manual-search/research behavior, cancelled label and tests. No file linking/import or worker-wake hunk.

Original commit provenance: `a790aaca2e8f03956be8708f9f1f9ea6d28a083a`.

Actual isolated files:

- `.tests/frontend/activity-missing.test.ts`
- `.tests/library/aurral-wanted-monitoring.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/downloadJobs/downloadTracker.ts`
- `backend/services/downloadJobs/downloadWorker.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/pages/activity/ActivityMissingPage.tsx`
- `frontend/src/pages/activity/activityMissingUtils.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F07 — Reorder static playlist tracks

Only reorder service/route/component/handler. Shared playlist UI was split; no Library/disk picker.

Original commit provenance: `404cf3c10af9ed81b2914a6a48ec85617907cc50`.

Actual isolated files:

- `.tests/playlists/playlist-track-order.test.ts`
- `backend/routes/playlists/handlers/staticPlaylists.ts`
- `backend/services/playlists/playlistTrackOrder.ts`
- `docs/src/content/docs/using/playlists.mdx`
- `frontend/src/components/icons.tsx`
- `frontend/src/pages/playlists/PlaylistTracks.tsx`
- `frontend/src/pages/playlists/components/PlaylistReorderList.css`
- `frontend/src/pages/playlists/components/PlaylistReorderList.tsx`
- `frontend/src/pages/playlists/components/playlistTrackComponents.tsx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F08 — Resolve a missing track using an existing Library file

Local eligibility predicate removes dependency on F06. Library-only picker, route and owner-command adapter work without disk import. Typed query-cache update avoids inherited unsafe-any problem. Added saved/cancelled versus cancelled-album regression.

Original commit provenance: `79b9bef44762ff79152630f84c1592938de25f42`, `0ef5061d0c29750ccb5f1b88574e73e87047403a`.

Actual isolated files:

- `.tests/download/link-library-file.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/downloadJobs/downloadOwnerCommands.ts`
- `backend/services/downloadJobs/fileReuse.ts`
- `backend/services/downloadJobs/linkLibraryFile.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/pages/activity/ActivityMissingPage.tsx`
- `frontend/src/pages/activity/LinkLibraryFileModal.tsx`
- `frontend/src/pages/playlists/PlaylistTracks.tsx`
- `frontend/src/pages/playlists/components/playlistTrackComponents.tsx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F09 — Resolve a missing track using a copied disk file

Independent admin disk-import picker and localized eligibility predicate remove F08/F06 dependencies. Uses only import routes/command adapter. Copies nearby art without requiring F10 artwork rendering; typed cache update included.

Original commit provenance: `1c68fc63c9858ee9505013ca27ff9cf462755984`, `aa7f72a7f299afaced069431b4e4de4332064e8c`.

Actual isolated files:

- `.tests/download/import-disk-file.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/downloadJobs/downloadOwnerCommands.ts`
- `backend/services/downloadJobs/importDiskFile.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/pages/activity/ActivityMissingPage.tsx`
- `frontend/src/pages/activity/DiskFilePanel.css`
- `frontend/src/pages/activity/DiskFilePanel.tsx`
- `frontend/src/pages/activity/ImportDiskFileModal.tsx`
- `frontend/src/pages/playlists/PlaylistTracks.tsx`
- `frontend/src/pages/playlists/components/playlistTrackComponents.tsx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F10 — Local album artwork fallback for playlist rows

Only artwork lookup/rendering. Test seeds an ordinary completed native job directly rather than using link/import endpoints. Performance budget test passed unchanged.

Original commit provenance: `aa7f72a7f299afaced069431b4e4de4332064e8c`, `58667789c3d2d14e89c898355579e66a4a79d0a5`, `37b670eb6142301541cd4948e14b726af57ce991`.

Actual isolated files:

- `.tests/playlists/playlist-local-artwork.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/playlists/playlistTrackCovers.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F11 — Playlist rows follow current indexed track names

Only current Library metadata lookup/rendering, with an independent LibraryJob type. Native completed-job fixture avoids link/import dependencies. Performance budget test passed unchanged.

Original commit provenance: `eedfb2efd628c5a73ce5afc06e693aa02b80a0bc`.

Actual isolated files:

- `.tests/playlists/playlist-current-names.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/playlists/playlistTrackCovers.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F12 — Resolve Subsonic playlist songs by linked file path

Only file-path identity and favourite/star mapping. No rescan timestamp or removed artist-source feature. Measured playlist query count is 130 cold/50 warm (+1 each), recorded precisely in this branch baseline; 40 integration tests passed.

Original commit provenance: `c4648674dc9af2059878b94105b7049a0d523281`, `d840e5b34965989df9bb5315cc22a8118db87d47`.

Actual isolated files:

- `.tests/perf/baseline.json`
- `.tests/subsonic/subsonic-api.int.test.ts`
- `backend/services/subsonicLibraryService.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F13 — Invalidate Subsonic playlist metadata after file rescan

Only file-update timestamp invalidation. Added dedicated list/detail/unrelated-file regression. Measured 138 cold/58 warm (+9 each); baseline recorded here. Corrects Phase 0 attribution of the combined +10 entirely to F12.

Original commit provenance: `b2cd79967945512c41cbc7580c9a5f2f59978a45`.

Actual isolated files:

- `.tests/perf/baseline.json`
- `.tests/subsonic/playlist-rescan-timestamp.test.ts`
- `backend/services/subsonicLibraryService.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F14 — Wake idle worker when start is called again

Only start()-wakes-running-worker hunk and download-tracker regression; no Wanted eligibility hunk.

Original commit provenance: `11e8cff64551fa2810fc9484aa99a1d6b5d8009a`.

Actual isolated files:

- `.tests/download/download-tracker.test.ts`
- `backend/services/downloadJobs/downloadWorker.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F15 — Make cross-device plugin replacement recoverable

Cross-device copy/rename and restoration only; added orphan-.previous followed by disk-full rollback regression. Eight installer tests passed.

Original commit provenance: `a544a9b81ddd748bc26b72347703a4934f36ff4b`.

Actual isolated files:

- `.tests/plugins/plugin-install.test.ts`
- `backend/services/plugins/pluginInstaller.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F16 — Exact requested recording ID avoids artist contradiction

Exact recording ID suppresses only artist contradiction; other gates retained. Seventeen matcher tests passed. This does not implement performer-first slskd queries.

Original commit provenance: `d4deed1011913bb2f43cd47752db28da08c0be1f`.

Actual isolated files:

- `.tests/track-matching/native-matcher.test.ts`
- `backend/services/trackMatching/nativeMatcher.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

## Original 52-path net-diff accounting

Every path is assigned below, including configuration, CSS, docs and tests. Shared path counts must not be summed once per issue. Semantic split instructions are in issue sections and source patches. No unallocated path remains.

| Path                                                                  | Status   | + / −    | Issues                            |
| --------------------------------------------------------------------- | -------- | -------- | --------------------------------- |
| `.github/workflows/fork-image.yml`                                    | added    | 92 / 0   | F01                               |
| `.tests/download/download-tracker.test.ts`                            | modified | 26 / 0   | F14                               |
| `.tests/download/link-library-file.test.ts`                           | added    | 401 / 0  | F08 F09 F10 F11                   |
| `.tests/frontend/active-downloads.test.ts`                            | modified | 32 / 0   | F02                               |
| `.tests/frontend/activity-missing.test.ts`                            | modified | 3 / 0    | F06                               |
| `.tests/frontend/pagination.test.ts`                                  | added    | 35 / 0   | F03 F04                           |
| `.tests/library/aurral-wanted-monitoring.test.ts`                     | modified | 32 / 0   | F06                               |
| `.tests/library/media-query.test.ts`                                  | modified | 68 / 0   | F05                               |
| `.tests/library/track-album-context.test.ts`                          | modified | 62 / 0   | F05                               |
| `.tests/perf/baseline.json`                                           | modified | 2 / 2    | F12 and F13 (measured separately) |
| `.tests/playlists/playlist-track-order.test.ts`                       | added    | 121 / 0  | F07                               |
| `.tests/plugins/plugin-install.test.ts`                               | modified | 41 / 1   | F15                               |
| `.tests/subsonic/subsonic-api.int.test.ts`                            | modified | 7 / 2    | F12                               |
| `.tests/track-matching/native-matcher.test.ts`                        | modified | 23 / 0   | F16                               |
| `backend/routes/playlists/handlers/jobs.ts`                           | modified | 140 / 4  | F06 F08 F09 F10 F11               |
| `backend/routes/playlists/handlers/staticPlaylists.ts`                | modified | 24 / 0   | F07                               |
| `backend/services/downloadJobs/downloadOwnerCommands.ts`              | modified | 5 / 0    | F08 F09                           |
| `backend/services/downloadJobs/downloadTracker.ts`                    | modified | 10 / 1   | F06                               |
| `backend/services/downloadJobs/downloadWorker.ts`                     | modified | 5 / 1    | F06 F14                           |
| `backend/services/downloadJobs/fileReuse.ts`                          | modified | 2 / 2    | F08                               |
| `backend/services/downloadJobs/importDiskFile.ts`                     | added    | 208 / 0  | F09                               |
| `backend/services/downloadJobs/linkLibraryFile.ts`                    | added    | 136 / 0  | F08                               |
| `backend/services/libraryQueryService.ts`                             | modified | 17 / 1   | F05                               |
| `backend/services/libraryTrackRequests.ts`                            | modified | 16 / 5   | F05                               |
| `backend/services/playlists/playlistTrackCovers.ts`                   | added    | 93 / 0   | F10 F11                           |
| `backend/services/playlists/playlistTrackOrder.ts`                    | added    | 36 / 0   | F07                               |
| `backend/services/plugins/pluginInstaller.ts`                         | modified | 43 / 6   | F15                               |
| `backend/services/subsonicLibraryService.ts`                          | modified | 67 / 10  | F12 F13                           |
| `backend/services/trackMatching/nativeMatcher.ts`                     | modified | 4 / 1    | F16                               |
| `docs/src/content/docs/api/endpoints.mdx`                             | modified | 5 / 0    | F07 F08 F09                       |
| `docs/src/content/docs/using/activity.mdx`                            | modified | 23 / 1   | F06 F08 F09 F10                   |
| `docs/src/content/docs/using/playlists.mdx`                           | modified | 12 / 0   | F07 F08 F09                       |
| `frontend/src/components/Pagination.css`                              | added    | 94 / 0   | F03 F04                           |
| `frontend/src/components/Pagination.tsx`                              | added    | 86 / 0   | F03 F04                           |
| `frontend/src/components/icons.tsx`                                   | modified | 3 / 0    | F07                               |
| `frontend/src/hooks/useActiveDownloads.ts`                            | modified | 5 / 0    | F02                               |
| `frontend/src/index.css`                                              | modified | 0 / 10   | F03                               |
| `frontend/src/navigation/routePrefetch.ts`                            | modified | 2 / 1    | F04                               |
| `frontend/src/pages/LibraryPage.tsx`                                  | modified | 24 / 27  | F02 F03 F04                       |
| `frontend/src/pages/activity/ActivityMissingPage.tsx`                 | modified | 35 / 1   | F06 F08 F09                       |
| `frontend/src/pages/activity/DiskFilePanel.css`                       | added    | 85 / 0   | F09                               |
| `frontend/src/pages/activity/DiskFilePanel.tsx`                       | added    | 141 / 0  | F09                               |
| `frontend/src/pages/activity/LinkLibraryFileModal.tsx`                | added    | 281 / 0  | F08 F09                           |
| `frontend/src/pages/activity/activityMissingUtils.ts`                 | modified | 6 / 1    | F06                               |
| `frontend/src/pages/library/useLibraryActions.tsx`                    | modified | 8 / 3    | F02                               |
| `frontend/src/pages/libraryViewQuery.ts`                              | modified | 32 / 3   | F04                               |
| `frontend/src/pages/playlists/PlaylistTracks.tsx`                     | modified | 34 / 0   | F07 F08 F09                       |
| `frontend/src/pages/playlists/components/PlaylistReorderList.css`     | added    | 99 / 0   | F07                               |
| `frontend/src/pages/playlists/components/PlaylistReorderList.tsx`     | added    | 168 / 0  | F07                               |
| `frontend/src/pages/playlists/components/playlistTrackComponents.tsx` | modified | 198 / 98 | F07 F08 F09                       |
| `frontend/src/utils/activeDownloads.ts`                               | modified | 12 / 0   | F02                               |
| `frontend/src/utils/pagination.ts`                                    | added    | 26 / 0   | F03                               |

## Historical features absent from the current net diff

| Retired/superseded issue | Origin / removal or successor evidence | Preservation decision |
| --- | --- | --- | --- |
| Request-available notifications / album path | `8b5d2d9`; later upstream overlap and script removal `b7d4043` | No current notification delta; do not resurrect |
| Built-in custom scripts | `b98488e`, `7bd66e3`, `f1a8310`, `6576f6f`; removed `b7d4043`, leftover migration removed `3cc4f3f` | No current script/settings/schema delta; separate external plugin is not audited here |
| Per-event webhook bodies / converter | `9e6fbd2`, `e480efc`; upstream per-webhook events adopted `a071d7a`; converter/test removed `5114332`, `dde6191` | No current delta |
| Delete other admin accounts | `5472885`; removed `5cc5b8f` | No current user-management delta |
| M3U folder import | `837a986`, `afffe95`, `4c3c248`; removed `4c029cd` for upstream file import | No current import feature to branch |
| Raw ARTIST tags in Subsonic / throughout UI | `4e55f1f`, `689ae21`, `f12f7bb`, `b66bcce`; reverted/removed `2e5e855`, `a77c3af`, `866a26c`, `17b4960` | No artist-source settings/schema delta; retain F12/F13 separately |
| Box-set album naming and own cover | `6cf6d5f`, `5396487`, naming/cover part of `63358e2`; removed `7880950` | No album naming/artwork delta |
| Load every page of album/artist tracks | `bd9f3ca`; removed `e29a72f` after upstream behavior changed | No residual fetch loop; F04 page-size changes remain |
| Box-set disc sections and subtitle display | disc part of `63358e2`, `639186b`, `6e59e74`, `d74343c`, `cea3d08`; superseded in upstream sync `718a79e` | No custom disc modules remain; use upstream disc renderer |
| Typed page jump | `2d8e625`; superseded by `ff1d308` | Current F03 numbered pagination only |
| Bulk Activity cancel | `e4f700d`, `538f94f`; removed `ecd3a7c` | No current bulk-cancel delta |
| Retagged duplicate-copy cleanup | `f2660ce`; removed `3b6cae5` | No current libraryMediaStore delta |
| Owned albums outside discography rail | `dd20b95`; removed `95392a6` | No current artist-page delta |
| Apple TV AirPlay artwork | `4e3b001`; reverted `1f7ec85` | No current player-artwork delta |
| Playlist local cover removed then restored | `aa7f72a`; removal `5866778`; restored `37b670e` | F10 is active, not retired |
| Pure style/module refactors | `cfa5fe2`, `d74343c`, `7bd66e3`, `afffe95`, `f12f7bb`, `e480efc`, `3bdb4e7`, `538f94f` | Active portions assigned to their owning issue; no unrelated refactor branch |

## Complete 110-commit ledger

All original Phase 0 commits plus the two upstream-only refresh merges are listed, including merges, removals and transient states. This prevents an omission in the net inventory from being confused with lost history. Merge parents are preserved in evidence; merges are not extraction units.

| Commit                                                                                                                              | Parents | Subject                                                                                                        | Extraction treatment                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`8b5d2d9f18874021db930bbd56b0bb1ad66ce1fc`](https://github.com/Collinlong1/aurral/commit/8b5d2d9f18874021db930bbd56b0bb1ad66ce1fc) | 1       | fix(notifications): send request-available for Aurral-managed albums                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b98488e1e3a13895f33dc9338b4ef9d330781d14`](https://github.com/Collinlong1/aurral/commit/b98488e1e3a13895f33dc9338b4ef9d330781d14) | 1       | feat(notifications): run custom scripts on notification events                                                 | Retired/superseded/transient or issue refactor; current net map governs       |
| [`11739f0945e388bfc40f88de30cb1c6538dcf7fa`](https://github.com/Collinlong1/aurral/commit/11739f0945e388bfc40f88de30cb1c6538dcf7fa) | 1       | ci(fork): build and push this fork's image to GHCR                                                             | F01 provenance; extract current hunks                                         |
| [`34d17c9cd8eeacb5d63a17a949090d649f0f7698`](https://github.com/Collinlong1/aurral/commit/34d17c9cd8eeacb5d63a17a949090d649f0f7698) | 1       | ci(fork): install ffmpeg and use Vite+ like upstream validation                                                | F01 provenance; extract current hunks                                         |
| [`9e6fbd2090b049cefb74b9c54e431b490ad6bb9d`](https://github.com/Collinlong1/aurral/commit/9e6fbd2090b049cefb74b9c54e431b490ad6bb9d) | 1       | feat(notifications): let each webhook send its own body per event                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`54728855f9f1af62f14cba5bc7ccf43c981a23a9`](https://github.com/Collinlong1/aurral/commit/54728855f9f1af62f14cba5bc7ccf43c981a23a9) | 1       | fix(users): let admins delete other admin accounts                                                             | Retired/superseded/transient or issue refactor; current net map governs       |
| [`837a9861c6413676db0bbdbb78f10229aeb0e11f`](https://github.com/Collinlong1/aurral/commit/837a9861c6413676db0bbdbb78f10229aeb0e11f) | 1       | feat(playlists): import M3U playlists from a server folder                                                     | Retired/superseded/transient or issue refactor; current net map governs       |
| [`4e55f1fcb990b7e01786b5d0ba37c93ffc0bca64`](https://github.com/Collinlong1/aurral/commit/4e55f1fcb990b7e01786b5d0ba37c93ffc0bca64) | 1       | feat(subsonic): show artist names from file tags, like Navidrome                                               | Retired/superseded/transient or issue refactor; current net map governs       |
| [`fde585b171a27cb7838f3a5fd2bc5b6c6e04f32d`](https://github.com/Collinlong1/aurral/commit/fde585b171a27cb7838f3a5fd2bc5b6c6e04f32d) | 2       | Merge pull request #1 from Collinlong1/claude/kind-pascal-mytar7                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`04a6d700bd48ad11688bc36b5d38d971d3cb5062`](https://github.com/Collinlong1/aurral/commit/04a6d700bd48ad11688bc36b5d38d971d3cb5062) | 2       | Merge pull request #2 from Collinlong1/feat/script-hooks                                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`6cf6d5fe1099554a6526c764353ddcaaa5290f64`](https://github.com/Collinlong1/aurral/commit/6cf6d5fe1099554a6526c764353ddcaaa5290f64) | 1       | wip(library): name box sets after their release group                                                          | Retired/superseded/transient or issue refactor; current net map governs       |
| [`5396487161441f6bedc76dcd9aeefb588879a60d`](https://github.com/Collinlong1/aurral/commit/5396487161441f6bedc76dcd9aeefb588879a60d) | 1       | fix(library): name box sets after their release group                                                          | Retired/superseded/transient or issue refactor; current net map governs       |
| [`bd9f3cab6046d7970f1788a0651c8164fa942662`](https://github.com/Collinlong1/aurral/commit/bd9f3cab6046d7970f1788a0651c8164fa942662) | 1       | fix(library): show every track of an album or artist                                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`34bbedba1f07307bf24d182acde91387454582c4`](https://github.com/Collinlong1/aurral/commit/34bbedba1f07307bf24d182acde91387454582c4) | 1       | ci(fork): build images for fix/ branches too                                                                   | F01 provenance; extract current hunks                                         |
| [`63358e21be8f799c4434702ef7e7cb82695095eb`](https://github.com/Collinlong1/aurral/commit/63358e21be8f799c4434702ef7e7cb82695095eb) | 1       | feat(library): show box sets with their own cover and a section per disc                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`fa7963879ca6034c70dd1bb838b5ac39a9a79deb`](https://github.com/Collinlong1/aurral/commit/fa7963879ca6034c70dd1bb838b5ac39a9a79deb) | 2       | Merge pull request #4 from Collinlong1/fix/box-set-titles                                                      | Integration history; current conflict adaptations allocated by net paths      |
| [`16f0ae2e926567a83671d9221d2159491855d247`](https://github.com/Collinlong1/aurral/commit/16f0ae2e926567a83671d9221d2159491855d247) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`1b3b0509f6c0088da72547e6a334b6424dd12170`](https://github.com/Collinlong1/aurral/commit/1b3b0509f6c0088da72547e6a334b6424dd12170) | 2       | Merge pull request #5 from Collinlong1/sync/upstream                                                           | Integration history; current conflict adaptations allocated by net paths      |
| [`639186bfe70c43401faf7aba7c5e04696edbb8c0`](https://github.com/Collinlong1/aurral/commit/639186bfe70c43401faf7aba7c5e04696edbb8c0) | 1       | fix(library): keep missing tracks on their album's disc                                                        | Retired/superseded/transient or issue refactor; current net map governs       |
| [`283d6ace1f1b7f56f4dc0e0794bdef6376895da6`](https://github.com/Collinlong1/aurral/commit/283d6ace1f1b7f56f4dc0e0794bdef6376895da6) | 2       | Merge pull request #6 from Collinlong1/claude/fervent-curie-kizyqc                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`cd409bad9c0fa14a950c6e1cb0dbab3188a58e26`](https://github.com/Collinlong1/aurral/commit/cd409bad9c0fa14a950c6e1cb0dbab3188a58e26) | 1       | fix(library): downloading one missing track leaves the album's others free                                     | F02 provenance; extract current hunks                                         |
| [`58abab87c0d7bb6849f03931c54fb83b1cf233cd`](https://github.com/Collinlong1/aurral/commit/58abab87c0d7bb6849f03931c54fb83b1cf233cd) | 2       | Merge pull request #7 from Collinlong1/claude/fervent-curie-kizyqc                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`8d197470f23e3dbd46066ef688f3b4ec4bb6bca0`](https://github.com/Collinlong1/aurral/commit/8d197470f23e3dbd46066ef688f3b4ec4bb6bca0) | 2       | Merge pull request #8 from lklynet/main                                                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`689ae21c358aaf35fce0d6374c4a4f493da6405c`](https://github.com/Collinlong1/aurral/commit/689ae21c358aaf35fce0d6374c4a4f493da6405c) | 1       | fix(subsonic): keep compilation track artists with artist tags on                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`bfe73caa9659c7d342faf4a5dc5becf029b7e184`](https://github.com/Collinlong1/aurral/commit/bfe73caa9659c7d342faf4a5dc5becf029b7e184) | 2       | Merge pull request #9 from Collinlong1/claude/fervent-curie-kizyqc                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`2d8e625fc99536f84be34a269e4244ab4b96a299`](https://github.com/Collinlong1/aurral/commit/2d8e625fc99536f84be34a269e4244ab4b96a299) | 1       | feat(library): type a page number to jump to it                                                                | F03 provenance; extract current hunks                                         |
| [`e4f700d1852790b96a1f46ff782155d0c82b59b7`](https://github.com/Collinlong1/aurral/commit/e4f700d1852790b96a1f46ff782155d0c82b59b7) | 1       | feat(activity): cancel several queued downloads at once                                                        | Retired/superseded/transient or issue refactor; current net map governs       |
| [`e2d4272770fd64b89ff917af6c31e945d03cfb09`](https://github.com/Collinlong1/aurral/commit/e2d4272770fd64b89ff917af6c31e945d03cfb09) | 1       | fix(library): a missing album track downloads though another album holds it                                    | F05 provenance; extract current hunks                                         |
| [`64d2e255752105583a51fae0571ef7891523099a`](https://github.com/Collinlong1/aurral/commit/64d2e255752105583a51fae0571ef7891523099a) | 2       | Merge pull request #10 from Collinlong1/claude/fervent-curie-kizyqc                                            | Integration history; current conflict adaptations allocated by net paths      |
| [`6e59e74d66b31cea94d31399b247a13f4d11ab05`](https://github.com/Collinlong1/aurral/commit/6e59e74d66b31cea94d31399b247a13f4d11ab05) | 1       | fix(library): split an album into discs by disc number only                                                    | Retired/superseded/transient or issue refactor; current net map governs       |
| [`ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a`](https://github.com/Collinlong1/aurral/commit/ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a) | 1       | feat(library): page bar with numbered pages and a page size                                                    | F03, F04 provenance; extract current hunks                                    |
| [`371003a6cd8e163669a01752ae68f414613352e7`](https://github.com/Collinlong1/aurral/commit/371003a6cd8e163669a01752ae68f414613352e7) | 2       | Merge pull request #11 from Collinlong1/claude/fervent-curie-kizyqc                                            | Integration history; current conflict adaptations allocated by net paths      |
| [`f2660ce2f29cf312217208bcb7216558f2bbfa94`](https://github.com/Collinlong1/aurral/commit/f2660ce2f29cf312217208bcb7216558f2bbfa94) | 1       | fix(library): an album keeps no empty copy of a song its file was retagged to                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b88eabf9ab1dba4bca8a4b6f477e0efb8898f68c`](https://github.com/Collinlong1/aurral/commit/b88eabf9ab1dba4bca8a4b6f477e0efb8898f68c) | 2       | Merge pull request #12 from Collinlong1/claude/fervent-curie-kizyqc                                            | Integration history; current conflict adaptations allocated by net paths      |
| [`cfa5fe26c6a7e4c1ffb37d6190294b6c74bcb122`](https://github.com/Collinlong1/aurral/commit/cfa5fe26c6a7e4c1ffb37d6190294b6c74bcb122) | 1       | refactor(ui): move fork styles out of index.css                                                                | F03 provenance; extract current hunks                                         |
| [`d74343c6a2b8e36409130d9a0dd9934062914199`](https://github.com/Collinlong1/aurral/commit/d74343c6a2b8e36409130d9a0dd9934062914199) | 1       | refactor(library): keep box-set changes out of TrackList and LibraryPage                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`7bd66e39793b32081f897cf3136230f3cf88141f`](https://github.com/Collinlong1/aurral/commit/7bd66e39793b32081f897cf3136230f3cf88141f) | 1       | refactor(scripts): keep custom scripts in their own files                                                      | Retired/superseded/transient or issue refactor; current net map governs       |
| [`afffe9535b15a3cbb35876421a939759aafd0aa1`](https://github.com/Collinlong1/aurral/commit/afffe9535b15a3cbb35876421a939759aafd0aa1) | 1       | refactor(playlists): trim the M3U import                                                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`f12f7bb35a05d461a33dced808735ce2fe584f16`](https://github.com/Collinlong1/aurral/commit/f12f7bb35a05d461a33dced808735ce2fe584f16) | 1       | refactor(subsonic): read the artist-source setting once and trim artist tags                                   | Retired/superseded/transient or issue refactor; current net map governs       |
| [`e480efc267c771fe9cceee547146820d1d7f87a2`](https://github.com/Collinlong1/aurral/commit/e480efc267c771fe9cceee547146820d1d7f87a2) | 1       | refactor(notifications): move per-event webhook bodies out of NotificationsSection                             | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3bdb4e702d1e1befc4330b5f910e41b72f0d808f`](https://github.com/Collinlong1/aurral/commit/3bdb4e702d1e1befc4330b5f910e41b72f0d808f) | 1       | refactor(library): move page-size math out of LibraryPage                                                      | F03, F04 provenance; extract current hunks                                    |
| [`538f94fefa365ace18eb275500833069b5a15761`](https://github.com/Collinlong1/aurral/commit/538f94fefa365ace18eb275500833069b5a15761) | 1       | refactor(activity): move bulk-cancel state out of ActivityPage                                                 | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3cc672fff2980241f7b8ea6723155cc089ed2806`](https://github.com/Collinlong1/aurral/commit/3cc672fff2980241f7b8ea6723155cc089ed2806) | 2       | Merge pull request #13 from Collinlong1/refactor/shrink                                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`a2bbddab730ef83b8740f97c43c26018110a776b`](https://github.com/Collinlong1/aurral/commit/a2bbddab730ef83b8740f97c43c26018110a776b) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`d49700b590a77374fe433a7c3ea6a30ea47f4071`](https://github.com/Collinlong1/aurral/commit/d49700b590a77374fe433a7c3ea6a30ea47f4071) | 2       | Merge pull request #14 from Collinlong1/claude/brave-mccarthy-mu2ok6                                           | Integration history; current conflict adaptations allocated by net paths      |
| [`7982499065ca41259632c30e63cc376fc030f841`](https://github.com/Collinlong1/aurral/commit/7982499065ca41259632c30e63cc376fc030f841) | 2       | Merge upstream lklynet/aurral main (playlist files replace media server integrations)                          | Integration history; current conflict adaptations allocated by net paths      |
| [`a790aaca2e8f03956be8708f9f1f9ea6d28a083a`](https://github.com/Collinlong1/aurral/commit/a790aaca2e8f03956be8708f9f1f9ea6d28a083a) | 1       | feat(wanted): list cancelled tracks under Missing                                                              | F06 provenance; extract current hunks                                         |
| [`404cf3c10af9ed81b2914a6a48ec85617907cc50`](https://github.com/Collinlong1/aurral/commit/404cf3c10af9ed81b2914a6a48ec85617907cc50) | 1       | feat(playlists): reorder a playlist's tracks                                                                   | F07 provenance; extract current hunks                                         |
| [`79b9bef44762ff79152630f84c1592938de25f42`](https://github.com/Collinlong1/aurral/commit/79b9bef44762ff79152630f84c1592938de25f42) | 1       | feat(library): link a Library file to a missing track                                                          | F08 provenance; extract current hunks                                         |
| [`0ef5061d0c29750ccb5f1b88574e73e87047403a`](https://github.com/Collinlong1/aurral/commit/0ef5061d0c29750ccb5f1b88574e73e87047403a) | 1       | feat(library): rank Library file matches and document the new features                                         | F08 provenance; extract current hunks                                         |
| [`1c68fc63c9858ee9505013ca27ff9cf462755984`](https://github.com/Collinlong1/aurral/commit/1c68fc63c9858ee9505013ca27ff9cf462755984) | 1       | feat(library): import a file from disk for a missing track                                                     | F09 provenance; extract current hunks                                         |
| [`aa7f72a7f299afaced069431b4e4de4332064e8c`](https://github.com/Collinlong1/aurral/commit/aa7f72a7f299afaced069431b4e4de4332064e8c) | 1       | feat(playlists): show Library album covers for imported tracks                                                 | F09, F10 provenance; extract current hunks                                    |
| [`0ed7c1b8999c94d388888d45f3f82ba14a103cd9`](https://github.com/Collinlong1/aurral/commit/0ed7c1b8999c94d388888d45f3f82ba14a103cd9) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`4c3c248aa02e8ab259c04aba4b391ffa73f40366`](https://github.com/Collinlong1/aurral/commit/4c3c248aa02e8ab259c04aba4b391ffa73f40366) | 1       | fix(playlists): lay out the M3U folder import like the rest of Import                                          | Retired/superseded/transient or issue refactor; current net map governs       |
| [`dd20b9539d2a9a5e9a26f1845ebbe87719162c73`](https://github.com/Collinlong1/aurral/commit/dd20b9539d2a9a5e9a26f1845ebbe87719162c73) | 1       | fix(artist): show owned albums that aren't in the artist's discography                                         | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b594cfa0fd1d439b67f93a98214bd52fec6df6e4`](https://github.com/Collinlong1/aurral/commit/b594cfa0fd1d439b67f93a98214bd52fec6df6e4) | 2       | Merge upstream lklynet/aurral main (plugins, per-webhook events, lyrics)                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`a071d7a09754970e997252918e553d1f99d526f6`](https://github.com/Collinlong1/aurral/commit/a071d7a09754970e997252918e553d1f99d526f6) | 1       | refactor(notifications): drop per-event webhook bodies for per-webhook events                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`f1a831062bbe5e85c75be9e61804499a6a2fb137`](https://github.com/Collinlong1/aurral/commit/f1a831062bbe5e85c75be9e61804499a6a2fb137) | 1       | feat(scripts): give each script its own events, like webhooks                                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`140d94f2a86d23b5e4e210b28936120b0801a0f6`](https://github.com/Collinlong1/aurral/commit/140d94f2a86d23b5e4e210b28936120b0801a0f6) | 2       | Merge remote-tracking branch 'upstream/main' into sync/upstream-2026-11-05                                     | Integration history; current conflict adaptations allocated by net paths      |
| [`b2cd79967945512c41cbc7580c9a5f2f59978a45`](https://github.com/Collinlong1/aurral/commit/b2cd79967945512c41cbc7580c9a5f2f59978a45) | 1       | fix(subsonic): refresh playlists after a re-tag or an artist source switch                                     | F13 provenance; extract current hunks                                         |
| [`c4648674dc9af2059878b94105b7049a0d523281`](https://github.com/Collinlong1/aurral/commit/c4648674dc9af2059878b94105b7049a0d523281) | 1       | fix(subsonic): link playlist tracks to their Library album by file                                             | F12 provenance; extract current hunks                                         |
| [`e09a41f70fd2eed1878119da4a886b23c6160be7`](https://github.com/Collinlong1/aurral/commit/e09a41f70fd2eed1878119da4a886b23c6160be7) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`eedfb2efd628c5a73ce5afc06e693aa02b80a0bc`](https://github.com/Collinlong1/aurral/commit/eedfb2efd628c5a73ce5afc06e693aa02b80a0bc) | 1       | fix(playlists): show a Library file's current names on playlist rows                                           | F11 provenance; extract current hunks                                         |
| [`b66bcce48648d39255fc8d2e70af6b65876112b7`](https://github.com/Collinlong1/aurral/commit/b66bcce48648d39255fc8d2e70af6b65876112b7) | 1       | feat: show tracks' artist tags throughout Aurral, not only in Subsonic                                         | Retired/superseded/transient or issue refactor; current net map governs       |
| [`ed07bcae381f7b66a9fda3d31cf3cf6ded3cee2c`](https://github.com/Collinlong1/aurral/commit/ed07bcae381f7b66a9fda3d31cf3cf6ded3cee2c) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`2559e85eb5ab02372a19f393b5cb0c029ca409e8`](https://github.com/Collinlong1/aurral/commit/2559e85eb5ab02372a19f393b5cb0c029ca409e8) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`766039b9a501d2d20d079302c0a36d30f14fbfc0`](https://github.com/Collinlong1/aurral/commit/766039b9a501d2d20d079302c0a36d30f14fbfc0) | 2       | Merge pull request #15 from Collinlong1/sync/upstream-2026-11-05                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`4e3b001e7bb4bb43fddc105bd8ee7c3630a6652b`](https://github.com/Collinlong1/aurral/commit/4e3b001e7bb4bb43fddc105bd8ee7c3630a6652b) | 1       | fix(player): show cover art on Apple TV over AirPlay                                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`54f8ec9aa920b13756acf0dbd2ff5f2ff79b6cdf`](https://github.com/Collinlong1/aurral/commit/54f8ec9aa920b13756acf0dbd2ff5f2ff79b6cdf) | 2       | Merge pull request #16 from Collinlong1/fix/airplay-artwork                                                    | Integration history; current conflict adaptations allocated by net paths      |
| [`1f7ec85b4717cd3905844bf42ff7338289fe5c8c`](https://github.com/Collinlong1/aurral/commit/1f7ec85b4717cd3905844bf42ff7338289fe5c8c) | 1       | Revert "fix(player): show cover art on Apple TV over AirPlay"                                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`c958ec46b3a8b3ad283fb399ac05173500637ff1`](https://github.com/Collinlong1/aurral/commit/c958ec46b3a8b3ad283fb399ac05173500637ff1) | 2       | Merge pull request #18 from Collinlong1/revert/airplay-artwork                                                 | Integration history; current conflict adaptations allocated by net paths      |
| [`4c029cd5b86cd66988a46320d3d95846427748dd`](https://github.com/Collinlong1/aurral/commit/4c029cd5b86cd66988a46320d3d95846427748dd) | 1       | feat(playlists): remove the M3U folder import                                                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`8db017ca2f218f1c49b84dd62c6817c67f87b3a3`](https://github.com/Collinlong1/aurral/commit/8db017ca2f218f1c49b84dd62c6817c67f87b3a3) | 2       | Merge pull request #19 from Collinlong1/remove/m3u-folder-import                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`5114332ad23a7983c6d115167cbb40e1d4442630`](https://github.com/Collinlong1/aurral/commit/5114332ad23a7983c6d115167cbb40e1d4442630) | 1       | chore(settings): drop the one-time webhook event bodies converter                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`dde619183daa5a5cfa62bb279a4afca4c011b222`](https://github.com/Collinlong1/aurral/commit/dde619183daa5a5cfa62bb279a4afca4c011b222) | 1       | chore(settings): remove the webhook event bodies converter itself                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`903ecb4458f25eab0eb56e0c7bd51ee671e33a91`](https://github.com/Collinlong1/aurral/commit/903ecb4458f25eab0eb56e0c7bd51ee671e33a91) | 2       | Merge pull request #20 from Collinlong1/remove/webhook-bodies-migration                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`5cc5b8fdfa0838e36f2c806253e5c07483a23228`](https://github.com/Collinlong1/aurral/commit/5cc5b8fdfa0838e36f2c806253e5c07483a23228) | 1       | chore(users): remove deleting other admin accounts                                                             | Retired/superseded/transient or issue refactor; current net map governs       |
| [`407cfa015644768968c555e76dde5cf217e4c47d`](https://github.com/Collinlong1/aurral/commit/407cfa015644768968c555e76dde5cf217e4c47d) | 2       | Merge pull request #21 from Collinlong1/remove/delete-admins                                                   | Integration history; current conflict adaptations allocated by net paths      |
| [`5c5bc8f0035e89be4c11eae8d9ffd03076a0fa0c`](https://github.com/Collinlong1/aurral/commit/5c5bc8f0035e89be4c11eae8d9ffd03076a0fa0c) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`e29a72f538ea2ed60bd0bdef17366a2040288a87`](https://github.com/Collinlong1/aurral/commit/e29a72f538ea2ed60bd0bdef17366a2040288a87) | 1       | fix(library): drop the fork's load-every-page album and artist fetch                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`1ca2752073b1c353081bb2b223843db76eab6566`](https://github.com/Collinlong1/aurral/commit/1ca2752073b1c353081bb2b223843db76eab6566) | 2       | Merge pull request #22 from Collinlong1/sync/upstream-2026-11-06                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`45863a68779a36c6ef5bdc9bb6a5408ddc2aa22c`](https://github.com/Collinlong1/aurral/commit/45863a68779a36c6ef5bdc9bb6a5408ddc2aa22c) | 2       | Merge pull request #23 from Collinlong1/fix/drop-show-every-track                                              | Integration history; current conflict adaptations allocated by net paths      |
| [`7880950efee092526cc9dd3f3c1e9c3775e9b663`](https://github.com/Collinlong1/aurral/commit/7880950efee092526cc9dd3f3c1e9c3775e9b663) | 1       | feat(library): remove box-set naming and the box set's own cover                                               | Retired/superseded/transient or issue refactor; current net map governs       |
| [`2878a90da2e4fa1bba101233a712768465a276f5`](https://github.com/Collinlong1/aurral/commit/2878a90da2e4fa1bba101233a712768465a276f5) | 2       | Merge pull request #24 from Collinlong1/fix/drop-box-set-naming-cover                                          | Integration history; current conflict adaptations allocated by net paths      |
| [`cea3d0890725cbee3d285253fc73b01dd20bf026`](https://github.com/Collinlong1/aurral/commit/cea3d0890725cbee3d285253fc73b01dd20bf026) | 1       | feat(library): name box set discs after their disc subtitle tag                                                | Retired/superseded/transient or issue refactor; current net map governs       |
| [`2e5e8555bd1e072d0b121fdc67c5c667c91e1c6b`](https://github.com/Collinlong1/aurral/commit/2e5e8555bd1e072d0b121fdc67c5c667c91e1c6b) | 1       | Revert "feat: show tracks' artist tags throughout Aurral, not only in Subsonic"                                | Retired/superseded/transient or issue refactor; current net map governs       |
| [`a77c3af3c4d05213668962be83189e1db237d6d9`](https://github.com/Collinlong1/aurral/commit/a77c3af3c4d05213668962be83189e1db237d6d9) | 1       | chore(subsonic): stop tracking artist source switches for refreshes                                            | Retired/superseded/transient or issue refactor; current net map governs       |
| [`866a26cdd8a639cc39c2383642fbd59d25553370`](https://github.com/Collinlong1/aurral/commit/866a26cdd8a639cc39c2383642fbd59d25553370) | 1       | Revert "fix(subsonic): keep compilation track artists with artist tags on"                                     | Retired/superseded/transient or issue refactor; current net map governs       |
| [`17b4960fabef4376fcf9ba2da246e5ac386b1b84`](https://github.com/Collinlong1/aurral/commit/17b4960fabef4376fcf9ba2da246e5ac386b1b84) | 1       | chore(subsonic): remove serving artist names from file tags                                                    | Retired/superseded/transient or issue refactor; current net map governs       |
| [`8a26f2dac392c447d3cd68ea28f95809da585b67`](https://github.com/Collinlong1/aurral/commit/8a26f2dac392c447d3cd68ea28f95809da585b67) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`6576f6f93841704b18cdddae1a0d039da38a9e31`](https://github.com/Collinlong1/aurral/commit/6576f6f93841704b18cdddae1a0d039da38a9e31) | 1       | fix(scripts): queue custom scripts on Aurral's own job queue                                                   | Retired/superseded/transient or issue refactor; current net map governs       |
| [`ecd3a7ce893aa190532c500e388647204cff1f7f`](https://github.com/Collinlong1/aurral/commit/ecd3a7ce893aa190532c500e388647204cff1f7f) | 1       | chore(activity): remove bulk-cancel of queued downloads                                                        | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3b6cae5d91b60a714a7e1a352c627ad44f9ef816`](https://github.com/Collinlong1/aurral/commit/3b6cae5d91b60a714a7e1a352c627ad44f9ef816) | 1       | chore(library): drop the fork's retagged-copy fix                                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`95392a6f579a1c660e8a66242948ae020016fd98`](https://github.com/Collinlong1/aurral/commit/95392a6f579a1c660e8a66242948ae020016fd98) | 1       | chore(artist): drop the fork's owned-albums-outside-discography rail fix                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b7d40433f1bedc9949c011514b60d39f7a17a740`](https://github.com/Collinlong1/aurral/commit/b7d40433f1bedc9949c011514b60d39f7a17a740) | 1       | chore(scripts): remove the built-in custom scripts feature                                                     | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3cc4f3fc44e0d279d45c88e6bc88394cccc5c5c6`](https://github.com/Collinlong1/aurral/commit/3cc4f3fc44e0d279d45c88e6bc88394cccc5c5c6) | 1       | chore(scripts): drop the script-events settings migration                                                      | Retired/superseded/transient or issue refactor; current net map governs       |
| [`8c228c11d2ff8c3f97b18fcc18ad6d547e560571`](https://github.com/Collinlong1/aurral/commit/8c228c11d2ff8c3f97b18fcc18ad6d547e560571) | 2       | Merge upstream lklynet/aurral main (playlists point at Library tracks, app API v2)                             | Integration history; current conflict adaptations allocated by net paths      |
| [`58667789c3d2d14e89c898355579e66a4a79d0a5`](https://github.com/Collinlong1/aurral/commit/58667789c3d2d14e89c898355579e66a4a79d0a5) | 1       | chore(playlists): drop the fork's Library album cover fallback for playlist tracks                             | F10 provenance; extract current hunks                                         |
| [`718a79e514389c0436d61926f8666f59e79de5f7`](https://github.com/Collinlong1/aurral/commit/718a79e514389c0436d61926f8666f59e79de5f7) | 2       | Merge upstream lklynet/aurral main (disc headings on multi-disc albums)                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`37b670eb6142301541cd4948e14b726af57ce991`](https://github.com/Collinlong1/aurral/commit/37b670eb6142301541cd4948e14b726af57ce991) | 1       | fix(playlists): bring back Library album covers for linked and imported playlist tracks                        | F10 provenance; extract current hunks                                         |
| [`b34c910c084f56071343dc21f71e3399cab2f7df`](https://github.com/Collinlong1/aurral/commit/b34c910c084f56071343dc21f71e3399cab2f7df) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`d840e5b34965989df9bb5315cc22a8118db87d47`](https://github.com/Collinlong1/aurral/commit/d840e5b34965989df9bb5315cc22a8118db87d47) | 1       | test(perf): record the fork's Subsonic playlist query count                                                    | F12 provenance; extract current hunks                                         |
| [`11e8cff64551fa2810fc9484aa99a1d6b5d8009a`](https://github.com/Collinlong1/aurral/commit/11e8cff64551fa2810fc9484aa99a1d6b5d8009a) | 1       | fix(downloads): starting a running worker wakes it for newly queued jobs                                       | F14 provenance; extract current hunks                                         |
| [`a544a9b81ddd748bc26b72347703a4934f36ff4b`](https://github.com/Collinlong1/aurral/commit/a544a9b81ddd748bc26b72347703a4934f36ff4b) | 1       | fix(plugins): updates install when staging is on another disk, and roll back on failure                        | F15 provenance; extract current hunks                                         |
| [`d4deed1011913bb2f43cd47752db28da08c0be1f`](https://github.com/Collinlong1/aurral/commit/d4deed1011913bb2f43cd47752db28da08c0be1f) | 1       | fix(matching): a file tagged with the requested recording ID is no artist contradiction                        | F16 provenance; extract current hunks                                         |
| [`35493262815bf32e76084a2587b9583d9d15cb47`](https://github.com/Collinlong1/aurral/commit/35493262815bf32e76084a2587b9583d9d15cb47) | 2       | Merge upstream, wake the worker for new requests, plugin updates across disks, classical artist matching (#27) | Integration history; current conflict adaptations allocated by net paths      |
| [`e97d3380880e8194fb36e58a9f81d25eefad9cd0`](https://github.com/Collinlong1/aurral/commit/e97d3380880e8194fb36e58a9f81d25eefad9cd0) | 2       | Merge pull request #28 from lklynet/main                                                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`287ab4b76ca8a9d231b684089d02ddc9d9ea70a2`](https://github.com/Collinlong1/aurral/commit/287ab4b76ca8a9d231b684089d02ddc9d9ea70a2) | 2       | Merge pull request #29 from lklynet/main                                                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`aa643d316e9e00fb8622ab60b2fb2cb8b76661ee`](https://github.com/Collinlong1/aurral/commit/aa643d316e9e00fb8622ab60b2fb2cb8b76661ee) | 2       | Merge pull request #30 from lklynet/main                                                                       | Upstream refresh only; no new fork feature                                    |
| [`c0deb211eba929424b608ca1c2449c7242892d9c`](https://github.com/Collinlong1/aurral/commit/c0deb211eba929424b608ca1c2449c7242892d9c) | 2       | Merge pull request #31 from lklynet/main                                                                       | External upstream refresh observed at final verification; no new fork feature |

## Unchanged baseline findings

The unchanged fork full unit run passed 2,743 tests and timed out one unchanged slskd-client deadline test during concurrent builders; the affected file then passed all 28 tests under normal load. This is not reported as one uninterrupted green full-suite run. Main source was never changed.

Its application build, generated DB types, UI CSS and typecheck pass. Its existing check command is red: jobs.ts formatting, unused LinkLibraryFileResult/ImportDiskFileResult type imports, and two unsafe-any findings in ActivityMissingPage query-cache filtering. Those source issues are absent from independently validated branches after extraction; neither main nor the reused classical source baseline was silently cleaned up. Phase 1 should first make the classical baseline checks green after approval.

## Existing classical branches

Reuse was expressly confirmed by the user. Fork classical began at 287ab4b76ca8a9d231b684089d02ddc9d9ea70a2 and is fast-forwarded through the frozen entry-main ancestry, then receives handoff docs. Plugin classical began at 506e5259e1442b8cfe072a75b129abb428c6bcf7 and receives docs only. No branch deletion/reset/force push, main merge, upstream write or PR. Stop for review before Phase 1.

# Phase 1 inventory addendum — November 10, 2026

User authorized Phase 1 and fork-only PRs targeting aurral-classical. Read PHASE_1_REPORT.md and HANDOFF.md for current implementation, files, tests and source state. The Phase 0/0.5 inventory below is historical preservation evidence.

External merges advanced core main to 3739443a and classical to 1b3c1c00; the agent preserved these changes on the review branch and did not write main. Matching upstream is now 021b1f03. Live main still has the same 52 net changed paths (+3130/-181), now 111 historical fork-only commits. All 16 preservation branches remain unchanged on 7afcb7cb. New Phase 1 hooks/fixes are separate from F01–F16 and are documented as D02/D03/D06/D07 in central UPSTREAM_DELTA.md. No upstream PR was opened.
