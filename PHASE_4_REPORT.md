# Phase 4 — grouping, playback and work page

Phase 4 was explicitly authorized on November 10, 2026 (America/Chicago). This review implementation completes the v0.1 grouping/work-page slice on the existing `aurral-classical` branches. It does not begin v0.2 library search, richer v0.3 entity pages, Discover, automatic matching, or tag-writing expansion.

## Implemented behavior

- The plugin derives album contributions only from active, manually/reviewed classical track links and explicit realization items. It groups by work and performance realization, orders items by the stored sequence/occurrence, reports canonical movements that are missing, and retains file-local start/end boundaries. Identical titles alone never create or merge a work.
- A host-rendered **By Work / By Track** toggle appears only when a contribution contains a multi-movement work. By Track is the unchanged native list. Disabling the plugin/capability, a plugin failure, non-classical/unsure content, or an album without meaningful grouping yields the stock album page.
- **Play whole work** queues only the chosen realization's available items in stored order. Missing movements are skipped and displayed. Queue items persist optional segment boundaries; playback starts at the segment, advances at its end, clamps seeking to its displayed range, and does not hand a bounded item to remote playback as an unbounded native track.
- The basic work page is available to real signed-in users. It shows title, nickname/description, composer and role credits, parent collections, canonical movements, every owned realization across albums, completeness and playable items. It does not expose paths or plugin HTML/scripts.
- Work favourites and recording picks are per user. A user's pick overrides the admin pick; users without a pick see the admin fallback. Only admins can set the fallback. The host supplies the trusted user identity and validates every playable track/album reference before adding a stream URL.

## Storage and host contract

Plugin schema **2** adds `user_work_state` and `admin_work_pick` to `classical.sqlite`. Migration is forward-only, transactional, foreign-key checked, and preceded by the existing native SQLite backup. Existing catalogue/audio associations are unchanged. Restore a schema-1 backup only with all plugin processes stopped when rolling back to the Phase 3 plugin.

The generic core delta adds opt-in manifest `albumPresentation` and public resource pages (`pages[].admin=false`), bounded validated response schemas, authenticated routes, native reference validation, a host resource renderer, an album renderer, and optional queue segment fields. No classical table, title parser, grouping decision, favourite row, or work identity exists in core. Old plugins/manifests and albums without contributions keep their previous behavior.

## Validation observed locally

- Plugin suite: **178 tests**, including schema-1 upgrade/backup, grouping/order/missing movements, range references, collection membership, two-user/admin-pick isolation, read-only indexing when tag parsing rejects WAV or malformed-header files, and resumption of saved scan progress after a reader correction.
- Full core unit suite: **2,757 tests across 406 files** passed.
- Focused core plugin/queue suites: **52 tests** passed, including ordinary-user resource authorization, admin-pick denial, capability fallback, invalid native references, range clamping, range persistence, and refusal to expand bounded playback remotely.
- Core required checks pass with zero type errors and the unchanged 1,236 unsafe-any baseline. The production frontend build passes.
- Real Chromium through disposable Compose passes the existing editor workflow plus By Work/By Track, basic work navigation, incomplete movement display, admin fallback, two-user favourite/pick isolation and phone layout. Restart checks preserve schema-2 state, media permissions/hashes and the presentation. Existing admin/two-user exact-file comparison streaming still passes with zero acquisitions.
- Remote implementation CI is green for plugin `ce351e16d9a82f1cbc0284548ee218491146b29c` and pinned core `019e93f5a2f4720f8f0238c40c851dfb1070b740`: plugin run `43011161488` passed five jobs, and integration run `43011160969` passed the core checks/build, Chromium, restart/media and playback workflow.

All browser/Compose evidence uses committed synthetic audio and recorded/local provider fixtures. No production server, credentials, real-library data or provider traffic was accessed. The user's unrelated BrainzMash refresher remains untouched.

## Limits

- Grouping appears after an admin has created/reviewed work identities and attached owned tracks. Scanning alone does not fabricate works or performances.
- The basic work page intentionally stops at the v0.1 acceptance surface. Full entity navigation, rich recording/release artwork, related works and extended metadata remain the later v0.3 page scope.
- Per-user album view preference is currently stored in that browser for the signed-in user. Server-synced user settings remain later settings work.
- Native remote-player handoff refuses bounded segments because that protocol cannot carry ranges yet; local native playback remains available and never expands the segment.

Stop after Phase 4 review. No merge, deployment, release, upstream PR or later phase is implied.
