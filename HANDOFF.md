# Messy metadata matching (optional quality workstream, plugin only)

The user asked to work from *Aurral Classical — Messy Metadata Matching* (November 12, 2026). New `src/model/credits.js` reads a composer from a mixed artist field ("Bedřich Smetana; Vienna Philharmonic") when no composer tag exists: high confidence only when the album/track title, catalogue system or a known library composer corroborates it; medium-confidence names never create works and open an `auto_match` review (`uncertain-composer`). Classification, matching and the album page share it. Title parsing handles comma-separated movements and colon-before-quote headings; the classifier knows WWV/BuxWV/SWV/TrV and comma-anchored L./M./S./FP; neighbouring pieces join when one heading is the other cut at a comma. Apple corpus: messy 113 → 150/204 exact (false joins 167 → 155), store 153 → 157, work-tags 191 unchanged; no album lost exact grouping; non-classical corpus unchanged (0 false positives). The Apple gate now also blocks new false joins. Audit, explained differences and what was not done (MusicBrainz candidate scoring) are in `MESSY_MATCHING_REPORT.md`; `node scripts/corpus-apple-audit.mjs` reproduces it. 259 tests pass. Manifest 1.0.11. No core, schema, tagger or media change.

# v0.1 classification accuracy fix (plugin only)

The user authorized the classification fix scope (November 12, 2026). New `src/model/classify-evidence.js` replaces `classify()`'s scoring: composer credits and generic title words are supporting only, a WORK tag equal to the title is ignored, genres match as whole names via the resolver's lists, popular genres block automatic classical, and soundtrack, game and crossover genres allow only verified classical works. Pins and inherited album pins are unchanged. Read-only diagnostics: `node scripts/model-admin.mjs classification MODEL_FOLDER` and the admin album action **Classification report (read only)**. On the non-classical corpus (now 32 albums, 157 tracks) there are 0 false positives and 0 false negatives, enforced in CI. Apple messy-style grouping is 94 → 113/204, with two explained matcher side effects; store and work-tag styles are unchanged. 234 tests pass. Manifest 1.0.10. No matcher, tagger, schema, core or deployment change. Real-library validation is a user-run dry run; see `NONCLASSICAL_CORPUS_REPORT.md`.

# v0.1 non-classical validation corpus (tests and reporting only)

`test/corpus/nonclassical/` adds 30 albums / 148 tracks of ordinary music, mixed soundtracks, crossover and mistagged classical fixtures, each with reviewed track- and album-level expectations. `test/corpus-nonclassical.test.js` runs them through the real admin scan, auto-match, album/track pins, a retag and rescans, and gates on `nonclassical-baseline.json` (every known failure carries a written explanation). CI runs both corpora (`corpora` job) and the new corpus in the no-network isolation job. No `src/` or bundle change. Result: **v0.1 classification acceptance not met**. There are 30/108 false classical positives (generic WORK tags, substring genre matches such as "rock opera"/"baroque pop"/"new romantic", and tempo words in titles); pins, media, rescans and behaviour-follows-classification hold. See `NONCLASSICAL_CORPUS_REPORT.md`. Classifier fixes need separate approval; expected states await user review.

# v0.1 bug-fix scope — remaining fixes and final integration

Same day, at the user's request (“Continue with all of the fixes”). All 16 scope items now have fixes and regression tests. Plugin-only runtime changes; core source unchanged. Schema unchanged (still migration 3).

