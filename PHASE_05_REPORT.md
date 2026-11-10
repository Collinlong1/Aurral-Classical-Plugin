# Aurral Classical — Phase 0.5 report

## Final-verification drift correction

Fork main advanced **externally to this task** from `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` to `c0deb211eba929424b608ca1c2449c7242892d9c` via merge PR #31, bringing upstream `656475b92be36b6834002da2407e7d9d50c2e0c2` (the owned-albums artist-page fix). No agent write or merge targeted main. The live fork now matches upstream `656475b92be36b6834002da2407e7d9d50c2e0c2` with **110 historical fork-only commits and the same 52 net changed paths**.

Preservation branches remain independently tested one-commit branches on the matching upstream base selected at Phase 0.5 entry, `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`. Classical runtime source remains the frozen entry fork main `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` plus documentation; it does not silently absorb the later update. The user-created classical branches are reused. Reconcile this newly observed nightly drift on classical only after the next phase is approved. Do not reset, overwrite or try to restore live main to the older audited SHA.

All references below to an unchanged main mean **no main edits by this task**, with source/test baseline SHAs explicitly pinned. They do not claim the live fork main stayed stationary while another upstream merge occurred.


**Preservation work complete for review. Phase 1 has not started.**

The user approved the next phase, confirmed the existing classical branches were created for this project, and clarified that upstream must remain read-only. All edits and issue branches are confined to the user’s repositories. No PR was opened or updated.

## Outcome

- Published 16 independent, single-issue preservation branches in Collinlong1/aurral. Each commit has the frozen matching upstream commit as its sole parent.
- Split mixed code, helper dependencies and tests; no issue branch inherits other fork features.
- Independently passed required check stages and application builds on every branch; docs builds passed where changed.
- Reused both existing aurral-classical branches. Core runtime source is the frozen entry fork-main source; plugin runtime source is unchanged. Handoff/analysis documentation is added on these existing branches.
- No main, upstream, production server, credentials, deployment, classical runtime implementation or schema changes.

## Frozen references

| Reference | SHA |
| --- | --- |
| Matching upstream base / every issue parent | `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef` |
| Fork main at Phase 0.5 entry/test baseline (later external advance above) | `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` |
| Plugin main/source, unchanged | `506e5259e1442b8cfe072a75b129abb428c6bcf7` |
| Existing core classical before adoption | `287ab4b76ca8a9d231b684089d02ddc9d9ea70a2` |
| Later observed upstream main (read only) | `656475b92be36b6834002da2407e7d9d50c2e0c2` |

Fork main received one upstream-only merge since Phase 0: same 52 changed paths, now 109 historical fork-only commits. Latest upstream advanced another commit during work; matching base remains the commit actually merged into the unchanged fork. No latest-nightly compatibility claim is made beyond the tested frozen base.

## Published branch review

