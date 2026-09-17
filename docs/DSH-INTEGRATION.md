# DeepSeek Harness integration

Project Harness is also an installable DeepSeek Harness (DSH) bundle. It contributes
read-only project-memory tools, evidence-based specialist selection, and a composed
skill catalogue registered through DSH's native `ctx.skills` provider seam.

## What the bundle provides

Tools:

| Tool | Purpose | Writes |
| --- | --- | --- |
| `project_harness_resume` | Compact workspace memory, discovery status, active task, freshness evidence | No |
| `project_harness_inventory` | Workspace inventory and possible memory sources | No |
| `project_harness_select_specialist` | Specialist selection from workspace evidence | No |
| `project_harness_skill_catalog` | The visible skill catalogue, its layers, detected capabilities and activation state | No |
| `project_harness_find_skills` | Search the full skill library and DSH-native project/user skills | No |
| `project_harness_activate_skills` | Activate, deactivate or reset one skill for this workspace | `.harness/state/skills.json` only |

The resume tool reports:

- active task state;
- bounded purpose, invariants, current truth and next action, with source paths;
- accepted decision summaries and advisory Git-snapshot freshness evidence;
- system-model confirmation and architecture-hypothesis acceptance.

The skill layer:

- every skill in `.github/skills` carries DSH-native frontmatter, so the library is
  valid input for DSH's own filesystem provider as well as for the bundle;
- the model sees only `name` and `description` summaries, and loads a body only when
  it invokes a skill;
- a WordPress workspace composes the `wordpress-coding` specialist, and a Python
  data/prospecting workspace composes `python-prospecting`; every other coding
  workspace composes the `generic` scope;
- capabilities are bound by workspace evidence, so a WordPress project with a schema
  and a REST surface receives database and API guidance, and one without them does not;
- `find-skills` is always composed and is the route to the rest of the library,
  through `find_skills` then `activate_skills`;
- the catalogue is kept fresh by a stat poll, the `fs/observed` host-mutation
  recorder, and explicit invalidation after activation.

Every response names the resolved workspace in `project_root` and its provenance in
`project_root_source` (`session-cwd` or `configured-fallback`), so a surprising result
can be traced to the session or to the configured fallback.

## Quick workspace checks

Use these DSH tools after selecting a workspace, installing or reinstalling the
bundle, moving a project folder, or starting work on a pre-existing project.

| Order | DSH tool | Purpose | Expected write behaviour |
|---|---|---|---|
| 1 | `project_harness_inventory` | Lists the selected project root, top-level files, and likely memory sources. | Read-only; reports `writes_performed: false`. |
| 2 | `project_harness_resume` | Loads compact Project Harness memory, decisions, active task, and freshness warnings. | Read-only; reports `writes_performed: false`. |
| 3 | `project_harness_select_specialist` | Detects whether the workspace should use a specialist preset such as WordPress or Python/prospecting. | Read-only; reports `writes_performed: false`. |
| 4 | `project_harness_skill_catalog` | Shows the composed skill catalogue, why each skill is visible, and which evidence bound it. | Read-only; reports `writes_performed: false`. |

Suggested fresh-session prompt:

```text
Read-only diagnostic. Run project_harness_inventory, then project_harness_resume,
then project_harness_select_specialist, then project_harness_skill_catalog for the
selected workspace. Do not initialise or modify project files. Return the exact
results and flag any freshness or workspace-boundary warnings.
```

For an existing project, run `project_harness_inventory` before assuming Project
Harness files are present. If resume memory is missing, stale, or points at another
repository, treat that as a setup/reconciliation task rather than creating files
automatically. If `project_harness_select_specialist` returns a specialist, use it as
routing evidence before starting implementation.

## Tool contract

Each tool returns **one canonical JSON value** and declares DSH's `json` author spec
(`{ type: 'json' }`), which normalizes to the unconstrained JSON Schema node. `render`
owns the model-facing projection, so the model reads the same formatted text as before,
while a programmatic caller — PTC mode reaches these as `await tools.<name>(args)` —
receives structured fields instead of having to parse a JSON string. Returning a string
root would be the documented anti-pattern: `docs/cookbook/adding-a-tool.md` requires a tool
to "declare and return one canonical JSON value" and not to "make callers parse prose for
ids and fields".

