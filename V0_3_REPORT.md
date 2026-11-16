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
