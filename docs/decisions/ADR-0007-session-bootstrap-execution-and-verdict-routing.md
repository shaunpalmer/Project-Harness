---
id: ADR-0007
title: Session bootstrap stays in AGENTS.md; research verdicts route to docs/decisions/
status: accepted
date: 2026-09-20
---

# ADR-0007 — Session bootstrap execution and research-verdict routing

## Context

A session-bootstrap contract was added to `AGENTS.md` (commit `b1069bc`, branch
`fix/session-bootstrap-dispatch`) to decide *that* routing happens at session entry,
leaving *how* routed work is performed to the skills. It states the architectural rule
explicitly: AGENTS/bootstrap decides that routing must happen; skills contain the
procedure for how routed work is performed.

The change was then tested rather than assumed. The tests produced both confirmations
and defects, all preserved here.

What works:

- **Circularity is resolved.** `skill-router` is no longer asked to bootstrap itself;
  `AGENTS.md` owns that. The loop is broken by construction.
- **Discovery is real.** `find-skills` surfaced `code-review` — present in the library,
  absent from the visible catalogue — from a plain-language query, reporting
  `currently_visible: false` and the `matched_on` reasons. An unnamed capability was
  found without the owner naming it.
- **The library boundary is inspectable.** `project_harness_skill_catalog` reports
  `library_skills`, `suppressed_skills`, `activated_skills` and `shadowed_skills`, so
  the boundary is visible without being loaded.
- **Progressive disclosure holds.** 30 skills in the library, 14 visible in this
  workspace, selected from detected capability evidence (testing, database, api, oop,
  planning, docs) plus the four core controls and one discovery entry.

What does not work yet:

- **The bootstrap rules are stated, not enforced.** All five rules are prose in
  `AGENTS.md`. In the very next task after they were written — with `AGENTS.md` in
  context — the agent did not classify the work mode, did not invoke `skill-router`,
  and did not load `project-memory`. Nothing checks. A rule that reads as satisfied is
  worse than an acknowledged gap, because it looks fixed.
- **`find-skills` cannot signal absence.** A query with no local counterpart
  ("containerise a service and deploy it to a kubernetes cluster with helm") returned
  `seo-directory-submission` at score 52, matched on stopwords — `and`, `it`, `to`,
  `with`. Retrieval is reliable for a real match and noisy for a real gap.
- **Push-memory regressed to zero.** Removing `dsh-git-plugins` removed the only
  component that pushed memory into session context; nothing replaced it.
  `project_harness_resume` remains a tool call that nothing invokes. Read is now
  documented; write is still owner-triggered.
- **Research verdicts had no destination.** The harness has a decision slot
  (`docs/decisions/`) and a scratch slot (`AI-NOTES.md`), but no rule connecting an
  evaluation outcome to the former.

The constraint that shaped this record is the instruction that produced the bootstrap
change: do not broaden it into another dispatcher framework unless evidence proves
`AGENTS.md` cannot provide the bootstrap in an ordinary DSH workspace. The evidence
above shows `AGENTS.md` provides the *rule* but not the *trigger*. That is an
activation gap, not a case for a second framework, so no framework is introduced here.

## Decision

1. **`AGENTS.md` remains the bootstrap.** No separate dispatcher is introduced.
   Routing stays a stated obligation at session entry.

2. **A verdict is a decision and routes to `docs/decisions/`.** An
   adopt/reject/constrain verdict on an external dependency — or any evaluation outcome
   that changes what the project depends on — is recorded as an ADR, not in
   `AI-NOTES.md` scratch. Research work may stay lightweight in *process*; its *verdict*
   is durable knowledge. This rule is now stated in the `AGENTS.md` bootstrap section.

3. **The defects below are recorded, not silently accepted.** They are open items for a
   future change, with the evidence that justifies them.

## Rationale

The North Star asks for a dependable partner that preserves intent, evidence and
control across sessions. A stated-but-unenforced rule serves none of those: it transfers
confidence to the owner without transferring capability.

Splitting the response is deliberate. The verdict-routing rule is one sentence, closes a
gap the harness already has a slot for, and is reversible. The open items — executable
entry dispatch, absence detection, dependency-vetting capability, push-memory — are each
larger than a documentation change and deserve their own evidence and approval. Recording
them here stops them being re-derived next session, which is the same argument that makes
`docs/decisions/` the right home for this record.

## Consequences

**Easier:** an evaluation verdict now has an obvious destination, so the reasoning behind
an adopted dependency survives the session that produced it. The `AGENTS.md` bootstrap
section remains the single place that decides routing, so there is still one answer to
"where does dispatch live?".

**Harder:** the bootstrap contract now carries an obligation it cannot enforce. Until an
executable entry step exists, compliance depends on the agent honouring prose — which
this record documents as unreliable.

**Obsolete:** nothing. No skill, tool or file is removed by this decision.

## Open items (recorded, not implemented)

1. **Executable entry dispatch.** A required first call returning mode classification,
   catalogue pointer and memory resume. Prose can be skipped; a required call cannot.
2. **Absence detection in `find-skills`.** Stopword filtering, or an explicit confidence
   or `likely_absent` signal, so a genuine gap reads as a gap.
3. **`dependency-vetting` capability skill.** Minimum workflow: provenance → maintenance
   signals → supply-chain audit → claim verification against source → blast radius →
   verdict. Tier `capability`, evidence-selected, cross-stack. Not present in the
   30-skill library as of this date.
4. **Restore a minimal push-memory nudge at session entry** — even one line of current
   state — to replace what `dsh-git-plugins` previously provided.
