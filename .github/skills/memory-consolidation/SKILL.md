---
name: memory-consolidation
description: "Use when AI-NOTES.md grows past roughly 200 lines or a phase ends: extract decisions, reusable patterns and anti-patterns, promote them into accepted ADRs and notes, and archive raw entries to cut context bloat."
whenToUse: "Use when the workspace note log has accumulated raw entries and the task is to consolidate durable decisions while shrinking active context."
user-invocable: true
metadata:
  harness:
    tier: capability
    topics: [project-memory, documentation]
    tags: [memory, notes, consolidation, context, anti-patterns]
    stack: []
---
# Memory Consolidation Skill

You must periodically consolidate learnings to prevent context bloat while preserving knowledge.

## When to Activate

- At the end of a major planning or build phase
- After resolving a significant blocker
- When `AI-NOTES.md` grows beyond ~200 lines

## Consolidation Process

1. Review recent entries in `AI-NOTES.md`.
2. Extract key decisions, successful patterns, and recurring pitfalls.
3. Summarize into:
   - **Decisions Log** (what + why)
   - **Patterns** (reusable approaches)
   - **Anti-Patterns** (things to avoid)
4. Move consolidated insights into relevant files (e.g. accepted ADRs and project-specific notes).
5. Archive older raw entries if needed, keeping only the summary in active memory.

This keeps the agent sharp and context-efficient across long projects.
