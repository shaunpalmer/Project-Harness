# System Model

MODEL_STATUS: CONFIRMED

## Goal

Make the harness behave like an engineering operating system: infer routine technical defaults, bind mature ecosystem rules automatically, keep meaningful work under recoverable version control, and minimise questions to the user without sacrificing architecture quality.

## Inputs

- the user's natural-language project brief and feature list.
- Confirmed system-model evidence from the target project.
- Existing repository/runtime conventions and accepted ADRs.
- `ENGINEERING-DEFAULTS.md`.
- Ecosystem skills such as The WordPress Way and scraping-pipeline guidance.
- Local Git state and existing machine Git/GitHub authentication.

## Outputs

- Routine engineering choices resolved without user interruption.
- Deterministic skill binding for evidenced capabilities.
- Ecosystem-correct implementation defaults for WordPress, scraping, and automation work.
- Non-interactive Git preflight, safe work branches, focused checkpoints, remote verification, and authorised feature-branch pushes.
- A measurable quality target based on low question count, complete implementation, proof, and recoverability.

## Capabilities

- Engineering-default resolution with explicit precedence.
- Zero-question handling of routine implementation choices.
- WordPress-specific rule binding.
- Scraping/automation runtime defaults.
- Version-control preflight and repository initialisation.
- Safe branch management.
- Focused file staging and checkpoint commits.
- Existing-credential remote verification.
- Non-default branch push policy.
- Regression proof across supported Node versions.

## Data flow

Natural-language intent -> confirmed system model -> engineering defaults + required skills -> architecture hypothesis -> safe Git work branch -> implementation slice -> verification -> focused checkpoint -> optional authorised feature-branch push -> next slice / owner merge decision.

## State and persistence

- Stable purpose: `docs/NORTH-STAR.md`.
- Current truth: `docs/CURRENT-STATE.md`.
- Problem/domain model: `00-PLANNING/SYSTEM-MODEL.md`.
- Proposed route: `00-PLANNING/ARCHITECTURE-HYPOTHESIS.md`.
- Routine engineering policy: `ENGINEERING-DEFAULTS.md`.
- Decision authority: `docs/DECISION-RIGHTS.md`.
- Active readiness: `.harness/state/active-task.json`.
- Exact implementation history: Git.

## Failure boundaries

- A routine engineering choice must not be bounced back to the user when evidence/defaults already decide it.
- Defaults must not override stronger repository configuration or accepted ADRs.
- Skill binding must not be driven only by a project-type label.
- Version-control commands must not prompt interactively, expose credentials, stage the whole worktree, force push, or push managed work directly to `main`/`master`.
- Missing Git identity or required remote/authentication must fail explicitly rather than freeze the loop.
- Creating/deleting a remote repository, merging, releasing, deploying, and destructive history edits remain owner-controlled.

## Invariants

- the user keeps consequential product/architecture deviations, provider/cost/security boundaries, destructive operations, merge, deployment, and release authority.
- the agent decides routine/reversible implementation and established-default choices.
- WordPress work follows mature WordPress conventions by default.
- New scraping/ingestion work defaults to Python unless evidence establishes another stack.
- The harness controller remains zero-runtime-dependency Node 20+.
- Existing infer-before-implement discovery and eight readiness gates remain intact.

## Unknowns

No product-policy unknown blocks this slice. Implementation quality is bounded by regression tests and GitHub Actions. A later acceptance benchmark should run the same harness against representative WordPress, scraping, and automation briefs and score question count, completeness, architecture fit, and manual corrections.

## Evidence

### Memory-context repair, 2026-09-16

CLI resume returned useful prose while DSH returned mainly availability flags.
Both now use one bounded, read-only memory reader. Explicit project-relative note
mapping preserves existing project notes. Git snapshot differences signal review,
not automatic rewriting. Host permissions constrain harness and specialist rules.
No new persistence service, runtime dependency or orchestration layer is introduced.

- Shaun's successful WordPress run demonstrated the desired experience: a large brief, very few questions, and rapid complete implementation.
- Existing `.github/skills/wordpress-way.md` already contained strong WordPress defaults but duplicated its rule set internally.
- Existing `scripts/git-checkpoint.js` uses interactive `readline`, broad `git add .`, timestamp commits, and unconditional push, making it unsuitable for a deterministic agent loop.
- `docs/DECISION-RIGHTS.md` already delegates focused commits/checkpoints to Athena but previously treated every language choice as consequential, conflicting with mature ecosystem defaults.
- v0.3 established system modelling before architecture, capability composition, local readiness proof, and CI regression gates.

### Skill composition, 2026-09-17

The DSH integration registered skills through the correct provider seam but used
a fraction of the architecture. The flat `required_skills` list exposed 4-5 fixed
paths from a 25-skill library; `skillDescription()` advertised the first H1
instead of a routing description; only three skills carried frontmatter; the
provider ignored the registration-scoped `control` object so a changed library
stayed stale until restart; and the workspace came from configuration rather than
`options.cwd`.

DSH renders only `name` and `description` into the model catalogue, so the
description is the entire routing surface, and DSH serves a cached catalogue
without calling `list()` again, so invalidation cannot be observed from inside
`list()`. Both facts were confirmed against the DSH source before designing.

Narrowing the catalogue is only safe when the model can still reach what was not
predicted. That missing route, not the catalogue size, was the real defect.
Composition plus an explicit find-activate-load loop keeps the visible set small
and the library fully reachable, and DSH's rank-based layering lets project and
user skills shadow the harness library with no code.
