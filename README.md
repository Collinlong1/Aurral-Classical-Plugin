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
| MusicBrainz contact | Your email or website. MusicBrainz asks every app for one; it goes in the User-Agent. Without one, the plugin's GitHub page is sent. |
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

Tracks whose Works have no composer (or `writer`) are left alone, as are
recordings that the genre and artist checks find aren't classical. The rules
are the beets plugin's, unchanged; see its README for how performers are
sorted into soloists and ensembles. On real MusicBrainz data the two give the
same artist for every recording tested.

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
same number of tracks per disc and every length within 2 seconds. A folder can
hold one disc or the whole release; for an album, one user's folders must
cover every disc.

Downloads run in slskd. Aurral checks on them every 15 seconds. When they
finish, the plugin copies the files from slskd's download folder into Aurral's
and tags each file whose length still matches its track with MusicBrainz's
title, artist and recording ID. Files it can't vouch for go back untagged,
so Aurral sends them to review.

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

## Release

Bump `version` in `manifest.json`, run `npm run build`, and push to `main`.
The release workflow tests, builds, and publishes `aurral-classical.zip`,
which Aurral installs and updates from.
