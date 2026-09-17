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

### Verified against real DeepSeek Harness, and YAML-faithful frontmatter

- Added `npm run dsh:verify`: boots DeepSeek Harness's real skill registry, real filesystem
  provider and real consumer-facing snapshot API and runs the provider against them. It
  proves composition per workspace, workspace scoping in both directions,
  `snapshot().complete`, the find/activate/invalidate/republish loop, suppression, and
  that a project `.dsh/skills` entry shadows the packaged skill of the same name. Needs a
  checkout on disk (`DSH_CHECKOUT` or `--dsh-root`) and exits non-zero when it cannot find
  one rather than reporting a pass it did not earn; without a checkout its tests skip, so a
  hermetic clone still gets a green suite.
- Added a frontmatter conformance probe: every shipped skill and a table of edge cases are
  parsed by DeepSeek Harness's own provider and compared field by field with this
  repository's parser (174 assertions across 39 cases). It found two real divergences, both
  fixed here.
- Fixed: an unquoted `#` was kept as text here while DeepSeek Harness strips it as a YAML
  comment, so the two providers would have advertised different routing descriptions for
  the same file. Unquoted scalars now strip YAML comments; `#` inside a word stays literal.
- Fixed: an unquoted value starting with `[` was accepted as plain text here while
  DeepSeek Harness's YAML reader rejects it. Block scalars, anchors, aliases, tags, flow
  mappings, unterminated flow collections and trailing content after a quoted scalar are
  now rejected with a precise reason instead of being silently mis-read, so anything this
  parser accepts parses identically in DeepSeek Harness.
- Parse failures now carry a specific message rather than a generic malformed-frontmatter
  one, so `skills:verify` can name the unsupported construct.

### Package shape corrected against the DSH bundle contract

- `@deepseek-ai/schemastery` moved from `peerDependencies` to `dependencies`. It is a
  runtime validator, and both the documented package pattern and the published
  `dsh-github-intelligence` bundle place it there. Peer ranges are now real versions rather
  than `*`. The `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` peer warnings pnpm prints
  are inherent to an out-of-tree DSH bundle, not a packaging fault.
- Added a `files` allowlist: publication now ships the DSH bundle surface and the CLI
  toolkit surface and drops tests, docs, planning artifacts and `dsh/probes/` — 72 files
  instead of 146. Verified by installing the packed artifact into a throwaway DSH profile
  and running both probes against it.
- `dsh:verify` gained `--package-root`, which points the probes at an installed copy. A
  source checkout can pass while the package is missing a file, so the published artifact
  is now verifiable rather than assumed.
- `skillWatchIntervalMs` is constrained in the schema (`.step(1).min(0)`) so invalid
  configuration fails while the plugin loads instead of silently disabling catalogue
  refresh.

### Live in-session acceptance, and native-layer reconciliation

- Ran an end-to-end acceptance task through the shipped `headless` app with the packed
  bundle installed: `project_harness_skill_catalog` and `project_harness_find_skills` both
  executed against a real session. The composed catalogue matched the design exactly
  (13 skills for a WordPress fixture: 4 core, `find-skills`, 2 specialist, and 6
  evidence-bound capabilities), the session cwd won over the configured root, and a
  project-local `.dsh/skills` override was served from the nearer layer.
- Fixed: the catalogue and search reports described a skill using the harness copy even
  when a `.dsh/skills` entry of the same name was what DSH actually published to the model.
  Both now report the winning layer's description and flag `shadowed_by_native`, and
  `find_skills` searches the union of the shipped library and the native layer with exactly
  one entry per name so a superseded copy can never win the ranking. Found by the live run.

### Canonical tool values and Loader export guard

- Every tool now returns one canonical JSON value and declares DSH's `json` author spec
  instead of a pre-stringified string. PTC callers (`await tools.<name>(args)`) receive
  structured fields rather than having to parse prose, which the tool-authoring reference
  requires. The model-facing text is unchanged, and the output schema is not part of the
  model-visible projection. Verified against the real tool runtime, which registers all six
  tools and reads back unconstrained definitions.
- Added the export-shape guard `docs/testing.md` requires: an assertion that the plugin
  entry has no default export, plus a real `cordis-plugin-loader` `unwrapExports` round trip
  proving the namespace (and therefore `inject`) survives. Proven by injecting
  `export default apply`, watching both guards fail, and reverting. This guards the failure
  in postmortem 0001, where a stray default export loaded a plugin with no services past
  178 green tests.
- The live probe now also covers the tool layer through the real registry, and its
  peer-resolution skip no longer masks a syntax error in the plugin entry.

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
