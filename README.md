# Aurral Classical

An [Aurral](https://github.com/lklynet/aurral) plugin for classical music. It
replaces the [beets classicalartist plugin](https://github.com/Collinlong1/Classical-Artists-Plugin),
using the same rules, so beets no longer needs to touch these files.

* **Tagging.** Classical tracks get an artist like
  `Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan`
  (Composer — Arranger — Soloist — Ensemble — Conductor), plus `COMPOSER`,
  `WORK` and `MUSICBRAINZ_WORKID`, all from MusicBrainz.
* **Tag as classical.** An admin-only artist and album menu item, for files
  that were already in the Library.
* **Compare recordings.** A track and album menu item that makes a playlist of
  the same movement played by different performers.
* **slskd download source.** Finds classical tracks and albums on Soulseek
  through your slskd, only in folders that line up with the exact release.

## Install

In Aurral, open **Settings > Plugins**, paste
`https://github.com/Collinlong1/Aurral-Classical-Plugin`, and install
**Aurral Classical**. Fill in the settings, press **Test**, then turn it on.

The plugin asks for **Aurral API access** to create Compare recordings
playlists and to check who may use that item.

## Settings

| Setting | |
| --- | --- |
| MusicBrainz mirror | Optional, like `http://musicbrainz.lan:5000`. musicbrainz.org is used at 1 request a second; a mirror has no limit. |
| slskd URL, API key | Your slskd, like `http://slskd:5030`. Only the download source needs them. |
| slskd download folder | slskd's downloads folder, as Aurral's container sees it. Finished files are copied from here. |
| Name order | The roles in the artist, in order. Default `composers, arrangers, soloists, ensembles, conductors`. People credited on the recording but in none of these roles come last. |
| Separator | Goes between the names. Default `—`, with a space either side. |
| Recordings to compare | How many recordings Compare recordings puts in a playlist. Default 10, at most 25. |

## Tagging

When Aurral files a download (`download.finished`), the plugin queues the file
in its data folder and tags it in the background. Every 15 minutes it works
through the queue and then looks through the Library for files with a
MusicBrainz recording ID that it has never processed, such as Lidarr imports
or files added by hand. It records every file it has seen, so each is looked up
once, and again only if the file changes.

For each file it looks up the recording on MusicBrainz, follows it to its Works
and their composers, and writes:

| Tag | Value |
| --- | --- |
| `ARTIST` | Composer — Arranger — Soloist — Ensemble — Conductor |
| `COMPOSER` | The composers |
| `WORK` | The Work the recording performs (usually a movement) |
| `MUSICBRAINZ_WORKID` | Its MusicBrainz ID |
| `ALBUMARTIST` | The album artist's English name, e.g. Pyotr Tchaikovsky for Пётр Ильич Чайковский |

Aurral files an album under one album artist, by its MusicBrainz ID, and
names that artist after the album artist tag, so the artist shows in English
and nothing moves. Albums credited to several artists, as beets tags them
("Claude Debussy; Daniel Barenboim"), keep their album artist.

Tracks whose Works have no composer (or `writer`) are left alone. The rules
for building the artist are the beets plugin's, unchanged; see its README for
how performers are sorted into soloists and ensembles. On real MusicBrainz
data the two give the same artist for every recording tested.

Deciding what is classical is stricter than the beets plugin, because film
scores, Christmas songs and crossover records also have Works with composers.
When the plugin can't tell, it changes nothing. A track is tagged only when:

1. Nothing says it isn't classical: no artist on the built-in non-classical
   list, an album that isn't a soundtrack or spoken word, a Work that isn't a
   soundtrack or musical, and no genre on the recording or album such as rock,
   pop, jazz, Christmas, soundtrack, film score, crossover or easy listening.
   Genres like "cinematic classical" or "classical crossover" don't count as
   classical. When the recording and album have no genres, the performers' and
   composers' main genres are checked the same way.
2. Something says it is: a classical genre on the recording or album, a
   classical Work type (symphony, concerto, sonata, suite, mass, opera...), a
   composer born before 1900 or known for classical music, or a performer known
   only for classical music.

On the files the plugin had tagged on a real Library, this left out every film
score, Christmas song and crossover record and kept the classical albums (see
the commit for the numbers). Files it skips are recorded as "non-classical" or
"not clearly classical".

Tags are written the way Aurral writes its own, with
[node-taglib-sharp](https://github.com/benrr101/node-taglib-sharp) and
MusicBrainz Picard's field names: only those four fields change. Every other
tag stays, including multi-value tags, the MP3 recording ID, MusicBrainz atoms
in M4A files and cover art. The plugin edits a copy beside the file and
renames it into place, so a crash never leaves half a file. FLAC, MP3, M4A,
Ogg and Opus files are supported. Fragmented MP4 files are skipped, as Aurral
skips them too. The audio is never re-encoded.

## Tag as classical

Admins see **Tag as classical** in the menu of an artist or an album in the
Library. It retags that album's files, or every file of that artist (by
MusicBrainz album artist ID, release, or album artist name), straight away,
even ones the plugin has seen before. It runs in the background and reports
how many it tagged and why it skipped the rest. Use it for music that was in
the Library before the plugin, or after fixing a Work on MusicBrainz.

Here the admin has said the music is classical, so missing evidence doesn't
stop it; signs that it isn't classical (a soundtrack, Christmas or crossover
genre, a musical) still do.

Admin actions never wait their turn behind other tagging. Several can run at
once, and background tagging (the schedule, new downloads) pauses at its next
file while one runs, even when Aurral runs it in another process.

## Remove classical tags

Admins see **Remove classical tags** in the album menu. Before it first changes
a file, the plugin keeps its `ARTIST`, `ALBUMARTIST`, `COMPOSER`, `WORK` and
`MUSICBRAINZ_WORKID` in its data folder; this puts them back. Files tagged
before the plugin kept these (or by the beets plugin) get the artist
MusicBrainz credits for that track on its release, which is what Aurral
writes. The plugin then leaves those recordings alone until an admin tags them
as classical again.

Menu items appear only while the plugin is on. Aurral's web app remembers the
list for a few minutes, so reload the page after turning the plugin on.

## Compare recordings

On a track (or an album, one playlist per movement, up to 10), this makes or
updates a static playlist called `Recordings: <Composer>: <Work>` with the
same movement from up to N recordings. The chosen recording comes first, then
other recordings already in the Library, then others MusicBrainz lists for
that Work (excerpts and medleys left out), each from its earliest official
release. Aurral queues downloads for the tracks the Library doesn't have.

Admins and users who may request music can use it. Aurral's API can only create
a playlist as the plugin itself, so it has no owner: admins see it under
Playlists, other users don't yet.

## slskd download source

The source answers only classical requests (a Work with a composer on
MusicBrainz); for anything else it returns nothing and Aurral moves on to the
next source.

It searches Soulseek for the composer, work, catalogue number and performer
(`Beethoven Symphony 5 op 67 Karajan`), then shorter variants. A Soulseek
folder qualifies only if its files line up with the release Aurral pinned: the
same number of tracks per disc and every length within 2 seconds. As in
Aurral's own matching, a length counts if it's within 2 seconds of the pinned
edition or of the same recording on another edition of the album, since
lengths typed in from a CD booklet are often a few seconds off a rip. A folder can
hold one disc or the whole release; for an album, one user's folders must
cover every disc.

Downloads run in slskd. Aurral checks on them every 15 seconds. When they
finish, the plugin puts the files from slskd's download folder into Aurral's
and tags each file whose length still matches its track with MusicBrainz's
title, artist and recording ID. Files it can't vouch for go back untagged,
so Aurral sends them to review.

Aurral keeps a plugin's downloads in its own data folder (`/config` in
Docker) until it imports them. When slskd's folder is on the same disk, the
plugin hard-links the files, which is instant and takes no space. Otherwise it
copies them, in the background across Aurral's checks, and first makes sure
the copy leaves at least 1 GB free there, since Aurral's database is on that
disk too. A download that doesn't fit fails with a message saying how much
room it needs.

