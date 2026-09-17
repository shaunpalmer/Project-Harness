# Current State

Last verified: 2026-09-17
Verified commit: 44eb167 (main after PR #6 and PR #8)
Working branch: `feature/skill-architecture-v2` (rebased onto 44eb167)
Verification: Node 22.23.2; 103/103 tests including the merged `test/dsh-workspace-routing.test.js` and two live DeepSeek Harness integration probes (39 integration + 174 conformance checks), plus `skills:verify`, `skills:catalog --check`, `control:verify`, `memory:resume` and `git diff --check`.

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
`required_skills` lists are replaced by layered composition — core controls, an
always-visible discovery entry point, specialist skills, and capability skills
bound by workspace evidence — with `dsh/skills/capabilities.json` as the shared
vocabulary. `dsh/skill-catalog.json` is a generated, schema-validated, freshness-checked
view of what the package ships, and `layer` is the single name for a skill's layer
(`tier` remains accepted as a legacy alias).

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

## Divergent branch (partially merged)

`origin/feat/skill-architecture-v2` (213b65c) is a separate, parallel implementation
of the same phase-one goal, built on PR #8. On review the route chosen was to merge
its best ideas onto this branch:

- **merged:** an explicit layer vocabulary (`tier` renamed to `layer`), and a
  package-owned `dsh/skill-catalog.json` with strict schema validation. The catalog is
  generated here rather than hand-authored, and its validator is stricter.
- **not merged:** exposing the whole 21-entry catalog to every session with a
  `metadata.recommended` flag. DSH renders only `name` and `description`, so that flag
  never reaches the model; the effect would be a wider catalogue with no routing signal,
  which is the context cost this design exists to avoid. This branch keeps composition
  at 12-14 evidence-bound skills plus the executable find/activate loop. The parallel
  branch also edited two negative isolation assertions in the merged
  `test/dsh-workspace-routing.test.js`; this branch keeps them.

The remote branch is retained for reference. Do not merge it wholesale.

## Verified against a real DeepSeek Harness checkout

`npm run dsh:verify` runs the provider against DeepSeek Harness's real skill registry,
real filesystem provider and real consumer-facing snapshot API, and parses every shipped
skill file through DeepSeek Harness's own provider to diff it against this repository's
parser. The first run found two genuine divergences — an unquoted `#` kept as text here but
stripped as a YAML comment by DeepSeek Harness, and a leading `[` accepted here but rejected
by its YAML reader — and both are fixed. The check is now 174 assertions across 39 cases,
and both probes run inside `npm test` when a checkout is present and skip without one.

This turned three previously asserted claims into facts: a project `.dsh/skills` entry does
shadow the packaged skill of the same name (rank 600 works as intended), the provider's
catalogue satisfies `snapshot().complete`, and the find → activate → invalidate →
republish loop works against the real registry.

## Published package verified as installed

`npm run dsh:verify --package-root <installed>` points the probes at an installed copy,
which is the only way to catch a packaging fault: a `files` allowlist that omits a path the
plugin reads still passes from a source checkout. Against the packed artifact installed into
a throwaway DSH profile, all 203 checks pass, `dsh --dump-config` carries a
`# == project-harness` layer, and the plugin imports with its bare specifiers resolved. The
throwaway profile was removed afterwards; the live `web` profile was not touched.

The package now declares the documented dependency roles (schemastery as a dependency, not
a peer) and ships 72 files instead of 146.

## Live in-session acceptance

An end-to-end task ran through the shipped `headless` app with the packed bundle installed
in a throwaway profile, against a WordPress fixture with its own `.git` and a project-local
`.dsh/skills/database-design` override. The model ran both diagnostic tools and reported:

- `project_root_source: session-cwd` with the fixture root, so session identity won over
  configuration and the DSH-checkout guard did not misfire;
- `specialist: wordpress-coding` at high confidence, and
  `detected_capabilities: [testing, database, api, ui, oop]`;
- 13 visible skills: 4 core, `find-skills`, 2 specialist, `testing-plan`, two database
  skills, `api-design`, `interface-design` and `oop-standards` — each with its composing
  reason, and `wordpress-way`/`oop-standards` correctly model-only;
- the project-local override served from the nearer layer, which is what the live run
  exposed as an inconsistency in the reports.

That inconsistency is fixed: the catalogue and `find_skills` now report the description of
the layer DSH actually publishes, flag `shadowed_by_native`, and search the union of the
shipped library and the native layer with one entry per name.

## Tool and export contracts

Following the DSH develop documentation and `docs/testing.md`, the plugin now matches two
further contracts. Every tool returns one canonical JSON value (`{ type: 'json' }`) rather
than a JSON string, so PTC callers get structured fields; the model-facing projection is
unchanged because `ctx.tools.schemas()` exposes only `name`, `description` and `parameters`.
And the namespace export shape is guarded by both a hermetic assertion and a real
`unwrapExports` round trip, because a stray `export default apply` would make the Loader
discard `inject` and load the plugin with no services. Both guards were proven by injecting
the regression and watching them fail.

## Working capabilities

- DSH-native skill library with routing-quality descriptions and verified metadata.
- Composed catalogues: 8-14 skills in a typical workspace instead of a fixed 4-5.
- Find, activate and load loop over the full library, wired to DSH invalidation.
- Session-scoped workspace identity with reported provenance and fail-closed errors.
- Read-only DSH resume, inventory, specialist selection, catalogue and search tools.
- One bounded workspace write: `.harness/state/skills.json`, on activation only.
- `npm run skills:verify` gate over metadata, bindings, reachability and catalog freshness.
- `npm run skills:catalog` regenerates the package catalog; drift is a verification failure.
- Eight-gate readiness, project discovery, safe project handoff and Git controls.

## Known boundaries

- Composition depends on evidence detectors; a capability with no detector is
  reachable only through `find_skills` + `activate_skills` or a preset default.
- The merged regression test `test/dsh-workspace-routing.test.js` loads
  `dsh/index.js` through a `data:` URL, so its loader rewrites the adapter's
  module-relative imports to absolute URLs. Its assertions are unmodified.
- `skills:verify` proves metadata and binding integrity, not routing quality.
- An end-to-end run inside a booted `dsh` profile with a live model is still not covered;
  it would consume provider credits and needs explicit approval. The registry-level and
  parser-level integration are covered; the model-facing in-session run is not.
- `.harness/state/skills.json` is not covered by any `.gitignore`, here or in the handoff,
  so activating a skill leaves an untracked file in the project. The lifecycle decision
  (commit as project intent, or ignore as regenerable state) is still open.
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
