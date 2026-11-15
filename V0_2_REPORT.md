# Metadata editor UI, item 3 (November 14, 2026)

Item 2 is published: core `c38393bd4816e721bd4c838e59ad0403452f7153`; plugin implementation `8800d16` with paired-CI pin `6a41904` (1.0.55). The user requested push, then item 3.

Item 3 (plugin 1.0.56) separates work editing into Details, Movements, Credits, Recordings and Advanced using the existing editor API. Add and merge forms open on request; Cancel returns to their section, with host draft protection. Successful edits stay in the relevant section; added movements open their last page. Merge/delete remain confirmed/undoable as before, under Advanced. Plugin-owned section addresses survive reloads and use the existing work revision scope. No schema or matching changes.

The only item-3 core runtime change is two generic mobile CSS declarations: row actions take their own line and wrap, keeping labels readable for every plugin. Before/after screenshots caught and verified the fix. No classical-specific core code or new API. Validation and next actions: plugin `EDITOR_UI_HANDOFF.md`; item 3 is complete locally and unpushed. Validation: 336/336 full plugin tests, 38/38 focused editor tests, three real-renderer browser harnesses at desktop/phone widths, core checks (1089 unsafe-any, unchanged) and production build. Core CSS commit `c0cf7ab`; plugin bundle rebuilt. Full Compose/restart and remote CI not run for this step. Items 4–7 remain pending.

# Metadata editor UI, item 2 (November 14, 2026)

Local implementation for review, plugin 1.0.55. Album grouping now uses one paged track list: select tracks → choose an existing work or create one → map only those tracks → apply. Back retains the selection; Cancel leaves assignments unchanged. Not classical defaults to Skip; explicit moves remain atomic. Selection tokens bind the final request to the selected album tracks, in album order. Existing forms/rows/navigation API; no schema change.

Core boundary: all grouping, work/movement decisions, selection persistence and validation live in the plugin. The only item-2 core change keeps the generic bulk-action bar visible when rows are selected; any plugin list benefits. No classical names, branching or data model in core. Item 1's generic draft/navigation guards are published as core `365e6dc`, plugin `26be9ac`. Those guards belong to the host because it owns form resets, routing and unload events. An experimental scroll change was removed after testing did not justify it. Running validation and the ordered backlog are in `EDITOR_UI_HANDOFF.md`. Item 2 is not pushed; items 3–7 remain pending. Validation: standard full plugin suite 333/333, focused editor suite 35/35, actual-renderer assignment and draft browser regressions at desktop/phone widths, rebuilt bundle, core checks/build. Local core commit `c38393b`. Full Compose/restart not run for this step.

# Aurral Classical v0.2 — implementation report

Incremental editor UI improvements, November 14, 2026: see `EDITOR_UI_HANDOFF.md` for the user-authorized seven-item sequence and current validation. Item 1 protects drafts across cross-form saves, actions, conflict reload and navigation in the generic core renderer. This is local work after 1.0.54, with no plugin schema or bundle change; the remaining UI items are pending.

November 14, 2026. Authorized by the user ("Alright let's start in v0.2", with the v0.2 development scope). Implemented on `aurral-classical` in both repositories; nothing merged into `main`, nothing deployed, no production access. Plugin 1.0.48 → 1.0.53, schema 3 → 4; follow-up fixes in 1.0.54 (below), no schema change.

## v0.2 follow-up: editor workflow fixes (1.0.54)

November 14, 2026. After first use of v0.2 the user listed workflow problems in the editor. Each, with what changed:

