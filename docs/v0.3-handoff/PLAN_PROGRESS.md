# Aurral Classical v0.3 — implementation plan

Status: complete draft for review. Read-only work; nothing was committed or edited in either repo.

Checked against plugin `762ee5c` and core `4ef6932`. The remote `aurral-classical` heads are the same commits, so **no review batch has landed**. The request's "[list the ones done]" was left unfilled; this plan therefore treats every finding in REVIEW_PROGRESS.md as open and puts the ones v0.3 depends on into Phase 0.

Not read for this plan: core's `AlbumPage.tsx` track menus and the player component in detail, core's playlist storage internals, `source.js`. Tasks that touch them are marked "confirm in code first".

## What the code gives v0.3 today

- **Entities:** `person`, `ensemble`, `work`, `movement`, `collection`, `performance`, `recording`, `release` (`src/model/schema.js`). `release` is never created; an album is core's album id on the track evidence.
- **Credits:** `credit(target, contributor, role, instrument, position, assertion_id)` with roles in `CREDIT_ROLES` (`catalogue.js:15`). Matching writes composer credits only. Performer credits exist only where an admin added them on a performance.
- **Performers without credits** are tag strings: `ownedRecordings` (`src/search/engine.js:103`) splits `hints.artist` and the search index stores them as facet values `name:<folded name>`, not as entities. There is no performer page target for them.
- **Recordings:** one `performance` + `realization` per album and work. The same performance on two albums is recognised at read time by `sameRecording` / `groupRecordings` (`engine.js:175-200`), not stored.
- **Pages:** core's resource page is one fixed schema and one React page for a work (`pluginPresentation.ts` `workView`, `PluginResourcePage.tsx`). The manifest allows 10 pages; the plugin uses `editor` and `work`.
- **Search:** sections work, recording, composer, performer, release, movement; facets composer, performer, conductor, ensemble, period, form, instrument, type, year, owned (`engine.js:12-31`). No sort options.
- **Tags:** `src/tags.js` reads title, artist, album artist, album, composer, WORK, grouping, work id, MusicBrainz ids, track and disc numbers. It writes title, artist, albumArtist, composer, work, workId, recordingMbid, to a copy that is verified and renamed into place. `src/tagger.js` keeps first-seen originals in `originals.json`.
- **Ranges:** the model stores start/end per segment and core plays them correctly (review follow-up 5), but no editor action creates a range.

## 1. Scope check

