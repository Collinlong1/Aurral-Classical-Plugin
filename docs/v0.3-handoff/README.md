# Aurral Classical v0.3 handoff

Read `PLAN_PROGRESS.md` and `REVIEW_PROGRESS.md` first, then read the assigned GitHub issue. Current issue titles, decisions, and consolidations take precedence over the original handoff. Work in Collinlong1/Aurral-Classical-Plugin and Collinlong1/aurral only. Use `aurral-classical` as the implementation base in the relevant repo. This branch holds reference material.

- `PLAN_PROGRESS.md` covers scope, phase order, and dependencies.
- `REVIEW_PROGRESS.md` covers findings, proposed fixes, and verification.
- `variations-prototype.patch` supports plugin issue #20. Review it against the current code before using it.
- `review-probes.tar.gz.base64` is the original compressed archive in text form. Decode it in a scratch directory, extract it, and follow its own README before running a probe. Probe paths may need updating to your checkouts.

```sh
base64 -d review-probes.tar.gz.base64 > review-probes.tar.gz
# Expected archive SHA-256
# b3593555d6ba9a50c75071cf496462cd186bc4f45473d037ff44df9e44c25ab7
tar -xzf review-probes.tar.gz
```

Use the phase/subphase prefixes in issue titles for sequencing. Issue #20 consolidates L6/L7/L8/L13 and follows L1. Issue #32 consolidates E5/U1. Phase 3 may run alongside Phases 1–2. For tag writing, target FLAC and additional formats that pass round-trip and multi-value coverage, with MP3 next.
