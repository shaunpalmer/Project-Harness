id: ADR-0005
title: Composed, discoverable DSH skill architecture
status: accepted
date: 2026-09-17

# ADR-0005 — Composed, discoverable DSH skill architecture

## Context

The DSH integration registered skills correctly but used about half of what the skill architecture provides.

- Each specialist preset exposed a flat `required_skills` list of 4-5 file paths, so the model-facing catalogue was a fixed, shallow slice of a 25-skill library and there was no route to the rest.
- `skillDescription()` preferred the first H1, so DSH advertised `"SKILL: WordPress Plugin"` as the routing description. DSH renders only `name` and `description` (`packages/skill/tool-skill/src/index.ts:319-321`); `whenToUse` is stored but never rendered. The routing surface was therefore close to empty.
- Only three of 25 skills carried frontmatter, so the library was not portable into DSH's native filesystem provider, which requires `name` and `description` and parses the exact keys `whenToUse`, `disable-model-invocation`, `user-invocable` and `metadata`.
- The provider ignored the registration-scoped `control` object, so `control.invalidate()` was never called. DSH serves a cached catalogue without calling `list()` again (`packages/skill/skill/src/index.ts:529-531`); an added, removed or re-described skill stayed stale until restart.
- The provider resolved the workspace from configuration and not from `options.cwd`, so it was configuration-sensitive rather than workspace-sensitive.
- Every skill was registered `{ modelInvocable: true, userInvocable: true }`, including reference rule sets a human has no reason to invoke.

The binding constraint: narrowing a catalogue is only safe if the model can still reach what was not predicted. The previous design had no such route, which is why the catalogue had to stay broad and flat.

## Decision

Skill Architecture v2. `.github/skills` becomes a DSH-native skill library; composition and discovery replace the flat list.

1. **DSH-native frontmatter on every skill.** `name`, `description` and `whenToUse` exactly as DSH parses them, with Project Harness composition data under DSH's sanctioned `metadata` passthrough (`metadata.harness.{layer,topics,tags,stack}`). Descriptions are authored as the routing surface: one sentence naming the capability and its trigger. No new runtime dependency; the supported YAML subset is parsed locally and enforced by `scripts/skills-verify.js`.

2. **Tiered composition replaces `required_skills`.** `dsh/skills/capabilities.json` owns the shared vocabulary — core controls, the discovery entry point, and capability-to-skills bindings with evidence tokens. Specialist presets select capabilities by name and add their own `specialist_skills`. Resolution is `core ∪ discovery ∪ specialist ∪ default capabilities ∪ evidence-bound capabilities ∪ activated − suppressed`.

3. **Discovery closes the gap.** `find-skills` is always composed. `project_harness_find_skills` searches the entire library and DSH's native project and user roots; `project_harness_activate_skills` records the decision in `.harness/state/skills.json` and calls `control.invalidate()` so DSH republishes the catalogue; `project_harness_skill_catalog` explains what is visible and why. This is the mechanism that makes a narrow catalogue safe.

4. **Provider correctness.** Capture `control` and use `invalidate()`. Resolve the workspace from `options.cwd` via the nearest `.git` ancestor, falling back to the configured `projectRoot`. Rank skills at 600, DSH's `BUNDLED_SKILL_RANK`, so project roots (100/200) and user roots (400/500) shadow the harness library for free. Return `source` and `provider` from `get()`, which DSH validates.

5. **Invalidation without a watcher dependency.** A stat poll (default 2s) plus the `fs/observed` host-mutation recorder, mirroring the two mechanisms DSH's own filesystem provider uses. The poll exists because an in-`list()` fingerprint check cannot see anything while DSH is serving a cache hit.

6. **Project-local overrides stay native.** No migration away from the `.github/skills` handoff. A project that wants to override a harness skill drops it in `.dsh/skills`, and `find_skills` reports the shadowing.

7. **Invocation policy is deliberate.** `user-invocable: false` marks model-only reference rule sets (`wordpress-way`, `oop-standards`, `agent-initiative`, `guard-debugging`). Everything else stays available to both surfaces.

