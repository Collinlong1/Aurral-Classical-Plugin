# Metadata editor UI improvements

## Current checkpoint

November 14, 2026 (America/Chicago). The user authorized the seven improvements from the editor review, one at a time, and requested a consistently updated handoff. **Item 1 is pushed**: core `365e6dc49a54d9137e82c56e6956dabc1c9899f3`, plugin `26be9ac013ed9ccd64726064c89b192352736a06`. **Item 2 publication authorized**: core `c38393bd4816e721bd4c838e59ad0403452f7153` pushed; plugin implementation `8800d16`, version 1.0.55, being pushed with its paired CI pin. **Item 3 starts next**: sectioned work editing with add forms on demand. The user additionally emphasized that core changes must be broad, reusable upstream improvements; all album/work/grouping workflow logic stays in the plugin. No deployment or PR is requested.

Baseline: core `61b8ddcab63b99b427099ea4bedca9f3f1c6a2b5`, plugin `fc144f20930139e728b8d5319866e96225fd7774`, both `aurral-classical`. Local checkouts: `/workspace/aurral`, `/workspace/plugin`. Changes are on the user-authorized aurral-classical branches only; no production access, deployment, PR, upstream write or subagents.

## Ordered work

1. **Published:** protect unsaved edits when saving another form, running an action, or navigating away.
2. **Publication authorized:** focused album assignment: select tracks, choose/create work, map movements, apply.
3. Pending: sectioned work editing; reveal add forms on demand; consolidate advanced actions.
4. Pending: keyboard-friendly lookup fields and clear search behavior/status.
5. Pending: save/cancel and feedback close to the active task.
6. Pending: batch movement reordering and clearer review/merge decisions.
7. Pending: preserve each list's search, page and scroll when visiting related entries.

## Item 1: findings and implementation record

- Confirmed: `PluginAdminPage` guards its `go` navigation but mutations bypass that guard. Successful mutations clear all dirty flags and refresh revision-keyed forms, losing other forms' drafts.
- Confirmed: the v2 renderer does not register a browser unload warning or a router navigation blocker.
- Implemented in core `frontend/src/pages/PluginAdminPage.tsx`: mutation requests check all dirty forms except the form being submitted. If other drafts exist, the existing Aurral confirmation component names their sections and offers Keep editing / Discard and continue. Cancellation sends no write. Successful confirmation executes the queued request once; failures retain the drafts.
- Existing internal-navigation confirmation is retained; router blocking now covers surrounding-app links and browser Back/Forward. A native beforeunload listener warns about reload/tab close. Conflict Reload also asks before resetting drafts.
- Successful mutations explicitly reset forms even when a command returns an unchanged revision; rejected actions never reset them. No catalogue schema, API, plugin bundle or matching change.
- Added `dev/editor-drafts-browser.mjs` in the plugin: bundles the actual core renderer, serves synthetic responses over loopback, and uses installed Chromium at desktop/phone widths. It does not run Aurral or access a library/provider. Run with `AURRAL_CORE_PATH=/workspace/aurral CHROMIUM_PATH=/usr/bin/chromium node dev/editor-drafts-browser.mjs`.

## Validation

- Installed Node 26.12.0 and pnpm 12.15.0 under core `.scratch/tooling`, with workspace-local package caches. No lockfile changes.
- Regression reproduced against original core `61b8ddc`: moving Allegro changed the title input from `Unsaved title` back to `Sonata` without warning. The harness failed on that data-loss assertion. To replay: set `EDITOR_DRAFTS_BASELINE=61b8ddc` with the command above.
- Fixed renderer passed desktop (1280px) and phone (390px): canceled cross-action/cross-form writes, saving the active form normally, draft retention on server error, conflict-reload warning, internal navigation, external route navigation, native reload warning, browser Back cancellation and successful confirmed discard. The last case returns an unchanged revision and verifies the action executes once and the old draft resets.
- Core focused plugin-host suite: 30/30 passed. TypeScript check and production frontend build passed. `pnpm check` passed with 1089 unsafe-any uses (unchanged allowance). Its first restricted attempt was denied at the child linter with EPERM; the permission-enabled rerun passed without source/baseline changes.
- Plugin full suite (Node 26.12): 22 test files passed, 1 failed (`background-matching.test.js`) in the restricted-network run. The unchanged failing file passed all 7 tests when rerun with loopback networking available. The full suite was not repeated; report the initial failure alongside the isolated pass. No plugin runtime changed.
- Core full unit suite with loopback access: **388 files / 2666 tests passed**, exit 0 (418.35 seconds), log `/workspace/aurral/.scratch/editor-unit-network.log`. The first restricted attempt did not complete and is not counted as a passing run; its original tool session is `97993`. The completed replacement run is the full-suite evidence.
- Read back the implementation diff and inspected prompt screenshots at both widths; the existing confirmation dialog renders centrally on desktop and as a bottom sheet on a phone, with both actions accessible.
- Screenshots/logs live under plugin `.scratch/editor-drafts/` and core `.scratch/`; never commit generated harness assets or screenshots.

