# DeepSeek Harness integration

Project Harness is also an installable DeepSeek Harness (DSH) bundle. The bundle adds a read-only `project_harness_resume` tool to the selected DSH profile.

## What the first bundle does

The first integration deliberately exposes the compact Project Harness state and the first specialist selector:

- active task state;
- current-state and North Star presence;
- system-model confirmation;
- architecture-hypothesis acceptance.
- WordPress evidence detection and the `wordpress-coding` preset.

It does not write files, execute shell commands, change Git state, or deploy anything. Generated projects remain separate from the Project Harness source repository.

## Install from this repository

From the directory containing the checkout, add the bundle to a DSH profile:

`dsh plugin --profile <profile> add github:shaunpalmer/Project-Harness`

Then inspect the composed configuration:

`dsh --profile <profile> --dump-config`

The profile's working directory is used as the default Project Harness workspace. To select another workspace, set `PROJECT_HARNESS_ROOT` before starting DSH, or override `projectRoot` in the profile's `cordis.patch.yml`.

## Design boundary

DSH owns the runtime composition, model connection, and tool registry. Project Harness owns planning, memory, specialist routing, project boundaries, and verification. The integration is an adapter between those boundaries, not a replacement for either system.

The next integration slice will add explicit project-state commands and the remaining coding specialists, beginning with scraping and Python automation.
