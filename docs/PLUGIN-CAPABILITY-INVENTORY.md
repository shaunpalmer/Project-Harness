# Plugin Capability Inventory

Status: initial working inventory

Purpose: keep a durable map of DSH ecosystem capabilities so Project Harness does not repeatedly rediscover the same plugins. This file is a curation layer, not an install manifest. Every external plugin must still be audited before it is added to a production profile.

## Status vocabulary

- **Installed** — already used in a Project Studios DSH profile.
- **Audited** — source and integration model reviewed sufficiently for a decision.
- **Candidate** — promising; needs source audit and live smoke test.
- **Research** — discovered but not yet compared deeply enough.
- **Fork likely** — useful base, but Project Studios changes are expected.

## Capability map

| Capability | Candidate / implementation | Status | Likely use | Notes / next check |
|---|---|---:|---|---|
| Project governance | `project-harness` | Installed | All roles | Core composition, skill routing, memory, controls and project context. |
| Cost visibility | `@shaunpalmer/dsh-cost-tracker` | Installed | All roles | Project Studios hardened fork; NZD display, CNY canonical accounting. |
| Browser automation | `ben7am1n/dsh-browser` | Audited | Admin, Sales, Marketing, Developer | Clean Playwright base; persistent page; tabs are missing. Compare stronger browser candidates before forking. |
| Browser automation | multi-tab Playwright candidates from DSH Directory | Candidate | Admin, Sales, Marketing, Developer | Prioritise multi-tab, persistent context, semantic locators, screenshots and form filling. |
| Email | DSH email / IMAP-SMTP candidates | Candidate | Admin, Sales, Marketing | Need English audit, Gmail compatibility, attachments, reply/forward, account isolation and approval model. |
| Gmail | direct Gmail-capable plugin or email abstraction | Research | Admin, Sales | Prefer API-native integration where available; browser fallback is secondary. |
| Google Drive | Drive-capable plugin / virtual filesystem bridge | Research | Admin, Sales, Marketing, Finance | Need read/write/search, Docs/Sheets support and auditable file actions. |
| Calendar | Google Calendar / calendar plugin | Research | Admin, Sales, Operations | Need event lookup, booking, availability, reschedule and invitation handling. |
| CRM | CRM-specific plugin or API bridge | Research | Sales, Marketing | Must support contacts, stages, notes, follow-up dates and evidence of changes. |
| Task tracking | Kanban / team-board candidates | Candidate | All business roles | Shared queue is important for unattended work and handoffs. |
| Scheduling | scheduled-task / scheduler candidates | Candidate | Admin, Sales, Marketing, Operations | Need cron, one-shot, durable run history and fresh agent sessions. |
| Notifications | notifier / notification gateway candidates | Candidate | All roles | Prefer multi-channel alerts, approvals, failures and completion notifications. |
| Messaging | message-gateway candidates | Candidate | Sales, Marketing, Support | Potential email/Telegram/WhatsApp/Discord/webhook routing layer. |
| SMS | messaging gateway or provider-specific plugin | Research | Sales, Operations | Confirm NZ-compatible provider path, outbound approvals and delivery logging. |
| Social publishing | platform-specific / social-suite plugins | Research | Marketing | Need publish/schedule/report rather than only content generation. |
| Voice | DSH voice bundle / transcription candidates | Research | Admin, Support | Useful for voice notes and summaries; outbound calling is a separate capability. |
| Phone / call summaries | telephony / transcript integration | Research | Sales, Admin | Look for call ingestion, transcription, summary and CRM handoff. |
| Search / research | DSH web-search plugins | Candidate | Sales, Marketing, Research | Compare quality, rate limits, rendering support and evidence capture. |
| GitHub | DSH GitHub integration | Installed / available | Developer | Existing linked GitHub capability remains preferred for repository actions. |
| Documents | office/document plugins | Candidate | Admin, Finance, Marketing | Need Docs/Sheets/Slides or DOCX/PDF generation plus controlled edits. |
| File intake / OCR | file-reader / open-file candidates | Candidate | Admin, Finance | Useful for PDF, DOCX, XLSX, images and evidence extraction. |
| Reporting | research-report / internal reporting contract | Candidate | All roles | Project Harness reporting modes should remain the final presentation contract. |
| Agent teams / sub-agents | agent-team / orchestrator candidates | Candidate | Marketing, Sales, Operations | Important for bounded specialist work under one parent objective. |
| Handoffs / hooks | lifecycle hook / event plugin candidates | Candidate | All roles | Needed for queue transitions, notifications and cross-role workflows. |
| Automation | scheduler + hooks + browser/API capabilities | Candidate | All roles | Prefer composition over one giant automation plugin. |
| Terminal | DSH host tools | Available | Developer, Operations | Capability should be role-gated, not reimplemented. |

## Business-role capability bundles

These are composition targets, not separate monolithic harnesses.

### Developer

Core: GitHub, terminal, browser, files, reporting, project memory, tests.

### Admin

Core: email, Gmail, Drive, Calendar, browser, documents, forms, task board, scheduling, reporting, notifications.

### Sales

Core: browser, search, CRM, email, messaging, Calendar, task board, scheduling, reporting, lead evidence.

### Marketing

Core: browser, search, analytics, documents, social publishing, email, CRM, scheduling, reporting, specialist sub-agents.

### Operations

Core: task board, Calendar, messaging, documents, browser, scheduling, notifications, reporting.

### Finance

Core: Drive, documents/spreadsheets, email, task board, reporting, approval-sensitive automations.

## Audit checklist for any candidate plugin

1. Confirm active maintenance and DSH compatibility.
2. Read source rather than relying on directory copy.
3. Confirm English active UI/tool descriptions.
4. Record package identity, loader IDs and dependencies.
5. Identify file-system, network, credential and host-mutation behaviour.
6. Check whether it installs cleanly into an isolated DSH profile.
7. Run its own tests and add missing Project Studios regression tests if forked.
8. Smoke-test the actual capability in DSH.
9. Record the pinned known-good revision.
10. Decide: use upstream, wrap, fork, or reject.

## Principle

Project Harness should not reimplement capabilities that the DSH ecosystem already provides well. Its job is to compose, expose and govern those capabilities according to role, project, decision rights and execution policy.
