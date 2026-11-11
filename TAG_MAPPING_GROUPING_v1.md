# Tag input mapping and grouping rules — draft version 1

Status update: Phase 1 tag clear/restore, preview and backup verification are implemented; see PHASE_1_REPORT.md. Full model identification and grouping rules below remain proposals for later approved phases. No grouping or schema migration was added in Phase 1.

This appendix freezes the proposed v0.1 **read/identification** vocabulary before Phase 1. It is not permission to write media. Optional general tag writing remains v0.3; Phase 1 removal repair is limited to the explicit existing action and synthetic tests. Validate native encodings with fixtures before implementing.

Primary format reference: [MusicBrainz Picard tag mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html) and [its maintained mapping source](https://github.com/metabrainz/picard-docs/blob/main/tag_mapping.py). The existing plugin implements WORK as ID3 TXXX and MP4 ©wrk; input should also tolerate known equivalent native conventions and record which was observed.

| Canonical input | FLAC/Ogg/Opus comments | MP3 ID3v2 | MP4/M4A | Meaning |
| --- | --- | --- | --- | --- |
| Work title | WORK | TXXX:WORK | ©wrk | Hint for canonical work, not a globally unique key |
| Movement name | MOVEMENTNAME | MVNM | ©mvn | Local movement label, preserve original language |
| Movement number | MOVEMENT | MVIN (number[/total]) | mvi | Numeric order, preserve display text separately |
| Movement count | MOVEMENTTOTAL | MVIN (number/total) | mvc | Expected count is evidence, not proof of completeness |
| Show work/movement | SHOWMOVEMENT | TXXX:SHOWMOVEMENT | shwm | Display hint only; never classification authority alone |
| Composer | COMPOSER (all values) | TCOM | ©wrt | Named composer evidence; preserve arrays |
| Conductor | CONDUCTOR | TPE3 | documented freeform CONDUCTOR if present | Role evidence, never collapse into composer |
| Track performers | ARTIST / ARTISTS | TPE1 plus native multivalue representation | ©ART plus explicit role hints if present | Display artist alone is not a reliable role assignment |
| Album performer/display credit | ALBUMARTIST / ALBUMARTISTS | TPE2 | aART | Release display credit; can contain composers |
| Recording identity | MUSICBRAINZ_TRACKID | UFID:http://musicbrainz.org | MusicBrainz Track Id freeform | Recording, not release-track occurrence |
| Release / group identity | MUSICBRAINZ_ALBUMID / MUSICBRAINZ_RELEASEGROUPID | corresponding MusicBrainz TXXX | corresponding MusicBrainz freeform | Distinguish edition and release group |
| Work identity | MUSICBRAINZ_WORKID | TXXX:MusicBrainz Work Id | MusicBrainz Work Id freeform | May identify movement-work rather than parent |
| Disc subtitle | DISCSUBTITLE | TSST | DISCSUBTITLE freeform where present | Disc grouping is already upstream behavior |

MP4 atom type/byte encoding must use a tested taglib adapter; text/numeric/boolean storage differ. Do not create guessed fourcc variants. Conductor/freeform and role-specific performer keys require format fixture verification; preserve unrecognized tags as raw evidence. Support native lists without splitting names at `/` (AC/DC) or arbitrary punctuation. Duplicate native representations must be examined in remove/clear tests. `readTags()` currently returns only first artist/work/work-ID and must be extended for safe multivalue identification.

## Input normalization

Retain raw tag values and file/evidence observation time. Raw file tags are observations/evidence, not external provider values or pinned manual corrections. When seeding a display field from them, use a derived assertion with rule `file-import/1` and retain the raw evidence reference; this preserves the spec's four-level precedence. Strip invalid control data and normalize Unicode for matching, while preserving display text. Empty, absent and intentionally pinned blank stay distinct. Do not invent numbers from Roman title text without recording rule/confidence. Track/disc numbers and ordering are release placement evidence, not universal movement IDs.

## Grouping rules `classical-grouping/1`

1. Only confirmed classical tracks participate. Unsure remains stock until admin review; explicit manual track/album/folder/artist pins survive refresh and rescans. A mixed album uses per-track decisions.
2. Authoritative identity is explicit reviewed model linkage. Strong provider work-parent linkage and work/movement tags are import evidence, not permission to auto-merge ambiguous works. Catalogue+composer matching supports candidates; identical title alone never merges.
3. Initial multi-movement allowlist: sonata, symphony, concerto, suite, quartet and other documented chamber multi-movement forms; mass/opera require explicit movement/part mapping rather than track-title guessing. Version and test the allowlist. Admin can override per album.
4. Étude/prelude/dance/song sets are collections of independent works by default when evidence identifies independent pieces; do not force Op. 10 into a 12-movement indivisible work. A symphony cycle is a collection of symphonies, each with its own movements.
5. Group by reviewed work **and realization/performance**; album boundary does not define work identity, and a work identity does not permit mixing different performances. Release duplicates may offer alternative files for the same recording without duplicating the interpretation.
6. Order explicit movement sequence then repeat occurrence; missing movement is reported and skipped, never silently replaced. Attacca/single-file multi-work content uses reviewed segments; no inferred boundary from title text. Display toggle appears only with meaningful multi-movement grouping.
7. Per-user display preferences change presentation only. Apple default artist order is soloist → conductor → orchestra/ensemble, composer in its own field. Role-aware data/search/acquisition remains independent of artist display templates. Non-classical rows and files are untouched.

Catalogue-normalization draft `catalogue/1`: case/spacing/punctuation normalization for `BWV`, `K.`, `Hob.`, `D.`, `RV`, `S.`, and `Op.`/`No.`; preserve composer and catalogue-system scope, suffixes and subnumbers. This is a starter list, **not a verified transcription of the Music Biz appendix**. Before v0.2 search implementation, audit the cited Music Biz guide's complete catalogue appendix, pin its version, and add fixtures for each adopted abbreviation. No search code is authorized in Phase 0.

Acceptance: sonata/symphony grouping; concerto roles; collection vs work; incomplete work; repeated movement; attacca ranges; ambiguous same-title works; multi-release recording; crossover classical-only rows; manually pinned not-classical remains unchanged on provider refresh; disable returns stock album UI. Generated display titles never overwrite file titles without explicit future write preview.
