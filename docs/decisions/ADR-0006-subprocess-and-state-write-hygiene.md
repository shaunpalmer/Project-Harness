id: ADR-0006
title: Subprocess, environment and state-write hygiene for the DSH bundle
status: accepted
date: 2026-09-17

# ADR-0006 — Subprocess, environment and state-write hygiene for the DSH bundle

## Context

A three-agent audit of the DeepSeek Harness documentation against this bundle's source
found four blocking defects. All four were confirmed by inspection before any change:

- `scripts/memory-context.js` spawned `git` with `env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }`.
  `docs/defensive-patterns.md` requires a spawned command to get a scrubbed environment
  (`*KEY*`/`*SECRET*`/`*TOKEN*`/`*PASSWORD*` dropped). The harness enforces this in its
  subprocess seam (`packages/subprocess/subprocess/src/index.ts`, `scrubbedParentEnv()`);
  a raw spawn bypasses it. Documentation in this repository also claimed the probe ran with
  `GIT_TERMINAL_PROMPT=0`, which was never true on this path.
- `dsh/skills/state.js` wrote its temp file as `${filePath}.${process.pid}.tmp` with default
  flags and mode, then renamed it. `docs/defensive-patterns.md` requires a private
  directory, random names and an exclusive owner-only create; a predictable temp path
  invites a symlink race, and a failed rename left the previous content on disk.
- The six tools never read `exec.signal`. `docs/subsystems/tools.md` requires async work to
  observe or forward the signal, so a cancelled call kept working.
- The `git` child was spawned directly rather than through the subprocess seam.
  `docs/subsystems/subprocess.md` owns the child lifecycle and `docs/subsystems/sandbox.md`
  states that silent unconfined passthrough is never legal for a confined policy.

The constraint that shaped the fix: `scripts/memory-context.js` is shared by the DSH tools
and by the CLI, which has no Cordis context. Any seam-based solution had to be injected from
the DSH side rather than baked into the shared module.

## Decision

1. **One frozen argv table, two runners.** `scripts/git-probe.js` owns the only argv the
   probe will run plus the abort vocabulary. `createLocalGitRunner()` is the default: a
   bounded, abortable `execFile` spawn with a scrubbed environment. `dsh/skills/git.js`
   adds `createShellGitRunner(shell)`, which builds a command string from the same frozen
   table and hands the workspace to the seam as a `workdir` field so no path is ever
   interpolated into a command.

2. **The shell seam is optional and requested with a nested inject.** `shell` is
   deliberately not added to the plugin's top-level `inject`, because a service nobody
   provides leaves a plugin PENDING and would take all six tools down with it. `apply`
   calls `ctx.inject(['shell'], …)` and keeps the shell runner only while the service
   exists, so a composition without a shell loses the seam but never the hygiene.

3. **`readMemoryContext` becomes async and injectable.** It accepts `{ runGit, signal }`.
   A missing repository, a nonzero exit, a timeout and a truncated stream remain "no
   evidence" and degrade to the existing warning. Cancellation is different: it rethrows
   the caller's own reason, so a cancelled call is reported as cancelled instead of
   completing with empty freshness evidence.

4. **Every tool refuses to start cancelled work.** Each `execute` calls an abort check
   first. For the five tools with no child process this is the only cancellation handling
   they have; `resume` is additionally covered by the collector's own check.

5. **The activation write is hardened in place.** The `.harness` directory is checked for
   a pre-existing symlink *before* the recursive mkdir, the state directory is created
   `0o700`, the temp name gains random bytes, the create uses `flag: 'wx'` and
   `mode: 0o600`, and a failed rename unlinks the temp file. The `ctx.fs` write seam was
   considered and rejected for this change: it is a separate improvement, and the audit
   classified it as such.

## Rationale

- **The docs name the mechanism, so use it.** A raw spawn is not merely unidiomatic here;
  it is the documented bypass of the credential scrub, the managed-child lifecycle and the
  confinement policy. Routing through the seam fixes three of the four findings at once.
- **A missing seam must not become a missing guard.** Mirroring the seam's scrub rule
  character-for-character in `scripts/child-env.js` means the CLI path — which has no
  Cordis context — is held to the same standard, and a deployment without a shell degrades
  to an equivalently safe spawn rather than an unsafe one.
- **Confinement was checked, not assumed.** Sandbox modes govern filesystem *writes* only
  (`docs/subsystems/sandbox.md`), and this probe is read-only with `GIT_OPTIONAL_LOCKS=0`,
  so using the seam does not cost freshness evidence when the workspace sits outside the
  sandbox root. Without that reading, the seam would have looked like a feature regression.
- **No new dependency.** `ctx.shell` is reached as a plain service property and the shell
  package is never imported, so `peerDependencies` and the published `files` list are
  unchanged.

## Consequences

- The published interface of `scripts/memory-context.js` changed: `readMemoryContext` is
  async. Both in-repo callers (the CLI `resume`/`checkpoint` commands and the DSH resume
  tool) were updated in the same change, and `resumeProject` is now async.
- Credential hygiene is now verifiable without a Cordis host: `scrubbedEnv` is a pure
  function of an environment object, and the probe's argv table is a closed set.
- Each fix carries a test that was proven to fail when the regression was reintroduced,
  per the repository's testing policy.
- `scripts/vcs-control.js` was deliberately left alone. Its spawns use the machine's own
  Git credentials for authorised pushes, where dropping credential-shaped variables would
  break the documented workflow rather than protect it.
- The remaining audit improvements are still open and unaffected: the `ctx.fs` write seam
  for the activation record, the bundle `config:` row, and whether the six tools should be
  restricted per scope.