- **#11** Lyricist is a model role (person only); both editors use one shared role list and explain wrong contributor kinds.
- **#6** Revision tokens now cover what the page shows (entry + movements; album tracks, attached works, classification state and attachments; review + subject). Writes whose targets fall outside the token's scope are rejected (409), closing the hole where an empty-page token skipped stale checks. A no-change rescan doesn't stale an album page.
- **#10** Sync requests are cleared only after a fresh snapshot is queued, and only if no newer request arrived; a failed snapshot, a pending older scan or a resumed failed scan no longer drops them. A request newer than a failed scan takes a fresh snapshot instead of resuming.
- **#21** Provider conflicts, omissions and state reviews keep every field/record in one review (`entries`) instead of overwriting; pinned fields no longer re-raise conflicts. Provider label `openopus` now shows as Open Opus.
- **#16** Review actions: merge into the other work (duplicate-work), merge same-name people, choose a provider value per conflicting field (`choose-provider-value`, pins that assertion), link a moved file to a candidate (`relink-track`).
- **#22** `similarWorks` finds likely duplicates (same key, or same bare title ignoring key/catalogue). Create work / Create from album refuse with a 409 listing them unless **Create anyway**; album pages list *This work may already exist* with **Assign here**.
- **#20** MusicBrainz parent/leaf `composer` relations travel as `composerIds`; matching reuses the person holding that artist ID, gives the ID to the only unverified same-named person, queues review when several could be them, and won't reuse a same-titled work by a differently verified composer.
- **#5** Single-track works: tag rule (WORK tag naming the work, no movement part, title is that work) and MusicBrainz rule (parentless, non-collection work whose track title isn't a movement). Created with no movements; existing group keys unchanged. Corpus output identical.
- **#8** Reusing a work for a MusicBrainz-identified album records the MusicBrainz ID on it; lookups also try the tags' title and MusicBrainz aliases (an alias index used only for lookups); works tied to another MusicBrainz ID are excluded. The explicit auto-match's unattached-track query had the #1 leftover-segment bug and is fixed.
- **#4** Integration CI now pins core `10cd64083bd8d69af85c8356124664b5abf1306f` (final `aurral-classical` head; the old pin `45da13b` predated five core commits). Run locally without Docker (no daemon here) by mapping the Compose paths to disposable directories under Node 26.12 with the preinstalled Chromium: core `pnpm check` (0 type errors, unsafe-any 1236 = baseline) and `pnpm build`, smoke (admin + two users, exact-file streaming, zero acquisition), editor fixtures, full Chromium editor + Phase 4 work view, restart, persistence/media-hash check and smoke again all passed. Fixing it needed only test updates for intentional core UI changes (“By work”/“By track” labels, work titles as links, “Missing …”, player naming the work on the album page) and two stale checks (schema version now read from the latest migration; album-ordered groups split a non-contiguous recording). Remote CI not observed from here.
- **#12** README gains a current Classical catalogue section replacing the Phase 2/3 review notes; EDITOR_GUIDE covers review actions, Create anyway, roles and stale tabs.

Validation: 234/234 plugin tests (10 new regressions, each failing on the previous source), both corpora, Phase 1 comparison smoke. Not done: read-only scan of the real library (no production access is authorized; the user must run it). Noted, not changed: the work page player shows only the part title, while the album page shows “Work: part”.

# v0.1 bug-fix scope — matching fixes #7 and #9

Same day, at the user's request (“Keep going with #7 and #9”). Plugin-only; core, schema and media unchanged.

- **#7 Duplicate creation on ambiguity.** When more than one existing work matched an album, auto-match created yet another work, re-pointed its index at that new copy (so later albums landed there too) and only then opened a review. It now opens an `auto_match` review (`ambiguous-work`, listing the candidates) and creates nothing. A composer name shared by several existing people likewise queues `ambiguous-composer` instead of adding another person. The review page links each candidate; assigning the album from the editor resolves the review.
- **#9 Metadata erased on parse failure.** When the tag parser rejected a file, the scan replaced its evidence with empty tags, wiping composer, WORK, MusicBrainz IDs and genres (and with them classification and matching). The scan now keeps the evidence an earlier scan read, marked `tagsUnreadable`, unless the audio hash shows different audio; host title/artist/album fill only fields the tags never had.

Validation: 224/224 plugin tests including both corpora; 3 new regressions confirmed to fail on the previous source. Integration CI and real-library scan not run here. Still open from the scope: #5, #8, #10, #20 (beyond the ambiguity guard), #21, #22, #6, #11, #16, #4, #12.

# v0.1 bug-fix scope — data-integrity fixes (#1, #2, #3, #15)

