# Skill Architecture v2 — work plan

Branch: `feature/skill-architecture-v2`
Scope: Project Harness DSH skill layer only. No product code, no merge, no release, no live provider calls.

## Problem

The DSH integration is structurally correct but uses roughly half of the skill
architecture DSH provides:

| Area | Current state | Gap |
|---|---|---|
| Workspace routing | Resolves configured `projectRoot` | Does not read `options.cwd`, so it is config-sensitive rather than workspace-sensitive |
| Global provider | Registered once on `ctx.skills` | Correct |
| On-demand bodies | Catalogue summaries, body on `get()` | Correct |
| Skill catalogue | Fixed `required_skills` per preset | 4-5 flat paths; no composition, no discovery path to the rest of the library |
| Skill descriptions | Prefers the H1 (`"SKILL: WordPress Plugin"`) | No routing signal for the model |
| Skill metadata | Only `find-skills`, `oop-standards`, `project-memory` have frontmatter | Not portable into DSH's native filesystem provider |
| Cache invalidation | Ignored | Additions/removals/description changes stay stale until restart |
| Project-local layering | Handoff copies a curated subset into `.github/skills` | Native `.dsh/skills` / `.agents/skills` shadowing unused |
| Invocation policy | `{modelInvocable: true, userInvocable: true}` for every skill | Reference/rule-set skills are needlessly human-invocable |

The catalogue is also the only way to reach a skill. Narrowing it is therefore
unsafe today, and that is why it is broad and flat instead of composed.

## Outcome

A composed, discoverable, invalidatable skill layer:

```
core controls      → always composed, small and fixed
specialist         → composed from workspace evidence
capabilities       → composed from evidence or explicit activation
discovery          → find-skills is always present as the route to everything else
project-local      → DSH-native .dsh/skills / .agents/skills shadowing, for free
```

## Design

### 1. Canonical skill root and DSH-native frontmatter

`.github/skills/` stays the canonical library root. Every skill gains
DSH-native frontmatter using exactly the keys DSH's filesystem provider parses
(`packages/skill/skill-filesystem/src/index.ts`):

```yaml
---
name: wordpress-plugin
description: Build and refactor WordPress plugins using the plugin lifecycle, activation and
  deactivation hooks, Settings and REST APIs, cron events, wpdb/dbDelta persistence and
  admin screens.
whenToUse: Use when the workspace contains a WordPress plugin or theme and the task changes PHP runtime behaviour.
user-invocable: true
metadata:
  harness:
    tier: specialist
    capabilities: [wordpress-runtime, admin-ui, rest-api, database]
    tags: [wordpress, php, hooks, rest]
---
```

- `name`, `description`, `whenToUse` are the DSH contract.
- Tier/capability/tag data lives under `metadata.harness`, the DSH-sanctioned
  extension point, so the files stay portable into DSH's native provider.
- `user-invocable: false` marks reference rule-sets (`wordpress-way`,
  `oop-standards`, `agent-initiative`) that a human has no reason to type.
- The body is stored without frontmatter and returned without it by `get()`,
  matching the native provider's `content: parsed.body.trim()`.

Rules for `description`, because it is the entire model-facing routing surface
(DSH renders only `name` and `description`; `whenToUse` is not rendered):
one sentence, imperative, 20-45 words, naming concrete technologies and triggers.

Directory bundles (`<name>/SKILL.md`) and flat files (`<name>.md`) are both
supported, matching the native provider. Nested `**/SKILL.md` is not.

Two stray artifacts do not qualify as skills and stay unindexed:
`.github/skills/front-dev-UI-Engineering` (extensionless HTML asset) and
`.github/skills/SkillOpt/` (notes). The duplicate root `complexity-brake/`
directory is a byte-identical leftover and is recorded, not deleted.

### 2. Composition replaces flat `required_skills`

`dsh/skills/capabilities.json` owns the shared vocabulary:

```json
{
  "schema_version": 1,
  "core_skills": ["complexity-brake", "loop-controller", "project-memory", "skill-router"],
  "discovery_skills": ["find-skills"],
  "capabilities": {
    "testing":  { "skills": ["testing-plan"], "evidence": ["tests-present"] },
    "database": { "skills": ["database-selection", "database-design"], "evidence": ["schema-or-migration"] },
    "api":      { "skills": ["api-design"], "evidence": ["api-surface"] },
    "ui":       { "skills": ["interface-design"], "evidence": ["template-or-style"] },
    "browser":  { "skills": ["chrome-devtools-mcp"], "evidence": ["browser-dependency"] },
    "oop":      { "skills": ["oop-standards"], "evidence": ["class-declarations"] },
    "scraping": { "skills": ["scraping-pipeline"], "evidence": ["scraper-sources"] },
    "logging":  { "skills": ["trace-eval-logging"], "evidence": [] }
  }
}
```

`capabilities[].evidence` names a bounded detector; an empty list means the
capability is only reachable by explicit activation or a preset default.

Specialist presets select capabilities rather than listing paths:

