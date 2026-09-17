---
name: find-skills
description: Discover an installed or external agent skill when the current catalog does not cover the requested capability, then guide safe installation into a DeepSeek Harness-visible project or user skill layer.
---

# Find Skills

Use this skill as the capability escape hatch when the current Project Harness / DSH skill catalog does not already cover the task well enough.

## Core Rule

**Check what is already available before searching outside the harness.**

DeepSeek Harness merges skills from multiple providers and scopes into one catalog and loads full skill bodies only on demand. Do not install a duplicate merely because its instructions are not already loaded into the conversation.

## When to Use

Use this skill when the user:

- asks for a capability that is not clearly covered by the visible skill catalog;
- asks to find, add, install, or compare skills;
- asks "is there a skill for X?" or "can the harness learn X?";
- needs a specialised workflow that would be better as reusable instructions than one-off prompting;
- wants to expand the harness without hard-coding another specialist.

Do not use external discovery when an existing visible skill already matches the task.

## DeepSeek Harness Skill Layers

Treat skill availability as layered:

1. **Project Harness packaged provider** — curated global skills shipped by Project Harness.
2. **Preset / agent scope** — nearer DSH composition layers can shadow a global skill with the same name.
3. **Project-local DSH skills** — `.dsh/skills/` and `.agents/skills/` discovered from the current project root.
4. **User skills** — DSH/user agent roots available across projects.
5. **External ecosystem** — use the Skills CLI only when the merged local catalog still lacks the capability.

Nearest DSH scope wins for duplicate skill names. Do not build a second precedence system inside this skill.

## Discovery Workflow

### Step 1: Inspect the Current Catalog

Before using the network or CLI, determine whether a currently visible skill already matches the task by name and description.

Prefer an existing skill when it is sufficiently relevant. Remember that the catalog advertises compact routing metadata; the full body is loaded only when invoked.

### Step 2: Define the Missing Capability

If no existing skill fits, identify:

- domain;
- concrete task;
- expected tools or workflow;
- whether the capability should be project-local or reusable across projects.

Search for the capability, not the current implementation detail alone.

### Step 3: Search the Skills Ecosystem

The open Skills CLI can search and install reusable Agent Skills.

```bash
npx skills find <query>
```

Useful examples:

```bash
npx skills find wordpress testing
npx skills find playwright accessibility
npx skills find api security review
npx skills find github release notes
```

Browse the ecosystem at `https://skills.sh/` when interactive comparison is useful.

### Step 4: Verify Before Recommending

Do not install a skill solely because it appears in search results.

Check, where available:

- source repository and maintainer;
- install/use history;
- repository activity and quality;
- `SKILL.md` contents and instructions;
- unexpected scripts, hooks, tool permissions, or external dependencies;
- overlap with skills already available in DSH.

A skill is instructions with operational influence. Treat unfamiliar skills as code-adjacent dependencies, not harmless prose.

### Step 5: Prefer DSH-Visible Installation Targets

For **project-local** additions, prefer a path DSH natively scans, especially `.agents/skills/` or `.dsh/skills/`.

The Skills CLI supports agents whose project path is `.agents/skills/`. When using the CLI, verify the selected target path before considering the install complete.

Example project-local workflow:

```bash
npx skills add <owner/repo> --skill <skill-name> -a universal
```

Then verify that the installed skill is visible under the current project's `.agents/skills/` (or deliberately move/copy it to a DSH-supported project skill root when required).

For **user-wide** skills, install only with explicit user approval and verify the destination is a user root DSH actually scans. Do not assume every CLI agent's global directory is visible to DSH.

### Step 6: Let DSH Discover It

Do not wire newly installed project/user skills into Project Harness specialist code unless the capability is becoming part of the curated Project Harness distribution.

DSH's native filesystem provider is responsible for project/user discovery, precedence, watching, and catalog invalidation. Project Harness should remain a separate global provider.

### Step 7: Promote Only Proven Skills

If a discovered skill becomes repeatedly useful across Project Harness projects, consider promoting it into the packaged Project Harness skill catalog in a later controlled change.

Promotion should include:

- a stable name;
- concise routing description;
- maintained source/path;
- intended Project Harness layer (`core`, `specialist`, `capability`, or `discovery`);
- invocation policy;
- regression coverage.

## Skills CLI Reference

Common commands:

```bash
# Search
npx skills find <query>

# Inspect available skills from a source
npx skills add <owner/repo> --list

# Add one selected skill
npx skills add <owner/repo> --skill <skill-name>

# Update installed skills
npx skills update
```

Use non-interactive flags only when the user has already authorised the install and the destination is understood.

## When No Suitable Skill Exists

If no appropriate skill is found:

1. say that the catalog and external search did not produce a suitable match;
2. continue using normal reasoning/tools when the task can still be completed safely;
3. if the workflow is recurring, propose creating a focused Project Harness skill rather than adding vague instructions to a general skill.

## Design Principle

`find-skills` should make the skill system extensible without making the Project Harness router enormous.

**Specialists recommend. The DSH registry merges. `find-skills` discovers. Full skill bodies load only when needed.**
