---
name: browser-auth-session
description: "Use when browser work depends on an authenticated session: establish or reuse approved login state, protect credentials, handle MFA/CAPTCHA handoff, verify the signed-in identity, and keep site/session boundaries explicit."
whenToUse: "Use when a browser task requires logging in, reusing cookies/session state, switching accounts, or continuing authenticated admin/social/directory work."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [browser-automation, authentication, session-state, web-operations]
    tags: [browser, login, session, authentication, security]
    stack: []
---
# Browser Authentication and Session Handling

Use the browser capability without turning credentials or session state into project data.

## Rules

1. Prefer an already-authenticated approved browser/session when available.
2. Never copy passwords, cookies, access tokens, recovery codes or session secrets into notes, logs, source files or screenshots intended for persistence.
3. Verify the account identity after login before performing work.
4. Treat each domain/account pair as a separate trust boundary.
5. Never bypass CAPTCHA, MFA, passkeys, anti-bot checks or identity verification.

## Login flow

1. Inspect the current URL and page before entering anything.
2. Confirm the target site/account from the task or approved profile.
3. Fill non-secret identity fields only from trusted configuration.
4. For secrets, use the approved credential mechanism or request human completion; do not expose them in agent output.
5. If MFA/CAPTCHA appears, pause at the challenge and preserve the session for human completion when possible.
6. After authentication, verify signed-in identity using visible account/profile indicators.
7. Continue only on the intended origin.

## Session reuse

- Reuse session state when it belongs to the same approved site/account and the task allows it.
- Do not export raw cookies/localStorage as a workaround.
- If the site logs out, repeat the governed login flow rather than scripting around it.
- If an account switch is required, verify the new identity before acting.

## Failure states

Return a clear state such as `AUTH_REQUIRED`, `MFA_REQUIRED`, `CAPTCHA_REQUIRED`, `WRONG_ACCOUNT`, `SESSION_EXPIRED`, or `ACCESS_DENIED` rather than repeatedly retrying credentials.

## Handoff evidence

Record only non-secret evidence: site, intended account label, signed-in identity confirmation, final URL, challenge/blocker type, and whether the session is ready for the next skill.
