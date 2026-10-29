# AI-NOTES.md — Working Memory & Change Log

> The AI's persistent notebook for this project. Read on entry. Write on every meaningful change.
> This is a record to look up, not prose to read. Append; do not rewrite history.

---

## Standing Order

- Read this file on entry, after the entry protocol.
- Append a **Change Log** entry for every meaningful change: code, structure, schema, or decision.
- Record **Decisions** with a one-line rationale so the next session does not re-derive them.
- Park anything **UNRESOLVED** here and flag it to the owner. Do not guess past it.
- Keep entries short and dated. Newest at top.
- **Watch `dsh-github-intelligence` for read-write behaviour.** It is installed with no token of its own and is documented plus code-verified as read-only (see Scratch). If any evidence ever shows it mutating — a POST/PUT/PATCH/DELETE, a created issue/PR/release, or a write scope — **alert the owner immediately** and record it here. Owner asked for this watch on 2026-09-20.

---

## Change Log

> Append-only. Newest first. One row per change.

| Date | Change | Why |
|------|--------|-----|
| 2026-09-20 | Verified `dsh-github-intelligence@2.9.0` is code-level read-only; added `githubToken: !!js 'process.env.GITHUB_TOKEN'` to the web profile's `cordis.patch.yml` | Confirm the read-only claim against source rather than the README, and lift the anonymous GitHub ceiling from 60 to 5,000 req/h |
| 2026-08-01 | Added project lifecycle layout and type-aware destination scaffold | Keep product work outside the harness and distinguish planning, source, proof, disposable build files, distributable packages, and deployment |
| 2026-08-01 | Added unified project-control foundation | Preserve alignment, decision rights, memory, pivots, and safe destinations across sessions |
| 2026-08-01 | Replaced executable SQLite memory demo with file-backed resume/checkpoint commands | Avoid fake seeded memory and make checked-in truth authoritative |
| 2026-08-01 | Reconciled `AGENTS.md`, README, and touched Node command paths | Remove contradictory instructions and the ES module/CommonJS runtime failure |

---

## Decisions

> Why a choice was made, so it is not re-litigated. Lightweight ADR.

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 3 | Treat `dsh-github-intelligence` as read-only and safe to leave loaded permanently | Source audit found only 3 `fetch` call sites, all defaulting to GET, and zero POST/PUT/PATCH/DELETE; blast radius is nil | 2026-09-20 |
| 2 | Use `00-PLANNING/`, `src/`, `tests/`, `build/`, and `dist/` in each external project | Gives the agent explicit folder ownership and produces clean release artifacts without mixing product code into the harness | 2026-08-01 |
| 1 | Use files + JSON + Git + a zero-dependency CLI for memory v1 | Transparent, versioned, sufficient at current scale, and testable without an external service | 2026-08-01 |

---

## Open Questions / UNRESOLVED

> Parameters or choices that could not be resolved from the documents. Owner must answer.
> Move each to Decisions once resolved.

- None recorded.

---

## Extended Parameters (optional lookup)

> Beyond the core five in the entry protocol. Resolve when the task needs them.
> Most are inferred from `ENGINEERING-DEFAULTS.md` / `TECH-SPEC.md`; confirm when the task is sensitive to them.

| Parameter | Resolves | Default source |
|-----------|----------|----------------|
| **ERROR STRATEGY** | How errors surface and bubble (envelope / Result / exception+log); one bad record vs whole-run failure | `ARCHITECTURE-TEMPLATES.md` (error bubbling) |
| **LOGGING** | What is logged, where, at what level; structured or plain | `ENGINEERING-DEFAULTS.md` (fail loudly, log) |
| **TESTING** | What proves this slice works; the smallest useful test; the verify command | `testing-plan` skill |
| **SECURITY** | Sanitise-in / escape-out, secrets handling, nonces (WordPress), auth | `TECH-SPEC.md`, `wordpress-plugin` skill |
| **PERFORMANCE BUDGET** | Concrete target (e.g. 100 URLs < 60s); memory ceiling | `PRD.md` success metrics |
| **DEPENDENCIES** | What is already present; what may be added; what is forbidden | `TECH-SPEC.md` |
| **CONVENTIONS** | File naming, class naming, folder placement | `ARCHITECTURE.md`, project type template |
| **STATE & PERSISTENCE** | Keeps state between runs? where? idempotent? | `DATA-FLOW.md`, `DATABASE.md` |
| **CONCURRENCY** | Parallel or sequential; rate limits; backoff | `scraping-pipeline` skill |
| **FAILURE / ROLLBACK** | Dry-run mode? rollback? safe-by-default (networking: observe before active) | `PROJECT-TYPES.md` |
| **READ-FIRST** | Existing files the AI must read before writing | repo scan |
| **DONE VERIFICATION** | How the owner confirms the slice is done (command / file / screen) | `PROJECT-INTAKE.md` Q5 |

---

## Scratch / Working Notes

> Freeform context worth remembering between turns or sessions. Clear when stale.

### dsh-github-intelligence — read-only verification (2026-09-20)

**Claim:** 196+ read-only tools across 16 ecosystems. No API key required.

**Verified at source, not from the README.** Audited `~/.dsh/profiles/web/node_modules/dsh-github-intelligence/lib/` (`github.js`, `ecosystems.js`, `arxiv.js`, `catalog.js`, `index.js`):

- **3 `fetch` call sites total** — `arxiv.js:58`, `ecosystems.js:27`, `github.js:75`. **None pass a `method`**, so all three default to GET.
- **Zero occurrences** of `method: 'POST'`, `'PUT'`, `'PATCH'`, or `'DELETE'` anywhere in `lib/`.
- Grep hits for "push"/"create" were false positives: JS `Array.push()` in render/build code, and `'push'` appearing only as a *GitHub permission name* in a permission list (`catalog.js:78`).

**Conclusion:** the read-only claim holds at code level. It cannot create an issue, open a PR, cut a release, or write to any repo it inspects.

**Open action for the owner — token plumbing:**
`GITHUB_TOKEN` is **not set** anywhere (not in `~/.bashrc`, `~/.profile`, `~/.bash_profile`, or `~/.config/environment.d/`). Until it is exported before `dsh web` launches, the `!!js` patch resolves to `undefined` and the 60 req/h anonymous limit still applies. Plugin schema tolerates `undefined`/`""`/`absent` without throwing, so a missing variable cannot break boot.
