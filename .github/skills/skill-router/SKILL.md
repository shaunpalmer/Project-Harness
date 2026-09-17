---
name: skill-router
description: "Use when choosing which skills to load: read the system model, engineering defaults and active phase, extract capabilities, apply deterministic bindings, exclude irrelevant skills, and emit a Skill Load Plan."
whenToUse: "Use when the workspace has a confirmed system model and the task is to decide required, conditional, and excluded skills for the current phase."
user-invocable: true
metadata:
  harness:
    tier: core
    topics: [skill-discovery, planning, architecture]
    tags: [skills, routing, planning, capabilities, bindings]
    stack: []
---
# SKILL: Skill Router

## Purpose

Select the smallest specialist skill set from the confirmed system model and current phase. Do not choose skills from a project-type label alone, and do not ask the user to activate skills that the evidence already makes mandatory.

## Inputs

Read:

1. `ENGINEERING-DEFAULTS.md`
2. `PROJECT-INTAKE.md`
3. `00-PLANNING/SYSTEM-MODEL.md`
4. `00-PLANNING/ARCHITECTURE-HYPOTHESIS.md`
5. active task / current phase
6. relevant accepted decisions
7. existing repository configuration and conventions

## Routing method

### 1. Identify capabilities

Extract responsibilities from the system model, for example:

- WordPress runtime
- scraping / parsing
- browser automation
- API integration
- persistent state
- database selection/design
- interface design
- testing
- security
- packaging/deployment
- Linux/Windows automation
- CLI or scheduled execution

### 2. Apply deterministic bindings

These bindings are routine decisions and require no user question when the evidence is clear:

| Confirmed capability | Required/default skill or rule |
|---|---|
| WordPress runtime/plugin/theme | `wordpress-way.md` + `wordpress-plugin/SKILL.md` |
| Scraping/crawling/parsing/ingestion | `scraping-pipeline/SKILL.md` |
| Significant OOP/service architecture | `oop-standards.md` when classes/interfaces are actually justified |
| Architecture selection or major boundary work | `architecture-canvas/SKILL.md` |
| Complexity/dependency expansion | `complexity-brake/SKILL.md` |
| Project resume/checkpoint/pivot | `project-memory/SKILL.md` |

A capability can bind several skills. A skill is not a substitute for the confirmed system model.

### 3. Separate required, conditional, and excluded skills

Load a skill only when a current responsibility or proof depends on it. Exclude unrelated skills explicitly to prevent context bloat and pattern mixing.

Required skills are loaded automatically. Do **not** ask, "Should I activate the WordPress skill?" when the system is demonstrably WordPress.

Conditional skills activate only when their trigger becomes true. For example, do not load database-design guidance merely because a plugin might someday need storage.

### 4. Respect phase

Planning/architecture may load rules needed to reason about a capability, but build/review/repair skills should activate only when there is an artifact or accepted hypothesis to work on.

### 5. Respect rule precedence

Use this precedence:

1. existing project config + accepted ADRs;
2. confirmed system-model evidence + accepted architecture hypothesis;
3. ecosystem-specific skill;
4. `ENGINEERING-DEFAULTS.md`;
5. generic preference.

If a repository already establishes a language, formatter, framework, or test stack, preserve it unless there is evidence for a consequential change.

### 6. Enforce the question budget

Routine engineering question budget is zero. Before asking the user anything about skill selection, language, naming, OOP/procedural style, test organisation, or normal framework conventions, verify that the answer is not already determined by the evidence or defaults.

Ask only when the missing answer belongs to the user under `docs/DECISION-RIGHTS.md` or a material ambiguity survives repository inspection and bounded proof.

### 7. Define the promotion gate

Every skill load plan names:

- candidate artifact;
- verification method;
- failure evidence;
- repair rule;
- promotion condition.

## DSH composition and discovery

Under DeepSeek Harness the router does not start from a blank sheet. Project
Harness already composes a catalogue for the workspace and registers it with
DSH's layered skill registry:

```text
core controls + find-skills + specialist skills + evidence-bound capability skills
```

So the DSH order of operations is:

1. `project_harness_skill_catalog` — see what is already visible, at which tier,
   and why. Treat this as steps 1-3 of the routing method already performed.
2. Route within the visible set: required, conditional, excluded.
3. If a responsibility has no visible skill, `project_harness_find_skills` to
   search the whole library, then `project_harness_activate_skills` to promote
   the match. Do not hand-write guidance the library already owns.
4. Report anything promoted or excluded, so the workspace catalogue and the
   skill load plan agree.

Two rules follow from this:

- **Do not re-derive composition by hand.** If the catalogue lacks something the
  system model proves is required, widen it with `find` + `activate` rather than
  reciting the skill's rules from memory.
- **A capability is justified by evidence, not by the catalogue's silence.** An
  absent skill means "not composed", not "not applicable".

Adding a skill to the layering is a data change, not a code change: add
`.github/skills/<name>/SKILL.md` with DSH frontmatter, then bind it in
`dsh/skills/capabilities.json` (shared capability) or a preset under
`dsh/specialists/` (domain specialist). `npm run skills:verify` fails on a
missing binding, an unknown evidence token, or a skill no path can reach.

## Output template

```md
# Skill Load Plan

## System shape
Primary shape: ...
Confidence: ...
Capabilities: ...

## Current phase
...

## Required skills
| Skill | Evidence-backed reason |
|---|---|

## Conditional skills
| Skill | Activate when |
|---|---|

## Excluded skills
| Skill | Why excluded |
|---|---|

## Promotion gate
Candidate artifact: ...
Verification: ...
Failure evidence: ...
Repair rule: repair in place
Promotion condition: ...
```

## Final rule

**Compose skills from responsibilities. Automatically bind ecosystem rules when evidence is decisive. Project presets accelerate recognition; they do not replace evidence or force architecture.**