| # | Requirement | Problem | Resolution |
|---|---|---|---|
| S1 | "Assume review batches … have landed" | None has. | Phase 0 lists the findings v0.3 cannot ship without. |
| S2 | §3 performer, conductor, ensemble pages; §4 "map existing credits to contributor records" | Performers are tag strings, not records. | Phase 1 creates contributor records and derived credits from tags, with provenance, before any page uses them. |
| S3 | §3 "distinguish soloist, accompanist, chamber musician" | Tags rarely say. Only a conductor tag, per-role performer tags and manual edits do. | Read those tags where present; otherwise the role is the generic "performer". Add "accompanist" to `CREDIT_ROLES`; treat "chamber musician" as "performer" on a work whose form is chamber. Never guess a role from a name, except ensembles by the existing `ENSEMBLE` word list in `credits.js`. |
| S4 | §2 composer period, biography; §3 biography; §9 Open Opus | No provider data is stored today: `Metadata.refresh` has no caller and there is no Open Opus client. | Phase 7: an admin-started, once-per-entry MusicBrainz enrichment job (dates, sort name, aliases, type). Biography is manual text only (`description`). Open Opus: **needs Collin's decision** (D3). |
| S5 | §5 "parent works, collections, and related works" | Collections exist; `work_relation` is defined in `catalogue.js` but nothing writes it. | Show collections and their sibling works. Add "related work" as a manual editor link only. No automatic relations in v0.3. |
| S6 | §6 "recording date, location" | No field for location; date exists only on broadcasts. | Add `location` to `field_definition`; date and location are manual or provider values on the performance. Shown only when present. |
| S7 | §6 "distinguish a performance from a release and an audio track" | A stored "recording" identity across releases does not exist; grouping is recomputed per read. | Keep the performance as the page's identity. Make reissue grouping stable by storing it: a `same_recording` link between performances, written by a scan pass with the existing `sameRecording` rule and editable by an admin. |
| S8 | §6, §7 "preserve playback boundaries for tracks containing multiple movements" | Boundaries can only exist if someone enters them; nothing can. | Add a small "Movement boundaries" form on the recording's editor page (start time per movement). Without boundaries, a combined track plays whole and is labelled with all its movements, as today. **Needs Collin's decision** (D5). |
| S9 | §7 "fix comparison playlists playing entire files" | Core playlists store files, not ranges (`saveResourcePlaylist`, `pluginPresentation.ts`). | Two options in D4. Recommended: plugin-owned saved comparisons that replay through the queue with ranges; core playlists stay whole-file. |
| S10 | §6 "Favorite" on a recording | Only works have a per-user favourite (`user_work_state`). | Add `user_recording_state`. Core track favourites are not touched. |
| S11 | §8 "never write automatically" vs the existing background tagger | With `enableFileWrites` on, `tagger.js` writes after downloads and on a schedule. B12 is also still open (album-menu actions write at once). | The v0.3 writer is a separate, preview-only path with its own setting. For the legacy tagger see D6; recommended: gate its album actions behind the same preview and leave background tagging as its own explicit setting. |
| S12 | §8 album, album artist, title | Review follow-up 1: a title retag gives a new core track id, an album retag a new core album id. Core play counts and favourites follow the core row. | Do not offer title, album or album artist in v0.3 writes by default (D7). Composer, work, movement, performers, conductor, catalogue and ids do not change core ids. |
| S13 | §8 "other formats only after confirming safe support" | During the review `writeTags` refused an artist value containing ";" on `.m4a`. | Ship FLAC first. Each further format is enabled only by a passing round-trip test file in `test/tagger.test.js`. |
| S14 | §1 "Classical section within Aurral's Library"; §7 links in track menus, search, player | Core has no generic hook for a Library entry, a generic page, or links on tracks. | Phase 3 adds four generic hooks (see §4). |
| S15 | §10 "under one second on a 10,000-track library under the defined test conditions" | No conditions are defined. | Define: plugin `pages.read` time, warm database, synthetic 10,000-track catalogue built by a new fixture script, on the CI runner; first page of each list and each page type. Collin to confirm (D8). |
| S16 | §10 "500-row view limit" | Core's admin rows cap is 500, list items 100; the work page caps movements at 200 (finding C1). | Every list in the new view is paged at 100; C1 lands in Phase 0. |
| S17 | §4 "merge duplicate identities with preview and undo" | Person merge has neither a recorded undo nor aliases (findings L2, E11). | Phase 0 (L2) and Phase 2. |
| S18 | §9 "do not silently merge ambiguous contributors" | Today `mergeDuplicateComposers` merges same-named auto-made people on every match pass (`auto-match.js:2221`). | Keep it for composers only, as now; never apply it to performers. Same name with different MusicBrainz ids always stays apart and raises a review. |

## 2. Phases

Each phase ships on its own with its tests green and the previous behaviour intact.

| Phase | Goal | Depends on |
|---|---|---|
| 0 | Review fixes v0.3 stands on | – |
| 1 | Contributor identity in the model: schema 5, tag evidence, derived performer credits | 0 |
| 2 | Contributor and credit editor, merge with undo, review items | 1 |
| 3 | Core hooks: generic resource view, Library entry, links, query pass-through | – (parallel with 1–2) |
| 4 | Classical Library lists and composer pages | 1, 3 |
| 5 | Performer, conductor and ensemble pages | 2, 4 |
| 6 | Work page 2, recording pages, navigation and playback | 3, 5 |
| 7 | Provider enrichment (admin-started) | 1 |
| 8 | Tag writing with preview, backup and restore | 0 (L10), 2 |
| 9 | Performance, migration and rollback tests, docs | all |

### Phase 0 — review fixes first
- **Must land before Phase 1:** L2 + E2 (composer aliases; Phase 1 extends the same mechanism to performers), E1 and L3 (automation overriding manual placement), E10 and E7 (undo), L11 then L10 (scan identity; tag writing depends on it).
- **Must land before Phase 4:** C1 (core drops unplayable items instead of failing the page), L1 and Batch B (L6, L7, L8, L13) because work and recording pages show movement mapping to every user.
- **Constraints carried, not fixed here:** L4, L5, L9 (matching gaps: pages show what matched), E3, E4, E5, U1–U5, L12, L14–L18. E6/B12 is decided in D6.

### Phase 1 — contributor identity
- Schema 5 (see §3). Read conductor and per-role performer tags and artist ids into scan evidence. Create contributor records and derived performer credits on performances. Generalise the L2 alias lookup to all contributors. Store reissue links.
- Fixes or depends on: L2, L12 (same-name handling is reused), L10/L11.

