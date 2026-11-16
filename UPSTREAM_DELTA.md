# v0.3 Phase 1.6 — persist reissue links between performances (issue #54)

Second of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #54 only; #54 has no later comments.

New `src/model/reissues.js`. After matching (and after credits are derived), `linkReissues` stores a `same_recording` relation for each pair of performances of a work that the v0.2 rule (`sameRecording`: same MusicBrainz recordings, or the same performers with every part and track within two seconds, never on one album) joins. `groupRecordings` reads the stored state first: a link joins, an admin's unlink (`unlinkReissue`, audited as `reissue.unlink`) keeps apart, and the rule decides only pairs with neither; matching never links a pair an admin took apart until `relinkReissue`. The work page and the search index use it. New relation kinds `same_recording` and `member_of` (for 2.3). The first library pass backfills links for existing recordings (plan §3 step 2). No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 1.5 — contributor identity by aliases and MusicBrainz IDs (issue #55)

First of ten commits in one PR (1.5–1.7, 2.1–2.7) on `claude/pensive-bardeen-5dat3q`, from `aurral-classical` `ea1eb8d` (merged PR #104). Implements #55 only; #55 has no later comments.

Composer matching now finds every person by name and alias, not only known composers, so a composer and a performer of one name with no conflicting ID are one person; the automatic merge of same-named records stays composers-only (plan S18). Derived credits use a track's MusicBrainz artist IDs when the artist tag lists exactly as many names, in order, and every track of the performance agrees. `contributorFor`: an ID's holder wins under any spelling; a lone same-named record without an ID gains it; a same-named record holding another ID is someone else, so a new record is made and a `contributor_identity` review (`same-name-different-id`) opens. Exact folded names and aliases only; no fuzzy matching. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 1.4 — derive performer credits (issue #52)

Last of five commits in one PR (0.11, 1.1–1.4). Implements #52 only; #52 has no later comments. 1.5 (identity by aliases and IDs across all contributors) and later items are not started.

New `src/model/contributors.js`. `performerNames` is the artist-tag split moved from `engine.js` and `presentation.js`, each caller keeping its own name folding, so search and pages read exactly as before. `trackCredits` reads one track's credits: a conductor tag names the conductor; Vorbis `PERFORMER` values name players and their instruments ("Martha Argerich (piano)"); without them the artist tag does, split into a list only when every piece is a name or an ensemble. Ensembles (the `credits.js` word list) are orchestra, choir or ensemble by their own name; everyone else is `performer`, shown as "Performer". `contributorFor` reuses the one person or ensemble with that exact folded name or alias, or the holder of a MusicBrainz artist ID; a name two records share gets no credit; new records are marked `unreviewed`. `deriveCredits` runs at the end of `autoMatchTaggedWorks` for performances with no performing credit at all, active or removed, and gives each the credits all its tracks share, as `derived`. `accompanist` is a new person role. Admins' credits are never touched, and a removed derived credit is never added again. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 1.3 — conductor, performer and artist ID tag evidence (issue #53)

Fourth of five commits in one PR (0.11, 1.1–1.4). Implements #53 only; #53 has no later comments.

`readTags` (`src/tags.js`) now reads the conductor (taglib's own field, so FLAC, Opus and MP3 alike) and every Vorbis `PERFORMER` value ("Martha Argerich (piano)"); artist IDs were already read. The library scan (`runtime.js` `scanFile`) stores `conductor`, `performers` and `artistMbids` in a track's hints only when set, as it does `grouping`, so a file without them keeps its stored evidence byte for byte and a rescan adds no evidence rows. Nothing reads the new hints yet; 1.4 does. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 1.2 — credit provenance (issue #51)

Third of five commits in one PR (0.11, 1.1–1.4). Implements #51 only; #51 has no later comments.

`Catalogue.credit` takes `source` (`manual` by default, `derived`, `provider`). A credit added for a target, contributor, role and instrument that has a removed row comes back as that row, with the new source, so the unique key never blocks an admin re-adding a removed credit. New `Catalogue.removeCredit` marks a derived credit `removed`, so a later scan does not derive it again, and deletes any other. The editor's Remove uses it. Every reader that shows credits or tests a role reads active credits only: work and album pages, both editors, composer detection in matching, the search index and the undo summary. Merges of people or works carry removed rows along, and an active credit wins a collision with a removed one. The search index stamp counts active credits, so a removal rebuilds it. Existing credits are manual and active (1.1), and undo snapshots keep both columns. No schema or core change beyond 1.1; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 1.1 — catalogue schema 5 (issue #48)

Second of five commits in one PR (0.11, 1.1–1.4) on `claude/pensive-bardeen-5dat3q`. Implements #48 only, as the plan's §3 specifies; #48 has no later comments.

Migration 5 (`src/model/schema.js`, `SCHEMA_VERSION = 5`) is additive, runs in one transaction, and `openDatabase` takes the `backups/before-v5-*.sqlite` backup first. It adds `credit.source` (`manual`, `derived`, `provider`) and `credit.state` (`active`, `removed`), both checked by the database, and indexes on `credit(contributor_id)` and `credit(target_id)`. It adds the `sortName`, `location`, `instruments` and `recordingDate` fields, and the `user_recording_state`, `saved_queue` (D4 = plugin-owned comparisons, as #76 is titled) and `tag_backup` tables. It also adds `search_doc.sort_title`, `sort_key` and `sort_date` with a `(kind, sort_title)` index. Existing credits read as manual and active; nothing existing is rewritten. `Catalogue.credit` now names its insert columns. Nothing reads the new columns or tables yet; 1.2 onward does.

Rollback: stop the plugin, restore the `before-v5-*.sqlite` backup offline with `restoreDatabase` (`scripts/model-admin.mjs restore MODEL_FOLDER BACKUP --offline`), and install the previous plugin build, as V0_2_REPORT.md describes for schema 4.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 0.11 — variation ranges, Variatio, dash-joined sections and returning arias (L6/L7/L8/L13, issue #20)

Branch `claude/pensive-bardeen-5dat3q` starts at `aurral-classical` `c61dcea`, including merged L1 PR #103. Current #20 has no later scope comments. This implements L6, L7, L8 and L13 together, as #20 asks, from `variations-prototype.patch` (applied cleanly; prototype comments replaced). It is the first of five commits in one PR with Phase 1.1–1.4.

One splitter (`rawSections`) serves `sectionTitles`, `trackSections` and `mapBySections`: it splits on " / " and on a spaced dash before a variation, theme or coda, and expands a range ("Variations 1-3", "Vars. IV–VI") or a list of sections ("Theme and Var. 1") into one section each. "Variatio" is a variation; a variation maps by its number; a named section (theme, introduction, aria, fugue…) takes the earliest free movement of that name; a theme that returns at the end ("Aria … Aria") no longer leaves the work unmatched. The library pass now repairs works older versions made with range or list movements, not only " / " ones (unedited automatic works only). The Apple corpus scorer gains `matched` (share of tracks in a work), so an unmatched album can no longer score as perfect; the baseline is re-saved. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 0.10 — excerpts never line up with another album's movements by order (L1, issue #19)

Branch `claude/pensive-bardeen-5dat3q` starts at `aurral-classical` `f055abe`, including merged C1 PR #102 (core C1 merged as core PR #58). Current #19 has no additional dependencies or later scope comments. This implements L1 only.

`mapEach` lined an album's tracks up with a work's movements by order whenever the counts matched, even when no track matched by name or number. Excerpts on two albums (BWV 1007's Prélude, Sarabande and Gigue, then its Allemande, Courante and Menuet) were placed on each other's movements with no review. The count fallback now applies only when no track contradicts it: a track's number must be its movement's (`index`, else position; a variation's or set piece's number is its index alone), and no track may name another of the work's movements. Otherwise the album falls through to the existing section mapping, work expansion and `movement-mismatch` review. Untitled and agreeing tracks still line up by order. `mergeMapping` uses the same path. Plugin only; no schema or core change; bundle rebuilt.

Data repair is not automatic, as the issue specifies. A new read-only report, `node scripts/model-admin.mjs movement-numbers MODEL_FOLDER [--json]`, lists tracks whose title numbers a different movement than the one they are on, so an admin can move them in the editor.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 0.09 — keep presentations within core limits and past stale tracks (C1, issues #18 and core #49)

Branch `claude/pensive-bardeen-5dat3q` in both repositories, starting at plugin `aurral-classical` `2bcc91d` (including merged L10 PR #101) and core `aurral-classical` `a4fe84d` (fork `main` synced through upstream #1891). Neither issue has later scope comments. This implements C1 only, both halves, which do not depend on each other.

Plugin (#18): the work page and album presentation are cut to core's page limits as their last step. Text fields stop at 500 characters with an ellipsis, never splitting an emoji (description 10,000; instrument and record label 200), and work movements, missing movements and movement parts stop at 200. `complete` and `movementCount` still describe the whole work. Stored data is unchanged; bundle rebuilt.

Core (#49, core `bd41154`): one item naming a track that is no longer in its album (the plugin's catalogue lags the Library until its next scan, and a retag changes ids) no longer fails the whole page with a 502. The item is left out, including one on an album that no longer exists; a recording or album group left with no items is dropped, and the count is logged at info. Malformed ids, bad ranges and items from another album still fail. Generic and additive: no API, schema or capability change.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 0.08 — preserve tag-sensitive retags and repair old split links (issue #14)

Branch `fix/v0.3-0.08-preserve-retagged-file-links` starts at `aurral-classical` `3e74192`, including merged L11 PR #100. Current #14 has no additional dependencies or later scope comments. This implements L10 only.

For tag-sensitive hashes, the same file ID, path and duration now retain the plugin link even when the host track ID and container hash change. Reconciliation indexes this evidence and reserves full core/file/path matches before stable file/path matches, then other candidates, preserving L11 ownership and manual newer links. Unambiguous old reused-file reviews can recover the original link and remove an unedited duplicate link plus its unused auto-added movement. Original metadata, work placement and picks stay; ambiguous, manually edited, conflicting or structurally uncertain cases remain for review. No schema, core, media or fingerprint-format change; bundle rebuilt.

Verification and current probe interpretation: `V0_3_REPORT.md`. The scoped limitation remains that a same-duration replacement at the same stable file ID/path cannot be distinguished with a container hash alone. The known Phase 1 fixture mismatch remains outside scope.

# v0.3 Phase 0.07 — reserve exact file matches before duplicate-audio moves (issue #16)

Branch `fix/v0.3-0.07-claim-exact-file-matches` starts at `aurral-classical` `c2bdc59`, including merged E7 PR #99. Current #16 has no additional dependencies or later scope comments. This implements L11 only.

Reconciliation reserves unique exact core/file/path matches first, then excludes them from other candidate and reused-identity pools before calculating demand. Moving or deleting one identical-audio copy no longer sends unchanged copies to review, including multiple files sharing a core track. Ambiguous moves, conflicting historical exact claims and epoch changes retain conservative review behavior. Link IDs, pinned metadata and unchanged-file evidence reuse are covered. No schema, core, media or fingerprint-format change; bundle rebuilt.

Verification and p4/interrupted-scan evidence: `V0_3_REPORT.md`. L10's tag-sensitive retag identity issue and other probe findings remain separate. The known Phase 1 fixture mismatch remains outside scope.

# v0.3 Phase 0.06 — scope undo conflicts to real overlapping changes (issue #17)

Branch `fix/v0.3-0.06-scope-undo-conflicts` starts at `aurral-classical` `1108102`, including merged E10 PR #98. Current #17 has no additional dependencies or later scope comments. This implements E7 only.

Selection rows no longer block earlier undo. A later change-set row must be an active merge or deletion whose saved entity set overlaps the earlier snapshot. Persistent insertion order also catches changes with equal timestamps. Navigation-only audit events from opening/cancelling Group, Edit together and related forms are ignored; actual edits and assignments retain their audit protection. Later overlapping destructive changes still block undo and the newer change remains undoable. No schema, core, media or provider-request change; bundle rebuilt.

Verification and f7/f8 probe evidence: `V0_3_REPORT.md`. E10's reassigned-track guard remains covered. E8/E9 and the known Phase 1 fixture mismatch remain outside scope.

# v0.3 Phase 0.05 — safe deletion undo and duplicate recording repair (issue #15)

Branch `fix/v0.3-0.05-safe-deletion-undo` starts at `aurral-classical` `89d3351`, including merged L3 PR #97. Current #15 has no additional dependencies or later scope comments. This implements E10 only.

Before restoring a deletion, undo now refuses if any track from the saved segments has a current realization item. The refusal leaves the catalogue and undo marker unchanged. Undo of merges keeps its existing behavior. The library match pass also removes later duplicate realizations only when their complete ordered track/movement/occurrence/range mappings are identical within the same work, using detachItem and retaining equivalent user/admin picks. Different files, ranges, ordering or partial recordings remain separate. No schema, core, media or provider-request change; bundle rebuilt.

Verification and base/fixed g3/g4 probe evidence: `V0_3_REPORT.md`. E7's separate global history guard and E11's contributor deletion behavior are unchanged. The known Phase 1 fixture mismatch remains outside scope.

# v0.3 Phase 0.04 — preserve track removals and edited movement lists (issue #11)

Branch `fix/v0.3-0.04-preserve-track-removals` starts at `aurral-classical` `0efd6b2`, including merged E1 PR #96. Current #11 has no further dependencies or later scope comments. This implements L3 only.

Automatic extension respects the latest per-track unassign/assign audit decision. Removed tracks stay out until explicitly assigned; a skipped mapping does not count as assignment. For a work or movement edited manually, or a work whose order was edited, extension first verifies that every eligible track fits existing movements. A needed new movement raises movement-mismatch before any partial attachment or structural change. Edited works can still fill existing movements, and unedited works can still gain new movements. No schema, core, media or provider-request change; bundle rebuilt.

Verification and before/after probe evidence: `V0_3_REPORT.md`. The known Phase 1 integration fixture mismatch remains outside this issue.

# v0.3 Phase 0.03 — preserve deliberate separate works (issue #12)

Branch `fix/v0.3-0.03-preserve-distinct-works` starts at `aurral-classical` `15618a1`, which includes merged E2 PR #95 and L2 PR #94. Current #12 has no extra dependencies or later scope comments. This implements E1 only.

Both work creation paths remember Create anyway as distinct from every similar work in the existing suppression table. Duplicate repair never merges into or out of a work without an album-work identity; unsuppressed duplicates are reviewed instead. Repeated scans preserve the original and new work and their album assignments. A later album that fits both raises ambiguous-work for the admin. Existing all-auto duplicate cleanup remains covered by its regression test. No schema, core, media or provider-request change; bundle rebuilt.

Verification and base/fixed probe evidence: `V0_3_REPORT.md`. The known Phase 1 fixture mismatch remains outside this issue.

# v0.3 Phase 0.02 — work-merge composers (issue #13)

Branch `fix/v0.3-0.02-work-merge-composers` starts at merged `aurral-classical` `2b50d44` (PR #94, L2 prerequisite). Current #13 has no later comments changing scope. This change implements E2 only.

An editor work merge preserves the kept work's composer credits when present, moves other credit roles, and inherits all dropped composers only if the kept work has none. Both merge directions explain which composers stay and which are not added, with links to merge the contributor entries separately. This includes genuine co-composers: the preview explicitly discloses their omission. The form note now reflects these rules. Automatic merges retain their existing behavior; work merge undo restores the original credits. No core or schema change. Bundle rebuilt.

Verification and probe evidence: `V0_3_REPORT.md`. The known Phase 1 integration fixture mismatch is outside #13 and remains unchanged.

# v0.3 Phase 0.01 — composer aliases (issue #10, November 15, 2026)

Review branch `fix/v0.3-0.01-composer-aliases` starts at `aurral-classical` `762ee5c`. The current issue has no prerequisite issues or later comments. Reference: `v0.3-handoff` `b6f6a3b`, `docs/v0.3-handoff/`. This change implements L2 only; E2 and later phases remain separate.

Person renames retain the previous name in the existing alias table. Contributor merges retain the dropped name, saved aliases and Other spellings. Matching indexes both alias sources and canonicalizes only unambiguous composer names before generating work and album keys. MusicBrainz IDs retain priority; conflicting IDs and shared aliases do not cause identity merges. Initials are not guessed. Original spelling keys remain available so tracks removed from an album's work stay out after a rename or merge. No schema or core change; media tags are untouched. `index.js` rebuilt.

Verification details and limitations: `V0_3_REPORT.md`.

# Paired integration CI passes (November 15, 2026)

The user asked for the paired integration workflow to be run on `aurral-classical`. **Run 30 (`43682154366`) passed** (plugin `347a4e4`, core pin `a7691ad`). It covers all seven editor browser checks, the comparison smoke, the full-app editor and permissions check, and restart persistence with unchanged media.

Runs 19–29 failed first. Most failures were test-timing or stale test expectations that CI exposed for the first time: the browser checks for items 1–6 had never been run in CI. Fixes:

- **Draft-check waits:** the drafts check waits for the page's own guard before Back, and harness hosts keep previous data like `PluginPage`.
- **Comparison smoke:** it waits for its jobs and expects one job per distinct file, as core saves them.
- **Keyboard drag:** the reorder check steers by dnd-kit's announcements.
- **Full-app check:** it answers the discard dialog that Reload shows since item 1.

One real bug was fixed in core `a7691ad`: a save that returned to a previously visited page (Movements after Save order) briefly showed that page's cached, outdated copy. Successful changes now drop the editor's other cached pages. Core check, build and 2666/2666 unit tests pass. Details: plugin `EDITOR_UI_HANDOFF.md`.

# Metadata editor UI, item 5 completion (November 15, 2026)

Item 7 is published at the user's request: core `ebbb7e2172e8433ff1266ae6a1faf07ed50b5661`, plugin `4c95faa` pinning it in paired CI. At the user's request, item 5's two remaining points from the review are now done.

- **Unsaved count:** the form footer counts changed fields ("2 unsaved changes").
- **Errors beside fields:** a plugin rejection may name a field (a bounded optional `field` on `{ok:false}` results, passed through as `{error, field}`). The host shows the message under that field, marks it invalid and moves focus there. Without a field it falls back to the footer as before; older hosts ignore it.

The plugin (1.0.59) names fields for dates, titles, names, credited people and the merge step's other entry. Generic core and plugin changes only; no schema, permission or command change.

Validation: `pnpm check` passes (1089 unsafe-any uses, baseline unchanged); production build passes; full core unit suite 388 files / 2666 tests passed (`.scratch/editor-gaps-unit.log`, 139 s); core plugin-host tests 30/30 (red on ebbb7e2 first). Plugin editor tests 56/56 (red on 1.0.58 first); standard full plugin suite 341/341 passed with normal file isolation (`.scratch/editor-gaps-all-tests.log`, 165 s). All seven real-renderer browser checks pass at desktop/phone widths; the footer check failed on ebbb7e2 first. Not run: `pnpm eden test` (no Docker daemon), full Compose/restart. The paired integration workflow is to be run manually on `aurral-classical` after publication; see plugin `EDITOR_UI_HANDOFF.md`.

# Metadata editor UI, item 7 (November 15, 2026)

Item 6 is published at the user's request: core `fd5d60bb5c669c58267ec8b58d54935a6068b40f`, plugin 1.0.58 with paired CI `2b22ed2` pinning that core and running the reorder/review browser check. The user accepted item 5's two remaining gaps (unsaved count, field-level validation) for now.

Item 7 keeps list navigation stable, in the generic admin-pages-v2 renderer only. Each tab remembers its search, page and scroll for the browser session. After following links to related entries, the tab button or the breadcrumb back to the list returns there, including after a reload. Links still open the entry's own tab at the page that holds it. Lists reached through links never replace a remembered place. No plugin, API or schema change; plugin remains 1.0.58.

Validation: `pnpm check` passes (1089 unsafe-any uses, baseline unchanged); production build passes; full core unit suite 388 files / 2666 tests passed (`.scratch/editor-item7-unit.log`, 137 s). The new real-renderer list-places browser check failed on fd5d60b and passes at desktop/phone widths, three runs in a row. All six earlier browser checks pass at both widths. Not run: `pnpm eden test` (no Docker daemon), full Compose/restart, remote CI. Item 7 is committed on the session branch `claude/eager-babbage-gkwhxx` only, not on `aurral-classical`. All seven review items are now implemented.

# Metadata editor UI, item 6 (November 15, 2026)

Item 5 is published at the user's request: core `a26e013fea9bbc172e263aa3a294323f3b258927`, plugin 1.0.57 with paired CI `be404e3` pinning that core and running the footer browser check. The user then supplied the review's original seven recommendations; they are now recorded verbatim in plugin `EDITOR_UI_HANDOFF.md`. Against that text, item 5 still lacks an unsaved-change count and validation beside the affected field (raised with the user, not done).

Item 6 (plugin 1.0.58) has two parts.

- **Reordering:** movements are reordered locally and saved once. Core adds a generic v2 `order` form field (drag handle, keyboard drag via the shared `SortableList`, ↑/↓ buttons) and advertises `capabilities.orderField: true`. Older cores get a position-menu form instead. Per-click Move up/down remains only for works over 500 movements.
- **Review decisions:** reviews about two entries lead with the question and both named entries, then **Decide**: Merge…, Link the record here instead (identity reviews only), Keep separate or Skip. The header only navigates. Merge opens a merge step that shows both outcomes and asks which entry stays; the work/person Merge forms lead to the same step.

No schema change or new permission. Merge semantics, undo and the item-5 footer contract are unchanged.

Validation: `pnpm check` passes (1089 unsafe-any uses, baseline unchanged); production build passes; full core unit suite 388 files / 2666 tests passed (`.scratch/editor-item6-unit.log`, 133 s); core plugin-host tests 30/30 (red on a26e013 first). Plugin editor/matching tests 97/97 (5 red on 1.0.57 first); standard full plugin suite 340/340 passed with normal file isolation (`.scratch/editor-item6-all-tests.log`, 167 s). A new real-renderer reorder/review browser check passes at desktop/phone widths. The five earlier checks pass at both widths. Not run: `pnpm eden test` (no Docker daemon), full Compose/restart, remote CI. Item 6 is committed on the session branch `claude/eager-babbage-gkwhxx` only, not on `aurral-classical`; item 7 remains pending.

# Metadata editor UI, item 5 (November 15, 2026)

Item 4 is published: core `292252ce897f7ebf2df99cba303cd1b6c2a58e90`; plugin regression/docs `8de3cbb`, paired-CI commit `5a846040b60e1486659055bd824a3b7a2041b93a` (CI pins core 292252c and runs the lookup/search browser check). The previous session's uncommitted item-5 work was not available, so item 5 was re-implemented in a fresh cloud session on branch `claude/eager-babbage-gkwhxx` in both repositories, starting from those published heads.

Item 5 keeps save, cancel and feedback next to the task, in the generic admin-pages-v2 renderer. Each form has a footer that stays at the bottom of the screen while a long form scrolls. It holds Submit (**Saving…** while pending, no duplicate submission), local **Discard changes**, an **Unsaved changes** note and optional plugin-supplied actions. v2 form sections accept a bounded optional `actions` list (shared action validator, default none), and the host advertises `capabilities.formActions: true`. Results and errors, including conflict Reload, appear where the action started: the form footer, the row/bulk section, the browse list (even with nothing selected), the section a result focuses, or the entry's header. Fields reached by Tab stop above the pinned footer. No new command, route, permission, auth or schema change. The plugin (1.0.57) puts Cancel beside Submit for work add/merge forms, album grouping, new entries and Edit together. It hoists those actions into the header on older hosts without `formActions`. All workflow decisions stay in the plugin.

Validation: `pnpm check` passes (1089 unsafe-any uses, baseline unchanged); production build passes; full core unit suite 388 files / 2666 tests passed (`.scratch/editor-footer-unit.log`, 143 s); core plugin-host tests 30/30 (red on 292252c first); plugin focused editor tests 54/54; standard full plugin suite 339/339 passed with normal file isolation (`.scratch/editor-footer-all-tests.log`, 166 s). The new real-renderer footer browser check failed on 292252c and passes at desktop/phone widths. The four earlier browser checks pass at both widths. Not run: `pnpm eden test` (no Docker daemon in this container), full Compose/restart, remote CI. Running record: plugin `EDITOR_UI_HANDOFF.md`. Item 5 code is committed on the session branch `claude/eager-babbage-gkwhxx` only (core `d36ef71`, plugin `55381f1`), not on `aurral-classical` and not in paired CI; items 6–7 remain pending.

# Metadata editor UI, item 4 (November 14, 2026)

Item 3 is published: core `c0cf7ab55f130a57cb9b68efc5e052ef8f5579b5`; plugin implementation `a9904b8`, paired-CI commit `39f51193c9f50a622a0eb780dfc47c041d8525ce` (1.0.56). The user requested push, then item 4. Paired CI now includes the work-sections browser check.

Item 4 improves the generic admin-pages-v2 renderer: arrow/Home/End navigation, Enter selection without form submission, Escape/Tab retaining the chosen value, active-option ARIA and scrolling; request-specific loading/error/empty states, explicit retry, and aborted/obsolete response protection. List search has a visible Search button, submission guidance and applied-query result counts. Lookup typing still searches automatically; list search remains explicit. All plugins using this renderer benefit. No classical logic, plugin runtime/bundle/schema, backend, auth or API changes. Plugin remains 1.0.56.

Core checks passed with 1089 unsafe-any uses (unchanged), production build passed, all 2666 core unit tests passed across 388 files, and four actual-renderer browser harnesses passed at desktop/phone widths. Eden was attempted but Docker image extraction failed with no space left on device before journeys ran; this checkout's lab was removed with pnpm eden down. Remote CI/full Compose restart not run. Running implementation record: plugin `EDITOR_UI_HANDOFF.md`. Item 4 core commit `292252c` is complete locally, unpushed; items 5–7 remain pending.

# Metadata editor UI, item 3 (November 14, 2026)

Item 2 is published: core `c38393bd4816e721bd4c838e59ad0403452f7153`; plugin implementation `8800d16` with paired-CI pin `6a41904` (1.0.55). The user requested push, then item 3.

Item 3 (plugin 1.0.56) separates work editing into Details, Movements, Credits, Recordings and Advanced using the existing editor API. Add and merge forms open on request; Cancel returns to their section, with host draft protection. Successful edits stay in the relevant section; added movements open their last page. Merge/delete remain confirmed/undoable as before, under Advanced. Plugin-owned section addresses survive reloads and use the existing work revision scope. No schema or matching changes.

The only item-3 core runtime change is two generic mobile CSS declarations: row actions take their own line and wrap, keeping labels readable for every plugin. Before/after screenshots caught and verified the fix. No classical-specific core code or new API. Validation and next actions: plugin `EDITOR_UI_HANDOFF.md`; item 3 is complete locally and unpushed. Validation: 336/336 full plugin tests, 38/38 focused editor tests, three real-renderer browser harnesses at desktop/phone widths, core checks (1089 unsafe-any, unchanged) and production build. Core CSS commit `c0cf7ab`; plugin bundle rebuilt. Full Compose/restart and remote CI not run for this step. Items 4–7 remain pending.

# Metadata editor UI, item 2 (November 14, 2026)

Local implementation for review, plugin 1.0.55. Album grouping now uses one paged track list: select tracks → choose an existing work or create one → map only those tracks → apply. Back retains the selection; Cancel leaves assignments unchanged. Not classical defaults to Skip; explicit moves remain atomic. Selection tokens bind the final request to the selected album tracks, in album order. Existing forms/rows/navigation API; no schema change.

Core boundary: all grouping, work/movement decisions, selection persistence and validation live in the plugin. The only item-2 core change keeps the generic bulk-action bar visible when rows are selected; any plugin list benefits. No classical names, branching or data model in core. Item 1's generic draft/navigation guards are published as core `365e6dc`, plugin `26be9ac`. Those guards belong to the host because it owns form resets, routing and unload events. An experimental scroll change was removed after testing did not justify it. Running validation and the ordered backlog are in `EDITOR_UI_HANDOFF.md`. Item 2 is not pushed; items 3–7 remain pending. Validation: standard full plugin suite 333/333, focused editor suite 35/35, actual-renderer assignment and draft browser regressions at desktop/phone widths, rebuilt bundle, core checks/build. Local core commit `c38393b`. Full Compose/restart not run for this step.

# Metadata editor UI, item 1: draft protection

Generic core renderer change only (`PluginAdminPage.tsx`). Before sending a mutation, the host checks for dirty forms other than the submitted form and asks to keep editing or explicitly discard them. Navigation guards cover internal links, surrounding-app routes, Back/Forward and native reload/tab close; conflict Reload also asks. Failed mutations keep drafts. Successful commands reset forms even when their revision is unchanged. No API, schema, capability or plugin bundle change. Browser regression: plugin `dev/editor-drafts-browser.mjs`, actual host renderer with synthetic responses at 1280px and 390px; original `61b8ddc` fails on the silently lost title. Running results and the remaining ordered UI work: `EDITOR_UI_HANDOFF.md`. Core published as `365e6dc` at the user’s request; paired CI pins it and runs the draft regression.

# v0.2 follow-up: admin pages keep the reader's place

Additive and generic (`pluginPages.ts`, `PluginPage.tsx`, `PluginAdminPage.tsx`, `Layout.tsx`, a CSS rule, `plugin-api.md`). A mutation result may carry `focus` (a section id; validated like other keys): the host keeps the scroll position and scrolls that section into view. Results of commands other than `open`, and section pagers, navigate with `preserveScroll` router state, which `Layout` honours on the same path instead of jumping to the top. Pagers render above and below the browse list and paged sections. Links that open another entry send `offset=` (now allowed empty) so the plugin can show the page holding it; reloads keep it. A successful admin-page mutation invalidates the album presentation and the plugin's resource-page queries, so an album's By work view and work pages show the change at once instead of after their 30-second cache. Older plugins are unaffected (no focus, `Number("")` is 0); older cores strip `focus` and send `offset=0`. Test: `.tests/plugins/plugins.test.ts` "admin pages may ask the plugin for the page holding a selection…". PR-readiness: draft.

# v0.2 admin pages: selection and pages

Admin pages v2 gain two optional, generic section fields (`pluginPages.ts` schema, `PluginAdminPage.tsx` renderer, a few CSS rules): `select: { key, actions }` on a rows section or the browse list (checkboxes, Select all, Clear; an action receives the ticked IDs under `key`, with the count in its confirmation) and `pager: { label, previous, next }` on a rows section (the plugin pages long sections by selection, staying under the 500-row limit). After a mutation that returns a selection, the list keeps its tab, search and page. Pages without the fields render as before; older cores drop them (the plugin then shows rows without ticks and no pager, and the album page's first 100 tracks). No schema or API version change. Test: `.tests/plugins/plugins.test.ts` v2 page case. PR-readiness: draft.

The plugin's own menu consolidation (1.0.53: album menu from 13 actions to 7, library maintenance in the editor) needs no core change.

# v0.2 recording comparisons

The resource (work) page bridge gains optional, additive fields: per recording `performer`, `year`, `recordLabel`, `durationMs`, `parts` (each movement's length) and `releases` (every album the recording appears on); per item `movementIds`. Older plugins omit them and older cores drop them. `frontend/src/pages/PluginResourcePage.tsx` shows recordings side by side (scrolling sideways on a phone), compares the whole work or one movement, plays any recording, part or the whole comparison, and saves the comparison as the person's own playlist through a new generic route, `POST /api/plugins/:id/resources/:pageId/:resourceId/playlist` (`saveResourcePlaylist`, about 60 lines): core reads the page again as that person, accepts only items it shows, pins each to its exact Library file (`path`), never downloads, and queues the normal playlist creation for that person (`accessPlaylists` required). No schema, no classical rule in core. Test: `.tests/plugins/plugins.test.ts` resource-page case (exact path, owner, unknown item refused). PR-readiness: draft.

# v0.2 manual-search flag

Core's plugin download source passes `manual: true` to `downloadSource.searchAlbum` when the call comes from Manual Search (`pluginDownloadSource.ts`, a few lines; documented in `plugin-api.md`). Additive: older plugins ignore the field, and automatic searches are unchanged. The plugin offers ambiguous slskd candidates only then. Without it (stock), ambiguous candidates are simply never offered. Test: `.tests/plugins/plugin-download-source.test.ts` manual Search case. PR-readiness: draft.

# v0.2 search hook

Core adds one generic, opt-in capability: `"search": true` in a plugin manifest and a `search(input)` export (`backend/services/plugins/pluginSearch.ts`, about 150 lines; route `GET /api/plugins/search`; `frontend/src/pages/PluginSearchResults.tsx` and a few lines in `SearchResultsPage.tsx`). Each provider answers with typed sections, an optional best result and facets, bounded by schema (10 sections of 50 items, 12 facets of 50 options) and 3 seconds. Plugins send link descriptors (`resource`, `album`, `filter`), never URLs or markup; core builds every path. A failing provider shows a one-line "Couldn’t load" notice and never blocks the rest of search. The capability can be turned off per plugin; with it off, or on stock Aurral, the search page is unchanged. No database, no API version change, no classical rule in core. Test: `.tests/plugins/plugins.test.ts` "search providers answer the search page…". PR-readiness: draft. The plugin's fallback without the hook is the editor's Search tab (admins). See `SEARCH.md`.

# Large album presentations

Core bounds album-presentation groups and their items by album size (5,000) and the response by 5 MB instead of 200 groups, 500 items and 512 KB, so box sets keep their work view. The album is read once per response and tracks are checked through an ID set. A contribution that fails now answers 502 instead of `null`, and the album page shows a retryable "Couldn't load works" above the track list. No schema, API version or classical rule in core.

# Album presentation detail line

Core adds one optional, generic field to album-presentation groups: `detail`, a short note shown under the block heading (trimmed, at most 200 characters). Older cores drop it; older plugins omit it. The plugin uses it to say a block of several tracks is not matched to a work. No API version change, schema or classical rule in core.

# Messy metadata matching

Plugin-only matching, classification and album-presentation changes (see `MESSY_MATCHING_REPORT.md`). No core code, API, hook, schema or upstream delta.

# Phase 4 delta

The core playback correction shares queue conversion between album and resource pages, keeps native track/album references and segment ranges on menu Play/Play next/Add to queue/radio, and retains full player titles. Other track-menu actions remain native. It adds no API or schema fields; all verified-identity guards, album revision scopes and Requiem grouping decisions remain plugin-owned.

The standalone-work presentation correction adds no core delta: plugin groups now report at least one part, including whole works without movement rows, and matched single-track works retain the existing work-view links.

Post-Phase-4 plugin-only work adds complete-index search guidance to recording attachment and begins conservative automatic work construction from explicit embedded metadata. Completed scans and an album action can create safe multi-movement realizations in plugin storage without media writes or provider requests. This adds no core code, API, database or UI hook beyond the already implemented Phase 4 contracts.

D04 album presentation and the bounded local portion of D05 are now implemented on the fork review source. D04 is opt-in and failure-safe: core validates native references and renders a generic work grouping; the plugin owns classification, work/realization identity, grouping, ordering and missing-item decisions. D05 adds optional queue segment boundaries to native entries, persistence, start/end enforcement and range-aware controls. Bounded entries are not exported through the existing range-unaware remote queue.

The Phase 3 page transport gains separately declared regular-user resource pages with trusted current-user context and validated data/actions. Core adds no classical schema or rules. Plugin schema 2 owns favourites and picks. See `PHASE_4_REPORT.md` for validation and limits.

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

# Phase 2 delta addendum

Phase 2 introduces **zero core runtime/schema/API/UI changes** beyond the Phase 1 baseline. Its entities, SQLite migration 1, metadata precedence, scan jobs, reconciliation and classification guards are entirely plugin-owned. Existing admin action descriptors expose bounded status/scan/cancel; the Phase 1 userOperations v1 capability supplies the scan snapshot. The host grant authenticates the initiating admin; no token is persisted in model jobs.

D06 remains a full in-memory snapshot without automatic installation/epoch/generation detection. Plugin-local scan generations and an explicit admin library-epoch setting are implemented; ambiguous evidence never reattaches silently. Synthetic 10,000-link measurements are in PHASE_2_REPORT.md; they do not benchmark the host query or media hashing. No pagination extension is justified/implemented by this phase. Full host-epoch consistency and library-scale read costs remain contract limitations.

D01/D04/D05 remain proposals. There is no editor/work/diagnostics page, album-grouping contribution or segment playback hook. Admin model diagnostics are available as an action response. All Phase 1 PR links/status below remain unchanged and unmerged. No upstream activity or PR-readiness change.

# Upstream Delta — Phase 1 implementation and later proposals

Current implementation: D02/D03 and the Phase 1 portions of D06/D07 are implemented in core PR36; plugin PR6 consumes them. See the Phase 1 implementation addendum at the end and PHASE_1_REPORT.md for files/tests/contract. The audit baseline and draft table below are historical planning; their no-implementation wording is superseded by that addendum. D01/D04/D05 remain proposals. No upstream PR exists.

Audit baseline: upstream `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`; fork `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee`; plugin `506e5259e1442b8cfe072a75b129abb428c6bcf7`.

**No classical core changes implemented or submitted. Phase 0.5 preserved existing features on 16 separate user-fork branches; no PRs. All new-hook PR-readiness is draft.** This is a proposal to be kept in the plugin repo only after approval; this copy is maintained on the existing aurral-classical branch. Existing fork changes are inventoried separately and are not new classical delta. Line estimates are planning ranges, not measured diffs; test code may add a comparable amount. Each hook must be generic, additive, opt-in, capability-negotiated and independently reviewable. None may introduce composer/work-specific core schema or silently change non-classical behavior.

| ID / single issue                                               | Need and proposed change                                                                                                                                                                                                                                                                 | Candidate core files / rough production LOC                                                                                                                                                                                                                                                                                             | DB / API / UI                                                                                                                                                                                         | Compatibility and missing-hook fallback                                                                                                                                                                                                                                    | Tests / readiness                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 — authenticated plugin views/resources                      | Required for editor, work page, diagnostics. Add versioned manifest descriptors, authenticated same-origin resource dispatch to plugin host and bundled-view mounting; no external service                                                                                               | `backend/services/plugins/{pluginManifest.ts,aurral-plugin.d.ts,pluginService.ts,pluginHost.ts}`, `backend/routes/plugins.ts`, frontend router and plugin view loader/navigation; new generic modules. ~300–700 LOC                                                                                                                     | No classical/core schema change expected; additive plugin API and UI                                                                                                                                  | Old API-1 plugins unchanged; strict schemas, asset path validation, CSP/session/CSRF, resource budgets. **Current stock/fork has no fallback editor/work page.** Back-end model only when absent; do not advertise full stock compliance                                   | Old/new plugin manifest; regular browse vs admin mutation; traversal/XSS/CSRF; plugin timeout/disable; phone-width view. Draft, required before Phase 3                                                         |
| D02 — scoped real-user plugin operations                        | Required for background user-owned playlists and correct authorization. Bind host-issued operation context to invoking user, plugin, resource, allowed action and expiry; recheck on execution                                                                                           | `backend/services/plugins/{pluginService.ts,pluginStore.ts,aurral-plugin.d.ts}`, new operation dispatcher/token store, existing `backend/middleware/auth.ts` integration, playlist operation handlers/queue. ~150–350 LOC                                                                                                               | Additive API. Prefer existing operation persistence; a generic core-owned capability-handle table may be needed if existing queue records cannot store binding safely; decision/test before migration | Keep legacy plugin admin key semantics for old plugins. Never accept untrusted ownerUserId or replace all auth with impersonation. Without hook, allow local browse/play where possible; disable plugin-created background user playlists rather than owning them as admin | Forged/replayed/expired context; revoked user; two-user isolation; queued restart/idempotency; acquisition vs local compare. Draft, Phase 1                                                                     |
| D03 — consistent verified local references on playlist mutation | Confirmed create/update inconsistency. Reuse core path-resolution/pinning for create, append and update; accept canonical native track/file refs, resolve atomically, fail explicit stale local refs without downloading                                                                 | `backend/routes/playlists/handlers/staticPlaylists.ts`, `backend/services/playlists/{playlistOperations.ts,playlistTracks.ts,playlistLibrary.ts}`, optional public ref resolver helper. ~80–200 LOC                                                                                                                                     | Additive request fields/normalization; preserve existing playlist storage where native jobs suffice; no metadata schema                                                                               | Creation already accepts indexed paths. Preserve descriptor-only old inputs. Do not build a redundant creation-only endpoint. Without hook, create-only indexed paths may work but cannot meet update/ref guarantees; hide unsafe operation                                | Create/update/append with different local files/no MBID; canonicalJobId preservation; mapped/read-only media; zero downloads; permission checks; repeated tracks. Draft, Phase 1                                |
| D04 — plugin album presentation contributions                   | Required for work grouping, toggle and display artist/title overlays without changing media tags. Add optional bounded plugin group/decoration payload, rendered by stock core components                                                                                                | `backend/services/plugins/{aurral-plugin.d.ts,pluginService.ts}`, `backend/routes/library/handlers/albums.ts` or matching album-read handler, `frontend/src/pages/album/AlbumPage.tsx`, track-list components and generic contributor renderer. ~150–350 LOC                                                                            | Optional API response/sidecar plus UI; no core DB changes                                                                                                                                             | Off by default; absent/timeout/invalid contribution yields original album API/UI. Stable native IDs/order/actions retained. Plugin computes all classification and grouping; core never parses classical titles. No stock grouping when absent                             | Mixed soundtrack/Bach, unsure, non-classical exact regressions, By Work/By Track, disc headings, disable/crash. Draft, before Phase 4                                                                           |
| D05 — bounded native queue items                                | Required for attacca/multi-work-track playback without queuing unrelated works. Native track/file ref plus optional start/end, queue persistence and existing player's range enforcement                                                                                                 | `frontend/src/utils/queueStorage.ts`, `frontend/src/components/{PlayerQueue.tsx,PlayerProgress.tsx}`, existing player context/audio controller and shared queue types; native-ref operation bridge from D01. ~180–400 LOC; locate exact player modules before implementation                                                            | Additive queue serialization; UI/player changes. Inspect any server queue persistence before declaring no DB change                                                                                   | Ordinary items behave exactly as before. No new player/engine/service. Existing saved queues migrate/default missing ranges to whole track. If absent, disable range-dependent play and clearly explain, never play wrong work                                             | Seek/end/next/repeat/pause, queue restore, autoplay, file duration changes, repeated segments, whole track, plugin disabled midqueue. Draft, before Phase 4                                                     |
| D06 — complete public library snapshot/evidence                 | Conditional: use current public library reads first; add only missing stable generation/continuation, file identity/evidence/placements needed for rescan reconciliation                                                                                                                 | `backend/routes/library/handlers/{tracks.ts,files.ts}` and library read handler, `backend/services/libraryQueryService.ts`, plugin types if context enrichment needed. ~50–150 LOC                                                                                                                                                      | Additive read API, no plugin writes to core; avoid new core DB columns unless unavailable identity is essential and separately approved                                                               | Available core track IDs and placements should be reused. Can poll full public API and read supported file metadata today, but partial snapshot must never mark deletion. Without consistent snapshot, keep old links and defer ambiguous/destructive reconciliation       | >page limit, concurrent rescan, interrupted cursor, duplicate paths/IDs, DB generation change, identity evidence. Draft conditional; Phase 1 evidence-contract spike decides scope                              |
| D07 — per-request acquisition identity override                 | Required when native slskd coexists: enabled sources are priority ordered and native queries are not intercepted by the plugin source. Add a generic validated per-request identity contribution before native/source selection, with scoped artist/aliases distinct from display credit | `backend/services/plugins/{aurral-plugin.d.ts,pluginDownloadSource.ts}`, `backend/services/downloadSourceService.ts`, `backend/services/download/sourcePipeline.ts`, `backend/services/downloadJobs/trackSearchQueries.ts`, `backend/services/slskdOrchestrator.ts`. ~60–150 LOC; finalize smallest shared preparation point in Phase 1 | Additive plugin request extension; no core classical schema or global artist rewrite                                                                                                                  | Return no opinion for non-classical. Without hook, only plugin-source correction can be guaranteed; test built-in fallback and document limitation. No provider-aware ranking inside core                                                                                  | Liszt/Trifonov with display artist composer, plugin result absent/failed, source priority, non-classical query unchanged, integrity/permission regressions. Draft; Phase 1 must cover native-source coexistence |

## Features deliberately kept in the plugin

Entities, SQL migrations and storage, Open Opus/MusicBrainz adapters, precedence/provenance/pins, aliases/catalogue normalization, classical classification and folder rules, naming/artist templates, grouping decisions and play plans, completeness, comparisons, manual metadata editor content, work-page content, favourite/pick state, jobs, caches, diagnostics content and optional file-tag writing. Existing low-level tag writers can be fixed in the plugin without a core tag-removal patch. The four bugs do not justify adding classical fields to core library tables.

## Generic hook boundaries and dependency order

D01 provides UI/resource transport and common capability negotiation. D02 provides authorization for deferred user mutations; view requests use normal session identity. D03 provides exact native playlist membership. D04 provides optional album presentation, which may reuse D01 transport but remains a separately negotiated contribution. D05 extends ordinary queue items rather than inventing plugin-specific streaming. D06 only fills proven public-read gaps; D07 fills the confirmed native-source identity gap; a plugin source adapter alone cannot intercept native slskd. Do not add D06 if existing public APIs solve the evidence requirement. D07 can be avoided only with a proven per-request routing solution that also preserves native non-classical behavior.

No new search-box hook in v0.1, no Discover hook, no full Library tab injector, no core composer/work schema, no file-tag write hook, no Subsonic-specific classical work, and no provider-specific core logic. v0.2 search/v0.3 Library tab/v0.4 Discover deltas belong in later versions of this document.

## Delta maintenance / diagnostics contract

Each implemented row must replace estimates with actual paths/line counts, implementation commit, minimum host commit/version, API/schema changes, migration identifier or explicit none, compatibility behavior, executable test result and status `draft/ready/submitted/merged`. Add link only when a PR actually exists. The admin diagnostics view mirrors these rows and negotiated availability, reports plugin/core/data-schema/contract versions and last job failures without secrets. No page exists today; diagnostics depends on D01.

Before any user-approved upstream PR, extract one hook into an upstream-based branch and test with both an old API-1 sample plugin and a generic non-classical consumer. No PR, branch or main merge is authorized by this draft.

# Phase 1 implementation addendum

Current source record: PHASE_1_REPORT.md. Core review target is the user's aurral-classical branch at externally advanced 1b3c1c00, containing upstream 021b1f03. Nothing was submitted upstream.

- D02 implemented: pluginUserOperations.ts, action input in pluginService.ts/types, opt-in localPlaylists manifest field, narrow grant route/authentication, existing persistent playlist queue and execution-time permission/expiry checks. No new table or migration. Real-user owner comes only from signed host grant; synthetic admin keys cannot substitute. Stable plugin/user/key UUID makes retries idempotent. Own job-status API confirms completion.
- D03 implemented: playlistTracks.ts preserves paths and exact local identities; playlistOperations.ts reuses indexed-file pinning on create/update/append and rejects stale explicit paths. Different native jobs/files with identical metadata stay distinct. No new creation-only endpoint or metadata columns.
- D06 Phase 1 bridge implemented in pluginUserOperations.ts: complete indexed owned-library snapshot and mapped readPath. It is a full in-memory read, with no cursor/generation/reconciliation or deletion inference. Phase 2 must measure larger libraries before choosing a pagination extension.
- D07 implemented: opt-in downloadSource.acquisitionIdentity manifest capability, pluginAcquisitionIdentity.ts validation/host call, and native Soulseek preparation in slskdOrchestrator.ts. Performer query identity is separate from display credit; persisted requiredTerms filter native candidates. Failure holds acquisition rather than silently reverting to composer identity. Non-classical no-op preserves normal queries. No classical/provider parsing in core.
- D01/D04/D05 remain unimplemented proposals. No views, editor, album-grouping or segment player was added in Phase 1.

The original design table below remains planning history; its draft/no-implementation wording is superseded only for the Phase 1 portions listed above. The full v0.1 native-reference/view contract is not claimed implemented.

## Phase 3 — D01 admin forms v1 implementation

D01's admin-editor subset is implemented and tested in the user's fork. Core production changes: `backend/services/plugins/pluginManifest.ts` (optional page declaration/capability), new `pluginPages.ts` (validated 15-second read/mutate dispatch and real-admin gate), `backend/routes/plugins.ts` (authenticated bounded same-origin routes), plugin type/reference docs, `frontend/src/pages/PluginPage.tsx`/CSS (host-rendered forms, dirty-state/revision handling), App lazy route and PluginsSection Settings links. Approximately 700 production lines plus docs/tests; exact review diff is authoritative.

Database: **no core or plugin schema migration**. API/UI: additive page listing and admin GET/POST page transport; ordinary manifests have zero pages. No composer/work/provider logic in core. Compatibility: plugin absence, disabled page, safe mode and old manifests leave native album/search/queue behavior intact. Unknown or unavailable pages return a bounded error. Stock hosts do not have an editor; existing plugin actions remain supported.

Tests: generic plugin/permission/output/size/origin tests; 2,755 core unit tests; required checks/builds; 168 plugin tests including 9 editor cases; real browser and synthetic Compose restart/media/streaming tests. No unsafe-any/type baseline increase. The companion plugin CI pins the exact source commit.

PR readiness: **draft, fork review source only**. No new PR or upstream submission. D01 still needs an ordinary-user read/page contract for Phase 4 work browsing. D04/D05 grouping and queue ranges remain proposals. The plugin owns all model/editor business behavior, provenance and data. See PHASE_3_REPORT.md for exact evidence and outstanding real-library/stock limitations.