The output schema never reaches the model: `ctx.tools.schemas()` projects only `name`,
`description` and `parameters`, so structuring the canonical value cannot change what the
model reads. The live probe asserts that projection and reads the registered definition
back to confirm all six tools are unconstrained rather than string-rooted.

The plugin entry keeps the namespace export shape (`name`/`inject`/`Config`/`apply`) with no
default export. The cordis Loader's `unwrapExports` prefers `.default` over the namespace, so
a stray `export default apply` would silently discard `inject` and load the plugin into a
fiber with no services — a failure that unit coverage cannot see
(`docs/postmortem/0001-acp-default-export-drops-inject.md`). `docs/testing.md` therefore
requires an explicit no-default assertion plus an `unwrapExports` round trip, and the probe
carries both, including an assertion that the regression actually breaks the round trip.

## Scope of writes

Resume, inventory, specialist selection, the catalogue and search are read-only.

Activation writes exactly one file, `.harness/state/skills.json`, inside the
selected workspace, and only when the model or the user calls
`project_harness_activate_skills`. The write is validated, path-contained and
atomic. No tool runs a shell, changes Git state, touches product source, or
deploys anything. Resume invokes bounded, read-only Git queries with optional
locks disabled for freshness evidence; missing Git produces a warning, not an
installation attempt. Generated projects remain separate from the Project Harness
source repository.

## Workspace selection

A calling DSH session owns project identity. Tools and the skill provider both resolve
the workspace from the session cwd, walking up to the nearest ancestor containing
`.git`, exactly as DSH's own filesystem skill provider does.

The configured root is only the fallback for a caller with no session cwd. An explicit
session cwd that is missing or invalid **fails closed** with `WORKSPACE_NOT_FOUND`
rather than silently falling back to a different project.

To pin a workspace explicitly, set it before starting DSH:

`export PROJECT_HARNESS_ROOT=/path/to/the/selected-project`

The same value can be supplied through the profile's `projectRoot` setting. The
bundle refuses to use a missing directory or the DeepSeek Harness source checkout
itself, so the runtime repository cannot be mistaken for the managed project. With
neither a cwd nor a configured root, the provider advertises no skills and says so
rather than guessing.

## Layering

Harness skills register at rank 600, DSH's `BUNDLED_SKILL_RANK`. Project roots
(`<project>/.dsh/skills` at 100, `<project>/.agents/skills` at 200) and user roots
(`~/.dsh/skills` at 400, `~/.agents/skills` at 500) rank ahead, so a project or
user skill of the same name shadows the harness version without Project Harness
implementing shadowing. `project_harness_find_skills` reports those native skills
so both layers stay visible.

The provider is workspace-scoped in both directions: `list()` composes only the current
workspace's catalogue, and `get()` refuses a candidate that the current workspace would
not have offered, so a skill resolved for one project cannot be loaded into another.

## Verification

Two gates cover this integration, and they cover different things.

`npm test` is hermetic: every other test in this repository stubs the DSH host, so it
proves the logic without depending on a checkout.

`npm run dsh:verify` runs the same provider against a **real** DeepSeek Harness
checkout — the real skill registry, the real filesystem provider and the real
consumer-facing snapshot API — and is the only coverage of the integration boundary.
It needs a checkout on disk (set `DSH_CHECKOUT` or pass `--dsh-root`) and exits non-zero
when it cannot find one rather than reporting a pass it did not earn. Without a checkout
its tests skip, so a hermetic clone still gets a green suite.

It asserts:

- composed catalogues per workspace (core, discovery, specialist, default and
  evidence-bound capabilities) and the exclusion of another specialist's skills;
- `snapshot().complete`, without which DSH holds the catalogue back;
- a project `<project>/.dsh/skills` entry shadowing the packaged skill of the same name,
  reported as `project-dsh`, which is the native layering this provider relies on;
- `get()` refusing a candidate the current workspace would not offer, in both directions;
- the find, activate, invalidate, republish round trip, including suppression;
- frontmatter **conformance**: every shipped skill and a table of edge cases parsed by
  DSH's own provider and compared field by field with this repository's parser.

