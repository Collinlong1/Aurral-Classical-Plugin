# Non-classical validation corpus: v0.1 sign-off report

Scope: tests and reporting only. No classifier, schema or runtime source changed (`src/` and the
`index.js` bundle are byte-identical to `4a45fcc`). No production access, deployment or library tag writes.
The corpus writes tags only to throwaway copies of `test/fixtures/sine.flac` in a temp folder.

## Verdict

**v0.1 classification acceptance is not met.** The pipeline gave 30 of 108 clearly non-classical
tracks a classical classification, and the acceptance bar is zero. Pins, read-only media, rescans
and the "behaviour follows classification" guard all hold. Every failure comes from the classifier's
scoring in `classify()` (`src/model/reconcile.js`). Fixing that needs the separate approval
the scope requires.

| Acceptance item | Result |
|---|---|
| Zero false classical positives on clearly non-classical fixtures | **Fail**: 30/108 (27.8%) |
| Genuine classical tracks in mixed albums recognised or safely unsure | **Pass**: 5/5 (1 classical, 4 unsure, 0 false negatives) |
| No non-classical track gets classical grouping | **Fail**: 9 tracks grouped as works (Dream Theater ×6, Muse ×3), all false positives |
| No non-classical track gets classical tagging | **Fail at the model guard**: `modelAllowsTagging` allows all 30 false positives (and 14 crossover tracks). The tagger's own MusicBrainz check was not run by this corpus |
| No non-classical track gets classical acquisition | **Pass**: 0/128 non-classical or crossover tracks get a classical acquisition identity; a positive control confirms the check works |
| Manual pins survive rescans | **Pass**: 17 pinned/inherited tracks and 3 album pins hold through a retag scan and a further rescan; a track pin beats its album pin |
| Baseline, failure cases and CI | **Done**: `nonclassical-baseline.json` (49 explained failures); CI runs both corpora |

Grouping, tag-write and acquisition behaviour follow the classification exactly: no track that isn't
`classical` is grouped, attached to a work or allowed tag writes. The behaviour failures above are
therefore all downstream of the 30 false positives (plus 14 crossover tracks classified classical).

## Baseline metrics

- 148 tracks on 30 albums. Expected states: 108 not classical, 20 classical, 20 unsure (crossover).
- False classical positives: **30**. Non-classical tracks left unsure: 47 (they go to the review queue
  but get no classical behaviour).
- Classical expected: 7 recognised, 8 unsure, **5 false negatives**. All 5 are one poorly ripped,
  pure-classical album (Gould, Goldberg Variations, no composer, genre "Other"), not a mixed album.
- Crossover (expected unsure): 14/20 classified classical (Bocelli, Loussier, Deep Purple, Orbit).
- Overall unsure rate: 40.5%. Mostly pop/rock songs whose songwriter composer tag differs from
  the artist (+1), or a known composer with an unknown genre.
- Album level, kept apart from track level: 10/30 albums match their album expectation, 11 are unsure,
  5 are false-positive albums, 3 are crossover albums classified classical, and 1 is a false-negative
  album. Mixed soundtracks stay unsure as designed.
- These are classification metrics. Apple corpus grouping scores are reported separately and are
  unchanged (store 153/204, work-tags 191/204, messy 94/204 albums grouped like Apple).

## Failure causes

| Cause | False positives | Examples |
|---|---|---|
| Generic `WORK` tag is +4, enough on its own | 14 | Picard track-relationship tags on Daft Punk (WORK = song title); a suite name in WORK on Dream Theater and Muse, which auto-match then groups as works |
| Substring genre match (`opera`, `baroque`, `romantic`) | 13 | "Rock Opera" (Tommy), "Baroque Pop" (Lana Del Rey), "New Romantic" (Duran Duran) |
| Tempo/form words in titles plus composer credit | 3 | "Blue Rondo à la Turk" (4), "Eldorado Finale" (6, plus "Symphony" in the album title), Tiësto "Adagio for Strings" (Barber credited) |
| Crossover genre "Classical Crossover" contains "classical" | crossover | All 5 Bocelli pop ballads (expected unsure) |
| No evidence at all on a classical rip → not_classical, not unsure | 5 FN | Gould "Aria", "Variatio 1 a 1 Clav." |