## Data folder

Everything the plugin keeps is in its data folder: the queue, the list of
processed files, an index of the Library's tags, and a MusicBrainz cache
(recordings for a day, everything else for 30 days).

## Development

```bash
npm ci
npm test
```

```bash
npm run build
```

`index.js` is built from `src/` with node-taglib-sharp bundled in, because
Aurral installs no packages. Commit it with the source. CI checks it's current.

`npm run build:dev` builds `dev/classical-dev`: the same plugin under the id
`classical-dev`, plus `dev.*` helpers that copy Library files into the data
folder and tag only the copies. `scripts/mcp.mjs` sends it to an Aurral through
the plugin developer tools:

```bash
AURRAL_MCP_URL=https://aurral.example/api/mcp AURRAL_DEV_KEY=aurral_dev_... node scripts/mcp.mjs write-dev
```

## Test corpus

`test/corpus/albums.js` is a library of classical albums written as tags: well
and poorly tagged MusicBrainz releases, an album MusicBrainz doesn't have, a
recital, a box set disc, a song cycle, a compilation and a pop album, each
with the work view it should produce. `npm test` checks every album.

```bash
npm run corpus                                  # print each album as the By work view shows it
npm run corpus -- --audio ../corpus-music       # write silent FLAC files with the same tags and lengths
npm run corpus -- --serve-musicbrainz 5099      # answer MusicBrainz lookups from the corpus
```

For a real Aurral, put the generated folder in Aurral's library folder, set
the plugin's MusicBrainz mirror to `http://localhost:5099`, then run the model
scan and "Auto-match classical works". Add an album here for every new case.

## Release

Bump `version` in `manifest.json`, run `npm run build`, and push to `main`.
The release workflow tests, builds, and publishes `aurral-classical.zip`,
which Aurral installs and updates from.

## Classical data model (Phase 2 review)

The backend model uses independent plugin SQLite storage and requires Node 22.16+. See [MODEL_V1.md](MODEL_V1.md) for admin scans, provenance/pins and backup/restore, and [PHASE_2_REPORT.md](PHASE_2_REPORT.md) for validation. Manual editing, grouping and work pages remain later phases. This is review source, not a tagged production release.

## Manual editor (Phase 3 review)

The Phase 3 fork adds an admin form bridge. Open **Settings → Plugins → Aurral Classical → Pages → Open Classical metadata editor** to create provider-free works/broadcasts, reorder movements, attach owned audio and manage pinned metadata. See [EDITOR_GUIDE.md](EDITOR_GUIDE.md) and [PHASE_3_REPORT.md](PHASE_3_REPORT.md). Edits stay in the plugin database and work with read-only media. Stock hosts without the bridge have no editor entry. No production release/deployment is implied by this source branch.

Recording attachment uses the editor's page-level **Search items** box, which searches the complete indexed library and retains the selected recording. Completed read-only model scans apply a conservative automatic work pass based on explicit `WORK`, composer and release-order tags. An album's **Auto-match classical works (read only)** action additionally recognizes structured movement titles and resolves saved MusicBrainz recording/work identities to their parent work. It changes only plugin metadata and works with read-only media; ambiguous and collection-like sets remain for review.
