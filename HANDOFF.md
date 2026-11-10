# Codex / Claude shared handoff — Phase 1

Updated November 10, 2026. User authorized completing Phase 1 and opening PRs **in Collinlong1's repos targeting aurral-classical**. Phase 2 is not authorized. Finish pending Phase 1 verification/publication recorded in PHASE_1_REPORT.md; then stop for review.

Local Phase 1 validation is complete: core post-drift full suite 2752 tests, final acceptance rerun33, plugin138, Subsonic40; required checks/builds pass. Core PR36 is open at aecbb96625340cb3a1bd469787211cfe9bedcab5 into classical. Plugin publication/remote CI status is recorded in the final PR/checkpoint. Do not restart implementation or advance Phase2 while review is pending.

Read PHASE_1_REPORT.md, FORK_FEATURE_INVENTORY.md and (in the plugin repo) INTEGRATION_CONTRACT_v0.1.md and UPSTREAM_DELTA.md. PHASE_0_REPORT.md and PHASE_05_REPORT.md are historical audit records; their pending-approval statements do not describe current authorization.

## Current work

- Existing classical branches were used for implementation. Review snapshots go on phase1-review so the requested PRs can target the existing classical branches. Do not merge PRs automatically.
- Plugin: all owned explicit-work comparison, per-user playlist keys and queue completion, performer-first slskd, preview/clear/restore tags, verified atomic writes/backups, background writes off by default, synthetic fixtures and internal-network Compose.
- Generic core: action-scoped user-operation grants, complete library snapshot, local-only durable playlist operation with execution-time permission/expiry checks, consistent indexed paths on create/update/append, native Soulseek acquisition identity before source priority.
- No plugin data-model migrations or classical fields in core tables. Existing core jobs/settings persist operations; no new SQL schema.
- Fixtures exercise admin plus two regular users (no acquisition permission), exact owned streaming, no downloads, restart/idempotency, >25 recordings, cross-release copies, seven-value native tags, provider omissions and stock missing capability.
- Full structured schema/manual identities without explicit work evidence, editor, grouping, work pages and segment playback remain Phase 2–4.

## Source drift

Entry plugin classical: 393fbdb507324473ba861b577a9517d252332048; plugin main: 506e5259e1442b8cfe072a75b129abb428c6bcf7.
Entry core classical: 1a7f0081ef6b75ce4faa408dfae3a40572d1d359. Core locally merged frozen fork main c0deb211 via 30ba667d, then Phase 1 source a051bf3e.
During this phase, external merges advanced core main to 3739443a000defa9f246681e8a62233c1faef1c3 and core classical to 1b3c1c0074bd39df48bb115eca5254a07dde64b9, bringing upstream 021b1f03. These updates are preserved in a local merge. Do not reset remote refs. None of our writes target main or upstream.
The original fork still has 52 net changed paths (+3130/-181) against matching upstream 021b1f03, with 111 fork-only historical commits on live main. Sixteen preservation branches remain unchanged on 7afcb7cb. See PRESERVATION_BRANCHES.json.

## Validation and recovery

Read the Phase 1 report for final checks. Initial pre-drift full core run passed 2750 tests/406 files; subsequent source refinements and external drift require the recorded post-merge checks. Do not substitute the old audit's 2743-plus-timeout run. New plugin suite reached 138 passing tests; focused core grant/playlist tests and 40 Subsonic integration tests pass. The report records later results and limitations.

Core checkout /workspace/work/phase05/classical; plugin /workspace/work/phase05/plugin-repo. Logs /workspace/work/phase05/phase1-*.log. Node26.12 and pnpm12.15 under /workspace/work/phase05/tools/bin. Use workspace XDG directories; ASTRO_TELEMETRY_DISABLED=1. Independent node_modules per checkout; avoid heavy simultaneous builders.
Compose project aurral-classical-phase1 has only synthetic named volumes and an internal network. The daemon's published port was unavailable from the outer shell in this environment; docker compose exec runs the real HTTP/stream smoke inside the container. It passed for admin and two users, including after restart. No user server was accessed.

## Persistent boundaries

No main writes/merges, upstream edits/branches/PRs/comments, production credentials/server access or automatic deployments. No subagents without explicit user approval. Keep classical logic/storage in plugin and core hooks generic. No automatic PR merge. User approval is required before Phase 2. Update this shared handoff and report at each session boundary.