The plugin's own MusicBrainz resolver (`src/resolver.js`) already rejects "rock opera", "baroque pop",
"new romantic", "soundtrack" and "classical crossover" as classical. The two classifiers disagree
on the same genres.

## Recommendations (each needs separate approval; not implemented)

1. Don't let a WORK tag classify a track on its own. Require it alongside another signal, or ignore
   WORK when it equals the track title (the Picard pop-song case).
2. Match genres as whole names, and reuse the resolver's hard non-classical list (rock opera, baroque
   pop, chamber pop, new romantic, crossover, soundtrack, game). Extend the "ordinary" genre list
   (hip hop, trance, dance, metal, game).
3. Discount tempo and form words when the track has an ordinary genre, and don't count album-title
   form words ("Eldorado – A Symphony…") on every track.
4. Leave zero-evidence tracks unsure, not not_classical, when the album title names a known composer
   ("Bach: …"). That gives the safe outcome for careless classical rips.
5. Until then, admins can fix any album or track with the existing pins. The corpus confirms they hold.

## What was built

- `test/corpus/nonclassical/*.json`: 30 albums of hand-written metadata modelled on real releases.
  Track lists are trimmed, lengths approximate, and there is no audio. Each track has an expected
  state, scenario labels and notes; each album has a separate album expectation; some albums carry pins and a retag.
- `test/corpus/nonclassical.js`: the harness. It tags copies of a silent FLAC and builds a host
  library snapshot. It then runs the real admin `enqueueModelScan` → `runModelJobs` (reconcile, classify,
  inherited album pins, album roll-up, automatic works) and the admin "Auto-match classical works" on
  each album. For each track it reads back the album presentation, realizations, `modelAllowsTagging`
  and `acquisitionIdentity`. Acquisition is checked against MusicBrainz records that mirror each file's
  tags, with nothing invented. It then applies album pins and editor track pins (`set-classification`),
  retags pinned files and rescans twice. Each score is broken into its signals, and the test asserts the
  breakdown adds up to the stored score, so the evidence can't go stale.
- `test/corpus-nonclassical.test.js`: runs in `npm test` in about 2 seconds. It fails on any track or album
  doing worse than the baseline, on a failure with no written explanation, on broken pins, on changed
  media, or on grouping or tag writes for a non-classical state. The zero-false-positive bar is a `todo`
  test: reported in every run, not enforced, until a classifier change is approved.
- `scripts/corpus.mjs --nonclassical [--markdown] [--update-baseline]`. The CI `corpora` job runs both
  corpora and writes both summaries to the job page. The no-network, read-only isolation job also runs
  the new corpus.

## Review needed

Agent-proposed expected states: Claude assigned them from the track facts, and they need your review
before sign-off. Policy choices: film and game scores are `not_classical`; crossover arrangements and
crossover-genre pop are `unsure`; genuine orchestral or opera recordings on soundtracks are `classical`.
Change any fixture's `expect`, then run `--update-baseline`.

## Appendix: generated baseline results

Produced by `node scripts/corpus.mjs --nonclassical --markdown`.

### Summary

- 148 tracks on 30 albums (expected: 108 not classical, 20 classical, 20 unsure)
- false classical positives 30/108; not-classical tracks left unsure 47
- classical recognised 7/20, unsure 8, false negatives 5
- crossover tracks classified classical 14/20; overall unsure rate 40.5%
- non-classical or unsure tracks given classical behaviour 44

### By genre family

| | tracks | not classical exp. | false positives | NC unsure | classical exp. | recognised | C unsure | false negatives | crossover → classical | leaks |
|---|---|---|---|---|---|---|---|---|---|---|
| classical-mistagged | 15 | 0 | 0 | 0 | 15 | 6 | 4 | 5 | 0 | 0 |
| crossover | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 | 14 |
| electronic | 10 | 10 | 6 | 4 | 0 | 0 | 0 | 0 | 0 | 6 |
| film-score | 10 | 10 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 |
| game-score | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| hip-hop | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| jazz | 10 | 10 | 1 | 4 | 0 | 0 | 0 | 0 | 0 | 1 |
| pop | 20 | 20 | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 8 |
| rock | 27 | 27 | 15 | 12 | 0 | 0 | 0 | 0 | 0 | 15 |
| soundtrack-mixed | 18 | 11 | 0 | 4 | 5 | 1 | 4 | 0 | 0 | 0 |

