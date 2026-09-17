#!/usr/bin/env node
/**
 * Run a probe against a real DeepSeek Harness checkout.
 *
 * The probes are `.mts` fixtures that import DeepSeek Harness's own packages, so they
 * must execute *inside* the checkout for bare `@deepseek-ai/*` specifiers to resolve.
 * This runner copies the fixture in, runs it with the checkout's `tsx`, parses its JSON
 * report, and removes the copy even when the probe fails.
 *
 * Usage:
 *   node scripts/dsh-integration-check.js [--fixture name] [--dsh-root /path] \
 *        [--package-root /path/to/installed/project-harness] [--json]
 *
 * `--package-root` points the probes at an installed copy instead of this checkout, which
 * is how the published artifact is verified: the shipped package must compose skills from
 * its own `.github/skills`, not only from the repository.
 *
 * With no DeepSeek Harness checkout available, the runner reports unavailability rather
 * than a false pass: these probes are an integration gate, not a hermetic unit test.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_DIRECTORY = path.join(ROOT, 'dsh', 'probes');

/** Every probe fixture, in the order the runner executes them. */
export const PROBES = [
  { name: 'live-integration', file: 'dsh-live-probe.mts', summary: 'Composition, workspace scoping, native shadowing and the invalidate round-trip against the real registry.' },
  { name: 'frontmatter-conformance', file: 'dsh-frontmatter-conformance.mts', summary: 'Every shipped skill and the frontmatter edge cases, parsed by DSH\u2019s own provider and compared field by field.' },
];

/**
 * Locate a usable DeepSeek Harness checkout.
 *
 * @param {string} [explicit] Caller-supplied root.
 * @returns {string | undefined} Absolute checkout root, or undefined when none is usable.
 */
export function findDshCheckout(explicit) {
  // An explicit argument or DSH_CHECKOUT is authoritative: silently testing a different
  // checkout than the one asked for would make a failure impossible to interpret. The
  // relative guesses apply only when neither was supplied.
  const requested = [explicit, process.env.DSH_CHECKOUT]
    .filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '');

  const candidates = requested.length > 0 ? requested : [
    // A checkout commonly sits beside this repository's parent rather than inside it,
    // so several relative layouts are probed before giving up.
    path.resolve(ROOT, '..', '..', 'deepseek-ai', 'deepseek-harness'),
    path.resolve(ROOT, '..', 'deepseek-ai', 'deepseek-harness'),
    path.resolve(ROOT, '..', '..', '..', 'deepseek-ai', 'deepseek-harness'),
  ];

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const hasRegistry = fs.existsSync(path.join(root, 'packages', 'skill', 'skill', 'src', 'index.ts'));
    const hasTsx = fs.existsSync(path.join(root, 'node_modules', 'tsx'));
    if (hasRegistry && hasTsx) return root;
  }
  return undefined;
}

/**
 * Run one probe fixture against a checkout.
 *
 * @param {{ file: string, name: string }} probe Probe to run.
 * @param {{ dshRoot: string, packageRoot?: string, timeoutMs?: number }} options Run options.
 * @returns {{ available: true, ok: boolean, report: object, stdout: string, stderr: string }} Probe outcome.
 */
export function runProbe(probe, options) {
  const source = path.join(PROBE_DIRECTORY, probe.file);
  const target = path.join(options.dshRoot, `.tmp-${path.basename(probe.file, '.mts')}-${process.pid}.mts`);

  fs.copyFileSync(source, target);
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx/esm', target, options.packageRoot ?? ROOT],
      {
        cwd: options.dshRoot,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 240000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    return { available: true, ok: true, report: parseReport(stdout), stdout, stderr: '' };
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : String(error.message ?? error);
    return { available: true, ok: false, report: parseReport(stdout), stdout, stderr };
  } finally {
    fs.rmSync(target, { force: true });
  }
}

function parseReport(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
}

function parseArgs(argv) {
  const args = { json: false, fixture: '', dshRoot: '', packageRoot: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') { args.json = true; continue; }
    if (argv[index] === '--fixture') { args.fixture = argv[index + 1] ?? ''; index += 1; continue; }
    if (argv[index] === '--dsh-root') { args.dshRoot = argv[index + 1] ?? ''; index += 1; continue; }
    if (argv[index] === '--package-root') { args.packageRoot = argv[index + 1] ?? ''; index += 1; continue; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dshRoot = findDshCheckout(args.dshRoot);

  if (dshRoot === undefined) {
    const message = 'No DeepSeek Harness checkout found. Set DSH_CHECKOUT or pass --dsh-root.';
    if (args.json) console.log(JSON.stringify({ available: false, ok: false, message }, null, 2));
    else console.log(message);
    process.exitCode = args.json ? 0 : 1;
    return;
  }

  const probes = args.fixture === ''
    ? PROBES
    : PROBES.filter((probe) => probe.name === args.fixture);

  if (probes.length === 0) {
    console.error(`Unknown fixture "${args.fixture}". Known: ${PROBES.map((probe) => probe.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const packageRoot = args.packageRoot === '' ? undefined : path.resolve(args.packageRoot);
  if (packageRoot !== undefined && !fs.existsSync(path.join(packageRoot, 'dsh', 'index.js'))) {
    console.error(`Not a Project Harness package root: ${packageRoot}`);
    process.exitCode = 1;
    return;
  }

  const outcomes = [];
  for (const probe of probes) {
    const outcome = runProbe(probe, { dshRoot, packageRoot });
    outcomes.push({ probe, outcome });
    if (args.json) continue;

    const failed = outcome.report?.failed ?? (outcome.ok ? 0 : 1);
    const total = outcome.report?.checks ?? outcome.report?.total ?? 0;
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'} ${probe.name}: ${total - failed}/${total} checks against ${packageRoot ?? ROOT}`);
    if (!outcome.ok) {
      for (const divergence of outcome.report?.detail ?? []) {
        console.log(`  - ${divergence.case ?? ''}.${divergence.field ?? ''} ours=${JSON.stringify(divergence.ours)} dsh=${JSON.stringify(divergence.dsh)}`);
      }
      if (outcome.report === undefined) console.log(outcome.stderr.split('\n').slice(0, 20).join('\n'));
    }
  }

  const ok = outcomes.every(({ outcome }) => outcome.ok);
  if (args.json) {
    console.log(JSON.stringify({
      available: true,
      ok,
      dsh_root: dshRoot,
      probes: outcomes.map(({ probe, outcome }) => ({
        name: probe.name,
        ok: outcome.ok,
        report: outcome.report,
        stderr: outcome.ok ? undefined : outcome.stderr.split('\n').slice(0, 20).join('\n'),
      })),
    }, null, 2));
  } else if (ok) {
    console.log(`\nDeepSeek Harness integration verified against ${path.relative(os.homedir(), dshRoot) || dshRoot}.`);
  }

  process.exitCode = ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
