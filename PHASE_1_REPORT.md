# Phase 1 — dev setup and four bug fixes

## Final local validation

Published reviews: core PR36 https://github.com/Collinlong1/aurral/pull/36 and plugin PR6 https://github.com/Collinlong1/Aurral-Classical-Plugin/pull/6. Both target the user's aurral-classical branch and remain unmerged.

Remote CI initially passed core unit/integration/Perf and plugin Node22/24/26 tests/bundle checks. Core CI encountered inherited workflow failures: Dependency Review unsupported without this fork's Dependency Graph, and uppercase ghcr.io/Collinlong1 image tag. The core PR includes a dependency-change gate and lowercase image normalization; no test failures are hidden and no continue-on-error added. The disposable Compose CI run started; consult live PR checks for its conclusion. These workflow fixes do not change runtime source pinned by the plugin CI.

Core review PR: https://github.com/Collinlong1/aurral/pull/36 (base aurral-classical), source commit aecbb96625340cb3a1bd469787211cfe9bedcab5. Integration CI pins this exact core commit. Plugin companion PR targets its own aurral-classical branch. No PR is merged.

Post-drift full core unit suite: **406 files / 2752 tests passed**. Final focused grants/playlists: **33 tests passed**, including expiry, exact duplicate metadata, revocation and idempotency. Subsonic integration: **40 passed**. Plugin: **138 passed**. Core production frontend builds pass before and after the externally supplied activity update. Core formatting/lint/CSS/generated DB types/typecheck/unsafe-any checks pass after narrowing the final fast-path return; zero type errors and no baseline increase.

Running pinned Compose smoke passed repeatedly and after restart, including admin plus two regular users streaming every comparison entry, cross-user playlist denial and zero acquisitions. Source bundle regenerated. CI workflow is included; remote run status is a separate GitHub check and is not implied by these local results. No browser-driven UI or real-library validation is claimed.

The full post-drift run was green. Later tiny type/test/documentation refinements were covered by focused checks, rather than relabeling an older source run as an exact final-head full-suite run. Earlier formatting/unsafe-any failures are preserved in workspace logs and were corrected without raising baselines.


November 10, 2026. User authorized completing Phase 1 and opening fork-only PRs targeting the existing aurral-classical branches. Phase 2–4 implementation remains deferred.

## Implemented behavior

| Acceptance | Implementation and evidence |
| --- | --- |
| Disposable Compose/CI | Plugin compose.dev.yaml pins Node26.12 by digest, mounts prepared fork/plugin source read-only, uses separate synthetic config/library volumes and an internal network. dev/fixtures.json and committed synthetic FLACs cover the authoritative fixture cases. dev/mock-providers.mjs returns recorded MusicBrainz responses or explicit 404s. CI workflow checks/builds the fork and runs dev/smoke.mjs before and after restart. |
| Compare scope | src/compare.js uses the complete authenticated owned-library snapshot, explicit work tags or recording/work relations, and all owned recordings across releases. It removes provider recording-list gates, recording/movement caps and remote downloads. Same recording/work/duration across releases has one playable entry plus release evidence in comparison-USER.json; different work IDs never join by title. Thirty-recording regression includes provider omissions, a second release and an unrelated same-title work. Explicit work tags allow a broadcast without recording MBID. |
| Local comparison playback/ownership | Host supplies action-scoped v1 grants for real users. Playlist keys are scoped by plugin/user/key, not display name. Existing durable queue executes local-only playlist upserts, rechecks active user, action/capability, expiry, ownership and blocked-artist permissions, and reports committed completion/failure. Native indexed-path pinning is shared across create/update/append; explicit stale paths fail without acquisition. Tests cover same metadata/different files and regular users without acquisition permission. |
| Seven-value removal | Restore-original and explicit clear actions are distinct; preview counts affected values. No-backup removal explicitly clears composer/work/work-ID and reports cleared, not restored. Explicit clear retains any original backup. Backup is persisted before tagging, written temp media is reopened and verified before atomic replacement, and all matching ID3 work frames are examined. Tests reopen FLAC/MP3/M4A/Opus after clear/restore, cover duplicate ID3 frames, injected read-only replacement failure, retained backup/audio/unrelated tags and rescheduling exclusion. Background writes default off. |
| slskd artist identity | Plugin prefers soloist, then conductor/ensemble; queries start with performer and retain orchestral credits. No performer produces no composer-as-performer fallback. Candidate folders require performer evidence in addition to existing duration/edition/quality checks. Generic opt-in native acquisition hook runs before native Soulseek query construction regardless of source priority, persists identity with the attempt and filters required performer terms. Liszt/Trifonov, wrong-performer and no-op rock cases are tested. Display artist remains separate. |

