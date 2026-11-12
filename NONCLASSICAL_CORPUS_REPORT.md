# Non-classical validation corpus and classification fix: v0.1 sign-off report

Two scopes are covered here. First, the corpus: tests and reporting only. Second, the
classification accuracy fix: a focused, plugin-only change to `classify()`, made after the corpus
showed the old rules failing. No production access, deployment or library tag writes. Scans stay
read-only, and the matcher, tagger, schema and core are unchanged. Tests write tags only to
throwaway copies of `test/fixtures/sine.flac`.

## Verdict

**v0.1 classification acceptance is met on the test fixtures.** There are zero false classical
positives and zero false negatives, and no non-classical track gets classical grouping, tagging
or acquisition behaviour. Pins survive retags and rescans. The bar is now enforced in CI.
Validating on the real library still needs a **user-run** read-only report (see below).

| Acceptance item | Before the fix | After the fix |
|---|---|---|
| False classical positives on clearly non-classical fixtures | 30/108 (27.8%) | **0/117** |
| Classical tracks lost (classified not classical) | 5 | **0** |
| Genuine classical in mixed albums recognised or safely unsure | 5/5 (1 classical, 4 unsure) | 5/5 (1 classical, 4 unsure; Shawshank's Mozart now recognised, Platoon's Barber now unsure) |
| Non-classical/crossover tracks grouped as works | 9 | **0** |
| Non-classical/crossover tracks allowed classical tag writes (model guard) | 44 | **0** |
| Classical acquisition identity on non-classical/crossover tracks | 0 | 0 |
| Crossover tracks classified classical automatically | 14/20 | 0/20 |
| Overall unsure rate | 40.5% | 20.4% |
| Track and album pins through a retag and two rescans | hold | hold |

"Before" is the 30-album, 148-track corpus. "After" adds two credited hip-hop albums (32 albums,
157 tracks; the old rules would have left those 9 tracks unsure).

## What changed in classification

`src/model/classify-evidence.js` is new: a pure function shared by `classify()`, the report and
the corpora. Pins and inherited album pins keep precedence, exactly as before.

- **Composer credits and generic terms are supporting only.** A composer credit (+1), tempo or form
  words (+2), Roman-numbered tempo markings (+2), a composer-named album such as "Bach: …" (+2) and
  a WORK tag (+3) need corroboration. Without a genre, classical needs a strong signal or two
  substantive supporting signals; a composer credit never corroborates.
- **A WORK tag equal to the track title counts for nothing.** That is how Picard's track
  relationships tag every pop song.
- **Album-title form words count once and weakly (+1),** so "Eldorado – A Symphony…" doesn't turn
  every song into a movement.
- **Genres are matched whole,** using the resolver's own lists so both classifiers agree.
  "Rock opera", "baroque pop", "chamber pop" and "new romantic" are popular genres. "Chamber Music",
  "Baroque" and "Modern Classical" are classical.
- **Popular genres** (hip-hop, rap, pop, rock, metal, jazz, electronic, dance, …) block automatic
  classical. A track goes to review (unsure) only when something verifiable conflicts with the
  genre: a catalogue number, a movement or composer relation, or a classical genre beside it.
- **Soundtrack, game and crossover genres** allow a verified classical work: one credited to a
  composer other than the performer, with a catalogue number or three kinds of evidence (2001's
  Strauss and Khachaturian, Amadeus, and Shawshank's Mozart, which was unsure before). Anything else with evidence stays unsure.
- **Mixed albums are still decided per track.** The album roll-up is unchanged (mixed albums are unsure).

## Diagnostics (read only)

- `node scripts/model-admin.mjs classification MODEL_FOLDER [--album ID] [--all] [--json]` lists
  every classical, unsure, pinned or changing track. For each it shows genres, composer and WORK,
  each evidence signal with points, the score, the stored state, the state's source (track pin,
  album pin or automatic) and the state the next scan would store. It opens the database read-only;
  the corpus asserts the database and any existing WAL stay byte-identical.
- The admin album action **Classification report (read only)** gives the same answer for
  one album, within the host's 500-character message limit.

### Real-library dry run (for you to run)

1. Copy the model folder out of the container, for example:
   `docker cp aurral-phase3-test-aurral-test-1:<plugin data>/model ./model-copy`.
2. From a checkout of this branch, run `node scripts/model-admin.mjs classification ./model-copy`.
3. Lines marked `*` change on the next scan. Check them, especially any lost classical tracks.
   Then install the new `index.js`/`manifest.json` and run **Scan classical model (read only)**.
   Pins are kept.

Report real false positives or negatives back and they can be added to the corpus.

## Changes accepted as side effects (explained)