### Phase 2 — contributor and credit editor
- Performers, Conductors, Ensembles lists; credit editing on a recording; role and instrument; ensemble membership; bulk assign and correct; "unresolved names" mapping; merge and delete with preview and undo; two review kinds.
- Fixes: E11, E9 (reorder undo is optional here), E8. Depends on E7.

### Phase 3 — core hooks
- Generic resource view 2, Library entry, links on items, query pass-through, track links. All optional and feature-detected.

### Phase 4 — Library and composer pages
- Classical home, six lists with search, sort, filters and paging from the search index; composer page.

### Phase 5 — performer, conductor, ensemble pages
- One contributor page with role sections; collaborations.

### Phase 6 — work page 2, recording page, navigation, playback
- Work page on the generic view with paging; recording page; Go to links on album rows, search results, track menus and player; saved comparisons with ranges; movement boundaries form if D5 is yes.

### Phase 7 — provider enrichment
- Admin-started MusicBrainz job for people, ensembles and works through `Metadata.refresh`; cached and paced by `src/mb.js`; pages work without it.

### Phase 8 — tag writing
- Setting off by default; proposed-versus-current preview; per-file backup; verified write; report; restore. FLAC first.

### Phase 9 — hardening
- 10,000-track fixture and timing test, migration and rollback test, restart-persistence checks, documentation (`UPSTREAM_DELTA.md`, `FORK_FEATURE_INVENTORY.md`, `EDITOR_GUIDE.md`, `HANDOFF.md`, a `V0_3_REPORT.md`).

## 3. Model and schema changes (schema 5)

One migration, version 5, in `src/model/schema.js`; `SCHEMA_VERSION = 5` in `database.js`. `openDatabase` already backs up to `backups/before-v5-*.sqlite` and runs each migration in one transaction.

| Change | SQL / code | Why |
|---|---|---|
| Credit provenance | `ALTER TABLE credit ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'` (values `manual`, `derived`, `provider`, checked in `Catalogue.credit`); `ALTER TABLE credit ADD COLUMN state TEXT NOT NULL DEFAULT 'active'` (`active`, `removed`) | Derived credits can be refreshed by scans; a derived credit an admin removed stays removed; manual credits are never touched by automation. |
| Credit lookups | `CREATE INDEX credit_contributor ON credit(contributor_id)`; `CREATE INDEX credit_target ON credit(target_id)` | Contributor pages and merges read by contributor; today only the unique index on target exists. |
| New fields | `INSERT INTO field_definition VALUES ('sortName','string'),('location','string'),('instruments','array'),('recordingDate','string')` | Sort name for lists and tags; location and date on a performance; a performer's instruments. Biography uses the existing `description`. |
| Per-user recording state | `CREATE TABLE user_recording_state(user_id INTEGER NOT NULL CHECK(user_id>0), performance_id TEXT NOT NULL REFERENCES entity(id), favourite INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,performance_id))` | Favourite on a recording page (S10). |
| Saved comparisons (if D4 = plugin) | `CREATE TABLE saved_queue(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, work_id TEXT REFERENCES entity(id), items TEXT NOT NULL CHECK(json_valid(items)), created_at INTEGER NOT NULL)`; items are realization-item ids | Replays with ranges (S9). |
| Tag backups | `CREATE TABLE tag_backup(id TEXT PRIMARY KEY, track_link_id TEXT NOT NULL REFERENCES track_link(id), path TEXT NOT NULL, fingerprint TEXT, tags TEXT NOT NULL CHECK(json_valid(tags)), written TEXT NOT NULL CHECK(json_valid(written)), run_id TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL, restored_at INTEGER)`; index on `track_link_id` | Original values of every field a run changed, per file, in the database that is already backed up. |
| Search sort keys | Add `sort_title TEXT NOT NULL DEFAULT ''`, `sort_key TEXT NOT NULL DEFAULT ''`, `sort_date TEXT NOT NULL DEFAULT ''` to `search_doc`; index `(kind, sort_title)` | Sorting lists by title, catalogue number and date without reading every document. The table is derived, so the migration may drop and recreate it. |

No schema change needed for:
- **Roles:** `CREDIT_ROLES` is checked in code. Add `accompanist`. Keep `PERSON_ROLES` / `ENSEMBLE_ROLES` rules.
- **Instruments on a credit:** the `instrument` column exists.
- **Ensemble membership and reissue links:** `relation.kind` has no SQL check. Add `member_of` (person → ensemble) and `same_recording` (performance → performance) to the `relations` map in `catalogue.js`.
- **Aliases:** the `alias` table exists and is unused; L2 starts writing it.
- **Release:** stays core's album id. Do not start creating `release` entities in v0.3.