### By scenario

| | tracks | not classical exp. | false positives | NC unsure | classical exp. | recognised | C unsure | false negatives | crossover → classical | leaks |
|---|---|---|---|---|---|---|---|---|---|---|
| classical-in-mixed | 5 | 0 | 0 | 0 | 5 | 1 | 4 | 0 | 0 | 0 |
| classical-nonclassical-genre | 20 | 0 | 0 | 0 | 20 | 7 | 8 | 5 | 0 | 0 |
| composer-credit | 125 | 90 | 26 | 47 | 15 | 7 | 8 | 0 | 14 | 40 |
| crossover | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 | 14 |
| generic-work-tag | 14 | 14 | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| misleading-genre | 13 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 13 |
| misleading-title | 19 | 17 | 9 | 8 | 0 | 0 | 0 | 0 | 2 | 11 |
| missing-genre | 5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| no-composer | 23 | 18 | 4 | 0 | 5 | 0 | 0 | 5 | 0 | 4 |

### Albums

| album | family | expected | pipeline | outcome | pin |
|---|---|---|---|---|---|
| 2001-a-space-odyssey-soundtrack | classical-mistagged | classical | unsure | unsure | classical → classical/classical |
| a-clockwork-orange-soundtrack | soundtrack-mixed | unsure | unsure | match |  |
| adele-21 | pop | not_classical | unsure | unsure |  |
| amadeus-soundtrack | classical-mistagged | classical | classical | match |  |
| andrea-bocelli-romanza | crossover | unsure | classical | crossover_classical |  |
| clean-bandit-what-is-love | pop | not_classical | unsure | unsure |  |
| daft-punk-random-access-memories | electronic | not_classical | classical | false_positive |  |
| dave-brubeck-time-out | jazz | not_classical | unsure | unsure |  |
| deep-purple-concerto-for-group-and-orchestra | crossover | unsure | classical | crossover_classical |  |
| dream-theater-six-degrees | rock | not_classical | classical | false_positive |  |
| duran-duran-rio | pop | not_classical | classical | false_positive |  |
| elo-eldorado | rock | not_classical | unsure | unsure |  |
| glenn-gould-goldberg-1981-rip | classical-mistagged | classical | not_classical | false_negative |  |
| hans-zimmer-interstellar | film-score | not_classical | not_classical | match |  |
| jacques-loussier-play-bach | crossover | unsure | classical | crossover_classical |  |
| jeremy-soule-skyrim | game-score | not_classical | unsure | unsure |  |
| john-williams-star-wars | film-score | not_classical | unsure | unsure |  |
| kendrick-lamar-to-pimp-a-butterfly | hip-hop | not_classical | not_classical | match |  |
| lana-del-rey-born-to-die | pop | not_classical | classical | false_positive |  |
| miles-davis-kind-of-blue | jazz | not_classical | not_classical | match |  |
| muse-the-resistance | rock | not_classical | unsure | unsure |  |
| nas-illmatic | hip-hop | not_classical | not_classical | match |  |
| nobuo-uematsu-final-fantasy-vii | game-score | not_classical | unsure | unsure |  |
| platoon-soundtrack | soundtrack-mixed | unsure | unsure | match | not_classical → not_classical/not_classical |
| queen-a-night-at-the-opera | rock | not_classical | unsure | unsure |  |
| shawshank-redemption-soundtrack | soundtrack-mixed | unsure | unsure | match |  |
| taylor-swift-1989 | pop | not_classical | not_classical | match |  |
| the-who-tommy | rock | not_classical | classical | false_positive | not_classical → not_classical/not_classical |
| tiesto-just-be | electronic | not_classical | unsure | unsure |  |
| william-orbit-pieces-in-a-modern-style | crossover | unsure | unsure | match |  |

### Mismatches

