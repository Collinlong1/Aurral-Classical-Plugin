# Aurral Classical review — final report

Reviewed: plugin `762ee5c`, core `4ef6932` (both equal to `origin/aurral-classical`). No repo files were changed.
Baseline: plugin `node --test test/*.test.js` 341/341 pass (Node 22.23.4). Core: only the three plugin-named unit files were run (47 pass, on Node 22, not the project's Node 26); the full core suite and `pnpm check` were not run.
Probes: `scratchpad/probes/p1.mjs`–`p8.mjs` and, for the follow-ups in section 9, `f1.mjs`–`f9.mjs` (temp catalogues only). UI: `scratchpad/ui/` runs the real core renderer (`PluginAdminPage.tsx`) in Chromium against the real plugin editor on a temp catalogue; screenshots are beside it.

## 1. Summary

- Matching is solid for the common case (catalogue-numbered works, same spelling, whole works) and re-running a scan changes nothing. It is not yet reliable at keeping curated metadata: several automatic paths overwrite or undo manual decisions.
- The editor's forms and reorder worked in the harness, and stale saves are refused except in the merge case (E4). Its weak point is that merge, "Create anyway", "Remove from work" and Dismiss are not remembered by the next scan.
- Top three problems:
  1. **Composer identity is exact spelling** (L2, E2): "J.S. Bach" and "Johann Sebastian Bach" are two people with two copies of every work, and merging them in the editor is undone by the next album.
  2. **Automation overrides manual placement** (L3, E1): a track taken out of a work is put back; a work deliberately created as separate is merged away with no undo.
  3. **Tracks land on the wrong movement silently** (L1, L6): excerpts and range-titled variation tracks are mapped by position or by a stray number.

## 2. Findings table

| ID | Title | Type | Severity | Status | Size | Files |
|---|---|---|---|---|---|---|
| L1 | Excerpts mapped onto wrong movements by position | Bug | High, corrupts | Confirmed | S | plugin `auto-match.js` |
| L2 | Composer spelling variants duplicate composers and works; editor merge/rename doesn't hold | Bug | High, corrupts | Confirmed | M | plugin `auto-match.js`, `editor-v2.js` |
| L3 | Track removed from a work is re-attached by the next scan | Bug | High, corrupts | Confirmed | S–M | plugin `auto-match.js` |
| L4 | WORK tag without a form word or catalogue number is ignored | Bug | High, shows wrong | Confirmed | S | plugin `auto-match.js` |
| L5 | Telemann TWV numbers collapse into one work | Bug | High, corrupts | Confirmed | S | plugin `auto-match.js`, `works.js` |
| L6 | Range-titled variation tracks ("Variations 1-3") mis-map or block the other album | Bug | High, corrupts | Confirmed | M | plugin `auto-match.js` |
| L7 | "Variatio" (Goldberg) not read as a variation | Bug | Medium, shows wrong | Confirmed | S | plugin `auto-match.js` |
| L8 | Dash-joined sections split wrongly | Bug | Low, shows wrong | Confirmed | S | plugin `auto-match.js` |
| L9 | "Hob. XVI:52: I. Allegro" stored as movement "52: I. Allegro" | Bug | Medium, shows wrong | Confirmed | S | plugin `auto-match.js` |
| L10 | Retagging a non-FLAC/MP3/WAV file detaches it; review is a dead end; work gains a duplicate movement | Bug | High, corrupts | Confirmed (core id change reproduced, follow-up 1) | M | plugin `reconcile.js`, `editor-v2.js` |
| L11 | Two files with identical audio: moving one drops both links to review | Bug | Medium, corrupts | Confirmed | S | plugin `reconcile.js` |
| L13 | A title that returns at the end (Goldberg "Aria … Aria") keeps the whole work unmatched | Bug | High, shows wrong | Confirmed | S | plugin `auto-match.js` |
| L14 | Two works sharing one track by ranges are listed in random order on the album page | Bug | Low, shows wrong | Confirmed | S | plugin `presentation.js` |
| L15 | Mood and era words used as genres ("Romantic", "Contemporary", "Avant-Garde") and "Orchestral" scores are classified classical | Bug | Medium, shows wrong | Confirmed | S | plugin `classify-evidence.js` |
| L16 | A pop track with a WORK tag and a tempo word in its title is classified classical | Bug | Low, shows wrong | Confirmed | S | plugin `classify-evidence.js` |
| L17 | Every untagged-genre track with a composer tag becomes "unsure" and gets a review item | Bug | Medium, shows wrong | Confirmed (decision); review row by reading | S | plugin `classify-evidence.js`, `reconcile.js` |
| L18 | A classical track with no evidence of its own is "not classical" even on an album that is otherwise classical | Improvement | Medium, shows wrong | Confirmed | M | plugin `runtime.js` |
| L12 | Once two same-named composers exist, each new work makes another person | Bug | Medium, corrupts | Suspected | S | plugin `auto-match.js` |
| E1 | Work created with "Create anyway" is merged away by the next scan, no undo | Bug | High, corrupts | Confirmed | S | plugin `editor-v2.js`, `auto-match.js` |
| E2 | Merging duplicate works with differently spelled composers credits both; next album makes a third copy | Bug | High, corrupts | Confirmed | S | plugin `auto-match.js` |
| E3 | Dismissed auto-match reviews reopen every scan; no Decide option (movement-mismatch, ambiguous-work, uncertain-composer all probed) | Bug | Medium, shows wrong | Confirmed | S–M | plugin `auto-match.js`, `editor-v2.js` |
| E4 | Stale page of the kept work still saves after another tab's merge | Bug | Low, corrupts (rare) | Confirmed | S | plugin `auto-match.js` / `editor.js` |
| E5 | Validation errors carry no `field` | Bug | Low, shows wrong | Confirmed | S | plugin `editor-v2.js` |
| E7 | Ticking tracks and pressing Group (or Edit together) blocks every earlier Undo | Bug | Medium, shows wrong | Confirmed | S | plugin `history.js` |
| E8 | Undo of a merge silently drops favourites and picks made after it | Bug | Low, loses user data | Confirmed | S | plugin `history.js` |
| E10 | Undo of a deletion after the work was made again (or its tracks reassigned) attaches every track twice | Bug | High, corrupts | Confirmed | S | plugin `history.js` |
| E11 | Deleting a person is not undoable; a work restored after its composer was deleted has no composer | Bug | Low, corrupts | Confirmed | S | plugin `editor-v2.js`, `history.js` |
| E9 | Rename and reorder have no undo and no Activity entry | Improvement | Low | Confirmed | M | plugin `editor-v2.js`, `history.js` |
| E6 | B12 still open: album-menu tag actions write files at once | Bug (known) | Medium, changes files | Confirmed by reading | M | plugin `manifest.json`, `index.js` |
| C1 | One stale track makes core reject the whole album/work presentation; size caps below what the editor allows | Bug | Medium, shows wrong | Suspected | S | core `pluginPresentation.ts` |
| U1 | Duplicate-work warning is shown as a conflict with a Reload button | Bug | Medium, shows wrong | Confirmed | S | plugin `editor-v2.js` |
| U2 | Merge step: choice reads "The other one"; comparison sits below the button; composer difference not explained | Improvement | Low | Confirmed | S | plugin `editor-v2.js` |
| U3 | Title input too narrow for classical titles | Improvement | Low | Confirmed | S | core `PluginAdminPage.css` |
| U4 | New work has no catalogue/key fields; they fill in only after the next library pass | Improvement | Low | Confirmed | S | plugin `editor-v2.js`, `editor.js` |
| U5 | Album track rows repeat the title and hide the WORK tag | Improvement | Low | Confirmed | S | plugin `editor-v2.js` |
| D1 | A performer without a sort name must match on every word of the name | Improvement | Low | Suspected | S | plugin `works.js`, `slskd-ranking.js` |

## 3. Findings

### L1 — Excerpts mapped onto wrong movements by position
- **What:** `mapEach` ends with `if (movements.length === tracks.length) return movements.map((m) => m.id)` (`auto-match.js:1129-1130`) even when no track matched by name or number. `mergeMapping` (`:2254`) reuses it for work merges.
- **Trigger:** Album A has BWV 1007 I. Prélude, IV. Sarabande, VI. Gigue. Album B has II. Allemande, III. Courante, V. Menuet. B's tracks are attached to Prélude, Sarabande and Gigue. No review. Expected: B's movements are added, or a movement-mismatch review.
- **Fix plan:** In `mapEach`, allow the count fallback only when no track contradicts it: for every pair, the track has no number or its number equals the movement's `index ?? position`, and no track's text names a different existing movement. Otherwise fall through to `mapBySections` / null. Keep the fallback for untitled movements ("Movement 1"). Data repair: none automatic; list works where a realization item's track title number differs from its movement's number in the Classical report so an admin can fix them.
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/messy-matching.test.js`: the two-album BWV 1007 case; expect six movements or an open `movement-mismatch`, never Allemande on Prélude.
- **Risk:** Albums that today join by position with differently worded movements ("Scherzo" vs "III. Allegro") go to review instead.

### L2 — Composer spelling variants; editor merge and rename don't hold
- **What:** `composerEntity` (`auto-match.js:842-874`), `catalogueIndex` (`:804-840`) and `workKey` (`:641-646`) key on exact `words(name)`. `mergeContributor` (`:2197`) keeps no record of the dropped name. `nameKey` (`:48`) exists but only `withoutComposer` uses it.
- **Trigger:** Albums tagged "J.S. Bach", "Johann Sebastian Bach", "Bach, Johann Sebastian" give three people and three BWV 1048 works; same for Rachmaninov/Rachmaninoff. Merge "J.S. Bach" into "Johann Sebastian Bach" in the editor, add another album tagged "J.S. Bach": the person and a second copy of each work come back. Renaming a composer has the same effect.
- **Fix plan:** (1) When a person is merged or renamed, store the old name in the existing `alias` table (`catalogue.alias`). The person form already has "Other spellings"; index that too. (2) `catalogueIndex` adds every alias to `people`, and builds each work's key from each composer's canonical name. (3) In `candidates` and `createGroup`, map each tag composer to the canonical name of the one person holding that name or alias before building `workKey` and the group key. (4) Optional: treat "Surname, Given" as "Given Surname" and compare with `nameKey`. Do not auto-merge initials ("J.S. Bach") without an alias. Invariants: MBID still wins; two people with the same name stay apart. Data repair: none needed; duplicates merge on the next scan once an admin merges the people (`mergeDuplicateAutoWorks` already does that).
- **Dependencies:** plugin only. E2 depends on this.
- **Size:** Medium.
- **Test:** `test/auto-match.test.js`: merge two composers through `mutateEditor`, add an album with the old spelling, expect one person and one work. Same for rename.
- **Risk:** Group keys change for affected albums, so their `album-work` records no longer match; check the "tracks taken out stay out" rule (`:1299-1303`) still holds by keeping the legacy key lookup.

### L3 — A track removed from a work is put back
- **What:** `extendRealization` (`auto-match.js:1164-1247`) attaches any unattached track of a tag group that has other tracks attached. Only whole-album unassign is remembered (`unassignedByAdmin`, `:1251`). It also adds movements to works with manual edits.
- **Trigger:** Symphony 5 album with a fifth "Applause" track; "Remove from work" on that track; next scan re-adds it as movement 5.
- **Fix plan:** In `extendRealization`, skip a track whose latest `editor.unassign-tracks` / `editor.assign-album` audit event naming it is an unassign (the audit row stores `values.tracks`). Also return false when `editedInEditor`/`hasManualEdits` is true for the work and a new movement would have to be created; raise the existing `movement-mismatch` review instead.
- **Dependencies:** plugin only.
- **Size:** Small–Medium.
- **Test:** `test/editor-v2.test.js`: unassign one track, run `autoMatchTaggedWorks`, expect it still out.
- **Risk:** A track an admin removed by mistake needs a manual assign to come back.

### L4 — WORK tag without a form word or catalogue number is ignored
- **What:** `proposedWork` (`auto-match.js:182-197`) accepts a WORK tag only if it matches `MULTI_MOVEMENT` or has a catalogue number. Otherwise the explain text says "no WORK or GROUPING tag".
- **Trigger:** WORK = "Má vlast", "Pictures at an Exhibition", "Carmen", "The Planets" with a composer tag: no work is made.
- **Fix plan:** After the existing checks, accept a WORK tag as `work-tag` evidence when it is not collection-like, the track has a composer, and at least two tracks on the album share the same WORK parent (count in `candidates` before the loop, as `numberedRuns` does). Fix the explain reason to say the WORK tag was not taken and why.
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/messy-matching.test.js`: three tracks with WORK "Má vlast" make one work with three movements; a single track with a free-text WORK does not.
- **Risk:** Free-text WORK tags ("Favourite Arias") on two or more tracks become works; the collection-like check and composer requirement limit this.

### L5 — Telemann TWV numbers collapse
- **What:** `CATALOGUE` (`auto-match.js:613`) reads "twv 55" and drops ":D1".
- **Trigger:** "Ouverture-Suite, TWV 55:D1" and "TWV 55:g4" on one album become one four-movement work; a third suite elsewhere raises movement-mismatch.
- **Fix plan:** In `catalogueSubject`, before the generic regex, match `TWV\s*(\d+)\s*:\s*([A-Za-z]+\d*)` on the raw title and return `cat:twv:<n>:<key, case kept>` (D and d are different keys). Add TWV to `CATALOGUES` in `works.js` the same way. Data repair: `repairSiblingJoins` only detaches when `provablyDifferent`; extend `catalogueReadings` to accept the TWV form so existing joins come apart on the next scan (unedited auto works only).
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/messy-matching.test.js`: two TWV 55 suites on one album are two works; `catalogueSubject("TWV 55:D1") !== catalogueSubject("TWV 55:d1")`.
- **Risk:** Low.

### L6 — Range-titled variation tracks
- **What:** `sectionTitles` / `trackSections` (`auto-match.js:959-991`) split only on " / " or " - Var". A range is one opaque title. In `expandIncompleteWork`, `namedMovement` then matches by a stray number.
- **Trigger:** (a) Album G "Aria", "Variations 1-3" scanned first; album H "Aria", "Variatio 1", "Variatio 2", "Variatio 3". H's Variatio 3 is attached to movement "Variations 1-3", and G's page lists Variatio 1 and 2 as missing. (b) Paganini Rhapsody per-variation album first, then "Variations 2-3": second album stays out with a review. (c) Range album first: work gets movements named "Variations 2-3" and the per-variation album can never join.
- **Fix plan (prototyped in a scratch copy, see Follow-up 2):** No guard on the work title: "Rhapsody on a Theme of Paganini" has no variation word and must work. The guard is on the track's own movement text instead.
  1. One splitter, `rawSections(title)`, used by `sectionTitles`, `trackSections` and `mapBySections` (which today split separately). It splits on " / " and on a spaced dash before var…/theme/thema/tema/coda, then expands each part.
  2. Expanding a part: `Var(s|iation|iations|iatio|iazione|iazioni|iationen)\.? N[-–—]M` (arabic or roman, M > N, span under 40) becomes "Variation N" … "Variation M". A list joined by ",", "&", "and", "und", "et" is split only when every piece is a section start or a bare number right after a variation ("Variations 1 and 2", "Theme and Var. 1", "Introduction, Variation 1 & Theme"). Otherwise the part is left whole.
  3. `asVariation` returns the variation's number, and `mapEach` uses it as the index for both movements and tracks. Today a bare "Variation 3" has no index and only maps by the position fallback (L1).
  4. `namedMovement` (used by `expandIncompleteWork` and excerpts) compares variation numbers before piece numbers, so "Variation 3" finds "Variatio 3 a 1 Clav." and never "Variations 1-3".
  5. In `mapEach`, a named section (theme, introduction, coda, finale, aria, fuga/fugue, intermezzo) with no number takes the earliest free movement of that name when the words after it differ ("Tema. L'istesso tempo" for "Theme", "Fuga" for "Fugue", "Aria" for "Aria da capo").
  6. Do not add fuga/finale to the dash split: "III. Adagio ma non troppo - Fuga" is one movement and an existing test relies on it.
- **Data repair:** `splitCombinedMovements` runs in the library pass only for titles containing " / ". Widen that query to range and list titles (unedited auto works only).
- **Dependencies:** plugin only. Land L7 with it.
- **Size:** Medium.
- **Test:** `test/messy-matching.test.js` next to "a work made with several variations a movement": both scan orders, range album vs per-variation album; expect one work, one movement per variation, the range track on all its variations.
- **Risk:** With the prototype, `test/corpus-apple.test.js` fails for five results. This is fully traced (Follow-ups 2, item 1): the old baseline scored those albums as perfect while they were unmatched and waiting in a movement-mismatch review. Re-saving the baseline is correct, together with the scoring change described there. The other 340 tests pass.

### L7 — "Variatio" not recognised
- **What:** `VARIATION`, `VARIATION_TITLE`, `SECTION_START` (`auto-match.js:959, 973, 1037`) accept var / variation / variazione only.
- **Trigger:** "Variation 1" on one Goldberg album never maps to "Variatio 1 a 1 Clav." on another; partial and full albums mismatch in either order.
- **Fix plan:** Add `variatio` to the three patterns (prototyped; see L6 steps 3–4, which it needs: the pattern alone does not make a bare "Variation 1" map to "Variatio 1 a 1 Clav.").
- **Size:** Small. **Dependencies:** plugin.
- **Test:** `mapToMovements` unit case in `test/messy-matching.test.js`.
- **Risk:** Low.

### L8 — Dash-joined sections
- **What:** The split `\s+[–—-]\s+(?=var…)` only cuts before "Var".
- **Trigger:** "Introduction - Variation 1 - Tema" becomes "Introduction" + "Variation 1 - Tema".
- **Fix plan:** Split on a spaced dash before any `SECTION_START` word, only when every resulting part is a section start (the existing guard).
- **Size:** Small. **Test:** same file. **Risk:** tempo pairs such as "Theme - Andante" must stay whole; the every-part guard covers it.

### L9 — Hoboken colon read as a movement
- **What:** `SEPARATOR` `[:;]\s*` (`auto-match.js:700`) matches the colon inside "XVI:52", and `MOVEMENT_PREFIX` (`:12`) accepts "52:".
- **Trigger:** "Piano Sonata in E-flat, Hob. XVI:52: I. Allegro" stores "52: I. Allegro".
- **Fix plan:** In `stripWorkPrefixOnce`, skip a separator that is a colon directly between a roman numeral and a digit. Data repair: `repairMovementTitles` already rewrites derived titles; add this pattern.
- **Size:** Small. **Test:** `stripWorkPrefix` case in `test/messy-matching.test.js`. **Risk:** Low.

### L10 — Retagging a non-FLAC/MP3/WAV file detaches it (B2 recheck)
- **What:** With a whole-file hash, `match` (`reconcile.js:40-46`) needs the same core track id, file id, path and duration. Core's track row follows `identity_key` (recording MBID, else a title/artist key: `libraryMediaStore.ts:739, 1794`), so a title or artist retag without an MBID gives a new track id. The old link goes to `review`, a new link is created and auto-attached as an extra movement. The review shows only "Open album" and "Dismiss" because `candidates` is empty (the file is in `reused`), and `relink-track` refuses a file that already has an active link.
- **Trigger:** `.m4a` "Symphony No. 5, Op. 67: I. Allegro" in a work; retag the title to "…I. Allegro con brio". After the scan the work has both "I. Allegro con brio" (new link) and "I. Allegro" (old link, in review).
- **Fix plan:** In `match`, for tag-sensitive fingerprints also accept same `file_id` + same path + same duration when the core id changed (the file row is keyed on source+path and is stable). Keep the duration check. In `reconcile`, an old link with an exact match must not be offered to other candidates (see L11). Data repair: for open `track_link` reviews whose `reused` holds exactly one file with the same file id and path, re-point the old link and delete the newer link if it has no manual edits.
- **Dependencies:** plugin only. The core id change is reproduced (follow-up 1): a title retag gives a new track id while the file id stays, so matching on file id + path + duration is the right key.
- **Size:** Medium.
- **Test:** `test/fingerprint.test.js` or `test/sync.test.js`: container-hash file, same file id and path, new core id and hash; expect the link to stay active with its work.
- **Risk:** A different file written to the same path with the same duration to the millisecond would inherit the link.

### L11 — Identical audio: moving one file drops both links
- **What:** `reconcile.js:117-136, 149`: the unmoved file's exact match stays in the moved file's pool, so `demand` is 2 and neither link is claimed.
- **Trigger:** Two files with the same audio fingerprint (a duplicate in a box set); rename one; both links go to `review`. Deleting one copy does the same to every remaining copy: in a 28-file library of identical audio, deleting one file sent all 28 links to review with 28 review items (`probes/g1.same-audio.mjs`). Identical audio is rare in real libraries (duplicate rips, digital-silence tracks), so severity stays Medium.
- **Fix plan:** Resolve in two passes: first claim every `exact` match, then build the remaining pools without claimed items.
- **Size:** Small. **Test:** `test/sync.test.js`. **Risk:** Low.

### L13 — A title that returns at the end keeps the whole work unmatched
- **What:** `candidates` rejects a group when two tracks share a title (`auto-match.js:407-412`). A theme that closes the work is the same title twice.
- **Trigger:** Goldberg Variations tagged "Aria", "Variatio 1" … "Aria": no work is made, and the album page shows "Not matched to a work". A second album tagged "Aria … Aria da capo" matches on its own, so the two never meet.
- **Fix plan (prototyped):** Allow the group when the only repeat is the first and last track in album order (`returnsAtEnd`). The two get separate movements. With L6 step 5, "Aria" on one album and "Aria da capo" on another land on the same closing movement in both scan orders.
- **Dependencies:** plugin only; L6 step 5 for cross-album mapping.
- **Size:** Small.
- **Test:** `test/messy-matching.test.js`: Goldberg with "Aria" first and last makes one work with two Aria movements; add the "Aria da capo" album in both orders.
- **Risk:** A compilation that opens and closes with two takes of one piece under one work heading is treated as one recording. `separateRecordings` still runs first.

### L14 — Works sharing one track are ordered at random
- **What:** `compareAlbumGroups` (`presentation.js:256-262`) orders by first track position, then block length, then id. Two works cut from one track by ranges tie on the first two, so the random id decides. Core keeps that order (its sort is by track position and stable).
- **Trigger:** One track holding "Prelude in C" (0–1.5 s) and "Fugue in C" (1.5–4.0 s) as two works: over 12 fresh catalogues the Fugue was listed first 8 times. Play-by-work then plays the Fugue first.
- **Fix plan:** Add the first item's `startMs` as a tiebreak after `first` in `compareAlbumGroups` (keep `startMs` on the group until the final map).
- **Dependencies:** plugin only. Only reachable through range segments, which no editor action creates today.
- **Size:** Small.
- **Test:** `test/model.test.js`, next to "multi-work attacca tracks retain separate ranges": render the album and expect groups in start order.
- **Risk:** None.

### L15 — Mood and era genres, and "Orchestral" scores, count as classical
- **What:** `CLASSICAL_NAMES` (`classify-evidence.js:41-43`) treats the whole genre names "romantic", "contemporary", "avant garde" and "modern composition" as classical genres, and `DEFAULT_CLASSICAL_GENRES` includes "orchestral". A classical genre alone decides "classical" (`:170-172`).
- **Trigger:** A pop ballad tagged "Romantic", an adult-contemporary track tagged "Contemporary", avant-garde rock tagged "Avant-Garde" are all classical. A film or game score tagged "Orchestral" is classical when the album title does not say soundtrack ("The Empire Strikes Back", "Skyrim").
- **Fix plan:** Split the genre list in two. Keep unambiguous names as today. For "romantic", "contemporary", "avant garde", "modern composition", "orchestral", "symphony", "minimalism" add the signal as supporting (2 points, kind "ambiguous classical genre") instead of strong, so the track needs one more signal (a catalogue number, a form or tempo word, a WORK tag) to be classical and is otherwise unsure.
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/classify-evidence.test.js`: the four triggers are not classical; "Romantic" plus "Nocturne in E-flat, Op. 9 No. 2" still is. Re-run `test/corpus-nonclassical.test.js`.
- **Risk:** Classical files whose only genre is "Orchestral" or "Romantic" and whose titles carry nothing else become unsure. With the real-release fixtures this should be rare; measure with `probes/g5.mjs`.
- **Not fixable from tags:** crossover pop tagged plain "Classical" (Bocelli's "Con te partirò", 2CELLOS' "Smooth Criminal") is classified classical. That needs the admin's "Remove from Classical".

### L16 — WORK tag plus a tempo word makes a pop track classical
- **What:** A WORK tag that differs from the title scores 3 (`classify-evidence.js:112`). Picard writes WORK for any linked song, and a live or remastered title differs from it. With a tempo or form word in the title that is two supporting signals and score 5.
- **Trigger:** No genre, title "Finale (Live at Wembley)", WORK "Finale", a songwriter in the composer tag: classical.
- **Fix plan:** Do not count the WORK tag when the title is the WORK text followed only by a bracket or dash suffix (compare `plain(title)` starting with `plain(work)` and the rest beginning at a bracket, dash or "live/remaster" word).
- **Size:** Small. **Dependencies:** plugin.
- **Test:** `test/classify-evidence.test.js`: the trigger is not classical; "Gute Nacht" with WORK "Winterreise, D. 911" still is.
- **Risk:** Low.

### L17 — A composer tag alone sends a track to review
- **What:** With no genre, any track with a composer tag is "unsure" (`classify-evidence.js:181-183`, reason "composer credit only" or "uncorroborated classical evidence"), and `classify` opens a `classification` review for every unsure track (`reconcile.js`, `catalogue.review("classification", …)`).
- **Trigger:** A Picard-tagged pop library has composer tags and no genres. "Hey Jude" by The Beatles with composers Lennon and McCartney is unsure, so each such track is one review item.
- **Fix plan:** Keep the state "unsure" (it is safe), but in `classify` do not open a review when the evidence reason is "composer credit only". Those tracks stay out of Classical and out of the queue; the admin can still send an album to Classical. Do not change the decision itself: lieder and early music with only a composer tag ("Gute Nacht", "Spem in alium") depend on being unsure rather than not classical.
- **Size:** Small. **Dependencies:** plugin; pairs well with L18.
- **Test:** `test/classify.test.js`: such a track is unsure with no open review; a track with a form word still gets one.
- **Risk:** Classical tracks with only a composer tag no longer appear in the queue by themselves; L18 covers them when their album is classical.

### L18 — Tracks without evidence are not lifted by their album
- **What:** Each track is classified from its own tags. The album's state is rolled up from its tracks (`runtime.js`, the scan's commit) but never flows back, unless an admin pinned the album.
- **Trigger:** A Debussy piano album with no genre tags: "Clair de lune" has no evidence and is "not classical"; with a composer tag it is "unsure". On the real-release fixtures, with store titles and no genre or composer, 75.6% of tracks are classical, 19% unsure and 5.4% not classical; with only the movement part as title, 51.4% / 38.6% / 9.9% (`probes/g5.mjs`).
- **Fix plan:** In the scan's commit, after the per-track pass: for an album where at least two thirds of the tracks are classical, no track has a popular genre and the album is not a soundtrack context, set the remaining unpinned tracks to classical with evidence `{ inheritedFrom: "album majority" }` and close their classification reviews. Leave albums below the threshold as they are.
- **Size:** Medium. **Dependencies:** plugin.
- **Test:** `test/classify.test.js` or `test/sync.test.js`: a ten-track album with eight classical tracks lifts the other two; a compilation with three of ten does not. Re-run both corpus suites.
- **Risk:** A bonus pop track on a classical album becomes classical; a track pin overrides it.