| Where | Change | Why |
|---|---|---|
| Platoon, "Adagio for Strings" (Barber) | classical → unsure | Its only evidence (tempo word + Barber credit) is identical to Tiësto's trance track. Safely unsure, as the scope allows. |
| 2001: Lux Aeterna, Atmosphères; Clockwork Orange orchestral tracks | unsure (unchanged) | No catalogue number; a pin (or the 2001 album pin) settles them. |
| William Orbit's electronic arrangements | unsure → not classical | An Electronic genre plus only a classical composer credit is indistinguishable from a pop song with songwriter credits. |
| Deep Purple, Concerto for Group and Orchestra (Rock) | classical → not classical | Rock genre with tempo words only; expected unsure. |
| Apple corpus, messy rips (no genre or composer tag) | 94 → **113**/204 albums group like Apple; rows 61% → 73% | Roman-numbered movements and composer-named albums now corroborate. |
| Apple 1083994403 (Rachmaninoff), 1452755388 (Mozart box) | grouping and rows slightly worse | Tracks the old rules missed are now correctly classical. The unchanged matcher then joins the two Kreisler pieces that share "Op. 32". Matcher changes are out of scope. |
| Store and iTunes-work-tag styles | unchanged (153 and 191/204) | |

## Corpus and tests

- `test/corpus/nonclassical/*.json`: 32 albums of hand-written metadata modelled on real releases.
  Each track has a reviewed expected state, scenario labels and notes; albums have separate
  album-level expectations, pins and a retag.
- `test/corpus-nonclassical.test.js` runs the real admin scan, auto-match, pins, retag and rescans.
  It checks: evidence equals the stored score; media is unchanged; behaviour follows classification;
  pins survive; the report matches the pipeline and writes nothing; and a stale "classical" decision
  shows as a dry-run change. An acquisition positive control and the baseline gate are included.
  It now **enforces** zero false positives and zero false negatives.
- `test/classify-evidence.test.js` covers the rules: synthetic hip-hop with classical titles,
  WORK tags and composer credits; whole-name genres; soundtrack verification; and untagged classical.
- Updated expectations in two existing unit tests. A soundtrack track with only a WORK tag is now
  unsure; a verified Bach suite on one is classical. The "clearer later scan" case now uses a
  catalogue-numbered title.
- Full suite: 234 tests pass, including both corpora. Manifest version is 1.0.10; `index.js` rebuilt.

Expected states were proposed by Claude from track facts. Please review the policy choices: film
and game scores are not classical; crossover is unsure; real classical recordings on soundtracks
are classical.

## Appendix: generated results

Produced by `node scripts/corpus.mjs --nonclassical --markdown`.

### Summary

- 157 tracks on 32 albums (expected: 117 not classical, 20 classical, 20 unsure)
- false classical positives 0/117; not-classical tracks left unsure 10
- classical recognised 9/20, unsure 11, false negatives 0
- crossover tracks classified classical 0/20; overall unsure rate 20.4%
- non-classical or unsure tracks given classical behaviour 0

### By genre family

| | tracks | not classical exp. | false positives | NC unsure | classical exp. | recognised | C unsure | false negatives | crossover → classical | leaks |
|---|---|---|---|---|---|---|---|---|---|---|
| classical-mistagged | 15 | 0 | 0 | 0 | 15 | 8 | 7 | 0 | 0 | 0 |
| crossover | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| electronic | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| film-score | 10 | 10 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 |
| game-score | 10 | 10 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| hip-hop | 19 | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| jazz | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| pop | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rock | 27 | 27 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| soundtrack-mixed | 18 | 11 | 0 | 4 | 5 | 1 | 4 | 0 | 0 | 0 |

### By scenario

| | tracks | not classical exp. | false positives | NC unsure | classical exp. | recognised | C unsure | false negatives | crossover → classical | leaks |
|---|---|---|---|---|---|---|---|---|---|---|
| classical-in-mixed | 5 | 0 | 0 | 0 | 5 | 1 | 4 | 0 | 0 | 0 |
| classical-nonclassical-genre | 20 | 0 | 0 | 0 | 20 | 9 | 11 | 0 | 0 | 0 |
| classical-sample | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| composer-credit | 134 | 99 | 0 | 10 | 15 | 9 | 6 | 0 | 0 | 0 |
| crossover | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| generic-work-tag | 14 | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| misleading-genre | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| misleading-title | 19 | 17 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| missing-genre | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| no-composer | 23 | 18 | 0 | 0 | 5 | 0 | 5 | 0 | 0 | 0 |

### Albums