| Issue | Branch | Commit | Focused tests |
| --- | --- | --- | --- |
| F01 | [feature/optional-fork-container-image](https://github.com/Collinlong1/aurral/tree/feature/optional-fork-container-image) | `8991619c5eee` | workflow lint |
| F02 | [fix/missing-track-download-status](https://github.com/Collinlong1/aurral/tree/fix/missing-track-download-status) | `c31abe13cd60` | 3 |
| F03 | [feature/numbered-library-pagination](https://github.com/Collinlong1/aurral/tree/feature/numbered-library-pagination) | `f16b4e057f03` | 3 |
| F04 | [feature/library-page-size](https://github.com/Collinlong1/aurral/tree/feature/library-page-size) | `100864c635cd` | 1 |
| F05 | [fix/album-scoped-track-ownership](https://github.com/Collinlong1/aurral/tree/fix/album-scoped-track-ownership) | `183b22ca3388` | 22 |
| F06 | [fix/wanted-cancelled-tracks](https://github.com/Collinlong1/aurral/tree/fix/wanted-cancelled-tracks) | `a9c9a2abd64c` | 8 |
| F07 | [feature/playlist-track-reorder](https://github.com/Collinlong1/aurral/tree/feature/playlist-track-reorder) | `29b9baf0d36a` | 4 |
| F08 | [feature/link-missing-track-library-file](https://github.com/Collinlong1/aurral/tree/feature/link-missing-track-library-file) | `8886ca2c8a4b` | 5 |
| F09 | [feature/import-disk-file-for-missing-track](https://github.com/Collinlong1/aurral/tree/feature/import-disk-file-for-missing-track) | `e2e55bd09e2e` | 5 |
| F10 | [fix/playlist-local-album-artwork](https://github.com/Collinlong1/aurral/tree/fix/playlist-local-album-artwork) | `1b8358d53363` | 1 |
| F11 | [fix/playlist-current-library-names](https://github.com/Collinlong1/aurral/tree/fix/playlist-current-library-names) | `ca666ca9c24d` | 1 |
| F12 | [fix/subsonic-playlist-file-identity](https://github.com/Collinlong1/aurral/tree/fix/subsonic-playlist-file-identity) | `576ef4b266e1` | 40 |
| F13 | [fix/subsonic-playlist-rescan-timestamp](https://github.com/Collinlong1/aurral/tree/fix/subsonic-playlist-rescan-timestamp) | `d2151224bf94` | 1 |
| F14 | [fix/wake-running-download-worker](https://github.com/Collinlong1/aurral/tree/fix/wake-running-download-worker) | `2607fd60f558` | 30 |
| F15 | [fix/plugin-install-cross-device-rollback](https://github.com/Collinlong1/aurral/tree/fix/plugin-install-cross-device-rollback) | `963b3bc97c08` | 8 |
| F16 | [fix/recording-id-artist-contradiction](https://github.com/Collinlong1/aurral/tree/fix/recording-id-artist-contradiction) | `ab1f64f53f39` | 17 |

`FORK_FEATURE_INVENTORY.md` gives actual files, original commits, dependencies/adaptations, test evidence and historical accounting. `PRESERVATION_BRANCHES.json` is the machine-readable exact-SHA manifest.

## Validation actually completed

- Runtime: checksum-verified Node 26.12.0 and pnpm 12.15.0, matching repository CI inputs; ffmpeg available.
- Matching upstream baseline: 402 files / 2,717 unit tests passed; zero-error typecheck.
- Independent issue branches: formatting/lint, CSS policy, generated DB-type check, zero-error typecheck and unsafe-any baseline all pass; no baselines raised for type/unsafe-any.
- All 16 application builds and all 13 changed-documentation builds passed. Astro telemetry was disabled and configuration/cache routed to workspace directories; no source workaround was committed.
- Focused issue suites: 149 tests passed, including 40 Subsonic API integration tests, five Library-link tests, five disk-import tests and eight installer tests.
- Installer regression includes orphan previous-folder recovery after another failed update. Timestamp regression covers list/detail and unrelated files.
- Four playlist performance budget tests passed. F10/F11 budgets unchanged; F12 is +1 query (130/50), F13 +9 (138/58). Only the affected scenario is adjusted in each corresponding branch.
- Optional publishing workflow passed actionlint 1.7.12. GitHub run 42840423363 was completed/skipped; publishing opt-in was not enabled.
- Existing plugin source: all 124 tests passed on Node 26.12.0.
- Local staged Git trees matched GitHub-created trees before branch publication; fetched published commits match and worktrees are clean.

## Findings on the unchanged fork baseline

The broad fork run was **not an uninterrupted green run**: 404 files/2,743 tests passed, while one slskd-client deadline test timed out during resource-heavy concurrent builders. The file was rerun after those builders stopped and all 28 tests passed. No test timeout, test source or production source was changed to conceal the result.

The unchanged fork’s application build, typecheck, generated DB types and CSS policy pass, but existing formatting/lint checks are red:

1. `backend/routes/playlists/handlers/jobs.ts` formatting.
2. Unused `LinkLibraryFileResult` and `ImportDiskFileResult` type imports in that file.
3. Two unsafe-any findings in `frontend/src/pages/activity/ActivityMissingPage.tsx` query-cache filtering.

Independent extractions remove those unused dependencies and type the cache correctly. The original main/classical baseline is not silently rewritten. Phase 1 should start by reproducing and cleaning these checks **on aurral-classical only**, after approval. These are outstanding baseline check issues, not newly introduced failures in the preservation branches.

Initial validation also exposed a task-environment problem: symlinked dependency directories triggered competing package-manager installs. They were replaced with independent offline worktree installs, and affected checks rerun. A killed typecheck was rerun successfully after memory pressure ended. Missing split-helper type declarations were corrected before publication.

## Phase boundaries and next work

No four-known-bug implementation, plugin data model, SQLite migration, editor, work page, grouping hook or integration API was implemented here. Those remain Phase 1–4 work. The existing recording-ID artist fix was preserved, not newly introduced.

Existing design conclusions remain: separate plugin SQLite, generic page/resource and trusted-user hooks, exact native playlist refs, bounded segment playback, conservative reconciliation and persistent jobs; stock editor/work-page fallback is still unavailable today. See updated design documents.

Before Phase 1, obtain user approval. Then use only the existing aurral-classical branches, keep both mains/upstream read-only, make the inherited baseline checks green, pin CI/dev inputs and synthetic fixtures, and follow the dependency-ordered Phase 1 plan. No production server or credentials.

## Review and handoff files

`HANDOFF.md` and `CLAUDE_CODE_HANDOFF.md` are current. `AGENTS.md` and `CLAUDE.md` direct future tools to them. `PHASE_0_REPORT.md` is historical analysis with a current-status banner; inventory and delta have refreshed baselines. Exact validation data is in `PHASE_05_VALIDATION.json`. Raw logs and immutable source archives remain in the task workspace; all source commits are recoverable from the linked user repositories.
