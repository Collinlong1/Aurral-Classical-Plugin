# Proposal for upstream Aurral: album presentation for plugins

A draft feature request for [lklynet/aurral](https://github.com/lklynet/aurral),
written for its feature request form. Not filed yet. Upstream asks for a
maintainer to approve a feature before any code, so this is the issue, not a
pull request. File it by hand; nothing here is sent upstream automatically.

Before filing: search upstream's issues for an existing request, attach
before-and-after screenshots of a classical album, and consider asking on the
Aurral Discord first.

---

**Title:** [Feature]: Let plugins add headings to an album's track list

**Affected area:** User interface

## Problem to solve

Some albums only make sense in sections. A classical album is several works,
each spread over a few tracks, but the album page shows one flat list of 20
tracks titled "Symphony No. 5 in C minor, Op. 67: I. Allegro con brio" and so
on, so you can't see where one piece ends and the next begins. Operas (acts),
audiobooks (parts), live albums (sets) and box sets (original albums) have the
same problem.

Most Aurral users never see albums like these, so this shouldn't be a native
feature or a setting. But a plugin that already understands the music (the
Aurral Classical plugin knows each track's parent work from MusicBrainz) has
no way to show what it knows on the album page. Today plugins can only add
menu actions, download sources, import lists and events.

## Proposed change

A plugin capability that adds headings over runs of tracks on the album page,
with a toggle back to the plain track list.

Manifest: `"albumPresentation": true`, listed as a capability the admin can
turn off.

Export: `albumPresentation(input)`. The input is the existing album target
from `pluginContext.ts` (`albumTarget()`), the same album object actions get.
It returns `null` to show the album as usual, or:

```json
{
  "label": "By work",
  "groups": [
    {
      "title": "Symphony No. 5 in C minor, Op. 67",
      "subtitle": "Ludwig van Beethoven",
      "detail": "Berlin Philharmonic · Herbert von Karajan",
      "trackIds": ["101", "102", "103", "104"]
    }
  ]
}
```

Toggle: when a plugin returns groups, the album page shows two buttons above
the track list, `<label>` (default "Grouped") and "By track". The browser
remembers the choice for each user; it is not a server setting. "By track" is
today's album page, unchanged.

Limits that keep it contained:

- **Headings only.** A plugin can't reorder, hide or add tracks. Track rows,
  menus, playback, the JSON API and Subsonic stay exactly as they are; the
  headings show only on the web album page.
- **Checked like every plugin answer.** It's checked with Valibot at the
  `callPlugin` boundary. Aurral drops track ids that aren't on the album and
  groups that aren't one run of consecutive tracks.
- **Never blocks the page.** The track list renders first and the headings
  appear when the answer arrives. On a timeout (a few seconds), an error or
  `null`, the album shows as it does today, with no toggle. Album-page
  timeouts don't count toward turning the plugin off.
- **One plugin per album.** The first active plugin that returns something
  other than `null` wins.
- **Easy to turn off.** The toggle returns any album to the plain list.
  Turning the plugin or the capability off, or safe mode, removes the
  headings and the toggle everywhere. Nothing is stored on the server.

Rough size: a manifest flag, a ~60-line service, one
`GET /api/plugins/album-presentation/:albumId` route for signed-in users, an
album-page query with the toggle, `TrackList` headings that can have a second
and third line, docs in `plugin-api.md`, tests for answer checking and falling
back to the normal album, and a perf scenario for the new route. About 200
lines plus tests, as one PR.

Performance: with no plugin that has the capability, nothing changes and no
request is made. With one, an album page view makes one call to the plugin
process and no outside network calls, as long as the plugin answers from data
it already keeps (the docs would say so).

## Alternatives and context

- **Native grouping from the `WORK` tag.** Aurral already stores file tags in
  track metadata (`discsubtitle` headings read them), so this would be tiny.
  But it covers one case only, and it adds behavior most users don't need to
  every album with stray work tags.
- **A plugin flag that turns on tag-based grouping.** It's smaller, but it
  still serves only classical music and leaves the plugin no say in how
  albums are split.
- **A full plugin-rendered album page.** Far more surface area and
  maintenance, and it breaks the "Aurral first" boundary.

Real use: the Aurral Classical plugin
(https://github.com/Collinlong1/Aurral-Classical-Plugin) runs a larger version
of this on a fork. Fields like "play this work" could be added later as
optional group fields without changing this shape. Happy to send the PR if the
direction is approved, and to share screenshots from the fork.

_Drafted with Claude Code._

---

## Notes for this repository (not part of the issue)

- The fork's `aurral-classical` branch already uses the same names
  (`albumPresentation` manifest key and export,
  `/plugins/album-presentation/:albumId`) with a larger, different answer
  shape. If upstream accepts this, rename or version the fork's hook before
  the next upstream sync, or make it extend this shape with optional fields,
  so the two don't conflict.
- On this branch (1.0.x on stock Aurral), the plugin would add
  `"albumPresentation": true` and an `albumPresentation` export that answers
  from its own records: the parent work it already finds with `topWork()`,
  kept per Library track when it tags.