## Core delta and contract

Generic changes are in pluginManifest.ts, pluginService.ts, pluginUserOperations.ts, pluginAcquisitionIdentity.ts, plugin types, plugin routes/authentication, playlist normalization/operations/worker and native slskdOrchestrator.ts. No classical schema, title parsing or provider logic is added to core. Inherited source lint issues were corrected on classical only; audit docs were formatted to satisfy repository checks.

Action manifests opt in with localPlaylists:true. Action input userOperations:{version:1,url,token} authorizes only local snapshot, local playlist upsert and own operation status. The signed grant binds plugin/action/real-user/expiry; body owner IDs and arbitrary playlist IDs are not accepted. Legacy admin plugin API keys retain their old behavior. Synthetic admin -1 cannot create a user-scoped playlist. No session cookie is stored.

D02/D03 and a bounded Phase 1 D06/D07 implementation now exist. D01 views/resources, D04 album contributions, D05 queue ranges and full model/reconciliation APIs remain proposals. The snapshot is currently a complete in-memory indexed-library response, not a cursor/generation API. It must fail rather than silently truncate; future large-library memory/load tests and cursor reconciliation belong to Phase 2.

## Source and branch record

Plugin base classical 393fbdb507324473ba861b577a9517d252332048; plugin main 506e5259e1442b8cfe072a75b129abb428c6bcf7.
Core entry classical 1a7f0081ef6b75ce4faa408dfae3a40572d1d359. Local drift merge 30ba667d preserved fork main c0deb211. During work, external upstream merges advanced core main to 3739443a000defa9f246681e8a62233c1faef1c3 and classical to 1b3c1c0074bd39df48bb115eca5254a07dde64b9. Those changes are preserved in the review branch, with no agent write to either main. Latest matching upstream base is 021b1f03; original fork inventory remains 52 net paths and 111 historical fork-only commits.

Implementation was developed on the existing classical branches. phase1-review snapshots support the requested PRs into aurral-classical in Collinlong1/aurral and Collinlong1/Aurral-Classical-Plugin. No upstream PR, merge, deployment, release or production connection. Preservation branches are unchanged.

## Verification record

- Initial core full unit run: 406 files / 2750 tests passed. This preceded the external activity-page drift.
- Focused core suites: 63 tests passed; added exact duplicate-metadata/read-only-file test then passed all 13 playlist-library tests.
- Subsonic API integration: 40 tests passed.
- Plugin full suite: 138 tests passed on Node26.12.0. Bundle regenerated from source.
- Post-drift core checks/type/build and full-suite final results are recorded in the final validation addendum.
- Running Compose HTTP/stream test passed for admin and two regular users, including a repeat after restart: three distinct owned playlists, all local entries stream, cross-user playlist read denied, zero acquisitions.
- An initial dev smoke failed authentication because fixture onboarding was incomplete; seed and scoped global authentication routing were fixed. A new unsafe-any failure in queue tests was fixed by parsing unknown payloads through the operation schema. No baseline was raised. Initial inherited stale-path fallback test was deliberately updated to reject stale explicit local refs.

## Migrations, limits and next phase

No new migrations or SQL tables. Running the disposable app initializes only its separate fixture database using existing core migrations. Plugin backups/exclusions and diagnostics remain JSON; proposed classical.sqlite and entity schema are not implemented.

No real-library/server validation or production credentials. Stock API-1 hosts without userOperations v1 show a missing-capability error for comparison and create no ownerless playlists. Tag/source features remain available; editor/work pages are not advertised. Multi-work/ambiguous work tags are reported for review, not title-merged. Segments, grouping and manual entities without explicit work identity wait for later phases. Core maintenance may log failed external chart refresh attempts inside the isolated network; no live provider response is consumed.

After Phase 1 review, obtain approval before Phase 2 data-model work. Keep core deltas generic and plugin storage independent. Do not merge PRs automatically.