| album | family | expected | pipeline | outcome | pin |
|---|---|---|---|---|---|
| 2001-a-space-odyssey-soundtrack | classical-mistagged | classical | unsure | unsure | classical → classical/classical |
| a-clockwork-orange-soundtrack | soundtrack-mixed | unsure | unsure | match |  |
| adele-21 | pop | not_classical | not_classical | match |  |
| amadeus-soundtrack | classical-mistagged | classical | classical | match |  |
| andrea-bocelli-romanza | crossover | unsure | unsure | match |  |
| clean-bandit-what-is-love | pop | not_classical | not_classical | match |  |
| daft-punk-random-access-memories | electronic | not_classical | not_classical | match |  |
| dave-brubeck-time-out | jazz | not_classical | not_classical | match |  |
| deep-purple-concerto-for-group-and-orchestra | crossover | unsure | not_classical | crossover_not_classical |  |
| dream-theater-six-degrees | rock | not_classical | not_classical | match |  |
| duran-duran-rio | pop | not_classical | not_classical | match |  |
| elo-eldorado | rock | not_classical | not_classical | match |  |
| glenn-gould-goldberg-1981-rip | classical-mistagged | classical | unsure | unsure |  |
| hans-zimmer-interstellar | film-score | not_classical | not_classical | match |  |
| jacques-loussier-play-bach | crossover | unsure | unsure | match |  |
| jeremy-soule-skyrim | game-score | not_classical | not_classical | match |  |
| john-williams-star-wars | film-score | not_classical | unsure | unsure |  |
| kanye-west-mbdtf | hip-hop | not_classical | not_classical | match |  |
| kendrick-lamar-to-pimp-a-butterfly | hip-hop | not_classical | not_classical | match |  |
| lana-del-rey-born-to-die | pop | not_classical | not_classical | match |  |
| miles-davis-kind-of-blue | jazz | not_classical | not_classical | match |  |
| muse-the-resistance | rock | not_classical | not_classical | match |  |
| nas-gods-son | hip-hop | not_classical | not_classical | match |  |
| nas-illmatic | hip-hop | not_classical | not_classical | match |  |
| nobuo-uematsu-final-fantasy-vii | game-score | not_classical | unsure | unsure |  |
| platoon-soundtrack | soundtrack-mixed | unsure | unsure | match | not_classical → not_classical/not_classical |
| queen-a-night-at-the-opera | rock | not_classical | not_classical | match |  |
| shawshank-redemption-soundtrack | soundtrack-mixed | unsure | unsure | match |  |
| taylor-swift-1989 | pop | not_classical | not_classical | match |  |
| the-who-tommy | rock | not_classical | not_classical | match | not_classical → not_classical/not_classical |
| tiesto-just-be | electronic | not_classical | not_classical | match |  |
| william-orbit-pieces-in-a-modern-style | crossover | unsure | not_classical | crossover_not_classical |  |

### Mismatches