| track | expected | pipeline | score | evidence | behaviour |
|---|---|---|---|---|---|
| 2001-a-space-odyssey-soundtrack#1-1 Also sprach Zarathustra, Op. 30: Einleitung | classical | unsure | 3 | catalogue number "Op. 3" +2; composer differs from artist "Richard Strauss" +1 |  |
| 2001-a-space-odyssey-soundtrack#1-3 Lux Aeterna | classical | unsure | 1 | composer differs from artist "György Ligeti" +1 |  |
| 2001-a-space-odyssey-soundtrack#1-4 An der schönen blauen Donau, Op. 314 | classical | unsure | 3 | catalogue number "Op. 3" +2; composer differs from artist "Johann Strauss II" +1 |  |
| 2001-a-space-odyssey-soundtrack#1-6 Atmosphères | classical | unsure | 1 | composer differs from artist "György Ligeti" +1 |  |
| a-clockwork-orange-soundtrack#1-1 Title Music from A Clockwork Orange | unsure | not_classical | 0 | none |  |
| a-clockwork-orange-soundtrack#1-2 The Thieving Magpie (Abridged) | classical | unsure | 1 | composer differs from artist "Gioachino Rossini" +1 |  |
| a-clockwork-orange-soundtrack#1-4 Ninth Symphony, Second Movement (Abridged) | classical | unsure | 3 | form word "Symphony" +2; composer differs from artist "Ludwig van Beethoven" +1 |  |
| a-clockwork-orange-soundtrack#1-7 Pomp and Circumstance March No. 1 | classical | unsure | 1 | composer differs from artist "Edward Elgar" +1 |  |
| a-clockwork-orange-soundtrack#1-10 Overture to the Sun | not_classical | unsure | 2 | form word "Overture" +2 |  |
| a-clockwork-orange-soundtrack#1-13 Singin' in the Rain | not_classical | unsure | 1 | composer differs from artist "Nacio Herb Brown; Arthur Freed" +1 |  |
| adele-21#1-1 Rolling in the Deep | not_classical | unsure | 1 | composer differs from artist "Adele Adkins; Paul Epworth" +1 |  |
| adele-21#1-2 Rumour Has It | not_classical | unsure | 1 | composer differs from artist "Adele Adkins; Ryan Tedder" +1 |  |
| adele-21#1-5 Set Fire to the Rain | not_classical | unsure | 1 | composer differs from artist "Adele Adkins; Fraser T. Smith" +1 |  |
| adele-21#1-11 Someone Like You | not_classical | unsure | 1 | composer differs from artist "Adele Adkins; Dan Wilson" +1 |  |
| andrea-bocelli-romanza#1-1 Con te partirò | unsure | classical | 5 | classical genre word "classical crossover" +4; composer differs from artist "Francesco Sartori; Lucio Quarantotto" +1 | classical tag writes allowed |
| andrea-bocelli-romanza#1-2 Vivo per lei (feat. Giorgia) | unsure | classical | 5 | classical genre word "classical crossover" +4; composer differs from artist "Valerio Zelli; Mauro Mengali; Gatto Panceri" +1 | classical tag writes allowed |
| andrea-bocelli-romanza#1-4 Il mare calmo della sera | unsure | classical | 5 | classical genre word "classical crossover" +4; composer differs from artist "Gian Pietro Felisatti; Zucchero" +1 | classical tag writes allowed |
| andrea-bocelli-romanza#1-8 Caruso | unsure | classical | 5 | classical genre word "classical crossover" +4; composer differs from artist "Lucio Dalla" +1 | classical tag writes allowed |
| andrea-bocelli-romanza#1-12 Time to Say Goodbye (feat. Sarah Brightman) | unsure | classical | 5 | classical genre word "classical crossover" +4; composer differs from artist "Francesco Sartori; Lucio Quarantotto" +1 | classical tag writes allowed |
| clean-bandit-what-is-love#1-3 Symphony (feat. Zara Larsson) | not_classical | unsure | 3 | form word "Symphony" +2; composer differs from artist "Jack Patterson; Ammar Malik; Steve Mac" +1 |  |
| clean-bandit-what-is-love#1-4 Solo (feat. Demi Lovato) | not_classical | unsure | 1 | composer differs from artist "Jack Patterson; Grace Chatto; Emily Warren" +1 |  |
| clean-bandit-what-is-love#1-6 Rockabye (feat. Sean Paul & Anne-Marie) | not_classical | unsure | 1 | composer differs from artist "Jack Patterson; Ammar Malik; Steve Mac" +1 |  |
| clean-bandit-what-is-love#1-9 I Miss You (feat. Julia Michaels) | not_classical | unsure | 1 | composer differs from artist "Jack Patterson; Julia Michaels" +1 |  |
| daft-punk-random-access-memories#1-1 Give Life Back to Music | not_classical | classical | 5 | WORK tag "Give Life Back to Music" +4; composer differs from artist "Thomas Bangalter; Guy-Manuel de Homem-Christo; Nile Rodgers" +1 | classical tag writes allowed |
| daft-punk-random-access-memories#1-3 Giorgio by Moroder | not_classical | classical | 5 | WORK tag "Giorgio by Moroder" +4; composer differs from artist "Thomas Bangalter; Guy-Manuel de Homem-Christo; Giorgio Moroder" +1 | classical tag writes allowed |
| daft-punk-random-access-memories#1-5 Instant Crush | not_classical | classical | 5 | WORK tag "Instant Crush" +4; composer differs from artist "Thomas Bangalter; Guy-Manuel de Homem-Christo; Julian Casablancas" +1 | classical tag writes allowed |
| daft-punk-random-access-memories#1-8 Get Lucky | not_classical | classical | 5 | WORK tag "Get Lucky" +4; composer differs from artist "Thomas Bangalter; Guy-Manuel de Homem-Christo; Pharrell Williams; Nile Rodgers" +1 | classical tag writes allowed |
| daft-punk-random-access-memories#1-13 Contact | not_classical | classical | 5 | WORK tag "Contact" +4; composer differs from artist "Thomas Bangalter; Guy-Manuel de Homem-Christo; DJ Falcon" +1 | classical tag writes allowed |
| dave-brubeck-time-out#1-1 Blue Rondo à la Turk | not_classical | classical | 4 | tempo word "Rondo" +3; composer differs from artist "Dave Brubeck" +1 | classical tag writes allowed |
| dave-brubeck-time-out#1-2 Strange Meadow Lark | not_classical | unsure | 1 | composer differs from artist "Dave Brubeck" +1 |  |
| dave-brubeck-time-out#1-3 Take Five | not_classical | unsure | 1 | composer differs from artist "Paul Desmond" +1 |  |
| dave-brubeck-time-out#1-4 Three to Get Ready | not_classical | unsure | 1 | composer differs from artist "Dave Brubeck" +1 |  |
| dave-brubeck-time-out#1-5 Kathy's Waltz | not_classical | unsure | 1 | composer differs from artist "Dave Brubeck" +1 |  |
| deep-purple-concerto-for-group-and-orchestra#1-1 First Movement: Moderato – Allegro | unsure | classical | 6 | tempo word "Moderato" +3; form word "Concerto" +2; composer differs from artist "Jon Lord" +1 | classical tag writes allowed |
| deep-purple-concerto-for-group-and-orchestra#1-2 Second Movement: Andante | unsure | classical | 6 | tempo word "Andante" +3; form word "Concerto" +2; composer differs from artist "Jon Lord" +1 | classical tag writes allowed |
| deep-purple-concerto-for-group-and-orchestra#1-3 Third Movement: Vivace – Presto | unsure | classical | 6 | tempo word "Vivace" +3; form word "Concerto" +2; composer differs from artist "Jon Lord" +1 | classical tag writes allowed |
| dream-theater-six-degrees#2-1 I. Overture | not_classical | classical | 7 | WORK tag "Six Degrees of Inner Turbulence" +4; form word "Overture" +2; composer differs from artist "John Petrucci; John Myung; Jordan Rudess; Mike Portnoy" +1 | grouped in a work view; classical tag writes allowed |
| dream-theater-six-degrees#2-2 II. About to Crash | not_classical | classical | 5 | WORK tag "Six Degrees of Inner Turbulence" +4; composer differs from artist "John Petrucci; John Myung; Jordan Rudess; Mike Portnoy" +1 | grouped in a work view; classical tag writes allowed |
| dream-theater-six-degrees#2-4 IV. The Test That Stumped Them All | not_classical | classical | 5 | WORK tag "Six Degrees of Inner Turbulence" +4; composer differs from artist "John Petrucci; John Myung; Jordan Rudess; Mike Portnoy" +1 | grouped in a work view; classical tag writes allowed |
| dream-theater-six-degrees#2-5 V. Goodnight Kiss | not_classical | classical | 5 | WORK tag "Six Degrees of Inner Turbulence" +4; composer differs from artist "John Petrucci; John Myung; Jordan Rudess; Mike Portnoy" +1 | grouped in a work view; classical tag writes allowed |
| dream-theater-six-degrees#2-7 VII. About to Crash (Reprise) | not_classical | classical | 5 | WORK tag "Six Degrees of Inner Turbulence" +4; composer differs from artist "John Petrucci; John Myung; Jordan Rudess; Mike Portnoy" +1 | grouped in a work view; classical tag writes allowed |
| dream-theater-six-degrees#2-8 VIII. Losing Time / Grand Finale | not_classical | classical | 8 | WORK tag "Six Degrees of Inner Turbulence" +4; tempo word "Finale" +3; composer differs from artist "John Petrucci; John Myung; Jordan Rudess; Mike Portnoy" +1 | grouped in a work view; classical tag writes allowed |
| duran-duran-rio#1-1 Rio | not_classical | classical | 4 | classical genre word "new romantic" +4 | classical tag writes allowed |
| duran-duran-rio#1-2 My Own Way | not_classical | classical | 4 | classical genre word "new romantic" +4 | classical tag writes allowed |
| duran-duran-rio#1-4 Hungry Like the Wolf | not_classical | classical | 4 | classical genre word "new romantic" +4 | classical tag writes allowed |
| duran-duran-rio#1-6 Save a Prayer | not_classical | classical | 4 | classical genre word "new romantic" +4 | classical tag writes allowed |
| elo-eldorado#1-1 Eldorado Overture | not_classical | unsure | 3 | form word "Overture" +2; composer differs from artist "Jeff Lynne" +1 |  |
| elo-eldorado#1-2 Can't Get It Out of My Head | not_classical | unsure | 3 | form word "Symphony" +2; composer differs from artist "Jeff Lynne" +1 |  |
| elo-eldorado#1-8 Illusions in G Major | not_classical | unsure | 3 | form word "Symphony" +2; composer differs from artist "Jeff Lynne" +1 |  |
| elo-eldorado#1-9 Eldorado | not_classical | unsure | 3 | form word "Symphony" +2; composer differs from artist "Jeff Lynne" +1 |  |
| elo-eldorado#1-10 Eldorado Finale | not_classical | classical | 6 | tempo word "Finale" +3; form word "Symphony" +2; composer differs from artist "Jeff Lynne" +1 | classical tag writes allowed |
| glenn-gould-goldberg-1981-rip#1-1 Aria | classical | not_classical | 0 | none |  |
| glenn-gould-goldberg-1981-rip#1-2 Variatio 1 a 1 Clav. | classical | not_classical | 0 | none |  |
| glenn-gould-goldberg-1981-rip#1-3 Variatio 2 a 1 Clav. | classical | not_classical | 0 | none |  |
| glenn-gould-goldberg-1981-rip#1-4 Variatio 3 a 1 Clav. Canone all'Unisono | classical | not_classical | 0 | none |  |
| glenn-gould-goldberg-1981-rip#1-32 Aria da capo | classical | not_classical | 0 | none |  |
| jacques-loussier-play-bach#1-1 Prelude No. 1 in C Major, BWV 846 | unsure | classical | 5 | catalogue number "BWV 8" +2; form word "Prelude" +2; composer differs from artist "Johann Sebastian Bach" +1 | classical tag writes allowed |
| jacques-loussier-play-bach#1-2 Fugue No. 1 in C Major, BWV 846 | unsure | classical | 5 | catalogue number "BWV 8" +2; form word "Fugue" +2; composer differs from artist "Johann Sebastian Bach" +1 | classical tag writes allowed |
| jacques-loussier-play-bach#1-3 Toccata and Fugue in D Minor, BWV 565 | unsure | classical | 5 | catalogue number "BWV 5" +2; form word "Toccata" +2; composer differs from artist "Johann Sebastian Bach" +1 | classical tag writes allowed |
| jacques-loussier-play-bach#1-4 Air on the G String (Orchestral Suite No. 3, BWV 1068) | unsure | classical | 5 | catalogue number "BWV 1" +2; form word "Suite" +2; composer differs from artist "Johann Sebastian Bach" +1 | classical tag writes allowed |
| jacques-loussier-play-bach#1-5 Italian Concerto, BWV 971: I. Allegro | unsure | classical | 8 | tempo word "Allegro" +3; catalogue number "BWV 9" +2; form word "Concerto" +2; composer differs from artist "Johann Sebastian Bach" +1 | classical tag writes allowed |
| jeremy-soule-skyrim#1-1 Dragonborn | not_classical | unsure | 0 | none |  |
| jeremy-soule-skyrim#1-2 Awake | not_classical | unsure | 0 | none |  |
| jeremy-soule-skyrim#1-3 From Past to Present | not_classical | unsure | 0 | none |  |
| jeremy-soule-skyrim#1-4 Unbroken Road | not_classical | unsure | 0 | none |  |
| jeremy-soule-skyrim#1-12 Far Horizons | not_classical | unsure | 0 | none |  |
| john-williams-star-wars#1-1 Main Title | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-2 Imperial Attack | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-3 Princess Leia's Theme | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-4 The Desert and the Robot Auction | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| john-williams-star-wars#1-16 The Throne Room and End Title | not_classical | unsure | 1 | composer differs from artist "John Williams" +1 |  |
| lana-del-rey-born-to-die#1-1 Born to Die | not_classical | classical | 4 | classical genre word "baroque pop" +4 | classical tag writes allowed |
| lana-del-rey-born-to-die#1-2 Off to the Races | not_classical | classical | 4 | classical genre word "baroque pop" +4 | classical tag writes allowed |
| lana-del-rey-born-to-die#1-3 Blue Jeans | not_classical | classical | 4 | classical genre word "baroque pop" +4 | classical tag writes allowed |
| lana-del-rey-born-to-die#1-4 Video Games | not_classical | classical | 4 | classical genre word "baroque pop" +4 | classical tag writes allowed |
| muse-the-resistance#1-1 Uprising | not_classical | unsure | 1 | composer differs from artist "Matthew Bellamy" +1 |  |
| muse-the-resistance#1-4 United States of Eurasia (+Collateral Damage) | not_classical | unsure | 1 | composer differs from artist "Matthew Bellamy; Frédéric Chopin" +1 |  |
| muse-the-resistance#1-8 I Belong to You (+Mon Cœur S'ouvre à Ta Voix) | not_classical | unsure | 1 | composer differs from artist "Matthew Bellamy; Camille Saint-Saëns" +1 |  |
| muse-the-resistance#1-9 Exogenesis: Symphony Part 1 (Overture) | not_classical | classical | 7 | WORK tag "Exogenesis: Symphony" +4; form word "Symphony" +2; composer differs from artist "Matthew Bellamy" +1 | grouped in a work view; classical tag writes allowed |
| muse-the-resistance#1-10 Exogenesis: Symphony Part 2 (Cross-Pollination) | not_classical | classical | 7 | WORK tag "Exogenesis: Symphony" +4; form word "Symphony" +2; composer differs from artist "Matthew Bellamy" +1 | grouped in a work view; classical tag writes allowed |
| muse-the-resistance#1-11 Exogenesis: Symphony Part 3 (Redemption) | not_classical | classical | 7 | WORK tag "Exogenesis: Symphony" +4; form word "Symphony" +2; composer differs from artist "Matthew Bellamy" +1 | grouped in a work view; classical tag writes allowed |
| nobuo-uematsu-final-fantasy-vii#1-1 Prelude | not_classical | unsure | 2 | form word "Prelude" +2 |  |
| nobuo-uematsu-final-fantasy-vii#1-2 Opening ~ Bombing Mission | not_classical | unsure | 0 | none |  |
| nobuo-uematsu-final-fantasy-vii#1-3 Mako Reactor | not_classical | unsure | 0 | none |  |
| nobuo-uematsu-final-fantasy-vii#1-5 Tifa's Theme | not_classical | unsure | 0 | none |  |
| nobuo-uematsu-final-fantasy-vii#4-83 One-Winged Angel | not_classical | unsure | 0 | none |  |
| platoon-soundtrack#1-3 The Tracks of My Tears | not_classical | unsure | 1 | composer differs from artist "Smokey Robinson; Pete Moore; Marv Tarplin" +1 |  |
| platoon-soundtrack#1-4 White Rabbit | not_classical | unsure | 1 | composer differs from artist "Grace Slick" +1 |  |
| queen-a-night-at-the-opera#1-2 Lazing on a Sunday Afternoon | not_classical | unsure | 1 | composer differs from artist "Freddie Mercury" +1 |  |
| queen-a-night-at-the-opera#1-4 You're My Best Friend | not_classical | unsure | 1 | composer differs from artist "John Deacon" +1 |  |
| queen-a-night-at-the-opera#1-5 '39 | not_classical | unsure | 1 | composer differs from artist "Brian May" +1 |  |
| queen-a-night-at-the-opera#1-11 Bohemian Rhapsody | not_classical | unsure | 3 | form word "Rhapsody" +2; composer differs from artist "Freddie Mercury" +1 |  |
| queen-a-night-at-the-opera#1-12 God Save the Queen | not_classical | unsure | 1 | composer differs from artist "Traditional" +1 |  |
| shawshank-redemption-soundtrack#1-8 Sull'aria... che soave zeffiretto (from Le nozze di Figaro, K. 492) | classical | unsure | 3 | catalogue number "K. 4" +2; composer differs from artist "Wolfgang Amadeus Mozart" +1 |  |
| the-who-tommy#1-1 Overture | not_classical | classical | 7 | classical genre word "rock opera" +4; form word "Overture" +2; composer differs from artist "Pete Townshend" +1 | classical tag writes allowed |
| the-who-tommy#1-2 It's a Boy | not_classical | classical | 5 | classical genre word "rock opera" +4; composer differs from artist "Pete Townshend" +1 | classical tag writes allowed |
| the-who-tommy#1-4 Amazing Journey | not_classical | classical | 5 | classical genre word "rock opera" +4; composer differs from artist "Pete Townshend" +1 | classical tag writes allowed |
| the-who-tommy#1-13 Pinball Wizard | not_classical | classical | 5 | classical genre word "rock opera" +4; composer differs from artist "Pete Townshend" +1 | classical tag writes allowed |
| the-who-tommy#1-24 We're Not Gonna Take It | not_classical | classical | 5 | classical genre word "rock opera" +4; composer differs from artist "Pete Townshend" +1 | classical tag writes allowed |
| tiesto-just-be#1-1 Forever Today | not_classical | unsure | 1 | composer differs from artist "Tijs Verwest" +1 |  |
| tiesto-just-be#1-3 Love Comes Again (feat. BT) | not_classical | unsure | 1 | composer differs from artist "Tijs Verwest; Brian Transeau" +1 |  |
| tiesto-just-be#1-4 Traffic | not_classical | unsure | 1 | composer differs from artist "Tijs Verwest" +1 |  |
| tiesto-just-be#1-7 Adagio for Strings | not_classical | classical | 4 | tempo word "Adagio" +3; composer differs from artist "Samuel Barber; Tijs Verwest" +1 | classical tag writes allowed |
| tiesto-just-be#1-11 Just Be (feat. Kirsty Hawkshaw) | not_classical | unsure | 1 | composer differs from artist "Tijs Verwest; Kirsty Hawkshaw" +1 |  |
| william-orbit-pieces-in-a-modern-style#1-1 Barber's Adagio for Strings | unsure | classical | 4 | tempo word "Adagio" +3; composer differs from artist "Samuel Barber" +1 | classical tag writes allowed |

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