That last item is what makes the portability claim true rather than asserted. The parser
accepts a YAML subset and refuses anything it cannot read identically to real YAML —
unquoted `#` comments are stripped, and block scalars, anchors, aliases, tags and flow
mappings are rejected instead of silently mis-read. `skills:verify` enforces the same
rules hermetically, and the conformance probe confirms the agreement against DSH itself.

## Package shape

Follow the documented bundle contract (`docs/user/develop/basic/publish.md`):

| Field | Value | Why |
| --- | --- | --- |
| `main` | `dsh/index.js` | The plugin entry the patch row names. |
| `dsh.bundle.patch` | `./cordis.patch.yml` | Declares this package as a bundle; without it `dsh plugin` installs it as a plain dependency and warns that it activated no layer. |
| `peerDependencies` | `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools` | Provided by the host at runtime. |
| `dependencies` | `@deepseek-ai/schemastery` | A runtime validator, so it is a dependency rather than a peer. |
| `files` | bundle surface plus the toolkit surface | Both are published; tests, docs, planning artifacts and `dsh/probes/` are development-only. |

No `prepare` script and no build step: the package ships plain JavaScript, so it installs
without the build permission a git-installed TypeScript plugin would need. `pnpm` reports
`@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` as missing peers because a profile lists
the host bundles rather than depending on them; the published `dsh-github-intelligence`
bundle reports the same two warnings, so this is inherent to an out-of-tree DSH bundle and
not a packaging fault.

## Verifying an installed bundle

`dsh:verify` also accepts `--package-root`, which points the probes at an installed copy
instead of this checkout. That is how the published artifact is checked, because a source
checkout can pass while the package is missing a file:

```sh
npm pack --pack-destination /tmp/phpack
dsh plugin --profile phcheck add /tmp/phpack/project-harness-0.4.2.tgz
node scripts/dsh-integration-check.js --package-root "$DSH_HOME/profiles/phcheck/node_modules/project-harness"
dsh --profile phcheck --dump-config | grep -A2 '== project-harness'
dsh plugin --profile phcheck remove project-harness
```

`--dump-config` should show a `# == project-harness` layer, which proves the bundle patch
composes into the profile. The probes then prove the installed package composes skills
from its own `.github/skills`. Both were run against this branch: 29 integration checks
and 174 conformance checks pass against the installed artifact, and the composed config
carries the expected layer.

## Configuration

| Key | Default | Purpose |
| --- | --- | --- |
| `projectRoot` | `$PROJECT_HARNESS_ROOT` or empty | Fallback workspace when a caller has no cwd |
| `skillWatchIntervalMs` | `2000` | Catalog stat-poll interval; `0` disables the poll |

## Design boundary

DSH owns the runtime composition, model connection, tool registry, skill registry
and catalogue rendering. Project Harness owns planning, memory, specialist routing,
skill composition, project boundaries and verification. The integration is an
adapter between those boundaries, not a replacement for either system.

Composition and discovery are data, not code. Adding a skill means adding
`.github/skills/<name>/SKILL.md` with DSH frontmatter and binding it in
`dsh/skills/capabilities.json` or a preset under `dsh/specialists/`. Then run
`npm run skills:catalog` and `npm run skills:verify`; the gate fails if any skill is
unreachable, any evidence token has no detector, any capability names a skill that
does not exist, or the generated `dsh/skill-catalog.json` is invalid or stale.
Frontmatter is the single source of truth, so a hand-edited catalog is never
authoritative. Nothing reads the catalog at runtime: it exists for review, tooling and
portability, and `layer` is the name for a skill's layer (`tier` still parses as a
legacy alias). Additional
specialists use the same provider boundary rather than copying domain instructions
into a universal prompt.

Existing project notes can be mapped through `.harness/memory.json` without copying
or overwriting them; see `docs/PROJECT-CONTROL.md`.

All routing logic lives in `dsh/skills/*.js` with no DSH imports, and `dsh/index.js`
is only `defineTool` wiring, so the provider is covered by unit tests against a stub
host. Handler fixture tests do not replace a live DSH acceptance run: installing this
branch's package and starting a fresh session remains a separate verification step.

The adapter uses `ctx.tools.register(defineTool(...))` and the existing string output
contract. See the upstream [tool-authoring reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md).

Package snapshots (`*.tgz`) are excluded from the next package preview so an old
local archive cannot be nested inside a newer installable bundle.
