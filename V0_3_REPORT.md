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
