# Aurral Classical — Deployment Spec v3.2

Nov 10, 2026 · @Collin Long

## Summary

Aurral Classical ships first as v0.1: four bug fixes, a structured classical data model, a manual editor, work grouping, and a basic work page, running on Collin's Aurral fork (latest nightly). Everything else from the original scope moves to later releases.

**Goal:** an Apple Music Classical-style experience inside Aurral that works without MusicBrainz, and that eventually ships as a community release, since no good self-hosted alternative exists.

**What changed from the original scope:**

- A defined v0.1 release instead of seven phases treated as one release.
- Provider-first precedence, with manual metadata as the fallback and pinned overrides.
- Core changes live in the fork; the plugin produces an Upstream Delta report listing what stock Aurral would need.
- Plugin data lives in plugin-owned storage, not mixed into Aurral's schema.
- Aurral is the only client. Navidrome is out of scope, so file-tag writing becomes optional rather than required.
- New sections for deployment, rollback, multi-user access, and community release.
- The dev instance runs locally or in CI, never on the server.
- The model-allocation section is removed; it is workflow, not spec.

## Release plan

Each release must be usable on Collin's server on its own; nothing waits on a later release to work.

| Release | Contents | Done when |
| --- | --- | --- |
| v0.1 Foundation | Four bug fixes; work/movement/recording/release model; provider + manual metadata with provenance; manual editor; movement grouping on album pages; play-whole-work; basic work page listing all owned recordings | Acceptance list in Phase 1–4 passes on the test fixtures and on Collin's library |
| v0.2 Search | Classical library search (aliases, catalogue/opus numbers, nicknames, role-aware results, filters); slskd performer-first queries and ranking; cross-release comparisons and playlists | "Moonlight Sonata", "Op. 27 No. 2", and "Piano Sonata No. 14" all resolve to one work; slskd never uses the composer as the artist |
| v0.3 Pages | Composer, performer, conductor, and ensemble pages; richer work page; optional file-tag writing with preview | Every entity in a work page links to a working page |
| v0.4 Discover | Classical Discover (period, form, instrument, composer); collection reports; automatic playlists; missing-movement detection | Discover and reports use only the shared model |
| v1.0 Community | Install docs, config UI, upgrade path, Upstream Delta report finalised, public release | Community release checklist passes |

## Apple Music Classical reference

Every release should mimic how Apple Music Classical behaves, adapted to a personal library: the same organisation, naming, search, and browse patterns, without Apple's assets or editorial catalogue.

**Work organisation (v0.1)**

- Work is the central unit: looking up a work shows all its recordings, and searching a composer shows all their works.
- The library can hold works, composers, and recordings, not just albums, tracks, and artists. User-specific favourites for works, recordings, and composers are distinct from user-specific "Your pick" and the admin pick.
- Each recording on a work page is identified by its principal performers (soloist, conductor, orchestra), with album artwork and year.
- Recordings list sorts by popularity (play count in Aurral), name, release date, and length. Oldest-first is supported.
- Apple's "Editor's Choice" becomes **"Your pick"**: a recording the user (or admin, server-wide) marks as preferred, shown at the top of the work page. A user's favourite recordings also appear on the work page, a gap Apple users have asked for.

**Naming and tagging conventions (v0.1 display, v0.3 file writing)**

Follow the Apple/iTunes Style Guide and the Music Biz Classical Metadata Style Guide:

- **Composer names:** standard full name, no abbreviations or commas ("Johann Sebastian Bach", not "Bach, J.S."). Display short form ("Bach") only in compact views.
- **Work title:** Work type + number + key + catalogue, then nickname in quotes, e.g. `Symphony No. 3 in E-Flat Major, Op. 55 "Eroica"`. Type comes first ("Sonata for Piano Four Hands").
- **Movement title:** `Work: Roman numeral. Movement title`, e.g. `Symphony No. 3 in E-Flat Major, Op. 55 "Eroica": I. Allegro con brio`.
- **Album title:** `Composer(s): Works`, e.g. `Beethoven & Bach: Collected Symphonies`.
- **Catalogue abbreviations:** standard forms (BWV, K., Hob., D., RV, S.), with the catalogue list from the style guide's appendix used by the search normaliser.
- **File tags:** write Apple's own fields (WORK, MOVEMENTNAME, MOVEMENT, MOVEMENTTOTAL, SHOWMOVEMENT) so files display correctly in Apple Music, iTunes, and other players too.
- The plugin can **generate** these titles from structured data; it never overwrites a user's file title without preview.