```json
{
  "id": "wordpress-coding",
  "domain": "coding",
  "stack": ["PHP", "WordPress APIs"],
  "specialist_skills": ["wordpress-plugin", "wordpress-way"],
  "capability_skills": ["database", "api", "ui", "browser", "testing", "oop"],
  "default_capabilities": ["testing"],
  "extra_skills": [],
  "defaults": { "...": "unchanged" },
  "excluded_domains": ["sales", "marketing", "seo", "analytics", "hr", "tax", "administration"],
  "routing_note": "unchanged"
}
```

`core_skills` and `discovery_skills` come from the shared vocabulary, so the two
presets cannot drift apart on the controls they share.

Resolution order for one workspace:

```
visible = core
        ∪ discovery
        ∪ specialist_skills                    (when a specialist matches)
        ∪ default_capabilities       → skills  (when a specialist matches)
        ∪ detected capabilities      → skills
        ∪ activated_skills                     (.harness/state/skills.json)
```

WordPress result: 4 core + 1 discovery + 2 specialist + 1 default + evidence-bound
capabilities ≈ 8-14 skills. Prospecting result ≈ 5-11. Both inside the useful
band; neither exposes the ~25-skill library.

### 3. Find a skill — the discovery loop

The critical complement to a narrow catalogue. Without it, composition loses
capability. Three steps, all inside DSH's own mechanisms:

1. **`find-skills` is always composed** (discovery tier, model-invocable). Its
   body teaches the loop below and remains the entry point for the external
   `npx skills` ecosystem.
2. **`project_harness_find_skills`** searches the *entire* library — not just the
   composed set — by name, description, `whenToUse`, tags, capabilities, stack
   and tier, and also reports DSH-native skills already present in
   `.dsh/skills`, `.agents/skills`, `~/.dsh/skills` and `~/.agents/skills`.
   Read-only. Explains which matches are already visible.
3. **`project_harness_activate_skills`** records names in
   `.harness/state/skills.json` and calls `control.invalidate()`. DSH then
   re-collects, `dsh-tool-skill` sees a changed digest and publishes a
   replacement `<available_skills>` catalogue, and the model can load the skill
   with the native `skill` tool. This is exactly what `control.invalidate()` is
   documented to exist for.

This is the mechanism that makes a small catalogue safe: the model can always
find and promote a skill that was not predicted.

`project_harness_skill_catalog` reports what is currently visible, which tier and
which evidence put it there, and what has been activated — the debugging surface
for the whole layer.

### 4. Provider correctness

