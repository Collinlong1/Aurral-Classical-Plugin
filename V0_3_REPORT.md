# v0.3 — summary for review

v0.3 adds the Classical Library, contributors, classical tag writing and MusicBrainz details, in the plan's ten phases. Each phase's issues are closed when their PR merges; their results and verification follow below, newest first.

- **Phase 0 (#10–#20):** matching fixes from the November 11 review (composer aliases and merges, deliberate separate works, removals, safe undo, exact-file moves, tag-sensitive retags, presentation limits, excerpts, variation ranges).
- **Phase 1 (#48, #51–#55, #59):** schema 5; credit provenance; conductor, performer and artist-ID evidence; derived performer credits; contributor identity by aliases and MusicBrainz IDs; reissue links; contributor search fields.
- **Phase 2 (#56–#58, #60–#63):** the editor's performer list, credits, contributor details and membership, bulk credits, mapping tag names, contributor merges and deletions with undo, identity and credit reviews.
- **Phase 3 (#64, core #51–#56):** generic core hooks: resource view 2, the Library entry, item and track links.
- **Phases 4–6 (#65–#77, #79):** the Classical home and lists; composer, contributor and ensemble pages; work and recording pages; links into the player; saved comparisons with ranges; movement boundaries.
- **Phase 7 (#78, #80, #81):** MusicBrainz details that never override an admin's values.
- **Phase 8 (#82–#88):** classical tag writing from a preview, with backups, verification and restore; the album and artist menu actions plan and an admin confirms.
- **Phase 9 (#89–#93):** a 10,000-track benchmark, a real rollback to the schema 4 build, restart persistence of v0.3 data, phone-width screenshots of every new page, and these documents.

Settings added: **Write classical tags to files** (`enableTagWriting`, off by default). Schema: 5 (additive; rollback by restoring `before-v5-*.sqlite` offline, tested against the real schema 4 build). Paired core: `aurral-classical` with the Phase 3 hooks and 6.5's whole-track playlist labels (`9fec213`); the integration workflows pin it.

Not part of v0.3 and still open: review and optional issues #28–#50. Not run in this environment: `pnpm eden test`, and the Compose workflow (no Docker); both integration workflows run in CI.

---

# v0.3 Phases 8.7–9.5 and review fixes L12, L9, L4, E3 / issues #88–#93, #23, #25–#27

## Result

- `src/tag-requests.js` (new): `requestTags`, `applyRequest`, `listRequests`, `readRequest`, `discardRequest`, `untagMessage`. `src/tagger.js`: `processReal`/`untagReal` take `plan` and `values`. `src/index.js`: the four menu actions call `requestTags`; `maintenance-tag-request` and `-discard`. `src/model/editor.js`: maintenance commands get their values and may name a page; Activity lists requests. `src/model/editor-v2.js`: request rows and view.
- `scripts/perf-catalogue.mjs` (new), `test/perf.test.js` (new); `src/search/engine.js`: `classicalTracks({ workId })`, `lazyValues`, `ownedRecordings` scoped to a work.
- `test/migration-rollback.test.js` (new); `.github/workflows/ci.yml`: full history for the test job.
- `dev/editor-fixtures.mjs v03` and its checks; `.github/workflows/phase3-integration.yml` runs it and uploads the v0.3 screenshots.
- `dev/classical-pages-browser.mjs`, `dev/editor-tag-preview-browser.mjs`: every v0.3 page photographed at both widths, no sideways scroll at phone width.
- `src/model/auto-match.js`: `composerEntity` returns no one for a shared name (L12); `insideNumber` and the repair (L9); `sharedWorkTag` with the composer-name guard and explanations (L4). `src/model/catalogue.js`: settled auto-match reviews stay settled (E3). `src/model/editor-v2.js`: auto-match Decide rows, `review-map`, `review-confirm-composer`, `workFromTracks`, `candidateSummary`; `use-contributor` credits a recording too.
- `test/corpus/apple-baseline.json`: 30 improved results saved, none worse.

## Verification

On Node 22.23: full `npm test` 468/468.

- 8.7, `test/tagger.test.js`: choosing an action writes nothing and leaves a request with planned values; no catalogue is created; the editor lists and shows it and passes the confirmation on; a file changed after the request is skipped; confirming twice writes once; restore and clear plan too; discard; nothing to change makes no request. The 20 existing tagger tests now confirm their request (`act`) and pass with their old messages, including the failed-replacement and non-classical cases.
- 9.1, `test/perf.test.js`: 28 page reads, warm, each under 1000 ms; slowest 76 ms (editor album page) on this machine.
- 9.2, `test/migration-rollback.test.js` against `58dd615^`.
- L12, `test/auto-match.test.js`: two Süßmayrs stay two through two albums and rematches; the review is answered with Use this record and isn't asked again. It failed on the previous code (a third person).
- L9, L4, E3, `test/messy-matching.test.js`: Hoboken titles and the repair; Má vlast becomes a work of three movements, a lone free-text WORK tag and a collection don't, with the dry run's reasons; dismissed reviews stay dismissed through rescans, a changed track list asks again, Yes makes the work with that composer, ambiguous candidates are told apart and Use this work opens the grouping step for exactly those tracks.
- Apple corpus: blocks match on 196/204 albums (work-tags style); the regression L4 first caused on 1452886617 is fixed by the composer-name guard.
- Browser, Node 26.12, Chromium at 1280 and 390 px: all ten checks pass; the new screenshots were checked by eye.

Not run here: `dev/editor-fixtures.mjs v03` and the Compose restart (no Docker; CI runs them), `pnpm eden test`, remote CI.

---

# v0.3 Phases 6.6–8.6 — movement boundaries, MusicBrainz details, classical tag writing / issues #78–#87

## Result

- `src/model/editor-v2.js`: `formatTime`, `parseTime`, `sharedOnTrack`, boundary forms and `set-boundaries`; Maintenance "Details from MusicBrainz"; `tag-preview-open`, `tag-write`, `tag-restore`, the preview, file and run views, track tag history; preview buttons on the album (header and ticked rows), a work's Recordings section and the track page.
- `src/model/runtime.js`: `queueEnrichment`, `enrichmentStatus`, `enrichmentCandidates`, `enrichmentFields`, `runEnrichment` (`mb_enrich`).
- `src/model/metadata.js`: `refresh(..., { keepManual })`.
- `src/model/tag-plan.js` (new): `proposedTags`.
- `src/model/tag-write.js` (new): `previewTrack`, `createPreview`, `loadPreview`, `queueWrite`, `queueRestore`, `runTagJobs`, `tagRun`.
- `src/tags.js`: seven new writers, `CLASSICAL_FIELDS`, `FORMAT_FIELDS`, `writableFields`.
- `src/model/jobs.js`: `claim` without a type skips `tag_write`.
- `src/tagger.js`: `allowedPath` exported. `src/model/editor.js`: setting check, start after commit. `src/index.js`: `maintenance-enrich`, `startTagWrites`. `manifest.json`: `enableTagWriting`.

## Verification

On Node 22.23: full `npm test` 461/461. New tests, one or more per issue's own verification line:

- `test/editor-v2.test.js`: a three-movement track divided at 0:12.5 and 41; refusals (order, end of file, not a time, a stale item list) change nothing; album view and work queue play the same three ranges; moving one boundary keeps the rest and leaves three segments; time parsing (6.6). The tag preview on a real scanned Library: four FLAC/MP3 files would change, the MP3 without movement fields, one file's every field, ticked tracks, a work, one Opus track (unsupported), an unreadable file and a non-classical one; the other files stay byte for byte (8.3).
- `test/background-matching.test.js`: enrichment with `fakeFetch` behind the real client: one lookup each, a 503 retried by the next run only, nothing looked up once done; MusicBrainz sort name, aliases and dates stored, an admin's sort name and blank date kept, no period; composer and work pages show them (7.1, 7.3).
- `test/model.test.js`: a manual value and a blank survive `keepManual` refreshes; without it a provider still wins an unpinned field (7.2).
- `test/tag-plan.test.js` (new): full plan for a Dvořák movement, the movement's own MusicBrainz work over the work's, an admin's credit and instrument, nothing for not classical, no work, or two works (8.1).
- `test/tagger.test.js`: each field alone round-trips on FLAC and MP3 with other tags and audio unchanged, several values keep their order, an identical write changes nothing, clearing works (8.2). Writing: refused with the setting off or without confirmation; a normal model-jobs run leaves the job queued; a file edited after the preview is skipped; three written with backups, unchanged audio and other tags; confirming again writes once; restore one file then the run, a file edited after the write left alone; after restore and rescan the first evidence returns; a run whose setting was turned off stops for good (8.4, 8.5). A child process writing in a loop, killed 12 times at random moments, always leaves the old or the new tags and the same audio (8.4).
- `test/sync.test.js`: after a write and a rescan, the same track links and placements, the new tags read, no second work, the admin's title and catalogue still manual, and a new preview "Already up to date (4)" (8.6).

The new tests passed three repeated runs. On Node 26.12 in Chromium at 1280 and 390 px, `dev/editor-tag-preview-browser.mjs` opens the album's preview, one file's fields, writes after core's confirmation, follows the run and restores a file; all nine earlier browser checks still pass. Screenshots checked by eye.

Not run: `pnpm eden test`, the Compose workflow, remote CI. The read-only file case is not exercised here: the container runs as root, which can write any file.

---

# v0.3 Phases 4.4–6.5 — entity pages, links and saved comparisons / issues #68–#77

## Result

- `src/model/pages-entities.js` (new): `composerView`, `contributorView` (people and ensembles), `workView`, `recordingView`, `queueView`, `mutateEntity` (`favourite`, `pick`, `admin-pick`, `favourite-item`, `save-queue`, `delete-queue`), `completeness`.
- `src/model/pages.js`: entity and `queue:` routes; work and recording list rows open the Classical pages; reads and actions take the reader.
- `src/model/presentation.js`: `itemLinks`, `renderTrackLinks`/`trackLinks`, album presentation links when `capabilities.itemLinks`, `workData` (uncut), recordings carry `performanceId`.
- `src/search/engine.js`: stamp v5; work documents carry form, catalogue, date and recording count; recording documents their performance, composers, people and movements held; `sortName` read into sort keys; fixed role order in labels.
- `src/search/provider.js`: `linkFor(item, capabilities)`.
- `src/index.js`, `manifest.json`: `trackLinks`.
- Core `9fec213` (branch `claude/wizardly-mendel-w49um5`): `isPartOfTrack`; whole-track playlist labels.

## Verification

On Node 22.23: full `npm test` 448/448. New `test/entity-pages.test.js` (17 tests), one or more per issue's own verification line: a composer without a MusicBrainz ID grouped by form, sorted four ways, 131 works paged 100 + 31 (4.4); search links on view 2 hosts and filters elsewhere (4.5); a pianist who also conducts has two sections and one identity, and 121 recordings page 100 + 21 grouped by sort name (5.1); collaborators from shared credits (5.2); members from `member_of` both ways (5.3); a work with an excerpt, picks and favourites, a 600-movement work paged with every section inside core's limits, and a collection's siblings (6.1); broadcast, excerpt and two releases (6.2); album group, item and track links, including a track holding two works (6.3); a saved two-part comparison with a range keeps its ranges and order, is its owner's alone, drops missing tracks, deletes, and caps at 50 (6.5). `test/manifest.test.js` drives the built bundle's `pages.mutate` and `trackLinks`. The previously order-tolerant role assertion in `test/search.test.js` is exact again. Album links were flaky on tied credit positions before the fix (3 of 6 runs failed); 6 of 6 pass after. CI then caught one more: with no pick, a work page played its first recording, in random-id order, so the 6.1 test sometimes got Brendel's one-movement excerpt (1 track, not 3). It now plays the fullest recording, by performer then id; the stricter assertion fails 11 of 12 runs on the previous code and passes 12 of 12.

`dev/classical-pages-browser.mjs` passes on Node 26.12 against core `9fec213` in Chromium at 1280 and 390 px: person, ensemble, composer, work, recording and saved-comparison pages through core's `PluginResourceView`; Play all queues "Piano Sonata No. 14 …: I. Adagio sostenuto" and so on through core's `pluginQueueTrack`, each with its resolved links (6.4, 6.3); a track's menu opens Go to Recording and Go to Work (6.3); the Movements tab's filter compares one movement; the saved comparison queues exactly its two parts, one of them 120000–300000 ms (6.5). Screenshots checked by eye. The harness now passes the URL's `tab` as core does (it sent "" before).

Core on Node 26.12: `pnpm check` clean at the 1089 unsafe-any baseline; `pnpm test` 2707/2707 across 393 files.

Not run: the album page and the player bar themselves in a browser (links are checked as the queue carries them, and core's own tests cover their menus), `pnpm eden test`, the Compose workflow, remote CI.

---

# Bug fix — one backup and one upgrade however many processes open the catalogue

## Result

- `src/model/database.js`: `acquireUpgradeLock` (`upgrade.lock`, stale when its PID is gone or after six hours; a release only removes its own lock), `ensureBackupSpace`, and `openDatabase` taking the lock only when a migration is pending, re-reading the version under it, checking space, then making one backup before all steps. `backupDatabase` removes the temporary copy's sidecars. New options `lockTimeoutMs` and `statfs` (tests).

## Verification

On Node 22.23: full `npm test` 431/431. New `test/upgrade-lock.test.js`: four separate processes, released together, open a 40 MB schema 4 catalogue: all reach schema 5 and exactly one `before-v5-*.sqlite` is written (the previous code wrote four backups, twelve files with sidecars); a backup that can't fit is refused before copying, leaves schema 4 and no lock, and the same catalogue upgrades once there is room; a dead process's lock is taken over, a current catalogue opens while a lock is held, and an old one waiting on a live lock times out with a clear message and no copy. Both new behaviour tests fail on the previous code. Five repeated runs pass. `test/model.test.js` now expects one backup for a schema 1 → 5 upgrade.

---

# v0.3 Phase 4.3 — Classical Library home / issue #67

## Result

- `src/model/pages.js`: `listCounts` (one SQL count a list, the same documents `listView` lists), `recentWorks` (realization → item → segment → active track link, newest first, ten), `homeView`.
- `src/search/engine.js`: title sorts compare numbers numerically.
- `dev/classical-pages-browser.mjs`; `.github/workflows/phase3-integration.yml` runs it; both integration workflows pin core 263901077859edad33eabfa2d468fb7a2d0f84b4.

## Verification

On Node 22.23: full `npm test` 428/428. New `test/pages.test.js`: the home's Browse rows link to all six lists and each count equals that list's own total (3 composers, 3 works, 2 conductors, 5 recordings); recently added orders works by their newest track (a second release of the Levit sonata added last puts the sonata first, "Added Nov 10, 2026"), and a work whose tracks are all missing drops off; an empty Library's home says how it fills. `test/search.test.js` adds title order by number. `dev/classical-pages-browser.mjs` passes locally on Node 26.12 against core 2639010 in Chromium at both widths, with screenshots checked by eye.

---

# v0.3 Phase 4.2 — Classical Library lists / issue #66

## Result

- `src/search/engine.js`: `searchCatalogue({ browse, accept, sort })`; `SORT_ORDERS`; performer and composer documents carry `data.entity`; stamp `v4`.
- `src/model/pages.js`: `LISTS`, `PAGE_SIZE` (100), `listView`: header with the count, `sort`, `filters` (up to ten facets), `rows`, `empty` ("No works match.", "No more works." past the end, or none yet), and `pager` when there are more than 100.

## Verification

On Node 22.23: full `npm test` 425/425. New `test/search.test.js` tests: the fixture's three composers in name order; works by title and by catalogue number; conductors are exactly Barenboim and Karajan; no orchestra in the performer list; a composer filter and a query narrow lists, and a query adds "Best match"; an unknown list is refused. A 230-work library lists 100, 100 and 30 rows with pagers at offsets 0 and 200, catalogue order puts Op. 1009 tenth, and a page past the end says "No more works."

---

# v0.3 Phase 4.1 — Classical page routing / issue #65

## Result

- `manifest.json`: page `classical` (non-admin); `library: {pageId: "classical", resourceId: "home", label: "Classical"}`.
- `src/model/pages.js`: `parseResource`, `renderClassical(c, resourceId, query)`, `readClassical`, `mutateClassical` (refuses: no actions yet). A real user is required.
- `src/index.js`: `pages.read`/`mutate` route `classical`, then `work`, then the editor.
- `test/library-fixture.js`: the search test's Library, shared.

## Verification

On Node 22.23: full `npm test` 423/423. `test/manifest.test.js` now checks the `library` entry against the host's rules (a non-admin page, label up to 40) and, through the built bundle, that every resource kind answers a view 2 page, entity pages name Beethoven, Barenboim, the Moonlight sonata and one of its recordings, a work opens the `work` page, unknown resources and missing entities are refused, an API key (user 0) is refused, and the v1 `work` page still answers.

---

# v0.3 Phase 3.6 — fork delta for the core hooks / issue #64

## Result

- `UPSTREAM_DELTA.md`, `FORK_FEATURE_INVENTORY.md` and `HANDOFF.md`: the six plugin-facing core changes of core 3.1–3.5 (resource view 2 with query pass-through, resource mutations, the Library entry, item links, track links), each generic, capability-gated and additive. Core 3.6 (#55) documents them in `plugin-api.md` and `aurral-plugin.d.ts`.

## Verification

Docs only. Core on Node 26.12 (the version `.nvmrc` pins): `pnpm run check` passes with the unsafe-any baseline at 1089; `pnpm test` 389 files, 2671 tests pass, the perf budget included; `pnpm run build` passes. Each hook has a core unit test in `.tests/plugins/plugins.test.ts` (view 2, the Library entry, item links on albums, pages and search, track links) and `.tests/frontend/audio-queue.test.ts` (links on queued tracks). Under Node 22 the container's core run fails 14 network-mocked tests in unrelated files because undici 8's dispatcher doesn't fit Node 22's built-in fetch; it is not a regression.

---

# v0.3 Phase 2.7 — contributor reviews / issue #63

## Result

- `contributors.js`: `raiseReview` (skips a resolved review with the same kind, target and `evidence.key`); `contributorFor` raises its same-name review through it; `deriveCredits` raises `ambiguous-name` on the performance for a name two records hold; `conductorConflicts` (called after `deriveCredits` in `autoMatchTaggedWorks`) raises `credit_conflict` for performances with a manual conductor credit whose tracks all name another conductor.
- `editor-v2.js`: `reviewLabel` cases; `reviewView` Decide rows (same-name pairs reuse the existing merge rows; `ambiguous-name` and `credit_conflict` rows via `contributorSummary`); `keep-distinct` writes a suppression per contributor pair and opens the next review; `use-contributor` (`id`, `contributor`: a candidate, or `tagged` for a conflict) credits the chosen record (manual; for a conflict, the old conductor credits are removed) and resolves the review. Dismiss (`resolve-review`) is remembered through the evidence key.

## Verification

On Node 22.23: full `npm test` 422/422; Apple corpus identical to the baseline. New editor-v2 test: two John Williamses with different IDs offer Merge… and Keep separate, which stores the pair; two ensembles each named "Orchestra A" and "Orchestra B" make the scan ask on both recordings instead of crediting; Use this record credits the chosen one (manual) and resolves it; the dismissed one stays dismissed through rescans; a manual conductor and a different tagged conductor raise a conflict whose Keep is remembered through rescans, a changed tag asks again, and Use replaces the conductor with the tags', after which rescans raise nothing. It fails on the 2.6 code.

---

# v0.3 Phase 2.6 — contributor undo / issue #62

## Result

- `history.js`: `contributorClosure`, `CHANGE_KINDS`, `recordChange(..., { contributors })` (snapshot of both records, plus their credit state after the change), `undoChange` (credit-state check; un-deletes people and ensembles named by restored credits; later merge-person/delete-person changes block as merges and deletions do), `recentChanges` lists all four kinds.
- `editor-v2.js`: `mergePeople` wraps `mergeContributor` for `merge-entity` (people and ensembles) and `map-contributor`; `delete-entity` for a person or ensemble records `delete-person` (it also drops their memberships); Activity labels the new kinds; merge replies say "Undo it from Activity."
- `auto-match.js` `mergeContributor`: memberships move to the kept record; one it already has is dropped.

## Verification

On Node 22.23: full `npm test` 421/421. New editor-v2 tests: a merge of two people (credits on a recording and a work, an alias, a membership, a MusicBrainz identity) is listed in Activity and its undo restores every row of both records exactly; after a second merge, a credit given to the kept person blocks the undo and nothing changes; deleting an unused person is undoable; deleting a work, then its composer, then undoing the work's deletion brings the composer back, credited (E11). A name mapped with This is… stays mapped through a library pass and a rescan, and its undo brings the tag-made record back with its credit. Both fail on the 2.5 code.

---

# v0.3 Phase 2.5 — map a name / issue #60

## Result

`editor-v2.js`: `contributorView` puts a `map` form first for an unreviewed contributor (data `unreviewed`, no manual assertion); `map-contributor` (`target`, `into`) requires two different records of the same kind, merges, resolves the dropped record's reviews and opens the chosen record.

## Verification

On Node 22.23: full `npm test` 419/419. New editor-v2 test: after matching, the tag-made "Orchestra A" offers This is… with an ensembles lookup; a hand-made record does not; mapping to a person is refused; mapping to "Fixture Philharmonic" opens it, deletes "Orchestra A", moves its credit and keeps "Orchestra A" as an alias. It fails on the 2.4 code. New `test/contributors.test.js` case: after "S. Richter" is merged into "Sviatoslav Richter", a second album tagged "S. Richter" is credited to Sviatoslav Richter and no new record is made. It guards the rule this relies on (aliases, 1.5) and also passes on the 2.4 code.

---

# v0.3 Phase 2.4 — bulk credits / issue #61

## Result

- `editor-v2.js`: commands `performers-open` (album, ticked tracks → `performers:<token>`), `set-performers` (`token`, `contributor`, `role`, `instrument`, `mode` add/replace), `change-roles` (`target`, `from`, `to`); views `performersView` and `rolesView`; helpers `performancesOfTracks`, `performanceLabel`, `creditTargetPage`, `checkRole` (performing roles only, person/ensemble rules checked before anything changes). Album select bar gains "Set performers…"; contributor pages with performing credits gain "Change role on all credits…".
- `editor.js` `scopeIds`: `performers:<token>` covers the selection and its performances; `roles:<id>` covers the contributor and every target they are credited on.
- A role change into a credit that already exists is reported for that credit; a removed credit under the new role gives way.

## Verification

On Node 22.23: full `npm test` 417/417. New editor-v2 test: ticked album tracks open a one-recording page listing its tag-made orchestra; adding a conductor keeps it; replacing with an orchestra removes it (kept `removed`); an ensemble as conductor is refused; with a database trigger blocking the recording, the result reports "Updated 0 of 1 … blocked" and the old performers stay; Change role previews two credits, and with one blocked changes the other and reports it, then changes the second on retry; an ensemble to soloist is refused; contributor rows read "Symphony No. 5 · Album …" and open the recording. It fails on the 2.3 code. `dev/editor-credits-browser.mjs` passes at 1280 and 390 px locally against core `bd41154`: ticking eight box-set tracks, Set performers… on two recordings, then Change role on all credits… from the conductor's page.

---

# v0.3 Phase 2.3 — contributor details / issue #58

## Result

`editor-v2.js`: `FIELDS.person` and `FIELDS.ensemble` (the `sortName`, `instruments` and `date` fields from schema 5); `save-entity` calls `addAlias` (one alias per folded spelling) for a renamed person or ensemble and for each saved spelling; `contributorView` adds the members section and form; `add-member`/`remove-member` in `V2_COMMANDS` and `applyV2` (the page's entity is `target`, so the revision scope covers it; the other side must be the other kind); `lookupV2` gains `people` and `ensembles`. Members list alphabetically.

## Verification

On Node 22.23: full `npm test` 416/416. New editor-v2 test: a person's sort name, spellings, instruments and dates save and read back; renaming keeps the old name; every alias resolves through `contributorFor`; saving spellings again adds none; an ensemble's rename keeps its old name; members added from the ensemble's page and from a person's page show on both; a repeat or same-kind add is refused; removal updates both; the `people` lookup offers people only. It fails on the 2.2 code.

---

# v0.3 Phase 2.2 — recording credits / issue #57

## Result

- `editor.js`: `update-credit` (fields `target`, `credit`, `role`, `instrument`, `back`), `back` on `add-credit` and `remove-credit`; `scopeIds` adds a recording's `recording_performance` targets.
- `editor-v2.js`: `creditSections(c, target, { id, title, noun, edit, back })` serves the work page as before (unchanged ids) and the recording page's Performers section (`performers`, `edit-performer`, `add-performer`).

## Verification

On Node 22.23: full `npm test` 415/415. New editor-v2 test: after matching, a recording's page lists the orchestra read from tags; changing its role makes it manual and returns to the recording; a soloist is added with an instrument, which an empty instrument on a later change keeps; an ensemble role on a person and a change into an existing credit are refused; another recording's performance cannot be written from this page; a library pass and a rescan keep everything as set; removing a credit updates the page. It fails on the 2.1 code.

---

# v0.3 Phase 2.1 — performer list filters / issue #56

## Result

`editor-v2.js`: `listFor` reads every contributor's active non-composer roles and every manually edited entity in one query each, and returns `facts` per row (kind, roles, unreviewed), stripped before the list is sent; `listFilters` turns `role:…` and `unreviewed` words into tests and leaves the other words to the existing search. An unknown role is an ordinary search word.

## Verification

On Node 22.23: full `npm test` 414/414. New editor-v2 test: four contributors (three unreviewed, one edited by hand) show their roles and badges; `role:conductor`, `role:performer`, `role:ensemble`, `unreviewed` and combinations with words and each other return the expected rows; the placeholder names the filters. It fails on the 1.7 code. `dev/editor-list-places-browser.mjs` (core's renderer, synthetic data) passes at 1280 and 390 px against core `bd41154` locally.

---

# v0.3 Phase 1.7 — search index / issue #59

## Result

`engine.js`: `FACETS` gains `role`; `creditFacets` adds `role` and credit `instrument` facets to recording and performer documents; `recordingGroupFacets` keeps tag-name performer values only while no release in the group has credits; documents carry `sort` (`sort_title`, `sort_key`, `sort_date`), written to the schema-5 columns; `ownedRecordings` returns each credit's instrument; `catalogueStamp` is `v3`. A credit's role or instrument changed through the editor rebuilds the index through the editor's audit row (part of the stamp); a raw database update would not, so the test changes the instrument through the catalogue API.

## Verification

On Node 22.23: full `npm test` 413/413; Apple corpus identical to the baseline. Extended `combined searches, role-aware filters…` (`test/search.test.js`): the role facet offers conductor, orchestra and soloist for "barenboim"; the role filter finds the two conducted recordings; a soloist credit with an instrument makes the instrument filter find exactly that recording; no `name:` performer values remain; the Moonlight sonata's stored sort title and key (`op:000027:000002`); the stamp starts `v3|`. It fails on the 1.6 code. Existing search assertions pass unchanged.

---

# v0.3 Phase 1.6 — reissue links / issue #54

## Result

- `reissues.js`: `linkReissues(c, { albumId })` for the works on the album (or every work in the library pass), `unlinkReissue`, `relinkReissue`. Links are stored source < target with distinct positions (the relation table's unique keys).
- `engine.js`: `reissueState(c)` returns stored links and the latest admin decisions (from `audit_event`, as `unassignedByAdmin` reads album decisions); `groupRecordings(recordings, state)` applies them before the rule; `ownedRecordings` returns each recording's `performanceId`; `classicalTracks` and `resolvedValues` are exported for `linkReissues`. The search index stamp already counts relations, so a link or unlink rebuilds it.
- `presentation.js` `recordingsOf` passes the state.

## Verification

On Node 22.23: full `npm test` 413/413; Apple corpus identical to the baseline. Extended `the work page lists one entry per recording` (`test/search.test.js`): Levit's two releases are stored as one link; with the box set retagged to a different recording ID they stay one entry; after an admin's unlink they are two, a full library pass with the original tags adds no link back and search lists them as two recordings; relinking makes them one again. It fails on the 1.5 code (the module does not exist there).

---

# v0.3 Phase 1.5 — contributor identity / issue #55

## Result

- `auto-match.js` `composerPeople` indexes every person (name, `aliases` field, `alias` table); `canonicalComposers`, `composerEntity` and the ambiguous-composer check therefore see performers too. `mergeDuplicateComposers` filters to composers (`isComposer`), so performers of one name are never merged automatically.
- `contributors.js`: `artistIds` aligns `artistMbids` with the artist tag's names only on equal counts; `deriveCredits` keeps an ID only when every track gives the same one; `contributorFor` follows the identity rule above and opens `contributor_identity` for a new record whose name another record holds. A name two records share without an ID still gets no credit (2.7 adds its review).

## Verification

On Node 22.23: full `npm test` 413/413; Apple corpus identical to the baseline (612/612). New `identity: …` test in `test/contributors.test.js`: Rachmaninoff matched first as the pianist on a Chopin album, then as the composer, is one person with both roles; two "John Williams" albums with different IDs make two records, the second with one open review; "Johnny Williams" with the second ID is credited to that record; one ID for two names is not used. It fails on base `ea1eb8d`.

---

# v0.3 Phase 1.4 — derived performer credits / issue #52

## Result

- **`performerNames(hints, composers, key)`:** the split on " — ", " – " and ";" with composers left out, moved from `engine.js` `ownedRecordings` and `presentation.js` `performerOf`. Each passes its own folding (`fold` and `words`), so their output is unchanged.
- **`trackCredits(hints)`:** conductor tag → `conductor` (person); `PERFORMER` values, with a trailing "(instrument)" read as the instrument, else the artist split; a part is split as a list (", ", "&", "and"…) only when every piece is an ensemble or a capitalised name of two or more words, so "Choir of King's College, Cambridge" stays whole. Ensembles take `orchestra`, `choir` or `ensemble` from their name; people are `performer`. Roles are never guessed from a person's name.
- **`contributorFor(c, index, name, { mbid, kind })`:** an active MusicBrainz artist ID's holder wins; else the single contributor of that kind with that folded name or alias (composers included, so the composer at the piano is one person); a same-named record holding a different ID is someone else; two same-named records → null (no credit, nothing created); otherwise a new record with `data.unreviewed = true` and a derived name. `deriveCredits` does not pass IDs yet: which tag ID belongs to which name is 1.5's rule.
- **`deriveCredits(c, { albumId })`:** performances on the album (or all, in the library pass) with no credit in a performing role, active or removed. Credits all the performance's tracks share are added after any existing positions, `source='derived'`. Called at the end of `autoMatchTaggedWorks`, so the first library pass after this release backfills existing performances (plan §3 step 1).
- **Roles:** `accompanist` added to `CREDIT_ROLES` and `PERSON_ROLES`; the search engine's performer roles are `PERFORMING_ROLES`. `credits.js` exports `ENSEMBLE` and `LIST`; `auto-match.js` exports `resolvedName`.

## Verification

On Node 22.23:

- Full `npm test`: 412/412.
- Apple corpus: every one of the 612 results equals the saved baseline exactly (#52: unaffected).
- New `test/contributors.test.js` (5 tests): tag reading (conductor, PERFORMER with instruments, orchestra/choir/ensemble, list splitting and a comma inside one ensemble's name, composer left out); derivation once per performance, as unreviewed records, one record per name across albums, nothing added on rescans or the library pass, the work page showing them; a removed derived credit never comes back and an admin's credit is untouched; disagreeing tracks keep only shared credits; the composer at the piano is one person; two same-named people get nothing; an artist ID finds its holder; `accompanist` is a person-only role. With the derivation call disabled, the three matching tests fail.
- `test/search.test.js` fixture: its people now exist before the scan, so derived credits are theirs, and its hand-made credits replace the derived "performer" credit for that person, as an admin's correction would. Before this change, two "Daniel Barenboim" records (derived and hand-made) tied in the performer section and the role test passed or failed by ID order; three repeated runs now pass.

Not run: browser, Compose or restart checks locally (no Docker); the paired workflows run on the PR.

---

# v0.3 Phase 1.3 — tag evidence / issue #53

## Result

`readTags` returns `conductor` (`tag.conductor`: Vorbis `CONDUCTOR`, ID3 `TPE3`) and `performers` (Vorbis `PERFORMER` values, unparsed; the instrument stays in the text for 1.4). The model's fallback for unreadable files has both, empty. `scanFile` adds `conductor`, `performers` and `artistMbids` to hints only when non-empty. ID3 musician credits (`TMCL`) and MP4 have no `PERFORMER` equivalent read here, as #53 scopes it.

## Verification

On Node 22.23:

- Full `npm test`: 407/407.
- New tagger test: FLAC and MP3 each read their conductor; FLAC reads two `PERFORMER` values and two artist IDs from one `;`-joined value; MP3 has none of those; an untagged FLAC reads empty values.
- Extended `rescans reuse unchanged fingerprints and add no evidence rows` (`test/sync.test.js`): one file tagged with a conductor, two performers and an artist ID, one untagged. The tagged file's hints carry all three; the untagged file's hints have none of the new keys; a rescan adds no evidence rows and leaves both files' hints identical.
- Both fail on the 1.2 code.

---

# v0.3 Phase 1.2 — credit provenance / issue #51

## Result

- **API (`catalogue.js`):** `credit(target, contributor, role, { instrument, position, assertionId, source })` checks `source` against `CREDIT_SOURCES` and reactivates a removed row for the same key instead of inserting. `removeCredit(id)` refuses an unknown or already-removed credit, marks a derived one `removed` and deletes a manual or provider one.
- **Readers filter `state='active'`:** `presentation.js` `credits`; `editor.js` composer test, credit list, duplicate check and Remove (now `removeCredit`); `editor-v2.js` `isComposer`, `credits`, `worksOf`, merge counts, contributor credit rows, composer names, delete-in-use check and the work-merge composer check; `auto-match.js` composer lists, `composerEntity` people, recording composer credits, provider composer checks, work-merge composer test, composer identities and the completion-split repair; `engine.js` `ownedRecordings` credits and `buildDocuments`; `history.js` undo summary.
- **Kept unfiltered on purpose:** merges (`mergeContributor`, `mergeWork`) move every row, so a removed derived credit stays removed on the merged entity; deletes of a whole entity remove every row; position counters.
- **Merge collisions:** `keepActiveCredit` makes the kept row active with the moving row's source when the kept one was removed and the moving one is active.
- **Index stamp:** `catalogueStamp` adds the active-credit count, since a removal changes no row count or rowid.
- **History:** snapshots are `SELECT *` and restore by column name, so they keep `source` and `state` (1.1).

## Verification

On Node 22.23:

- Full `npm test`: 406/406.
- New model test `credit provenance: …`: defaults and an invalid source; removing a derived credit keeps it removed and off the work page; a repeat removal is refused; adding it again returns the same row as manual; removing a manual credit deletes it; a person merge where the kept person's credit was removed and the merged one's is live keeps one live credit.
- Extended `editor-v2` credits test: the editor shows a derived credit, Remove hides it from the work and the contributor and leaves it `removed`, a second Remove is refused, Add brings back the same row as manual, removing a manual credit deletes it, and the person can then be deleted.
- Extended `search` role-filter test: a derived conductor credit adds a recording to the conductor filter; removing it takes it out again (the stamp notices).
- All three fail on the 1.1 code; the search one also fails with only `engine.js` reverted.

---

# v0.3 Phase 1.1 — schema 5 / issue #48

## Result

Migration 5 as in the plan's §3 table, with two additions in the same spirit: `CHECK` constraints on `credit.source` and `credit.state` (the plan checks them in `Catalogue.credit`; the database now refuses other values too), and an index on `saved_queue(user_id)` for the per-person list. `favourite` on `user_recording_state` has the same `CHECK(favourite IN (0,1))` as `user_work_state`. The only code change outside the schema is `Catalogue.credit` naming its insert columns, which a positional `VALUES` with the two new columns would break. The undo history (`history.js`) already snapshots `SELECT *` and restores by column name, so new snapshots keep `source` and `state` and older snapshots restore with the defaults.

## Verification

On Node 22.23:

- Full `npm test`: 405/405.
- New `schema 4 migrates to 5 additively, and its backup restores for the schema 4 build`: a schema-4 file holding a work, a person, an ensemble, two credits and a search document migrates to 5. Row counts are unchanged (four new field definitions aside), existing credits are `manual`/`active`, sort keys are empty, new tables are empty, the indexes exist, and the database rejects other `source`/`state` values. The `before-v5-*` backup restores offline: it is refused for a schema-3 build and opens with the schema-4 build, with the same counts and the original seven credit columns. It fails on the schema-4 code.
- The migration-failure, interrupted-DDL and schema-1 upgrade tests now take the current and next version from `SCHEMA_VERSION` instead of hard-coding 4 and 5, so they keep testing "newer than shipped".

---

# v0.3 Phase 0.11 — L6/L7/L8/L13 / issue #20

Base: `aurral-classical` `c61dcea`, including merged L1 PR #103. This follows the handoff sequence (Batch B after L1).

## Result

- **Prototype applied:** `variations-prototype.patch` applies cleanly on top of L1 (offsets only). Its parts, each now with a plain comment: `rawSections` and `expandSection` (ranges, lists, dash before a section; L6, L8), `variatio` in the three variation patterns and `asVariation` returning the number, used as the index in `mapEach` (L7), variation numbers compared first in `namedMovement` (L7, L6), a named section taking the earliest free movement of that name (L6, L13), and `returnsAtEnd` in `candidates` (L13). As #20 warns, fuga and finale are not added to the dash split, so "III. Adagio ma non troppo - Fuga" stays one movement.
- **Data repair (not in the prototype):** the library pass found works to split only by movement titles containing " / ". It now reads each movement title through `sectionTitles`, so works an older version made with a "Variations 1-3" or "Theme and Var. 1" movement are split too. `splitCombinedMovements` is unchanged and still splits only unedited works that matching made.
- **Corpus scorer:** `score()` in `test/corpus/apple.js` also returns `matched`, the share of an album's tracks in a group with a work. `test/corpus-apple.test.js` fails when `matched` falls and compares row wording only while `matched` is unchanged. The baseline is re-saved with `node scripts/corpus.mjs --apple --update-baseline`.

## Corpus baseline

Comparing the scorer's results for the code before and after this change (same scorer), 10 of 612 results move, all the same way: `matched` rises (0–0.32 to 0.97–1), `parts` falls, and grouping and false joins are unchanged everywhere. They are the five results #20 traced (store 1640004922, work-tags 1608042390 and 1640004922, messy 1467953807 and 1691120087) plus store and work-tags 1691120087 and the three styles of 476935391 (Gould's 1981 Goldberg, previously unmatched because of its closing "Aria da capo"; L13). Every row in these ten results whose Apple part names a variation was checked against the row's own variation number, in the full shared catalogue: 267 rows, 0 on the wrong variation. `parts` falls only because rows now show the work's movement names, the issue's documented side effect; changing row wording is out of scope. The re-saved file also records eight results (862972382, 1452145443, 1648305509, 269682146, 734587111, 752033492, 884005057 across styles) whose values were already those on the code before this change; earlier phases improved them without re-saving.

## Verification

On Node 22.23:

- Full `npm test`: 404/404.
- New `variation ranges, Variatio and a returning Aria join one work in either order`: Paganini per-variation album vs "Variations 2-3", Goldberg "Variations 1-3" vs "Variatio 1–3", Goldberg "Aria … Aria" vs "Aria … Aria da capo", each in both scan orders. Each run makes one work, puts a range track on every variation it holds, never names a movement for the range, keeps the closing Aria as its own movement and opens no review.
- New `sections split on a range, a list or a dash before a section`: ranges (arabic and roman), "and" and comma lists, "Introduction - Variation 1 - Tema"; "Theme - Andante", "III. Adagio ma non troppo - Fuga", "Allegro, ma non troppo", "Return Home / Heimkehr" and "Variations 3-3" stay whole; "Variation 3" maps to "Variatio 3 a 1 Clav.".
- New `the library pass splits a movement an older version named for a range`: a work stored as "Aria", "Variations 1-3" is split by the library pass alone (the other album held out of it), then the other album joins with no missing movements or review. With the old " / "-only query it fails.
- The three new tests fail on base `c61dcea`. The existing `several variations a movement` test now uses a `combineMovements` helper extracted from its own setup and passes on both.

Not rerun: the `p6`/`p7`/`f3`/`f5` review probes (the new tests cover their cases). No browser, Compose or restart run locally (no Docker).

---

# v0.3 Phase 0.10 — L1 / issue #19

Base: `aurral-classical` `f055abe`, including merged C1 PR #102. This follows the handoff sequence (L1 after C1). No other issue is implemented here.

## Result

- **Count fallback (`auto-match.js`, `mapEach`):** as many tracks as movements lines them up by order only when every track agrees with its movement. Its number, if any, must equal the movement's index, or its position when the movement has no number; for variations and pieces numbered within a set, the index alone, as the name-and-number mapping already does. Its name must not be another of the work's movements. Otherwise `mapEach` falls through to `mapBySections`, and the album caller tries its existing fold and expansion steps before opening a `movement-mismatch` review. `mergeMapping` reuses the same function, so a work merge no longer joins contradicting movements by order either.
- **Kept:** untitled or unnumbered tracks ("Movement 1") and tracks whose numbers agree with the movements' own ("1. Allegro con brio", "2. Adagio cantabile", "3. Rondo" on a three-movement sonata) still line up by order.
- **Repair listing (`src/model/movement-report.js`, `scripts/model-admin.mjs movement-numbers`):** read only, run by an admin. It lists active tracks whose title's movement number differs from their movement's number, grouped by work, with album and track ids. Set-piece numbers ("No. 3") are skipped. Editions numbered differently, or a track holding several movements, can be listed correctly; the output says so. README documents it beside the classification report.

Risk, as scoped in #19: an album that previously joined by order with differently worded or numbered movements now goes to review instead.

## Verification

On Node 22.23:

- Full `npm test`: 401/401, including the corpus suites (`corpus`, `corpus-apple`, `corpus-nonclassical`) that CI runs separately. No corpus album relied on the contradicting fallback.
- `test/messy-matching.test.js`: 38/38 on Node 22 and 26.12.
- Extended `a movement number never maps a track onto a differently named movement` with the excerpt cases: contradicting numbers and contradicting names return null; untitled tracks and agreeing numbers still map by order. New `excerpts on two albums never land on each other's movements by position`: the two-album BWV 1007 case leaves the work at its three movements and opens one `movement-mismatch` review for the second album. It then stores the old positional placement and checks that the report lists exactly the three misplaced tracks. Both tests fail on base `f055abe` (the second album's Allemande, Courante and Menuet played as Prélude, Sarabande and Gigue) and pass with the fix.
- `movement-numbers` smoke-tested on an empty catalogue (text and `--json`).
- `npm run build` and `git diff --check` pass.

The `p1.mjs` review probe was not rerun; the two-album test reproduces its L1 case. No browser, Compose or restart run locally (no Docker); the paired workflows run on the PR.

---

# v0.3 Phase 0.09 — C1 / issues #18 and core #49

Base: plugin `aurral-classical` `2bcc91d` (merged L10 PR #101); core `aurral-classical` `a4fe84d`. This follows the handoff sequence (C1 after L10). No other issue is implemented here.

## Result

- **Plugin #18:** `renderWork` and `renderAlbumPresentation` end with a fit step mirroring core's schema. Titles, names, labels and item text are cut to 500 characters, description to 10,000, instrument and record label to 200; a cut ends in "…" and never on half a surrogate pair. Work movements, missing movements and parts are cut to 200. `complete` is computed before the cut and `movementCount` stays the real count, so a 250-movement work still reads as incomplete with 250 movements.
- **Core #49 (`bd41154`):** `playableItems` drops an item whose track is not playable in its album, or whose album is gone (`PluginTargetMissing`), instead of throwing. Work recordings and album groups left empty are dropped; a recording the plugin sent with no items still shows. The throws for a track id that is not a positive integer, a bad range, an item from another album, and any other album lookup failure are unchanged. The dropped count is logged at info under `plugin:<id>`.

## Verification

- Plugin, Node 22.23: `npm test` 400/400; `node --test test/model.test.js` 35/35 on Node 22 and 26.12. The new 250-movement case (2,000-character titles, an emoji at the cut, long tag artist and album) fails on base `2bcc91d` and passes with the fix. `npm run build` and `git diff --check` pass.
- Core, Node 26.12: `pnpm run check` clean (unsafe-any 1089, unchanged); `pnpm test` 2668/2668 across 388 files. The extended presentation case in `.tests/plugins/plugins.test.ts` (stale tracks in a work recording, a mixed recording, a recording on a retagged-away album, an empty album group and a mixed group) fails on base and passes with the fix; the existing other-album 502 case still passes.
- Workflows: both integration workflows now pin core `bd41154` (this fix, on the November 16 sync). The Phase 1 workflow's long-standing failure is fixed: it ran `dev/smoke.mjs` without `dev/editor-fixtures.mjs prepare`, so `/config/phase4-fixture.json` did not exist, and its core pin `aecbb96` predated the work-page routes the smoke test uses.
- Not run locally: browser checks, Compose/restart (no Docker here), `pnpm eden test`. The paired workflows run on the PR.

---

# v0.3 Phase 0.08 — L10 / issue #14

Base: `aurral-classical` `3e74192`, including merged L11 PR #100. This follows the handoff sequence. Current #14 has no additional dependencies or later comments changing scope. No other issue is implemented here.

## Result

Tag-sensitive fingerprints now allow the same file ID, path and duration to retain the plugin track link after the core track ID changes. The candidate index includes file ID/path. Ownership is resolved in priority order: unique full core/file/path matches, unique stable file/path matches passing the existing audio checks, then remaining move candidates. This retains L11's exact-copy protection and prevents an old review from stealing an already active newer link with protected metadata.

Before reconciliation builds ownership, the repair checks open track-link reviews with exactly one reused file matching the original file ID/path/duration and tag-sensitive evidence. It requires a unique current file and unique historical claim. An unedited newer active link can be removed through normal detach cleanup, along with only its now-unused auto-added movements, and original movement positions are normalized. Its derived track metadata is removed in foreign-key order. Normal reconciliation then updates the original link, appends its scan evidence and resolves the old review. Track/work repair audits record the cleanup.

The original link's pinned metadata, work fields and attachments, and user/admin picks remain intact. Newer manual fields, pinned classification, manual placements/structural edits, conflicting work assignments, ambiguous historical claims, picked separate interpretations or unknown segment structures prevent automatic deletion. Those cases retain their data and review. The repair is transactional within reconciliation and idempotent.

Different file IDs, paths, durations, decisive audio-hash changes and epoch changes do not gain this fallback. No schema, core, media-tag, provider-request or fingerprint-format change. As scoped in #14, a different file replacing the same stable file ID/path with the same duration to the millisecond could inherit the link when only container hashes are available. Bundle rebuilt.

## Verification

On Node 24.22.1:

- `node --test test/fingerprint.test.js test/sync.test.js test/model.test.js test/editor-v2.test.js`: 121/121 passed.
- Fifteen new fingerprint/reconciliation tests pass; nine fail on merged base `3e74192`. Cases cover changed core/container IDs, pinned metadata, file/path/duration/audio/epoch boundaries, stable-file ownership with identical audio, an actual M4A title rewrite with measured duration unchanged, old split repair including duplicate movement removal and exact original positions, derived metadata cleanup, original work notes and picks, manual newer track/movement/classification protection, ambiguous reviews, competing historical and current claims, foreign-key integrity and idempotency.
- `p5.mjs` section E run against base and fix from a scratch copy, retaining its fixture and adding only a guard for the now-absent review. Base: three links, an open dead-end review and three movements. Fix: two active original links, no review and two movements.
- `p4.mjs` was also run. Its last M4A case changes both core ID and file ID, so it intentionally remains outside the stable-file fallback; this is not the stable-file-ID core behavior documented in the current issue. No core scanner probes (`f1`/`f2`) were rerun locally.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 399/399 passed (the earlier run also passed 398/398 before the final ambiguity regression was added).

No local browser, Node 26 core scanner or Compose/restart run for #14. The known pre-existing Phase 1 workflow fixture mismatch remains unchanged and outside scope.

---

# v0.3 Phase 0.07 — L11 / issue #16

Base: `aurral-classical` `c2bdc59`, including merged E7 PR #99. This follows the handoff sequence. Current #16 has no additional dependencies or later comments changing scope. No other issue is implemented here.

## Result

Reconciliation first reserves unique exact matches (same core track, file and path, passing the existing audio-identity check). It then removes those items from other candidate pools before calculating demand. Claimed exact items also do not count as reused identities for a missing copy; this matters when multiple files share one core track ID.

The existing update path preserves link IDs, pinned metadata, classification and attachment references. Unchanged exact copies still use the no-new-evidence path. Deleting one identical copy leaves its link missing and remaining exact copies active. Moving a single copy can use the one remaining unclaimed candidate. Two indistinguishable moves remain in review, and their candidate lists exclude the already claimed exact copy.

Conflicting historical exact claims remain ambiguous rather than arbitrarily choosing one, and a changed core epoch still requires review. No schema, core, media-tag, provider-request or fingerprint-format changes. L10's tag-sensitive retag issue is not implemented here. Bundle rebuilt.

## Verification

On Node 24.22.1:

- `node --test test/sync.test.js test/model.test.js test/scan-checkpoints.test.js`: 54/54 passed.
- Eight new sync tests cover duplicate-audio moves in both prior-row orders, changed core/file IDs with stable plugin links and pinned fields, evidence reuse, deleting one of 28 copies, genuinely ambiguous moves, epoch changes, conflicting historical exact claims, shared core track IDs, and a real 28-file identical-audio scan/move/delete sequence. Six fail on merged base `c2bdc59`; epoch-change and historical-claim safety already passed there.
- `p4.mjs` run on the base and fix via `PLUGIN_SRC`: the duplicate-audio rename changes from both links in review to both active. The TWV and tag-sensitive retag cases are unrelated findings and remain outside #16.
- `g1.same-audio.mjs B` run after updating its scratch fixture path: a real rescan process is killed after 12 files and resumed. Final state equals uninterrupted control. The post-kill catalogue remains at 28 active links with integrity OK and no foreign-key errors. Final state has 27 active links and one review; this scenario also deletes a file and adds four indistinguishable files, so that remaining ambiguity is intentional. Unlike the defect, the exact copies stay active. Only scenario B was run.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 384/384 passed.

No local browser or Compose/restart run for #16. The known pre-existing Phase 1 workflow fixture mismatch remains unchanged and outside scope.

---

# v0.3 Phase 0.06 — E7 / issue #17

Base: `aurral-classical` `1108102`, including merged E10 PR #98. This follows the handoff sequence. Current #17 has no additional dependencies or later comments changing scope. No other issue is implemented here.

## Result

The later-change guard now considers only active merge/delete rows whose serialized entity set overlaps the snapshot being undone. Selection rows and unrelated destructive history no longer block undo. Insertion order, rather than millisecond timestamps, determines which snapshot is later, so equal timestamps cannot bypass the overlap guard.

A related path in the same selection workflow logs the preselected work as the target of a navigation event. Navigation-only audit actions (`open`, `move-tracks-open`, `bulk-edit-open`, `choose-album-work`, `new-album-work`) no longer count as later edits. Actual edits and assignments still use the existing audit guard. Later overlapping merges and deletions remain refused, without changing attachments or undo markers; their newest change can still be undone.

No expiry or deletion of selection rows is needed. E10's reused-track deletion guard remains intact. This change does not alter restoration semantics or add undo for renames/reorders, and leaves E8/E9 separate. No schema, core, media-tag or provider-request changes. Bundle rebuilt.

## Verification

On Node 24.22.1:

- `node --test test/editor-v2.test.js test/editor-v0.2-workflow.test.js test/auto-match.test.js`: 69/69 passed.
- Nine new editor tests cover Group/Cancel, a preselected work, choosing a work and cancelling, Edit together/Cancel, unrelated later merges/deletions, overlapping merges/deletions with equal timestamps, and deletion undo after Group while tracks remain free. They verify exact attachment restoration, selection rows remaining present, unrelated changes remaining active, refusal atomicity, newest overlapping undo and foreign-key integrity.
- Eight new regressions fail on merged base `1108102`; the overlapping-deletion refusal already passed there through its audit guard.
- `f7.mjs` compared against base `1108102`: the Group-only undo refusal becomes successful undo. Renaming/reordering the work or adding a new album still refuses undo. `f8.mjs` was also run: its album C names both composer spellings, so after E2 it creates a different work rather than joining the kept one; undo is allowed there. That case no longer validates the attached-album guard; `f7` c2 does. The probes' unrelated review, favourite-state and rename/reorder-undo findings are outside #17.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 376/376 passed.

No local browser or Compose/restart run for #17. The known pre-existing Phase 1 workflow fixture mismatch remains unchanged and outside scope.

---

# v0.3 Phase 0.05 — E10 / issue #15

Base: `aurral-classical` `89d3351`, including merged L3 PR #97. This follows the handoff sequence. Current #15 has no additional dependencies or later comments changing scope. No other issue is implemented here.

## Result

Deletion undo collects the saved segments' track-link IDs before restoring anything. If any track currently has a realization item, it refuses with “These tracks are in a work again; take them out first, then undo”. The check is specific to deletion undo, so ordinary merge undo continues to restore its existing live items. Refusal changes neither attachments nor the undone marker.

The library-wide matching pass also repairs existing duplicate realizations within one live work. It compares complete ordered mappings of track link, movement, occurrence, segment kind, start and end. Only exact duplicates are removed, keeping the oldest performance (then realization insertion order as a tie-break), and detaching the later realization with `detachItem`. Equivalent user/admin picks move to the surviving realization first. A repair audit records the survivor and removed ID. The repair is transactional and idempotent.

This is deliberately more conservative than comparing unordered file sets: different ranges, orderings, partial recordings and other files stay separate. No schema, core, media-tag or provider-request change. Bundle rebuilt. E7's global history guard and E11's missing-contributor behavior remain separate issues.

## Verification

On Node 24.22.1:

- `node --test test/editor-v2.test.js test/editor-v0.2-workflow.test.js test/auto-match.test.js`: 60/60 passed.
- Four new editor tests cover deletion/allow/match/undo refusal, partial manual reassignment refusal, unchanged attachment rows and undo markers on refusal, foreign-key integrity, successful undo after scans with free tracks, exact-duplicate repair, pick preservation, idempotency, library-pass invocation, and preservation of differing ranges, orderings, partial recordings and different files. Existing merge undo tests pass.
- `g3.mjs` run against merged base `89d3351` and the fix via `PLUGIN_SRC`: base permits both unsafe undo cases and leaves four tracks in two works; fix refuses both and leaves zero tracks in two works. Immediate undo and undo after two scans still restore exactly. E11 probe cases remain outside this issue.
- `g4.mjs` with the fix: undo is refused; after two more scans there is one work, one realization and zero tracks attached twice.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 367/367 passed.

No local browser or Compose/restart run for #15. The known pre-existing Phase 1 workflow fixture mismatch remains unchanged and outside scope.

---

# v0.3 Phase 0.04 — L3 / issue #11

Base: `aurral-classical` `0efd6b2`, including merged E1 PR #96 and the earlier L2/E2 fixes. This follows the handoff sequence. Current #11 has no further dependencies or later comments changing scope. No other issue is implemented here.

## Result

`extendRealization` now skips tracks whose latest effective `editor.unassign-tracks` / `editor.assign-album` event is a removal. The lookup uses the track IDs in the audit payload and audit ID ordering. A skipped mapping is not an assignment. A newer explicit assignment restores eligibility; a later removal keeps the track out again. When no track is eligible, extension returns without a no-op extension audit.

For a work or its movements with manual edits, or an editor action changing the work's structure, extension checks all pending tracks and sections against available existing movements before writing. If any section would need a new movement, it returns false and creates the existing `movement-mismatch` review, leaving recordings, movement positions and attachments unchanged. This avoids partially applying earlier tracks before encountering a later mismatch.

Filling an existing movement remains allowed on edited works. Unedited works still gain genuinely missing movements, independently of another track being explicitly removed. A removal does not delete the catalogue movement; mistaken removals can be corrected through manual assignment.

No schema, core, media-tag or provider-request changes. No new storage table or repair pass. Bundle rebuilt.

## Verification

On Node 24.22.1:

- Seven new editor tests pass; six fail on merged base `0efd6b2` (the existing-movement behavior already passed there).
- `node --test test/editor-v2.test.js test/auto-match.test.js test/messy-matching.test.js`: 85/85 passed. Cases cover the Applause removal across three rescans, newer assignment and subsequent removal, skipped mappings, extension by a different new track, work/movement/order edits, stable mismatch reviews, no partial writes, and filling existing movements on edited works.
- Review probe `p2.mjs` run against base `0efd6b2` and this branch via `PLUGIN_SRC`: section A reattaches Applause on the base, while the fixed run leaves it out. Other sections concern previously fixed L2 or unrelated work-title/blank-field behavior and do not expand #11's scope.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 363/363 passed.

No local browser or Compose/restart run for #11. The known pre-existing Phase 1 workflow fixture mismatch remains unchanged and outside scope.

---

# v0.3 Phase 0.03 — E1 / issue #12

Base: `aurral-classical` `15618a1`, containing merged E2 PR #95 and L2 PR #94. The handoff sequence places E1 next. Current #12 declares no further dependencies and has no later comments changing scope. No other issue is implemented here.

## Result

Both `create-work` and `create-work-from-album` now persist Create anyway as one `distinctKey(newWork, similar)` suppression per similar work. This uses the existing `match_suppression` table, with the host actor recorded, inside the creation transaction. Duplicate warnings still require confirmation.

`mergeDuplicateAutoWorks` reviews a pair instead of merging whenever either work lacks an `album-work` identity. Explicitly distinct pairs remain silent. Existing protection for multiple edited auto-created works and conflicting provider identities stays in place, and cleanup of genuine old all-auto duplicates still passes its regression.

The original and new works retain their separate album assignments across repeated scans. A new album fitting both stays unassigned with an `ambiguous-work` review. This prevents the unwanted automatic merge; it does not add undo for automatic merges or repair already collapsed works. No schema, core, media-tag or provider-request changes. Bundle rebuilt.

## Verification

On Node 24.22.1:

- Six new editor regressions fail against merged base `15618a1` and pass with the fix.
- `node --test test/editor-v2.test.js test/auto-match.test.js test/editor-v0.2-workflow.test.js`: 49/49 passed. Coverage includes both create paths and retained warning behavior, exact album assignments across three rescans, ambiguous subsequent albums, all-similar suppression including unnumbered works, identity-less works in both creation orders, and two identity-less works raising one stable review across repeated repair passes. The existing old all-auto duplicate cleanup still passes.
- Review probe `p5.mjs` run against base `15618a1` and the fix using `PLUGIN_SRC`. Section A: the base collapses albums A/B back into one work; the fix retains two live works with their separate recordings. Sections B–E probe unrelated review/editor/track-link findings and are outside #12.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 356/356 passed.

No local browser or Compose/restart run for #12. The known pre-existing Phase 1 workflow fixture mismatch remains unchanged and outside scope.

---

# v0.3 Phase 0.02 — E2 / issue #13

Base: `aurral-classical` `2b50d44`, including merged PR #94 / L2. The handoff orders E2 immediately after L2. The current issue has no later comments changing scope. #10 remains open on GitHub, but its implementation is merged and present in this base. No other issue is implemented here.

## Result

Editor work merges (`addMissing: true`) keep the retained work's existing composer credits. Dropped composer credits are omitted in that case; other roles still move. If the kept work has no composer, all dropped composers move. Automatic merges keep their prior behavior.

Both directions in the merge preview identify the retained composers, explicitly name each excluded composer (including genuine co-composers), and offer links to merge the contributor entries separately. The merge form describes this exception rather than saying everything moves. After a separate contributor merge, L2 aliases let subsequent albums using either spelling find the retained work. No automatic contributor merge is introduced.

No schema, core, media-tag or provider-request change. Bundle rebuilt. No special repair pass; this changes subsequent merges only. Work merge undo restores the original credits.

## Verification

On Node 24.22.1:

- Three new editor tests fail on the merged base before the change (missing composer previews).
- `node --test test/editor-v2.test.js test/editor-v0.2-workflow.test.js test/auto-match.test.js`: 43/43 passed. Cases cover both preview directions and usable contributor merge links, a third album after the work merge, the old spelling after separately merging the contributors, genuine co-composer disclosure, other-role transfer, undo restoring exact credit rows, and inheriting all composers when the kept work has none.
- Review probe `p8.mjs` run against base `2b50d44` and the fix using `PLUGIN_SRC`: the base retains both composer credits and creates a second work for the third album; the fix keeps one composer credit and attaches albums A/B/C to one work. The contributor records themselves remain separate until explicitly merged.
- `npm run build`: passed. `git diff --check`: passed.
- Full `npm test`: 350/350 passed.

No local browser or Compose/restart run for #13. The pre-existing Phase 1 workflow failure (shared smoke script reads `/config/phase4-fixture.json`, but the Phase 1 seed does not create it) is outside this issue; the workflow is unchanged. Phase 4 integration passed for the prerequisite PR.

---

# v0.3 Phase 0.01 — L2 / issue #10

Scope: composer alias persistence and matching, plugin only. Base `762ee5c` on `aurral-classical`; reference handoff `b6f6a3b`. Issue #10 is the first Phase 0 task and declares no prerequisite. E2 depends on it, rather than blocking it. No other issue is implemented here.

## Result

- Merge and rename preserve old spellings in `alias`; merges also retain the dropped contributor's Other spellings and existing alias rows.
- Composer lookup includes alias rows and the editor's Other spellings. Unambiguous names resolve to the person's current name before work and album grouping keys are built.
- Work keys continue to use the canonical names from composer credits. Existing duplicate auto-created works can consolidate on the next pass after the admin merges composers.
- MusicBrainz identity takes priority. Conflicting IDs remain separate. Shared aliases never justify an automatic contributor merge, and initials are never expanded speculatively.
- Original spelling and catalogue-key variants remain checked against historical album-work identities to preserve removal decisions.
- No schema, core, provider-request policy or media changes. Bundle rebuilt.

## Verification

On Node 24.22.1:

- `node --test test/auto-match.test.js test/editor.test.js test/editor-v2.test.js test/messy-matching.test.js`: 82/82 passed, including six new L2 tests covering editor merge/rename, aliases from both sources, repeated scans, removed attachments, initials, shared spellings and MusicBrainz precedence/conflicts.
- The new auto-match tests were also run against unchanged base `762ee5c`: five fail there and all eleven pass with the fix.
- `npm run build`: passed; `git diff --check`: passed.
- Full `npm test`: 347/347 passed (the earlier implementation run also passed 345/345).
- Review archive SHA-256 verified as `b3593555d6ba9a50c75071cf496462cd186bc4f45473d037ff44df9e44c25ab7`; ran `p1.mjs` and `p2.mjs` with `PLUGIN_SRC` set to this checkout. `p1` confirms spellings remain distinct before an admin establishes aliases. `p2` B/C confirm merged Bach and renamed Rachmaninoff retain one composer and join subsequent old-spelling albums to the right work. In B, the additional BWV 1068 appropriately creates a separate work under the retained Bach.

The probes are broad review scripts, not assertion suites. Their unrelated L1/L3 and blank-field findings are outside #10. `p2` E reports an invalid-entry mutation because its initial Smetana work was not created; it provides no work-title-rename validation. No browser, real media playback, Compose/restart integration or Node 22/26 matrix run locally. The variations prototype addresses other findings and was not applied.