## Scope and limitations

- Covered entry points: form Save, field actions, row actions, bulk actions (shared mutation guard), internal links/tabs/pagers, conflict Reload, surrounding-app routes, history and unload. Normal Save excludes its own draft from the discard question.
- Browser-only generic host change; no API/client contract, auth rule, provider integration, background job, catalogue migration, media write, playback or acquisition change. Existing Aurral confirmation styling/focus handling is reused. Cancel and explicit discard are both covered.
- The browser regression runs the actual renderer with synthetic responses, not a complete installed Aurral instance. The full Compose/Chromium/restart workflow and remote CI were not run locally. The paired integration workflow now pins published core `365e6dc` and runs the draft-protection browser regression before its existing full-app workflow. CI results must be checked separately.
- This step requires the new core UI build; no plugin bundle rebuild or manifest version bump is needed. The plugin's existing runtime files remain untouched.
- Documentation updated in both HANDOFF.md files and feature inventories, the plugin V0_2_REPORT.md and UPSTREAM_DELTA.md, and the user-facing EDITOR_GUIDE.md. This file is the authoritative running UI handoff.

## Item 2: implementation and core boundary

- Plugin `src/model/editor-v2.js`: one paged Tracks section replaces split assigned/unassigned lists and always-open grouping forms. Select tracks on this page, choose an existing or new work, then map only that selection and apply. Existing work suggestions appear only while choosing. Add tracks from a work starts at track selection.
- Selection tokens use the existing plugin change_set storage, enforce album membership and canonical album order, expire after a day, and bind final requests to the selected track IDs and destination. Back preserves the token; Cancel returns to the same album page without assigning. Not classical defaults to Skip; Skip preserves existing attachments. Creating a work can atomically move included selected tracks from another work. No catalogue schema change; legacy direct commands and v1 hosts remain supported.
- Core has only two item-2 runtime edits: a selected-state attribute on the shared BulkBar and CSS that keeps that bar sticky while selected. Applies to every plugin rows section, with existing Aurral tokens. No new API, classical names, routes, SQL or grouping decisions. All workflow stays in the plugin. The plugin cannot style host-owned controls through its declarative API; this behavior belongs to the shared renderer.
- Item 1 also belongs in core: the host owns dirty forms, mutation refresh/reset, routing and unload events. Putting those guards only in the plugin would miss browser navigation and host-level draft loss. Every admin-pages-v2 plugin benefits. These are candidates for upstream review, not claims of upstream acceptance.
- Removed an experimental smooth-to-instant section-scroll change after it did not resolve the mobile browser check. Browser automation now waits for existing section navigation to finish before opening a Select, which intentionally closes on scroll. Production scroll behavior stays as published.
- Plugin manifest bumped to 1.0.55 and index.js rebuilt. Updated user guide, both handoffs/inventories, V0_2_REPORT.md and UPSTREAM_DELTA.md. Paired integration now pins item-2 core `c38393b` and runs the assignment browser regression before the full-app workflow.

## Item 2 validation

- Focused editor/large-album/workflow tests: 35/35 passed with normal file isolation (Node 26.12). Covers 640-track pagination, selection order, cancel/back without assignment, Not classical Skip, rejecting substituted tracks, selected-only create/apply, and moving an assigned selection into a new work.
- `dev/editor-assignment-browser.mjs`: actual host renderer and actual plugin read/mutate commands, disposable synthetic 640-track catalogue, loopback server; passes at 1280px and 390px. Verifies sticky selected actions, a single task form, existing/new work paths, Skip, apply only selected tracks and return to album page 6. Screenshots inspected at both widths. It does not run the full Aurral app or contact providers.
- Draft regression also passes at both widths after item 2. Core pnpm check passes (1089 unsafe-any, unchanged baseline); frontend production build passes. Final core runtime diff is smaller than the checked build (experimental scroll edit reverted).
- An exploratory full-plugin run with `--test-isolation=none` failed in source/download tests. Those tests replace process-global fetch; that mode is not a valid substitute for the standard isolated suite. The standard full suite with normal isolation and loopback access passed: **333/333 tests**, exit 0 (263.44 seconds). Logs: `.scratch/editor-assignment-all-tests.log` (failed shared-process run), `.scratch/editor-assignment-isolated-tests.log` (standard run), `.scratch/editor-assignment-focused-final.log`, `.scratch/editor-assignment-browser.log`, `.scratch/editor-assignment-drafts.log`. Earlier mobile automation attempts failed while Select was dismissed by scrolling; the final browser run passes with the original production scrolling.
- Core full 2666-test suite passed for item 1; not repeated for the item-2 sticky styling. Full Compose/restart and remote CI not run for item 2.

## Next action

Push item 2 (plugin implementation `8800d16` plus paired CI pin; core `c38393b` already pushed), then implement item 3. Keep work section navigation and on-demand form state in the plugin using the existing editor API. No item-3 core changes planned. Items 4–7 remain pending.
