# Reporting Modes

Status: prototype contract

Purpose: stop role agents from dumping implementation detail by default while preserving full technical/audit depth when it is genuinely useful.

## Default rule

The default human-facing report is **brief-first**:

1. Result
2. Material changes
3. Material blockers / risks
4. One clear next action

Details stay available on request. A role may internally do substantial work without narrating every step.

## Modes

### `brief`

Use when Shaun needs the highlights quickly.

Target shape:

- **Result:** 1–3 short paragraphs.
- **Changed:** maximum 5 bullets.
- **Blockers:** only blockers that affect the outcome.
- **Next:** one action or decision.

Do not include:

- full command transcripts;
- every touched file;
- routine passing tests;
- implementation trivia;
- repeated evidence already implied by the result.

Example:

> The browser plugin installed and the live smoke passed. Multi-tab support is still missing, so I have not promoted it as the preferred browser yet.
>
> Changed: plugin installed, English surface verified, screenshot path tested. Next: compare the two multi-tab candidates before deciding whether to fork.

### `normal`

Use for ordinary project work when enough context is needed to understand what changed and why.

Target shape:

- short result summary;
- 4–8 material changes;
- important tests/evidence;
- blockers/open decisions;
- next 1–3 actions.

Technical detail is selective, not exhaustive.

### `technical`

Use when debugging, reviewing architecture, or when Shaun explicitly asks how something works.

Include:

- architecture/path decisions;
- relevant files/functions;
- key commands/tests;
- important failure details;
- trade-offs and rationale;
- concrete next implementation steps.

Still lead with the result before the weeds.

### `audit`

Use when a durable, evidence-heavy record is required.

Include:

- objective and scope;
- starting state;
- exact changes;
- evidence/test results;
- commit/PR/release identifiers;
- unresolved risks;
- rollback/recovery information;
- final state and decision trail.

Audit mode may be long. It is intended for repository records, handoffs, compliance, incident review or formal release evidence, not routine conversation.

## Mode selection

Priority order:

1. Explicit user request wins (`brief`, `normal`, `technical`, `audit`).
2. Role/project default applies when no explicit request exists.
3. The agent may temporarily increase detail for a failure, but must still put the concise result first.
4. Never silently downgrade an explicit audit request.

Recommended role defaults:

| Role | Default | Typical escalation |
|---|---|---|
| Developer | normal | technical for failures; audit for releases/incidents |
| Admin | brief | normal for unresolved cases |
| Sales | brief | normal for pipeline/campaign review |
| Marketing | brief | normal for campaign analysis |
| Operations | brief | normal for exceptions/incidents |
| Finance | normal | audit for reconciliation/formal evidence |

## Progressive disclosure

All modes should support the same information hierarchy:

```text
Result
  ↓
Highlights
  ↓
Evidence / technical detail
  ↓
Full audit trail
```

The first screenful should answer: **Did it work? What matters? What happens next?**

## Anti-patterns

Do not:

- narrate every tool call;
- paste raw logs unless they explain a failure;
- report routine green checks one by one in brief mode;
- produce three pages before stating whether the task succeeded;
- confuse implementation evidence with human-facing status;
- treat verbosity as proof of work.

## Machine-readable prototype

A future runtime representation can remain deliberately small:

```json
{
  "reporting_mode": "brief",
  "modes": ["brief", "normal", "technical", "audit"],
  "brief": {
    "max_change_items": 5,
    "lead_with_result": true,
    "include_routine_passes": false
  }
}
```

The runtime should treat these values as presentation policy, not as a limit on the amount of work the agent may perform.

## Relationship to execution

Reporting frequency is not the same as reporting detail.

A four-hour Sales or Admin run may operate silently under an execution contract and produce one `brief` report at completion. Individual successes should not automatically interrupt the operator.
