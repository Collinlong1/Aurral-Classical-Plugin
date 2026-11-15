# Metadata editor UI improvements

## Current checkpoint

November 14, 2026 (America/Chicago). The user authorized the seven improvements from the editor review, one at a time, and requested a consistently updated handoff. **Item 1 is published in core `365e6dc49a54d9137e82c56e6956dabc1c9899f3`; the companion tests and handoff are being pushed next.** The user requested this push and then item 2. No deployment or PR is requested.

Baseline: core `61b8ddcab63b99b427099ea4bedca9f3f1c6a2b5`, plugin `fc144f20930139e728b8d5319866e96225fd7774`, both `aurral-classical`. Local checkouts: `/workspace/aurral`, `/workspace/plugin`. Changes are on the user-authorized aurral-classical branches only; no production access, deployment, PR, upstream write or subagents.

## Ordered work

1. **Published:** protect unsaved edits when saving another form, running an action, or navigating away.
2. Pending: focused album assignment: select tracks, choose/create work, map movements, apply.
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

## Next action

**Item 2: focused album assignment**, not started. Inspect `src/model/editor-v2.js` (`albumView`, assign/create/move commands) and the generic host field/section contract before changing it. Preserve the existing work-choice/mapping rules, classification defaults, explicit move semantics, revision protection and the new draft guard. Replace the repeated always-visible mapping forms with a single selected-track flow. Validate existing editor workflow regressions and the real UI; update this handoff after implementation and validation. Keep this as a separate change from item 1.
