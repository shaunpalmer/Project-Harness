import fs from 'node:fs';
import path from 'node:path';
import { GIT_PROBE_COMMANDS, abortedBy, createLocalGitRunner, throwIfAborted } from './git-probe.js';

/** The CLI's runner. The DSH path injects a seam-backed one instead. */
const defaultGitRunner = createLocalGitRunner();

/**
 * Answer the three freshness questions, or report that git could not.
 *
 * A missing repository, a nonzero exit, a timeout and a truncated stream are all
 * "no evidence" and degrade to a warning. Cancellation is different: the caller asked
 * to stop, so it is rethrown rather than dressed up as a successful empty result.
 *
 * @param {string} root Canonical workspace root.
 * @param {{ runGit?: Function, signal?: AbortSignal }} options Injected runner and caller signal.
 * @returns {Promise<{ head: string | null, dirty: boolean | null, warning?: string }>} Facts or a warning.
 */
async function collectGitFacts(root, options = {}) {
  const runGit = options.runGit ?? defaultGitRunner;
  const { signal } = options;
  const facts = { head: null, dirty: null };

  try {
    throwIfAborted(signal);
    const toplevel = await runGit(GIT_PROBE_COMMANDS.toplevel, { cwd: root, signal });
    throwIfAborted(signal);
    // Only a checkout whose root is the workspace itself yields comparable evidence.
    // `root` is already canonical, and git may report a symlinked worktree, so compare
    // canonical forms rather than raw strings.
    if (fs.realpathSync(toplevel) !== root) return facts;

    facts.head = await runGit(GIT_PROBE_COMMANDS.head, { cwd: root, signal });
    throwIfAborted(signal);
    facts.dirty = Boolean(await runGit(GIT_PROBE_COMMANDS.status, { cwd: root, signal }));
  } catch (error) {
    if (abortedBy(signal, error)) {
      // Surface why the caller stopped, not whatever the child happened to report.
      throw signal?.aborted === true && signal.reason instanceof Error ? signal.reason : error;
    }
    facts.warning = 'Git freshness evidence unavailable.';
  }

  return facts;
}

/**
 * Read-only, bounded project memory shared by the CLI and DSH adapter.
 *
 * @param {string} projectRoot Workspace root.
 * @param {{ runGit?: Function, signal?: AbortSignal }} [options] Injected git runner and caller signal.
 * @returns {Promise<object>} Compact memory context.
 */
export async function readMemoryContext(projectRoot, options = {}) {
  const root = fs.realpathSync(projectRoot);
  const warnings = [];
  const sources = {};
  function read(relativePath) {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
      warnings.push('Memory paths must be project-relative strings.');
      return '';
    }
    const candidate = path.resolve(root, relativePath);
    const inside = (file) => file.startsWith(root + path.sep);
    if (!inside(candidate)) {
      warnings.push(`Rejected outside-project memory path: ${relativePath}`);
      return '';
    }
    let fd;
    try {
      const real = fs.realpathSync(candidate);
      if (!inside(real) || !fs.statSync(real).isFile()) {
        warnings.push(`Rejected non-file or outside-project memory: ${relativePath}`);
        return '';
      }
      fd = fs.openSync(real, 'r');
      const buffer = Buffer.alloc(65537);
      const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (count > 65536) warnings.push(`Truncated memory file: ${relativePath}`);
      return buffer.subarray(0, Math.min(count, 65536)).toString('utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`Cannot read memory file: ${relativePath}`);
      return '';
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  let mapping = {};
  const rawMap = read('.harness/memory.json');
  if (rawMap) {
    try {
      mapping = JSON.parse(rawMap);
      if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error();
    } catch {
      warnings.push('Invalid .harness/memory.json; using canonical memory paths.');
      mapping = {};
    }
  }
  for (const [key, fallback] of Object.entries({ north_star: 'docs/NORTH-STAR.md', current_state: 'docs/CURRENT-STATE.md' })) {
    sources[key] = Object.hasOwn(mapping, key) ? mapping[key] : fallback;
  }
  const north = read(sources.north_star);
  const current = read(sources.current_state);
  function section(text, heading, fallback = false) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
    let value = '';
    if (start >= 0) {
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((line) => /^## /.test(line));
      value = rest.slice(0, end < 0 ? undefined : end).join('\n').trim();
    } else if (fallback) value = text.trim();
    if (value.length > 4096) warnings.push(`Truncated memory section: ${heading}`);
    return value.slice(0, 4096);
  }
  const activeDecisions = [];
  const dir = path.join(root, 'docs/decisions');
  // Do not enumerate a decisions directory symlink outside the project.
  try {
    if (fs.realpathSync(dir).startsWith(root + path.sep)) {
      const names = fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
      if (names.length > 50) warnings.push('Decision scan limited to 50 files.');
      for (const name of names.slice(0, 50)) {
        const text = read(`docs/decisions/${name}`);
        if (/^status:\s*accepted\s*$/mi.test(text)) activeDecisions.push({
          id: (text.match(/^id:\s*(.+)$/mi)?.[1]?.trim() ?? name).slice(0, 256),
          title: (text.match(/^title:\s*(.+)$/mi)?.[1]?.trim() ?? name).slice(0, 512),
        });
      }
    }
  } catch { /* Missing decisions are valid for an existing project. */ }
  const verifiedCommit = current.match(/^Verified commit:\s*([a-f0-9]{40})\s*$/mi)?.[1] ?? null;
  const gitFacts = await collectGitFacts(root, options);
  if (gitFacts.warning !== undefined) warnings.push(gitFacts.warning);
  const { head, dirty } = gitFacts;
  const freshness = {
    status: !current ? 'missing' : !verifiedCommit ? 'unverified' : !head || dirty === null ? 'unknown'
      : verifiedCommit !== head || dirty ? 'review-needed' : 'matches-snapshot',
    verified_commit: verifiedCommit, head, dirty,
  };
  if (freshness.status !== 'matches-snapshot') warnings.push(`Memory freshness: ${freshness.status}; reconcile against code and tests before relying on it.`);
  return {
    project: section(north, 'Project purpose', true),
    invariants: section(north, 'Invariants'),
    current_state: section(current, 'Current truth', true),
    next_action: section(current, 'Next action'),
    active_decisions: activeDecisions,
    memory_sources: sources,
    current_state_available: Boolean(current), north_star_available: Boolean(north),
    freshness, memory_warnings: warnings, writes_performed: false,
  };
}
