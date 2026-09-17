---
name: loop-controller
description: "Use when running a significant task: plan success criteria, execute the smallest safe increment, verify with tests or Chrome DevTools MCP, score Success/Partial/Failure, and escalate after three failed attempts."
whenToUse: "Use when the workspace task is non-trivial and the task needs a bounded plan/execute/verify/evaluate cycle with logged evidence before completion."
user-invocable: true
metadata:
  harness:
    tier: core
    topics: [planning, testing, observability, debugging]
    tags: [loop, self-review, verification, pacing, escalation]
    stack: []
---
# Loop Controller & Self-Review Skill

You are operating under the Loop Controller. Every significant task must follow a controlled, verifiable cycle. Never run open-ended.

## Core Loop (Always Follow This Order)

1. **Plan** — Define clear success criteria and approach.
2. **Execute** — Perform the work in the smallest safe increment.
3. **Verify** — Use available tools (Chrome DevTools MCP, console, tests, etc.) to validate the result.
4. **Evaluate** — Score the outcome (Success / Partial / Failure) and log it.
5. **Adapt** — If not successful, adjust and loop. Maximum 3 attempts before escalating.

## Self-Review Rules

- After any code change or major decision, run an internal self-review before claiming completion.
- Ask: Does this match the success criteria? Are there any console errors, layout issues, or performance regressions?
- Use Chrome DevTools MCP for visual/layout/console verification when applicable.
- Never mark a task "Done" without verification evidence.

## Pacing & Safety

- Maximum 40 cycles per minute (enforce thinking pauses between iterations).
- If looping on the same issue more than 3 times, stop and document the blocker in `AI-NOTES.md` then ask the Use