- capture the factory's `control` and use `control.invalidate()`.
- resolve the workspace from `options.cwd` (the calling agent's session cwd,
  matching `dsh-tool-skill`'s `{ cwd: exec.agent?.session.header.cwd }`), falling
  back to the configured `projectRoot`.
- rank `600`, DSH's `BUNDLED_SKILL_RANK`, so project roots (100/200) and user
  roots (400/500) shadow the harness library with no work from us.
- `source: 'bundled'`, `provider: 'project-harness'`.
- `resourceBase: { kind: 'directory', path: dirname(file) }`, as the native
  provider does.
- invocation policy read from frontmatter, not hard-coded.
- `get()` re-reads and re-parses, so a body edit needs no invalidation.

### 5. Invalidation without a heavy watcher

`list()` computes a cheap fingerprint over the composed frontmatter
(name, description, whenToUse, invocation, tier, capabilities, file mtime and
size). A changed fingerprint schedules `control.invalidate()` on the next
macrotask, after the current discovery returns. Additions, removals and
description changes therefore republish the catalogue without a chokidar
dependency, and the activation tool invalidates directly and synchronously.

### 6. Project-local layer

No migration. DSH's native filesystem provider already serves `.dsh/skills` and
`.agents/skills` ahead of us by rank, so nearest-scope wins is inherited. The
handoff keeps copying the curated subset into `.github/skills`; a project that
wants to override a harness skill drops its own copy in `.dsh/skills`.
`find_skills` reports native project skills so the two layers are visible
together.

## Implementation

| # | Deliverable | Path |
|---|---|---|
| 1 | Frontmatter parser (DSH subset, zero dependencies) | `dsh/skills/frontmatter.js` |
| 2 | Bounded workspace scanner | `dsh/skills/scan.js` |
| 3 | Library index, native-layer discovery, fingerprint | `dsh/skills/library.js` |
| 4 | Capability vocabulary and bindings | `dsh/skills/capabilities.json` |
| 5 | Evidence detectors and composition resolver | `dsh/skills/composition.js` |
| 6 | Activation state read/write, path-contained | `dsh/skills/state.js` |
| 7 | Thin DSH wiring: provider, three new tools | `dsh/index.js` |
| 8 | Frontmatter on every library skill | `.github/skills/**` |
| 9 | Composed presets | `dsh/specialists/*.json` |
| 10 | `find-skills` body rewritten for the loop | `.github/skills/find-skills/SKILL.md` |
| 11 | Metadata verify gate | `scripts/skills-verify.js`, `skills:verify` script |
| 12 | Real unit tests over the modules | `test/skill-architecture.test.js` |
| 13 | ADR, integration doc, index, current state | `docs/**` |

All logic lives in `dsh/skills/*.js` with no external imports, so tests exercise
real behaviour instead of grepping the adapter for strings. `dsh/index.js`
becomes thin wiring, which is the only part that needs a live DSH host.

## Proof condition

- `npm test` green, including new frontmatter, composition, activation,
  provider-contract and metadata-integrity tests.
- `npm run skills:verify` passes and fails loudly on a skill missing
  frontmatter, a non-kebab name, a duplicate name, or a capability/preset that
  references a skill that does not exist.
- Every library skill has a routing description that is not its H1.
- WordPress and Prospecting compose core + specialist + capabilities, and
  WordPress-only capabilities are absent from a Python workspace.
- `control.invalidate()` is reachable from the activation tool and from a
  changed fingerprint.
- `npm run control:verify` passes; current state, ADR and indices agree.
- Version-control state is known and recoverable on the feature branch.

## Known boundaries

- No live DSH session is started; the provider contract is proven against a stub
  host that implements `registerProvider`, `list`/`get`, `effect` and the events
  surface. Live acceptance stays a separate step, as it already was.
- Skill activation is workspace state, not product state: the adapter writes only
  `.harness/state/skills.json`, which the harness already owns.
- `scripts/optimize-skills.js` (NVIDIA/OpenAI nightly skill rewriting) stays out
  of scope and is not on any execution path.

## Reconciliation with main (PR #6 and PR #8)

This branch was originally cut from 925ce01. Main has since advanced with PR #6
(DSH quick-check docs) and PR #8 (`fix/session-workspace-routing`), and this branch
has been rebased onto 44eb167.

PR #8 independently fixed the same workspace-sensitivity gap from the other
direction: it made the tools follow `exec.agent.session.header.cwd` and gave the
provider `options.cwd`. Its contract is now part of main, and this branch satisfies
it rather than duplicating it:

| PR #8 contract | How this branch satisfies it |
|---|---|
| `project_root` + `project_root_source` on tool output | `selectWorkspace()` returns provenance; resume, inventory, specialist and catalogue all report it |
| An invalid session cwd fails closed with `WORKSPACE_NOT_FOUND` | `resolveWorkspace()` validates the selection; there is no silent fallback to `projectRoot` |
| `get()` refuses a candidate outside the current workspace | `get()` rebuilds the plan and requires the candidate's name and locator to be in it |
| `test/dsh-workspace-routing.test.js` | Passes with no assertion changed; only its `data:`-URL loader gained two relative-import rewrites, because this branch's adapter delegates to `dsh/skills/plan.js` |

Three earlier decisions in this plan were confirmed by PR #8 and kept: session cwd
wins over configuration, the provider is the right boundary for workspace
sensitivity, and the configured root is a fallback rather than the primary source of
identity.

One earlier decision was corrected by PR #8's regression test: this branch had
`get()` accept any candidate inside a library root, which let a skill resolved for
one workspace load in another. It now scopes by the composed plan.

## Divergent implementation

`origin/feat/skill-architecture-v2` (213b65c) is a separate phase-one
implementation of the same goal, built on PR #8. The two are not reconciled and
should not be merged together. See `docs/CURRENT-STATE.md` for the comparison and
ADR-0005 for the reasoning behind this branch's choices.

## Merged from the parallel branch (2026-09-17)

Review chose "merge the best of both onto this branch". Two ideas were ported from
`origin/feat/skill-architecture-v2`:

1. **Layer vocabulary.** `tier` was renamed to `layer`, and `tier` is accepted as a
   legacy alias with `layer` winning. This matches the vocabulary in this plan and in
   the parallel branch, and leaves one name for the concept.
2. **A package-owned catalog with strict validation.** `dsh/skill-catalog.json` is
   generated from frontmatter by `npm run skills:catalog` and checked byte-fresh by
   `npm run skills:verify`. The parallel branch hand-authored this file, which makes it
   a second source of truth; generating it removes that drift, and validating it in CI
   makes a stale catalog a failure rather than a silent inconsistency.

Deliberately not ported is the parallel branch's composition model: it returns all 21
catalog entries to every session and marks specialist fits with
`metadata.recommended`. DSH renders only `name` and `description` into the model-facing
catalogue (`packages/skill/tool-skill/src/index.ts`), so `metadata` never reaches the
model; the practical effect is a wider catalogue with no additional routing signal.
This branch keeps 12-14 evidence-bound skills plus the executable find/activate loop.

## Live verification and YAML conformance (2026-09-17)

The gap this plan recorded as a known boundary — "no live DSH session is started" — is
partly closed. `npm run dsh:verify` boots DeepSeek Harness's real skill registry, real
filesystem provider and real consumer-facing snapshot API and runs the provider against
them, then parses every shipped skill file through DSH's own provider and diffs the result
against this repository's parser.

The first run of the conformance probe found two real divergences (unquoted `#` comments,
and a leading `[` treated as text here but rejected by YAML). Both are fixed in
`dsh/skills/frontmatter.js`; the full check is 174 assertions across 39 cases and is now
part of `npm test` when a checkout is present.

What is still not covered: an end-to-end run inside a booted `dsh` profile with a live
model, which would consume provider credits and therefore needs the user's approval.
