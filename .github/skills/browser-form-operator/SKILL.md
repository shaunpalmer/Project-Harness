---
name: browser-form-operator
description: "Use when a browser task must inspect and fill web forms safely: snapshot the page, map labels to known values, fill/select/check/upload, verify the resulting state, and separate preparation from consequential submission."
whenToUse: "Use when the task involves repetitive browser form entry, account/profile updates, directory forms, admin portals, uploads, checkboxes, selects, or multi-step web forms."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [browser-automation, form-filling, web-operations, verification]
    tags: [browser, forms, playwright, automation, verification]
    stack: []
---
# Browser Form Operator

Operate the browser as a careful form worker, not as a blind macro.

## Contract

Inputs:
- a target page or authenticated browser context;
- a task describing what must be entered or changed;
- trusted source values for fields;
- an approval policy for any consequential final action.

Outputs:
- fields inspected and mapped;
- values filled from trusted sources;
- validation/errors encountered;
- final page state verified;
- submission result and resulting URL when submission is authorised.

## Core loop

Always use this sequence:

1. **Inspect** — read the current page, title, URL and interactive controls before acting.
2. **Map** — match form labels/placeholders/options to supplied values. Never invent missing values.
3. **Act narrowly** — prefer labelled/semantic controls and stable element references over brittle coordinates.
4. **Re-inspect** — after navigation, modal changes, validation, or dynamic DOM updates, obtain fresh page state before reusing element references.
5. **Verify** — confirm the field value or success state after each material step. A successful click is not proof of completion.
6. **Submit only when allowed** — treat preparation and final submission as different actions.

## Field handling

- Text/email/phone/url: normalise only when the task or domain policy explicitly allows it.
- Select/radio/checkbox: choose only an option that is semantically supported by the supplied source data.
- File upload: verify the exact file path/name before upload and verify the site accepted it.
- Hidden/autofilled fields: do not overwrite unless the task requires it and the value is understood.
- Required unknown field: stop that item as `NEEDS_INPUT`; do not guess.

## Submission boundary

Routine reversible typing may proceed when authorised by the task. Pause before a final action that creates, publishes, purchases, deletes, grants permissions, accepts legal terms, sends messages, or otherwise has material external effect unless the run policy explicitly authorises that action.

CAPTCHA, MFA, passkeys, payment confirmation and identity verification require human completion or an approved first-party mechanism. Never bypass them.

## Verification evidence

For completed work, record enough evidence to prove the result without storing secrets:
- page URL;
- form/site name;
- fields changed, preferably field names rather than sensitive values;
- success/error text;
- resulting profile/listing URL when available;
- timestamp or task ledger reference when the caller provides one.

## Failure behaviour

- stale element/reference -> re-inspect and retry once with fresh state;
- validation error -> report the exact field/error and keep other safe work intact;
- unexpected navigation/domain -> stop and re-evaluate trust boundary;
- repeated failure -> return the smallest reproducible blocker rather than clicking randomly.
