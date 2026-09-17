---
name: guard-debugging
description: "Use when a failure or regression appears: forbids deleting or replacing source files, requires reading the file, logging a .debug-session record, then applying surgical patches that preserve architecture."
whenToUse: "Use when the workspace contains a reproducible failure and the task is to patch the existing implementation without deleting or rewriting files."
user-invocable: false
metadata:
  harness:
    layer: reference
    topics: [debugging, refactoring]
    tags: [debugging, patching, regression, surgical-edit]
    stack: []
---
# SKILL: In-Place Debugging & Patching Protocol

## Core Invariant
You are FORBIDDEN from deleting existing source files or performing wholesale file replacements to fix bugs. You must treat existing source code as foundational architecture. Your goal is to surgically patch defects, not rewrite systems.

## Mandatory Execution Sequence
Whenever a failure, error, or bug is identified, you must complete these three steps in order:

1.  **READ & REASON:** Open and inspect the entire existing file. Identify the exact line or block causing the regression.
2.  **DIAGNOSTIC RECORD:** You must generate a `.debug-session` record detailing what failed, why it failed, and your target fix.
3.  **SURGICAL PATCH:** Use precise line edits or surgical updates. Retain all surrounding functions, comments, and architectural configurations.
