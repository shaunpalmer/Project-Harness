# Current State

Last verified: 2026-09-16
Verified commit: d4ce50a5a4e129f50562d0e541bc37e72d6cca37
Working branch: `feature/memory-context-neutral-roles`
Verification: Node 24.19.0; 44/44 tests, control:verify, memory:resume and diff whitespace checks passed. DSH host APIs are stubbed in adapter fixtures; live acceptance is pending.

## Current truth

Project Harness 0.4.1 was recovered and merged in PR #2 at d4ce50a.
The earlier PR #5/engineering-defaults branch narrative was inherited history,
not the current state of this repository.

This branch adds shared CLI/DSH memory context, explicit existing-note mapping,
bounded reads, and advisory Git-snapshot freshness checks. It generalises active
operating instructions and decision owners to user/agent roles while preserving
historical decisions and personal profile archives.

## Working capabilities

- Read-only DSH resume, inventory, and specialist selection.
- WordPress and Python prospecting skill routing.
- Eight-gate readiness, project discovery, safe project handoff and Git controls.
- Shared memory context with purpose, invariants, current truth, next action,
  accepted decisions, source paths and freshness warnings.

## Known boundaries

- Freshness warnings are evidence for review, not semantic validation.
- The verified commit above is the inspected base, not the uncommitted branch work.
- Live DSH verification of the new resume fields still requires installing this
  branch's package and starting a fresh session after review.
- Historical ADRs and personal profiles retain their names. Legacy machine markers
  remain accepted for compatibility.
- Merge, release, deployment, paid services and production mutation need approval.

## Next action

Publish this verified feature branch for review, then
test the packaged adapter in a fresh DSH session. Do not merge or release automatically.
