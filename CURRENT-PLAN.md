# Current Plan — Memory Context and Neutral Roles

Status: READY FOR REVIEW
Owner: Agent
Scope authorised by the user in the current repair request.

## Outcome

Make CLI and DSH resume useful and consistent, surface stale-memory evidence,
and remove personal assumptions from reusable operating instructions.

## Execution checklist

- [x] Inspect the 0.4.1 baseline, memory contracts and DSH registration boundary.
- [x] Reuse one bounded reader for CLI and DSH memory context.
- [x] Add explicit note mapping without automatic initialisation.
- [x] Add advisory freshness evidence and reconcile obsolete current-state claims.
- [x] Generalise current user/agent roles; preserve history and attribution.
- [x] Remove implicit personal-profile loading from entry instructions.
- [x] Keep existing layers and explain responsibility/permission precedence.
- [x] Add regression fixtures, including actual adapter handlers with host stubs.
- [x] Prevent stale `.tgz` package snapshots from entering a later package.
- [x] Complete final full-suite and control verification (44 tests, control:verify, memory:resume).
- [ ] Publish a feature-branch PR for review.
- [ ] After approval, verify the package in a fresh live DSH session.

## Stop condition

Stop after verified branch publication and review handoff. No merge, release,
installation on the user's machine, or Prospecting project changes are authorised
by this implementation task.