**Configurable artist field (kept from the current plugin).** What goes in the track and album ARTIST field stays a setting, with Apple's convention as the default:

- **Default (Apple convention):** principal performers as the artist (soloist, then conductor, then orchestra/ensemble), composer in COMPOSER only.
- **Options carried over from the current plugin:** composer as artist; composer + performers; soloist only; conductor + orchestra; or a custom template built from role fields (e.g. `{soloist}; {conductor}; {orchestra}`).
- Set server-wide by the admin, with a per-album override in the editor.
- The setting only changes the ARTIST display and file tag. Role-aware credits, search, slskd queries, and pages always use the structured roles, so changing it never breaks the composer/performer distinction.
- Changing the setting shows a preview of affected albums before applying; file tags update only through the normal tag-write flow.

**Search (v0.2)**

- Free combinations of keywords: composer + work type + number, opus number, conductor, performer, instrument, nickname. "Beethoven 5" returns every Beethoven work numbered 5 (symphony, concerto, sonata), symphony first.
- Results show Works first, then Recordings, Composers, Performers, Albums, matching Apple's work-first ordering.
- Fix the gaps Apple users report: misspelled composer aliases ("Burd" → Byrd) and choral or liturgical shorthand ("Dyson in D" → Dyson's Canticles in D) via alias tables.
- Search inside the user's own library includes albums as well as works and recordings (a known Apple gap).

**Browse and Discover (v0.4)**

Mirror Apple's Browse categories, built from the user's library:

- Composers, Periods, Genres (chamber music, stage works, orchestral, choral, keyboard, vocal), Conductors, Orchestras, Ensembles, Choirs, Instruments, and Vocal range (soprano, tenor, baritone, etc.).
- **Essentials playlists** per composer and period, generated from the library (most-played and Your-pick recordings).
- **Hidden gems:** owned works rarely played.
- **Composer, undiscovered:** owned works by a composer outside their most-played.
- **Mood playlists** (Chill, Focus, Sleep, Dinner) only as admin-curated or rule-based lists; no ML.
- Composer pages show a portrait only if a freely licensed image exists (e.g. Wikimedia Commons); otherwise a generated monogram. Never Apple's commissioned portraits.

**Where Aurral Classical goes beyond Apple**

- Works and recordings without any catalogue match (broadcasts, private recordings) are first-class.
- Incomplete works show which movements are missing.
- Comparisons across recordings are a built-in view, not just a list.

**Not copied:** Apple's editorial bios and guides, booklets, The Story of Classical audio guides, commissioned artwork, and branding.

Sources: [Apple Newsroom launch](https://www.apple.com/lu/newsroom/2023/03/apple-music-classical-is-here/) · [App Store story](https://apps.apple.com/jp/story/id1669811957?l=en-US) · [TechCrunch](https://techcrunch.com/?p=2519975) · [Cult of Mac guide](https://www.cultofmac.com/?p=810865) · [App Store reviews](https://apps.apple.com/gb/app/id1598433714) · [Music Biz Classical Metadata Style Guide](https://musicbiz.org/wp-content/uploads/2016/04/Classical_MetadataStyleGuide_v1.pdf) · [Hypebot: Classical metadata 101](https://www.hypebot.com/hypebot/2016/04/classical-music-metadata-101.html) · [Macworld: Work and Movement tags](https://www.macworld.com/article/228807/how-to-better-organize-classical-music-in-itunes.html)

## Architecture

One plugin (Collinlong1/Aurral-Classical-Plugin) does the classical work; the fork (Collinlong1/aurral) carries only small, generic core hooks; no separate service.

**Repos**

- **Plugin** — all classical logic: model, providers, editor, grouping rules, search, slskd queries, comparisons, pages.
- **Fork** — generic core hooks only (grouped tracks in album API, plugin search hooks, plugin pages/tabs, user-owned plugin playlists, queue resolution of plugin track references). Tracks upstream lklynet/aurral nightly.
- **Upstream** — untouched by this project; receives PRs only when Collin chooses.

**Versioned integration contract (Phase 0 deliverable)**

Document plugin initialization/capabilities, auth and user context, API schemas, grouping/queue operations, pages/navigation, search, feature flags, and failure fallback. Verify each feature on stock Aurral versus the fork; do not assume fallback pages/editor work until tested.

**Minimising core changes**

- Default to the plugin. A core change is allowed only when the plugin API cannot do it, and each one must be generic (useful to any plugin), additive, off by default, and behind a feature check.
- The plugin detects which hooks exist at startup and degrades: on stock Aurral it still runs the model, editor, and work page; features needing missing hooks are hidden, not broken.
- Keep classical development on `aurral-classical`. Preserve existing fork-only features on separate, single-issue branches based on the matching upstream commit, ready for possible upstream PRs.

**Upstream Delta report** (required deliverable, kept current every release)

A file `UPSTREAM_DELTA.md` in the plugin repo, plus an in-app diagnostics panel, listing for every core change:

- What it does and which plugin features depend on it.
- Files touched and approximate diff size.
- Whether it changes the database, API responses, or UI.
- Backward-compatibility notes and test coverage.
- What the plugin does when the hook is absent.
- PR-readiness: draft, ready, submitted, merged.

**Data storage**

- Prefer an independent plugin database (SQLite if runtime, concurrency, and persistence permit). Phase 0 validates the choice; no dependency on undocumented Aurral tables or direct writes to Aurral-owned tables.
- Aurral's own tables are never altered by the plugin. Links to Aurral tracks use Aurral's track IDs plus a reconciliation evidence (path, duration, size, available stable file identifiers and optional audio fingerprint). Renames/moves and duplicates are matched conservatively; ambiguous links require review, never silent reassignment.
- Disabling the plugin restores stock Aurral UI and behavior without deleting plugin data; optional file-tag writes require separate restoration.

**Background jobs (v0.1 infrastructure)**

Identification, matching, rescans, and refresh run outside page requests with persistent state, bounded concurrency, retries, cancellation, rate limits, and restart recovery. Full progress UI may wait until v1.0. Playback must remain unaffected.

**External data**

- MusicBrainz: primary provider. Limit 1 request/second, identifying User-Agent, local response cache.
- Open Opus (or similar open data): candidate source for composer period, popular works, and work forms, which MusicBrainz covers poorly. Phase 0 confirms licence and coverage.
- No provider is required for the plugin to function.

## Metadata model and precedence

**Entities:** composer; work; movement; collection/parent work; performance (specific interpretation/event); recording (audio capture or edit); release (publication/album); track (Aurral playable item); segment (time range within a track); role-aware contributor. Internal IDs never depend on MusicBrainz. One recording may appear on multiple releases; one track may contain multiple segments/works; collections may contain independently playable works (e.g. Chopin Études, Op. 10). Specify cardinalities, constraints, and link tables in Phase 0.

**Precedence (per field)**

1. **Pinned manual override**, including an intentionally blank value.
2. **Provider** (MusicBrainz, then Open Opus), with deterministic field-specific priority.
3. **Unpinned manual** value where providers have none.
4. **Derived** value; otherwise unknown.

Provider conflicts, deleted records, and stale cache entries are retained for review, never silently substituted for pinned values.

**Pinned overrides.** When a user edits a field that a provider filled, the edit is saved as a pinned override. Provider refreshes update the underlying provider value but never replace a pinned field. The editor shows both values and offers "use provider value" to unpin. This keeps provider-first behaviour without letting a refresh silently undo a correction.

**Provenance stored per field:** source, source record ID, pinned yes/no, last updated, match confidence.

**Matching safety**

- Automatic provider matches below a confidence threshold are queued for review, not applied.
- No silent merging of works or recordings; merges are explicit user actions and reversible.

**Audio-file tags**

- The plugin database is authoritative. Since Aurral is the only client, file-tag writing is optional and arrives in v0.3, behind preview, with read-only media fully supported.
- Reading existing tags (WORK, MOVEMENTNAME, MOVEMENT, MOVEMENTTOTAL, COMPOSER, CONDUCTOR, etc.) is in v0.1 as an identification hint.
- Include versioned tag mappings and grouping rules in an appendix before Phase 1; no reliance on unavailable original-scope sections.

## Users and access

Admins manage metadata; every user can browse, play, compare, and own playlists.

| Action | Admin | User |
| --- | --- | --- |
| Browse work, composer, performer pages | Yes | Yes |
| Search and Discover | Yes | Yes |
| Play works, movements, comparisons | Yes | Yes |
| Create and own comparison / classical playlists | Yes | Yes (their own) |
| Edit metadata, pin overrides, merge entities | Yes | No |
| Run identification, tagging, file writes | Yes | No |
| Trigger slskd acquisition | Per existing Aurral permission | Per existing Aurral permission |
| View diagnostics and Upstream Delta | Yes | No |

- Permissions reuse Aurral's existing roles; the plugin adds no separate user system. Authentik continues to sit in front of Aurral.
- Playlists belong to the user who made them, never to the admin or the plugin.
- Open question for v0.4+: let users suggest metadata corrections for admin approval.

## Mixed libraries: classical and non-classical side by side

Everything in this spec applies only to music the plugin classifies as classical; every other album behaves exactly as stock Aurral does, on the same server and in the same library.

**Classification (v0.1, refining the current plugin's detection)**

- Each album and track gets a stored flag: **classical**, **not classical**, or **unsure**.
- Signals, combined into a score: genre tag (Classical, Opera, Baroque, Chamber, etc.); a WORK or MOVEMENT tag; a composer different from the performer; a catalogue number in the title; a MusicBrainz work relationship with a classical composer; a label known for classical releases; Apple-style track titles ("Work: I. Movement").
- Unsure items are not treated as classical until the admin confirms, and appear in a review list.
- **Manual override always wins:** admin can mark any album, artist, or folder as classical or not classical, and that pin survives rescans.
- Optional rule: treat a whole library folder as classical (e.g. `/music/classical`).
- Mixed albums are handled per track: a film soundtrack with one Bach piece, or a crossover album, can have only the classical tracks flagged.

**What the flag controls**

| Feature | Classical items | Everything else |
| --- | --- | --- |
| Album page | Work grouping, By Work / By Track toggle | Stock Aurral album page |
| Artist field | Configurable (Apple default) | Untouched |
| Search | Classical results and filters added | Stock Aurral search results, unchanged ranking |
| slskd | Performer-first classical query ladder | Stock Aurral queries |
| Discover | Classical sections | Stock Aurral Discover |
| Tagging and identification | Plugin may read/write | Never touched |
| Pages | Work, composer, performer pages | Stock artist/album pages |

- Non-classical artists who also appear on classical recordings (e.g. a jazz pianist playing Bach) keep their normal Aurral artist page; a classical performer page is added alongside, not in place of it.
- Playlists, queues, and playback mix both freely.

**Acceptance (added to Phase 2 and Phase 4)**

- [ ] Rock, jazz, pop, electronic, and soundtrack fixtures are classified not classical and look, search, and download exactly as on stock Aurral.
- [ ] A crossover/soundtrack fixture flags only its classical tracks.
- [ ] Admin override survives a full rescan and a provider refresh.
- [ ] The plugin never writes tags to a non-classical file.
- [ ] Disabling the plugin returns every album to stock behaviour.

## Settings

Settings are split into server-wide (admin) and per-user; a few core behaviours are deliberately fixed.

**Server-wide (admin)**

| Setting | Options | Default |
| --- | --- | --- |
| Artist field | Apple convention; composer; composer + performers; soloist; conductor + orchestra; custom template | Apple convention |
| Classical detection | Score threshold; folder rules; genre list | Plugin defaults |
| Grouping rules | Forms that group into works; per-album override | Apple-style allowlist (sonata, symphony, concerto, suite, quartet…) |
| Title display | Full Apple-style or short | Full |
| Movement numbers | Roman or Arabic | Roman |
| Composer name | Full name; surname; "Surname, First" for sorting | Full name, sorted by surname |
| Title language | Original language or English where available | Original |
| Providers | MusicBrainz on/off; Open Opus on/off; refresh interval | Both on; weekly |
| Auto-match threshold | Confidence above which matches apply without review | High (conservative) |
| Tag writing | Off; preview only; allowed; fields allowed | Off |
| "Your pick" scope | Server-wide (admin) or per user | Both: admin pick shown, user pick overrides for that user |
| Recording sort default | Popularity, date, oldest first, length | Popularity |

**Per user**

| Setting | Options | Default |
| --- | --- | --- |
| Default album view | By Work or By Track | By Work |
| Show incomplete works in Discover | On/off | On |
| Automatic playlists | On/off per type | On |
| Recording sort | Overrides server default | Server default |

**Fixed (not configurable)**

- Precedence order and pinned overrides — configurable precedence risks silent data loss.
- Role definitions (composer, soloist, conductor, orchestra, etc.) — everything depends on them.
- slskd query ladder — hidden as an advanced setting at most.
- Non-classical items are never processed, regardless of settings.

## Deployment, migrations, rollback

Collin deploys manually from tagged builds of `aurral-classical`; nothing deploys automatically and nothing from the server is committed.

**Branch isolation:** Create `aurral-classical` from the fork’s current `main` after Phase 0 approval. All classical core development and test builds use this branch; keep `main` unchanged. The plugin uses a matching `aurral-classical` branch. Never merge into `main` without explicit approval. Switching back to the original fork build must not require a Git merge or discard classical data; restore a compatible backup if migrations changed shared state.

**Existing fork features: inventory and isolation (before classical implementation)**

- Phase 0 audits **all** differences between the current fork and its matching upstream base, including fixes, features, and configuration changes. Record purpose, files/commits, dependencies, tests, and upstream PR suitability in `FORK_FEATURE_INVENTORY.md`.
- After approval, create one clearly named `feature/<issue-name>` or `fix/<issue-name>` branch **per independent issue**, based on the matching upstream commit. Each branch contains only that issue's changes and tests; split mixed commits as needed. Do not open PRs without approval.
- Verify each branch builds and passes relevant tests independently. Document unavoidable dependencies; never claim a branch is isolated if it requires another change.
- Preserve existing fork `main` unchanged. Create `aurral-classical` from that current `main` only after the inventory and isolation work is approved and completed. No existing features may be lost.

**Release artifacts**

- Plugin: semver-tagged GitHub release with changelog and a declared minimum Aurral nightly.
- Fork: tagged build per plugin release, rebased on a known-good upstream nightly; the tag notes which nightly it is based on.

**Deploy steps (documented in the repo as a checklist)**

1. Read the changelog and migration notes.
2. Back up Aurral's config directory and the plugin's data store.
3. Check free space, permissions, version compatibility, and verified backups; quiesce jobs. Pull immutable fork image digest and plugin release.
4. Start Aurral; run transactional migrations and compatibility checks; report results in diagnostics.
5. Smoke test metadata, work grouping, playback, permissions, and applicable search; resume jobs only after success. Record deployed versions and results.

**Migrations**

- Versioned, forward-only, each tested on a copy of fixture data and on an anonymised snapshot of a real library.
- Migrations are transactional where supported; failures leave a consistent recoverable state and disable the plugin with a clear error.
- Plugin migrations never touch Aurral tables.

**Rollback**

- Stop Aurral, restore compatible backups, start the previous pinned fork and plugin versions; separately restore any file-tag edits if needed.
- Disabling restores stock behavior, but is not a database-version rollback.

**Operational acceptance (every release)**

- [ ] Plugin/provider failures do not interrupt ordinary playback; jobs survive restarts.
- [ ] Rescans preserve pinned edits and never silently merge ambiguous recordings.
- [ ] Non-admin mutation requests are rejected; user favourites/playlists remain isolated.
- [ ] Failed migrations recover; backup restoration and version rollback are tested.
- [ ] Provider rate limits, timeouts, and malformed responses are handled.
- [ ] Identification does not block playback; errors and matching decisions are diagnosable.
- [ ] Stock-vs-fork compatibility and non-classical regressions pass.

**Nightly drift**

- Aurral nightly changes often. CI runs the plugin test suite against the latest upstream nightly weekly, and the Upstream Delta report flags hooks that no longer apply cleanly.

## Dev environment and security

Claude Code works only in the repos and a local or CI Aurral instance; it never touches Collin's server.

- **Dev instance:** a Docker Compose file in the plugin repo that starts the fork plus the plugin on Collin's own computer or in GitHub Actions, with its own config and database.
- **Test library:** small synthetic audio files (a few seconds each, generated by a script) with fixture tags, committed to the repo. They cover the following cases (this is the authoritative fixture list): étude set, sonata, symphony cycle, concerto, multiple recordings, one recording on several releases, broadcast without MusicBrainz, incomplete work, attacca single track, multivalue performers, non-classical album.
- **MusicBrainz in tests:** recorded responses (fixtures), so tests never call the live API.
- **Real-library check:** Collin runs a read-only dry-run on his real library himself and shares the report; Claude never gets production credentials.
- **Secrets:** environment variables only; never printed, logged, or committed.
- **Git:** after Phase 0 approval, work on `aurral-classical` in both repos; preserve fork `main`, focused commits, tests before PRs, no automatic deploys. Each phase ends with a report of files changed, tests, migrations, and open issues.

## Phases and acceptance criteria

Phases 0–4 make up v0.1. Each phase stops for Collin's review before the next begins.

**Phase 0 — Audit (no code changes)**

- [ ] Inventory of plugin repo, **every existing fork-only change** against its matching upstream base, and Aurral plugin API capabilities and gaps. Produce `FORK_FEATURE_INVENTORY.md` with one proposed single-issue branch per change, dependencies, and PR suitability.
- [ ] Root cause traced for all four known bugs.
- [ ] Decision: plugin-owned tables vs separate SQLite file.
- [ ] Draft complete entity/segment/collection schema, provenance design, and first Upstream Delta list.
- [ ] Versioned core/plugin integration contract and stock-vs-fork compatibility matrix.
- [ ] Track reconciliation and persistent background-job design.
- [ ] Dependency-ordered implementation plan with acceptance tests; stop for approval.
- [ ] Open Opus licence and coverage check.

**Phase 0.5 — Preserve existing fork features (after approval)**

- [ ] Create and independently test one upstream-based `feature/` or `fix/` branch per existing fork-only issue, with no unrelated changes.
- [ ] Record branch names, base commits, included commits, tests, and dependencies in `FORK_FEATURE_INVENTORY.md`.
- [ ] Confirm fork `main` remains unchanged and existing features still work; then create `aurral-classical` from `main` in both repos.
- [ ] Stop for approval before Phase 1. No upstream PRs or merges without approval.

**Phase 1 — Dev setup and bug fixes**

- [ ] Compose dev instance and synthetic test library run in CI.
- [ ] Compare Tracks includes every owned recording of the work, across releases.
- [ ] Comparison playlists play local tracks for both admin and regular users.
- [ ] Removing a 7-value multivalue tag removes all 7; re-reading confirms it.
- [ ] slskd queries use performer, not composer, as the artist (regression test with Liszt/Trifonov fixture).

**Phase 2 — Data model**

- [ ] All entities stored with internal IDs; works exist with no external ID.
- [ ] Provider-first precedence and pinned overrides pass tests: refresh never replaces a pinned field.
- [ ] Track links survive a full rescan.
- [ ] Migrations are transactional; failures recover cleanly and backups restore a compatible earlier version.

**Phase 3 — Manual editor**

- [ ] Admin can create a composer, a multi-movement work, and a broadcast recording with no MusicBrainz data.
- [ ] Admin can reorder movements and attach tracks to a work.
- [ ] Editor shows provider vs pinned values with "use provider value".
- [ ] Works with read-only media.
- [ ] Pinned blank values and provider conflicts survive refresh.

**Phase 4 — Grouping, playback, work page**

- [ ] Sonata and symphony fixtures group by work; an étude set supports both parent collection and independently playable études.
- [ ] By Work / By Track toggle appears only on albums with multi-movement works.
- [ ] Play-whole-work queues movements in movement order, skipping missing ones.
- [ ] Work page lists every owned recording of the work across albums.
- [ ] Non-classical fixture album looks and plays exactly as before.
- [ ] Per-user favourites and picks are isolated; admin pick is the fallback.
- [ ] Work playback handles missing/repeated movements and multi-work tracks without mixing recordings.

**Later phases** follow the release table: v0.2 search and slskd ranking, v0.3 pages and tag writing, v0.4 Discover and reports, v1.0 community release. Each gets its own acceptance list written at the end of the previous release.

## v0.2 Search scope

v0.2 makes classical music findable: library search, slskd acquisition, and comparisons all read the v0.1 model.

**In scope**

- Search index (plugin-owned) over works, movements, composers, performers, ensembles, recordings, releases; document ranking weights, ambiguity handling, and deduplication.
- Matching on canonical titles, alternate titles, nicknames, catalogue numbers (BWV, K., Op./No., Hob., D., S.), composer and performer aliases, transliterations, accent-insensitive and partial matches.
- Catalogue-number normaliser: "Op 27 no 2", "Op.27/2", "op. 27, No. 2" become one key.
- Typed results (Work, Composer, Performer, Recording, Release, Movement), each linking to its page or album.
- Filters: composer, period, form, instrument, performer, conductor, ensemble, recording type, year, in library.
- slskd query ladder (performer + album, performer + work, conductor/orchestra + album, performer + composer + work, broad work search), stopping only at a result set meeting defined score and completeness thresholds.
- slskd ranking scored on performer, conductor, ensemble, work, movement, release, catalogue number; composer-only matches rank last. Reject wrong performers; prefer complete releases, detect duplicates, require review for ambiguous results, and show query/ranking diagnostics. Preserve existing acquisition/import checks.
- Comparisons: distinguish full-work recordings from individual-movement recordings; pick a work or movement, see every owned recording side by side (performers, date, label, duration per movement), play any, save as a user-owned playlist.
- Core hook (fork): plugin search provider in Aurral's search box. Without it, search lives on a plugin page.

**Out of scope:** Discover, recommendations, fuzzy matching across languages beyond aliases.

**Acceptance**

- [ ] "Moonlight Sonata", "Op. 27 No. 2", "Piano Sonata No. 14", "quasi una fantasia" return the same work first.
- [ ] "BWV 1007" returns the cello suite; "Dvorak" finds "Dvořák".
- [ ] Searching a conductor returns recordings they conducted, not ones they performed in another role.
- [ ] Liszt/Trifonov fixture: no slskd query uses Liszt as the artist; correct release ranks first.
- [ ] Existing slskd rate limits, validation, and integrity checks pass their regression tests.
- [ ] Two releases of one recording appear as one recording in comparisons, with both releases listed.
- [ ] Search on a 10,000-track index returns in under 300 ms.

## v0.3 Pages scope

v0.3 turns the model into a browsable catalogue: full entity pages plus optional file-tag writing.

**In scope**

- **Work page (full):** identity (title, composer, catalogue numbers, nickname, period, form, instrumentation, description), movement list with tempo markings, all owned recordings with role credits, completeness per recording, play/compare/add-to-playlist, related works (same composer, form, period).
- **Composer page:** names, lifespan, period, short bio (provider text only, with source link), works grouped by form, owned recordings, related composers.
- **Performer / conductor / ensemble pages:** role-aware credits, recordings grouped by work, frequent collaborators.
- **Recording detail:** date, location, type, all releases it appears on, all credits.
- **Navigation:** every name on every page links to its page; a Classical tab in the Library (core hook: plugin Library tab; fallback is a plugin page).
- **File-tag writing (optional, admin):** specify formats/field mappings; preview diff, write selected or all, retag, remove plugin-managed tags; atomic writes where supported, backup/restore, multivalue-safe; unrelated tags untouched; read-only media reported, not failed.
- Layout follows Apple Music Classical's hierarchy in Aurral's design language, responsive to phone width.

**Out of scope:** Discover, curated content, large bio databases.

**Acceptance**

- [ ] Concerto fixture shows composer, soloist, conductor, orchestra each on the correct page.
- [ ] A work with five recordings on five albums shows all five on its page.
- [ ] Incomplete recordings show which movements are missing.
- [ ] A recording on two releases shows one recording with both releases.
- [ ] Tag write preview matches the actual write byte-for-byte on the fixture; unrelated tags untouched.
- [ ] Undo restores the previous tags exactly.
- [ ] Pages load in under 1 second on a 10,000-track library and work at phone width.

## v0.4 Discover scope

v0.4 helps users explore and maintain the collection, using only the shared model and simple rules (no ML).

**In scope**

- **Classical Discover** (extends Aurral's Discover, doesn't replace it): browse by period, form, instrument, composer; featured composer and work rotated from the user's library; composer anniversaries this month; timeline view of composers by period.
- **Missing from your collection:** missing movements of owned works; popular works by owned composers (from Open Opus); other recordings of owned works available via slskd search. Missing works and missing recordings are labelled separately.
- **Collection reports (admin):** duplicate recordings, duplicate releases, incomplete works, unidentified tracks, missing performer credits, low-confidence matches, provider/pinned conflicts. Each item links to the editor; uncertain items are labelled as suggestions.
- **Automatic playlists (per user, regenerated on schedule):** by composer, period, form, instrument, performer, conductor, ensemble, and recently added classical; deterministic selection, ordering, and deduplication rules.
- **Work radio:** play other works by the same composer, form, and period from the library.
- Core hook (fork): plugin sections in Discover. Fallback is a plugin Discover page.

**Out of scope:** ML recommendations, editorial curation beyond rules, social features.

**Acceptance**

- [ ] Browsing Romantic → Chopin → a ballade → compare → play works end to end.
- [ ] A sonata with movement III missing appears in missing movements; an étude set never does.
- [ ] Owning one recording of a work never marks other recordings as owned.
- [ ] Duplicate report never auto-merges; merges happen only from the editor.
- [ ] Automatic playlists belong to each user and refresh without duplicating tracks.
- [ ] Non-classical Discover content is unchanged.

## v1.0 Community scope

v1.0 adds no new classical-library features; it finishes setup, job controls, and community packaging.

**In scope**

- Settings UI for every option (provider toggles, rate limits, grouping allowlist, tag writing, schedules); no config-file editing required.
- First-run wizard: explains read-only default, offers a dry-run identification, shows estimated time.
- Resumable background jobs with progress and pause.
- Upgrade path tested from every earlier release (v0.1 → v1.0) on fixtures and an anonymised real library.
- Finalised Upstream Delta report; each core hook submitted upstream as its own PR where Collin approves, with the plugin working (reduced) on stock Aurral.
- Docs site or README set: install, first run, editor guide, tagging, backup/rollback, troubleshooting, FAQ.
- Licence file and third-party data notices (MusicBrainz, Open Opus).
- Issue templates, contributing guide, versioning policy, compatibility table (plugin version ↔ Aurral version).
- Community release checklist (see next section) passes.

**Out of scope:** new features; anything not listed above waits for v1.1+.

**Acceptance**

- [ ] A fresh Aurral install (stock and fork) can install the plugin from the docs alone, with no help.
- [ ] Upgrading from v0.1 data through each release loses nothing and keeps all pinned overrides.
- [ ] Plugin on stock upstream nightly: model, editor, and work page work; missing-hook features are hidden with an explanation.
- [ ] First identification of a 10,000-track library completes, can pause/resume, and never blocks playback.
- [ ] No hard-coded paths, hostnames, or Collin-specific settings remain (grep check in CI).

## Community release requirements

Build for Collin first, but avoid anything that blocks a public v1.0.

- **No server-specific assumptions:** no hard-coded paths, hostnames, Authentik, or Collin's library layout. All settings in a config UI with sensible defaults.
- **Runs on stock Aurral where possible:** core features work without the fork; the Upstream Delta report tells others exactly what is missing.
- **Licence:** match Aurral's licence; confirm provider data licences (MusicBrainz CC0 core data, Open Opus terms) before bundling anything.
- **Docs:** install, first-run identification, manual editor guide, backup/rollback, troubleshooting, FAQ on MusicBrainz rate limits.
- **Safe first run:** enabling the plugin only reads; identification and tagging start only when the user clicks.
- **Performance:** first identification pass on a 10,000-track library completes without blocking playback; progress is visible and resumable.
- **No Apple assets or branding;** the README describes it as Apple Music Classical-inspired, nothing more.
- **Issue templates** for bug reports and metadata problems.

## Out of scope and open questions

**Out of scope (all releases unless noted)**

- Navidrome and other Subsonic clients (Subsonic exposure dropped; revisit only for community demand).
- A separate metadata service, standalone player, or new playback engine.
- Rewriting the whole library on install.
- Building a global classical catalogue or ML recommendations.
- Social features.
- Apple assets, branding, or claims about Apple's internals.

**Open questions**

- [ ] Validate independent plugin database choice against actual runtime and concurrency (Phase 0).
- [ ] Is Open Opus coverage and licence good enough, or are period/form entered manually?
- [ ] Should regular users be able to suggest metadata corrections later?
- [ ] Which upstream nightly is the baseline for v0.1?

## Phase 0 prompt for Claude Code

Paste this with the spec attached.

```markdown
Read the attached Aurral Classical Deployment Spec v3.2. Do Phase 0 only: analysis, no code changes, no migrations, no branches, no commits. First inventory every existing fork-only change and propose a separate upstream-based, single-issue branch for each. Do not create branches during Phase 0. After approval, complete Phase 0.5 and only then create `aurral-classical` from unchanged current `main` in the fork and plugin repos; all classical implementation stays there. Never modify or merge into `main` without approval.

Repos: Collinlong1/Aurral-Classical-Plugin (plugin), Collinlong1/aurral (my fork, based on latest upstream nightly), lklynet/aurral (upstream, read-only reference).

Produce a single report covering:
1. Plugin repo inventory: what exists, what works, what's stubbed.
2. Complete fork-vs-matching-upstream-base inventory in `FORK_FEATURE_INVENTORY.md`: every existing feature/fix, its files and commits, dependencies, tests, and proposed `feature/` or `fix/` branch. Each branch must contain only one issue and be suitable for a separate upstream PR.
3. Aurral plugin API: what the plugin can do today, and the gaps this spec hits.
4. Root cause and proposed fix for the four known bugs (compare scope, comparison playlist playback, multivalue tag removal, slskd composer-as-artist), with file and function references.
5. Recommendation: plugin-owned tables vs separate SQLite file, with reasons.
6. Draft schema for entities, collections, segments, cardinalities, provenance, and pinned overrides.
7. First draft of UPSTREAM_DELTA.md: every core change v0.1 needs, kept as small and generic as possible.
8. Open Opus licence and data coverage check.
9. Versioned integration contract, stock/fork compatibility matrix, track reconciliation and job design.
10. Risks, Phase 0.5 branch-isolation plan, and a dependency-ordered Phase 1 task list with acceptance tests.

Never use production credentials or connect to my server. Stop after the report and wait for my approval.
```
