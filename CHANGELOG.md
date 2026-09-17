# Changelog

This file records meaningful user-facing harness changes. Git remains the source for exact file history.

## Unreleased

### Skill architecture v2

- Every skill in `.github/skills` now carries DSH-native frontmatter (`name`,
  `description`, `whenToUse`, `metadata.harness`), so the library is valid input for
  DSH's own filesystem skill provider. Descriptions are authored as the model-facing
  routing surface instead of repeating the H1 heading.
- Flat per-specialist `required_skills` lists are replaced by layered composition:
  always-on core controls, an always-visible `find-skills` discovery entry point,
  specialist skills, and capability skills bound by workspace evidence.
  `dsh/skills/capabilities.json` holds the shared vocabulary; specialist presets
  select capabilities by name.
- New `project_harness_skill_catalog`, `project_harness_find_skills` and
  `project_harness_activate_skills` tools. Find searches the whole library and
  DSH-native project and user roots; activate records the decision in
  `.harness/state/skills.json` and calls DSH's `control.invalidate()` so the
  catalogue republishes.
- The provider now resolves its workspace from `options.cwd` (nearest `.git` root,
  with `projectRoot` as fallback), ranks skills at DSH's `BUNDLED_SKILL_RANK` of 600
  so project and user roots shadow it natively, honours the registration-scoped
  `control` object, and keeps the catalogue fresh through a stat poll plus the
  `fs/observed` host-mutation recorder.
- Invocation policy is deliberate: reference rule sets (`wordpress-way`,
  `oop-standards`, `agent-initiative`, `guard-debugging`) are model-only.
- Added `npm run skills:verify` and a 31-test suite over the frontmatter reader,
  library, composition, activation and provider contract. All routing logic moved to
  `dsh/skills/*.js` with no DSH imports, so it is tested against a stub host.
- Removed `.github/skills/INDEX.md` and renamed `guard_debugging.md` to
  `guard-debugging.md`; a non-skill Markdown file inside a DSH-scanned root produced
  a per-session parse warning, and an underscore name is not valid DSH kebab-case.
  `.github/SKILLS-INDEX.md` is now the tiered reference.
- The adapter writes exactly one file, `.harness/state/skills.json`, and only on
  explicit activation. Resume, inventory, specialist selection, catalogue and search
  remain read-only.
- ADR-0005 records the decision. No new runtime dependency.

### Skill architecture v2 reconciliation with PR #6 and PR #8

- Rebased onto main after PR #6 (DSH quick-check docs) and PR #8
  (`fix/session-workspace-routing`). The quick-check section and README pointer from
  PR #6 are preserved and extended with `project_harness_skill_catalog`.
- Adopted PR #8's session-workspace contract: every project-control tool now reports
  `project_root` and `project_root_source` (`session-cwd` or
  `configured-fallback`).
- An explicit session cwd that is missing or invalid now **fails closed** with
  `WORKSPACE_NOT_FOUND`. The previous fallback silently routed an operation at the
  configured project, which PR #8 correctly rejects.
- `provider.get()` is now workspace-scoped: a candidate the current workspace would
  not have offered is refused, so a skill resolved for one session cannot be loaded
  into another.
- The merged `test/dsh-workspace-routing.test.js` passes unmodified apart from its
  data:-URL loader, which now rewrites the adapter's module-relative imports to
  absolute URLs. No assertion was changed or weakened.
- `origin/feat/skill-architecture-v2` is a separate parallel implementation of the
  same goal. Its best ideas were merged (see below); the rest is retained on the
  remote for reference.

### Merged from the parallel skill-architecture branch

- Renamed the skill frontmatter field `tier` to `layer`, matching the layer vocabulary
  used everywhere else. `tier` is still accepted as a legacy alias, and `layer` wins
  when both are present, so a skill copied from the earlier spelling keeps parsing.
- Added `dsh/skill-catalog.json`: a generated, schema-validated view of every curated
  skill with its path, layer, description, `when_to_use`, invocation policy, tags and
  topics. Frontmatter remains the single source of truth.
- Added `npm run skills:catalog` to regenerate it and extended `npm run skills:verify`
  to fail on an invalid or stale catalog. `validateCatalog()` reports every structural
  fault in one pass, enforces the shared layer vocabulary and description bounds,
  rejects absolute or escaping paths, and fails an entry whose file is missing instead
  of silently dropping it.
- Not merged: returning the whole catalog to every session with a `metadata.recommended`
  flag. DSH renders only `name` and `description` into the model-facing catalogue, so
  that flag never reaches the model; composition stays evidence-bound at 12-14 skills
  with the executable find/activate loop.

### Memory context and reusable roles

- Shared bounded CLI/DSH resume context with explicit existing-note mapping and
  advisory Git-snapshot freshness evidence; no automatic initialisation.
- Reconciled current state with the recovered 0.4.1 baseline.
- Reusable operating policy and generated decision owners use user/agent roles.
  Decision CLI consumers must migrate `ATHENA`/`SHAUN` comparisons to `AGENT`/`USER`.
  Historical records and personal profile filenames are preserved.
- Optional missing GitHub CLI no longer breaks local Git checks; VCS fixtures
  isolate user identity from the machine running tests.
- Package previews exclude nested generated `.tgz` snapshots.

### Added

- `ENGINEERING-DEFAULTS.md` as the routine engineering operating policy, including language/runtime defaults, architecture defaults, testing/failure rules, question budget, and version-control expectations.
- Deterministic `scripts/vcs-control.js` for non-interactive Git status, preflight, local init, safe work branches, focused checkpoints, existing-credential remote verification, and non-default branch push.
- Regression coverage for VCS branch safety, explicit staging, protected-branch refusal, preflight failure, and credential-bearing remote URLs.
- ADR-0004 documenting engineering defaults and deterministic version control.
- Infer-before-implement discovery flow for natural-language and unfamiliar projects.
- `SYSTEM-MODEL.md` and `ARCHITECTURE-HYPOTHESIS.md` planning artifacts.
- Eighth `system_model` Alignment Ladder gate and task schema v2.
- Hybrid capability composition and confidence-based project-shape reasoning.
- Generated-project `scripts/project-ready.mjs` readiness verifier.
- Regression coverage for draft discovery artifacts, hybrid/infer scaffolds, and eight-gate readiness.
- ADR-0003 documenting the infer-before-implement architecture.

### Changed

- Package version advanced to 0.4.0.
- The WordPress Way is consolidated into one authoritative rule set with runtime, architecture, WPCS, security, REST/AJAX, persistence, admin UI, performance, error-handling, and test guidance.
- Skill routing automatically binds obvious ecosystem skills from confirmed capabilities rather than asking Shaun to activate them.
- Decision rights distinguish applying an established default from materially deviating from a stack/architecture.
- The agent contract enforces a zero routine-question budget and treats version control as part of execution.
- `PROJECT-TYPES.md` is a preset library rather than a mandatory pattern/database/folder router.
- Natural-language intake no longer requires Shaun to preselect exactly one project type.
- Scraping guidance describes responsibilities and failure modes rather than mandatory modules.
- Supported advisory unlock no longer calls the incompatible legacy planning checker and requires a non-blocked execution state.

### Preserved

- Source/destination separation and WordPress packaging boundaries.
- Shaun owns consequential architecture deviations, providers, cost, security, merge, deploy, release, destructive history, and remote-repository lifecycle decisions.
- Athena owns routine/reversible work, established engineering defaults, focused commits/checkpoints, and authorised non-default-branch pushes.
- Legacy experimental scripts remain explicitly unsupported rather than silently promoted into the control plane.
