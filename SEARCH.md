# Classical search (v0.2)

Search reads only the plugin's catalogue (`classical.sqlite`). Its index is derived: tables `search_doc`, `search_term`, `search_key` and `search_facet` (schema 4) are rebuilt from the catalogue whenever its stamp changes, after every model job on the worker, or on the next search. Dropping them loses nothing.

## Where it shows

- **Aurral's search page** (fork): the `search` capability. Results sit above the catalogue results, four per section; **Show all** opens the plugin's results with filters and up to 50 a section. Every signed-in user gets them; they hold only what work pages already show.
- **Editor**: the admin editor's Search tab uses the same engine, for hosts without the search hook.
- Stock Aurral has neither; the plugin keeps working without them.

## Documents

One per work, movement, owned recording, composer, performer and album holding classical tracks. A person who composes and performs has a composer document and a performer document.

| Kind      | Matched on (strong)                                   | Matched on (weak)                                       |
| --------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Work      | title, nickname, other names, catalogue numbers       | composers and their other spellings, key, form, book    |
| Movement  | title, other names                                    | work title and nickname, composers                      |
| Recording | performers and their other spellings                  | work title, nickname, other names, composers, albums    |
| Composer, performer | name, other spellings                       |                                                         |
| Album     | album title                                           | album artist, works on it                               |

Catalogue numbers in titles, catalogue fields and other names become keys (`normalize.js`): "Op 27 no 2", "Op.27/2" and "op. 27, No. 2" are all `op:27:2`; "Hob. XVI:52" is `hob:xvi:52`; "KV 331a" is `k:331a`. A key without a number of its own matches its numbered pieces (`op:27` finds `op:27:1` and `op:27:2`). One-letter systems (D., K., S., L., M., Z.) need a dot or a number of two digits or more, so "in D major" is never a catalogue number.

Text is folded: lower case, accents removed, ø/æ/ß/ł and Cyrillic letters spelled out. Strong words also get a spelling skeleton (tch/tsch/ch/kh → h, w → v → f, c/q → k, y/j → i, doubled letters single) so Tchaikovsky, Tschaikowsky and Chaikovskii meet; a skeleton match ranks below a real one.

## Matching and ranking

Every catalogue key and every word of the query must match (words match as prefixes from two letters on). "no", "op", "in", "the", "of" and similar words count when present but are never required.

Weights, per query word: strong exact 10, strong prefix 6, skeleton 5, weak exact 4, weak prefix 2.5. A catalogue key: exact 40, a piece under it 18. Added per document: kind (work 12, composer 7, recording 6, performer 5, album 3, movement 1), owned 2, the whole query equal to the title or nickname 25.

A recording that matches every word lifts its work into the results ("Beethoven Levit" lists the works Levit recorded), just below the work's own matches and marked "Matched through a recording". The best result leads the response whatever its kind; sections come in the order works, recordings, composers, performers, albums, movements.

## Filters

Composer, performer, conductor, ensemble, period, form, instrument, recording type, year and library. A document must carry every chosen filter. Roles come from credits: the conductor filter keeps only recordings the person conducted, though a name search finds every role and labels the performer with each. Work documents carry the performers of their recordings, so a work can be filtered by who recorded it. Recording type is complete or incomplete (every movement present or not) and live (the album or recording names a concert, recital or broadcast). Year and label come from the files' tags (read from v0.2 on; rescan to fill older evidence).

## Ambiguity and duplicates

Search never merges documents: two works with one title stay two results, each with its composer and catalogue number. A work, recording or album appears once.

Two realizations are **one recording on two releases** when their tracks carry the same MusicBrainz recordings, or, with none, the same performers play the same movements on the same number of tracks, each within two seconds. Never across works, never two on one album, never on names alone. The recording lists every release it appears on.

## Speed

`test/search.test.js` builds a 10,000-track library (7,000 documents) and requires every search under 300 ms; searches take 7–20 ms on a laptop-class container, and a full rebuild about 0.8 s.

# slskd acquisition (v0.2)

`src/slskd-ranking.js`. The plugin's slskd source searches only for requests it classifies as classical; everything else is left to Aurral's own sources.

**Ladder** (one search at a time, within the minute Aurral gives a search call): 1. performer + album; 2. performer + work (+ catalogue number); 3. conductor or orchestra + album (when there is one besides the performer); 4. performer + composer + work; 5. broad work search (composer + work + catalogue number). The performer is the first soloist, else the conductor, else the ensemble; the composer never stands in for them. Steps 1–4 name who plays; step 5 doesn't, and what it finds must still name a performer. The ladder stops at the first step that finds a folder lining up with the release and scoring 60 or more.

**Score** (0–100, per folder, on its folder and file names): performer 30, conductor 12, ensemble 12, release title up to 20, work title up to 10, catalogue number 10, movement titles up to 8, lossless 5; then +25 when the folder lines up with the whole release (every track, every length within 2 s, as before) or +20 when a single track lines up with an edition. A folder naming none of the performers is rejected, with "names the composer but none of the performers" when that is the case. Availability (free slot, queue, speed) breaks ties.

**Duplicates**: one folder shared by several users (same folder name, same file sizes) is offered once at its best rank, with its copies right after it as fallbacks.

**Review**: a candidate scoring under 45 (it lines up, but names only the orchestra, say) is never taken automatically. Aurral's Manual Search passes `manual: true` (fork), and then such candidates are offered for a person to choose.

**Diagnostics**: the last 25 searches (`slskd-searches.json` in the plugin's data folder) with each step's query and counts, the candidates with their scores and reasons, and the rejected folders with theirs. The editor's **Downloads** tab shows them. Download, validation, copying and tagging are unchanged.