### L12 — Same-named composers multiply (Suspected)
- **What:** `composerEntity` (`auto-match.js:864-873`) creates a new person whenever more than one person has the name, and adds it to the index, so each later group creates another. "Keep separate" on that review is a plain dismiss (`editor-v2.js:1364`).
- **Fix plan:** When several people share the name, do not create a person; return null and let `createGroup`'s existing `ambiguous-composer` review handle it. That check runs first today, so this branch should only be reachable from `creditMovementComposers`; confirm with a test before changing.
- **Size:** Small. **Test:** `test/auto-match.test.js`.

### E1 — "Create anyway" work merged away
- **What:** `create-work-from-album` with `createAnyway` (`editor-v2.js:2435-2472`) records nothing. `mergeDuplicateAutoWorks` (`auto-match.js:2369-2403`) treats the manual work as the keeper and folds the auto work into it. That merge is not written to `change_set`, so Activity cannot undo it.
- **Trigger:** Two albums of Symphony 5 in one work. Group album B's tracks into a new work with the same title, tick Create anyway. Next scan: both albums are in the admin's new work and the original is deleted.
- **Fix plan:** In both create paths that honour `createAnyway`, insert `match_suppression` rows with `distinctKey(newWork, similar)` for each id from `similarWorks`. `mergeDuplicateAutoWorks` already honours `keptDistinct`. Separately, in `mergeDuplicateAutoWorks`, never merge into or out of a work that has no `album-work` identity; raise the `duplicate-work` review instead.
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/editor-v2.test.js`: the trigger above; expect two live works after `autoMatchTaggedWorks`.
- **Risk:** A new album of that piece now raises `ambiguous-work` for the admin to choose, which is the intended outcome.

### E2 — Work merge keeps both composer spellings
- **What:** `mergeWork` (`auto-match.js:2299-2307`) moves every credit of the dropped work. The kept work's key then has two composers, so tags with one composer no longer find it.
- **Trigger:** Merge "Symphony No.5…" (L. van Beethoven) into "Symphony No. 5…" (Ludwig van Beethoven). The work is credited to both. A third album tagged "Ludwig van Beethoven" creates a new work.
- **Fix plan:** In `mergeWork` with `addMissing`, do not move a `composer` credit when the kept work already has a composer; keep other roles. In `mergeOutcome`/`mergeView`, add a row "Composers: kept work's composers stay; “X” is not added" with a link to merge the two people. With L2 in place, merging the people then covers future albums.
- **Dependencies:** plugin; L2 for the full effect.
- **Size:** Small.
- **Test:** `test/editor-v2.test.js`: merge, then a third album; expect one work, one composer credit.
- **Risk:** Genuine co-composers on the dropped work are not carried over; the merge view must say so.

### E3 — Dismissed auto-match reviews return
- **What:** `createGroup` calls `catalogue.review` on every pass (`auto-match.js:1280, 1387, 1439, 1463, 1478`); a resolved review is no bar to a new one. The review page has no Decide block for any of them (all three probed): movement-mismatch and uncertain-composer show "Open album" and "Dismiss"; ambiguous-work says "Several works match; choose the right one" but offers only "Open album", one "Open" link per candidate with identical labels, and "Dismiss".
- **Trigger:** Dismiss a movement-mismatch review; the next scan (every six hours) opens it again.
- **Fix plan:** In `Catalogue.review`, for kind `auto_match`, skip creating a new row when a resolved row exists for the same target with the same `reason` and the same `tracks` list. A changed track list reopens it. In `reviewView`, add a Decide block: for `movement-mismatch`, "Map these tracks" opening the album's grouping step for that work; for `ambiguous-work`, one "Use this work" row per candidate, each labelled with composer, recording count and first album so identical titles can be told apart; for `uncertain-composer`, "Yes, the composer is X" (create the work as `createGroup` would with confidence high) and "No". `move-tracks-open` takes `albumId`, `tracks`, `work`; my direct call to it from the review returned not-ok and was not investigated, so check its revision scope first.
- **Dependencies:** plugin only.
- **Size:** Small–Medium.
- **Test:** `test/messy-matching.test.js` near "reviews: an Auto-match review closes…": dismiss, rescan, expect no open review.
- **Risk:** A dismissed review hides a problem until the album's tracks change.

### E4 — Stale save after another tab's merge
- **What:** `revision` (`editor.js:101-119`) reads audit rows by scope id; `mergeWork` audits only the dropped work.
- **Trigger:** Tab 2 shows work B. Tab 1 merges A into B. Tab 2's save on B is accepted (reproduced). A stale delete was refused in the probe, but only because the stale save had already changed B; on its own it would pass the same check.
- **Fix plan:** In `mergeWork`, also write an audit row on the kept work (`work.merge-into`).
- **Size:** Small. **Test:** `test/editor-v2.test.js` revision cases: expect 409. **Risk:** The undo check in `history.js` counts later audit rows; exclude this action there as the editor's own row is.

### E5 — Field errors without a field
- **What:** `save-entity` passes `field` only for `date` (`editor-v2.js:2052-2056`). Empty title/name and over-long values return a general error; `warnDuplicate` (`:37-45`) names none.
- **Fix plan:** Pass `key` to `str(...)` and to the empty-title `fail`; `warnDuplicate` passes `"createAnyway"`.
- **Size:** Small. **Test:** `test/editor-v2.test.js`: expect `field` in each result; `dev/editor-drafts-browser.mjs` for placement. **Risk:** None.

### E7 — A track selection blocks every earlier Undo
- **What:** `undoChange` refuses when any later `change_set` row exists (`history.js:103`), without filtering by kind. "Group selected tracks" and "Edit together" store their ticked rows as `change_set` rows of kind `selection` (`editor-v2.js:1011-1021, 2151-2158`).
- **Trigger:** Merge two works. Open any album, tick a track, press Group selected tracks, then cancel. Undo of the merge now says "These entries changed after this…". Nothing changed. Selection rows are only purged after a day, and only when another selection is made.
- **Fix plan:** In `undoChange`, count only later rows of kind `merge` or `delete` whose stored entity set overlaps this change's set.
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/editor-v2.test.js`: merge, `move-tracks-open`, undo; expect success.
- **Risk:** Two overlapping merges must still be undone newest first; keep the overlap check.

