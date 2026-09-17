---
name: seo-directory-submission
description: "Use when submitting or updating a business on an approved directory: load the canonical business profile, detect existing listings, map fields without guessing, use the browser form operator, verify the result, and record durable submission evidence."
whenToUse: "Use when an approved business directory/citation target is ready for claim, update, or new listing submission and the task must preserve NAP/category consistency and a durable result ledger."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [seo, local-search, directory-submission, browser-automation]
    tags: [seo, citations, directories, forms, local-seo]
    stack: []
---
# SEO Directory Submission

Operate only on directory targets that have already been qualified or explicitly approved.

## Inputs

Require:
- canonical business profile;
- approved target directory URL;
- known account/session state if login is required;
- submission policy for paid options, legal terms, publication and messages.

A canonical business profile should carry only approved public/business fields such as business name, website, phone, public email, address or service area, categories, descriptions, hours and social/profile URLs.

## Workflow

1. Inspect the directory and determine whether the business already exists.
2. If an existing listing is found, prefer claim/update over duplicate creation.
3. Confirm the correct business profile and target geography/category.
4. Invoke the browser form workflow: inspect -> map -> fill -> re-inspect -> verify.
5. Never invent an address, category, founding date, employee count, certification or other missing fact.
6. Keep NAP/public identity values consistent with the canonical business profile unless an explicit per-directory variant is approved.
7. Preview the completed form before a consequential submission when the run policy requires approval.
8. Submit only through the site's normal published workflow.
9. Verify the success state, confirmation message/email requirement, moderation state, and resulting listing URL where available.
10. Append/update the caller's submission ledger.

## Submission states

Use clear results such as:
- `SUBMITTED`
- `PUBLISHED`
- `PENDING_REVIEW`
- `CLAIM_REQUIRED`
- `EMAIL_CONFIRMATION_REQUIRED`
- `LOGIN_REQUIRED`
- `MFA_REQUIRED`
- `CAPTCHA_REQUIRED`
- `PAID_UPGRADE_OFFERED`
- `DUPLICATE_EXISTING_LISTING`
- `NEEDS_INPUT`
- `REJECTED`
- `BLOCKED`

## Safety and quality

- Never bypass CAPTCHA, MFA, anti-bot controls or access restrictions.
- Never purchase or accept a paid upgrade without explicit approval.
- Never agree to unusual legal/contractual terms silently.
- Never fabricate reviews, ratings, endorsements, locations or business facts.
- Do not spray identical submissions into irrelevant directories just for link count.
- Treat a directory's own terms and field constraints as authoritative for that site.

## Evidence ledger

Record non-secret evidence:
- directory/source ID and canonical URL;
- business profile ID/version;
- action (`create`, `claim`, `update`);
- submitted public fields or a fingerprint/version reference;
- resulting listing/profile URL;
- submission status;
- confirmation requirement;
- timestamp;
- error/blocker and retry eligibility.

This ledger is the restart boundary: a later run should continue from recorded state rather than resubmitting blindly.
