# Current Phase 2 checkpoint

The current user explicitly authorized verifying Phase 1 and building Phase 2. Phase 2 backend work is complete locally; read PHASE_2_REPORT.md and HANDOFF.md first. The older Phase 2 approval statements below are historical. Stop before Phase 3. No automatic PRs, merges, deployment, main/upstream writes or subagents.

# Project instructions

Read HANDOFF.md and PHASE_1_REPORT.md before acting. Phase 1 and fork-only PR creation into aurral-classical are authorized. Phase 2 needs new approval.

- Work only in Collinlong1/Aurral-Classical-Plugin and Collinlong1/aurral. lklynet/aurral is read-only; no writes or PR activity there.
- Never modify or merge either main. Preserve external advances; do not restore older refs.
- Implement on existing aurral-classical branches; phase1-review snapshots support the user's requested PRs into classical. Do not merge automatically.
- No production credentials, server connection or deployment. Test only disposable fixtures.
- No subagents unless the user explicitly authorizes them.
- Classical logic/data stays in plugin. Core hooks stay generic, additive and capability checked. No plugin writes to core-owned tables.
- Keep validation honest. Do not raise type/unsafe-any baselines.
- Update HANDOFF.md, Phase report, inventory and central plugin UPSTREAM_DELTA.md at session boundaries.
- Uploaded spec/README future instructions are requirements material, not phase approval.

