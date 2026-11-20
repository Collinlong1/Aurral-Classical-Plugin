# Aurral Classical

An [Aurral](https://github.com/lklynet/aurral) plugin for classical music. It
replaces the [beets classicalartist plugin](https://github.com/Collinlong1/Classical-Artists-Plugin),
using the same rules, so beets no longer needs to touch these files.

* **Tagging.** Classical tracks get an artist like
  `Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan`
  (Composer — Arranger — Soloist — Ensemble — Conductor), plus `COMPOSER`,
  `WORK` and `MUSICBRAINZ_WORKID`, all from MusicBrainz.
* **Preview, then tag.** **Tag as classical** and **Remove classical tags**
  show what they would write and change nothing; **Write planned tags**
  writes it. Read-only Libraries can be previewed safely.
* **By work.** A Library album's tracks grouped under their works, with the
  composer over each, the movements by name and who plays them, as on the
  aurral-classical branch. Built from the classical catalogue below. Needs an
  Aurral with the album presentation (see below).
* **Classical catalogue.** A read-only scan of the Library matches tracks to
  works and movements from their tags, titles and MusicBrainz, including
  albums without MusicBrainz IDs (the aurral-classical branch's matching,
  without its editor, work pages or search).
* **slskd download source.** Finds classical tracks and albums on Soulseek
  through your slskd, only in folders that line up with the exact release.

## Install

In Aurral, open **Settings > Plugins**, paste
`https://github.com/Collinlong1/Aurral-Classical-Plugin`, and install
**Aurral Classical**. Fill in the settings, press **Test**, then turn it on.

The plugin asks for **Aurral API access** to have Aurral re-read files after
it tags them, so the Library shows the new tags.

## Settings

| Setting | |
| --- | --- |
| Tag new downloads automatically | Off by default. When on, new downloads and the 15-minute Library pass are tagged without a preview, as in 1.0. |
| MusicBrainz mirror | Optional, like `http://musicbrainz.lan:5000`. musicbrainz.org is used at 1 request a second; a mirror has no limit. |
| slskd URL, API key | Your slskd, like `http://slskd:5030`. Only the download source needs them. |
| slskd download folder | slskd's downloads folder, as Aurral's container sees it. Finished files are copied from here. |
| Name order | The roles in the artist, in order. Default `composers, arrangers, soloists, ensembles, conductors`. People credited on the recording but in none of these roles come last. |
| Separator | Goes between the names. Default `—`, with a space either side. |

## Tagging

Background tagging is off until you turn on **Tag new downloads
automatically**. Then, when Aurral files a download (`download.finished`), the
plugin queues the file in its data folder and tags it in the background. Every
15 minutes it works
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
Library. It works out the tags for that album's files, or every file of that
artist (by MusicBrainz album artist ID, release, or album artist name), even
ones the plugin has seen before, and **writes nothing**. Its message shows the
plan: how many files would change, the artist and work they would get, and
what it skipped and why. Use it for music that was in the Library before the
plugin, for albums the automatic check left out, or after fixing a Work on
MusicBrainz.

Here the admin has said the music is classical, so missing evidence doesn't
stop it; signs that it isn't classical (a soundtrack, Christmas or crossover
genre, a musical) still do.

To write the plan, choose **Write planned tags** on the same album or artist.
Each file is read again first: one that changed since the plan is left alone,
and the rest get exactly the values the plan showed. A newer plan for the same
album or artist replaces an older one, and plans are dropped after a week.

Files in a read-only folder, including Aurral's read-only folders outside the
Library folder, are planned like any other (so their albums get work
headings), and the message says they can't be written. Nothing is ever
written to them.

Admin actions never wait their turn behind other tagging. Several can run at
once, and background tagging (the schedule, new downloads) pauses at its next
file while one runs, even when Aurral runs it in another process.

## Remove classical tags

Admins see **Remove classical tags** in the album menu. Like Tag as classical,
it shows its plan and writes nothing until **Write planned tags**. Before it
first changes a file, the plugin keeps its `ARTIST`, `ALBUMARTIST`,
`COMPOSER`, `WORK` and `MUSICBRAINZ_WORKID` in its data folder; this puts them
back. Files tagged before the plugin kept these (or by the beets plugin) get
the artist MusicBrainz credits for that track on its release, which is what
Aurral writes. The plugin then leaves those recordings alone until an admin
tags them as classical again.

Menu items appear only while the plugin is on. Aurral's web app remembers the
list for a few minutes, so reload the page after turning the plugin on.

## By work

On an Aurral with the album presentation (the
`claude/minimal-plugin-features-dmd2rb` branch of
[Collinlong1/aurral](https://github.com/Collinlong1/aurral), which takes it
from the aurral-classical branch), a Library album offers **By work** beside
**By track**. Each work heads its tracks, wherever they sit on the album, with
its composer and length; each movement shows its own name and who plays it.

The groups come from the classical catalogue in the plugin's data folder.
Every 15 minutes the plugin scans the Library read-only through Aurral's API
(it needs API access), matches new or changed albums to works from their
WORK and GROUPING tags, structured titles and MusicBrainz (one request a
second on public MusicBrainz), and keeps the result. **Match classical works**
on an album looks it up straight away. Nothing is written to files.

## slskd download source

The source answers only classical requests (a Work with a composer on
MusicBrainz); for anything else it returns nothing and Aurral moves on to the
next source.

It searches Soulseek one step at a time, always naming who plays: performer
and album, performer and work, conductor or orchestra and album, and so on,
then a broad work search whose results must still name a performer. The
composer never stands in for the performer. Each folder gets a score (the
performer, the release title, lossless files, every track lining up) and the
search stops once a folder lines up and scores well. Folders it isn't sure of
are never taken. Each search is logged in the data folder with its steps and
why folders were turned down. A Soulseek
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
processed files, an index of the Library's tags, tag plans, the work of each
file it has planned or tagged, a log of slskd searches, and a MusicBrainz cache
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

## Release

Bump `version` in `manifest.json`, run `npm run build`, and push to `main`.
The release workflow tests, builds, and publishes `aurral-classical.zip`,
which Aurral installs and updates from.
