# DeepSeek Harness integration

Project Harness is also an installable DeepSeek Harness (DSH) bundle. The bundle adds a read-only `project_harness_resume` tool to the selected DSH profile.

## What the first bundle does

The first integration deliberately exposes the compact Project Harness state, the first specialist selector, and a native DSH skill layer:

- active task state;
- current-state and North Star presence;
- system-model confirmation;
- architecture-hypothesis acceptance.
- WordPress evidence detection and the `wordpress-coding` preset.
- Python/prospecting evidence detection and the `python-prospecting` preset.
- Specialist skills through DSH's on-demand `ctx.skills` registry. The model sees short summaries first and loads the full Markdown only when it invokes a selected skill.

It does not write files, execute shell commands, change Git state, or deploy anything. Generated projects remain separate from the Project Harness source repository.

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

The next integration slice will map existing project planning files into Project Harness memory without overwriting them. Additional specialists will use the same provider boundary rather than copying domain instructions into a universal prompt.