November 12, 2026. The user asked to work from the *Aurral Classical — v0.1 Bug-Fix Scope* document. This pass fixes its data-integrity group only; the matching/metadata, editor/review, integration (#4) and README (#12) items remain open. Plugin-only; core, schema and media are unchanged.

- **#1 Incomplete unassign.** Unassign and v1 Detach removed only the `realization_item`. The leftover segment kept the track "attached" for auto-match, and leftover recording content/performance links kept the work and movement "in use". New `Catalogue.detachItem` removes, in one transaction, the segment, its content links, an emptied realization (clearing user/admin picks of it) and, for Unassign, the per-track recording and emptied performance. Auto-match now counts a track as attached only through a realization item, which also covers segments orphaned by older unassigns. An admin Unassign is a manual override: auto-match won't put that album back into that work until the admin assigns it again (read from the editor audit trail).
- **#2 Stale identities after merge.** Merging works or people moved only `embedded-tags` identities, so a MusicBrainz work ID kept pointing at the deleted work and later provider matching attached tracks to it. All identities (works, their mapped movements, people) now move to the survivor; provider lookups ignore deleted entities; `repairMergedIdentities` follows merge audit records to fix already-merged catalogues on the next match pass. The duplicate-composer repair now uses the same merge path.
- **#3 Lost preferences.** When a user had state on both works, `UPDATE OR IGNORE` dropped the merged-away row's favourite and pick. Rows now combine: favourite if either was, the kept work's pick, else the dropped work's.
- **#15 Not-classical tracks reassigned.** *Create a work from this album* sent every unassigned track, including ones marked Not classical, and flipped them back to Classical. The form now has a per-track **Add as a movement / Skip** choice (generic host `mapping` field, no core change) with Not classical tracks defaulting to Skip; without choices the command skips them.

Validation: 221/221 plugin tests (4 new regressions in `test/editor-v2.test.js`, each confirmed to fail on the previous source), including both corpora; bundle rebuilt. Not run here: core/plugin integration CI, real-library read-only scan. Known limit: recordings orphaned by unassigns before this fix stay until removed by hand.

# Post-Phase-4 recording search and automatic matching start

The recording attachment form now requires the page-level **Search items** query and searches the complete owned-track index while retaining the selected recording; it no longer exposes a misleading arbitrary 200-file prefix. A first conservative automatic matcher builds multi-movement work realizations from confirmed-classical tracks with explicit embedded `WORK`, composer and unique release-order evidence. It runs when a full model scan commits and is also exposed as **Auto-match classical works (read only)** for already indexed albums. The explicit admin action additionally accepts a shared structured title prefix with a numbered/Roman movement suffix when composer, album, classification and unique release order agree, and resolves saved MusicBrainz recording/work identities to a shared parent work through the existing rate-limited cache. Unattended scans retain the stricter tag-only rule. The matcher is idempotent, plugin-database-only and excludes collection-like étude/prelude/song sets. No media writes or writable mount are required.

# Phase 4 scan compatibility correction

The user's schema-2 production-model scan first failed at 4,130/12,802 files with `can't tag .wav files`, then reached 4,360 and retried on `MPEG audio header not found`. The read-only model scanner was incorrectly making optional tag parsing fatal. Files rejected by the tag parser now retain full-file hash evidence and use the host's trusted title/artist/duration metadata without being opened for tagging or modified. An explicit Scan reuses the active retry or requeues the latest failed saved job with its existing cursor and snapshot. A later `running; processed 4420/12802; Error: MPEG audio header not found` report was successful forward progress with stale retry text; successful claims/checkpoints now clear stored errors and status shows errors only for retry/failed states. All 179 plugin tests pass. Core, schema and the unrelated BrainzMash refresher are unchanged.

# Current checkpoint — Phase 4 complete for review

The user explicitly authorized Phase 4 on November 10, 2026 (America/Chicago). Grouping, bounded playback, the basic work page, schema-2 user state and generic host hooks are complete locally. Validation passed 175 plugin tests, 2,757 core unit tests across 406 files, 52 focused Phase 4 tests, required checks/build, real Chromium, restart persistence and exact-file playback for an admin and two users. See `PHASE_4_REPORT.md`. Stop before v0.2 search or later page/Discover scope. The user's container name is `aurral-phase3-test-aurral-test-1`; no agent access to it is authorized. BrainzMash refresher code remains untouched at the user's request.

Companion core implementation: `019e93f5a2f4720f8f0238c40c851dfb1070b740`, published on the user fork `phase4-review` branch and pinned in integration CI.

Final observed implementation CI is green for plugin source `ce351e16d9a82f1cbc0284548ee218491146b29c`: run `43011161488` passed the four Node-version jobs plus isolated no-network model migrations, and integration run `43011160969` passed the pinned core checks/build, synthetic startup, Chromium Phase 4 workflow, restart/media verification and admin/two-user playback smoke. Later documentation-only commits do not change runtime source.

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

# Current checkpoint — Phase 3

Final observed implementation CI is green: plugin source 84ea58d39362532f1f3551906e4fef01a7eda77b / pinned core 7ea6b2211f469d9c1342fee998fe82d2289232ff; runs 42934882603 and 42934882763 passed all six jobs, including four Node versions, isolated model/editor tests, core checks/build, Chromium, permissions, restart/media hashes and existing comparison playback. Later documentation-only commits record this outcome; no runtime change.

November 10, 2026 (America/Chicago). The user explicitly said “Lets begin phase 3” and “Continue with phase 3.” Phase 3 is complete for review. Phase 4 is not authorized.

Companion core implementation: `7ea6b2211f469d9c1342fee998fe82d2289232ff`, published on the user fork phase3-review branch and pinned in editor CI.

The plugin now provides an admin manual editor over schema 1: provider-free composers/works/broadcasts, typed field edits/provenance/pins/unpin, canonical movement reordering, role credits, owned-track attach/detach, read-only media and stale-tab protection. Generic core admin-forms v1 adds only opt-in manifest pages, authenticated bounded transport and a host renderer/Settings entry. No classical core schema or new migration. See the central plugin PHASE_3_REPORT.md, EDITOR_GUIDE.md and UPSTREAM_DELTA.md.

Validation: 2,755 core unit tests (406 files); 23 focused core plugin tests; 168 plugin tests including 9 editor tests; required checks with zero type errors and unchanged 1,236 unsafe-any baseline; frontend/docs/plugin builds; real Chromium desktop/phone workflow, regular-user denial, provider/pin/blank/conflict and stale-tab handling; real Compose restart with unchanged read-only media and existing admin/two-user streaming. The report distinguishes broad-run source from later CSS/docs/test typing refinements and records remote CI separately.

Local paths remain /workspace/work/plugin and /workspace/work/aurral. Implemented on existing local classical branches atop plugin bf47025 and core d93cd812. Separate phase3-review source snapshots are used without moving remote classical/main or merging prior PRs. No new PR, merge, release, upstream activity or production access. Preservation branches are untouched. No subagents.

The editor requires the matching fork's admin-forms bridge; no stock editor fallback is claimed. Work pages, grouping, segment playback, entity merges and richer pages remain Phase 4/later. The fixture HTTP relay is test tooling only and does not proxy WebSockets. Do not claim production-library or real-library operational acceptance.

Historical checkpoints below retain their original observations; their authorization/completion wording is superseded by the current checkpoint.

# Current shared checkpoint — Phase 2

Final observed Phase 2 implementation CI: plugin run 42887705310 passed all five jobs on `eb997d521ccf1aad2d1f611b0fd5b62bcba6e8eb` (159 full-suite tests on each Node22.16/22/24/26 plus isolated model tests and bundle consistency). Source snapshots are in both user repositories on phase2-review; core snapshot bae8d4ba is documentation only. Later handoff/result commits do not change runtime source. No new PR or merge.

November 10, 2026. User request: “Phase one should be done. Verify then continue and build phase 2.” This authorizes Phase 2 and supersedes old pending-approval language below. Phase 3 is not authorized.

Phase 1 review source is in open, unmerged plugin PR6 and core PR36. Fresh clones initially had only Phase 0.5 on remote classical. Local existing `aurral-classical` branches were fast-forwarded to plugin `e1a980ad768af6c8d3e5122e85f05a6e68b3629b` and core `581e8b6ca32908652eecb673620ee6f1389a96b5` as the Phase 2 baseline. No remote refs or PRs were merged. Preserve those prerequisites when applying the Phase 2 patch.

Phase 2 implementation lives entirely in the plugin: native SQLite/WAL schema 1, typed catalogue/relationships, provenance/pins, conservative reconciliation, classification and tag guards, persistent fenced scan jobs, admin scan/status/cancel actions, maintenance CLI and operator documentation. Core runtime is unchanged. See central plugin MODEL_V1.md and PHASE_2_REPORT.md for executable APIs, exact checks and limitations.

The final model suite includes all committed synthetic fixtures, full rescans, provider-free broadcasts, reissues and multi-work ranges. No real-library snapshot or production server was used. The host still lacks an automatic database epoch: admin must update Library database epoch after replacing/restoring its database. Hashes guard reused IDs; ambiguous/retagged moves are held for review. No editor, work page, grouping, user picks or new player behavior is claimed.

Phase 1 verification caveat: core head checks and latest disposable integration passed. Plugin push CI at e1a980ad passed all Node versions, but PR run 42882247578 failed Node22 and cancelled its other jobs. Connected GitHub job logs subsequently identified ENOTEMPTY in background-writer test teardown; Phase 2 waits for completion before cleanup. A loaded Node26 run also exposed a dispatch-throttle race, now fixed with serialized rate-limited dispatch and a regression test. Fresh Phase 1 tests passed 138/138; final Phase 2 tests pass 159/159 on Node22/24/26, with 20 model tests on Node22.16 and in a no-network read-only-source container. Keep the original failed observations in the report.

Current checkout paths: /workspace/work/plugin and /workspace/work/aurral. Work is on local existing classical branches, not main. Phase 2 is saved as a separate phase2-review source snapshot; remote classical/main and existing Phase 1 PRs are not merged. No new PR, release or deployment was requested. The source branch and report are the review handoff. Keep main, upstream, preservation branches and existing review PRs untouched. No subagents were used. Stop for review before Phase 3.

Historical handoff follows; its authorization and completion statements are superseded by this checkpoint.

# Codex / Claude shared handoff — Phase 1

## Published review checkpoint

Final observed implementation CI: core run 42881762781 passed all jobs (required checks/docs, both unit shards, full integration suite and production-container build/smoke); core Perf passed. Plugin CI and disposable integration run 42881393448 passed. Later documentation-only commits may trigger repeat checks, but runtime source is unchanged. Phase 1 is complete for review; stop here and wait for Phase 2 approval.

Remote disposable Compose integration run 42881393448 completed successfully, including real HTTP comparison/playback for admin and two users and a repeat after restart. Plugin Node22/24/26 CI also passed. Core CI rerun 42881762781 follows the fork-workflow fixes; consult its live status. Authoritative fetched review worktrees: /workspace/work/phase1/review-core and /workspace/work/phase1/review-plugin.

Phase 1 implementation and local acceptance are complete. Both fork-only PRs are open and unmerged: core https://github.com/Collinlong1/aurral/pull/36 and plugin https://github.com/Collinlong1/Aurral-Classical-Plugin/pull/6. Both target aurral-classical from phase1-review. Core runtime source commit aecbb96625340cb3a1bd469787211cfe9bedcab5; plugin source commit 2f9beeb2608d41cb767664a3d378180e6b942136. Later commits record CI/workflow fixes and this handoff.

GitHub core unit/integration/Perf checks passed on the first publication. Core CI also exposed two inherited workflow issues: unsupported Dependency Review on this fork and uppercase OCI image tag. The review workflow now checks dependency changes before invoking the dependency API (no dependency changes in this PR) and lowercases the image name. No checks are made continue-on-error. Plugin Node22/24/26 CI passed; disposable integration run 42881393448 was running at this checkpoint. Consult live PR checks before merging; the final chat reports the observed final status. Never treat local green results as a claim that all remote jobs are green.

No further feature implementation is authorized until Phase2 approval. Finish only CI repairs for these PRs if needed. Do not merge, deploy, modify main or upstream. The historical recovery/state paragraphs below describe the development sequence and are superseded by this published checkpoint.

Updated November 10, 2026. User authorized completing Phase 1 and opening PRs **in Collinlong1's repos targeting aurral-classical**. Phase 2 is not authorized. Finish pending Phase 1 verification/publication recorded in PHASE_1_REPORT.md; then stop for review.

Local Phase 1 validation is complete: core post-drift full suite 2752 tests, final acceptance rerun33, plugin138, Subsonic40; required checks/builds pass. Core PR36 is open at aecbb96625340cb3a1bd469787211cfe9bedcab5 into classical. Plugin publication/remote CI status is recorded in the final PR/checkpoint. Do not restart implementation or advance Phase2 while review is pending.

Read PHASE_1_REPORT.md, FORK_FEATURE_INVENTORY.md and (in the plugin repo) INTEGRATION_CONTRACT_v0.1.md and UPSTREAM_DELTA.md. PHASE_0_REPORT.md and PHASE_05_REPORT.md are historical audit records; their pending-approval statements do not describe current authorization.

## Current work

- Existing classical branches were used for implementation. Review snapshots go on phase1-review so the requested PRs can target the existing classical branches. Do not merge PRs automatically.
- Plugin: all owned explicit-work comparison, per-user playlist keys and queue completion, performer-first slskd, preview/clear/restore tags, verified atomic writes/backups, background writes off by default, synthetic fixtures and internal-network Compose.
- Generic core: action-scoped user-operation grants, complete library snapshot, local-only durable playlist operation with execution-time permission/expiry checks, consistent indexed paths on create/update/append, native Soulseek acquisition identity before source priority.
- No plugin data-model migrations or classical fields in core tables. Existing core jobs/settings persist operations; no new SQL schema.
- Fixtures exercise admin plus two regular users (no acquisition permission), exact owned streaming, no downloads, restart/idempotency, >25 recordings, cross-release copies, seven-value native tags, provider omissions and stock missing capability.
- Full structured schema/manual identities without explicit work evidence, editor, grouping, work pages and segment playback remain Phase 2–4.

## Source drift

Entry plugin classical: 393fbdb507324473ba861b577a9517d252332048; plugin main: 506e5259e1442b8cfe072a75b129abb428c6bcf7.
Entry core classical: 1a7f0081ef6b75ce4faa408dfae3a40572d1d359. Core locally merged frozen fork main c0deb211 via 30ba667d, then Phase 1 source a051bf3e.
During this phase, external merges advanced core main to 3739443a000defa9f246681e8a62233c1faef1c3 and core classical to 1b3c1c0074bd39df48bb115eca5254a07dde64b9, bringing upstream 021b1f03. These updates are preserved in a local merge. Do not reset remote refs. None of our writes target main or upstream.
The original fork still has 52 net changed paths (+3130/-181) against matching upstream 021b1f03, with 111 fork-only historical commits on live main. Sixteen preservation branches remain unchanged on 7afcb7cb. See PRESERVATION_BRANCHES.json.

## Validation and recovery

Read the Phase 1 report for final checks. Initial pre-drift full core run passed 2750 tests/406 files; subsequent source refinements and external drift require the recorded post-merge checks. Do not substitute the old audit's 2743-plus-timeout run. New plugin suite reached 138 passing tests; focused core grant/playlist tests and 40 Subsonic integration tests pass. The report records later results and limitations.

Core checkout /workspace/work/phase05/classical; plugin /workspace/work/phase05/plugin-repo. Logs /workspace/work/phase05/phase1-*.log. Node26.12 and pnpm12.15 under /workspace/work/phase05/tools/bin. Use workspace XDG directories; ASTRO_TELEMETRY_DISABLED=1. Independent node_modules per checkout; avoid heavy simultaneous builders.
Compose project aurral-classical-phase1 has only synthetic named volumes and an internal network. The daemon's published port was unavailable from the outer shell in this environment; docker compose exec runs the real HTTP/stream smoke inside the container. It passed for admin and two users, including after restart. No user server was accessed.

## Persistent boundaries

No main writes/merges, upstream edits/branches/PRs/comments, production credentials/server access or automatic deployments. No subagents without explicit user approval. Keep classical logic/storage in plugin and core hooks generic. No automatic PR merge. User approval is required before Phase 2. Update this shared handoff and report at each session boundary.
