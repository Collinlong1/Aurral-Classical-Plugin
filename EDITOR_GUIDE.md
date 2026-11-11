# Manual metadata editor

Use the matching Phase 3 fork/plugin source and Node 22.16+. Open **Settings → Plugins → Aurral Classical → Pages → Open Classical metadata editor** as an admin. The plugin and its editor capability must be enabled. This is a review build, not a tagged deployment release.

Choose **Create new** to create a composer, work or performer/ensemble. A work accepts one movement title per line. Select a composer to create a work credited to that person. A work detail provides **Create broadcast recording**, with an optional year, year-month or full date; MusicBrainz is not required.

Select any catalogue entry to edit it. Each field shows the current source, pinned state and provider value. Correcting a provider-filled field pins the correction. **Pin this value** also pins a manual fallback; **Intentionally blank** stores a deliberate null. Saving an empty string/list is supported. Refreshes retain pins and conflicts. **Use provider value** explicitly unpins; if no active provider exists, **Remove pin** recomputes the normal fallback.

Edit one form at a time, then save or cancel before navigating. A stale revision returns a conflict and keeps the draft visible. Reload explicitly to load newer data. Ordinary validation errors keep the form editable so you can correct them.

On a work, use Up/Down controls and **Save movement order**. The editor requires every movement exactly once and saves the new canonical order atomically. Audio associations stay attached to their movement identities.

Before attaching audio, run **Scan classical model (read only)** from an album menu. Select a recording and its work performance, movement (or whole work), and owned file. Search items by track title, album, performer, composer or filename to narrow the choices. Accents and punctuation are ignored, so `No. 1 Prélude (Presto)` and `No 1 Prelude Presto` find the same track. Matching owned tracks appear alongside catalogue entries; select a track to inspect its metadata and attach it to an existing recording/work. If there is no recording yet, create the work and recording manually first. Scans retain file evidence without automatically creating work identities. Confirm classical classification if needed; the editor never silently overrides an ordinary/unsure decision. **Detach track** removes the catalogue attachment while retaining the audio and evidence.

Role-aware credits distinguish composers, soloists, conductors and ensembles. Create a person or ensemble, then add the appropriate credit to a selected work/recording/performance/release. Invalid role/contributor combinations and duplicate credits are rejected.

All edits stay in the plugin database. Read-only media is supported; no audio tags are written. Opening the editor starts no provider identification, scan or acquisition. Back up/restore the model using MODEL_V1.md; disabling the editor retains its data. Stock hosts without the bridge have no editor entry. Grouping, playback plans and work pages remain Phase 4.

When updating from the original Phase 3 build, replace the installed plugin's `index.js` and `manifest.json` with the updated `phase3-review` files and restart your test instance using your existing installation procedure. Rerun **Scan classical model (read only)** and reload the editor: older scan evidence lacks titles, albums and performers. A read-only library mount alone does not populate the model. Empty/legacy indexes now explain this in the editor. No core rebuild or database migration is needed for this search correction.
