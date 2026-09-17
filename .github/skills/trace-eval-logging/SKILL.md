---
name: trace-eval-logging
description: "Use when executing multi-cycle or looped work: append trace entries to AI-NOTES.md with timestamp, action, verification evidence, an eval score of Success/Partial/Failure, and lessons learned."
whenToUse: "Use when the workspace runs iterative loops or long sessions and the task needs durable per-iteration evidence and eval scoring in the notes log."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [observability, documentation, project-memory]
    tags: [tracing, eval, logging, observability, notes]
    stack: []
---
# Trace & Eval Logging Skill

Maintain high-quality execution traces for every loop iteration and major decision.

## What to Log

For every meaningful action or loop cycle, append to `AI-NOTES.md` (or a dedicated trace section):

- Timestamp
- Task / Step description
- Action taken
- Verification method & result (e.g. "DevTools: no console errors, LCP = 1.2s")
- Eval score (Success / Partial / Failure + short rationale)
- Lessons learned or adjustments made

## Best Practices

- Keep entries concise and structured.
- Use this log as institutional memory for future sessions.
- At the end of a session or major milestone, summarize key patterns and recurring issues.
- Reference traces when diagnosing repeated problems.

This skill turns every run into a learning opportunity and prevents repeating the same mistakes.
