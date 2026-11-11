# Disposable Phase 1 environment

Use only synthetic media and the named fixture volumes. The Compose network is internal and the provider stub returns recorded MusicBrainz fixtures or explicit 404s. Unrelated stock maintenance may log blocked network attempts; it cannot reach external providers. There are no production settings or keys. Published port 3301 binds loopback only.

Prepare the sibling core checkout at the core Phase 1 review commit documented in PHASE_1_REPORT.md, using Node 26.12.0 and pnpm 12.15.0. Run `pnpm install --frozen-lockfile` and `pnpm build` there. In this plugin checkout run `npm ci --ignore-scripts`, `npm test`, `npm run build`, and `node dev/generate-fixtures.mjs`.

Set `AURRAL_CORE_PATH` to the absolute core checkout path. Run `docker compose -f compose.dev.yaml up -d`, then `docker compose -f compose.dev.yaml exec -T aurral node /plugin/dev/smoke.mjs`. Browser: http://localhost:3301. Synthetic accounts are fixture-admin, fixture-one and fixture-two, all with password `fixture-password-only`; they have no value outside the disposable instance. Each regular user can access playlists but cannot acquire music.

The pinned Node image runs the locally prepared core source/dependencies and plugin bundle through read-only mounts. Config and library use separate named volumes. `dev/library` contains committed synthetic audio; the generator rebuilds it from the existing sine fixture. `fixtures.json` records étude set, sonata, symphony cycle, concerto, multiple recordings/releases, broadcast, incomplete work, attacca segments, multivalue performers, non-classical and crossover cases. These descriptions prepare later model/grouping phases; Phase 1 does not implement those later features.

The seed copies synthetic files and installs the plugin. Background file writes default off. Restart preserves playlists/config; rerunning smoke reuses each user's scoped work playlist. `docker compose ... down` stops the environment and preserves named volumes. To discard fixture data deliberately, remove only this project's two explicitly named fixture volumes after stopping it. Never mount a real Aurral config or library here.

Stock lacks the delegated playlist capability and comparisons explain the missing capability without creating ownerless playlists. API-1 tagging/source behavior remains available; full editor/work pages wait for later phases. See INTEGRATION_CONTRACT_v0.1.md.

## Phase 2 model checks

`npm test` includes model migrations, provenance, concurrent writers, interruption/restore, classification and all committed fixture scans. The model tests run without network access. The existing Compose smoke still verifies Phase 1 HTTP playback; the model backend has no page to browser-test. Admin model actions are described in MODEL_V1.md.

## Phase 3 browser and restart checks

Use the matching Phase 3 core source, build the frontend/plugin, and start the existing disposable Compose fixture. Run `node /plugin/dev/editor-fixtures.mjs prepare` with Compose exec to save media hashes, set synthetic audio read-only and run the explicit model scan. Install the locked Playwright development dependency and its Chromium browser. Start `node dev/fixture-relay.mjs` on the host, then run `EDITOR_TEST_URL=http://127.0.0.1:3305 node dev/editor-browser.mjs`. A system Chromium can be selected with `CHROMIUM_PATH`. The relay is test-only HTTP transport for the internal-network fixture; it does not proxy WebSockets or form part of the plugin architecture.

Run `node /plugin/dev/editor-fixtures.mjs check` inside Compose before and after restarting Aurral, then repeat `dev/smoke.mjs`. These commands verify persisted manual metadata, pins, order, audio associations, read-only byte equality and existing admin/two-user playback. A dedicated CI workflow runs this sequence with a pinned core commit and uploads screenshots. Stop the host relay and Compose after testing. The seed preserves existing fixture audio on restart instead of regenerating it.
