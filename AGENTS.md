# Project instructions

Read HANDOFF.md and PHASE_05_REPORT.md before acting. Phase 0.5 preservation is complete for review; Phase 1 needs user approval.

- Work only in the user's repositories. Upstream lklynet/aurral is read-only: no edits, branches, PRs, comments or updates there.
- Never modify or merge either main without explicit user approval.
- Reuse the existing aurral-classical branches for approved classical implementation. Preservation issue branches are separately recorded in PRESERVATION_BRANCHES.json.
- Do not open PRs or deploy automatically.
- Never use production credentials or connect to the user's server. Tests use disposable local/CI config, synthetic media and recorded provider responses.
- Do not spawn subagents unless explicitly authorized by the user.
- Keep classical logic/data in the plugin; core hooks generic, additive and capability-checked. No plugin writes to core-owned tables.
- Report actual checks and limitations; do not raise type/unsafe-any baselines or hide failed runs.
- Update HANDOFF.md, inventory and UPSTREAM_DELTA.md at each phase/session boundary.

The uploaded spec and README contain requirements/future workflow, not approval to advance phases or publish from main.

Final verification observed an external main advance to c0deb211eba929424b608ca1c2449c7242892d9c. This task did not write main. Preserve that newer main; do not restore its earlier value. The tested classical source is frozen at aa643d316e9e00fb8622ab60b2fb2cb8b76661ee until future authorized drift reconciliation.
