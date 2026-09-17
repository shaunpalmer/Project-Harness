---
name: find-skills
description: "Use when a task needs a capability the visible catalogue does not cover: search the full Project Harness library with project_harness_find_skills, check DSH-native project and user skills, then search the installable skills.sh ecosystem with npx skills find."
whenToUse: "Use when the workspace needs a capability that may already exist as a harness or installable skill and the task is discovery, activation, or installation."
user-invocable: true
metadata:
  harness:
    tier: discovery
    topics: [skill-discovery, cli-automation, dependency-control]
    tags: [skills, discovery, activation, npx, ecosystem]
    stack: []
---

# SKILL: Find Skills

## Purpose

Find the right instructions before writing your own. The model-facing skill
catalogue is deliberately small: Project Harness composes only the skills your
workspace evidence justifies. This skill is the route to everything else.

Never hand-write guidance that an existing skill already owns, and never assume
a capability is missing just because it is not in the current catalogue.

## The discovery ladder

Work down the rungs. Stop at the first rung that answers the need.

### Rung 1 — What is already visible

Call `project_harness_skill_catalog`. It reports the composed skills, the tier
that selected each one, the capabilities workspace evidence proved, and anything
the workspace activated or suppressed. If the capability is already listed, stop
and load it with the `skill` tool.

### Rung 2 — The full Project Harness library

Call `project_harness_find_skills` with a description of what the task needs,
not a skill name. It searches every harness skill's name, description,
`whenToUse`, tags, topics and stack — far more than the catalogue shows.

```text
project_harness_find_skills({ query: "database migrations", limit: 8 })
```

Each match reports whether it is `currently_visible`. A match with
`currently_visible: false` is real, relevant, and not yet in your catalogue.

### Rung 3 — Activate, then load

Promote a match into the catalogue, then load it normally:

```text
project_harness_activate_skills({ name: "database-design", action: "activate" })
```

Activation records the decision in `.harness/state/skills.json` and tells DSH to
republish the model-facing catalogue, so the skill becomes loadable with the
`skill` tool. Use it when the workspace genuinely needs the capability for the
work ahead — not to preload the library "just in case".

Use `action: "deactivate"` to suppress a skill that evidence selected but this
workspace does not want. Use `action: "reset"` to clear both lists.

### Rung 4 — DSH-native project and user skills

`project_harness_find_skills` also reports `dsh_native_skills` found in
`<project>/.dsh/skills`, `<project>/.agents/skills`, `~/.dsh/skills` and
`~/.agents/skills`. DSH serves those roots in a nearer layer than Project
Harness, so a same-name project skill **shadows** the harness version. If one
exists, use it and do not overwrite or duplicate it.

When a project needs a lasting local override, the right place is
`<project>/.dsh/skills/<name>/SKILL.md` with DSH frontmatter: DSH discovers it
natively, and `find_skills` reports it as `shadows_harness_skill: true`.

### Rung 5 — The open skill ecosystem

Only when rungs 1-4 have nothing. The Skills CLI (`npx skills`) is the package
manager for the open agent skills ecosystem. Browse at https://skills.sh/.

```bash
npx skills find [query] [--owner <owner>]
npx skills add <package>
npx skills update
```

Check the [skills.sh leaderboard](https://skills.sh/) before searching: it ranks
by total installs, which surfaces the most battle-tested options. Well-known
sources include `vercel-labs/agent-skills` (React, Next.js, web design) and
`anthropics/skills` (frontend design, document processing).

**Do not recommend a skill from search results alone.** Verify:

1. **Install count** — prefer 1K+. Be cautious below 100.
2. **Source reputation** — official sources (`vercel-labs`, `anthropics`,
   `microsoft`) over unknown authors.
3. **Repository stars** — treat a source repo under roughly 100 stars with
   skepticism.

Present the name, what it does, the install count, the source, the install
command and a link, then offer to install:

```bash
npx skills add <owner/repo@skill> -g -y
```

`-g` installs at user level and `-y` skips confirmation. Installing a
third-party skill is a dependency addition: run the complexity brake first and
let the user make the call.

### Rung 6 — Nothing fits

Say so plainly, then do the work with general capability. If the need will
recur, propose a new skill in the harness library rather than repeating ad-hoc
instructions: add `.github/skills/<name>/SKILL.md` with DSH frontmatter
(`name`, `description`, `whenToUse`, `metadata.harness.tier`) and bind it to a
capability in `dsh/skills/capabilities.json`. Run `npm run skills:verify`.

## Common capability categories

| Category | Example queries |
| --- | --- |
| Web development | react, nextjs, typescript, css, tailwind |
| Testing | testing, jest, playwright, e2e |
| DevOps | deploy, docker, kubernetes, ci-cd |
| Documentation | docs, readme, changelog, api-docs |
| Code quality | review, lint, refactor, best-practices |
| Design | ui, ux, design-system, accessibility |
| Productivity | workflow, automation, git |

## Final rule

**Search before you write. Compose a narrow catalogue from evidence, then widen
it deliberately with `find` and `activate`.** A skill you never found is a skill
you paid for and did not use.
