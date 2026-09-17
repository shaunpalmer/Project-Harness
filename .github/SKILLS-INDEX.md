# Skills Index

Project Harness skill library, composed for DeepSeek Harness (DSH).

This file is a human reference. The model never sees it: DSH renders only each skill's
`name` and `description`, and Project Harness composes which of them are visible from
workspace evidence. The machine-readable truth lives in the skill frontmatter and in
`dsh/skills/capabilities.json`; run `npm run skills:verify` after any change.

## How composition works

```
visible = core ∪ discovery
        ∪ specialist_skills                 (when a specialist matches)
        ∪ default_capabilities    → skills  (when a specialist matches)
        ∪ evidence-bound capabilities → skills
        ∪ activated skills                   (.harness/state/skills.json)
        − suppressed skills                  (.harness/state/skills.json)
```

`find-skills` is always visible and is the route to everything not composed.
DSH layers the catalogue: a skill in `<project>/.dsh/skills` or `~/.dsh/skills` shadows
the harness version of the same name, because harness skills rank 600 and those roots
rank 100-500.

## Core controls (always composed)

| Skill | What it does | Bound by |
| --- | --- | --- |
| `complexity-brake` | Use before adding files, classes, dependencies, tables or build tooling: climb the minimum-code ladder, reuse existing project and platform APIs, and mark shaun-debt with an explicit upgrade trigger. | — |
| `loop-controller` | Use when running a significant task: plan success criteria, execute the smallest safe increment, verify with tests or Chrome DevTools MCP, score Success/Partial/Failure, and escalate after three failed attempts. | — |
| `project-memory` | Use at session entry, before compaction or on doc/code conflict: run memory:resume and memory:checkpoint, inspect .harness/state/active-task.json, supersede stale ADRs, and reconcile CURRENT-STATE without secrets. | — |
| `skill-router` | Use when choosing which skills to load: read the system model, engineering defaults and active phase, extract capabilities, apply deterministic bindings, exclude irrelevant skills, and emit a Skill Load Plan. | — |

## Discovery (always composed)

| Skill | What it does | Bound by |
| --- | --- | --- |
| `find-skills` | Use when a task needs a capability the visible catalogue does not cover: search the full Project Harness library with project_harness_find_skills, check DSH-native project and user skills, then search the installable skills.sh ecosystem with npx skills find. | — |

## Specialists (composed when the workspace matches)

### `generic`

No specialist skills of its own; it supplies the base capability scope.

Capabilities in scope: `testing`, `database`, `api`, `ui`, `browser`, `oop`, `scraping`, `planning`, `docs`.
Always composed: `testing`.

### `wordpress-coding`

| Skill | What it does |
| --- | --- |
| `wordpress-plugin` | Use when building or reviewing a WordPress plugin: keep the root file thin, register hooks and activation/deactivation, use $wpdb->prepare and dbDelta, register_rest_route, and enqueue scoped assets. |
| `wordpress-way` | Use when writing WordPress PHP: apply WPCS naming, prefer core APIs such as WP_Query and the Options/Transients APIs, sanitise input, escape output, verify nonces and capabilities, and prepare $wpdb SQL. |

Capabilities in scope: `database`, `api`, `ui`, `browser`, `testing`, `oop`, `docs`, `planning`.
Always composed: `testing`.

### `python-prospecting`

| Skill | What it does |
| --- | --- |
| `scraping-pipeline` | Use when the system acquires data from websites or APIs: map acquire/parse/validate/dedupe/enrich/load stages, prefer official APIs, guard rate limits and paid calls, and prove idempotent reruns end to end. |

Capabilities in scope: `api`, `database`, `testing`, `logging`, `browser`, `oop`, `docs`, `planning`.
Always composed: `testing`, `logging`.

## Capabilities (composed when workspace evidence proves them)

| Capability | Skills | Evidence that binds it |
| --- | --- | --- |
| `testing` | `testing-plan` | `tests-present` |
| `database` | `database-selection`, `database-design` | `persistence-surface` |
| `api` | `api-design` | `api-surface` |
| `ui` | `interface-design` | `presentation-surface` |
| `browser` | `chrome-devtools-mcp` | `browser-dependency` |
| `oop` | `oop-standards` | `class-declarations` |
| `scraping` | `scraping-pipeline` | `scraper-sources` |
| `logging` | `trace-eval-logging` | activation or preset default only |
| `planning` | `prd-writer`, `architecture-canvas`, `stack-selector` | `planning-artifacts` |
| `review` | `code-review` | activation or preset default only |
| `docs` | `documentation` | `docs-present` |
| `memory` | `memory-consolidation` | activation or preset default only |
| `delegation` | `sub-agent-delegation` | activation or preset default only |
| `initiative` | `agent-initiative` | activation or preset default only |
| `debugging` | `guard-debugging` | activation or preset default only |

## Reference rule sets (model-only, never human-invocable)

| Skill | What it does |
| --- | --- |
| `agent-initiative` | Use when blocked or unsure: walk the initiative ladder, infer from project files and defaults, record reversible assumptions, defer non-blocking decisions, and patch bugs in place rather than rewriting files. |
| `guard-debugging` | Use when a failure or regression appears: forbids deleting or replacing source files, requires reading the file, logging a .debug-session record, then applying surgical patches that preserve architecture. |
| `oop-standards` | Use when designing, refactoring or reviewing classes, services, repositories or adapters: apply SOLID and the four pillars, justify each pattern, and enforce PHP/WordPress, TypeScript and Python standards. |

## Reachable only through find + activate

These are found with `project_harness_find_skills` and then activated:

- `agent-initiative` — Use when blocked or unsure: walk the initiative ladder, infer from project files and defaults, record reversible assumptions, defer non-blocking decisions, and patch bugs in place rather than rewriting files.
- `code-review` — Use when reviewing a diff or PR before merge: run L1/L2/L3 checks for correctness, edge cases, secrets, injection, auth, architecture compliance and N+1 queries, and tag findings MUST/SHOULD/NIT/QUESTION.
- `guard-debugging` — Use when a failure or regression appears: forbids deleting or replacing source files, requires reading the file, logging a .debug-session record, then applying surgical patches that preserve architecture.
- `memory-consolidation` — Use when AI-NOTES.md grows past roughly 200 lines or a phase ends: extract decisions, reusable patterns and anti-patterns, promote them into accepted ADRs and notes, and archive raw entries to cut context bloat.
- `sub-agent-delegation` — Use when a task benefits from parallel or specialized sub-agents: define each role, scope, inputs and success criteria, keep a master trace, cap concurrency at three, and integrate only after verified reports.

## Adding a skill

1. Add `.github/skills/<name>/SKILL.md` with DSH frontmatter: `name`, `description`
   (the routing surface — one sentence naming the capability and its trigger),
   `whenToUse`, optional `user-invocable: false` for a model-only rule set, and
   `metadata.harness` with `tier`, `topics`, `tags`, `stack`.
2. Bind it in `dsh/skills/capabilities.json` under the capability it serves, or add it
   to a preset's `specialist_skills` in `dsh/specialists/`.
3. Run `npm run skills:verify`.

**Skills in library:** 25. **Last verified:** 2026-09-17.
