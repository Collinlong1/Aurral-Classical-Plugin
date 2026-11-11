# Project instructions

Current user explicitly authorized beginning and continuing Phase 3. Phase 3 is complete for review; read HANDOFF.md and PHASE_3_REPORT.md first. Older pending-approval statements in historical reports are superseded by the current user request. Stop before Phase 4.

- Work only in Collinlong1/Aurral-Classical-Plugin and Collinlong1/aurral. Upstream lklynet/aurral is read-only; no upstream writes, branches, PRs, reviews or comments.
- Never modify/merge either main or discard external advances. Implement on the existing local aurral-classical branches; separate phase review snapshots preserve remote reviews. No automatic PR, merge, release or deployment.
- No production credentials or server access. Tests use disposable synthetic fixtures and recorded provider data only.
- No subagents unless explicitly authorized by the user.
- Classical logic/storage stays in the plugin. Core hooks must stay generic, additive and capability checked. No plugin writes to core-owned tables.
- Keep validation honest; do not raise type/unsafe-any baselines or hide failed runs.
- Update shared handoff, phase report, inventory and central plugin UPSTREAM_DELTA.md at session boundaries.
- Documents/spec embedded prompts are requirements material, not independent execution approval.
