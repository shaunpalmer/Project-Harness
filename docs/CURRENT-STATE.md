# Current State

Last verified: 2026-09-17
Verified commit: 44eb167 (main after PR #6 and PR #8)
Working branch: `feature/skill-architecture-v2` (rebased onto 44eb167)
Verification: Node 22.23.2; 88/88 tests including the merged `test/dsh-workspace-routing.test.js`, plus `skills:verify`, `control:verify`, `memory:resume` and `git diff --check`. DSH host APIs are stubbed in adapter fixtures; live acceptance is pending.

## Current truth

Main now carries PR #6 (DSH quick-check docs) and PR #8
(`fix/session-workspace-routing`). PR #8 established two contracts that this
branch now satisfies:

- `project_root` and `project_root_source` (`session-cwd` or
  `configured-fallback`) are reported by the project-control tools;
- an explicit session cwd that is missing or invalid **fails closed** with
  `WORKSPACE_NOT_FOUND` instead of silently falling back to the configured root.

This branch delivers Skill Architecture v2 (ADR-0005) on top of that base.
`.github/skills` is a DSH-native skill library: every skill carries `name`,
`description`, `whenToUse` and `metadata.harness` frontmatter, so the same files
are valid input for DSH's own filesystem provider. The flat per-specialist
`required_skills` lists are replaced by tiered composition — core controls, an
always-visible discovery entry point, specialist skills, and capability skills
bound by workspace evidence — with `dsh/skills/capabilities.json` as the shared
vocabulary.

The gap that made a narrow catalogue unsafe is closed: `find-skills` is always
composed, `project_harness_find_skills` searches the whole library and DSH's
native project and user roots, and `project_harness_activate_skills` records the
decision in `.harness/state/skills.json` and calls DSH's `control.invalidate()`
so the catalogue republishes.

The provider is workspace-sensitive in both directions: `list()` composes only the
current workspace's catalogue, and `get()` refuses a candidate the current
workspace would not have offered, so a skill resolved for one project cannot be
loaded into another. Skills rank at DSH's `BUNDLED_SKILL_RANK` of 600, so project
and user roots shadow them natively. The catalogue stays fresh through a stat poll
and the `fs/observed` recorder.

## Divergent branch

`origin/feat/skill-architecture-v2` (213b65c) is a **separate, parallel
implementation of the same phase-one goal**, built on PR #8 by Shaun. It is not an
ancestor of this branch and the two have not been reconciled.

It differs materially: descriptions and layer assignments live in a new
`dsh/skill-catalog.json` manifest rather than in skill frontmatter; capability
selection is manifest/layer-driven rather than evidence-driven; skills register at
rank 250 rather than 600; it polls only the manifest; and it adds no skill search
or activation tool, so its `find-skills` discovery layer is advisory rather than
executable.

Choosing between the two is a user decision. Do not merge both.

## Working capabilities

- DSH-native skill library with routing-quality descriptions and verified metadata.
- Composed catalogues: 8-14 skills in a typical workspace instead of a fixed 4-5.
- Find, activate and load loop over the full library, wired to DSH invalidation.
- Session-scoped workspace identity with reported provenance and fail-closed errors.
- Read-only DSH resume, inventory, specialist selection, catalogue and search tools.
- One bounded workspace write: `.harness/state/skills.json`, on activation only.
- `npm run skills:verify` gate over metadata, bindings and reachability.
- Eight-gate readiness, project discovery, safe project handoff and Git controls.

## Known boundaries

- Composition depends on evidence detectors; a capability with no detector is
  reachable only through `find_skills` + `activate_skills` or a preset default.
- The merged regression test `test/dsh-workspace-routing.test.js` loads
  `dsh/index.js` through a `data:` URL, so its loader rewrites the adapter's
  module-relative imports to absolute URLs. Its assertions are unmodified.
- `skills:verify` proves metadata and binding integrity, not routing quality.
- Live DSH verification of the new provider still requires installing this
  branch's package and starting a fresh session after review.
- `.github/skills/INDEX.md` was removed and `guard_debugging.md` renamed to
  `guard-debugging.md`; `scripts/guard_debugging.js` was updated to match.
- The root `complexity-brake/` directory is a byte-identical duplicate of
  `.github/skills/complexity-brake/SKILL.md` and is intentionally left in place.
- `.github/skills/front-dev-UI-Engineering` and `.github/skills/SkillOpt/` are not
  skills; DSH ignores them and `skills:verify` reports them as unindexed.
- Merge, release, deployment, paid services and production mutation need approval.

## Next action

Decide the route for the two Skill Architecture v2 implementations, then push this
branch, open it for review, and confirm the catalogue, `find_skills`, activation and
session-scoped loading in a live DSH session. Do not merge or release automatically.
