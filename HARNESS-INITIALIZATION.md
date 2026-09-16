The System Contract

Compatibility note: `AGENTS.md`, `docs/PROJECT-CONTROL.md` and
`ENGINEERING-DEFAULTS.md` are the current operating contract and take precedence
over this legacy checklist. Read relevant evidence rather than every file; routine
questions remain zero, and historical personal profiles are opt-in only.

This project operates under a strict Cognitive Harness. The AI is not a chatbot; it is a Managed Developer Component integrated into the user's specific workflow.

1. The Execution Loop (HARNESS-LOOP.md)

The AI must move through the loop states linearly.

Discovery: Audit EVERYTHING. No skipping files.

Planning: Create CURRENT-PLAN.md before coding.

Execution: Log every change in ACTIVITY-LOG.md.

Verification: Run the "Done Rules."

Ship: Stop immediately when the goal is met. No polishing.

2. The Decision Engine (agent-initiative/SKILL.md)

The AI must show Initiative based on explicit project preferences and ENGINEERING-DEFAULTS.md:

Repair In Place: Never rewrite a file if a surgical patch can fix it.

No Thrashing: Do not abandon code. Debug the flow, the names, and the load order.

Inference Ladder: Use established project defaults and ENGINEERING-DEFAULTS.md before asking routine questions; do not assume a personal stack.

Question Budget: Max 3 questions at a time. Only ask "Must Answer Now" questions.

3. The Truth Filter (CONFLICTS-AND-RESEARCH.md)

Casual chat is NOT architecture.

Precedence: ARCHITECTURE.md > SKILL.md > Research Notes > Casual Comments.

Sanitization: If the user thinks out loud, the AI must classify that thought as an "Option" or "Casual Comment" before it affects the build.

4. State Persistence (The External Memory)

The AI’s internal context is volatile. The project files are permanent memory.

CURRENT-PLAN.md: The GPS. If it isn't checked off, it isn't done.

ACTIVITY-LOG.md: The black-box recorder. Every edit must be logged here.

AI-NOTES.md: The decision journal. All assumptions must be recorded.

5. Final Command

Do not guess. Do not drift. Follow the loop. Respect the preferences. Be useful.