All logic lives in `dsh/skills/*.js` with no external imports, so tests exercise real provider behaviour; `dsh/index.js` is only DSH wiring.

## Rationale

- **Descriptions are the catalogue.** DSH renders only `name` and `description`, so a description that repeats the H1 spends context without routing. This was the cheapest and largest win.
- **Composition over enumeration.** `PROJECT-TYPES.md` already establishes that systems compose capabilities rather than fitting one label. A WordPress plugin with REST, a dashboard, persistence and browser UI should receive exactly those capabilities; a flat list cannot express that.
- **A narrow catalogue plus discovery beats a broad catalogue.** The alternative to composition was exposing all 25 skills, which recreates the context bloat on-demand skills exist to prevent.
- **Use DSH's mechanisms rather than reimplementing them.** Rank-based shadowing, layered scopes, `control.invalidate()` and the `fs/observed` recorder are the host's designed seams. The one thing DSH does not provide is a skill search tool, which is why `find_skills` exists.
- **No new dependency.** Importing `BUNDLED_SKILL_RANK` and `isSkillName` from `@deepseek-ai/dsh-skill` was rejected: an ESM named import that a host version does not export fails at link time and would break plugin load on an older DSH. Both constants and the frontmatter subset are inlined with source references and covered by tests, matching the existing thin-adapter posture.
- **Fail closed on catalogue quality.** An unroutable skill is rejected at parse time rather than advertised, and `npm run skills:verify` fails on a missing frontmatter block, a name that disagrees with its path, an unknown evidence token, or a capability referencing a skill that does not exist.

## Consequences

Easier:

- Adding a skill is a data change: add the file with frontmatter, bind it in `capabilities.json` or a preset, run `npm run skills:verify`.
- The same skill files are valid for DSH's native `.dsh/skills` root, so a future migration needs no rewriting.
- Project and user skills shadow the harness library with no code, and capability evidence is testable.
- The provider is unit-testable against a stub host, because no DSH import reaches the logic.

Harder or newly constrained:

- Composition is only as good as its evidence detectors; a capability with weak evidence stays activation-only by design.
- `.harness/state/skills.json` is the first file the adapter writes. The write is bounded to that path, validated and atomic, and the three read-only tools remain read-only; `docs/DSH-INTEGRATION.md` and `test/dsh-integration.test.js` now assert the narrow write contract explicitly.
- A stat poll runs while the plugin is loaded. It is a directory read plus a stat per skill file, `unref`ed, and disabled with `skillWatchIntervalMs: 0`.
- `.github/skills/INDEX.md` was removed and `.github/skills/guard_debugging.md` renamed to `guard-debugging.md`, because a non-skill Markdown file inside a DSH-scanned root produces a per-session parse warning and an underscore name is not valid DSH kebab-case. `scripts/guard_debugging.js` was updated to match.

## Addendum: reconciled with PR #8

This ADR was written against 925ce01. Before review, main advanced through PR #6 (DSH
quick-check docs) and PR #8 (`fix/session-workspace-routing`), and this branch was
rebased onto 44eb167.

PR #8 reached the same conclusion about workspace sensitivity independently, and its
contract now governs main. This branch adopts it rather than restating it:

- `project_root` and `project_root_source` (`session-cwd` / `configured-fallback`)
  are reported by the project-control tools.
- An explicit session cwd that is missing or invalid fails closed with
  `WORKSPACE_NOT_FOUND`. This branch previously fell back to the configured root,
  which PR #8's regression test correctly rejects: a session that names a project
  must not be silently routed at a different one.
- `provider.get()` is scoped to the composed plan for the current workspace, so a
  candidate one workspace would not have offered cannot be loaded in another. This
  ADR originally scoped `get()` only by library-root containment, which was too
  permissive; the merged test found it.

`test/dsh-workspace-routing.test.js` passes with no assertion changed. Its
`data:`-URL loader gained two rewrites for the adapter's module-relative imports,
because this decision moved the routing logic into `dsh/skills/plan.js`. That is a
change to the test's module loader, not to the behaviour it asserts.

