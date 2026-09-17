/**
 * The DSH-backed `git` probe.
 *
 * When the harness mounts a shell executor, the probe runs through it rather than
 * spawning git directly. That is what turns three documented rules into facts instead
 * of intentions:
 *
 *   - the subprocess seam scrubs credentials before any child starts
 *     (`docs/defensive-patterns.md`), which a raw spawn bypasses;
 *   - the command is registered with the seam, so it is disposed with the composition
 *     instead of outliving it (`docs/subsystems/subprocess.md`);
 *   - the caller's abort signal reaches the child, so cancelling a tool call stops the
 *     work (`docs/subsystems/tools.md`).
 *
 * Confinement comes with the seam: sandbox modes govern filesystem *writes* only, and
 * this probe is read-only with optional git locks disabled, so a workspace outside the
 * sandbox root still yields freshness evidence.
 *
 * The runner is only ever constructed from a live shell executor; when no shell is
 * mounted the plugin keeps the scrubbed local runner from `scripts/git-probe.js`.
 *
 * @module dsh/skills/git
 */

import {
  GIT_PROBE_MAX_BYTES,
  GIT_PROBE_TIMEOUT_MS,
  gitCommandFor,
} from '../../scripts/git-probe.js';

/**
 * Create a runner backed by the harness shell executor.
 *
 * @param {object} shell The `ctx.shell` service.
 * @returns {(args: readonly string[], options?: { cwd?: string, signal?: AbortSignal }) => Promise<string>} Runner.
 */
export function createShellGitRunner(shell) {
  return async function runGit(args, options = {}) {
    // The command string is built from a frozen allowlist, and the workspace travels as
    // `workdir` rather than inside the command, so no caller value can reach a shell.
    const command = gitCommandFor(args);
    const spec = shell.resolve({
      command,
      workdir: options.cwd,
      timeoutMs: GIT_PROBE_TIMEOUT_MS,
      stdoutMaxBytes: GIT_PROBE_MAX_BYTES,
      signal: options.signal,
      // Merged after the seam's credential scrub, so these survive it.
      env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });

    const result = await shell.run(spec);

    if (result?.aborted === true) {
      throw options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error('The operation was aborted.');
    }
    if (result?.timedOut === true) {
      throw new Error(`git ${args.join(' ')} timed out after ${String(result.timeoutMs)}ms`);
    }
    if (result?.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} exited with ${String(result.exitCode)}`);
    }
    if (result?.stdout?.truncated === true) {
      // A truncated hash would be parsed as if it were the real one.
      throw new Error(`git ${args.join(' ')} produced more output than the probe budget allows`);
    }

    return String(result?.stdout?.text ?? '').trim();
  };
}
