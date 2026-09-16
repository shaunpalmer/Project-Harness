# DeepSeek Harness integration

Project Harness is also an installable DeepSeek Harness (DSH) bundle. The bundle adds a read-only `project_harness_resume` tool to the selected DSH profile.

## What the first bundle does

The first integration deliberately exposes the compact Project Harness state, the first specialist selector, and a native DSH skill layer:

- active task state;
- bounded purpose, invariants, current truth and next action, with source paths;
- accepted decision summaries and advisory Git-snapshot freshness evidence;
- system-model confirmation;
- architecture-hypothesis acceptance.
- WordPress evidence detection and the `wordpress-coding` preset.
- Python/prospecting evidence detection and the `python-prospecting` preset.
- Specialist skills through DSH's on-demand `ctx.skills` registry. The model sees short summaries first and loads the full Markdown only when it invokes a selected skill.

It does not write project files, run a shell, change Git state, or deploy anything.
Resume invokes bounded, read-only Git queries with optional locks disabled for
freshness evidence; missing Git produces a warning, not an installation attempt.
Generated projects remain separate from the Project Harness source repository.

## Install from this repository

From the directory containing the checkout, add the bundle to a DSH profile:

`dsh plugin --profile <profile> add github:shaunpalmer/Project-Harness`

The `--dump-config` option is only a diagnostic tool; it is not required for normal startup. Start DSH normally after installation:

`dsh web`

Before starting DSH, explicitly select the project workspace. For example:

`export PROJECT_HARNESS_ROOT=/path/to/the/selected-project`

The bundle refuses to use an unset workspace, a missing directory, or the DeepSeek Harness source checkout itself. This prevents the runtime repository from being mistaken for the project being managed. The same value can be supplied through the profile's `projectRoot` setting when a persistent profile configuration is preferred.

## Design boundary

DSH owns the runtime composition, model connection, and tool registry. Project Harness owns planning, memory, specialist routing, project boundaries, and verification. The integration is an adapter between those boundaries, not a replacement for either system.

Existing project notes can be mapped through `.harness/memory.json` without copying
or overwriting them; see `docs/PROJECT-CONTROL.md`. Additional specialists should
use the same provider boundary rather than copying domain instructions into a universal prompt.

The adapter retains `ctx.tools.register(defineTool(...))` and the existing string
output contract. See the upstream [tool-authoring reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md).
Handler fixture tests stub host APIs; they do not replace a live DSH acceptance run.

Package snapshots (`*.tgz`) are excluded from the next package preview so an old
local archive cannot be nested inside a newer installable bundle.
