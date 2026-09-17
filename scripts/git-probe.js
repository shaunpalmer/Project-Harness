/**
 * The read-only `git` probe.
 *
 * Project Harness asks git three questions to decide whether its stored memory still
 * matches the repository: which worktree this is, which commit is checked out, and
 * whether anything is dirty. Two callers need that answer — the DSH tools and the
 * CLI — and they differ in what they can reach: the tools have a Cordis context and
 * can use the subprocess/sandbox seam, while the CLI has neither.
 *
 * Both callers share the frozen argv table below and the abort vocabulary, so they
 * cannot drift into disagreeing about what the probe runs. The default runner here is
 * the CLI's: a bounded, abortable, credential-scrubbed local spawn. The DSH path
 * prefers a seam-backed runner (`dsh/skills/git.js`) and falls back to this one, so
 * every path is scrubbed even when no shell service is mounted.
 *
 * @module scripts/git-probe
 */

import { execFile } from 'node:child_process';
import { scrubbedEnv } from './child-env.js';

/** Per-command deadline. The probe is diagnostic; it must never delay a tool call. */
export const GIT_PROBE_TIMEOUT_MS = 2000;

/** Bounded stdout. A hash or a porcelain status fits in a few hundred bytes. */
export const GIT_PROBE_MAX_BYTES = 65536;

/**
 * Every argv this module will run. Nothing outside this table reaches a spawn, so no
 * caller-supplied value can be interpolated into a command.
 */
export const GIT_PROBE_COMMANDS = Object.freeze({
  toplevel: Object.freeze(['rev-parse', '--show-toplevel']),
  head: Object.freeze(['rev-parse', 'HEAD']),
  status: Object.freeze(['status', '--porcelain', '--untracked-files=normal']),
  branch: Object.freeze(['branch', '--show-current']),
  shortHead: Object.freeze(['rev-parse', '--short', 'HEAD']),
  shortStatus: Object.freeze(['status', '--short']),
});

/**
 * Report whether a failure is the caller's cancellation rather than a probe failure.
 *
 * Cancellation must not be reported as "git gave us nothing", because that would turn
 * a cancelled call into a successful one carrying stale evidence.
 *
 * @param {AbortSignal | undefined} signal The caller's signal.
 * @param {unknown} error The thrown value.
 * @returns {boolean} Whether the caller aborted.
 */
export function abortedBy(signal, error) {
  if (signal?.aborted === true) return true;
  const name = typeof error === 'object' && error !== null ? error.name : undefined;
  const code = typeof error === 'object' && error !== null ? error.code : undefined;
  return name === 'AbortError' || code === 'ABORT_ERR';
}

/**
 * Throw the caller's abort reason when the signal has already fired.
 *
 * @param {AbortSignal | undefined} signal The caller's signal.
 * @returns {void}
 */
export function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted.');
  }
}

/**
 * Create the default runner: a scrubbed, bounded, abortable local `git` spawn.
 *
 * @returns {(args: readonly string[], options?: { cwd?: string, signal?: AbortSignal }) => Promise<string>} Runner.
 */
export function createLocalGitRunner() {
  return async function runGit(args, options = {}) {
    return await new Promise((resolve, reject) => {
      execFile('git', [...args], {
        cwd: options.cwd,
        encoding: 'utf8',
        timeout: GIT_PROBE_TIMEOUT_MS,
        maxBuffer: GIT_PROBE_MAX_BYTES,
        signal: options.signal,
        windowsHide: true,
        env: scrubbedEnv({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }),
      }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout ?? '').trim());
      });
    });
  };
}

/**
 * Build the command string for one allowlisted argv.
 *
 * A seam-based runner takes a command string, which is where an interpolated path
 * would become a shell-injection surface. Restricting the string to this table means
 * only literal commands can ever be built, and the workspace travels as a `workdir`
 * field instead of inside the command.
 *
 * @param {readonly string[]} args One allowlisted argv.
 * @returns {string} The literal command.
 */
export function gitCommandFor(args) {
  const key = [...args].join(' ');
  for (const candidate of Object.values(GIT_PROBE_COMMANDS)) {
    if (candidate.join(' ') === key) return `git ${key}`;
  }
  throw new Error(`Refusing an unlisted git probe: ${key}`);
}
