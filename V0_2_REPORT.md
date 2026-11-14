# Aurral Classical v0.2 — implementation report

November 14, 2026. Authorized by the user ("Alright let's start in v0.2", with the v0.2 development scope). Implemented on `aurral-classical` in both repositories; nothing merged into `main`, nothing deployed, no production access. Plugin 1.0.48 → 1.0.53, schema 3 → 4.

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
