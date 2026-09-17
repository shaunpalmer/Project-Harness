import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMemoryContext } from '../scripts/memory-context.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  return { root, write };
}

/**
 * Load `dsh/index.js` with only the unavailable DSH host dependencies stubbed and its
 * module-relative imports rewritten to absolute URLs, so a `data:` URL can resolve them.
 *
 * @returns {Promise<{ apply: Function }>} The adapter's exports.
 */
async function loadAdapter() {
  const adapter = new URL('../dsh/index.js', import.meta.url);
  const absolute = (relativePath) => pathToFileURL(fileURLToPath(new URL(relativePath, import.meta.url))).href;
  const source = fs.readFileSync(adapter, 'utf8')
    .replace("import Schema from '@deepseek-ai/schemastery';", 'const chain = () => { const o = { default: x => x, step: () => o, min: () => o, max: () => o }; return o; }; const Schema = { object: x => x, string: chain, number: chain };')
    .replace("import { defineTool } from '@deepseek-ai/dsh-tools';", 'const defineTool = x => x;')
    .replace("'./skills/plan.js'", JSON.stringify(absolute('../dsh/skills/plan.js')))
    .replace("'./skills/state.js'", JSON.stringify(absolute('../dsh/skills/state.js')))
    .replace("'./skills/git.js'", JSON.stringify(absolute('../dsh/skills/git.js')));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

/**
 * A stub host that mirrors the two behaviours the adapter depends on: service-gated
 * `inject` (the callback runs only once every requested service exists) and an
 * effect that returns its disposer.
 *
 * @param {{ shell?: object }} [services] Extra services to expose.
 * @returns {{ ctx: object, handlers: Map<string, object> }} Stub host.
 */
function stubHost(services = {}) {
  const handlers = new Map();
  const ctx = {
    ...services,
    tools: { register: (tool) => handlers.set(tool.name, tool) },
    skills: { registerProvider: () => () => {} },
    effect: (callback) => callback(),
    on: () => {},
    inject(deps, callback) {
      const names = Array.isArray(deps) ? deps : Object.keys(deps);
      if (names.some((name) => ctx[name] === undefined)) return { dispose() {} };
      callback(ctx);
      return { dispose() {} };
    },
    logger: { warn: () => {}, info: () => {} },
  };
  return { ctx, handlers };
}

test('resume returns useful context, accepted decisions, and never initialises memory', async (t) => {
  const { root, write } = fixture(t);
  const empty = await readMemoryContext(root);
  assert.equal(empty.freshness.status, 'missing');
  assert.deepEqual(fs.readdirSync(root), []);
  write('docs/NORTH-STAR.md', '## Project purpose\nBuild safely\n## Invariants\nNo live writes');
  write('docs/CURRENT-STATE.md', '## Current truth\nPrototype\n## Next action\nRun tests');
  write('docs/decisions/one.md', 'id: ADR-1\ntitle: Local only\nstatus: accepted\n');
  write('docs/decisions/two.md', 'id: ADR-2\nstatus: superseded\n');
  const result = await readMemoryContext(root);
  assert.equal(result.project, 'Build safely');
  assert.equal(result.invariants, 'No live writes');
  assert.equal(result.current_state, 'Prototype');
  assert.equal(result.next_action, 'Run tests');
  assert.equal(result.active_decisions.length, 1);
  assert.equal(result.freshness.status, 'unverified');
  assert.equal(result.writes_performed, false);
  assert.equal(fs.existsSync(path.join(root, '.harness')), false);
});

test('explicit mapping reuses notes and reports truncation without guessing a next action', async (t) => {
  const { root, write } = fixture(t);
  write('.harness/memory.json', JSON.stringify({ current_state: 'CURRENT_OUTPUTS.md' }));
  write('CURRENT_OUTPUTS.md', 'x'.repeat(70000));
  const result = await readMemoryContext(root);
  assert.equal(result.current_state.length, 4096);
  assert.equal(result.next_action, '');
  assert.equal(result.current_state_available, true);
  assert.ok(result.memory_warnings.some((w) => w.startsWith('Truncated memory file')));
});

test('malformed mappings and escaping paths fail safely', async (t) => {
  const { root, write } = fixture(t);
  write('.harness/memory.json', '{');
  assert.match((await readMemoryContext(root)).memory_warnings.join(' '), /Invalid/);
  for (const current_state of ['../outside.md', '/etc/passwd', 42, null]) {
    write('.harness/memory.json', JSON.stringify({ current_state }));
    const result = await readMemoryContext(root);
    assert.equal(result.current_state, '');
    assert.ok(result.memory_warnings.length);
  }
  const external = fixture(t);
  external.write('secret.md', 'not project memory');
  fs.symlinkSync(path.join(external.root, 'secret.md'), path.join(root, 'linked.md'));
  write('.harness/memory.json', JSON.stringify({ current_state: 'linked.md' }));
  assert.equal((await readMemoryContext(root)).current_state, '');
});

test('freshness reports dirty or changed snapshots, not semantic certainty', async (t) => {
  const { root, write } = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('commit', '--allow-empty', '-m', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  write('docs/CURRENT-STATE.md', `Verified commit: ${baseline}\n## Current truth\nBaseline`);
  assert.equal((await readMemoryContext(root)).freshness.status, 'review-needed');
  assert.equal((await readMemoryContext(root)).freshness.dirty, true);
  git('add', 'docs/CURRENT-STATE.md');
  git('commit', '-m', 'checkpoint');
  const result = await readMemoryContext(root);
  assert.equal(result.freshness.dirty, false);
  assert.equal(result.freshness.verified_commit, baseline);
  assert.equal(result.freshness.status, 'review-needed');
  assert.notEqual(result.freshness.head, baseline);
});

test('DSH registers every handler and resume uses mapped context (host API stubs)', async (t) => {
  const { root, write } = fixture(t);
  write('.harness/memory.json', JSON.stringify({ current_state: 'notes.md' }));
  write('notes.md', '## Current truth\nExisting project\n## Next action\nReview changes');
  const { apply } = await loadAdapter();

  const { ctx, handlers } = stubHost();
  apply(ctx, { projectRoot: root, skillWatchIntervalMs: 0 });

  assert.deepEqual([...handlers.keys()].sort(), [
    'project_harness_activate_skills',
    'project_harness_find_skills',
    'project_harness_inventory',
    'project_harness_resume',
    'project_harness_select_specialist',
    'project_harness_skill_catalog',
  ]);

  const result = await handlers.get('project_harness_resume').execute();
  assert.equal(result.current_state, 'Existing project');
  assert.equal(result.next_action, 'Review changes');
  assert.equal(result.harness_files_present, true);
  assert.equal(result.current_state_available, true);
  assert.equal(result.writes_performed, false);
  const inventory = await handlers.get('project_harness_inventory').execute();
  assert.equal(inventory.writes_performed, false);
  const specialist = await handlers.get('project_harness_select_specialist').execute();
  assert.equal(specialist.writes_performed, false);

  const catalog = await handlers.get('project_harness_skill_catalog').execute({}, { agent: { session: { header: { cwd: root } } } });
  assert.equal(catalog.writes_performed, false);
  assert.equal(catalog.project_root, root);
  assert.ok(catalog.visible_skills.some((entry) => entry.name === 'complexity-brake'));
  assert.equal(fs.existsSync(path.join(root, '.harness', 'state', 'skills.json')), false);

  const found = await handlers.get('project_harness_find_skills').execute({ query: 'scraping pipeline' }, { agent: { session: { header: { cwd: root } } } });
  assert.ok(found.matches.some((entry) => entry.name === 'scraping-pipeline'));
  assert.equal(found.writes_performed, false);

  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});

test('a cancelled tool call rejects instead of returning evidence', async (t) => {
  const { root } = fixture(t);
  const { apply } = await loadAdapter();

  const { ctx, handlers } = stubHost();
  apply(ctx, { projectRoot: root, skillWatchIntervalMs: 0 });

  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));

  // Every tool refuses to start work the caller already cancelled; `resume` is the one
  // that also forwards the signal into its child process.
  for (const name of ['project_harness_resume', 'project_harness_inventory', 'project_harness_skill_catalog']) {
    await assert.rejects(
      handlers.get(name).execute({}, { signal: controller.signal }),
      /caller cancelled/,
      `${name} must reject a cancelled call`,
    );
  }
});