### E8 — Undo drops favourites and picks made after the merge
- **What:** Undo deletes and restores `user_work_state` and `admin_work_pick` rows for the works (`history.js:53-54`). `applyWorkMutation` writes no audit row, so the "changed later" check does not see them.
- **Trigger:** Merge A and B; a user favourites the merged work; undo. The undo succeeds and the favourite is gone.
- **Fix plan:** In `undoChange`, before deleting, read `user_work_state` rows for the set with `updated_at` later than the change; after restoring, re-apply them to the surviving work (favourite OR-ed, pick kept only if its realization still exists).
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/editor-v2.test.js`: the trigger; expect the favourite on the kept work after undo.
- **Risk:** Low.

### E10 — Undo of a deletion can attach every track twice
- **What:** `undoChange` checks for later audit rows on the deleted work's own entities (`history.js:99-104`). After a deletion the tracks are free; if they are put in a work again, by matching or by hand, nothing touches the deleted entities, so the undo is allowed and restores the old attachments beside the new ones.
- **Trigger:** Delete "Symphony No. 5". In Review choose "Allow this work again"; the next scan makes the work again. Undo the deletion from Activity. Now there are two works and each track is in both. The next scan merges the two works, and each track stays attached twice for good: the work shows two recordings of the same files and the album page lists the work twice. The same happens when the freed tracks were assigned to another work by hand before the undo.
- **Fix plan:** In `undoChange`, before restoring, collect the `track_link_id`s of the snapshot's segments and refuse when any of them has a realization item now ("These tracks are in a work again; take them out first, then undo"). Nothing else changes.
- **Data repair:** Find tracks with two realizations in the same work whose recordings share every file, and drop the later one with `detachItem`.
- **Dependencies:** plugin only.
- **Size:** Small.
- **Test:** `test/editor-v2.test.js`: delete, allow, match, undo; expect a refusal and one attachment per track.
- **Risk:** None.

### E11 — Deleting a person is not undoable, and can leave a restored work without its composer
- **What:** `delete-entity` for a person or ensemble only soft-deletes it (`editor-v2.js:2132-2142`): no `change_set`, no Activity entry. It is allowed once nothing credits the person.
- **Trigger:** Delete both works of a composer, then delete the composer. Undo one work's deletion. The work comes back with a credit row that points at the deleted person: its page says "Composer unknown" and Credits is empty. A composer deleted by mistake cannot be brought back from the editor.
- **Fix plan:** In `undoChange`, after restoring, un-delete (clear `deleted_at`) any person or ensemble that a restored credit names. Separately, record person deletions through `recordChange` with kind `delete` so Activity lists them.
- **Size:** Small. **Dependencies:** plugin.
- **Test:** `test/editor-v2.test.js`: the trigger; expect the composer live and credited after the undo.
- **Risk:** None.

### E9 — Rename and reorder have no undo
- **What:** Only work merges and deletions are recorded (`recentChanges`, `history.js:122`). After a rename and a reorder, Activity lists nothing. A renamed title can be reverted only with "Remove pin", which returns to the tag-derived value, not the previous manual one. A reorder has no way back.
- **Fix plan:** Smallest step: record `set-movement-order` and `move-movement` through `recordChange` with kind `reorder` (the closure snapshot already covers `relation` rows) and list that kind in Activity. Leave rename as is; prior values are kept as superseded assertions.
- **Size:** Medium. **Test:** `test/editor-v2.test.js`. **Risk:** more rows in `change_set`; the newest-first rule (E7) then applies to reorders too.

### E6 — B12 still open
- **What:** `tag-album`, `untag-album`, `clear-classical`, `tag-artist` (`manifest.json:85-110`) write file tags as soon as they are chosen. The editor itself only previews (`preview-tag-removal`).
- **Fix plan:** This needs the owner's decision recorded in `REVIEW_2026-11-11.md` (still "Open, needs a decision"). Smallest change: gate the three writing actions on `enableFileWrites` as background tagging is, and name the setting in the refusal.
- **Size:** Small for the gate. **Test:** `test/tagger.test.js`.

### C1 — Core rejects the whole presentation for one stale item (Suspected)
- **What:** `playableItems` (`pluginPresentation.ts:127-152`) throws 502 for any item whose track is not in its album. The plugin's catalogue follows core only after a scan (six-hour interval or a download event), and core track and album ids change on retag (see L10). Schema caps (`movements` and `missing` ≤ 200, `items` ≤ 500, titles ≤ 500 characters) are below what the editor allows (`REORDER_LIMIT = 500`, 2000-character titles).
- **Fix plan:** In `playableItems`, drop an item whose track is not playable instead of throwing; drop a group or recording left with no items. Keep the throws for malformed ids and bad ranges. In the plugin, cut titles to 500 and `missing` to 200 in `presentation.js`.
- **Dependencies:** core and plugin, independent of each other.
- **Size:** Small. **Test:** core `pluginPresentation` unit test with one unknown track id; plugin `test/model.test.js` with a 250-movement work.
- **Risk:** A plugin bug that returns wrong tracks becomes silent; log the dropped count.

### U1 — Duplicate warning shown as a conflict
- **What:** `warnDuplicate` returns status 409; the renderer treats every 409 as a conflict and adds "Reload" (`PluginAdminPage.tsx:1236, 1309-1319`). Seen in the harness: message says tick "Create anyway", the button offered is Reload.
- **Fix plan:** Return 400 with `field: "createAnyway"`.
- **Size:** Small. **Test:** `dev/editor-drafts-browser.mjs` or `test/editor-v2.test.js`. **Risk:** None.

### U2 — Merge step wording and order
- Select options read "The other one" / "The one you opened"; use the entries' names. Put "Side by side" above the Merge form. Add the composer row from E2. Plugin `mergeView` (`editor-v2.js:460-508`). Small. Check in `dev/editor-reorder-review-browser.mjs`.

### U3 — Title input width
- At 1280 px the Title input is about 290 px and cuts "Symphony No. 5 in C minor, Op. 67". Make text inputs in `plugin-admin` form rows fill the row as textareas do (core `PluginAdminPage.css`), or send Title as `textarea`. Small.

### U4 — New work lacks catalogue and key
- The New work form has Title, Composer, Movements. Catalogue number, key and form are derived from the title only in the library pass (`deriveWorkFields`), so they are empty until the next scan. Call `deriveWorkFields` at the end of `createWork` and `create-work`. Small. Test in `test/editor-v2.test.js`.

### U5 — Album track rows
- Attached tracks show the full title twice (label and detail); unattached ones show "Not in a work" but not their WORK tag or composer, which is what an admin needs to group them. Show "Work: movement" for attached tracks and "WORK tag · composer" for unattached ones (`albumView`, `editor-v2.js:1037`). Small.

### D1 — Performer needs every word (Suspected)
- `surname` (`works.js:86-91`) returns the whole name when there is no sort name, and `has` (`slskd-ranking.js:47-50`) needs every word, so "Carlos Kleiber" rejects a folder named "Kleiber - Beethoven 5". Fall back to the last word for people. Small. Test in `test/source.test.js`. Risk: more same-surname candidates; the track line-up rule still applies.

## 4. Editor UX walkthrough

1. **New work with a catalogue number and four movements.** Works → New work → Title, Composer (lookup), Movements (one per line) → Create work. Three screens, quick. Gaps: no catalogue or key field and none derived until the next scan (U4); a similar title triggers a warning styled as a conflict (U1); the title box is narrow (U3). Attaching recordings is a separate trip: Albums → album → tick tracks → Group selected tracks → choose work → map.
2. **Fixing a composer variant.** Composers → open the variant → Merge with another person → Continue → choose who stays → Merge. The flow is clear and says it cannot be undone. The result does not last (L2), and works already merged keep both names (E2). Smallest change: L2's alias on merge.
3. **Merging two duplicate works.** Work → Advanced → Merge with another work → pick → merge step → Merge. The both-outcomes preview is good but long; the deciding control says "The other one" and sits above the comparison (U2). It does not say what happens to differing composers (E2).
4. **Handling a review item.** Review → item. Duplicate-work items have a proper Decide block (Merge, Keep separate, Skip) and Keep separate is remembered. Movement-mismatch, ambiguous-work and uncertain-composer items have no Decide block: only Open album (plus, for ambiguous-work, two identically labelled Open links) and Dismiss, and Dismiss does not last (E3, all three now probed). Track-link items after a retag have no usable action (L10).

Phone width (390 px): no horizontal overflow on the pages captured; track rows wrap to four or five lines because of the repeated title (U5).

## 5. Doc/code mismatches

- `REVIEW_2026-11-11.md` marks B1 fixed; it holds only for identical composer spellings (L2).
- B2 marked fixed; holds for FLAC, MP3 and WAV, not for other containers when core's track id changes (L10).
- `TAG_MAPPING_GROUPING_v1.md` rule 6 says a missing movement is "never silently replaced"; the position fallback does that (L1).
- Same file, rule 2: tags are "not permission to auto-merge ambiguous works"; `mergeDuplicateAutoWorks` merges into a manually created work (E1).
- `MODEL_V1.md` lists an explicit movement tag as a strong classification signal; `scanFile` (`runtime.js`) never sets `hints.movement`, and `tags.js` does not read MOVEMENT/MOVEMENTNAME, so the signal never fires for scanned files.
- Explain text says "no WORK or GROUPING tag" when a WORK tag is present but not taken (L4).
- The review brief names `PluginPage.tsx` as the v2 renderer; it is `PluginAdminPage.tsx` (`PluginPage.tsx` holds v1 and the wrapper).
- B12 is still listed "Open, needs a decision" and is still true (E6).
- There is no split command; "split" is moving tracks to a new work, which E1 then undoes.

## 6. Suggested fix order

1. **Batch A, stop automation overriding manual decisions (plugin):** E1, L3, E2. Small, independent, each with one editor test.
2. **Batch B, wrong-movement mapping (plugin):** L1, then L6 + L7 + L8 + L13 together (one prototype covers all four). Re-saving the corpus-apple baseline in this batch is correct; change the scorer first as Follow-ups 2 item 1 describes, so an unmatched album can no longer score as perfect.
3. **Batch C, composer identity (plugin):** L2, then L12.
4. **Batch D, catalogue and title parsing (plugin):** L5, L9, L4.
5. **Batch E, scan identity (plugin):** L11, then L10 (L10 builds on L11's two-pass claim).
6. **Batch F, reviews, conflicts and undo (plugin):** E10 first (it corrupts), then E3, E4, E5 + U1, E7, E8, E11.
7. **Batch I, classification (plugin):** L15, L16, L17, then L18. Re-run both corpus suites after each.
8. **Batch G, contract (core + plugin, can land separately):** C1.
9. **Batch H, polish:** U2, U4, U5, L14, E9 (plugin); U3 (core); D1; E6 after the owner decides.

No batch needs a paired core and plugin release. Rebuild `index.js` after each plugin batch.

## 7. Logic improvements (optional)

1. Read MOVEMENTNAME / MOVEMENT (and `©mvn` / `©mvi`) in `tags.js` and prefer them for the movement title and number when WORK is set.
2. Treat "Surname, Given" composer tags as "Given Surname" before keying.
3. Add Wq., H., Z., Kk. and "Op. posth." to `CATALOGUE`; in the probe they fall back to title matching. BuxWV is likely the same but was not tested.
4. Give the album-scoped match the same `deriveWorkFields` call as the library pass, so new works show key and catalogue at once.
5. Put scan-time merges from `mergeDuplicateAutoWorks` through `recordChange`, so every automatic merge can be undone from Activity.

## 8. Coverage

Not investigated thoroughly; nothing here should be read as clean:
- `runtime.js` identification jobs, MusicBrainz paths (`identifyTrack`, `mb.js`, `resolver.js`), English names; `jobs.js` leases and checkpoints are now probed with killed scan processes (Follow-ups 2, item 2); identification jobs were not killed.
- `classify-evidence.js` / B6: probed as a pure function and against the real-release fixtures (Follow-ups 2, item 4). The album roll-up and pins were not re-probed.
- `history.js` undo: undo of merges and deletions is probed (Follow-up 4 and Follow-ups 2, item 3); bulk deletion of several works was not.
- `tagger.js` and tag writing; `source.js` and `slskd.js` (only `slskd-ranking.js` was read); core `nativeMatcher.ts` was not read.
- Core: `pluginHost.ts` / `pluginContext.ts`, API-key library access, `AlbumPage.tsx`, `PluginResourcePage.tsx`, `SortableList`, list-place memory, the draft guard and the `a7691ad` cache fix were not exercised beyond what the harness showed; keyboard and focus behaviour was not tested. Queue building was read (`pluginQueue.ts`, the segment-end effect) but not run.
- Multi-user: non-admin read and write are refused by the plugin (probed); core's own checks were read, not tested.
- Segment ranges: album rows and queue entries were compared with core's own helper functions (Follow-up 5); real audio playback across a range boundary was not run.
- `EDITOR_UI_HANDOFF.md` items 1–7 were not checked one by one; `EDITOR_GUIDE.md` was only spot-checked.
- The Compose fixture environment and the existing `dev/*-browser.mjs` checks were not run.

## 9. Follow-ups (second pass)

Same rules as before: nothing written to either repo, temp catalogues only. New probes: `probes/f1.mjs`–`f9.mjs`. The variation prototype is `auto-match.prototype.js` in the scratchpad, applied to a scratch copy of the plugin (`patched/`); it is evidence for the fix plan, not a patch to apply as is.

### Follow-up 1 — L10 core track id: Confirmed
Ran core's own `scanMusicRoot` and `getLibrary` on a temp data folder (`AURRAL_DATA_DIR`) with four real `.m4a` files, no recording MBID, retagged between scans (`f2.mjs`):

| Retag | Track id | File id | Album id |
|---|---|---|---|
| Title reworded ("I. Allegro con brio" → "1. Satz: Allegro con brio") | 1 → 5 | same | same |
| Title corrected ("III. Allegro" → "III. Scherzo. Allegro") | 3 → 6 | same | same |
| Track artist changed | same | same | same |
| Album title changed (all four) | same | same | 1 → 9 |
| Album artist changed (all four) | same | same | 9 → 14 |
| Track number shifted and title reworded | 4 → 19 | same | same |
| Composer / WORK only | same | same | same |

So a title retag without an MBID does give a new core track id, and the file id is stable. Two limits: this ran on Node 22, not the project's Node 26, and a file with a recording MBID keeps its id (also observed). Incidental: the plugin's `writeTags` refused an artist value containing ";" on `.m4a` ("Tag verification failed for artist"); not investigated.

### Follow-up 2 — Variations (L6–L8): Confirmed, fix plan updated
Current code, both scan orders (`f3.mjs`):

| Case | Result today |
|---|---|
| Paganini Rhapsody, per-variation vs "Variations 2-3" | Second album stays out, mismatch review (both orders) |
| Goldberg, "Aria" first and last | Whole work unmatched: "two tracks share a title" (new L13). They do not collapse onto one movement |
| "Aria … Aria da capo" vs "Aria … Aria" | The second album stays out for the same reason |
| "Var. XII" vs "Variation 12" | Joins correctly |
| "Vars. 4–6" | Mismatch review (both orders) |
| "Variations 1 and 2" | Mismatch review (both orders) |
| "Theme and Var. 1" | Mismatch review (both orders) |
| Album omitting variations (1, 3, 7 of 12) | Joins; the others are listed as missing movements; partial-first then full also works. No review |
| Brahms Handel, ranges plus trailing Fugue | Mismatch review (both orders) |
| "Fuga" vs "Fugue", per-variation both sides | Joins, but only through the position fallback (L1) |
| Diabelli "Variation 32. Fuga: Allegro" vs "Var. XXXII" | Joins correctly by number |

With the prototype every case above joins with the right movements in both orders, including the Paganini case with no "variation" in the work title, and the earlier wrong mapping ("Variatio 3" on "Variations 1-3") is gone. Plugin tests with the prototype: 340 of 341 pass; `test/corpus-apple.test.js` fails (see L6 risk). Two mistakes I made while prototyping are in the plan as warnings: adding fuga/finale to the dash split breaks an existing test, and a letter guard placed after the whole lookahead stops "- Variation No. 1" from splitting.

### Follow-up 3 — E3: Confirmed
- **ambiguous-work:** subtitle says "Several works match; choose the right one". Actions: "Open album", one "Open “Symphony No. 5 in C minor, Op. 67”" per candidate (identical labels), "Dismiss". No section other than the evidence. There is no way to choose from the review.
- **uncertain-composer:** actions "Open album" and "Dismiss" only. The evidence shows the artist field but nothing offers to accept the composer.
- Side result: a second work created through the older `create-work` command with Create anyway was also merged away by the next scan, so E1 covers both create paths (Confirmed).

### Follow-up 4 — Undo: restores correctly or refuses clearly; two defects
| Case | Result |
|---|---|
| Merge, undo at once | Restored exactly (catalogue dump identical to before), no broken links; a second undo is refused; a later scan leaves it as restored |
| Merge, rename the kept work, undo | Refused with a clear message; nothing changed |
| Merge, reorder the kept work's movements, undo | Refused; nothing changed |
| Merge, rename the composer (a different entry), undo | Allowed and correct |
| Merge, two scans with nothing new, undo | Restored exactly; the next scan keeps it |
| Merge, a scan adds a new album to the kept work, undo | Refused; nothing changed |
| Merge, tick a track and press Group, undo | Refused though nothing changed (E7) |
| Merge, a user favourites the merged work, undo | Allowed; the favourite is lost (E8) |
| Rename / reorder | No undo and no Activity entry (E9) |

No case applied partly. Undo of a deletion was not probed.

### Follow-up 5 — Attacca and ranges: album view and queue agree (Confirmed); one ordering bug
- One work, three movements cut from one 6.0 s file at 0–2.5, 2.5–4.0, 4.0–6.0 s. Album rows, work-page items and the queue entries built by core's `pluginQueueTrack` carry the same start and end; `queueSegmentBounds` plays 0–2.5, 2.5–4.0, 4.0–6.0 s; row lengths are 2.5, 1.5, 2.0 s; the work page's part durations match.
- A whole-track piece on the same album has start 0 and no end, and plays the whole file.
- Two works on one track are listed in random order (L14).
- No editor action creates a range (Confirmed by reading: no start or end field anywhere in `editor.js` or `editor-v2.js`). Ranges exist only through the catalogue API, so attacca movements matched automatically are one whole-track row naming all its movements.
- Not run: real playback. Suspected from reading `AudioQueueProvider.tsx:851-864`: at a range boundary the player notices the end on a 100 ms poll and loads the next entry, so an attacca join may have an audible gap.

## 10. Variations prototype patch

Files, attached with this report:
- `variations-prototype.patch`: a git diff of `src/model/auto-match.js` against plugin `762ee5c`. `git apply --check` passes on a clean checkout. It was never applied to the repo.
- `review-probes.tar.gz`: every probe script (`p1`–`p8`, `f1`–`f10`, the two helper libraries, the UI harness scripts), a README saying what each one shows, and a copy of the patch.

The patch is a prototype. It covers L6, L7, L8 and L13 only (not L1), carries "PROTOTYPE" comments, has no tests of its own, and `index.js` is not rebuilt.

### What each part fixes

Case labels are the ones in `probes/f3.mjs` (A1 … E3) and `probes/p6.mjs` / `p7.mjs`. "Before" is plugin `762ee5c`; "after" is with the patch; every case was run in both scan orders.

| Part of the patch (hunk) | Finding | Cases it fixes | Before → after |
|---|---|---|---|
| `VAR_RANGE` and `expandSection`, range branch (`@@ -956`) | L6 | A1 Paganini "Variations 2-3" / "Variations 4-6"; C2 "Vars. 4–6"; E1 Brahms Handel "Variations 1-4" + Fugue; p7 Goldberg "Variations 1-3" | mismatch review, or Variatio 3 attached to "Variations 1-3" → one work, the range track on each of its variations |
| `expandSection`, list branch (`@@ -956`) | L6 | A1 "Introduction, Variation 1 & Theme"; C3 "Variations 1 and 2"; C4 "Theme and Var. 1" | mismatch review → joined, one movement per named section |
| `rawSections` used by `sectionTitles`, `trackSections`, `mapBySections` (`@@ -956`, `-970`, `-985`) | L6, L8 | p6 cases 5–6 "Introduction - Variation 1 - Tema" | split as "Introduction" + "Variation 1 - Tema" → three sections; the 8-track album joins |
| `variatio` added to `SECTION_START`, `VARIATION`, `VARIATION_TITLE` (`@@ -956`, `-970`, `-1034`) | L7 | p6 case 7; f5 | "Variatio 1 a 1 Clav." not read as variation 1 → read as variation 1 |
| `asVariation` returns the number; `mapEach` uses it as the index (`@@ -1034`, `-1055`) | L7, L6 | p6 case 7 (full Goldberg, then "Aria / Variation 1 / Variation 3"); every range case, which leaves bare "Variation N" movements | bare "Variation 3" had no index and mapped only by position → maps by number |
| `namedMovement` compares variation numbers first (`@@ -944`) | L7, L6 | p6 case 8 (partial Goldberg first, then the full album); p7 | mismatch review, or the wrong movement by a stray number → the work expands and maps by variation number |
| Named section takes the earliest free movement of that name (`@@ -1071`) | L6, L13 | A1 "Tema. L'istesso tempo" vs "Theme", "Introduction. Allegro vivace" vs "Introduction"; E1/E2 "Fuga" vs "Fugue"; B2 "Aria" vs "Aria da capo" | mismatch, or joined only through the position fallback → matched by name |
| `returnsAtEnd` exception in `candidates` (`@@ -407`, `-531`) | L13 | B1 Goldberg "Aria … Aria"; B2 second album | "two tracks share a title", whole work unmatched → one work with an opening and a closing Aria |

Already working before the patch and unchanged by it: C1 "Var. XII" vs "Variation 12", D1 an album that omits variations (missing movements listed, no review), E3 Diabelli "Variation 32. Fuga" vs "Var. XXXII".

Not covered by the patch:
- L1 (the position fallback itself). "Fuga" vs "Fugue" no longer depends on it, but other albums still can.
- Data repair for works already made with range-titled movements (the library-pass query in `autoMatchTaggedWorks` still looks for " / " only).
- Tests. The cases above should be added to `test/messy-matching.test.js`.

### The corpus-apple regression

Fully traced; see "Follow-ups 2", item 1. The patch (v1) is unchanged by that work.

## 11. Follow-ups 2

Same rules: nothing written to either repo; temp catalogues and temp libraries only. New probes: `probes/f10.mjs`–`f12.mjs` (corpus), `g1.mjs`, `g2.mjs`, `g_child.mjs`, `g_lib.mjs` (killed scans), `g3.mjs`, `g4.mjs` (undo of deletions), `g5.mjs` (classifier). The variations patch was saved and re-attached before this work started and is unchanged (v1).

### 1. corpus-apple regression: traced. The old baseline rewards unmatched albums; the patch's matching is right; re-saving is correct

How the test scores: every release of one tag style goes into one shared catalogue. A result is "perfect" when the album's blocks start where Apple's do and each row's text equals Apple's part name. An album whose tracks are in no work is still shown as blocks, built from its own titles ("Not matched to a work"), so it can score 1.0 on both measures without being matched at all.

All five failing results, before and after (`probes/f12.mjs`, `f11.mjs`):

| Result | Before: tracks in a work / in an unmatched block | After | Rows on the wrong variation, after | Blocks match Apple, after |
|---|---|---|---|---|
| store 1640004922 (Paganini, Davidovich) | 3 / 25 | 28 / 0 | 0 of 24 | yes |
| work-tags 1608042390 (Diabelli, Uchida) | 0 / 34 | 34 / 0 | 0 of 33 | yes |
| work-tags 1640004922 | 3 / 25 | 28 / 0 | 0 of 24 | yes |
| messy 1467953807 (Paganini) | 4 / 26 | 30 / 0 | 0 of 24 | yes |
| messy 1691120087 (Paganini) | 12 / 25 | 37 / 0 | 0 of 24 | yes |

- **Before the patch** each of these variation works was unmatched on that album, with an open movement-mismatch review (confirmed in the catalogue for 1608042390 and 1640004922). The "perfect" score came from the fallback blocks showing the album's own titles.
- **After the patch** every track is in the work, on the right variation, with the same blocks. The Diabelli work expands from 33 to 34 movements when the fuller album joins. The row score drops only because a row now shows the work's movement name, which is the first album's wording ("Var. 1, Alla marcia maestoso" shown as "Variation I (Alla marcia maestoso)"; "Variation 2. L'istesso tempo" shown as "Variation 2").
- **Verdict:** a scoring side effect. The old baseline is not a regression guard for these albums; it was measuring the unmatched fallback. The patch is not wrong. Re-saving the baseline is correct.

What Batch B should do (plan revised, patch unchanged):
1. Apply the variations patch and add its test cases.
2. Change the scorer before re-saving, so this cannot hide again: in `test/corpus/apple.js` `score()`, also return `matched`, the share of the album's tracks that sit in a group with a `workId`; in `test/corpus-apple.test.js`, fail when `matched` falls, and compare `parts` only between runs where `matched` is equal. Then run `node scripts/corpus.mjs --apple --update-baseline`.
3. Do not change which name a row shows as part of this batch. I prototyped "an album row keeps its own wording when the movement's name came from another album" (`patched2/` in the scratchpad). It brought the five results back to 0.9–1.0 and the test reported 120 results better than the baseline, but it broke four existing tests that expect the work's fuller names on album rows ("1. The Silver Sleigh Bells. Allegro ma non tanto" rather than the album's "The Silver Sleigh Bells", "III. Minuet. Moderato e grazioso - Trio"). Showing the work's names is the current intent, so that is a separate product decision, not a fix.

### 2. Interrupted scans (B4/B5): Confirmed robust

Real scan processes were killed with SIGKILL on a 28–32 file library of real FLAC files, then the scan was resumed and the result compared with an uninterrupted run of the same changes (one retag, one deleted file, one new album).

| Kill point | Right after the kill | After resuming |
|---|---|---|
| First-ever scan, after 7 files, between checkpoints | Nothing in the catalogue; job running, 1 chunk saved | Identical to an uninterrupted run |
| Rescan, after 12 files | Catalogue as before the scan | Identical |
| Inside a checkpoint's transaction | Catalogue as before; the half-written checkpoint is gone | Identical |
| Inside the final transaction, after reconcile, classify and auto-match ran, before commit | Catalogue as before (28 links, generation 1); nothing half-applied | Identical |
| Right after the final commit | Scan is done and complete | Identical |
| Three kills in a row inside the final transaction | Job marked failed, "ATTEMPTS_EXHAUSTED"; catalogue untouched | Asking for a scan again resumes it and finishes; no leftover chunk rows |
| "Auto-match every album" killed inside the third work's transaction | Two albums matched, the third rolled back whole; no orphan recordings or segments | Running it again gives the same result as an uninterrupted run |

- No lost links, no duplicate evidence or audit rows (at most one evidence row per changed track, same counts as the control), integrity and foreign-key checks clean every time.
- Lease: after a kill the job stays "running" and cannot be claimed until its 60-second lease runs out. That is by design; in the probe I ended the lease by hand to continue. A job killed three times waits as "failed" until a scan is next asked for (manually, or by the schedule when a scan is due).
- Not covered: killing a background identification job (MusicBrainz lookups), and power loss at the filesystem level.
- Side result: my first run used identical audio in every file and showed the L11 defect at scale (see L11).

### 3. Undo of a deletion

| Case | Result |
|---|---|
| Delete a work, undo at once | Restored exactly; the "don't make this again" record is removed; a later scan changes nothing |
| Delete, two scans, undo | Allowed and restored exactly; the "deleted work" review stays open until the next scan closes it |
| Delete, "Allow this work again", scan re-makes it, undo | Allowed. Every track is then attached twice, permanently (E10) |
| Delete, assign the freed tracks to another work by hand, undo | Allowed. Every track is in both works (E10) |
| Delete a composer who still has works | Refused with a clear message |
| Delete both works, delete the composer, undo one work | Allowed; the work returns with "Composer unknown" and the composer stays deleted (E11) |
| Delete a person | No undo and no Activity entry (E11) |

An edit to the deleted work itself is not possible, so "after an edit" was tested as edits to what the deletion freed (the tracks) and to the composer.

### 4. Classifier (B6)

Pure-function probes (`probes/g5.mjs`); "want" is my judgment of the right answer.

False positives, Confirmed:
- Genres "Romantic", "Contemporary", "Avant-Garde" on non-classical music: classical (L15).
- Film and game scores tagged "Orchestral" on an album whose title does not say soundtrack: classical (L15).
- Crossover pop tagged plain "Classical" (Bocelli, 2CELLOS): classical. Not fixable from tags.
- A live pop track with a WORK tag and a tempo word in the title, no genre: classical (L16).
- Held correctly: jazz with a Jazz genre, the Interstellar soundtrack tagged Classical, Il Divo tagged "Classical Crossover", untagged pop without a composer.
- Safe but noisy: untagged jazz standards, Picard-tagged pop, untagged film scores and musicals all come out "unsure", each with a review item (L17).

False negatives, Confirmed:
- Well-structured titles are classical without any genre or composer tag ("Symphony No. 5: I. Allegro con brio"; even "I. Allegro con brio" on an album named "Beethoven: Symphony No. 5").
- Pieces known by a name are not: "Clair de lune", "Nessun dorma", "Gute Nacht", "Spem in alium", "Spiegel im Spiegel" with only a composer tag are unsure; "Clair de lune" with no composer tag is not classical. A classical track whose only genre is "Instrumental" or a stray "Pop" is unsure.

Real classical releases (4,827 tracks from `test/corpus/apple`), by tagging style:

| Tagging | Classical | Unsure | Not classical |
|---|---|---|---|
| Store titles, composer, genre Classical | 100% | 0% | 0% |
| Work and movement tags, composer, genre | 100% | 0% | 0% |
| Careless rip (dashes, composer folded into artist, no genre) | 91.8% | 7.1% | 1.1% |
| Work and movement tags, composer, no genre | 95.6% | 4.4% | 0% |
| Store titles and composer, no genre | 78.5% | 21.5% | 0% |
| Store titles only | 75.6% | 19% | 5.4% |
| Movement part as title only | 51.4% | 38.6% | 9.9% |

So without a genre tag roughly a fifth of a real classical library needs review even with composer tags, and the tracks are judged one by one (L18). The existing non-classical corpus test still passes on the unchanged code.
