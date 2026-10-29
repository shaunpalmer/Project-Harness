# Role Packs and Run Policies

Status: architecture draft

Purpose: define how one Project Harness core can support Developer, Admin, Sales, Marketing, Operations and Finance projects without turning each role into a separate monolithic harness.

## Separation of concerns

Project Harness should distinguish three layers:

1. **Role pack** — how the agent behaves and what business objective it owns.
2. **Capability pack** — which tools/plugins it can use.
3. **Run policy** — how it continues work, when it stops, and when it interrupts a human.

A skill is not a run policy. A browser is not a role. A role should be able to compose many capabilities and keep working against an objective until its run contract says to stop.

## Role pack shape

A role pack should eventually declare:

```yaml
role: sales
objective: build and progress qualified pipeline
reporting_mode: brief
capabilities:
  - browser
  - search
  - crm
  - email
  - calendar
  - tasks
  - scheduling
skills:
  - prospect-research
  - qualification
  - outreach
  - follow-up
run_policy: sales-pipeline
```

The UI/project can then select a role by composition rather than by loading an entirely different Harness implementation.

## Run policy

A run policy answers four questions:

### 1. Completion target

Examples:

- Sales: produce 30 qualified leads.
- Admin: clear all triageable inbox/calendar/task items in the current queue.
- Marketing: prepare and schedule the campaign package.
- Operations: process all jobs in the current exception queue.

### 2. Continue conditions

The agent should continue while:

- actionable queue items remain;
- required capabilities are available;
- the work stays inside the approved objective;
- time/budget/record limits have not been reached.

### 3. Stop conditions

Stop when:

- completion target is reached;
- queue is exhausted;
- a hard external dependency blocks further useful work;
- an approval is required by decision rights;
- configured run budget/time limit is reached;
- repeated failure threshold is reached.

### 4. Interruption policy

Do **not** interrupt for ordinary progress.

Interrupt only for:

- approval needed;
- material ambiguity that changes outcome/cost/risk;
- authentication/credential failure requiring the operator;
- destructive or externally consequential action outside delegated rights;
- unrecoverable blocker;
- explicit user-requested milestone.

Individual successes are logged, not announced immediately.

## Example: Sales pipeline

Bad behaviour:

```text
Found lead #1 → stop and announce it.
```

Desired behaviour:

```text
Target: 30 qualified leads
Current: 0

while qualified < 30 and queue remains:
    research next candidate
    collect evidence
    qualify
    write CRM/task record
    continue

report once at completion or hard blocker
```

Suggested completion report in `brief` mode:

```text
Result: 30 qualified leads completed.
Highlights: 24 have direct email, 18 have named decision makers, 6 need manual follow-up.
Blocker: none.
Next: release the approved outreach batch.
```

## Example: Admin four-hour run

A future Admin project may execute a queue such as:

1. triage email;
2. process calendar conflicts/invitations within decision rights;
3. review pending Drive documents;
4. update task board;
5. perform due follow-ups;
6. file completed records;
7. produce one brief.

The run should not stop after each email. Items requiring a decision can be placed in an `approval-needed` queue while the agent continues independent work.

## Queues and state

Long-running roles need durable state. A minimal work item should track:

```json
{
  "id": "work-123",
  "role": "admin",
  "status": "queued",
  "attempts": 0,
  "next_action": "reply",
  "blocked_reason": null,
  "evidence": [],
  "updated_at": "..."
}
```

Recommended states:

```text
queued
in_progress
waiting_external
approval_needed
completed
failed_retryable
failed_terminal
```

This prevents the agent from repeatedly rediscovering work and allows a run to resume safely.

## Bounded autonomy

The goal is not uncontrolled autonomy. It is **bounded continuity**:

- objective is explicit;
- capabilities are explicit;
- decision rights are explicit;
- stop/interruption rules are explicit;
- progress is durable;
- reporting is concise by default.

This is the architectural requirement for unattended multi-hour Admin, Sales, Marketing and Operations runs.

## Relationship to V2 skill architecture

V2 remains the selection/routing layer for knowledge and specialist capability. Role packs should compose the skill layers rather than replace them.

Conceptually:

```text
Project
  → Role pack
      → core skills
      → role skills
      → specialist skills
      → capability plugins
      → run policy
      → reporting mode
```

The next implementation phase should prove this with one non-Developer role, preferably Admin, before broadening to Sales/Marketing/Operations.