test('a mounted shell service is selected for the git probe, with the signal forwarded', async (t) => {
  const { root, write } = fixture(t);
  write('docs/CURRENT-STATE.md', '## Current truth\nShell-seam fixture');

  const resolved = [];
  const controller = new AbortController();
  const shell = {
    resolve(request) {
      resolved.push(request);
      return request;
    },
    async run(spec) {
      // Behave like a repository whose root is this workspace.
      const text = spec.command === 'git rev-parse --show-toplevel' ? root : (spec.command === 'git rev-parse HEAD' ? 'deadbeef' : '');
      return { exitCode: 0, timedOut: false, aborted: false, timeoutMs: 2000, stdout: { text, truncated: false } };
    },
  };

  const { apply } = await loadAdapter();
  const { ctx, handlers } = stubHost({ shell });
  apply(ctx, { projectRoot: root, skillWatchIntervalMs: 0 });

  const result = await handlers.get('project_harness_resume').execute({}, { signal: controller.signal });

  assert.equal(result.freshness.head, 'deadbeef');
  assert.ok(resolved.length >= 1, 'the shell service must be used when it is mounted');
  assert.equal(resolved[0].command, 'git rev-parse --show-toplevel');
  assert.equal(resolved[0].workdir, root, 'the workspace travels as a field, not inside the command');
  assert.equal(resolved[0].signal, controller.signal, 'the caller signal reaches the seam');
  assert.equal(resolved[0].env.GIT_TERMINAL_PROMPT, '0');
});

