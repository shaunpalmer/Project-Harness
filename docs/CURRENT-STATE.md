# Current State

Last verified: 2026-09-17
Verified commit: 925ce01 (main at branch point)
Working branch: `feature/skill-architecture-v2`
Verification: Node 22.23.2; 80/80 tests, `skills:verify`, `control:verify`, `memory:resume` and `git diff --check` passed. DSH host APIs are stubbed in adapter fixtures; live acceptance is pending.

## Current truth

Project Harness 0.4.1 was recovered and merged in PR #2 at d4ce50a; the shared
memory-context and neutral-roles work merged at 925ce01.

This branch delivers Skill Architecture v2 (ADR-0005). `.github/skills` is now a
DSH-native skill library: every skill carries `name`, `description`, `whenToUse`
and `metadata.harness` frontmatter, so the same files are valid input for DSH's
own filesystem provider. The flat per-specialist `required_skills` lists are
replaced by tiered composition — core controls, an always-visible discovery entry
point, specialist skills, and capability skills bound by workspace evidence — with
`dsh/skills/capabilities.json` as the shared vocabulary and the specialist presets
selecting capabilities by name.

The gap that made a narrow catalogue unsafe is closed: `find-skills` is always
composed, `project_harness_find_skills` searches the whole library and DSH's
native project and user roots, and `project_harness_activate_skills` records the
decision in `.harness/state/skills.json` and calls DSH's `control.invalidate()`
so the catalogue republishes.

The provider is now genuinely workspace-sensitive (`options.cwd`, resolved to the
nearest `.git` root, with `projectRoot` as fallback), ranks skills at DSH's
`BUNDLED_SKILL_RANK` of 600 so project and user roots shadow it natively, and
keeps its catalogue fresh through a stat poll plus the `fs/observed` recorder.

## Working capabilities

- DSH-native skill library with routing-quality descriptions and verified metadata.
- Composed catalogues: 8-14 skills in a typical workspace instead of a fixed 4-5.
- Find, activate and load loop over the full library, wired to DSH invalidation.
- Read-only DSH resume, inventory, specialist selection, catalogue and search tools.
- One bounded workspace write: `.harness/state/skills.json`, on activation only.
- `npm run skills:verify` gate over metadata, bindings and reachability.
- Eight-gate readiness, project discovery, safe project handoff and Git controls.

## Known boundaries

- Composition depends on evidence detectors; a capability with no detector is
  reachable only through `find_skills` + `activate_skills` or a preset default.
- `skills:verify` proves metadata and binding integrity, not routing quality.
- Live DSH verification of the new provider still requires installing this
  branch's package and starting a fresh session after review.
- `.github/skills/INDEX.md` was removed and `guard_debugging.md` renamed to
  `guard-debugging.md`; `scripts/guard_debugging.js` was updated to match.
- The root `complexity-brake/` directory is a byte-identical duplicate of
  `.github/skills/complexity-brake/SKILL.md` and is intentionally left in place.
- `.github/skills/front-dev-UI-Engineering` and `.github/skills/SkillOpt/` are not
  skills; DSH ignores them and `skills:verify` reports them as unindexed.
- Historical ADRs and personal profiles retain their names. Legacy machine markers
  remain accepted for compatibility.
- Merge, release, deployment, paid services and production mutation need approval.

## Next action

Publish this verified feature branch for review, then install the packaged adapter
in a fresh DSH session and confirm the catalogue, `find_skills` and activation
behave live. Do not merge or release automatically.