| track | expected | pipeline | score | evidence | behaviour |
|---|---|---|---|---|---|
| 2001-a-space-odyssey-soundtrack#1-3 Lux Aeterna | classical | unsure | 1 | composer differs from artist "György Ligeti" +1 |  |
| 2001-a-space-odyssey-soundtrack#1-6 Atmosphères | classical | unsure | 1 | composer differs from artist "György Ligeti" +1 |  |
| a-clockwork-orange-soundtrack#1-1 Title Music from A Clockwork Orange | unsure | not_classical | 0 | none |  |
| a-clockwork-orange-soundtrack#1-2 The Thieving Magpie (Abridged) | classical | unsure | 1 | composer differs from artist "Gioachino Rossini" +1 |  |
| a-clockwork-orange-soundtrack#1-4 Ninth Symphony, Second Movement (Abridged) | classical | unsure | 3 | form word in title "Symphony" +2; composer differs from artist "Ludwig van Beethoven" +1 |  |
| a-clockwork-orange-soundtrack#1-7 Pomp and Circumstance March No. 1 | classical | unsure | 1 | composer differs from artist "Edward Elgar" +1 |  |
| a-clockwork-orange-soundtrack#1-10 Overture to the Sun | not_classical | unsure | 2 | form word in title "Overture" +2 |  |
| a-clockwork-orange-soundtrack#1-13 Singin' in the Rain | not_classical | unsure | 1 | composer differs from artist "Nacio Herb Brown; Arthur Freed" +1 |  |
| deep-purple-concerto-for-group-and-orchestra#1-1 First Movement: Moderato – Allegro | unsure | not_classical | 4 | tempo word in title "Moderato" +2; form word in album title "Concerto" +1; composer differs from artist "Jon Lord" +1 |  |
| deep-purple-concerto-for-group-and-orchestra#1-2 Second Movement: Andante | unsure | not_classical | 4 | tempo word in title "Andante" +2; form word in album title "Concerto" +1; composer differs from artist "Jon Lord" +1 |  |
| deep-purple-concerto-for-group-and-orchestra#1-3 Third Movement: Vivace – Presto | unsure | not_classical | 4 | tempo word in title "Vivace" +2; form word in album title "Concerto" +1; composer differs from artist "Jon Lord" +1 |  |
| glenn-gould-goldberg-1981-rip#1-1 Aria | classical | unsure | 2 | album named after a composer "Bach" +2 |  |
| glenn-gould-goldberg-1981-rip#1-2 Variatio 1 a 1 Clav. | classical | unsure | 2 | album named after a composer "Bach" +2 |  |
| glenn-gould-goldberg-1981-rip#1-3 Variatio 2 a 1 Clav. | classical | unsure | 2 | album named after a composer "Bach" +2 |  |
| glenn-gould-goldberg-1981-rip#1-4 Variatio 3 a 1 Clav. Canone all'Unisono | classical | unsure | 2 | album named after a composer "Bach" +2 |  |
| glenn-gould-goldberg-1981-rip#1-32 Aria da capo | classical | unsure | 2 | album named after a composer "Bach" +2 |  |
| john-williams-star-wars#1-1 Main Title | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-2 Imperial Attack | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-3 Princess Leia's Theme | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-4 The Desert and the Robot Auction | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-16 The Throne Room and End Title | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| nobuo-uematsu-final-fantasy-vii#1-1 Prelude | not_classical | unsure | 2 | form word in title "Prelude" +2 |  |
| platoon-soundtrack#1-1 Adagio for Strings | classical | unsure | 3 | tempo word in title "Adagio" +2; composer differs from artist "Samuel Barber" +1 |  |
| platoon-soundtrack#1-3 The Tracks of My Tears | not_classical | unsure | 1 | composer differs from artist "Smokey Robinson; Pete Moore; Marv Tarplin" +1 |  |
| platoon-soundtrack#1-4 White Rabbit | not_classical | unsure | 1 | composer differs from artist "Grace Slick" +1 |  |
| william-orbit-pieces-in-a-modern-style#1-1 Barber's Adagio for Strings | unsure | not_classical | 3 | tempo word in title "Adagio" +2; composer differs from artist "Samuel Barber" +1 |  |
| william-orbit-pieces-in-a-modern-style#1-2 Ravel's Pavane pour une infante défunte | unsure | not_classical | 1 | composer differs from artist "Maurice Ravel" +1 |  |
| william-orbit-pieces-in-a-modern-style#1-3 Satie's Ogive Number 1 | unsure | not_classical | 1 | composer differs from artist "Erik Satie" +1 |  |
| william-orbit-pieces-in-a-modern-style#1-6 Cavalleria rusticana | unsure | not_classical | 1 | composer differs from artist "Pietro Mascagni" +1 |  |
| william-orbit-pieces-in-a-modern-style#1-9 Beethoven's Triple Concerto | unsure | not_classical | 3 | form word in title "Concerto" +2; composer differs from artist "Ludwig van Beethoven" +1 |  |

### Pins

| track | pinned/inherited | after retag scan | after rescan |
|---|---|---|---|
| 2001-a-space-odyssey-soundtrack#1-1 Also sprach Zarathustra, Op. 30: Einleitung | classical | classical | classical |
| 2001-a-space-odyssey-soundtrack#1-3 Lux Aeterna | classical | classical | classical |
| 2001-a-space-odyssey-soundtrack#1-4 An der schönen blauen Donau, Op. 314 | classical | classical | classical |
| 2001-a-space-odyssey-soundtrack#1-5 Gayane Ballet Suite: Adagio | classical | classical | classical |
| 2001-a-space-odyssey-soundtrack#1-6 Atmosphères | classical | classical | classical |
| dave-brubeck-time-out#1-1 Blue Rondo à la Turk | not_classical | not_classical | not_classical |
| platoon-soundtrack#1-1 Adagio for Strings | classical | classical | classical |
| platoon-soundtrack#1-2 Okie from Muskogee | not_classical | not_classical | not_classical |
| platoon-soundtrack#1-3 The Tracks of My Tears | not_classical | not_classical | not_classical |
| platoon-soundtrack#1-4 White Rabbit | not_classical | not_classical | not_classical |
| platoon-soundtrack#1-5 Hello, I Love You | not_classical | not_classical | not_classical |
| shawshank-redemption-soundtrack#1-8 Sull'aria... che soave zeffiretto (from Le nozze di Figaro, K. 492) | classical | classical | classical |
| the-who-tommy#1-1 Overture | not_classical | not_classical | not_classical |
| the-who-tommy#1-2 It's a Boy | not_classical | not_classical | not_classical |
| the-who-tommy#1-4 Amazing Journey | not_classical | not_classical | not_classical |
| the-who-tommy#1-13 Pinball Wizard | not_classical | not_classical | not_classical |
| the-who-tommy#1-24 We're Not Gonna Take It | not_classical | not_classical | not_classical |