test('without a shell service the probe falls back to the scrubbed local runner', async (t) => {
  const { root, write } = fixture(t);
  write('docs/CURRENT-STATE.md', '## Current truth\nFallback fixture');

  const { apply } = await loadAdapter();
  const { ctx, handlers } = stubHost();
  apply(ctx, { projectRoot: root, skillWatchIntervalMs: 0 });

  // No shell is mounted, so the plugin keeps its local runner: the call still completes
  // and reports a result rather than hanging on an unavailable service.
  const result = await handlers.get('project_harness_resume').execute({}, { signal: new AbortController().signal });
  assert.equal(result.writes_performed, false);
  assert.equal(typeof result.freshness.status, 'string');
});

// ---------------------------------------------------------------------------
// The git probe is injectable so the DSH path can use the harness shell seam.
// The collector's own contract is what these pin: real facts in, warnings out,
// and cancellation never laundered into a successful empty result.
// ---------------------------------------------------------------------------

test('an injected runner supplies the freshness facts', async (t) => {
  const { root, write } = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('commit', '--allow-empty', '-m', 'baseline');
  const head = git('rev-parse', 'HEAD');
  write('docs/CURRENT-STATE.md', `Verified commit: ${head}\n## Current truth\nBaseline`);

  const commands = [];
  const runGit = async (args, options) => {
    commands.push(args.join(' '));
    assert.equal(options.cwd, root);
    return git(...args);
  };

  const result = await readMemoryContext(root, { runGit });
  assert.equal(result.freshness.head, head);
  // CURRENT-STATE.md was written after the commit, so the tree is legitimately dirty.
  assert.equal(result.freshness.dirty, true);
  assert.equal(result.freshness.status, 'review-needed');
  assert.deepEqual(commands, ['rev-parse --show-toplevel', 'rev-parse HEAD', 'status --porcelain --untracked-files=normal']);
  assert.ok(!result.memory_warnings.includes('Git freshness evidence unavailable.'));
});

test('a failing runner degrades to a warning rather than throwing', async (t) => {
  const { root } = fixture(t);
  const result = await readMemoryContext(root, {
    runGit: async () => { throw new Error('git is not installed'); },
  });

  assert.ok(result.memory_warnings.includes('Git freshness evidence unavailable.'));
  assert.equal(result.freshness.head, null);
  assert.equal(result.freshness.dirty, null);
  // The fixture has no CURRENT-STATE.md, which outranks the missing git evidence.
  assert.equal(result.freshness.status, 'missing');
  assert.equal(result.writes_performed, false);
});

test('an already-aborted signal rejects instead of reporting empty freshness', async (t) => {
  const { root } = fixture(t);
  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));

  await assert.rejects(
    readMemoryContext(root, { signal: controller.signal, runGit: async () => 'ignored' }),
    /caller cancelled/,
  );
});

test('an abort raised by the runner mid-probe rejects', async (t) => {
  const { root } = fixture(t);
  const controller = new AbortController();

  const runGit = async () => {
    controller.abort(new Error('stopped by the caller'));
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };

  await assert.rejects(
    readMemoryContext(root, { signal: controller.signal, runGit }),
    /stopped by the caller/,
  );
});

test('a workspace that is not the git root reports unknown rather than a mismatched commit', async (t) => {
  const { root, write } = fixture(t);
  write('docs/CURRENT-STATE.md', '## Current truth\nNo repository here');

  // A real directory: `git rev-parse --show-toplevel` always names an existing path, and
  // the collector canonicalises it before comparing.
  const elsewhere = fixture(t);
  const result = await readMemoryContext(root, {
    runGit: async (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? elsewhere.root : 'unused'),
  });

  assert.equal(result.freshness.head, null);
  // No `Verified commit:` line in this fixture, so the snapshot is unverified rather
  // than unknown: the two are different states and must not collapse.
  assert.equal(result.freshness.status, 'unverified');
  assert.ok(!result.memory_warnings.includes('Git freshness evidence unavailable.'));
});