Backfill (runs once in the first library pass after the migration, inside the scan's transaction, recorded by a marker job like `album-identify-baseline`):
1. For every performance without a performer credit, derive credits from its tracks' evidence (Phase 1 task 1.4).
2. Write `same_recording` links with the current `sameRecording` rule.
3. Rebuild the search index.

Rollback: restore `before-v5-*.sqlite` offline with `restoreDatabase` and install the previous plugin build, as V0_2_REPORT.md describes for schema 4. Everything added is additive; nothing existing is rewritten by the migration itself. The backfill only inserts `derived` credits and `same_recording` relations, so `DELETE FROM credit WHERE source='derived'` and deleting those relations returns to the pre-backfill state without a restore. Phase 9 tests both paths.

## 4. Plugin and core split

Plugin owns: every table above, tag evidence, contributor rules, page data, editor workflows, tag planning and writing, saved comparisons.

Core gets five generic hooks. Each is optional, announced through `capabilities`, and adds one `UPSTREAM_DELTA.md` entry.

| Hook | Core change | Detection and fallback | UPSTREAM_DELTA entry |
|---|---|---|---|
| H1 Generic resource view | `pluginPresentation.ts`: accept `{version:2,…}` beside `workView`; schema of bounded sections: `header` (title, subtitle, facts, badges, actions), `rows` (label, detail, link, badge), `groups` (heading + rows), `tracks` (the existing `queueItem` shape, so ranges and `playableItems` checks are reused), `details`, `pager`, `tabs`, `filters`, `sort`, `empty`. New `frontend/src/pages/PluginResourceView.tsx`; `PluginResourcePage.tsx` picks the renderer by `version`. | Core sends `capabilities.resourceView: 2`. Without it the plugin serves only the existing work page and keeps search links as filters. | "Plugin resource view 2: generic read-only pages with playable rows" |
| H2 Query pass-through | `routes/plugins.ts` resource route forwards `q`, `sort`, `filters`, `page`, `tab` (validated like `pluginPageQuery`) as `input.query`. | Part of `resourceView: 2`. | same entry |
| H3 Library entry | `pluginManifest.ts`: optional `library: { pageId, resourceId, label }`; `LibraryPage.tsx` navigation shows one entry per enabled plugin that declares it (confirm the navigation list in code first). | Capability switch `library` in the plugin's settings card, like `albumPresentation`. Without it the pages are reached from search and album pages. | "Plugin Library entry" |
| H4 Links on items | `queueItem`, album presentation groups and search items accept `links: [{label, link}]` (max 6), link types `resource`, `album`, `filter`. `AlbumPage.tsx` row menu, `PluginSearchResults.tsx` and the queue entry (`pluginQueueTrack`) carry them; the player shows them for the current entry. | Unknown fields are ignored by older cores because valibot objects strip them; the plugin sends links only when `capabilities.itemLinks` is set. | "Plugin item links" |
| H5 Track links | `GET /plugins/track-links?trackIds=…` calls an optional plugin hook `trackLinks` and returns links per track id, for track menus and the player when the track was queued from an ordinary page. Cached per track id on the client. | Manifest flag `trackLinks: true`; absent means no extra menu items. | "Plugin track links" |
| H6 Resource mutations | `mutationSchema` gains `favourite-item` (target id) and `save-queue` / `delete-queue`. | With `resourceView: 2`. | same entry as H1 |

If D4 is "core playlists with ranges" instead, that is a sixth, larger change (optional start and end on static playlist tracks and on queues built from playlists); see D4.

Per phase: Phases 1, 2, 7, 8 are plugin only. Phase 3 is core only. Phases 4–6 are plugin page data plus small core additions already covered by H1–H6. Tag writing needs no core change.

## 5. Task lists

Sizes: S under half a day, M about a day, L several days. Tests named are files to extend unless marked new.

### Phase 0
Take the fix plans from REVIEW_PROGRESS.md as written, in this order: L2, E2, E1, L3, E10, E7, L11, L10, C1, L1, Batch B (apply `variations-prototype.patch`, add its cases, change the corpus scorer, re-save the baseline). Each has its test named there.

### Phase 1 — contributor identity (plugin)
| # | Task | Files / functions | Invariants | Tests | Size |
|---|---|---|---|---|---|
| 1.1 | Migration 5 | `schema.js`, `database.js` `SCHEMA_VERSION` | Additive; backup before; contiguous version | `test/model.test.js`: migrate a schema-4 file with data, counts unchanged, new columns default; restore the backup and open with the old build | M |
| 1.2 | Credit provenance in the API | `catalogue.js` `credit()` takes `source`; new `removeCredit()` sets `state='removed'` for derived credits and deletes manual ones; every reader filters `state='active'` (`editor-v2.js` `credits`, `presentation.js` `credits`, `engine.js` `ownedRecordings`, `buildDocuments`, `history.js` snapshot keeps both columns) | Existing credits read as manual | `test/model.test.js`, `test/editor-v2.test.js` | M |
| 1.3 | More tag evidence | `tags.js` `readTags`: conductor (`tag.conductor`), Vorbis `PERFORMER` values, artist ids already read; `runtime.js` `scanFile` puts `conductor`, `performers`, `artistMbids` into `hints` "only when set", as `grouping` is | Files without them keep their stored evidence byte-for-byte, so rescans stay idempotent | `test/tagger.test.js` (read), `test/sync.test.js` (no new evidence rows on rescan) | S |
| 1.4 | Derive performer credits | New `src/model/contributors.js`: `performerNames(hints)` (move the split from `engine.js:129-134` and `presentation.js` `performerOf` here), `contributorFor(c, index, name, {mbid, kind})`, `deriveCredits(c, {albumId})`. Kind: ensemble when `credits.js` `ENSEMBLE` matches, else person. Role: `conductor` from the conductor tag, `orchestra`/`choir`/`ensemble` by word, else `performer`. Called at the end of `autoMatchTaggedWorks` for performances with no active or removed performer credit | Never touches manual credits; never re-adds a removed derived credit; a performance whose tracks disagree gets the names all tracks share | New `test/contributors.test.js`; `test/corpus-apple.test.js` unaffected | L |
| 1.5 | Identity rule for all contributors | Extend L2's alias index in `catalogueIndex` to every person and ensemble; `contributorFor` reuses one record per exact folded name or alias; an artist id from tags wins; same name with a different id creates a separate record and a `contributor_identity` review | No fuzzy matching; composers and performers of the same name and no conflicting id are one person | `test/contributors.test.js`: Rachmaninoff as composer and pianist is one person; two "John Williams" with different ids stay two | M |
| 1.6 | Reissue links | `contributors.js` or `engine.js`: after matching, write `same_recording` relations from `groupRecordings`; `groupRecordings` then reads stored links first | An admin-removed link is not re-added (audit check as `unassignedByAdmin` does) | `test/search.test.js` | M |
| 1.7 | Search index follows | `engine.js`: performer facets use contributor ids (drop `name:` values once credits exist), add `role` and `instrument` facets from credits, fill `sort_*`; bump the index stamp | Search results for existing queries unchanged except performer links now resolve | `test/search.test.js` | M |

### Phase 2 — contributor editor (plugin, editor v2)
| # | Task | Files / functions | Invariants | Tests | Size |
|---|---|---|---|---|---|
| 2.1 | Lists | `editor-v2.js` `listFor`: Performers tab gains a role filter (performer, conductor, ensemble) and an "Unreviewed" filter for contributors made by 1.4 with no manual edit | Paged at 100 | `test/editor-v2.test.js`; `dev/editor-list-places-browser.mjs` | S |
| 2.2 | Credits on a recording | `recordingView`: credits section with add (lookup), change role, instrument, remove; commands `add-credit`, `update-credit`, `remove-credit` write `source='manual'`; removing a derived credit calls `removeCredit` | Scope check in `checkRevision` covers the performance; only that performance changes | `test/editor-v2.test.js`; rescan keeps the edit | M |
| 2.3 | Contributor details | `detailsForm` fields for person and ensemble: name, sort name, other spellings (writes `alias`), instruments, dates, notes; ensemble members (`member_of`) | Renaming keeps the old name as an alias (L2) | `test/editor-v2.test.js` | M |
| 2.4 | Bulk assign and correct | Album page select action "Set performers…" (reuses `rememberAlbumTracks`), contributor page action "Change role on all credits…" with a preview list; each performance in its own savepoint as `bulk-edit` does | A failure on one performance leaves the others applied and is reported | `test/editor-v2.test.js`; new `dev/editor-credits-browser.mjs` | L |
| 2.5 | Map a name | Contributor page for an unreviewed contributor: "This is…" lookup merges into the chosen record and keeps the tag spelling as an alias | Next scan of another album with that spelling lands on the chosen record | `test/contributors.test.js` | S |
| 2.6 | Merge and delete with undo | `history.js`: `contributorClosure` (credits, aliases, identities, relations, assertions, entity) and `recordChange` kinds `merge-person`, `delete-person`; `mergeContributor` runs inside it; `mergeView` preview already exists; `undoChange` un-deletes credited people (E11) | Undo refuses when a credit of either record changed later | `test/editor-v2.test.js`: merge, undo, exact restore; merge, rescan, still merged | M |
| 2.7 | Review items | `contributor_identity` (same name, different ids; a tag name that fits two records) and `credit_conflict` (tags now name a different conductor than a manual credit). `reviewView` Decide rows: Merge…, Keep separate (stores `distinctKey`), Use this record | Dismiss is remembered (E3's rule) | `test/editor-v2.test.js` | M |

### Phase 3 — core hooks
| # | Task | Files | Tests | Size |
|---|---|---|---|---|
| 3.1 | View 2 schema and hydration | `backend/services/plugins/pluginPresentation.ts` (new `resourceView2` schema, `hydrate` reusing `playableItems`), `routes/plugins.ts` | Core unit test with a sample view; an item for an unknown track is dropped (C1) | M |
| 3.2 | Renderer | New `frontend/src/pages/PluginResourceView.tsx` + CSS using the design-system tokens; play, play next, add to queue on `tracks` sections through `pluginQueueTrack`; pager, tabs, filters, sort update the URL query; scroll and place kept by the router as on Library pages | Frontend unit test; `pnpm run lint:ui`; new plugin browser check `dev/classical-pages-browser.mjs` built like `dev/editor-drafts-browser.mjs` | L |
| 3.3 | Library entry | `pluginManifest.ts`, `LibraryPage.tsx` navigation, capability switch | Core unit test; browser check | S |
| 3.4 | Item links | Schemas, `AlbumPage.tsx` row menu, `PluginSearchResults.tsx`, `pluginQueue.ts`, player | Browser check: link opens the page, queue keeps playing | M |
| 3.5 | Track links | New route and hook, client cache | Core unit test | M |
| 3.6 | Docs | `plugin-api.md`, `aurral-plugin.d.ts`, plugin `UPSTREAM_DELTA.md`, `FORK_FEATURE_INVENTORY.md` | – | S |

Invariants for all: no classical words in core; every hook off unless the plugin declares it and the admin's capability switch is on; `pnpm check` stays at zero type errors and the unsafe-any baseline.

### Phase 4 — Library and composer pages (plugin)
| # | Task | Files / functions | Tests | Size |
|---|---|---|---|---|
| 4.1 | Page plumbing | `manifest.json`: page `classical` (not admin), `library` entry; `src/index.js` `pages.read` routes resource ids `home`, `list:<kind>`, `composer:<id>`, `person:<id>`, `ensemble:<id>`, `work:<id>`, `recording:<id>`; new `src/model/pages.js` | `test/manifest.test.js`; old `work` page still answers | M |
| 4.2 | Lists | `pages.js` `listView(kind, query)` on `searchCatalogue` with `kinds`, filters and a new `sort` option (`engine.js`); kinds composer, work, performer, conductor, ensemble, recording | `test/search.test.js` sort and paging; 100 rows a page | M |
| 4.3 | Home | Counts and entry rows per list; recently added works from `track_link.created_at` | `test/pages.test.js` (new) | S |
| 4.4 | Composer page | Header (name, other names, dates, period, notes when present); works grouped by form, with catalogue number, recording count; sort by title, catalogue number, date, form; links to works and to performers who recorded them | `test/pages.test.js`; composer without a MusicBrainz id | M |
| 4.5 | Search links | `search/provider.js` `linkFor`: composer and performer items link to their pages when `capabilities.resourceView >= 2`, else filters as now | `test/search.test.js` | S |

### Phase 5 — contributor pages (plugin)
| # | Task | Notes | Tests | Size |
|---|---|---|---|---|
| 5.1 | Contributor page | One `contributorPage(id)`: sections per role actually credited (as soloist or performer, as conductor, as composer link); recordings grouped by composer then work; paged | `test/pages.test.js`: a pianist who also conducts shows two sections and one identity | M |
| 5.2 | Collaborations | Conductors, ensembles and soloists sharing performances, counted from credits | same | S |
| 5.3 | Ensemble page | Same page for `ensemble`; members from `member_of` when set | same | S |

### Phase 6 — work page 2, recording page, navigation, playback
| # | Task | Notes | Tests | Size |
|---|---|---|---|---|
| 6.1 | Work page on view 2 | `pages.js` `workPage`: facts, movements (paged), collections and siblings, recordings grouped by performance with completeness badge (complete, movements, excerpt), paged; keeps pick and favourite | `test/pages.test.js`; `test/editor-large.test.js` style case with 600 movements | L |
| 6.2 | Recording page | `recordingPage(performanceId)`: work, credits by role, date, location, label, year, movements with durations as a `tracks` section, releases from `same_recording`, favourite | `test/pages.test.js`: broadcast, excerpt, two releases | M |
| 6.3 | Links everywhere | `presentation.js` `queueItem` and album groups add `links` (work, recording, composer, performers); `trackLinks` hook in `src/index.js` | `dev/classical-pages-browser.mjs`: Go to Work from an album row and from the player | M |
| 6.4 | Player titles | Verify `pluginQueueTrack` title rule ("Work: movement") for items queued from the new pages | Browser check | S |
| 6.5 | Saved comparisons (D4) | `saved_queue` rows, `save-queue` mutation, "Saved comparisons" section on the work page that queues items with ranges | `test/pages.test.js`; browser: a saved two-movement comparison plays only those ranges | M |
| 6.6 | Movement boundaries (D5) | Editor recording page form: start time per movement for a track holding several; writes range segments, replacing the whole-track segment; validation against file duration | `test/editor-v2.test.js`; album view and queue agree (reuse `probes/f9.mjs` logic) | M |

### Phase 7 — enrichment (plugin)
| # | Task | Notes | Tests | Size |
|---|---|---|---|---|
| 7.1 | Job | New job type in `runtime.js` beside `runEnglishNames`: for each person, ensemble or work with a MusicBrainz id and no stored provider record, one lookup through `src/mb.js`; admin-started from Maintenance; resumable | `test/background-matching.test.js` with `fakeFetch` | M |
| 7.2 | Store as provider values | `Metadata.refresh(target,'musicbrainz',id,{sortName,date,aliases,…})`; manual values and blanks stay pinned (`manual` already pins) | `test/model.test.js`: manual value survives a refresh | S |
| 7.3 | Show provenance | Pages read `field_resolution` only; editor already shows source and pin | – | S |

### Phase 8 — tag writing (plugin)
| # | Task | Notes | Tests | Size |
|---|---|---|---|---|
| 8.1 | Proposed tags | New `src/model/tag-plan.js` `proposedTags(c, trackLinkId)`: composer, composer sort, work, movement name, number and total, performers with roles, conductor, ensemble, catalogue numbers, MusicBrainz ids, from resolved values and active credits. Tracks not classical or not in a work propose nothing | `test/tag-plan.test.js` (new) | M |
| 8.2 | Field writers | `tags.js` `WRITERS`: `composerSort`, `movementName`, `movementNumber`, `movementTotal`, `conductor`, `performers`, `catalogue`, with Picard names; enabled per format by a table | `test/tagger.test.js`: round trip per field on FLAC; multi-value survives | M |
| 8.3 | Preview | Editor command `tag-preview-open` (track, album, work or ticked rows; stored selection as `rememberAlbumTracks`) and a view listing per file each field's current and proposed value, unreadable or read-only files, and unsupported formats | `test/editor-v2.test.js`; browser check | M |
| 8.4 | Write | Command `tag-write` needs the preview token, `confirm:true`, admin, and setting `enableTagWriting`. A `tag_write` model job per run: per file re-read, compare with what the preview showed (stop for that file if it changed), insert `tag_backup`, `writeTags`, verify, record result | Audio fingerprint equal before and after; a crash mid-run leaves each file either old or new; never runs from a scan or schedule | `test/tagger.test.js`; kill test like `probes/g1.mjs` | L |
| 8.5 | Report and restore | Run report view (written, unchanged, failed with reason); `tag-restore` by run or file from `tag_backup` | Restore then rescan gives the first evidence back | `test/tagger.test.js` | M |
| 8.6 | Scan after write | Confirm a rescan keeps links and placements (needs L10) and that manual catalogue values still win over the new tag-derived ones | `test/sync.test.js` | S |
| 8.7 | Legacy tagger (D6) | Gate `tag-album`, `untag-album`, `clear-classical`, `tag-artist` per decision | `test/tagger.test.js` | S |

### Phase 9 — hardening
| # | Task | Size |
|---|---|---|
| 9.1 | `scripts/` fixture: synthetic 10,000-track catalogue; `test/perf.test.js` asserts each page type's `pages.read` under the agreed limit | M |
| 9.2 | Migration and rollback test: schema 4 file → 5 → restore → old build opens it | S |
| 9.3 | Restart persistence: extend `dev/editor-fixtures.mjs check` with contributor edits, merges, saved comparisons | M |
| 9.4 | Compose and Chromium workflow against the paired core commit; phone-width screenshots of every new page | M |
| 9.5 | Docs and handoff files | S |

## 6. Risks

| Risk | Where | Mitigation |
|---|---|---|
| Wrong contributor merges | 1.4, 1.5 | Exact folded name or alias only; ids win; same name with different ids never merges; derived contributors are flagged "unreviewed"; every merge is recorded and undoable (2.6). |
| Derived credits overwrite or resurrect manual work | 1.4 | `source` and `state` on credits; derivation runs only for performances with no performer credit at all, active or removed. |
| A scan re-splitting or re-merging what an admin fixed | Phase 0 | L2, E1, L3 land first; aliases are written on every merge and rename. |
| Role guessing | 1.4 | Roles only from tags or the ensemble word list; everything else is "performer". Pages show "Performer" rather than a guessed role. |
| Reissue grouping joins two performances | 1.6 | Rule unchanged from v0.2 (ids, or same names and every part within two seconds, never on one album); links are visible and removable in the editor. |
| Undo restoring over later work | 2.6 | E10 and E7 fixes first; contributor undo refuses on later credit changes. |
| Core hooks drifting into classical logic | Phase 3 | Hooks carry only labels, links and playable items; review against core rule "generic, additive, capability checked". |
| Page failures from stale ids | Phases 4–6 | C1 first; the plugin also filters to `track_link.state='active'`. |
| Tag write damages a file | Phase 8 | Existing copy-verify-rename path; fingerprint check before and after; FLAC only at first; one file at a time; backup row committed before the write. |
| Tag write changes core identities | Phase 8 | Title, album and album artist are not written by default (S12, D7). |
| Tag write breaks plugin links on non-FLAC files | Phase 8 | L10 is a hard prerequisite; other formats stay off until their round-trip test passes. |
| A scan undoing corrections after a write | 8.6 | Manual assertions already outrank tag-derived ones (`Metadata.resolveField`); test it explicitly. |
| Multi-value loss | 8.2 | Per-format round-trip tests; the `.m4a` ";" failure seen in review is a known case to cover before enabling `.m4a`. |
| Performance on large libraries | Phases 4–6 | Lists come from the index with `sort_*` columns; pages are paged at 100; 9.1 measures. The index rebuild runs on the worker after scans, as today. |
| Schema migration | 1.1 | Additive, transactional, automatic backup, tested restore (9.2). |

## 7. Decisions for Collin

| # | Decision | Recommendation |
|---|---|---|
| D1 | Phase 0 list: land L2, E2, E1, L3, E10, E7, L11, L10, C1, L1 and Batch B before v0.3 work? | Yes. They are small and v0.3 builds directly on them. |
| D2 | Performers without role information are shown as "Performer". Acceptable, or hide role labels until reviewed? | Show "Performer". |
| D3 | Open Opus for composer period and work data? | Not in v0.3. Use MusicBrainz for dates, sort names and aliases; period stays manual or from a later release. It adds a second provider, its own matching risk and a new outbound host. |
| D4 | Comparison playlists with ranges: plugin-owned saved comparisons, or ranges in core playlists? | Plugin-owned saved comparisons. Core playlists stay whole-file and say so when an item is a cut. Ranges in core playlists touch core storage and other clients. |
| D5 | Add the movement-boundaries form in v0.3? | Yes, small and it is the only way ranges can exist. Without it the "playback boundaries" requirements are met only for whole-track movements. |
| D6 | Legacy tagger: keep background tagging behind `enableFileWrites`, and put the four album-menu actions behind the new preview? | Yes to both. That closes B12 without removing a working feature. |
| D7 | May v0.3 write title, album and album artist tags? | No by default. Offer them later, per run, with a warning that core will treat the file as a new track or album. |
| D8 | Performance test conditions: plugin response time, warm database, 10,000-track synthetic catalogue, CI runner, first page of each list and each page type under one second. | Confirm, or give the conditions you intended. |
| D9 | Formats for tag writing in v0.3. | FLAC only at release; MP3 next if its round-trip tests pass in time; others later. |
