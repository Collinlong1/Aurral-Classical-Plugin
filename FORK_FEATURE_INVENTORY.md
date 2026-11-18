# Review fixes L17, L16, U2, L18, U4 (issues #35–#39)

The next five open review issues, by number. Plugin only; no core or schema change; no settings added.

- **L17 (#35)** A track whose only classical evidence is a composer credit stays unsure but opens no classification review (`classify`, reason "composer credit only"); one opened before closes at the next scan, as every track is classified then. An admin's own "unsure" still asks. Lieder and early music tagged with only a composer stay unsure, not "not classical", as the issue requires; L18 covers them on classical albums.
- **L16 (#36)** A WORK tag that a release's title only adds to ("Finale (Live at Wembley)", "Finale - 2009 Remaster", "[Single Version]") is no evidence, like a WORK tag equal to the title. Arrangements, movements and performers after it still count. The issue's trigger is now unsure, not "not classical": "Finale" is still a tempo word.
- **U2 (#37)** The merge step's choices are the entries' names with their recordings or credits (two of one name also say which is which); **Side by side** comes first, then each outcome, then the choice. When composers differ, the comparison says the work that stays keeps its own (the composer row itself came with #13). Found on the way: the person-merge step still said "This can't be undone" and "Undo: Not possible", though person merges have undone from Activity since Phase 2.
- **L18 (#38)** `albumMajority` (classify-evidence.js): when two thirds of an album's tracks are classical and no track there has a popular genre or a soundtrack, game or crossover context, the scan makes its other unpinned tracks classical (hints marked `inheritedFrom: "album majority"`) and closes their reviews (`liftAlbumMajority`, reconcile.js). An album pin or a track pin still wins. The read-only classification report predicts it ("album majority"), and the editor's **Use automatic detection** applies it at once.
- **U4 (#39)** Creating a work (the New work form and from an album's tracks) fills its catalogue number, key, form and other fields from the title right away (`deriveWorkFields`); they are derived values, so the admin's own still win.

Measured on the Apple corpus with genres removed (4,827 tracks): with a composer tag, open classification reviews 1,178 → 861 and classical 3,649 → 3,708; with only the movement part as title, reviews 2,345 → 1,790. The non-classical corpus does no worse. Bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# Review fixes L5, E4, E8, E5/U1, L15 (issues #28, #29, #31, #32, #34)

The next five open review issues, by number. The user chose "unsure" for #34's tracks. Plugin only; no core or schema change; no settings added.

- **L5 (#28)** Telemann's TWV numbers keep their piece: "TWV 55:D1" and "TWV 55:g4" are two works (`cat:twv:55:D1`), the key letter's case kept (D major, d minor), and the all-digit "TWV 40:2" form too (the issue's pattern missed it). `catalogueReadings` reads the new form, so `repairSiblingJoins` takes apart joins earlier versions made on unedited auto works at the next scan; `legacyCatalogueSubject` keeps the old `cat:twv:55` so album records made before still count. Found on the way: `src/works.js` read "TWV 55:D1" as Schubert "D 1", and the title-to-catalogue reader took "TWV 55" and "D1" apart; TWV now comes first in both. `foldedCatalogue` (works.js) compares catalogue numbers without folding the TWV key's case (`sameCatalogue`, `sameNamedWork`).
- **E4 (#29)** A merge writes an audit row on the entry it keeps (`work.merge-into`, `person.merge-into`; also for the scan's completion-split merge), so a page of that entry opened before the merge can neither save nor delete (409). Worse than filed: a stale delete alone also succeeded. No undo exclusion was needed: rows written inside a recorded change count as its own.
- **E8 (#31)** A change now records listeners' favourites, picks and admin picks as they stood right after it. Undo compares, then puts later edits back on the restored works: a favourite stays on the work it was given to (one taken away from a merged work is taken from each part), and a pick goes with its recording to the work that holds it again (the issue's plan would have left the pick on a work that no longer has that recording). Changes recorded before this compare by time and never clear anything.
- **E5/U1 (#32)** "A similar work already exists" is 400 with `field: "createAnyway"`, shown beside **Create anyway** instead of as a conflict with Reload. Saves and bulk edits name the field for an empty title or name and for over-long values ("Keep the title to 10,000 characters or fewer").
- **L15 (#34)** "Romantic", "Contemporary", "Avant-Garde", "Modern Composition", "Orchestral", "Symphony" and "Minimalism" are an "ambiguous classical genre" (2 points, supporting) in `classify-evidence.js`: with one more signal of the track's own the track is classical, otherwise unsure (the user's choice over not classical). The shared `DEFAULT_CLASSICAL_GENRES` and the legacy tagger are unchanged. Each such unsure track gets a review item until #35 (L17) is decided. Measured on the Apple corpus with its genre replaced by one of these: 260 of 4,827 tracks (5.4%) move from classical to unsure in store-style titles, 25 (0.5%) with WORK tags; the saved corpora (tagged "Classical") are unchanged. Accepted edge: a pop song titled with a form word and tagged "Symphony" (Clean Bandit's "Symphony") is still classical.

Bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phases 8.7–9.5 and review fixes L12, L9, L4, E3 — v0.3 complete for review (issues #88–#93, #23, #25–#27)

The last six v0.3 issues and the next four open review issues, by number: 8.7 (#88), 9.1 (#89), 9.2 (#91), 9.3 (#90), 9.4 (#93), 9.5 (#92), L12 (#23), L9 (#25), L4 (#26), E3 (#27). Plugin only; no core or schema change. v0.3 is now implemented for review: summary at the top of `V0_3_REPORT.md`.

- **8.7** (review E6/B12, #47's decision) The album and artist menu actions **Tag as classical**, **Restore original tags** and **Clear classical tags** no longer write when chosen. `src/tag-requests.js` plans each file's change with the tagger's own rules and lookups (`processReal`/`untagReal` gained `plan` and `values` options) and keeps the plan as a file in the data folder (legacy tagging still creates no catalogue). The editor's **Activity → Tag requests** shows each file's change; **Write N files** (confirm) or **Discard**. Confirming re-reads each file, leaves one changed since the request alone, writes exactly the planned values under the tagger's lock, and reports as the actions always did. Background tagging is unchanged behind `enableFileWrites`. Decision taken here: confirming a request needs only the admin's confirmation, not the **Write classical tags to files** setting, as the menu actions never did.
- **9.1** `scripts/perf-catalogue.mjs` builds a 10,000-track catalogue (2,500 four-movement works, 100 composers, 300 performers) through the real scan and matching; `test/perf.test.js` reads the first page of every Classical list and page, the v1 work page, every editor tab, an editor work and album, search, album presentation and track links through the bundle, warm, each under one second (76 ms at most here). Found on the way: work and recording pages read every classical track and resolved value in the Library; `ownedRecordings` with a work now reads that work's tracks and names lazily (150–210 ms → 6–22 ms).
- **9.2** `test/migration-rollback.test.js` runs the real last schema 4 build (`58dd615^:index.js`, from git): it makes a work, this build migrates to schema 5, the old build refuses the newer file with its "restore a compatible backup" message, the `before-v5` backup is restored offline, and the old build reads the work and its movements again. CI's test job fetches full history for it.
- **9.3** `dev/editor-fixtures.mjs v03` makes, through the live API, contributor edits (sort name, other spelling, dates), a person merge and a saved comparison; `check` (before and after the Compose restart) asserts they all persist and the comparison plays its parts. Runs in the work-view integration workflow; not run here (no Docker).
- **9.4** Both browser checks photograph every v0.3 page at 1280 and 390 px and fail on sideways scroll at phone width: Classical home, lists, person, ensemble, composer, work (recordings and movements), recording, saved comparison; the editor's tag preview, file, run, movement boundaries and a tag request. The work-view workflow uploads them as `v0.3-pages-desktop-and-phone`.
- **9.5** `EDITOR_GUIDE.md` (tag writing, tag requests, movement boundaries, review decisions, Details from MusicBrainz), README (the menu actions plan), AGENTS.md status, and these entries.
- **L12 (#23)** `composerEntity` no longer makes another person when several share a composer's name; a movement's extra composer then raises one `contributor_identity` review (raiseReview, so a decided one isn't asked again), and **Use this record** now credits a recording as well as a performance.
- **L9 (#25)** The colon inside a catalogue number such as "Hob. XVI:52" separates nothing; `repairMovementTitles` restores derived titles cut there ("52: I. Allegro").
- **L4 (#26)** A WORK tag with no form word or catalogue number names a work when at least two tracks of the album share it, the track has a composer, and the tag is neither collection-like nor the composer's own name (a guard the issue didn't foresee: the Apple corpus's "W. A. Mozart: The London Sketchbook" split its block without it). The dry run says why a WORK tag wasn't taken. Accepted risk, as #26 says: a free-text name the collection rule doesn't know ("Favourite Arias") on two tracks by one composer becomes a work.
- **E3 (#27)** A settled auto-match review isn't raised again while its reason and tracks are the same. Review pages decide: **Map these tracks** (movement mismatch), **Use this work** per candidate labelled with composer, recordings and first album (ambiguous work), **Yes, the composer is …** / **No** (uncertain composer). Creating a work from tracks is one function for the album page and the review.

The Apple corpus baseline is saved with 30 improved album results and none worse. Bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phases 6.6–8.6 — movement boundaries, MusicBrainz details and classical tag writing (issues #78–#87)

The next ten v0.3 issues in plan order: 6.6 (#79), 7.1 (#78), 7.2 (#80), 7.3 (#81), 8.1 (#83), 8.2 (#84), 8.3 (#85), 8.4 (#82), 8.5 (#86), 8.6 (#87). Plugin only; no core or schema change (schema 5 already had `tag_backup`).

- **6.6** A track holding several movements of one recording gets "Where each movement starts" on its editor track page (m:ss, h:mm:ss or seconds; each after the last, before the end of the file). Saving gives each movement a range segment with its recording content, removes the old segment, and is refused with nothing changed if the times or the track's movements are wrong. The album view and the work page's queue play the same ranges.
- **7.1** Maintenance → **Details from MusicBrainz** queues an admin-started, resumable `mb_enrich` job: one lookup (`inc=aliases`) through the paced, cached client for each person, ensemble or work with a MusicBrainz ID and no MusicBrainz record yet. People and ensembles get sort name, life-span start date and aliases; works get aliases. Period stays manual. Failed lookups are retried by the next run; stored ones are not looked up again.
- **7.2** `Metadata.refresh(..., { keepManual: true })` pins an admin's unpinned manual value or blank before a provider's arrives. Enrichment uses it with `complete: false`. Plain refreshes behave as in v0.1 (a provider still wins an unpinned field).
- **7.3** Pages already read `field_resolution` only; a test shows enriched other names, dates and sort names on the composer and work pages, and an admin's blank date staying blank.
- **8.1** `src/model/tag-plan.js` `proposedTags(c, trackLinkId)`: composer and sort names (only when every composer has one), work, movement name, number and total, performers as `Name (instrument or role)`, conductor, catalogue numbers and the movement's or work's MusicBrainz work, from resolved values and active credits. Never title, album or album artist; nothing for a track not classical, in no work or in two works.
- **8.2** `tags.js` writes `composerSort`, `movementName`, `movementNumber`, `movementTotal`, `performers`, `conductor` and `catalogue` (Picard's Vorbis names; `CLASSICAL_CATALOGUE` is the plugin's own, as Picard has no work catalogue field). `FORMAT_FIELDS`: FLAC every field; MP3 all but movement fields and performers, because node-taglib-sharp can't write Picard's MVNM/MVIN frames and drops TMCL on save (tried; left out rather than written as non-Picard frames). Other formats are unsupported in the preview.
- **8.3** `tag-preview-open` (album, ticked tracks, a work's Recordings section, a track; up to 500 files) reads each file and stores, per field, current and proposed values; files that would change, are up to date, have nothing to write, are an unsupported format, unreadable, read only or missing are listed apart; one file's view shows every field.
- **8.4** `tag-write` needs the preview token, `confirm: true` and the new setting **Write classical tags to files** (`enableTagWriting`, off by default; checked again when the run starts). Runs are `tag_write` model jobs that only `runTagJobs` claims (never a scan, the schedule or `runModelJobs`), in the plugin's process under the tagger's priority lock. Per file: re-read and skip if changed since the preview, `tag_backup` row, `writeTags` (copy renamed into place), read back, audio fingerprint compared; on a mismatch the old tags go back and the file is reported failed. A preview older than an hour must be opened again; confirming one twice writes once.
- **8.5** The run page lists each file's result and restores a whole run or one file from `tag_backup`, only while the file still holds what was written. Track pages list their tag writes.
- **8.6** A rescan after a write keeps every track link and placement, reads the new tags, makes no second work, and an admin's title and catalogue number still win.

Also: the editor's description no longer says audio files are never changed; README documents the setting and tag writing. New `dev/editor-tag-preview-browser.mjs` runs in the work-view integration workflow. Bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phases 4.4–6.5 — composer, contributor, ensemble, work, recording and saved-comparison pages (issues #68–#77)

The next ten v0.3 issues in plan order: 4.4 (#68), 4.5 (#69), 5.1 (#71), 5.2 (#72), 5.3 (#73), 6.1 (#70), 6.2 (#74), 6.3 (#75), 6.4 (#77), 6.5 (#76). New `src/model/pages-entities.js` answers the `classical` page's entity resources with view 2 pages; `pages.js` routes them and adds `queue:<id>`.

- **4.4** `composer:<id>`: name, other names, dates, period and notes when set; works grouped by form (or one list by title, catalogue number or date written), each with its catalogue number and recording count, 100 a page; the performers who recorded them, most recordings first.
- **4.5** search links composers, performers, ensembles, works, movements and recordings to these pages when `capabilities.resourceView >= 2`; older hosts get filters and the v1 work page as before.
- **5.1** `person:<id>` and `ensemble:<id>`: one page an identity, a section a kind of credit (as soloist or performer, as conductor), recordings grouped by composer (by sort name, as the Composers list) then work, 100 a page; "Works as composer" when they also compose.
- **5.2** "Often with": conductors, ensembles and soloists sharing their recordings, counted from credits, with the role each holds most often.
- **5.3** an ensemble page lists its members from `member_of`; a member's page names the ensemble.
- **6.1** `work:<id>`: composer, catalogue, key and an About block; tabs Recordings, Movements (100 a page, with how many recordings hold each) and Related (other works in its collections); recordings one per performance, every release badged Complete, "N of M movements" or Excerpt, 50 a page; a movement filter compares that movement across recordings. Favourite and pick are the same rows the v1 work page uses.
- **6.2** `recording:<key>` (any realization of it, or a performance for a broadcast): work, credits by role and instrument, recorded date, location, label, year, length, completeness and Broadcast badges, the movements as a playable section, every release (`same_recording` reissues are one recording), favourite (`user_recording_state`), and picks.
- **6.3** album groups and their items, and the new `trackLinks` hook (manifest `"trackLinks": true`), carry up to six links: Go to Work, Go to Recording, the composers, then performers by role. A track holding parts of two works names both works.
- **6.4** queued titles read "Work: movement" from every new page (each playable section sends the work as `context`); checked in Chromium.
- **6.5** `save-queue` stores the parts on screen in `saved_queue` with each part's track link and range; the work page lists "Saved comparisons" (the reader's own, 50 a work); `queue:<id>` plays exactly those parts and ranges, leaves out parts whose tracks left the Library, and `delete-queue` removes it. Core commit `9fec213` labels playlists "Add whole track to playlist" / "Save whole tracks as playlist" for cuts, since playlists hold whole files.

Fixed on the way: the stored sort keys never read `sortName` (lists sorted people by display name); a contributor's role label ("Soloist · Conductor") and album links followed credit ids when positions tied. Search index stamp v5. Both integration workflows pin core `9fec213`. No schema change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# Bug fix — concurrent openers each copied the catalogue before upgrading (November 17, 2026)

Reported from a deployment: a health check opened the catalogue from four processes at once while it needed an upgrade. `openDatabase` backed up the whole database before taking any lock, so all four copied it (about 760 MB each), the disk filled and every copy failed. Upgrades are now serialised by `upgrade.lock` in the model folder (exclusive create, with the owner's PID): one opener backs up and migrates; the others wait (up to 30 minutes), then re-read the schema version and find nothing to do. A lock whose process is gone, or older than six hours, is taken over. Before copying, the opener checks free space (`fs.statfs`) for the database's size plus 64 MB and refuses with "Not enough disk space to back up the classical database before upgrading: N MB needed, M MB free", leaving the catalogue unchanged. A multi-step upgrade makes one backup of the database as it was (named for the first step), not one per step. The backup's integrity check no longer leaves `-wal`/`-shm` files behind. A current catalogue opens without the lock. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 4.3 — the Classical Library home and recently added works (issue #67)

Last of four plugin commits in this PR (3.6, 4.1–4.3). The `classical` page's `home` shows the number of works and recordings, a Browse row per list with its count (counted as the lists count, from the search index), and up to ten Recently added works: those whose newest active `track_link.created_at` among the tracks that play part of them is latest, with their composers and the day. An empty Library says how the page fills. List titles now sort numbers as numbers (No. 2 before No. 10).

New `dev/classical-pages-browser.mjs` (asked for by core #53) renders the real home and lists through core's own `pluginLinks.ts` and `PluginResourceView` in Chromium at 1280 and 390 px: home counts, Works with 100 rows and the pager, a composer filter, and a conductor opening a contributor page, with no sideways scroll on a phone. It found core's filters squeezed to "A…" at phone width; core commit 2639010 wraps them two a row. Both integration workflows now pin that core commit, and the work-view workflow runs the new check. No schema change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 4.2 — six Classical Library lists (issue #66)

Third of four plugin commits in this PR (3.6, 4.1–4.3). `list:composer`, `list:work`, `list:performer`, `list:conductor`, `list:ensemble` and `list:recording` are view 2 pages built by `listView(c, kind, query)` in `src/model/pages.js` on `searchCatalogue`: 100 rows a page with core's pager, the search page's facets as filters (all but "Library"), and sort orders per list (works by title, catalogue number or date written; recordings by work, catalogue number, newest or oldest; contributors by sort name), plus "Best match" when the URL has a query. `searchCatalogue` gains `browse` (list every document of the given kinds with no query), `accept` (keep some documents) and `sort` (from the stored `sort_*` keys; documents without a key follow). Performer documents now record whether the contributor is a person or an ensemble (index stamp v4, rebuilt on first read): performers and conductors are people, ensembles are ensembles. Composer and contributor rows open their Classical pages; work and recording rows open the v1 work page until 6.1. No schema change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 4.1 — the Classical Library page (issue #65)

Second of four plugin commits in this PR (3.6, 4.1–4.3). `manifest.json` adds page `classical` (`"admin": false`) and a `library` entry for its `home`, so with core 3.3 the Library's navigation shows "Classical" when an admin leaves the "Library navigation" switch on. New `src/model/pages.js` answers `pages.read` for it with view 2 pages: `home`, `list:<kind>`, `composer:<id>`, `person:<id>`, `ensemble:<id>`, `work:<id>` and `recording:<key>`, read through the search index; an unknown resource is "not found". Home and lists are filled by 4.3 and 4.2; entity pages name the entity, and a work or recording opens the v1 `work` page that plays it, until their own phases (4.4, 5.1, 5.3, 6.1, 6.2). The v1 `work` page answers as before; the page has no mutations yet. The search test's Library fixture moves to `test/library-fixture.js`. No schema change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 3.6 — plugin-facing core hooks in the fork delta (issue #64, core #51–#56)

First of four plugin commits in this PR (3.6, 4.1–4.3), paired with core 3.1–3.6 (core branch `claude/pensive-bardeen-5dat3q`). All six core hooks are generic, additive and off unless a plugin declares them and the admin's capability switch is on; stock plugins and older hosts are unchanged. Documented in core `plugin-api.md` and typed in `aurral-plugin.d.ts`.

- **Resource view 2 and query pass-through (#51, #53).** A non-admin page answers `pages.read` with `{version: 2, title, sections}`: typed header, rows, groups, tracks, details, pager, tabs, filters, sort and empty sections, rendered by core (`PluginResourceView.tsx`). Hosts send `capabilities.resourceView: 2` and `query: {q, sort, tab, page, filters}` from the page's URL. Version 1 work pages still work. Core builds every path; stale tracks are dropped.
- **Resource mutations (#51).** `favourite-item` and `delete-queue` (with `target`) and `save-queue` (with `name`, `itemIds`) beside `favourite`, `pick` and `admin-pick`; a view 2 page's tracks can be saved as a playlist.
- **Library entry (#52).** Manifest `library: {pageId, resourceId, label}` adds one entry to the Library's navigation for a non-admin page, behind the "Library navigation" switch; listed lazily by `GET /api/plugins/library` (kept off bootstrap for the perf budget).
- **Item links (#54).** Up to six `{label, link}` on playable items, album groups and search results; they ride into the queue and the player's track menu. A filter link away from its page opens the plugin's search. `capabilities.itemLinks: 1`.
- **Track links (#56).** Manifest `trackLinks: true` and a `trackLinks({trackIds})` export answer `GET /api/plugins/track-links`, merged across plugins and cached per track on the client, for tracks queued from ordinary pages. `/api/plugins/actions` reports whether any plugin answers.

The plugin uses these from 4.1 (the `classical` Library page and entry). No schema change.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.7 — identity and credit conflict review actions (issue #63)

Last of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #63 only; #63 has no later comments. E3 (#27) itself, for auto-match reviews, stays open; this applies its durable-dismissal rule to the two contributor review kinds, as #63 asks.

Review kinds: `contributor_identity` "same-name-different-id" (1.5) and new "ambiguous-name" (a tag name two records share: derivation credits neither and asks on the recording), and new `credit_conflict` (after matching, tags whose tracks all name a conductor other than the one an admin credited, by name or alias). Their review pages get Decide rows: Merge… and Keep separate (stores `distinctKey` per pair) for the first; one "Use this record" per candidate, with what each is known for, for the second; "Keep" the credited conductor or "Use" the tags' for the third. Every such review carries an evidence key; one an admin dismissed or decided is not raised again for the same target and key (E3's rule), and changed tags ask again. New command `use-contributor`; `keep-distinct` handles contributors. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.6 — contributor merge and delete with undo (issue #62)

Ninth of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #62, with E11's fix that #62 names; E8 (favourites lost on undoing a work merge) is listed as related but is not part of #62's task and stays open.

`history.js` gains `contributorClosure` (a person's or ensemble's credits, aliases, identities, relations, metadata and reviews all hang off the entity) and change kinds `merge-person` and `delete-person`. Merging people or ensembles (Merge, and 2.5's This is…) and deleting an unused one run through `recordChange`, show in Activity and undo exactly. Because credit edits are audited against the recording, not the person, each change also stores its records' credits as they were right after it; undo refuses when they differ. Undoing any change also brings back a deleted person or ensemble a restored credit names (E11). `mergeContributor` now moves ensemble memberships too. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.5 — map unreviewed tag names to existing contributors (issue #60)

Eighth of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #60 only; #60 has no later comments.

A contributor a scan made from a tag spelling (1.4) and nobody has edited shows "This is…" at the top of its page: a people or ensembles lookup (same kind only) and "Use this record". New command `map-contributor` merges it into the chosen record with `mergeContributor`, which keeps the tag spelling as an alias, moves its credits and closes its open reviews; the next scan of any album with that spelling lands on the chosen record (1.5's alias rule). 2.6 makes the merge undoable. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.4 — bulk assign performers and change credit roles (issue #61)

Seventh of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #61 only; #61 has no later comments.

An album page's ticked tracks gain "Set performers…" (remembered with `rememberAlbumTracks`, as grouping does): a page listing the recordings those tracks belong to with their current performers, and a form setting a person or ensemble, role, instrument, and whether their other performers are kept or replaced. A contributor's page gains "Change role on all credits…": a preview of every performing credit and a from/to role form. Each recording or credit is changed in its own savepoint, as bulk-edit does; one that fails is reported ("Updated 1 of 2 … Not changed: …") and the others keep the change. Credits set this way are manual; replaced derived credits stay removed. Contributor pages now label performance credits "Work · Album" and open the recording. New `dev/editor-credits-browser.mjs`, added to the work-view workflow. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.3 — contributor details, aliases and ensemble membership (issue #58)

Sixth of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #58 only; #58 has no later comments.

A person's Details form gains Sort name and Instruments beside Name, Other spellings, Dates and Notes; an ensemble's gains Sort name and Founded. Every other spelling saved, and a contributor's old name when renamed (now for ensembles too, as L2 did for people), is written once to the `alias` table, so tags spelled that way land on the record. Contributor pages gain Members (an ensemble) or Ensembles (a person), each with Remove and an add form using new `people` and `ensembles` lookups; commands `add-member` and `remove-member` store `member_of` relations (1.6). No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.2 — add, edit and remove recording credits (issue #57)

Fifth of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #57 only; #57 has no later comments.

A recording's editor page gains a Performers section for its performance (the credits pages and search show): each credit, marked "from tags" when a scan derived it, with Remove; "Change a performer" (role, and instrument, kept when left empty); and "Add a performer". New command `update-credit`: the credit becomes `manual`, roles keep the person/ensemble rules, a change into an existing credit is refused, and a removed credit under the new role gives way. `add-credit`, `update-credit` and `remove-credit` take an optional `back` page, so changes made from a recording return to it. The recording page's revision scope now includes its performances, so only that recording's performance can be written from it. Removing a derived credit keeps it removed (1.2); rescans and library passes leave an admin's credits as set (1.4). The recording's own credits section is unchanged. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 2.1 — role and unreviewed filters on the performer list (issue #56)

Fourth of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #56 only; #56 has no later comments.

The editor's Performers list shows each contributor's credit roles ("Person · Conductor", "Ensemble · Orchestra") and an "Unreviewed" badge on records a scan made from tags (1.4) that nobody has edited by hand. Admin pages v2 have no list-filter control and Phase 2 is plugin-only, so the filters are search words, named in the search placeholder: `role:conductor`, `role:performer` (soloists, performers, accompanists), `role:ensemble`, any other credit role, and `unreviewed`; they combine with each other and with ordinary search words. The list stays paged at 100. No schema or core change; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

# v0.3 Phase 1.7 — index contributor IDs, roles, instruments and sort keys (issue #59)

Third of ten commits in one PR (1.5–1.7, 2.1–2.7). Implements #59 only; #59 has no later comments.

The search index adds a `role` facet (a recording's performers' credit roles, and each performer's own) and puts credit instruments into the existing `instrument` facet, on recording and performer documents only, so work results are unchanged. Performer facets already carry contributor IDs whenever a recording has credits; tag-name values (`name:…`) are now also dropped across a reissue group once any of its releases has credits. Every document stores `sort_title` (folded; a contributor's `sortName` when set), `sort_key` (its first catalogue number, numbers zero-padded so they sort naturally; a movement's position) and `sort_date`. The index stamp is now `v3`, so existing indexes rebuild. `accompanist` has a role label. No schema change beyond 1.1; bundle rebuilt.

Verification: `V0_3_REPORT.md`.

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

# Metadata editor UI, item 1

Draft protection lives in the generic core renderer; this repository adds the isolated Chromium regression harness and running `EDITOR_UI_HANDOFF.md`. No plugin runtime, bundle, catalogue schema, matching, search or acquisition behavior changed. Items 2–7 remain pending.

# Phase 4 inventory addendum

The v0.1 review fixes preserve verified identities during automatic duplicate-work repair, include movement edits in album revision scopes, and route generic core playback menus through bounded plugin queue items. Album and resource-page player titles both include the work and part. Manifest 1.0.13 retains the standalone-work hotfix and the latest mixed-metadata and scan checkpoint changes from `1019fd5`.

The standalone-work presentation hotfix reports whole works as one album-view part and retains the work view for matched single-track works. It changes only plugin presentation and its bundle; core and storage contracts are unchanged.

Phase 4 adds generic fork hooks for opt-in album presentation, authenticated regular-user resource pages and bounded native queue segments. Classical grouping/work content and user state remain plugin-owned. Main, upstream and preservation branches remain untouched; the review snapshots remain separate and unmerged. See `PHASE_4_REPORT.md` and the Phase 4 section in `UPSTREAM_DELTA.md`.

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

# Phase 3 addendum

Existing fork preservation branches/main/upstream remain untouched. New D01 admin-forms v1 is a generic, opt-in core hook for the plugin-owned editor: manifest pages/capability, authenticated read/mutate transport, host forms, route/Settings entry and types/docs/tests. No core SQL schema or classical business logic is added. All classical mutations stay in independent plugin storage. The central plugin UPSTREAM_DELTA.md records exact files and limitations. Phase 3 is complete for review; no upstream PR or automatic merge.

# Phase 2 inventory addendum

The current user authorized Phase 2 after Phase 1 verification. Phase 2 adds no core runtime changes or additional fork features. The 16 preservation branches and main/upstream are untouched. Local classical branches include the Phase 1 review commits as prerequisites, without merging their remote PRs. Model/storage/migration/reconciliation/classification/job changes are plugin-owned. See PHASE_2_REPORT.md and central plugin MODEL_V1.md. Historical inventory follows.

# Fork feature inventory — Phase 0.5 execution record

Current status: Phase 1 is implemented in fork-only core PR36 and plugin PR6, targeting aurral-classical. Read PHASE_1_REPORT.md and the Phase 1 inventory addendum at the end for current source/test state. The Phase 0.5 records below are preserved historical evidence; the 16 preservation branches are unchanged. Live main's matching upstream advanced externally to 021b1f03, with the same 52 net paths and 111 historical fork-only commits.

## Final-verification drift correction

Fork main advanced **externally to this task** from `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` to `c0deb211eba929424b608ca1c2449c7242892d9c` via merge PR #31, bringing upstream `656475b92be36b6834002da2407e7d9d50c2e0c2` (the owned-albums artist-page fix). No agent write or merge targeted main. The live fork now matches upstream `656475b92be36b6834002da2407e7d9d50c2e0c2` with **110 historical fork-only commits and the same 52 net changed paths**.

Preservation branches remain independently tested one-commit branches on the matching upstream base selected at Phase 0.5 entry, `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`. Classical runtime source remains the frozen entry fork main `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` plus documentation; it does not silently absorb the later update. The user-created classical branches are reused. Reconcile this newly observed nightly drift on classical only after the next phase is approved. Do not reset, overwrite or try to restore live main to the older audited SHA.

All references below to an unchanged main mean **no main edits by this task**, with source/test baseline SHAs explicitly pinned. They do not claim the live fork main stayed stationary while another upstream merge occurred.

**Status: all 16 preservation branches published and independently validated. No PRs opened. Phase 1 not started.**

Matching upstream base: `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`. Frozen entry fork-main baseline: `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee`. Unchanged plugin main: `506e5259e1442b8cfe072a75b129abb428c6bcf7`. The refresh added an upstream-only merge to fork history: **109 fork-only historical commits; 52 net changed paths, +3,130/−181 lines**. All issue branches have exactly one new commit with the matching upstream SHA as their sole parent.

[Current matching-base comparison](https://github.com/lklynet/aurral/compare/7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef...Collinlong1:aa643d316e9e00fb8622ab60b2fb2cb8b76661ee). Later observed upstream main `656475b92be36b6834002da2407e7d9d50c2e0c2` is one commit beyond the matching base; no automatic rebase or main sync was performed.

User approval covers Phase 0.5 and reuse of the already-created classical branches. Upstream is read-only; all new issue branches are in Collinlong1/aurral. Existing fork classical is reused and advanced only through the already-existing fork-main ancestry, followed by handoff documentation. Plugin classical receives documentation only. Neither main is modified.

## Actual branches and validation

| Issue | Branch                                                                                                                              | Commit                                                                                                  | Focused tests                            | Required checks/builds           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| F01   | [feature/optional-fork-container-image](https://github.com/Collinlong1/aurral/tree/feature/optional-fork-container-image)           | [`8991619c5eee`](https://github.com/Collinlong1/aurral/commit/8991619c5eee68520af1ce3ec846a3dc6baf622f) | actionlint + unchanged upstream baseline | Passed; docs build where changed |
| F02   | [fix/missing-track-download-status](https://github.com/Collinlong1/aurral/tree/fix/missing-track-download-status)                   | [`c31abe13cd60`](https://github.com/Collinlong1/aurral/commit/c31abe13cd60b5ffdcac587d216d454b89a16bfe) | 3 passed                                 | Passed; docs build where changed |
| F03   | [feature/numbered-library-pagination](https://github.com/Collinlong1/aurral/tree/feature/numbered-library-pagination)               | [`f16b4e057f03`](https://github.com/Collinlong1/aurral/commit/f16b4e057f034c99ed7fc2949c8a13402b116b25) | 3 passed                                 | Passed; docs build where changed |
| F04   | [feature/library-page-size](https://github.com/Collinlong1/aurral/tree/feature/library-page-size)                                   | [`100864c635cd`](https://github.com/Collinlong1/aurral/commit/100864c635cde498541c147a32ec89cac7d6ed21) | 1 passed                                 | Passed; docs build where changed |
| F05   | [fix/album-scoped-track-ownership](https://github.com/Collinlong1/aurral/tree/fix/album-scoped-track-ownership)                     | [`183b22ca3388`](https://github.com/Collinlong1/aurral/commit/183b22ca3388b9adff0568f135002591fcc59e04) | 22 passed                                | Passed; docs build where changed |
| F06   | [fix/wanted-cancelled-tracks](https://github.com/Collinlong1/aurral/tree/fix/wanted-cancelled-tracks)                               | [`a9c9a2abd64c`](https://github.com/Collinlong1/aurral/commit/a9c9a2abd64cd2dd290b66ccb43dcff832061372) | 8 passed                                 | Passed; docs build where changed |
| F07   | [feature/playlist-track-reorder](https://github.com/Collinlong1/aurral/tree/feature/playlist-track-reorder)                         | [`29b9baf0d36a`](https://github.com/Collinlong1/aurral/commit/29b9baf0d36ac629bc3d1d01192211cae064eb17) | 4 passed                                 | Passed; docs build where changed |
| F08   | [feature/link-missing-track-library-file](https://github.com/Collinlong1/aurral/tree/feature/link-missing-track-library-file)       | [`8886ca2c8a4b`](https://github.com/Collinlong1/aurral/commit/8886ca2c8a4b61dd3f9d9e2b4e3af3ac08a06d2e) | 5 passed                                 | Passed; docs build where changed |
| F09   | [feature/import-disk-file-for-missing-track](https://github.com/Collinlong1/aurral/tree/feature/import-disk-file-for-missing-track) | [`e2e55bd09e2e`](https://github.com/Collinlong1/aurral/commit/e2e55bd09e2ee21898794956d42ca5a7a83f4d65) | 5 passed                                 | Passed; docs build where changed |
| F10   | [fix/playlist-local-album-artwork](https://github.com/Collinlong1/aurral/tree/fix/playlist-local-album-artwork)                     | [`1b8358d53363`](https://github.com/Collinlong1/aurral/commit/1b8358d53363b63aa4842a3d57902af9a80a8475) | 1 passed                                 | Passed; docs build where changed |
| F11   | [fix/playlist-current-library-names](https://github.com/Collinlong1/aurral/tree/fix/playlist-current-library-names)                 | [`ca666ca9c24d`](https://github.com/Collinlong1/aurral/commit/ca666ca9c24d2a64e915c097716c46c3f7a455ea) | 1 passed                                 | Passed; docs build where changed |
| F12   | [fix/subsonic-playlist-file-identity](https://github.com/Collinlong1/aurral/tree/fix/subsonic-playlist-file-identity)               | [`576ef4b266e1`](https://github.com/Collinlong1/aurral/commit/576ef4b266e1cb7758c1b26862fecba6cd9bdee3) | 40 passed                                | Passed; docs build where changed |
| F13   | [fix/subsonic-playlist-rescan-timestamp](https://github.com/Collinlong1/aurral/tree/fix/subsonic-playlist-rescan-timestamp)         | [`d2151224bf94`](https://github.com/Collinlong1/aurral/commit/d2151224bf94511888fc24b4b62390e39ea8a533) | 1 passed                                 | Passed; docs build where changed |
| F14   | [fix/wake-running-download-worker](https://github.com/Collinlong1/aurral/tree/fix/wake-running-download-worker)                     | [`2607fd60f558`](https://github.com/Collinlong1/aurral/commit/2607fd60f5581d85d38caa116b4a2aa38ad9759e) | 30 passed                                | Passed; docs build where changed |
| F15   | [fix/plugin-install-cross-device-rollback](https://github.com/Collinlong1/aurral/tree/fix/plugin-install-cross-device-rollback)     | [`963b3bc97c08`](https://github.com/Collinlong1/aurral/commit/963b3bc97c0875944f7f0f83513ec9377aa8d2e7) | 8 passed                                 | Passed; docs build where changed |
| F16   | [fix/recording-id-artist-contradiction](https://github.com/Collinlong1/aurral/tree/fix/recording-id-artist-contradiction)           | [`ab1f64f53f39`](https://github.com/Collinlong1/aurral/commit/ab1f64f53f39d833bba3ece45d48292cf728d1b4) | 17 passed                                | Passed; docs build where changed |

All branches passed formatting/lint, UI CSS policy, DB generated-type validation, zero-error typecheck and unsafe-any budget checks. Application builds passed on all 16; documentation builds passed on all 13 branches changing docs. Focused suites passed 149 tests across the 15 runtime-changing branches, including 40 Subsonic integration tests. Workflow-only F01 passed actionlint; no runtime source changed. `PHASE_05_VALIDATION.json` records exact commands/results.

## Independence, adaptations and actual files

### F01 — Optional container image publishing

The old workflow was explicitly fork-only. The preserved branch uses generic repository identity and explicit ENABLE_CONTAINER_PUBLISHING opt-in, with feature/** support. It stays disabled; its actual GitHub run was skipped. Original main workflow is unchanged.

Original commit provenance: `11739f0945e388bfc40f88de30cb1c6538dcf7fa`, `34d17c9cd8eeacb5d63a17a949090d649f0f7698`, `34bbedba1f07307bf24d182acde91387454582c4`.

Actual isolated files:

- `.github/workflows/fork-image.yml`
- `docs/src/content/docs/admin/optional-container-publishing.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F02 — Missing-track download indicator scope

Only missing-track indicator helpers/hooks/actions and their test; no pagination code.

Original commit provenance: `cd409bad9c0fa14a950c6e1cb0dbab3188a58e26`.

Actual isolated files:

- `.tests/frontend/active-downloads.test.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/hooks/useActiveDownloads.ts`
- `frontend/src/pages/library/useLibraryActions.tsx`
- `frontend/src/utils/activeDownloads.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F03 — Numbered Library pages and item range

Removed page-size selector from numbered navigation; uses stock page size. No URL/query-size changes. Existing pagination CSS relocation is accounted for here.

Original commit provenance: `2d8e625fc99536f84be34a269e4244ab4b96a299`, `ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a`, `cfa5fe26c6a7e4c1ffb37d6190294b6c74bcb122`, `3bdb4e702d1e1befc4330b5f910e41b72f0d808f`.

Actual isolated files:

- `.tests/frontend/pagination.test.ts`
- `docs/src/content/docs/using/library.mdx`
- `frontend/src/components/Pagination.css`
- `frontend/src/components/Pagination.tsx`
- `frontend/src/index.css`
- `frontend/src/pages/LibraryPage.tsx`
- `frontend/src/utils/pagination.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F04 — Selectable Library page size

Page-size selection uses upstream previous/next navigation, not F03 component. Retains URL/query/prefetch behavior and pageSizeParams test.

Original commit provenance: `ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a`, `3bdb4e702d1e1befc4330b5f910e41b72f0d808f`.

Actual isolated files:

- `.tests/frontend/pagination.test.ts`
- `docs/src/content/docs/using/library.mdx`
- `frontend/src/navigation/routePrefetch.ts`
- `frontend/src/pages/LibraryPage.tsx`
- `frontend/src/pages/libraryViewQuery.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F05 — Ownership check for a requested album placement

Album-placement ownership query and request callers, with both original library regression suites. No manual-link dependency.

Original commit provenance: `e2d4272770fd64b89ff917af6c31e945d03cfb09`.

Actual isolated files:

- `.tests/library/media-query.test.ts`
- `.tests/library/track-album-context.test.ts`
- `backend/services/libraryQueryService.ts`
- `backend/services/libraryTrackRequests.ts`
- `docs/src/content/docs/using/activity.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F06 — Cancelled individual tracks remain Wanted/Missing

Only Wanted eligibility, manual-search/research behavior, cancelled label and tests. No file linking/import or worker-wake hunk.

Original commit provenance: `a790aaca2e8f03956be8708f9f1f9ea6d28a083a`.

Actual isolated files:

- `.tests/frontend/activity-missing.test.ts`
- `.tests/library/aurral-wanted-monitoring.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/downloadJobs/downloadTracker.ts`
- `backend/services/downloadJobs/downloadWorker.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/pages/activity/ActivityMissingPage.tsx`
- `frontend/src/pages/activity/activityMissingUtils.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F07 — Reorder static playlist tracks

Only reorder service/route/component/handler. Shared playlist UI was split; no Library/disk picker.

Original commit provenance: `404cf3c10af9ed81b2914a6a48ec85617907cc50`.

Actual isolated files:

- `.tests/playlists/playlist-track-order.test.ts`
- `backend/routes/playlists/handlers/staticPlaylists.ts`
- `backend/services/playlists/playlistTrackOrder.ts`
- `docs/src/content/docs/using/playlists.mdx`
- `frontend/src/components/icons.tsx`
- `frontend/src/pages/playlists/PlaylistTracks.tsx`
- `frontend/src/pages/playlists/components/PlaylistReorderList.css`
- `frontend/src/pages/playlists/components/PlaylistReorderList.tsx`
- `frontend/src/pages/playlists/components/playlistTrackComponents.tsx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F08 — Resolve a missing track using an existing Library file

Local eligibility predicate removes dependency on F06. Library-only picker, route and owner-command adapter work without disk import. Typed query-cache update avoids inherited unsafe-any problem. Added saved/cancelled versus cancelled-album regression.

Original commit provenance: `79b9bef44762ff79152630f84c1592938de25f42`, `0ef5061d0c29750ccb5f1b88574e73e87047403a`.

Actual isolated files:

- `.tests/download/link-library-file.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/downloadJobs/downloadOwnerCommands.ts`
- `backend/services/downloadJobs/fileReuse.ts`
- `backend/services/downloadJobs/linkLibraryFile.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/pages/activity/ActivityMissingPage.tsx`
- `frontend/src/pages/activity/LinkLibraryFileModal.tsx`
- `frontend/src/pages/playlists/PlaylistTracks.tsx`
- `frontend/src/pages/playlists/components/playlistTrackComponents.tsx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F09 — Resolve a missing track using a copied disk file

Independent admin disk-import picker and localized eligibility predicate remove F08/F06 dependencies. Uses only import routes/command adapter. Copies nearby art without requiring F10 artwork rendering; typed cache update included.

Original commit provenance: `1c68fc63c9858ee9505013ca27ff9cf462755984`, `aa7f72a7f299afaced069431b4e4de4332064e8c`.

Actual isolated files:

- `.tests/download/import-disk-file.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/downloadJobs/downloadOwnerCommands.ts`
- `backend/services/downloadJobs/importDiskFile.ts`
- `docs/src/content/docs/using/activity.mdx`
- `frontend/src/pages/activity/ActivityMissingPage.tsx`
- `frontend/src/pages/activity/DiskFilePanel.css`
- `frontend/src/pages/activity/DiskFilePanel.tsx`
- `frontend/src/pages/activity/ImportDiskFileModal.tsx`
- `frontend/src/pages/playlists/PlaylistTracks.tsx`
- `frontend/src/pages/playlists/components/playlistTrackComponents.tsx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F10 — Local album artwork fallback for playlist rows

Only artwork lookup/rendering. Test seeds an ordinary completed native job directly rather than using link/import endpoints. Performance budget test passed unchanged.

Original commit provenance: `aa7f72a7f299afaced069431b4e4de4332064e8c`, `58667789c3d2d14e89c898355579e66a4a79d0a5`, `37b670eb6142301541cd4948e14b726af57ce991`.

Actual isolated files:

- `.tests/playlists/playlist-local-artwork.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/playlists/playlistTrackCovers.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F11 — Playlist rows follow current indexed track names

Only current Library metadata lookup/rendering, with an independent LibraryJob type. Native completed-job fixture avoids link/import dependencies. Performance budget test passed unchanged.

Original commit provenance: `eedfb2efd628c5a73ce5afc06e693aa02b80a0bc`.

Actual isolated files:

- `.tests/playlists/playlist-current-names.test.ts`
- `backend/routes/playlists/handlers/jobs.ts`
- `backend/services/playlists/playlistTrackCovers.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F12 — Resolve Subsonic playlist songs by linked file path

Only file-path identity and favourite/star mapping. No rescan timestamp or removed artist-source feature. Measured playlist query count is 130 cold/50 warm (+1 each), recorded precisely in this branch baseline; 40 integration tests passed.

Original commit provenance: `c4648674dc9af2059878b94105b7049a0d523281`, `d840e5b34965989df9bb5315cc22a8118db87d47`.

Actual isolated files:

- `.tests/perf/baseline.json`
- `.tests/subsonic/subsonic-api.int.test.ts`
- `backend/services/subsonicLibraryService.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F13 — Invalidate Subsonic playlist metadata after file rescan

Only file-update timestamp invalidation. Added dedicated list/detail/unrelated-file regression. Measured 138 cold/58 warm (+9 each); baseline recorded here. Corrects Phase 0 attribution of the combined +10 entirely to F12.

Original commit provenance: `b2cd79967945512c41cbc7580c9a5f2f59978a45`.

Actual isolated files:

- `.tests/perf/baseline.json`
- `.tests/subsonic/playlist-rescan-timestamp.test.ts`
- `backend/services/subsonicLibraryService.ts`
- `docs/src/content/docs/using/playlists.mdx`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F14 — Wake idle worker when start is called again

Only start()-wakes-running-worker hunk and download-tracker regression; no Wanted eligibility hunk.

Original commit provenance: `11e8cff64551fa2810fc9484aa99a1d6b5d8009a`.

Actual isolated files:

- `.tests/download/download-tracker.test.ts`
- `backend/services/downloadJobs/downloadWorker.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F15 — Make cross-device plugin replacement recoverable

Cross-device copy/rename and restoration only; added orphan-.previous followed by disk-full rollback regression. Eight installer tests passed.

Original commit provenance: `a544a9b81ddd748bc26b72347703a4934f36ff4b`.

Actual isolated files:

- `.tests/plugins/plugin-install.test.ts`
- `backend/services/plugins/pluginInstaller.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

### F16 — Exact requested recording ID avoids artist contradiction

Exact recording ID suppresses only artist contradiction; other gates retained. Seventeen matcher tests passed. This does not implement performer-first slskd queries.

Original commit provenance: `d4deed1011913bb2f43cd47752db28da08c0be1f`.

Actual isolated files:

- `.tests/track-matching/native-matcher.test.ts`
- `backend/services/trackMatching/nativeMatcher.ts`

Status: independently validated; owner review pending; no PR submitted. Base and actual commit are in the table above.

## Original 52-path net-diff accounting

Every path is assigned below, including configuration, CSS, docs and tests. Shared path counts must not be summed once per issue. Semantic split instructions are in issue sections and source patches. No unallocated path remains.

| Path                                                                  | Status   | + / −    | Issues                            |
| --------------------------------------------------------------------- | -------- | -------- | --------------------------------- |
| `.github/workflows/fork-image.yml`                                    | added    | 92 / 0   | F01                               |
| `.tests/download/download-tracker.test.ts`                            | modified | 26 / 0   | F14                               |
| `.tests/download/link-library-file.test.ts`                           | added    | 401 / 0  | F08 F09 F10 F11                   |
| `.tests/frontend/active-downloads.test.ts`                            | modified | 32 / 0   | F02                               |
| `.tests/frontend/activity-missing.test.ts`                            | modified | 3 / 0    | F06                               |
| `.tests/frontend/pagination.test.ts`                                  | added    | 35 / 0   | F03 F04                           |
| `.tests/library/aurral-wanted-monitoring.test.ts`                     | modified | 32 / 0   | F06                               |
| `.tests/library/media-query.test.ts`                                  | modified | 68 / 0   | F05                               |
| `.tests/library/track-album-context.test.ts`                          | modified | 62 / 0   | F05                               |
| `.tests/perf/baseline.json`                                           | modified | 2 / 2    | F12 and F13 (measured separately) |
| `.tests/playlists/playlist-track-order.test.ts`                       | added    | 121 / 0  | F07                               |
| `.tests/plugins/plugin-install.test.ts`                               | modified | 41 / 1   | F15                               |
| `.tests/subsonic/subsonic-api.int.test.ts`                            | modified | 7 / 2    | F12                               |
| `.tests/track-matching/native-matcher.test.ts`                        | modified | 23 / 0   | F16                               |
| `backend/routes/playlists/handlers/jobs.ts`                           | modified | 140 / 4  | F06 F08 F09 F10 F11               |
| `backend/routes/playlists/handlers/staticPlaylists.ts`                | modified | 24 / 0   | F07                               |
| `backend/services/downloadJobs/downloadOwnerCommands.ts`              | modified | 5 / 0    | F08 F09                           |
| `backend/services/downloadJobs/downloadTracker.ts`                    | modified | 10 / 1   | F06                               |
| `backend/services/downloadJobs/downloadWorker.ts`                     | modified | 5 / 1    | F06 F14                           |
| `backend/services/downloadJobs/fileReuse.ts`                          | modified | 2 / 2    | F08                               |
| `backend/services/downloadJobs/importDiskFile.ts`                     | added    | 208 / 0  | F09                               |
| `backend/services/downloadJobs/linkLibraryFile.ts`                    | added    | 136 / 0  | F08                               |
| `backend/services/libraryQueryService.ts`                             | modified | 17 / 1   | F05                               |
| `backend/services/libraryTrackRequests.ts`                            | modified | 16 / 5   | F05                               |
| `backend/services/playlists/playlistTrackCovers.ts`                   | added    | 93 / 0   | F10 F11                           |
| `backend/services/playlists/playlistTrackOrder.ts`                    | added    | 36 / 0   | F07                               |
| `backend/services/plugins/pluginInstaller.ts`                         | modified | 43 / 6   | F15                               |
| `backend/services/subsonicLibraryService.ts`                          | modified | 67 / 10  | F12 F13                           |
| `backend/services/trackMatching/nativeMatcher.ts`                     | modified | 4 / 1    | F16                               |
| `docs/src/content/docs/api/endpoints.mdx`                             | modified | 5 / 0    | F07 F08 F09                       |
| `docs/src/content/docs/using/activity.mdx`                            | modified | 23 / 1   | F06 F08 F09 F10                   |
| `docs/src/content/docs/using/playlists.mdx`                           | modified | 12 / 0   | F07 F08 F09                       |
| `frontend/src/components/Pagination.css`                              | added    | 94 / 0   | F03 F04                           |
| `frontend/src/components/Pagination.tsx`                              | added    | 86 / 0   | F03 F04                           |
| `frontend/src/components/icons.tsx`                                   | modified | 3 / 0    | F07                               |
| `frontend/src/hooks/useActiveDownloads.ts`                            | modified | 5 / 0    | F02                               |
| `frontend/src/index.css`                                              | modified | 0 / 10   | F03                               |
| `frontend/src/navigation/routePrefetch.ts`                            | modified | 2 / 1    | F04                               |
| `frontend/src/pages/LibraryPage.tsx`                                  | modified | 24 / 27  | F02 F03 F04                       |
| `frontend/src/pages/activity/ActivityMissingPage.tsx`                 | modified | 35 / 1   | F06 F08 F09                       |
| `frontend/src/pages/activity/DiskFilePanel.css`                       | added    | 85 / 0   | F09                               |
| `frontend/src/pages/activity/DiskFilePanel.tsx`                       | added    | 141 / 0  | F09                               |
| `frontend/src/pages/activity/LinkLibraryFileModal.tsx`                | added    | 281 / 0  | F08 F09                           |
| `frontend/src/pages/activity/activityMissingUtils.ts`                 | modified | 6 / 1    | F06                               |
| `frontend/src/pages/library/useLibraryActions.tsx`                    | modified | 8 / 3    | F02                               |
| `frontend/src/pages/libraryViewQuery.ts`                              | modified | 32 / 3   | F04                               |
| `frontend/src/pages/playlists/PlaylistTracks.tsx`                     | modified | 34 / 0   | F07 F08 F09                       |
| `frontend/src/pages/playlists/components/PlaylistReorderList.css`     | added    | 99 / 0   | F07                               |
| `frontend/src/pages/playlists/components/PlaylistReorderList.tsx`     | added    | 168 / 0  | F07                               |
| `frontend/src/pages/playlists/components/playlistTrackComponents.tsx` | modified | 198 / 98 | F07 F08 F09                       |
| `frontend/src/utils/activeDownloads.ts`                               | modified | 12 / 0   | F02                               |
| `frontend/src/utils/pagination.ts`                                    | added    | 26 / 0   | F03                               |

## Historical features absent from the current net diff

| Retired/superseded issue | Origin / removal or successor evidence | Preservation decision |
| --- | --- | --- | --- |
| Request-available notifications / album path | `8b5d2d9`; later upstream overlap and script removal `b7d4043` | No current notification delta; do not resurrect |
| Built-in custom scripts | `b98488e`, `7bd66e3`, `f1a8310`, `6576f6f`; removed `b7d4043`, leftover migration removed `3cc4f3f` | No current script/settings/schema delta; separate external plugin is not audited here |
| Per-event webhook bodies / converter | `9e6fbd2`, `e480efc`; upstream per-webhook events adopted `a071d7a`; converter/test removed `5114332`, `dde6191` | No current delta |
| Delete other admin accounts | `5472885`; removed `5cc5b8f` | No current user-management delta |
| M3U folder import | `837a986`, `afffe95`, `4c3c248`; removed `4c029cd` for upstream file import | No current import feature to branch |
| Raw ARTIST tags in Subsonic / throughout UI | `4e55f1f`, `689ae21`, `f12f7bb`, `b66bcce`; reverted/removed `2e5e855`, `a77c3af`, `866a26c`, `17b4960` | No artist-source settings/schema delta; retain F12/F13 separately |
| Box-set album naming and own cover | `6cf6d5f`, `5396487`, naming/cover part of `63358e2`; removed `7880950` | No album naming/artwork delta |
| Load every page of album/artist tracks | `bd9f3ca`; removed `e29a72f` after upstream behavior changed | No residual fetch loop; F04 page-size changes remain |
| Box-set disc sections and subtitle display | disc part of `63358e2`, `639186b`, `6e59e74`, `d74343c`, `cea3d08`; superseded in upstream sync `718a79e` | No custom disc modules remain; use upstream disc renderer |
| Typed page jump | `2d8e625`; superseded by `ff1d308` | Current F03 numbered pagination only |
| Bulk Activity cancel | `e4f700d`, `538f94f`; removed `ecd3a7c` | No current bulk-cancel delta |
| Retagged duplicate-copy cleanup | `f2660ce`; removed `3b6cae5` | No current libraryMediaStore delta |
| Owned albums outside discography rail | `dd20b95`; removed `95392a6` | No current artist-page delta |
| Apple TV AirPlay artwork | `4e3b001`; reverted `1f7ec85` | No current player-artwork delta |
| Playlist local cover removed then restored | `aa7f72a`; removal `5866778`; restored `37b670e` | F10 is active, not retired |
| Pure style/module refactors | `cfa5fe2`, `d74343c`, `7bd66e3`, `afffe95`, `f12f7bb`, `e480efc`, `3bdb4e7`, `538f94f` | Active portions assigned to their owning issue; no unrelated refactor branch |

## Complete 110-commit ledger

All original Phase 0 commits plus the two upstream-only refresh merges are listed, including merges, removals and transient states. This prevents an omission in the net inventory from being confused with lost history. Merge parents are preserved in evidence; merges are not extraction units.

| Commit                                                                                                                              | Parents | Subject                                                                                                        | Extraction treatment                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`8b5d2d9f18874021db930bbd56b0bb1ad66ce1fc`](https://github.com/Collinlong1/aurral/commit/8b5d2d9f18874021db930bbd56b0bb1ad66ce1fc) | 1       | fix(notifications): send request-available for Aurral-managed albums                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b98488e1e3a13895f33dc9338b4ef9d330781d14`](https://github.com/Collinlong1/aurral/commit/b98488e1e3a13895f33dc9338b4ef9d330781d14) | 1       | feat(notifications): run custom scripts on notification events                                                 | Retired/superseded/transient or issue refactor; current net map governs       |
| [`11739f0945e388bfc40f88de30cb1c6538dcf7fa`](https://github.com/Collinlong1/aurral/commit/11739f0945e388bfc40f88de30cb1c6538dcf7fa) | 1       | ci(fork): build and push this fork's image to GHCR                                                             | F01 provenance; extract current hunks                                         |
| [`34d17c9cd8eeacb5d63a17a949090d649f0f7698`](https://github.com/Collinlong1/aurral/commit/34d17c9cd8eeacb5d63a17a949090d649f0f7698) | 1       | ci(fork): install ffmpeg and use Vite+ like upstream validation                                                | F01 provenance; extract current hunks                                         |
| [`9e6fbd2090b049cefb74b9c54e431b490ad6bb9d`](https://github.com/Collinlong1/aurral/commit/9e6fbd2090b049cefb74b9c54e431b490ad6bb9d) | 1       | feat(notifications): let each webhook send its own body per event                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`54728855f9f1af62f14cba5bc7ccf43c981a23a9`](https://github.com/Collinlong1/aurral/commit/54728855f9f1af62f14cba5bc7ccf43c981a23a9) | 1       | fix(users): let admins delete other admin accounts                                                             | Retired/superseded/transient or issue refactor; current net map governs       |
| [`837a9861c6413676db0bbdbb78f10229aeb0e11f`](https://github.com/Collinlong1/aurral/commit/837a9861c6413676db0bbdbb78f10229aeb0e11f) | 1       | feat(playlists): import M3U playlists from a server folder                                                     | Retired/superseded/transient or issue refactor; current net map governs       |
| [`4e55f1fcb990b7e01786b5d0ba37c93ffc0bca64`](https://github.com/Collinlong1/aurral/commit/4e55f1fcb990b7e01786b5d0ba37c93ffc0bca64) | 1       | feat(subsonic): show artist names from file tags, like Navidrome                                               | Retired/superseded/transient or issue refactor; current net map governs       |
| [`fde585b171a27cb7838f3a5fd2bc5b6c6e04f32d`](https://github.com/Collinlong1/aurral/commit/fde585b171a27cb7838f3a5fd2bc5b6c6e04f32d) | 2       | Merge pull request #1 from Collinlong1/claude/kind-pascal-mytar7                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`04a6d700bd48ad11688bc36b5d38d971d3cb5062`](https://github.com/Collinlong1/aurral/commit/04a6d700bd48ad11688bc36b5d38d971d3cb5062) | 2       | Merge pull request #2 from Collinlong1/feat/script-hooks                                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`6cf6d5fe1099554a6526c764353ddcaaa5290f64`](https://github.com/Collinlong1/aurral/commit/6cf6d5fe1099554a6526c764353ddcaaa5290f64) | 1       | wip(library): name box sets after their release group                                                          | Retired/superseded/transient or issue refactor; current net map governs       |
| [`5396487161441f6bedc76dcd9aeefb588879a60d`](https://github.com/Collinlong1/aurral/commit/5396487161441f6bedc76dcd9aeefb588879a60d) | 1       | fix(library): name box sets after their release group                                                          | Retired/superseded/transient or issue refactor; current net map governs       |
| [`bd9f3cab6046d7970f1788a0651c8164fa942662`](https://github.com/Collinlong1/aurral/commit/bd9f3cab6046d7970f1788a0651c8164fa942662) | 1       | fix(library): show every track of an album or artist                                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`34bbedba1f07307bf24d182acde91387454582c4`](https://github.com/Collinlong1/aurral/commit/34bbedba1f07307bf24d182acde91387454582c4) | 1       | ci(fork): build images for fix/ branches too                                                                   | F01 provenance; extract current hunks                                         |
| [`63358e21be8f799c4434702ef7e7cb82695095eb`](https://github.com/Collinlong1/aurral/commit/63358e21be8f799c4434702ef7e7cb82695095eb) | 1       | feat(library): show box sets with their own cover and a section per disc                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`fa7963879ca6034c70dd1bb838b5ac39a9a79deb`](https://github.com/Collinlong1/aurral/commit/fa7963879ca6034c70dd1bb838b5ac39a9a79deb) | 2       | Merge pull request #4 from Collinlong1/fix/box-set-titles                                                      | Integration history; current conflict adaptations allocated by net paths      |
| [`16f0ae2e926567a83671d9221d2159491855d247`](https://github.com/Collinlong1/aurral/commit/16f0ae2e926567a83671d9221d2159491855d247) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`1b3b0509f6c0088da72547e6a334b6424dd12170`](https://github.com/Collinlong1/aurral/commit/1b3b0509f6c0088da72547e6a334b6424dd12170) | 2       | Merge pull request #5 from Collinlong1/sync/upstream                                                           | Integration history; current conflict adaptations allocated by net paths      |
| [`639186bfe70c43401faf7aba7c5e04696edbb8c0`](https://github.com/Collinlong1/aurral/commit/639186bfe70c43401faf7aba7c5e04696edbb8c0) | 1       | fix(library): keep missing tracks on their album's disc                                                        | Retired/superseded/transient or issue refactor; current net map governs       |
| [`283d6ace1f1b7f56f4dc0e0794bdef6376895da6`](https://github.com/Collinlong1/aurral/commit/283d6ace1f1b7f56f4dc0e0794bdef6376895da6) | 2       | Merge pull request #6 from Collinlong1/claude/fervent-curie-kizyqc                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`cd409bad9c0fa14a950c6e1cb0dbab3188a58e26`](https://github.com/Collinlong1/aurral/commit/cd409bad9c0fa14a950c6e1cb0dbab3188a58e26) | 1       | fix(library): downloading one missing track leaves the album's others free                                     | F02 provenance; extract current hunks                                         |
| [`58abab87c0d7bb6849f03931c54fb83b1cf233cd`](https://github.com/Collinlong1/aurral/commit/58abab87c0d7bb6849f03931c54fb83b1cf233cd) | 2       | Merge pull request #7 from Collinlong1/claude/fervent-curie-kizyqc                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`8d197470f23e3dbd46066ef688f3b4ec4bb6bca0`](https://github.com/Collinlong1/aurral/commit/8d197470f23e3dbd46066ef688f3b4ec4bb6bca0) | 2       | Merge pull request #8 from lklynet/main                                                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`689ae21c358aaf35fce0d6374c4a4f493da6405c`](https://github.com/Collinlong1/aurral/commit/689ae21c358aaf35fce0d6374c4a4f493da6405c) | 1       | fix(subsonic): keep compilation track artists with artist tags on                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`bfe73caa9659c7d342faf4a5dc5becf029b7e184`](https://github.com/Collinlong1/aurral/commit/bfe73caa9659c7d342faf4a5dc5becf029b7e184) | 2       | Merge pull request #9 from Collinlong1/claude/fervent-curie-kizyqc                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`2d8e625fc99536f84be34a269e4244ab4b96a299`](https://github.com/Collinlong1/aurral/commit/2d8e625fc99536f84be34a269e4244ab4b96a299) | 1       | feat(library): type a page number to jump to it                                                                | F03 provenance; extract current hunks                                         |
| [`e4f700d1852790b96a1f46ff782155d0c82b59b7`](https://github.com/Collinlong1/aurral/commit/e4f700d1852790b96a1f46ff782155d0c82b59b7) | 1       | feat(activity): cancel several queued downloads at once                                                        | Retired/superseded/transient or issue refactor; current net map governs       |
| [`e2d4272770fd64b89ff917af6c31e945d03cfb09`](https://github.com/Collinlong1/aurral/commit/e2d4272770fd64b89ff917af6c31e945d03cfb09) | 1       | fix(library): a missing album track downloads though another album holds it                                    | F05 provenance; extract current hunks                                         |
| [`64d2e255752105583a51fae0571ef7891523099a`](https://github.com/Collinlong1/aurral/commit/64d2e255752105583a51fae0571ef7891523099a) | 2       | Merge pull request #10 from Collinlong1/claude/fervent-curie-kizyqc                                            | Integration history; current conflict adaptations allocated by net paths      |
| [`6e59e74d66b31cea94d31399b247a13f4d11ab05`](https://github.com/Collinlong1/aurral/commit/6e59e74d66b31cea94d31399b247a13f4d11ab05) | 1       | fix(library): split an album into discs by disc number only                                                    | Retired/superseded/transient or issue refactor; current net map governs       |
| [`ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a`](https://github.com/Collinlong1/aurral/commit/ff1d308b5bbd3d3ca3c12193f16a6f98d0209b3a) | 1       | feat(library): page bar with numbered pages and a page size                                                    | F03, F04 provenance; extract current hunks                                    |
| [`371003a6cd8e163669a01752ae68f414613352e7`](https://github.com/Collinlong1/aurral/commit/371003a6cd8e163669a01752ae68f414613352e7) | 2       | Merge pull request #11 from Collinlong1/claude/fervent-curie-kizyqc                                            | Integration history; current conflict adaptations allocated by net paths      |
| [`f2660ce2f29cf312217208bcb7216558f2bbfa94`](https://github.com/Collinlong1/aurral/commit/f2660ce2f29cf312217208bcb7216558f2bbfa94) | 1       | fix(library): an album keeps no empty copy of a song its file was retagged to                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b88eabf9ab1dba4bca8a4b6f477e0efb8898f68c`](https://github.com/Collinlong1/aurral/commit/b88eabf9ab1dba4bca8a4b6f477e0efb8898f68c) | 2       | Merge pull request #12 from Collinlong1/claude/fervent-curie-kizyqc                                            | Integration history; current conflict adaptations allocated by net paths      |
| [`cfa5fe26c6a7e4c1ffb37d6190294b6c74bcb122`](https://github.com/Collinlong1/aurral/commit/cfa5fe26c6a7e4c1ffb37d6190294b6c74bcb122) | 1       | refactor(ui): move fork styles out of index.css                                                                | F03 provenance; extract current hunks                                         |
| [`d74343c6a2b8e36409130d9a0dd9934062914199`](https://github.com/Collinlong1/aurral/commit/d74343c6a2b8e36409130d9a0dd9934062914199) | 1       | refactor(library): keep box-set changes out of TrackList and LibraryPage                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`7bd66e39793b32081f897cf3136230f3cf88141f`](https://github.com/Collinlong1/aurral/commit/7bd66e39793b32081f897cf3136230f3cf88141f) | 1       | refactor(scripts): keep custom scripts in their own files                                                      | Retired/superseded/transient or issue refactor; current net map governs       |
| [`afffe9535b15a3cbb35876421a939759aafd0aa1`](https://github.com/Collinlong1/aurral/commit/afffe9535b15a3cbb35876421a939759aafd0aa1) | 1       | refactor(playlists): trim the M3U import                                                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`f12f7bb35a05d461a33dced808735ce2fe584f16`](https://github.com/Collinlong1/aurral/commit/f12f7bb35a05d461a33dced808735ce2fe584f16) | 1       | refactor(subsonic): read the artist-source setting once and trim artist tags                                   | Retired/superseded/transient or issue refactor; current net map governs       |
| [`e480efc267c771fe9cceee547146820d1d7f87a2`](https://github.com/Collinlong1/aurral/commit/e480efc267c771fe9cceee547146820d1d7f87a2) | 1       | refactor(notifications): move per-event webhook bodies out of NotificationsSection                             | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3bdb4e702d1e1befc4330b5f910e41b72f0d808f`](https://github.com/Collinlong1/aurral/commit/3bdb4e702d1e1befc4330b5f910e41b72f0d808f) | 1       | refactor(library): move page-size math out of LibraryPage                                                      | F03, F04 provenance; extract current hunks                                    |
| [`538f94fefa365ace18eb275500833069b5a15761`](https://github.com/Collinlong1/aurral/commit/538f94fefa365ace18eb275500833069b5a15761) | 1       | refactor(activity): move bulk-cancel state out of ActivityPage                                                 | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3cc672fff2980241f7b8ea6723155cc089ed2806`](https://github.com/Collinlong1/aurral/commit/3cc672fff2980241f7b8ea6723155cc089ed2806) | 2       | Merge pull request #13 from Collinlong1/refactor/shrink                                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`a2bbddab730ef83b8740f97c43c26018110a776b`](https://github.com/Collinlong1/aurral/commit/a2bbddab730ef83b8740f97c43c26018110a776b) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`d49700b590a77374fe433a7c3ea6a30ea47f4071`](https://github.com/Collinlong1/aurral/commit/d49700b590a77374fe433a7c3ea6a30ea47f4071) | 2       | Merge pull request #14 from Collinlong1/claude/brave-mccarthy-mu2ok6                                           | Integration history; current conflict adaptations allocated by net paths      |
| [`7982499065ca41259632c30e63cc376fc030f841`](https://github.com/Collinlong1/aurral/commit/7982499065ca41259632c30e63cc376fc030f841) | 2       | Merge upstream lklynet/aurral main (playlist files replace media server integrations)                          | Integration history; current conflict adaptations allocated by net paths      |
| [`a790aaca2e8f03956be8708f9f1f9ea6d28a083a`](https://github.com/Collinlong1/aurral/commit/a790aaca2e8f03956be8708f9f1f9ea6d28a083a) | 1       | feat(wanted): list cancelled tracks under Missing                                                              | F06 provenance; extract current hunks                                         |
| [`404cf3c10af9ed81b2914a6a48ec85617907cc50`](https://github.com/Collinlong1/aurral/commit/404cf3c10af9ed81b2914a6a48ec85617907cc50) | 1       | feat(playlists): reorder a playlist's tracks                                                                   | F07 provenance; extract current hunks                                         |
| [`79b9bef44762ff79152630f84c1592938de25f42`](https://github.com/Collinlong1/aurral/commit/79b9bef44762ff79152630f84c1592938de25f42) | 1       | feat(library): link a Library file to a missing track                                                          | F08 provenance; extract current hunks                                         |
| [`0ef5061d0c29750ccb5f1b88574e73e87047403a`](https://github.com/Collinlong1/aurral/commit/0ef5061d0c29750ccb5f1b88574e73e87047403a) | 1       | feat(library): rank Library file matches and document the new features                                         | F08 provenance; extract current hunks                                         |
| [`1c68fc63c9858ee9505013ca27ff9cf462755984`](https://github.com/Collinlong1/aurral/commit/1c68fc63c9858ee9505013ca27ff9cf462755984) | 1       | feat(library): import a file from disk for a missing track                                                     | F09 provenance; extract current hunks                                         |
| [`aa7f72a7f299afaced069431b4e4de4332064e8c`](https://github.com/Collinlong1/aurral/commit/aa7f72a7f299afaced069431b4e4de4332064e8c) | 1       | feat(playlists): show Library album covers for imported tracks                                                 | F09, F10 provenance; extract current hunks                                    |
| [`0ed7c1b8999c94d388888d45f3f82ba14a103cd9`](https://github.com/Collinlong1/aurral/commit/0ed7c1b8999c94d388888d45f3f82ba14a103cd9) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`4c3c248aa02e8ab259c04aba4b391ffa73f40366`](https://github.com/Collinlong1/aurral/commit/4c3c248aa02e8ab259c04aba4b391ffa73f40366) | 1       | fix(playlists): lay out the M3U folder import like the rest of Import                                          | Retired/superseded/transient or issue refactor; current net map governs       |
| [`dd20b9539d2a9a5e9a26f1845ebbe87719162c73`](https://github.com/Collinlong1/aurral/commit/dd20b9539d2a9a5e9a26f1845ebbe87719162c73) | 1       | fix(artist): show owned albums that aren't in the artist's discography                                         | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b594cfa0fd1d439b67f93a98214bd52fec6df6e4`](https://github.com/Collinlong1/aurral/commit/b594cfa0fd1d439b67f93a98214bd52fec6df6e4) | 2       | Merge upstream lklynet/aurral main (plugins, per-webhook events, lyrics)                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`a071d7a09754970e997252918e553d1f99d526f6`](https://github.com/Collinlong1/aurral/commit/a071d7a09754970e997252918e553d1f99d526f6) | 1       | refactor(notifications): drop per-event webhook bodies for per-webhook events                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`f1a831062bbe5e85c75be9e61804499a6a2fb137`](https://github.com/Collinlong1/aurral/commit/f1a831062bbe5e85c75be9e61804499a6a2fb137) | 1       | feat(scripts): give each script its own events, like webhooks                                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`140d94f2a86d23b5e4e210b28936120b0801a0f6`](https://github.com/Collinlong1/aurral/commit/140d94f2a86d23b5e4e210b28936120b0801a0f6) | 2       | Merge remote-tracking branch 'upstream/main' into sync/upstream-2026-11-05                                     | Integration history; current conflict adaptations allocated by net paths      |
| [`b2cd79967945512c41cbc7580c9a5f2f59978a45`](https://github.com/Collinlong1/aurral/commit/b2cd79967945512c41cbc7580c9a5f2f59978a45) | 1       | fix(subsonic): refresh playlists after a re-tag or an artist source switch                                     | F13 provenance; extract current hunks                                         |
| [`c4648674dc9af2059878b94105b7049a0d523281`](https://github.com/Collinlong1/aurral/commit/c4648674dc9af2059878b94105b7049a0d523281) | 1       | fix(subsonic): link playlist tracks to their Library album by file                                             | F12 provenance; extract current hunks                                         |
| [`e09a41f70fd2eed1878119da4a886b23c6160be7`](https://github.com/Collinlong1/aurral/commit/e09a41f70fd2eed1878119da4a886b23c6160be7) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`eedfb2efd628c5a73ce5afc06e693aa02b80a0bc`](https://github.com/Collinlong1/aurral/commit/eedfb2efd628c5a73ce5afc06e693aa02b80a0bc) | 1       | fix(playlists): show a Library file's current names on playlist rows                                           | F11 provenance; extract current hunks                                         |
| [`b66bcce48648d39255fc8d2e70af6b65876112b7`](https://github.com/Collinlong1/aurral/commit/b66bcce48648d39255fc8d2e70af6b65876112b7) | 1       | feat: show tracks' artist tags throughout Aurral, not only in Subsonic                                         | Retired/superseded/transient or issue refactor; current net map governs       |
| [`ed07bcae381f7b66a9fda3d31cf3cf6ded3cee2c`](https://github.com/Collinlong1/aurral/commit/ed07bcae381f7b66a9fda3d31cf3cf6ded3cee2c) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`2559e85eb5ab02372a19f393b5cb0c029ca409e8`](https://github.com/Collinlong1/aurral/commit/2559e85eb5ab02372a19f393b5cb0c029ca409e8) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`766039b9a501d2d20d079302c0a36d30f14fbfc0`](https://github.com/Collinlong1/aurral/commit/766039b9a501d2d20d079302c0a36d30f14fbfc0) | 2       | Merge pull request #15 from Collinlong1/sync/upstream-2026-11-05                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`4e3b001e7bb4bb43fddc105bd8ee7c3630a6652b`](https://github.com/Collinlong1/aurral/commit/4e3b001e7bb4bb43fddc105bd8ee7c3630a6652b) | 1       | fix(player): show cover art on Apple TV over AirPlay                                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`54f8ec9aa920b13756acf0dbd2ff5f2ff79b6cdf`](https://github.com/Collinlong1/aurral/commit/54f8ec9aa920b13756acf0dbd2ff5f2ff79b6cdf) | 2       | Merge pull request #16 from Collinlong1/fix/airplay-artwork                                                    | Integration history; current conflict adaptations allocated by net paths      |
| [`1f7ec85b4717cd3905844bf42ff7338289fe5c8c`](https://github.com/Collinlong1/aurral/commit/1f7ec85b4717cd3905844bf42ff7338289fe5c8c) | 1       | Revert "fix(player): show cover art on Apple TV over AirPlay"                                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`c958ec46b3a8b3ad283fb399ac05173500637ff1`](https://github.com/Collinlong1/aurral/commit/c958ec46b3a8b3ad283fb399ac05173500637ff1) | 2       | Merge pull request #18 from Collinlong1/revert/airplay-artwork                                                 | Integration history; current conflict adaptations allocated by net paths      |
| [`4c029cd5b86cd66988a46320d3d95846427748dd`](https://github.com/Collinlong1/aurral/commit/4c029cd5b86cd66988a46320d3d95846427748dd) | 1       | feat(playlists): remove the M3U folder import                                                                  | Retired/superseded/transient or issue refactor; current net map governs       |
| [`8db017ca2f218f1c49b84dd62c6817c67f87b3a3`](https://github.com/Collinlong1/aurral/commit/8db017ca2f218f1c49b84dd62c6817c67f87b3a3) | 2       | Merge pull request #19 from Collinlong1/remove/m3u-folder-import                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`5114332ad23a7983c6d115167cbb40e1d4442630`](https://github.com/Collinlong1/aurral/commit/5114332ad23a7983c6d115167cbb40e1d4442630) | 1       | chore(settings): drop the one-time webhook event bodies converter                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`dde619183daa5a5cfa62bb279a4afca4c011b222`](https://github.com/Collinlong1/aurral/commit/dde619183daa5a5cfa62bb279a4afca4c011b222) | 1       | chore(settings): remove the webhook event bodies converter itself                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`903ecb4458f25eab0eb56e0c7bd51ee671e33a91`](https://github.com/Collinlong1/aurral/commit/903ecb4458f25eab0eb56e0c7bd51ee671e33a91) | 2       | Merge pull request #20 from Collinlong1/remove/webhook-bodies-migration                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`5cc5b8fdfa0838e36f2c806253e5c07483a23228`](https://github.com/Collinlong1/aurral/commit/5cc5b8fdfa0838e36f2c806253e5c07483a23228) | 1       | chore(users): remove deleting other admin accounts                                                             | Retired/superseded/transient or issue refactor; current net map governs       |
| [`407cfa015644768968c555e76dde5cf217e4c47d`](https://github.com/Collinlong1/aurral/commit/407cfa015644768968c555e76dde5cf217e4c47d) | 2       | Merge pull request #21 from Collinlong1/remove/delete-admins                                                   | Integration history; current conflict adaptations allocated by net paths      |
| [`5c5bc8f0035e89be4c11eae8d9ffd03076a0fa0c`](https://github.com/Collinlong1/aurral/commit/5c5bc8f0035e89be4c11eae8d9ffd03076a0fa0c) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`e29a72f538ea2ed60bd0bdef17366a2040288a87`](https://github.com/Collinlong1/aurral/commit/e29a72f538ea2ed60bd0bdef17366a2040288a87) | 1       | fix(library): drop the fork's load-every-page album and artist fetch                                           | Retired/superseded/transient or issue refactor; current net map governs       |
| [`1ca2752073b1c353081bb2b223843db76eab6566`](https://github.com/Collinlong1/aurral/commit/1ca2752073b1c353081bb2b223843db76eab6566) | 2       | Merge pull request #22 from Collinlong1/sync/upstream-2026-11-06                                               | Integration history; current conflict adaptations allocated by net paths      |
| [`45863a68779a36c6ef5bdc9bb6a5408ddc2aa22c`](https://github.com/Collinlong1/aurral/commit/45863a68779a36c6ef5bdc9bb6a5408ddc2aa22c) | 2       | Merge pull request #23 from Collinlong1/fix/drop-show-every-track                                              | Integration history; current conflict adaptations allocated by net paths      |
| [`7880950efee092526cc9dd3f3c1e9c3775e9b663`](https://github.com/Collinlong1/aurral/commit/7880950efee092526cc9dd3f3c1e9c3775e9b663) | 1       | feat(library): remove box-set naming and the box set's own cover                                               | Retired/superseded/transient or issue refactor; current net map governs       |
| [`2878a90da2e4fa1bba101233a712768465a276f5`](https://github.com/Collinlong1/aurral/commit/2878a90da2e4fa1bba101233a712768465a276f5) | 2       | Merge pull request #24 from Collinlong1/fix/drop-box-set-naming-cover                                          | Integration history; current conflict adaptations allocated by net paths      |
| [`cea3d0890725cbee3d285253fc73b01dd20bf026`](https://github.com/Collinlong1/aurral/commit/cea3d0890725cbee3d285253fc73b01dd20bf026) | 1       | feat(library): name box set discs after their disc subtitle tag                                                | Retired/superseded/transient or issue refactor; current net map governs       |
| [`2e5e8555bd1e072d0b121fdc67c5c667c91e1c6b`](https://github.com/Collinlong1/aurral/commit/2e5e8555bd1e072d0b121fdc67c5c667c91e1c6b) | 1       | Revert "feat: show tracks' artist tags throughout Aurral, not only in Subsonic"                                | Retired/superseded/transient or issue refactor; current net map governs       |
| [`a77c3af3c4d05213668962be83189e1db237d6d9`](https://github.com/Collinlong1/aurral/commit/a77c3af3c4d05213668962be83189e1db237d6d9) | 1       | chore(subsonic): stop tracking artist source switches for refreshes                                            | Retired/superseded/transient or issue refactor; current net map governs       |
| [`866a26cdd8a639cc39c2383642fbd59d25553370`](https://github.com/Collinlong1/aurral/commit/866a26cdd8a639cc39c2383642fbd59d25553370) | 1       | Revert "fix(subsonic): keep compilation track artists with artist tags on"                                     | Retired/superseded/transient or issue refactor; current net map governs       |
| [`17b4960fabef4376fcf9ba2da246e5ac386b1b84`](https://github.com/Collinlong1/aurral/commit/17b4960fabef4376fcf9ba2da246e5ac386b1b84) | 1       | chore(subsonic): remove serving artist names from file tags                                                    | Retired/superseded/transient or issue refactor; current net map governs       |
| [`8a26f2dac392c447d3cd68ea28f95809da585b67`](https://github.com/Collinlong1/aurral/commit/8a26f2dac392c447d3cd68ea28f95809da585b67) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`6576f6f93841704b18cdddae1a0d039da38a9e31`](https://github.com/Collinlong1/aurral/commit/6576f6f93841704b18cdddae1a0d039da38a9e31) | 1       | fix(scripts): queue custom scripts on Aurral's own job queue                                                   | Retired/superseded/transient or issue refactor; current net map governs       |
| [`ecd3a7ce893aa190532c500e388647204cff1f7f`](https://github.com/Collinlong1/aurral/commit/ecd3a7ce893aa190532c500e388647204cff1f7f) | 1       | chore(activity): remove bulk-cancel of queued downloads                                                        | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3b6cae5d91b60a714a7e1a352c627ad44f9ef816`](https://github.com/Collinlong1/aurral/commit/3b6cae5d91b60a714a7e1a352c627ad44f9ef816) | 1       | chore(library): drop the fork's retagged-copy fix                                                              | Retired/superseded/transient or issue refactor; current net map governs       |
| [`95392a6f579a1c660e8a66242948ae020016fd98`](https://github.com/Collinlong1/aurral/commit/95392a6f579a1c660e8a66242948ae020016fd98) | 1       | chore(artist): drop the fork's owned-albums-outside-discography rail fix                                       | Retired/superseded/transient or issue refactor; current net map governs       |
| [`b7d40433f1bedc9949c011514b60d39f7a17a740`](https://github.com/Collinlong1/aurral/commit/b7d40433f1bedc9949c011514b60d39f7a17a740) | 1       | chore(scripts): remove the built-in custom scripts feature                                                     | Retired/superseded/transient or issue refactor; current net map governs       |
| [`3cc4f3fc44e0d279d45c88e6bc88394cccc5c5c6`](https://github.com/Collinlong1/aurral/commit/3cc4f3fc44e0d279d45c88e6bc88394cccc5c5c6) | 1       | chore(scripts): drop the script-events settings migration                                                      | Retired/superseded/transient or issue refactor; current net map governs       |
| [`8c228c11d2ff8c3f97b18fcc18ad6d547e560571`](https://github.com/Collinlong1/aurral/commit/8c228c11d2ff8c3f97b18fcc18ad6d547e560571) | 2       | Merge upstream lklynet/aurral main (playlists point at Library tracks, app API v2)                             | Integration history; current conflict adaptations allocated by net paths      |
| [`58667789c3d2d14e89c898355579e66a4a79d0a5`](https://github.com/Collinlong1/aurral/commit/58667789c3d2d14e89c898355579e66a4a79d0a5) | 1       | chore(playlists): drop the fork's Library album cover fallback for playlist tracks                             | F10 provenance; extract current hunks                                         |
| [`718a79e514389c0436d61926f8666f59e79de5f7`](https://github.com/Collinlong1/aurral/commit/718a79e514389c0436d61926f8666f59e79de5f7) | 2       | Merge upstream lklynet/aurral main (disc headings on multi-disc albums)                                        | Integration history; current conflict adaptations allocated by net paths      |
| [`37b670eb6142301541cd4948e14b726af57ce991`](https://github.com/Collinlong1/aurral/commit/37b670eb6142301541cd4948e14b726af57ce991) | 1       | fix(playlists): bring back Library album covers for linked and imported playlist tracks                        | F10 provenance; extract current hunks                                         |
| [`b34c910c084f56071343dc21f71e3399cab2f7df`](https://github.com/Collinlong1/aurral/commit/b34c910c084f56071343dc21f71e3399cab2f7df) | 2       | Merge upstream lklynet/aurral main                                                                             | Integration history; current conflict adaptations allocated by net paths      |
| [`d840e5b34965989df9bb5315cc22a8118db87d47`](https://github.com/Collinlong1/aurral/commit/d840e5b34965989df9bb5315cc22a8118db87d47) | 1       | test(perf): record the fork's Subsonic playlist query count                                                    | F12 provenance; extract current hunks                                         |
| [`11e8cff64551fa2810fc9484aa99a1d6b5d8009a`](https://github.com/Collinlong1/aurral/commit/11e8cff64551fa2810fc9484aa99a1d6b5d8009a) | 1       | fix(downloads): starting a running worker wakes it for newly queued jobs                                       | F14 provenance; extract current hunks                                         |
| [`a544a9b81ddd748bc26b72347703a4934f36ff4b`](https://github.com/Collinlong1/aurral/commit/a544a9b81ddd748bc26b72347703a4934f36ff4b) | 1       | fix(plugins): updates install when staging is on another disk, and roll back on failure                        | F15 provenance; extract current hunks                                         |
| [`d4deed1011913bb2f43cd47752db28da08c0be1f`](https://github.com/Collinlong1/aurral/commit/d4deed1011913bb2f43cd47752db28da08c0be1f) | 1       | fix(matching): a file tagged with the requested recording ID is no artist contradiction                        | F16 provenance; extract current hunks                                         |
| [`35493262815bf32e76084a2587b9583d9d15cb47`](https://github.com/Collinlong1/aurral/commit/35493262815bf32e76084a2587b9583d9d15cb47) | 2       | Merge upstream, wake the worker for new requests, plugin updates across disks, classical artist matching (#27) | Integration history; current conflict adaptations allocated by net paths      |
| [`e97d3380880e8194fb36e58a9f81d25eefad9cd0`](https://github.com/Collinlong1/aurral/commit/e97d3380880e8194fb36e58a9f81d25eefad9cd0) | 2       | Merge pull request #28 from lklynet/main                                                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`287ab4b76ca8a9d231b684089d02ddc9d9ea70a2`](https://github.com/Collinlong1/aurral/commit/287ab4b76ca8a9d231b684089d02ddc9d9ea70a2) | 2       | Merge pull request #29 from lklynet/main                                                                       | Integration history; current conflict adaptations allocated by net paths      |
| [`aa643d316e9e00fb8622ab60b2fb2cb8b76661ee`](https://github.com/Collinlong1/aurral/commit/aa643d316e9e00fb8622ab60b2fb2cb8b76661ee) | 2       | Merge pull request #30 from lklynet/main                                                                       | Upstream refresh only; no new fork feature                                    |
| [`c0deb211eba929424b608ca1c2449c7242892d9c`](https://github.com/Collinlong1/aurral/commit/c0deb211eba929424b608ca1c2449c7242892d9c) | 2       | Merge pull request #31 from lklynet/main                                                                       | External upstream refresh observed at final verification; no new fork feature |

## Unchanged baseline findings

The unchanged fork full unit run passed 2,743 tests and timed out one unchanged slskd-client deadline test during concurrent builders; the affected file then passed all 28 tests under normal load. This is not reported as one uninterrupted green full-suite run. Main source was never changed.

Its application build, generated DB types, UI CSS and typecheck pass. Its existing check command is red: jobs.ts formatting, unused LinkLibraryFileResult/ImportDiskFileResult type imports, and two unsafe-any findings in ActivityMissingPage query-cache filtering. Those source issues are absent from independently validated branches after extraction; neither main nor the reused classical source baseline was silently cleaned up. Phase 1 should first make the classical baseline checks green after approval.

## Existing classical branches

Reuse was expressly confirmed by the user. Fork classical began at 287ab4b76ca8a9d231b684089d02ddc9d9ea70a2 and is fast-forwarded through the frozen entry-main ancestry, then receives handoff docs. Plugin classical began at 506e5259e1442b8cfe072a75b129abb428c6bcf7 and receives docs only. No branch deletion/reset/force push, main merge, upstream write or PR. Stop for review before Phase 1.

# Phase 1 inventory addendum — November 10, 2026

User authorized Phase 1 and fork-only PRs targeting aurral-classical. Read PHASE_1_REPORT.md and HANDOFF.md for current implementation, files, tests and source state. The Phase 0/0.5 inventory below is historical preservation evidence.

External merges advanced core main to 3739443a and classical to 1b3c1c00; the agent preserved these changes on the review branch and did not write main. Matching upstream is now 021b1f03. Live main still has the same 52 net changed paths (+3130/-181), now 111 historical fork-only commits. All 16 preservation branches remain unchanged on 7afcb7cb. New Phase 1 hooks/fixes are separate from F01–F16 and are documented as D02/D03/D06/D07 in central UPSTREAM_DELTA.md. No upstream PR was opened.
