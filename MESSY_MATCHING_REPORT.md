# Messy metadata matching — report

November 12, 2026. Work from *Aurral Classical — Messy Metadata Matching* (optional quality workstream, not a v0.1 release gate). Plugin only: no core, schema, tagger, media or deployment change; no production access; no file-tag edits. Built on `7df4b49` (v0.1 bug fixes + classification fix, manifest 1.0.10). Manifest 1.0.11.

## Results (Apple corpus, 204 real releases, 3,134 joinable track pairs)

| Style | Exact grouping | Movement titles | False joins (albums) | Missed joins |
|---|---|---|---|---|
| store — before | 153 (75.0%) | 83.4% | 143 (23) | 150 |
| store — after | **157 (77.0%)** | 82.4% | 143 (23) | 105 |
| work-tags — before | 191 (93.6%) | 90.3% | 92 (13) | 0 |
| work-tags — after | 191 (93.6%) | 89.4% | 92 (13) | 0 |
| messy — before | 113 (55.4%) | 72.7% | 167 (27) | 832 |
| messy — after | **150 (73.5%)** | 80.1% | **155 (24)** | 206 |

The scope's 94/204 baseline predates the classification fix already on this branch (113/204). Against the scope's figure messy is 94 → 150 (46.1% → 73.5%); the 80% exploratory target is not reached and was not chased (see *Stop rule*).

Non-classical corpus (32 albums, 157 tracks): identical before and after — 0/117 false classical positives, 0 false negatives, 0 non-classical or unsure tracks given classical behaviour.

**False join** = two neighbouring tracks Aurral puts in one block that Apple shows apart: the measure of an incorrect automatic match. No album in any style gained false joins except five messy albums that now equal their store-tagged copy exactly (below). No album lost exact grouping in any style.

Reproduce: `node scripts/corpus-apple-audit.mjs` (summary), `--style messy` (every miss, pair by pair), `--json FILE`.

## 1. Audit of the 91 messy mismatches (before)

Each missed or false pair was classified automatically (script in the audit above) and the false joins read by hand.

| Cause | Pairs | Genuine? |
|---|---|---|
| Missed: a track not classified classical (no genre, no composer tag) | 764 | Yes — fixed in large part by §2a |
| Missed: classified, but no parseable work head | 62 | Partly — §2b fixed comma/colon forms; the rest have no shared head |
| Missed: head present, headings differ | 6 | Partly — §2c |
| False: set members Apple lists one by one ("Nocturnes, Op. 9: No. 1…3") | 48 | **Intentional**: Aurral keeps a numbered set in one block by design |
| False: Apple links a movement to a different work (Josquin masses, a Beethoven 9 movement as Piano Sonata 18, Mozart box sets) | 77 | **Answer-key errors** in Apple's data |
| False: Apple spells the composer two ways within one work ("W. A. Mozart" / "Wolfgang Amadeus Mozart") | 41 | **Answer-key noise**; with no composer tag the messy copy joined them |
| False: disc boundary | 1 | Intentional (one work across discs) |

Store and work-tag false joins are the same intentional and answer-key categories (store 48 set + 94 Apple mislinks + 1 disc; work-tags 85 set + 5 disc + 2).

## 2. Fixes

**a. Composers in mixed artist fields** (`src/model/credits.js`, new, pure). With no composer tag, an artist field split into parts (`;`, ` / `, spaced dash) is read: parts that are ensembles, name lists, repeated names or the album's own artist perform; one remaining personal name is the composer candidate. It is **high** confidence only when something independent names the same person — the album or track title, the catalogue system in the title (BWV→Bach, WWV→Wagner, L./CD→Debussy, M.→Ravel, …), or (when matching) a composer the library already credits. With several candidates, the single corroborated one wins (composer beside a soloist). Otherwise **medium**. Used identically by:
- classification: high adds a supporting signal (+2) and counts as a credited composer; medium (+1) only keeps the track out of *not classical* (reviewable);
- matching: high supplies the work's composer; **medium never creates a work** — it opens an `auto_match` review (`uncertain-composer`, listing the album, tracks, proposed work and composer);
- album page: piece grouping and performer names use the high-confidence composer.

**b. Title and catalogue parsing.** Comma-separated movements (`Winterreise, D. 911, II. Die Wetterfahne`; `Violin Sonata No. 1, BWV1001, II. Fuga - Allegro`) split when the head reads as a work and the comma precedes any other separator; `L. 103` is not movement fifty. A colon straight before a quote (`Carmen, Act 1:"Avec…"`) separates; `Hob. XVI:52` does not. The classifier recognises WWV, BuxWV, SWV, TrV and comma-anchored `L.`/`M.`/`S.`/`FP` numbers (`, CD 1` deliberately excluded: pop titles use it for discs).

**c. Album-wide headings.** Neighbouring unmatched tracks share a block when one heading is the other cut at a comma (`Tristan und Isolde` / `Tristan und Isolde, WWV 90`), never when both continue differently (`Études, Book 1` / `Book 3` stay apart). `Pt. 1`/`Pt. 2` count as parts of one work like acts.

**d. Gate.** `test/corpus-apple.test.js` now also fails when any album gains a false join; `apple-baseline.json` records false joins.

Regression tests: `test/messy-matching.test.js` (6 tests; 5 fail on the previous source, 1 is a guard that performers never become composers). 259/259 plugin tests pass, both corpora included.

## 3. Changes that look like regressions, explained

- **Messy movement titles on 28 albums.** Once messy albums form real works, two recordings of one work share its movement names, exactly as store-tagged albums already do. On 27 of these albums the messy score now equals or exceeds the store score for the same album. The 28th (1727580320, Yuja Wang) has exact grouping; a Beethoven sonata reuses another album's movement names.
- **Store/work-tags titles on 3 albums** (Bach solo violin, Winterreise, Carmen): Apple shows the raw store title as the part (`…, BWV1001, I. Adagio`); Aurral now shows `I. Adagio`, consistent with the rest of the album.
- **Five messy albums gained false joins** (Tristan ×2, Dido, Mozart variations, Richter): each now equals its store copy exactly — the intentional/answer-key categories in §1.

## 4. Not done

- **MusicBrainz candidate evaluation (scope item 3).** Not implemented in this pass. Messy files rarely carry MusicBrainz IDs, so it needs a release search scored by album, track order, performers and durations, and recorded MusicBrainz fixtures for the corpus albums to validate against (musicbrainz.org is reachable here at 1 request/second). Existing fetching (`src/mb.js` `query`) would be extended, not rebuilt. Recommended next step if this workstream continues.
- **Album-pattern classification** (promoting uncorroborated composers from numbered-section runs) was rejected: the same pattern fires on pop suites such as the corpus's Dream Theater *Six Degrees*.
- Real scans read only the first ARTIST value; a mixed field stored as separate values is not combined (changing that would re-key existing scan evidence).

## Stop rule — what remains (messy, 54 albums)

- 120 missed pairs on tracks still *unsure*: composer uncorroborated (e.g. *The Nutcracker* with no composer in the album title) or composer also the performer (Steve Reich). These are reviewable, not guessed.
- 63 pairs with no shared heading at all (madrigal *prima/seconda parte*, song selections, Apple grouping some numbered sets but not others).
- The intentional and answer-key false joins in §1.