One further fact belongs in the record: `origin/feat/skill-architecture-v2` contains
a separate parallel implementation of this same phase-one goal, built on PR #8. It is
not an ancestor of this branch and the two were deliberately not merged. Its
descriptions and layer assignments live in a `dsh/skill-catalog.json` manifest rather
than in skill frontmatter, its capability selection is manifest-driven rather than
evidence-driven, it registers at rank 250 rather than 600, and it adds no skill search
or activation tool. Choosing between the two is a user decision; `docs/CURRENT-STATE.md`
records the comparison so the choice is not lost with this branch.

## Addendum: merged layer vocabulary and generated catalog

Two ideas from the parallel `feat/skill-architecture-v2` implementation were merged
onto this branch after review.

**Layer vocabulary.** `tier` was renamed to `layer`, matching the vocabulary already
used in the plan and in the parallel branch. `metadata.harness.tier` is still accepted
as a legacy alias, and `layer` wins when both are present, so a skill file copied from
the earlier spelling — including a project-local override — keeps parsing. There is no
second name for the concept in the code or the generated artifacts.

**Generated package catalog.** `dsh/skill-catalog.json` lists every curated skill with
its path, layer, description, `when_to_use`, invocation policy, tags and topics, under
a declared `schema_version`. The parallel branch hand-authored this file; here it is
**generated** from frontmatter, which stays the single source of truth. Generating it
removes the drift the hand-authored form would introduce, and `npm run skills:verify`
fails when the committed file and the library disagree, so a stale catalog cannot ship.
`npm run skills:catalog` regenerates it.

The validator is deliberately stricter than the parallel branch's:
`validateCatalog()` reports every structural fault in one pass instead of throwing on
the first, requires `layer` to be in the shared vocabulary, enforces the same
description bounds as the frontmatter reader, rejects absolute or escaping paths, and
requires each entry's file to exist. The parallel implementation dropped an entry whose
file was missing with `.filter(Boolean)`, which hides a broken catalog; here a missing
file is a failure.

This is an integrity gate, not a second composition mechanism. Frontmatter and
`capabilities.json` still decide what the package ships and what a workspace sees; the
catalog is a verified view of the first, and nothing reads it at runtime.

## Addendum: verified against a real DeepSeek Harness checkout

Everything above was originally proven against a stub host. That left the entire
integration boundary — registration, catalogue publication, layering, invalidation —
unverified, and it left the portability claim ("these files are valid input for DSH's own
provider") as an assertion about a parser this repository wrote itself.

`npm run dsh:verify` now boots the real packages and checks both.

**Integration, against the real registry.** Composition per workspace, workspace scoping
in both directions, `snapshot().complete === true`, and the find → activate → invalidate →
republish loop all behave as designed. One claim became fact: a project
`<project>/.dsh/skills` entry does shadow the packaged skill of the same name and is
reported as `project-dsh`, so rank 600 buys native layering exactly as intended. Context
teardown settles, so the registered effect disposers run.

**Conformance, against DSH's own parser.** Every shipped skill file and a table of
frontmatter edge cases are parsed by DSH's provider and compared field by field. The
first run found two genuine divergences, both now fixed by tightening this parser rather
than relaxing the claim:

- an unquoted `#` was kept as text here and stripped as a YAML comment by DSH, so the two
  providers would have advertised different routing descriptions for one file;
- an unquoted value beginning with `[` was accepted as a plain string here and rejected by
  DSH's YAML reader.

`stripComment()` now removes a YAML comment from an unquoted scalar, and the parser
refuses block scalars, anchors, aliases, tags, flow mappings and unterminated flow
collections with a precise reason. Anything this parser accepts now parses to the same
value in DSH; anything outside the subset is rejected instead of mis-read. Parse failures
also carry a specific message instead of a generic malformed-frontmatter one, so
`skills:verify` can name the unsupported construct.

The probes must execute inside the checkout — they import its packages, so bare
`@deepseek-ai/*` specifiers resolve — and the runner copies a probe in, runs it with the
checkout's `tsx`, and removes the copy even when the probe fails. They live in
`dsh/probes/` rather than under `test/`, because Node's test runner treats every file
under a `test` directory as a test.
