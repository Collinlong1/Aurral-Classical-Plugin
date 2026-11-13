# 1.0.32: film scores are not classical from a Classical genre tag

November 13, 2026. Audit on 1.0.31 after the scan: matched tracks 4,293 of 4,920; albums 38/31/27 (96 with classical tracks); the 10 refused split pieces matched; the dry run has nothing left; reviews classification 300, movement-mismatch 24, identity 11, duplicate-work 5. `explain-classification.mjs` on six film-score albums: no manual classification change ever, so the user's "not classical" marks never reached the plugin; the automatic classifier made Interstellar, both Hobbit scores, the Lord of the Rings trilogy and Mulan classical (The Last Jedi unsure, 20 reviews).

Cause in `classify-evidence.js`: "classical genre beside soundtrack" decided classical on the genre alone, and an album titled "… Original Motion Picture Soundtrack" was no soundtrack context at all. Now:
- An album titled as a soundtrack (motion picture / film / TV / game soundtrack or score, "Original Soundtrack/Score", "Music from the Motion Picture", "OST") is soundtrack context, like the genre.
- In soundtrack context a Classical genre tag is not evidence. A verified classical work (catalogue number, movement tag or composer relation, or two independent title signals) credited apart from its performers stays classical (Amadeus's K. 466). A track with a composer who is its own credited artist and nothing verifiable is not classical. Anything else is unsure, as before (a track with no composer and a WORK tag; a score credited apart from an orchestra).
- A rescan reclassifies every unpinned track; reviews close when a track stops being unsure.

Corpora: non-classical unsure 10 → 8 (a game-score and a soundtrack track now not classical; the mixed soundtrack album keeps its 5 classical tracks), no false negatives, baseline saved; Apple unchanged. Test in `test/messy-matching.test.js` with the six albums' shapes, Amadeus and a "Ghost Trio"; fails on 1.0.31. 301 plugin tests pass.

# 1.0.31: rescans stat unchanged files instead of reading them

November 13, 2026. A scan of the user's library takes about an hour. Every rescan opened every file again to re-read its tags and audio properties (`readTags`), although only changed files were re-hashed. Now `scanFile` returns the last scan's evidence for a file nothing wrote to since: same real path, size, modified time and inode, the same ctime (stored as `ctimeMs`; any write moves it, including a tag editor that keeps the modified time), the host placing it the same way (title, album, artist, album ID, track and disc number, recording ID), and tags that were readable last time. Such a file is only stat'ed. The first scan on 1.0.31 has no stored ctime and reads everything once more. `reconcile` compares evidence without `ctimeMs`, so a ctime-only change refreshes the stored row in place and adds no evidence row or audit event. Scan progress counts reused files (`progress.reused`, kept by compaction).

Tests: `test/sync.test.js` (a second scan reuses all three files; a retagged file with its modified time restored is read again; an in-place write keeping size, inode and modified time is caught by ctime alone; fails without the ctime check). Two existing tests updated: the compaction test expects `reused`, and the #9 unreadable-tags test marks its injected evidence as written since (`ctimeMs: 0`) so its second scan re-reads the file, as a real change would. 300 plugin tests pass; corpora unchanged. Not measured on the real library; the end-of-scan matching pass is unchanged.

# 1.0.30: after the backlog lookup on 1.0.28; film scores in Classical

November 13, 2026. Audit after "Identify earlier albums on MusicBrainz" ran on 1.0.28 (before 1.0.29): matched tracks 4,259 → 4,287 of 4,931; albums 38/32/27; reviews classification 300, movement-mismatch 24, identity 7, duplicate-work 5. The 10 refused split pieces remain until 1.0.29+ is installed and scanned. 313 tracks with recording IDs still name no work; not yet analysed.

- **"S163d/ii"** read as S163d, so "Album-Leaf 'Andantino in E major', S163d/ii" and "Album-Leaf in E major 'Leipzig', S163d" counted as one identity (a fifth "duplicate"). A roman number after a slash is now part of the number; the two are not `provablyDifferent` (a version and its parent), so nothing is split.
- **Film scores in Classical.** The user says they marked several soundtracks not classical; the audit has six classified classical, four with works: Interstellar (Zimmer, 24), The Last Jedi (Williams, 20 unsure), The Hobbit: Five Armies (Shore, 23), The Lord of the Rings Trilogy (Shore, 56), Mulan (Gregson-Williams, 26), The Hobbit: An Unexpected Journey (Shore, 26). Nothing in 1.0.23–1.0.30 touches classification; a track pin (editor "Remove from Classical") is never changed by a scan, and an album pin passes down at every scan. `scripts/explain-classification.mjs` (read-only) prints, per album, the album's classification, track states and pins, and every manual classification change with its time. Waiting on its output.

# 1.0.29: after the first real scan on 1.0.28

November 13, 2026. Audit after the scan: albums 38 fully / 32 partly / 27 not matched (baseline 36/33/28); matched tracks 4,154 → 4,259 of 4,931; open reviews classification 300, movement-mismatch 38 (from 99), duplicate-work 4; the dry run now has nothing left (0 splits, merges, expansions). Two problems:

- **10 split pieces refused instead of re-matched** (Concerto "Malédiction" S121, Grand solo de concert S365, Polonaise brillante S367, each split from its S121a/S365b/S367a work). Under the 1.0.22 stem key each pair was one group, so the album's `album-work` record for the S121 group sits on the S121a work, and its key is unchanged (no suffix), so "this album made this piece once" refused it. `createGroup` now treats a record on a work whose number is provably another piece as the old false join: it is marked stale and the piece is matched. A record on a work with the same number still refuses.
- **The backlog stayed "queued"**: the action only queued it; the queue runs on the plugin schedule (which may be off on the server). "Identify earlier albums on MusicBrainz" now works the queue itself in its 25-minute background budget and reports albums looked up, work groups made and what is left (run it again to continue). Scheduled runs also go on to identification after finishing a scan.

Tests: one in `test/messy-matching.test.js` (a record on another number's work does not refuse; one on the same number does), one in `test/background-matching.test.js` (the real action, MusicBrainz faked through the mirror setting, looks the album up and matches it with no schedule). Both fail on 1.0.28. 299 plugin tests pass; corpora unchanged.

# Audit on 1.0.28 (before any scan): dry run reviewed, cleared to scan

November 13, 2026. Dry run: 46 splits, every one checked against the works' rows in `audit.json`, all different Searle numbers or versions (S125/125a, S365/365a/365b, S367/367a, S464 Nos. 2/4 transcriptions, S498a/b/c, S69 holding S508, S507a and S692e, S215 Nos. 1–4, S214, S225, S385i/a, S406i/ii, S388/b, …), plus Schubert D.899 Nos. 2/3 and D.780 Nos. 2/5 held as two movements of one work on album 2072, and Corelli Variations op. 42 tracks inside the Paganini Rhapsody op. 43 on album 831. 0 merges. Expansions: Études-tableaux op. 33 2 → 8, op. 39 2 → 9, Children's Corner 2 → 6. 62 reviews closed; open after: classification 300, movement-mismatch 38 (from 99), duplicate-work 4 (Vocalise and Fairy Queen with different MusicBrainz works; Beethoven Symphonies 5 and 6 beside Liszt's transcriptions S463a/b, which share the opus key: answer "not duplicates"). Tracks matched by the run: 132. The user is cleared to scan; the backlog lookup is their call.

# 1.0.28: the works the first 1.0.27 audit left

Manifest 1.0.28, November 13, 2026. `scripts/explain-works.mjs` on the user's server showed why the 1.0.27 dry run left these works:

- **Études-tableaux op. 39** (2 of 9; three fuller albums): one `editor.choose-album-work` event (an album choice) counted as an edit. Expansion and the sibling repair now ignore editor actions that place recordings rather than change a work: open, choose-album-work, assign-album, unassign-album, resolve-review, classification, set-classification (`editedInEditor`). Manual assertions and every other editor action still keep them away.
- **S215 No. 2 holding Nos. 1–4, S214 No. 2 holding No. 1 and /3, S225 No. 1 holding No. 2**: not merges. Under the 1.0.22 stem key one album's sibling pieces were one group, so one recording with 4, 3 and 2 movements. The repair now works per track, not per recording: a track whose own tags name a number provably different from its work's is detached, and movements left with no recording are removed.
- **S385i holding S385a, S406i holding S406ii, S388 holding S388b**: the second recording's titles are excerpt-worded ("Tyrolean Melody from the opera…", "…aus Glinkas Oper…"), so they propose no work and the repair could not read their number. `trackSubject` falls back to the number in a title that is a whole piece (no work head, no movement prefix). A MusicBrainz match naming a work whose number is provably another piece than the title's is not used, and a work holding such a number is not joined (`heldElsewhere`), so MusicBrainz cannot put the track back or make a second S385i.
- **Vocalise op. 34 no. 14, The Fairy Queen Z. 629**: two works each with different MusicBrainz work IDs. Still not merged; now each pair gets an `identity` review (`duplicate-work`, "different MusicBrainz identities"), as the scope asks for conflicting candidates. Beethoven's Symphonies 5/6 beside Liszt's S463a/b share a key but stay (one of each pair is the transcription; no review is raised unless both are auto-made and their identities conflict).

Test: one in `test/messy-matching.test.js` rebuilding each real case (album choice on op. 39; four valses as one recording; S385a joined through a MusicBrainz identity and a later MusicBrainz match naming S385i's work; two Fairy Queens with different MusicBrainz works); fails on 1.0.27. 297 plugin tests pass; Apple and non-classical corpora unchanged. Next: re-run the audit's dry run on the server before scanning.

# First audit on 1.0.27 (before any scan): dry run checked; a diagnostic for what it left alone

November 13, 2026. Counts unchanged from 1.0.22 (36/33/28; reviews classification 300, movement-mismatch 99, ambiguous-work 1), as expected before a scan. "Duplicate works" is down to 4 (was 47): Vocalise op. 34 no. 14 and The Fairy Queen Z. 629 (real; left unmerged by the run, so a distinct verified identity, an edit or a non-auto copy keeps them apart), and Beethoven's Symphonies 5 and 6 beside Liszt's transcriptions S463a/b (different works sharing the opus key; correctly not merged). Dry run: 13 sibling splits, all Searle versions or revisions (S422i/ii, S203i/ii, S185/185a, S176/176a, S514/514a, S195/195a, S510/510a, S199/199a, S240i/ii, S248i/ii, S461i/ii, S207/207a, S170/170a); 2 expansions (Études-tableaux op. 33 2 → 8, Children's Corner 2 → 6); 0 merges; 58 reviews closed; movement-mismatch 99 → 42 open after.

Left alone, though their rules apply: S215 No. 2 holding Nos. 1, 3, 4; S214 No. 2 holding No. 1 and /3; S225 No. 1 holding No. 2; S406i holding S406ii; S385i holding S385a; S388 holding S388b; and Études-tableaux op. 39 (2 movements) against three fuller albums (10639, 9289, 13557). Reproduced op. 39 with the library's exact titles: it expands to 9. So those works are gated in the catalogue itself: a manual edit or `editor.*` event on the work or its movements keeps both the repair and the expansion away. `scripts/explain-works.mjs` (read-only) prints, per work: album records, MusicBrainz IDs, manual edits, editor actions, merges into it, and recordings by album. Waiting on its output from the user's server.

# v0.1 completion, step 5 (part): settled reviews close; box-set timing; ready for the re-audit

Manifest 1.0.27, November 13, 2026.

- **Settled Auto-match reviews close by themselves** (`resolveSettledReviews`, end of each match): an open `auto_match` review whose listed tracks are all in a work now is resolved, with a `review.auto_resolve` audit record. Only the editor closed them before, so the 1.0.22 audit's 99 open movement-mismatch reviews included tracks a later match had already placed. Reviews with any track still out stay open; no weak match is accepted to close one.
- **Repair cost.** `repairSiblingJoins` only checks works with two or more recordings (a merge always leaves that). Synthetic 1,460-track Liszt-style box plus ten albums, library-wide scan pass: first pass 4.4 s creating 1,170 works (1.0.22: 0.66 s, but it collapsed them into 70); a rescan with nothing new 0.28–0.32 s (1.0.22: 0.05–0.07 s with 70 works).
- **Audit dry run** also counts reviews it would close and the open reviews left by reason, to compare with the 1.0.22 baseline (classification 300, movement-mismatch 99, ambiguous-work 1).
- README: the grouping section describes scan-time matching, background identification, the backlog action, expansion, repairs and the dry run.

Not done in v0.1 so far: the 16-item legacy bug checklist (not supplied; nothing marked done without it); the 300 classification reviews (unsure classifications, not touched by matching); single tracks of a set that propose no work ("Prelude, Op. 32, No. 3"); a real-library re-audit on 1.0.27; the Compose/Chromium workflow against the current core head (`cc51a65`, a GitHub "Sync fork" merge of upstream through #1838 straight into `aurral-classical`; no core change in 1.0.23–1.0.27).

Next: the user's server session runs the audit (brief in the session summary). Compare its counts and dry run with 36/33/28 and the review baseline before installing 1.0.27.

# v0.1 completion, step 4: undo sibling-number merges; merge duplicates only on a number; dry run in the audit

Manifest 1.0.26, November 13, 2026.

**What the 1.0.22 audit's "duplicates" were.** Of 47 groups, 45 were different pieces sharing a catalogue stem (fixed in 1.0.23) and 2 real duplicates (Vocalise, op. 34 no. 14; The Fairy Queen, Z. 629). `mergeDuplicateAutoWorks`, which runs with every match, merges auto-made unedited works sharing a `workKey`; under the 1.0.22 stem key it folded standalone works such as "Valse oubliée, S215 No. 1–4" into one. That is where the stored false joins came from (about 9 in the audit: S215, S214, S225, S406i/ii, S385i/a, S388/b, S172/S172a).

- **Repair** (`repairSiblingJoins`, runs before each match, library-wide on scans): a recording whose tracks all name a catalogue number `provablyDifferent` from its work's is detached, and the same match gives it its own work (or the right one). Provably different: same system, and the base numbers differ, the letters after them differ, or both give a sub-number and those differ, under every reading of Liszt's three notations ("S443i", "S. 443/1", "S443 No. 1") and of a lone "i" (letter or roman). Not different: a set and its numbered piece ("S145" / "S145 No. 1"), notation twins, two systems ("Sz. 107" / "BB 105"). Only works matching made, nobody edited (no manual assertion, no `editor.*` event), on albums nobody assigned by hand. The album's moved `album-work` record for that piece is marked stale. Audited as `work.split_sibling`. Favourites stay on the work they are on (a merged work's state cannot be told apart).
- **MusicBrainz rejoin guard.** The old merges also moved the dropped works' MusicBrainz work IDs. When a MusicBrainz match points at a work whose title names a number provably different from the tags', the match does not join it; the ID conflict goes to identity review.
- **Duplicates merge only on a number.** Same composers and a key with no digit ("Prelude", "Ave Maria") go to an `identity` review (`duplicate-work`) instead of merging. A catalogue number, or a title with a number ("Symphony No. 5", "Z. 629"), still merges, transactionally, keeping favourites, picks and identities (`mergeWork`, unchanged).
- **Dry run.** `scripts/audit-catalogue.mjs` now runs the next scan's library-wide pass on the snapshot, then every album with unmatched tracks, and lists from the snapshot's audit trail every split, merge and expansion it would make, new duplicate reviews, and the duplicates left; `audit.json` has them under `dryRun`. The live catalogue is never written.

Tests: in `test/messy-matching.test.js`, an old merge of four valses (with MusicBrainz IDs, a favourite, an edited sibling, notation twins and a set) comes apart exactly where it should, twice-run idempotent; duplicates merge on a number and review without one. `test/audit-catalogue.test.js` runs the audit on a synthetic catalogue: the dry run lists the two splits, the live file's hash is unchanged and the snapshot is removed. Each fails with its rule switched off. 295 plugin tests pass; Apple and non-classical corpora unchanged.

# v0.1 completion, step 3: matching after every scan, MusicBrainz in the background

Manifest 1.0.25, November 13, 2026. The user does not want to match albums by hand.

- **After a scan** the library-wide match uses the full tag and title rules (`allowStructuredTitles: true`), as "Auto-match every album" does. No network. Before, scans read only WORK and GROUPING tags.
- **Background identification** (`album_identify` jobs in `src/model/runtime.js`). After a scan, an album is queued when it has classical tracks outside every work with a recording or work ID, and that set of tracks is new: the job key is the album plus a hash of those tracks, and a key that ever ran is never queued again. A job looks each track up through `identifyTrack` (the per-album Auto-match lookup, now shared: shared throttle, disk cache, retries), saves progress after every track, resumes after a stop, and then matches the album with what MusicBrainz said. Three failures in a row stop the job and retry it later from the first failure (backoff `2^attempt` s, 5 attempts); a lone failure gets one more try before matching. Scans are claimed before identification jobs, and identification jobs follow each other while the run's budget lasts.
- **Backlog (Option A).** The first time this runs, every album already pending is recorded as seen (done markers with `baseline: true`, plus an `album_identify_baseline` row) and nothing is looked up. The admin action "Identify earlier albums on MusicBrainz" (`classical-identify-backlog`) queues them once; it is the one exception to core rule 5, recorded in `AGENTS.md`. Not run by any session; the user starts it.
- **Status.** "Classical model status" now reports queued, done and stopped albums, work groups made, failed lookups and albums waiting for the backlog. Markers are left out of job counts.
- `ModelJobs`: `claim({ type })`, scans first; only scans are compacted when they finish.

Tests: `test/background-matching.test.js` (a real scan of tagged files matches structured titles with no lookups; only a new album is looked up, once, resumably, a rescan repeats nothing, the backlog waits for the admin and is queued once; an unreachable MusicBrainz retries the album from the first failed track). The scan test fails with the 1.0.24 scan rule. 292 plugin tests pass. The corpus runner's simulated scan now uses the same rules; one messy-style album (1691120087) joins the shared Paganini Rhapsody work and takes its movement names (same blocks), baseline saved. Non-classical corpus unchanged. No core change.

# v0.1 completion, step 2: incomplete works, other track divisions, opus slash numbers

Manifest 1.0.24, November 13, 2026. From the 1.0.22 audit's 57 movement-mismatch groups (simulated): about 15 Liszt groups were catalogue-suffix collisions, fixed in 1.0.23; the rest are below. All rules in `src/model/auto-match.js`; albums appear only in tests.

- **Incomplete auto-made works expand.** A work an earlier album made from part of a piece (Études-tableaux op. 39 with 2 of 9, Children's Corner with 2 of 6) takes a fuller album's movements (`expandIncompleteWork`) only when: matching made it (an `album-work` identity), nobody edited it or its movements (no manual assertion, no `editor.*` audit event), every movement it has is on the album once, by name, abbreviated name or piece number, in album order, and every other track names a movement whose name no existing movement contains. The work's movements follow the album; existing movements keep their ids and recordings. Audited as `work.auto_match_expand`.
- **Piece numbers within a set** map tracks: "No. 3. Allegro", "Allegro agitato in C minor, no. 1", or the set's own catalogue number with the piece after it ("Études-tableaux, Op. 39, No. 6" in "Études-tableaux, op. 39"). Out-of-order partial albums line up.
- **Abbreviated names** ("Dr. Gradus" / "Doctor Gradus"): every other word equal, one written with a full stop, keeping the long word's first and last letters in order.
- **Other divisions.** A movement naming several sections ("Theme: L'istesso tempo / II. L'istesso tempo / III. …", from an album that gave them one track) takes consecutive tracks matching its sections in order, as occurrences 1, 2, …; "Variation No. 2", "Var. 2.", "Variation 2:" and "II." are variation two, Tema/Thema/Theme alike (Paganini Rhapsody, Corelli and Chopin Variations). Only a fallback after every other mapping fails; the work's structure is unchanged.
- **Recordings.** A trailing bracket with words ("(Philadelphia Orchestra feat. conductor: Leopold Stokowski)", "(Live)") and punctuation no longer make a box's second recording of a concerto other movements; it is a second recording. A bracket of digits only ("(3)") still tells repeats apart.
- **Opus slash numbers.** "Op. 27/2" keys as "Op. 27 No. 2" (a slash number below the opus or up to 12; above both is a range). Apple-style WORK tags had joined Beethoven's Op. 10/1–3, 14/1–2, 27/1–2, 31/1–3, 49/1–2 sonatas, the six Op. 18 quartets and Chopin's Op. 24/3–4, 63/1–3, 64/1–2 pieces under one work each.

Corpus: work-tags blocks match Apple on 189 → 196 of 204 albums, false joins 92 → 59; rows 90% → 89%, because albums that now share the right work take that work's movement names (accepted before; reviewed album by album: 557321019, 1379983926, 1452194647, 201439672, 693711974, 1648305509, 1721447447, 1452326250). Store and messy unchanged (their titles already write "Op. 27 No. 1"). Baseline saved. Non-classical corpus unchanged.

Tests: three in `test/messy-matching.test.js` (fuller and differently divided albums; an edited work and a continued movement; a box's second recording and opus slash numbers). The first and third fail on 1.0.23; the second guards the new rule and fails with either guard removed. 289 plugin tests pass. Not handled: single tracks of a set that propose no work ("Prelude, Op. 32, No. 3"), the Four Seasons' "Spring 1" names a shared work took from another album, The Seasons' doubled "Troika" movements.

# v0.1 completion, step 1: a catalogue number's suffix is part of the work

Manifest 1.0.23, November 13, 2026, from the user's v0.1 completion scope and the third live-library audit (1.0.22: 97 albums, 36 fully / 33 partly / 28 not matched; reviews 300 classification, 99 movement-mismatch, 1 ambiguous-work).

**Cause.** `catalogueNumber` kept only the digits for S, L, TrV, FP, Sz, BB and WoO, and no piece number after them. Liszt's S172, S172a and S172b, S504i and S504ii, S543 and S543bis, or "S164e No. 1" and "No. 2", shared one identity. On one album they were "several tracks name the same whole piece"; across albums one joined or was reviewed against the other's work ("Consolations, S172" matched "Harmonies poétiques et religieuses, S172a"; "Stabat mater, S172b" was a movement-mismatch against it). The audit's 47 "duplicate works" were 45 such collisions and 2 real duplicates (Vocalise, op. 34 no. 14; The Fairy Queen, Z. 629), so consolidation on the old key would have merged different pieces.

**Rule.** Letters written straight after the digits ("172a", "504ii", "543bis"), a Searle sub-number after a slash ("S. 534/2b", "S. 385/3") and a piece number after the catalogue number ("S164e No. 2", "S160 No. 4bis") are part of `catalogueSubject`. The same number written two ways ("S543" / "S. 543", "S161" / "S. 161") is still one identity. A title with numbers from two systems keeps the first, as before: keying on all of them would split "Ein Heldenleben, Op. 40, TrV 190" from "…, Op. 40".

**Removals kept.** An album remembers what it made by a hash of its group key, which changes for suffixed titles. A group whose 1.0.22 key had made a work since emptied stays out only when that work has the exact same number; one made under a sibling number (the false join an admin undid) no longer blocks the piece's own work. The audit's two "refused without a review" tracks (S405a, S571a) are this case.

**Not changed.** Tracks already attached to a sibling-number work stay attached; the matcher never detaches. From the audit data, about 9 stored joins are wrong (S215 No. 2 holding Nos. 1, 3, 4; S214 No. 2 holding No. 1 and /3; S225 No. 1 holding No. 2; S406i holding S406ii; S385i holding S385a; S388 holding S388b), 2 are unclear ("S. 445 no. 1/c" / "S445 No. 1a", "S. 167m/1" / "S167m") and 3 are one piece in two notations (MusicBrainz "S. 443/1" is Hyperion's "S443i"; "S. 166r/2" is "S166r No. 2"). Repairing stored joins writes to the catalogue, so it belongs with the step 4 dry run. Notations are not equated: "/1" means a version in S443 and a piece in S166r.

Tests: two in `test/messy-matching.test.js` (identity and cross-album joins from the audit's titles; removals under the old key), each failing on 1.0.22. 286 plugin tests pass. Apple corpus (store 157/204, work-tags 189/204, messy 150/204; false joins 143/92/155) and the non-classical corpus are unchanged from 1.0.22: neither holds suffixed numbers. No core change; pairs with core `66b54b5`. Not yet re-audited on the live library.

# Second live-library audit: works that exist but would not take a second album

Manifest 1.0.22, November 13, 2026. After 1.0.21 and "Auto-match every album" the user's library went from 12 to 28 fully matched albums (69 to 35 with nothing matched). 253 tracks still named a work but stayed out; nearly all hit `movement-mismatch` against a work another album had made (reviews 12 → 42). Running `mapToMovements` on the audit's own data (existing works' rows against pending tracks' titles) found the rules below; all general, albums appear only in tests.

- **Repeated work names** ("Variations on a Theme of Chopin, Op. 22 : Rachmaninoff: Variations on a Theme of Chopin, Op. 22: Theme") strip to the movement.
- **Sets' own numbering.** The set-name trim compares without accents ("24 Préludes" under "24 Preludes"). `movementParts` reads "No. 6 …" as piece 6, which lines up only with pieces numbered the same way (the gate caught Rubinstein's Op. 9 nocturnes joining a work of three recordings by position), and "XVIa." as part of movement 16 (only with its punctuation, so "La Mer" is no movement 50).
- **The number veto** from 1.0.18 now applies only when the work holds the track's own name elsewhere (the suite's "Gavotte" vs the partita's "Gavotte en rondeau"); "III. Scherzo" under "III. Allegro" is the third movement.
- **A movement over two tracks** (a finale split "IV. Presto", "IV. O Freunde…"; Richter's "Ia./Ib.") maps both to one movement, as its first and second occurrence; rows and work pages then name each track's own part.
- **The audit simulates Auto-match.** It snapshots the catalogue with SQLite's online backup (`VACUUM INTO` on older Node) into the out dir, reads the snapshot, runs Auto-match for every album on it, and reports per track whether it would match, which review it would raise (for a movement mismatch, the existing work's movements) or that it is refused without a review (album-work identity already used). The snapshot is deleted after; the live file's hash is unchanged in tests.

Still open from the audit: works first made from a partial album (Études-tableaux, Op. 39 with 2 of 9 pieces; Children's Corner with 2 of 6) refuse fuller albums; albums dividing a work into different tracks (one variation per track vs several) cannot share it; spelling variants of movement names (Columbine/Colombine). 1,413 tracks have only MusicBrainz to name their work and need per-album Auto-match.

Validation: 284 plugin tests and both gates on Node 22; Apple baseline saved (two albums improved, none worse). The new test fails on 1.0.21. Compose/Chromium not rerun (no core or page-contract change).

# Fixes from the first live-library audit

Manifest 1.0.21, November 13, 2026. The user's server session ran `scripts/audit-catalogue.mjs` on their live catalogue (plugin 1.0.20, 97 classical albums). Findings: 69 albums had nothing matched; 1,432 tracks matched only by Auto-match (an explicit per-album action) and 2,244 more need its MusicBrainz lookup. Plugin only; core stays `66b54b5`. All changes are general rules; albums appear only as test cases.

- **Auto-match every album (tags and titles)**, a new admin action: the per-album local rules for every album with unmatched classical tracks, no network. MusicBrainz stays per album (a lookup for every track of a library is the load core's AGENTS.md rules out).
- **A work in a title's head with its number in the next part** ("Années de pèlerinage, Deuxième année: Italie, S. 161, no. 4: …") matches like the WORK-tag form from 1.0.17, unless the head carries numbers of its own ("Book 1, BWV 846-869" names a set; the gate caught a false join on Grimaud's Bach). `catalogueNumber` reads Hyperion's "S161"/"S166r".
- **Two recordings of one work on an album** (box sets) were rejected as duplicate titles. A group that would be rejected is split where its opening movements recur in order (or, for a whole piece, at each repeat); a movement repeated inside one work (the B minor Mass's second Kyrie) splits nothing.
- **Whole pieces need no form word**: any title with its own catalogue number and nothing after it ("Tapiola, op. 112"), with the 1.0.20 exclusions (number within an opus, "from").
- **Movement paths.** The scan-time movement-title repair cut stored "I. Inferno: 1. Lento" (Dante Symphony) at its inner colon; 1.0.19's guard stopped that, and matching an album now restores a name whenever the track's title gives a longer path ending in it. Matching also keeps that longer path over a shorter MusicBrainz name.
- Audit dry run (`explainMatching`) reflects these rules automatically.

Apple corpus: block matches 157/189/150 (work-tags −2: Segovia's two BWV 999 tracks are now two blocks of one work; a Mozart box fragment under a garbage WORK tag "W. A. Mozart" is now its own work), false joins unchanged, six albums closer; Nutcracker and a Mozart pantomime now show fuller or shorter real movement names. Baseline saved. Validation: 283 plugin tests and both gates on Node 22; each change has a test failing on 1.0.20. Compose/Chromium not rerun (no core or page-contract change).

# Whole pieces, sets with their own opus, and a read-only audit

Manifest 1.0.20, November 13, 2026, at the user's request ("a lot of things that should match but aren't"). Plugin only; core stays `66b54b5`.

- **Whole pieces from the title.** Under Auto-match, a track whose whole title is a single-piece form with its own catalogue number ("Ballade No. 1 in G Minor, Op. 23", "Waltz in E-flat, op. 18", "Barcarolle in F sharp, Op. 60") is a one-track work. A number within an opus ("Op. 28 No. 3", "Op. 23/1"), no catalogue number ("Capriccio No. 1") or "from" (an excerpt) keeps it a piece the album page groups with its set; the Apple gate caught all three.
- **A set named in the plural with its own catalogue number is a work** ("Waltzes, op. 34", "24 Préludes, op. 28", "Transcendental Etudes, S. 139"), from WORK, a structured title or a numbered title ("Waltzes, op. 34 no. 1 in A-flat"). A set's name alone ("Études") and singular pieces ("Prelude No. 1, Op. 23/1") are not. Apple corpus: block matches and false joins unchanged; six albums closer to Apple; four (Sokolov's Salzburg Recital, Ashkenazy's Chopin Études, Lim's Transcendental Études, Aimard's Debussy Préludes) now join a shared work and take its movement names, as accepted before for Scheherazade. Baseline saved.
- **`scripts/audit-catalogue.mjs`** audits a live catalogue read-only (SQLite read-only and `query_only`; no migrations, matching, scans or network): every album as its page renders, flags (no work view, unmatched multi-track blocks, works missing movements, repeated headings, rows that restart their numbering or start with the composer, unsure tracks, open review items, duplicate works), and for every classical track outside a work the work its tags name and why Auto-match leaves it out, from the matcher's own rules (`explainMatching`, a dry run of `candidates`). Tested on a corpus-built catalogue whose file hash is unchanged after the run.

Open: the user's Dante Symphony shows numbered sections of two movements as one list restarting at 1; the user's Kobayashi Années still shows unmatched on their server. Both need the audit's tags from the live catalogue before changing anything.

Validation: 281 plugin tests and both corpus gates pass on Node 22; each matching change has a test that fails on 1.0.19. The Compose/Chromium workflow was not rerun (no core or page-contract change).

# Sets MusicBrainz identifies, composer spellings, a left-out movement and arrangement mapping

Manifests 1.0.18–1.0.19, November 13, 2026, at the user's request. Plugin only; the companion core stays `66b54b5`.

- **Sets are works when MusicBrainz names them.** Auto-match dropped any MusicBrainz parent whose title names a set ("Préludes, Livre I", "24 Préludes, op. 28"), so Debussy's preludes, tagged by Picard with recording IDs and bare titles ("Voiles"), never matched. The exclusion now applies only to free-text set names in tags. Climbing to the parent stops below a set-named parent once a work has parts of its own, so each book of Debussy's Préludes is its own work. A numbered piece titled with its plural set's full name reads "No. 6 in B minor". (1.0.18 grouped the books by disc subtitle instead; the user asked that they match like everything else, so that was removed.) The corpus MusicBrainz mock now lists a work's parts, and gains Zimerman's Préludes and an Op. 28 recital.
- **Composer prefixes across spellings.** "Rachmaninoff:" is read past for a composer tagged "Rachmaninov" (also Tchaikovsky/Tschaikowsky, Prokofiev/Prokofieff and similar; `nameKey`). Auto-match of one album now repairs that album's stored movement titles that still spell out their work, so works matched before 1.0.17 lose the prefix without a library-wide pass.
- **A left-out movement fills its slot.** Extending an album's recording with a track an earlier pass left out (Trifonov's Rachmaninoff Op. 40, whose first movement also credits Saint-Saëns) uses the work's movement this recording lacks when the names agree, instead of adding a duplicate and still reporting it missing.
- **Movement numbers never override names.** `mapToMovements` rejects a unique numbered match whose name starts differently, so Rachmaninoff's suite from Bach's BWV 1006 ("2. Gavotte") no longer lands on the partita's "II. Loure"; the album goes to review (movement-mismatch).

Validation: 280 plugin tests and both corpus gates pass on Node 22 with the Apple baseline unchanged. The gate caught and the source now avoids: a name-prefix movement rule (false join on Argerich's Teatro Colón recital), trimming "Metamorphosis No. 1" to "No. 1", and the stored-title repair cutting "IV. Menuet I - V. Menuet II". Each change has a test that fails on the previous release. The Apple corpus has no MusicBrainz data, so the MusicBrainz path is covered by the hand-written corpus only. The Compose/Chromium workflow was not rerun (no core or page-contract change).

# Grouping fixes and large box sets

Manifest 1.0.17, November 12–13, 2026, at the user's request, picking up a Codex review whose unpushed work was lost. Companion core commit `66b54b5` on `aurral-classical`; integration CI pins it.

- **Large box sets (core).** A 1,460-track recital renders about 1,040 groups and 600 KB; core rejected anything past 200 groups or 512 KB, so the album showed no works. Validation also reloaded the album once per group (2.1 s at 1,460 tracks with 150 groups). Core now bounds groups and items by album size (5,000) and 5 MB, reads the album once and checks tracks through an ID set (40–120 ms), and returns 502 when a contribution fails so the album page shows "Couldn't load works" with Try again.
- **Requiem.** Movements crediting different completers made a work per credit combination. An album's groups that share a MusicBrainz work, or a catalogue number and a composer, now make one work credited to the shared composers; the other composers are credited on the recordings that name them. Existing splits are repaired during Auto-match when each work is an unedited auto work with one realization on that album and no conflicting verified identity; favourites and picks move to the kept work. The album page compares composers as sets.
- **GROUPING whole pieces** match like WORK.
- **Années / S. 161.** A WORK tag with neither form nor number matches when its titles share one catalogue number; the work keeps the WORK title, is found by that number (saved as an alias), so S. 160 and S. 161 stay apart. Work keys read S., L. and other punctuated systems through `catalogueNumber`.
- **Composer-prefixed titles** ("Rachmaninoff: Piano Concerto No. 2…: I. Moderato") are read past a prefix naming one of the track's composers; recordings keep the tagged title.
- **Numbered set pieces** ("24 Préludes, op. 28 no. 6 in B minor", Glass "Études no. 9") head as their set with rows "No. 6 in B minor"; display only. Singular names (Field's nocturnes) and titles with a key before the number stay single pieces. `isCollectionLike` missed names starting with "É" (`\b`), now fixed.

Not changed, with reasons: Debussy's two Préludes books need disc subtitles, which scans don't pass to the plugin. Glassworks' "Opening" and its rework already share one unmatched block as two rows, which is right. The Lugansky Corelli split in the user's library matches a Corelli track tagged WORK = Paganini Rhapsody, a file tagging error; the corpus album tagged by title groups correctly. Unmatched Trifonov concertos with WORK tags match in a fresh catalogue, so in the user's library they are likely held by an open review item (ambiguous work or composer) from earlier duplicates; the editor's Review tab shows the reason.

Validation: 275 plugin tests and both corpus gates pass on Node 22 (Apple baseline saved for three improved études results on Ashkenazy's and Lim's albums, no regressions; non-classical unchanged). Each fix has a regression test that fails on the previous source. Core `66b54b5`: required checks (unsafe-any 1139 unchanged), full suite (385 files, 2,641 tests) and frontend build pass. The full Compose/Chromium/restart workflow passes locally against core `66b54b5` (smoke, editor fixtures, Chromium editor and work view at desktop and phone widths, persistence and media hashes across restart). A synthetic 1,460-track Liszt box in the same instance: album presentation 730 groups, 572 KB, 109–164 ms through the host; the work view appears in about 1 s at 1280 and 390 px, with no page errors or horizontal overflow. Playwright's `getByRole` takes about 12 s to search that page's 43,000 nodes, so browser checks on box sets should wait on CSS selectors. Remote CI has not run (the workflow runs on pull requests and `phase4-review`); no live install accessed.

# Integration against the upstream-synced core

Manifest 1.0.16. November 12, 2026: core `aurral-classical` merged fork `main`, now level with upstream lklynet/aurral through #1828 (core `f444c96`; backup `aurral-classical-backup-2026-11-12`). Integration CI now pins that core. Running the full workflow against it found two plugin-side issues, both fixed:

- **Album group order was random on a tie.** When two recordings start on the same track (a complete one and a fragment), their blocks were ordered by realization id, a random UUID, so the order could flip between installs and the fixture check passed or failed by chance (it passed on the old core and failed on the new one with identical plugin code). `compareAlbumGroups` now puts the longer block first, then orders by id. A unit test with ids in the wrong order covers it, and the Phase 4 model test now asserts the order.
- **Fixture seed import.** Upstream moved `hashPassword` from `backend/middleware/` to `backend/services/`; `dev/seed.mjs` tries the new path, then the old one.

`dev/editor-browser.mjs` accepts `CHROMIUM_PATH` for a preinstalled browser (CI unchanged).

Validation: 270 plugin tests on Node 22.23 and 26.12; bundle rebuilt. Against core `55e7fa1` (code identical to `f444c96`): Compose smoke (admin and two users), editor fixtures, Chromium editor/work-view/row-menu workflow at desktop and phone widths, fixture checks before and after restart, and smoke after restart all pass. Containers and volumes were removed. Remote CI has not run; no live install accessed.

# Fix: first request after a restart timed out on the integrity check

Manifest 1.0.15. Opening the database ran a full `PRAGMA integrity_check` and `foreign_key_check` once per process, on whichever request came first; seconds on a large library, paid by each of core's two plugin workers after a restart, so first requests timed out. Opening no longer checks. Migrations and backups check as before; a library scan checks once per process before it writes, and fails the scan if the check fails. Regression test opens a never-opened copy of a broken database (as after a restart): the page call succeeded only with the fix, and the scan rejects. 269 plugin tests pass. Fixes Collinlong1/Aurral-Classical-Plugin#9. The user's crash logs were not available, so this fixes the known startup timeout, not a confirmed root cause.

# Work matching: GROUPING, catalogue-numbered titles, arrangements

Based on plugin `7e73e61` and companion core `6b7389c7`; manifest 1.0.14. From a real library: Picard files with the work in GROUPING and WORK empty, Trifonov's arrangement of The Bells (MusicBrainz links it by `arrangement`, not `parts`), and unmatched blocks that looked like works.

- Titles: Auto-match accepts a title head with a catalogue number ("The Bells, op. 35"), not only a form word. Catalogue ranges ("BWV 846-869", "HWV 349/350") name sets and stay unaccepted.
- GROUPING (FLAC/Opus `GROUPING`, MP3 `TIT1`, M4A `©grp`) is read when WORK is empty, under the same test as WORK. Without a catalogue number it must also be named by the track's title, so free text such as "Romantic Concerto Highlights" makes no work. Scans now create works from WORK or GROUPING; titles still need Auto-match.
- MusicBrainz: a work with no `parts` parent and exactly one `arrangement` (backward) link is matched as the work it arranges. One extra cached request per arranged track, only during Auto-match.
- Unmatched blocks of several tracks carry `detail: "Not matched to a work"` (not on sets such as Études). Core renders it under the heading.

Corpus: Destination Rachmaninov: Arrival (as tagged), an arrangement-only album, a free-text-GROUPING compilation and the Kobayashi recital. Apple corpus (one shared library): tracks in real works rose from 1,853 to 2,579 (store) and 1,714 to 2,411 (messy); WORK-tagged unchanged; block matches and false joins unchanged; rows read like Apple's 82%→83% (store), 89%→90% (work-tags). The saved baseline accepts two row-name changes: Scheherazade and Chopin Études now become works shared with another album, whose recording named the movements first ("(Live)" included). Range exclusion was added after the gate caught false joins on Bach's Well-Tempered Clavier and a HWV 349 into 349/350 merge.

Not fixed: a WORK tag naming a set with neither form nor number (Années de pèlerinage) still makes no work. Existing installs need a library scan (to record GROUPING) and Auto-match per album.

Validation: 268 plugin tests (GROUPING read in flac/mp3/m4a/opus); core required checks (zero type errors, unsafe-any 1236), 28 plugin-host tests, frontend build. Node 22 locally. No real-browser pass of the new heading line; no live install accessed.

# Review fixes on the latest Claude source

Based on plugin `1019fd5` and its companion core `f3cea93c`, preserving the mixed-artist/title parser and chunked scan checkpoint changes. Automatic duplicate-work repair now respects distinct verified work and composer identities on later scans. Album revision tokens cover both chosen/attached works and their movement labels, rejecting stale assignments and unassignments with 409. The previously tested standalone-work presentation hotfix is integrated with the new composer/title parsing; manifest 1.0.13 includes it. Already mismerged catalogue entries are not automatically split.

Companion core fixes row-menu playback to retain plugin item identity, work source and segment bounds, and shows full work-and-part titles on album and work-page playback. Chromium covers Play/Play next/Add to queue at desktop and phone widths, along with existing editor, permissions, per-user state and restart/media checks. The Requiem grouping investigation is separate; see `REQUIEM_GROUPING_REPORT.md`.

Validation: all 262 plugin tests and both corpus gates pass, plus the final 23 manifest/editor tests after the version/bundle refresh. Both identity and stale-album regressions fail on the previous source. Companion core `ece9ead0aab0e28947bd6ac3d03208209cae86b8` passes 57 focused queue/plugin tests, required checks (zero type errors; unsafe-any 1236 unchanged) and the frontend production build. Disposable Chromium checks the editor and all three row-menu actions at desktop/phone widths; restart/media-hash checks and admin/two-user exact-file smoke pass before and after restart. Integration CI pins that core commit; remote CI and live-instance deployment have not been run.

Full core run: all 2,762 assertions passed; 405/406 suites passed, with `app-backup.test.ts` failing only its 10-second cleanup hook. The unchanged backup file passed all four tests and cleanup in an isolated one-second rerun. No backup source, timeout or validation baseline was altered to hide the full-run result.

# Fix: the plugin turned itself off when the editor was open during a scan

November 12, 2026, at the user's request. Reproduced with a host simulator that follows core's rules (256 MB heap, 15 s page calls, broken-call counting) on 12,800 tagged files: on a rescan, an editor read waited more than 15 s. Causes and fixes:

- **Plugin — quadratic checkpoints.** Every scan checkpoint (each 200 files or 10 s) rewrote *all* evidence read so far as one JSON blob, synchronously. Checkpoints now save only the evidence read since the previous one, as a chunk row (a `model_job` row of type `scan_chunk`, inside the same fenced transaction; no schema change). Resume reads the chunks; a scan saved by the previous version (`progress.collected`) resumes and re-saves it as the first chunk.
- **Plugin — finished scans never compacted.** Each finished scan kept its whole file list and evidence (~22 MB per scan at 12.8k files), so the database grew with every manual and 6-hourly scan, and so did the full integrity check each new plugin process runs on its first call (often the editor's). Finished and cancelled scans now keep a summary (instance, total, cursor, error count, errors); older bloated jobs are compacted when the next scan is queued. Status reads the total from the summary.
- **Core (`f3cea93ca910f87ad7c1db3c16b3a4eeda967cd2`, fork branch `claude/inspiring-volta-bcj34a`).** A call that waited behind another call is "busy" even if that call answered just before the timeout; one process death counts once, not once per waiting call. Integration CI now pins this commit.

Result in the simulator: scans 29.5 → 18.5 s (rescan 17.2 → 7.6 s); slowest editor read during scans 1.8 s; no failed or broken calls; database flat at 101 MB over repeated scans (previously +22 MB per scan). The ~3 s atomic publish at the end of a scan remains by design. Tests: `test/scan-checkpoints.test.js` (3, each failing on the previous source); core gains 2. 262 plugin tests pass. Manifest 1.0.12. After installing, existing bloated databases shrink internally at the next scan start (the file keeps its size until a manual VACUUM; free pages are reused).

# Messy metadata matching (optional quality workstream, plugin only)

The user asked to work from *Aurral Classical — Messy Metadata Matching* (November 12, 2026). New `src/model/credits.js` reads a composer from a mixed artist field ("Bedřich Smetana; Vienna Philharmonic") when no composer tag exists: high confidence only when the album/track title, catalogue system or a known library composer corroborates it; medium-confidence names never create works and open an `auto_match` review (`uncertain-composer`). Classification, matching and the album page share it. Title parsing handles comma-separated movements and colon-before-quote headings; the classifier knows WWV/BuxWV/SWV/TrV and comma-anchored L./M./S./FP; neighbouring pieces join when one heading is the other cut at a comma. Apple corpus: messy 113 → 150/204 exact (false joins 167 → 155), store 153 → 157, work-tags 191 unchanged; no album lost exact grouping; non-classical corpus unchanged (0 false positives). The Apple gate now also blocks new false joins. Audit, explained differences and what was not done (MusicBrainz candidate scoring) are in `MESSY_MATCHING_REPORT.md`; `node scripts/corpus-apple-audit.mjs` reproduces it. 259 tests pass. Manifest 1.0.11. No core, schema, tagger or media change.

# Standalone-work album presentation hotfix

The v0.1 standalone matcher can create valid works with no canonical movement rows. Album presentation now counts such a whole piece as one part, satisfying the existing core contract, and retains the work view when matched works each occupy one track. This fixes the transition from a visible work view to a rejected/absent view after Auto-match. Source and bundle changes are plugin-only; existing attachments need no rescan or rematch. Originally tested against 1.0.10, this hotfix is now integrated into 1.0.13.

Initial validation against 1.0.10: both regression assertions failed before their fixes; all 253 plugin tests passed, including the unchanged Apple and non-classical corpus gates. The rebuilt bundle's real album handler passed the pinned core album-response schema. Revealing previously hidden single-track albums also preserves their own part titles when a WORK suffix names something different. A guarded three-replacement patch of the old bundle matched that rebuilt bundle byte for byte. The separate timeout was not diagnosed by this presentation fix; the later Claude checkpoint and host changes above address its reproduced causes.

# v0.1 classification accuracy fix (plugin only)

The user authorized the classification fix scope (November 12, 2026). New `src/model/classify-evidence.js` replaces `classify()`'s scoring: composer credits and generic title words are supporting only, a WORK tag equal to the title is ignored, genres match as whole names via the resolver's lists, popular genres block automatic classical, and soundtrack, game and crossover genres allow only verified classical works. Pins and inherited album pins are unchanged. Read-only diagnostics: `node scripts/model-admin.mjs classification MODEL_FOLDER` and the admin album action **Classification report (read only)**. On the non-classical corpus (now 32 albums, 157 tracks) there are 0 false positives and 0 false negatives, enforced in CI. Apple messy-style grouping is 94 → 113/204, with two explained matcher side effects; store and work-tag styles are unchanged. 234 tests pass. Manifest 1.0.10. No matcher, tagger, schema, core or deployment change. Real-library validation is a user-run dry run; see `NONCLASSICAL_CORPUS_REPORT.md`.

# v0.1 non-classical validation corpus (tests and reporting only)

`test/corpus/nonclassical/` adds 30 albums / 148 tracks of ordinary music, mixed soundtracks, crossover and mistagged classical fixtures, each with reviewed track- and album-level expectations. `test/corpus-nonclassical.test.js` runs them through the real admin scan, auto-match, album/track pins, a retag and rescans, and gates on `nonclassical-baseline.json` (every known failure carries a written explanation). CI runs both corpora (`corpora` job) and the new corpus in the no-network isolation job. No `src/` or bundle change. Result: **v0.1 classification acceptance not met**. There are 30/108 false classical positives (generic WORK tags, substring genre matches such as "rock opera"/"baroque pop"/"new romantic", and tempo words in titles); pins, media, rescans and behaviour-follows-classification hold. See `NONCLASSICAL_CORPUS_REPORT.md`. Classifier fixes need separate approval; expected states await user review.

# v0.1 bug-fix scope — remaining fixes and final integration

Same day, at the user's request (“Continue with all of the fixes”). All 16 scope items now have fixes and regression tests. Plugin-only runtime changes; core source unchanged. Schema unchanged (still migration 3).

- **#11** Lyricist is a model role (person only); both editors use one shared role list and explain wrong contributor kinds.
- **#6** Revision tokens now cover what the page shows (entry + movements; album tracks, attached works, classification state and attachments; review + subject). Writes whose targets fall outside the token's scope are rejected (409), closing the hole where an empty-page token skipped stale checks. A no-change rescan doesn't stale an album page.
- **#10** Sync requests are cleared only after a fresh snapshot is queued, and only if no newer request arrived; a failed snapshot, a pending older scan or a resumed failed scan no longer drops them. A request newer than a failed scan takes a fresh snapshot instead of resuming.
- **#21** Provider conflicts, omissions and state reviews keep every field/record in one review (`entries`) instead of overwriting; pinned fields no longer re-raise conflicts. Provider label `openopus` now shows as Open Opus.
- **#16** Review actions: merge into the other work (duplicate-work), merge same-name people, choose a provider value per conflicting field (`choose-provider-value`, pins that assertion), link a moved file to a candidate (`relink-track`).
- **#22** `similarWorks` finds likely duplicates (same key, or same bare title ignoring key/catalogue). Create work / Create from album refuse with a 409 listing them unless **Create anyway**; album pages list *This work may already exist* with **Assign here**.
- **#20** MusicBrainz parent/leaf `composer` relations travel as `composerIds`; matching reuses the person holding that artist ID, gives the ID to the only unverified same-named person, queues review when several could be them, and won't reuse a same-titled work by a differently verified composer.
- **#5** Single-track works: tag rule (WORK tag naming the work, no movement part, title is that work) and MusicBrainz rule (parentless, non-collection work whose track title isn't a movement). Created with no movements; existing group keys unchanged. Corpus output identical.
- **#8** Reusing a work for a MusicBrainz-identified album records the MusicBrainz ID on it; lookups also try the tags' title and MusicBrainz aliases (an alias index used only for lookups); works tied to another MusicBrainz ID are excluded. The explicit auto-match's unattached-track query had the #1 leftover-segment bug and is fixed.
- **#4** Integration CI now pins core `10cd64083bd8d69af85c8356124664b5abf1306f` (final `aurral-classical` head; the old pin `45da13b` predated five core commits). Run locally without Docker (no daemon here) by mapping the Compose paths to disposable directories under Node 26.12 with the preinstalled Chromium: core `pnpm check` (0 type errors, unsafe-any 1236 = baseline) and `pnpm build`, smoke (admin + two users, exact-file streaming, zero acquisition), editor fixtures, full Chromium editor + Phase 4 work view, restart, persistence/media-hash check and smoke again all passed. Fixing it needed only test updates for intentional core UI changes (“By work”/“By track” labels, work titles as links, “Missing …”, player naming the work on the album page) and two stale checks (schema version now read from the latest migration; album-ordered groups split a non-contiguous recording). Remote CI not observed from here.
- **#12** README gains a current Classical catalogue section replacing the Phase 2/3 review notes; EDITOR_GUIDE covers review actions, Create anyway, roles and stale tabs.

Validation: 234/234 plugin tests (10 new regressions, each failing on the previous source), both corpora, Phase 1 comparison smoke. Not done: read-only scan of the real library (no production access is authorized; the user must run it). Noted, not changed: the work page player shows only the part title, while the album page shows “Work: part”.

# v0.1 bug-fix scope — matching fixes #7 and #9

Same day, at the user's request (“Keep going with #7 and #9”). Plugin-only; core, schema and media unchanged.

- **#7 Duplicate creation on ambiguity.** When more than one existing work matched an album, auto-match created yet another work, re-pointed its index at that new copy (so later albums landed there too) and only then opened a review. It now opens an `auto_match` review (`ambiguous-work`, listing the candidates) and creates nothing. A composer name shared by several existing people likewise queues `ambiguous-composer` instead of adding another person. The review page links each candidate; assigning the album from the editor resolves the review.
- **#9 Metadata erased on parse failure.** When the tag parser rejected a file, the scan replaced its evidence with empty tags, wiping composer, WORK, MusicBrainz IDs and genres (and with them classification and matching). The scan now keeps the evidence an earlier scan read, marked `tagsUnreadable`, unless the audio hash shows different audio; host title/artist/album fill only fields the tags never had.

Validation: 224/224 plugin tests including both corpora; 3 new regressions confirmed to fail on the previous source. Integration CI and real-library scan not run here. Still open from the scope: #5, #8, #10, #20 (beyond the ambiguity guard), #21, #22, #6, #11, #16, #4, #12.

# v0.1 bug-fix scope — data-integrity fixes (#1, #2, #3, #15)

November 12, 2026. The user asked to work from the *Aurral Classical — v0.1 Bug-Fix Scope* document. This pass fixes its data-integrity group only; the matching/metadata, editor/review, integration (#4) and README (#12) items remain open. Plugin-only; core, schema and media are unchanged.

- **#1 Incomplete unassign.** Unassign and v1 Detach removed only the `realization_item`. The leftover segment kept the track "attached" for auto-match, and leftover recording content/performance links kept the work and movement "in use". New `Catalogue.detachItem` removes, in one transaction, the segment, its content links, an emptied realization (clearing user/admin picks of it) and, for Unassign, the per-track recording and emptied performance. Auto-match now counts a track as attached only through a realization item, which also covers segments orphaned by older unassigns. An admin Unassign is a manual override: auto-match won't put that album back into that work until the admin assigns it again (read from the editor audit trail).
- **#2 Stale identities after merge.** Merging works or people moved only `embedded-tags` identities, so a MusicBrainz work ID kept pointing at the deleted work and later provider matching attached tracks to it. All identities (works, their mapped movements, people) now move to the survivor; provider lookups ignore deleted entities; `repairMergedIdentities` follows merge audit records to fix already-merged catalogues on the next match pass. The duplicate-composer repair now uses the same merge path.
- **#3 Lost preferences.** When a user had state on both works, `UPDATE OR IGNORE` dropped the merged-away row's favourite and pick. Rows now combine: favourite if either was, the kept work's pick, else the dropped work's.
- **#15 Not-classical tracks reassigned.** *Create a work from this album* sent every unassigned track, including ones marked Not classical, and flipped them back to Classical. The form now has a per-track **Add as a movement / Skip** choice (generic host `mapping` field, no core change) with Not classical tracks defaulting to Skip; without choices the command skips them.

Validation: 221/221 plugin tests (4 new regressions in `test/editor-v2.test.js`, each confirmed to fail on the previous source), including both corpora; bundle rebuilt. Not run here: core/plugin integration CI, real-library read-only scan. Known limit: recordings orphaned by unassigns before this fix stay until removed by hand.

# Post-Phase-4 recording search and automatic matching start

The recording attachment form now requires the page-level **Search items** query and searches the complete owned-track index while retaining the selected recording; it no longer exposes a misleading arbitrary 200-file prefix. A first conservative automatic matcher builds multi-movement work realizations from confirmed-classical tracks with explicit embedded `WORK`, composer and unique release-order evidence. It runs when a full model scan commits and is also exposed as **Auto-match classical works (read only)** for already indexed albums. The explicit admin action additionally accepts a shared structured title prefix with a numbered/Roman movement suffix when composer, album, classification and unique release order agree, and resolves saved MusicBrainz recording/work identities to a shared parent work through the existing rate-limited cache. Unattended scans retain the stricter tag-only rule. The matcher is idempotent, plugin-database-only and excludes collection-like étude/prelude/song sets. No media writes or writable mount are required.

# Phase 4 scan compatibility correction

The user's schema-2 production-model scan first failed at 4,130/12,802 files with `can't tag .wav files`, then reached 4,360 and retried on `MPEG audio header not found`. The read-only model scanner was incorrectly making optional tag parsing fatal. Files rejected by the tag parser now retain full-file hash evidence and use the host's trusted title/artist/duration metadata without being opened for tagging or modified. An explicit Scan reuses the active retry or requeues the latest failed saved job with its existing cursor and snapshot. A later `running; processed 4420/12802; Error: MPEG audio header not found` report was successful forward progress with stale retry text; successful claims/checkpoints now clear stored errors and status shows errors only for retry/failed states. All 179 plugin tests pass. Core, schema and the unrelated BrainzMash refresher are unchanged.

# Current checkpoint — Phase 4 complete for review

The user explicitly authorized Phase 4 on November 10, 2026 (America/Chicago). Grouping, bounded playback, the basic work page, schema-2 user state and generic host hooks are complete locally. Validation passed 175 plugin tests, 2,757 core unit tests across 406 files, 52 focused Phase 4 tests, required checks/build, real Chromium, restart persistence and exact-file playback for an admin and two users. See `PHASE_4_REPORT.md`. Stop before v0.2 search or later page/Discover scope. The user's container name is `aurral-phase3-test-aurral-test-1`; no agent access to it is authorized. BrainzMash refresher code remains untouched at the user's request.

Companion core implementation: `019e93f5a2f4720f8f0238c40c851dfb1070b740`, published on the user fork `phase4-review` branch and pinned in integration CI.

Final observed implementation CI is green for plugin source `ce351e16d9a82f1cbc0284548ee218491146b29c`: run `43011161488` passed the four Node-version jobs plus isolated no-network model migrations, and integration run `43011160969` passed the pinned core checks/build, synthetic startup, Chromium Phase 4 workflow, restart/media verification and admin/two-user playback smoke. Later documentation-only commits do not change runtime source.

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

# Current checkpoint — Phase 3

Final observed implementation CI is green: plugin source 84ea58d39362532f1f3551906e4fef01a7eda77b / pinned core 7ea6b2211f469d9c1342fee998fe82d2289232ff; runs 42934882603 and 42934882763 passed all six jobs, including four Node versions, isolated model/editor tests, core checks/build, Chromium, permissions, restart/media hashes and existing comparison playback. Later documentation-only commits record this outcome; no runtime change.

November 10, 2026 (America/Chicago). The user explicitly said “Lets begin phase 3” and “Continue with phase 3.” Phase 3 is complete for review. Phase 4 is not authorized.

Companion core implementation: `7ea6b2211f469d9c1342fee998fe82d2289232ff`, published on the user fork phase3-review branch and pinned in editor CI.

The plugin now provides an admin manual editor over schema 1: provider-free composers/works/broadcasts, typed field edits/provenance/pins/unpin, canonical movement reordering, role credits, owned-track attach/detach, read-only media and stale-tab protection. Generic core admin-forms v1 adds only opt-in manifest pages, authenticated bounded transport and a host renderer/Settings entry. No classical core schema or new migration. See the central plugin PHASE_3_REPORT.md, EDITOR_GUIDE.md and UPSTREAM_DELTA.md.

Validation: 2,755 core unit tests (406 files); 23 focused core plugin tests; 168 plugin tests including 9 editor tests; required checks with zero type errors and unchanged 1,236 unsafe-any baseline; frontend/docs/plugin builds; real Chromium desktop/phone workflow, regular-user denial, provider/pin/blank/conflict and stale-tab handling; real Compose restart with unchanged read-only media and existing admin/two-user streaming. The report distinguishes broad-run source from later CSS/docs/test typing refinements and records remote CI separately.

Local paths remain /workspace/work/plugin and /workspace/work/aurral. Implemented on existing local classical branches atop plugin bf47025 and core d93cd812. Separate phase3-review source snapshots are used without moving remote classical/main or merging prior PRs. No new PR, merge, release, upstream activity or production access. Preservation branches are untouched. No subagents.

The editor requires the matching fork's admin-forms bridge; no stock editor fallback is claimed. Work pages, grouping, segment playback, entity merges and richer pages remain Phase 4/later. The fixture HTTP relay is test tooling only and does not proxy WebSockets. Do not claim production-library or real-library operational acceptance.

Historical checkpoints below retain their original observations; their authorization/completion wording is superseded by the current checkpoint.

# Current shared checkpoint — Phase 2

Final observed Phase 2 implementation CI: plugin run 42887705310 passed all five jobs on `eb997d521ccf1aad2d1f611b0fd5b62bcba6e8eb` (159 full-suite tests on each Node22.16/22/24/26 plus isolated model tests and bundle consistency). Source snapshots are in both user repositories on phase2-review; core snapshot bae8d4ba is documentation only. Later handoff/result commits do not change runtime source. No new PR or merge.

November 10, 2026. User request: “Phase one should be done. Verify then continue and build phase 2.” This authorizes Phase 2 and supersedes old pending-approval language below. Phase 3 is not authorized.

Phase 1 review source is in open, unmerged plugin PR6 and core PR36. Fresh clones initially had only Phase 0.5 on remote classical. Local existing `aurral-classical` branches were fast-forwarded to plugin `e1a980ad768af6c8d3e5122e85f05a6e68b3629b` and core `581e8b6ca32908652eecb673620ee6f1389a96b5` as the Phase 2 baseline. No remote refs or PRs were merged. Preserve those prerequisites when applying the Phase 2 patch.

Phase 2 implementation lives entirely in the plugin: native SQLite/WAL schema 1, typed catalogue/relationships, provenance/pins, conservative reconciliation, classification and tag guards, persistent fenced scan jobs, admin scan/status/cancel actions, maintenance CLI and operator documentation. Core runtime is unchanged. See central plugin MODEL_V1.md and PHASE_2_REPORT.md for executable APIs, exact checks and limitations.

The final model suite includes all committed synthetic fixtures, full rescans, provider-free broadcasts, reissues and multi-work ranges. No real-library snapshot or production server was used. The host still lacks an automatic database epoch: admin must update Library database epoch after replacing/restoring its database. Hashes guard reused IDs; ambiguous/retagged moves are held for review. No editor, work page, grouping, user picks or new player behavior is claimed.

Phase 1 verification caveat: core head checks and latest disposable integration passed. Plugin push CI at e1a980ad passed all Node versions, but PR run 42882247578 failed Node22 and cancelled its other jobs. Connected GitHub job logs subsequently identified ENOTEMPTY in background-writer test teardown; Phase 2 waits for completion before cleanup. A loaded Node26 run also exposed a dispatch-throttle race, now fixed with serialized rate-limited dispatch and a regression test. Fresh Phase 1 tests passed 138/138; final Phase 2 tests pass 159/159 on Node22/24/26, with 20 model tests on Node22.16 and in a no-network read-only-source container. Keep the original failed observations in the report.

Current checkout paths: /workspace/work/plugin and /workspace/work/aurral. Work is on local existing classical branches, not main. Phase 2 is saved as a separate phase2-review source snapshot; remote classical/main and existing Phase 1 PRs are not merged. No new PR, release or deployment was requested. The source branch and report are the review handoff. Keep main, upstream, preservation branches and existing review PRs untouched. No subagents were used. Stop for review before Phase 3.

Historical handoff follows; its authorization and completion statements are superseded by this checkpoint.

# Codex / Claude shared handoff — Phase 1

## Published review checkpoint

Final observed implementation CI: core run 42881762781 passed all jobs (required checks/docs, both unit shards, full integration suite and production-container build/smoke); core Perf passed. Plugin CI and disposable integration run 42881393448 passed. Later documentation-only commits may trigger repeat checks, but runtime source is unchanged. Phase 1 is complete for review; stop here and wait for Phase 2 approval.

Remote disposable Compose integration run 42881393448 completed successfully, including real HTTP comparison/playback for admin and two users and a repeat after restart. Plugin Node22/24/26 CI also passed. Core CI rerun 42881762781 follows the fork-workflow fixes; consult its live status. Authoritative fetched review worktrees: /workspace/work/phase1/review-core and /workspace/work/phase1/review-plugin.

Phase 1 implementation and local acceptance are complete. Both fork-only PRs are open and unmerged: core https://github.com/Collinlong1/aurral/pull/36 and plugin https://github.com/Collinlong1/Aurral-Classical-Plugin/pull/6. Both target aurral-classical from phase1-review. Core runtime source commit aecbb96625340cb3a1bd469787211cfe9bedcab5; plugin source commit 2f9beeb2608d41cb767664a3d378180e6b942136. Later commits record CI/workflow fixes and this handoff.

GitHub core unit/integration/Perf checks passed on the first publication. Core CI also exposed two inherited workflow issues: unsupported Dependency Review on this fork and uppercase OCI image tag. The review workflow now checks dependency changes before invoking the dependency API (no dependency changes in this PR) and lowercases the image name. No checks are made continue-on-error. Plugin Node22/24/26 CI passed; disposable integration run 42881393448 was running at this checkpoint. Consult live PR checks before merging; the final chat reports the observed final status. Never treat local green results as a claim that all remote jobs are green.

No further feature implementation is authorized until Phase2 approval. Finish only CI repairs for these PRs if needed. Do not merge, deploy, modify main or upstream. The historical recovery/state paragraphs below describe the development sequence and are superseded by this published checkpoint.

Updated November 10, 2026. User authorized completing Phase 1 and opening PRs **in Collinlong1's repos targeting aurral-classical**. Phase 2 is not authorized. Finish pending Phase 1 verification/publication recorded in PHASE_1_REPORT.md; then stop for review.

Local Phase 1 validation is complete: core post-drift full suite 2752 tests, final acceptance rerun33, plugin138, Subsonic40; required checks/builds pass. Core PR36 is open at aecbb96625340cb3a1bd469787211cfe9bedcab5 into classical. Plugin publication/remote CI status is recorded in the final PR/checkpoint. Do not restart implementation or advance Phase2 while review is pending.

Read PHASE_1_REPORT.md, FORK_FEATURE_INVENTORY.md and (in the plugin repo) INTEGRATION_CONTRACT_v0.1.md and UPSTREAM_DELTA.md. PHASE_0_REPORT.md and PHASE_05_REPORT.md are historical audit records; their pending-approval statements do not describe current authorization.

## Current work

- Existing classical branches were used for implementation. Review snapshots go on phase1-review so the requested PRs can target the existing classical branches. Do not merge PRs automatically.
- Plugin: all owned explicit-work comparison, per-user playlist keys and queue completion, performer-first slskd, preview/clear/restore tags, verified atomic writes/backups, background writes off by default, synthetic fixtures and internal-network Compose.
- Generic core: action-scoped user-operation grants, complete library snapshot, local-only durable playlist operation with execution-time permission/expiry checks, consistent indexed paths on create/update/append, native Soulseek acquisition identity before source priority.
- No plugin data-model migrations or classical fields in core tables. Existing core jobs/settings persist operations; no new SQL schema.
- Fixtures exercise admin plus two regular users (no acquisition permission), exact owned streaming, no downloads, restart/idempotency, >25 recordings, cross-release copies, seven-value native tags, provider omissions and stock missing capability.
- Full structured schema/manual identities without explicit work evidence, editor, grouping, work pages and segment playback remain Phase 2–4.

## Source drift

Entry plugin classical: 393fbdb507324473ba861b577a9517d252332048; plugin main: 506e5259e1442b8cfe072a75b129abb428c6bcf7.
Entry core classical: 1a7f0081ef6b75ce4faa408dfae3a40572d1d359. Core locally merged frozen fork main c0deb211 via 30ba667d, then Phase 1 source a051bf3e.
During this phase, external merges advanced core main to 3739443a000defa9f246681e8a62233c1faef1c3 and core classical to 1b3c1c0074bd39df48bb115eca5254a07dde64b9, bringing upstream 021b1f03. These updates are preserved in a local merge. Do not reset remote refs. None of our writes target main or upstream.
The original fork still has 52 net changed paths (+3130/-181) against matching upstream 021b1f03, with 111 fork-only historical commits on live main. Sixteen preservation branches remain unchanged on 7afcb7cb. See PRESERVATION_BRANCHES.json.

## Validation and recovery

Read the Phase 1 report for final checks. Initial pre-drift full core run passed 2750 tests/406 files; subsequent source refinements and external drift require the recorded post-merge checks. Do not substitute the old audit's 2743-plus-timeout run. New plugin suite reached 138 passing tests; focused core grant/playlist tests and 40 Subsonic integration tests pass. The report records later results and limitations.

Core checkout /workspace/work/phase05/classical; plugin /workspace/work/phase05/plugin-repo. Logs /workspace/work/phase05/phase1-*.log. Node26.12 and pnpm12.15 under /workspace/work/phase05/tools/bin. Use workspace XDG directories; ASTRO_TELEMETRY_DISABLED=1. Independent node_modules per checkout; avoid heavy simultaneous builders.
Compose project aurral-classical-phase1 has only synthetic named volumes and an internal network. The daemon's published port was unavailable from the outer shell in this environment; docker compose exec runs the real HTTP/stream smoke inside the container. It passed for admin and two users, including after restart. No user server was accessed.

## Persistent boundaries

No main writes/merges, upstream edits/branches/PRs/comments, production credentials/server access or automatic deployments. No subagents without explicit user approval. Keep classical logic/storage in plugin and core hooks generic. No automatic PR merge. User approval is required before Phase 2. Update this shared handoff and report at each session boundary.