| Asked | Change |
| --- | --- |
| Pagination for editor pages such as works | Long sections in an entry page 100 rows at a time with a pager (a composer's works and credits, a work's movements and recordings, a movement's tracks; selection `ID~page`). The browse list and album tracks already paged. |
| Page number kept after reloads and edits | Every album action carries its page (`album:ID~page`); a track's breadcrumb returns to its album page; links that open an entry send an empty offset and the plugin shows the list page holding it, so a reload lands there too. |
| Pager at the top too | Core renders pagers above and below the list and paged sections. |
| Merge: add a movement the other work lacks, then open it to reorder | The editor's merge maps movements by title (or number where one is untitled) and moves the rest, with their tracks, to the end of the kept work; the result opens the kept work at Movements (page of the first added) with a message naming them. Matching's own merges still need every movement to line up. Undo restores both works. |
| Merge the other work into this one | The merge form asks which one stays; the duplicate review offers both directions and previews both. A reverse merge also settles the pair's review. |
| Create a movement while assigning | "New movement" in the assign mapping adds one named after the track, at the end of the work. |
| Moving tracks between works | "Move to another work" (and "Assign to a work") on ticked tracks: choose the work, then each track's movement or New movement; the tracks leave their old work in the same step. The assign form also lists tracks already in another work ("Now in …"). |
| Does moving update the grouping, and when? | The catalogue changes at once. The album page's By work view was cached up to 30 seconds and kept while navigating; the core now refreshes it (and work pages) after each editor change. Editing a file's tags never moves a track already in a work: scans keep tracks where they are (see EDITOR_GUIDE). |
| Selecting something jumps to the top of the page | Results of commands other than `open` keep the scroll position (router state honoured by `Layout`); a result can name a section to scroll to (`focus`), used for the assign/move steps, a merge's movements and a section's next page. |
| Identity reviews vague | The queue says which question: a MusicBrainz work already linked to another entry, a match below 95% (with its certainty), a possible duplicate (of which work, and why), composers sharing a name. The review page shows the MusicBrainz link, certainty, what matched, the other entry (composers, recordings, side by side for works), what to do, and the fixes: merge either way, Link here instead, Link to this MusicBrainz work, Dismiss. |
| Compare recordings menu item creates no playlist; remove it | The track and album menu items are removed (`compare-album`, `compare-track`, `src/compare.js`); comparisons stay on the work page (Play comparison, Save as playlist). The integration smoke now saves the comparison from the work page, after the fixtures exist. The now-unused "Comparison scope" setting is left in place so saved settings don't change. |

Tests: plugin `test/editor-v0.2-workflow.test.js` (6: list locating, section pages, track crumb and kept album page, moving tracks with New movement, a new movement while assigning, merge either way adding movements with undo, identity review wording and Link here instead); `test/box-set.js` now holds the shared fixture; the removed menu action's tests go with it. Plugin suite 331 pass on Node 22.23. Core: `pnpm check` clean (any baseline 1089 unchanged), unit suite 2666 pass, frontend build, new host test for empty offset and `focus`. Not run here: the Compose/Chromium integration workflow (its smoke step changed; it needs a CI run) and the remote CI matrix.

## Before v0.2: branch sync

- Fork `main` merged upstream lklynet/aurral through #1889 on a sync branch and was fast-forwarded (`8e0bcb0`). Conflicts in `LibraryPage.tsx` and `libraryViewQuery.ts` (fork page sizes vs upstream's per-section sorting); favorites now load at the chosen page size. Perf baseline regenerated on the merged tree (fork deltas carried over).
- Core `aurral-classical` merged `main` (`2c43f44`; backup branch `aurral-classical-backup-2026-11-14`). One conflict in `AlbumPage.tsx` (work grouping vs upstream's "From other editions" rows).
- Plugin `main` is an unrelated, older history (1.0.4) that `aurral-classical` already supersedes; it was left alone.
- The integration workflow then failed twice in CI: the row-menu check took the first album group, and two works start on the same track with the same length, so their order fell to random IDs. The test now finds the bounded work's group (run 43624183170 passed).

## What v0.2 adds

| Scope | Where | Summary |
| --- | --- | --- |
| 1 Classical search | plugin `src/search/`, core `pluginSearch.ts`, `PluginSearchResults.tsx` | Plugin-owned index; catalogue-number keys; accents, partial words and transliteration; combined queries; typed, role-aware sections, works first; ten filters; no merged documents. On Aurral's search page for everyone (fork), and the editor's Search tab. 7–20 ms on 10,000 tracks. `SEARCH.md`. |
| 2 slskd | `src/slskd-ranking.js`, `src/source.js`, core manual flag | Five-step performer-first ladder stopping at a good complete folder; scored candidates with reasons; rejection of folders naming no performer; duplicates as fallbacks; ambiguous candidates only in Manual Search; last 25 searches in Activity. Download/validation/import unchanged. |
| 3 Comparisons | `src/model/presentation.js`, core `PluginResourcePage.tsx`, playlist route | One entry per recording across releases; performers by role, year, label, durations per movement, completeness; side by side; whole work or one movement; play any part or the comparison; save as the person's own playlist pinned to exact files. |
| 4.1 Performance | editor | Albums tab 482 → 57 ms, album open 466 → 70 ms, 640-track box set 800 → 260 rows (host limit 500); snapshot reads without a write lock. `scripts/editor-timing.mjs`. |
| 4.2/4.5 Navigation, album matching | editor, core admin pages v2 | One album workflow (works, Not in a work, In a work; 100 tracks a page); bulk ticks; the list keeps its place after actions. |
| 4.3 Review queue | editor | Next item opens after each decision; Skip; the entry's form in the review; bulk settle; counts update at once. |
| 4.4 Duplicates | editor, `auto-match.js` | Side by side with differences, merge preview, Merge / Keep both (remembered) / Dismiss; merges undoable. |
| 4.6 Bulk | editor | Classification, remove from work, review items, delete works, edit shared fields, use provider values; per-item savepoints report partial failures. |
| 4.7 Deletion | `src/model/history.js` | Delete works in use, alone or in bulk, impact stated first; tracks and files untouched; suppression keeps matching from recreating them without review; undo from Activity. |
| 5.1 Menus | manifest | Album menu 13 → 7 actions (+ track and artist); library maintenance moved to Activity → Maintenance; "Auto-match every album" removed (scans do it); tag-removal preview moved into the editor's album view. |
| 5.2 UI | core pages | Shared page title, one primary action per view, gated hover, tokens only; desktop and phone screenshots checked. |

## Core (fork) changes, all generic and optional

See `UPSTREAM_DELTA.md` (top four entries): plugin search providers; `manual: true` on Manual Search; resource-page comparison fields and the save-as-playlist route; admin pages v2 `select` and `pager`, and lists keeping their place after a mutation. No core schema change, no API version change. `pnpm check` stays at the 1089 unsafe-any baseline.

## Migration and rollback

- **Schema 4** (plugin `classical.sqlite`): `search_doc`, `search_term`, `search_key`, `search_facet`, `search_state` (derived; dropping them loses nothing), `change_set` (undo snapshots, bulk selections) and `match_suppression` (deleted works, works kept apart). Forward-only and transactional; the plugin backs the database up first (`model/backups/before-v4-*.sqlite`). v0.1 data is not rewritten.
- **Scan evidence** gains the `year` and `label` tags on the next scan; older evidence works without them.
- **Rollback** to 1.0.48: stop Aurral, restore `before-v4-*.sqlite` over `classical.sqlite` with the offline restore (`restoreDatabase(..., { offline: true })`, as in v0.1), reinstall plugin 1.0.48 and start the previous fork build. A 1.0.48 plugin refuses a schema-4 database ("newer than supported") rather than misreading it. Edits made after the upgrade are lost by a rollback; nothing in Aurral's own tables changes either way. File tags are not involved.
- **Core**: no migration. The previous fork build ignores the new manifest flag and fields.

## Tests and checks (local, this session)

- Plugin: 331 tests (Node 26.12), including the new `test/search.test.js` (acceptance queries, roles, dedupe, staleness, 10,000-track timing, editor tab, work page grouping), `test/editor-large.test.js` (640-track album, bulk, deletion/suppression/undo, bulk edit with a failure, review flow, maintenance), and additions to `source.test.js`, `editor-v2.test.js`, `model.test.js`.
- Core: `pnpm check` clean; plugin host tests (search providers, resource playlist, admin pages select/pager, manual-search flag); full unit suite run recorded in HANDOFF.md; frontend build.
- Integration (Compose-equivalent on the host, since Docker Hub was rate-limited here): fresh fixture, admin and two users' comparison/streaming smoke, the scan started from Maintenance, the full Chromium editor/work-view/row-menu workflow at desktop and phone widths, persistence and media hashes before and after a restart. A regular user each saved "Compare: sonata – 1" (six tracks, all pinned to their files).
- Not run here: the remote CI matrix on Node 22/24 for 1.0.53 (pushes trigger it), and any real-library dry run (the user's to run).

## Acceptance checklist

Search and acquisition: names and catalogue formats resolve to one work ✔; filters distinguish roles ✔; under 300 ms on 10,000 tracks ✔; slskd prioritizes performers and complete releases ✔; download/import workflows unchanged (existing tests) ✔.
Comparisons: all owned recordings across releases ✔; duplicate releases are one recording ✔; full-work and movement comparisons ✔; playlists play for all authorized users ✔ (saved per user, exact files; queue playback as before).
Editor: large datasets ✔; albums over 500 tracks ✔; long lists searchable and paged ✔; reviews editable in place ✔; next item opens ✔; duplicates side by side ✔; merges keep relationships and undo ✔; bulk applies only to ticked rows ✔; deletion leaves audio alone ✔; one album workflow ✔.
UI and regression: menus without redundant actions ✔; UI Bible (shared title, one primary, tokens) ✔ for pages touched; desktop and phone ✔ (screenshots); v0.1 features and non-classical behavior (existing suites) ✔; no production data involved ✔.

## Open items and limits

- Search results page sizes: a focused section shows up to 50; deeper paging of a single section is not offered.
- Comparison playlists hold whole tracks: a movement that is one segment of a longer track plays the whole track from a playlist (the queue plays the segment).
- "Same recording" without MusicBrainz IDs relies on performers and lengths; near-identical re-releases with re-edited lengths stay separate (by design, never merged on names alone).
- Ambiguity review for slskd relies on Aurral's Manual Search; on stock Aurral, ambiguous candidates are simply not offered.
- The review queue's "next" follows the list order (newest first); a filtered list's order is not carried into the next item.
- Real-library validation (search quality, slskd ranking on live peers, 600+ track box sets) is for the user's own dry run.
