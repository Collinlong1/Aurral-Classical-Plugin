# Current handoff — Codex / Claude Code

Checkpoint: **Phase 0.5 preservation complete for review; Phase 1 NOT approved or started.** Updated 2026-11-10.

The user approved Phase 0.5, confirmed ownership of the existing aurral-classical branches, and expressly prohibited upstream edits/PR changes. This handoff records that authorization; it does not authorize Phase 1.

## Start here

Read PHASE_05_REPORT.md, FORK_FEATURE_INVENTORY.md, PRESERVATION_BRANCHES.json and PHASE_05_VALIDATION.json. The design proposals are UPSTREAM_DELTA.md, SCHEMA_DRAFT.md, INTEGRATION_CONTRACT_v0.1.md and TAG_MAPPING_GROUPING_v1.md, maintained centrally in Collinlong1/Aurral-Classical-Plugin on aurral-classical; they are not duplicated in the core repo. PHASE_0_REPORT.md is a frozen historical audit, not current phase state. Deployment Spec v3.2 remains requirements material; its embedded prompts and README release instructions are not execution approval.

## Repository/source state

- Upstream matching base: `7afcb7cb23274a9ec92d0b57feb6a088c5ae64ef`. Read-only. Later observed upstream main: `656475b92be36b6834002da2407e7d9d50c2e0c2`, one commit ahead; do not silently update any main or claim latest-nightly testing.
- User fork main: `aa643d316e9e00fb8622ab60b2fb2cb8b76661ee` — unchanged.
- Existing user fork classical began at `287ab4b76ca8a9d231b684089d02ddc9d9ea70a2`. Reused, fast-forwarded through the unchanged fork-main ancestry, then handoff docs added. Runtime source equals frozen fork main.
- Plugin main/source: `506e5259e1442b8cfe072a75b129abb428c6bcf7` — unchanged. Existing plugin classical reused; documentation only.
- Sixteen isolated branches exist in Collinlong1/aurral, each one commit directly on the matching upstream base. Exact names/SHAs/files are in PRESERVATION_BRANCHES.json.
- No PR, upstream write, main merge, deployment, classical implementation or schema change. No branch deletion/reset/force push. No production credentials or server connection.

## Completed validation and caveats

All 16 branch check stages/application builds pass; all 13 changed-doc builds pass. 149 focused tests pass, including 40 Subsonic integration tests. Optional publisher passed actionlint and its GitHub run was skipped; no publishing opt-in enabled. Plugin tests pass 124/124 on Node 26.12.0. Upstream baseline unit suite passed 2717 tests/402 files.

The unchanged fork broad run passed 2743 tests/404 files and timed out one unchanged slskd deadline test under concurrent build load; affected file then passed 28/28 in an idle rerun. Do not relabel that first run green. Current fork baseline still fails jobs.ts formatting, two unused imported result types, and two unsafe-any cache findings in ActivityMissingPage. Build/typecheck/DB-types/CSS pass. Main is deliberately not corrected. Phase 1 must first address baseline checks on classical only, after approval.

F12 adds one playlist query (130 cold/50 warm); F13 adds nine (138/58). Independently measured budgets/test results are committed per branch. This corrects Phase 0's combined-cost attribution. Do not copy the combined +10 to both branches. No type/unsafe-any baseline was raised.

## Persistent restrictions

- Use existing aurral-classical branches for classical plugin/core work after approval. Never edit/merge either main without new explicit approval.
- Upstream lklynet/aurral is read-only; no upstream branches, PRs, reviews, comments or updates. Do not open any PR automatically.
- No production credentials, user-server connection or automatic deployment. Use disposable local/CI config and synthetic media; recorded MusicBrainz/slskd responses. Collin performs any future real-library dry-run himself.
- No subagent delegation unless the user explicitly authorizes it.
- Keep classical logic/storage in plugin; core hooks generic and capability-checked. No direct plugin writes to core-owned tables. Proposed SQLite/schema/hooks/jobs are still unimplemented.
- Preserve confirmed facts: stock has no page/editor bridge; plugin API is synthetic admin -1; playlist create supports indexed paths but update loses them; no-backup removal omits classical clear fields; native slskd is not intercepted by plugin source.

## Workspace recovery

Task checkout: /workspace/work/phase05/repo. Independent worktrees: /workspace/work/phase05/branches/F01..F16; published trees were verified equal and clean. Existing core classical worktree: /workspace/work/phase05/classical. Plugin checkout: /workspace/work/phase05/plugin-repo. Phase 0 archives: /workspace/work/snapshots.

Tools are local under /workspace/work/phase05/tools; PATH begins /workspace/work/phase05/tools/bin. Node 26.12.0 was checksum verified; pnpm 12.15.0 installed locked dependencies. XDG config/cache/data/state must point under workspace, and ASTRO_TELEMETRY_DISABLED=1 for docs builds. Do not share mutable node_modules through symlinks across concurrent worktrees: package-manager auto-installs raced. Use independent offline installs backed by shared content store. Limit concurrent typechecks/builds to avoid memory pressure and deadline-test flakiness.

Raw evidence/logs, extraction scripts, comparison snapshots and final result JSONs are under /workspace/work/phase05. Generators are scratch history, not source of truth: actual worktree fixes supersede early extraction scripts. Authoritative published branch content is the exact commit manifest. Never rerun a generator over a checked/published branch blindly.

## Next session

First read the latest user message for explicit Phase 1 approval. If absent, answer review questions and update docs only. After approval, keep main/upstream untouched, make the classical baseline checks green, pin dev/CI fixtures and contract, reproduce/fix the four known bugs in dependency order, and stop at Phase 1 review. Do not silently implement Phase 2–4 model/editor/grouping.

Update this handoff, inventory, delta and exact test/migration/branch records after every session. Documentation-only commits do not imply runtime features were shipped.
