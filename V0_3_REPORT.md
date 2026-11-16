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
