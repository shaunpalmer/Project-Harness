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

test('resume returns useful context, accepted decisions, and never initialises memory', (t) => {
  const { root, write } = fixture(t);
  const empty = readMemoryContext(root);
  assert.equal(empty.freshness.status, 'missing');
  assert.deepEqual(fs.readdirSync(root), []);
  write('docs/NORTH-STAR.md', '## Project purpose\nBuild safely\n## Invariants\nNo live writes');
  write('docs/CURRENT-STATE.md', '## Current truth\nPrototype\n## Next action\nRun tests');
  write('docs/decisions/one.md', 'id: ADR-1\ntitle: Local only\nstatus: accepted\n');
  write('docs/decisions/two.md', 'id: ADR-2\nstatus: superseded\n');
  const result = readMemoryContext(root);
  assert.equal(result.project, 'Build safely');
  assert.equal(result.invariants, 'No live writes');
  assert.equal(result.current_state, 'Prototype');
  assert.equal(result.next_action, 'Run tests');
  assert.equal(result.active_decisions.length, 1);
  assert.equal(result.freshness.status, 'unverified');
  assert.equal(result.writes_performed, false);
  assert.equal(fs.existsSync(path.join(root, '.harness')), false);
});

test('explicit mapping reuses notes and reports truncation without guessing a next action', (t) => {
  const { root, write } = fixture(t);
  write('.harness/memory.json', JSON.stringify({ current_state: 'CURRENT_OUTPUTS.md' }));
  write('CURRENT_OUTPUTS.md', 'x'.repeat(70000));
  const result = readMemoryContext(root);
  assert.equal(result.current_state.length, 4096);
  assert.equal(result.next_action, '');
  assert.equal(result.current_state_available, true);
  assert.ok(result.memory_warnings.some((w) => w.startsWith('Truncated memory file')));
});

test('malformed mappings and escaping paths fail safely', (t) => {
  const { root, write } = fixture(t);
  write('.harness/memory.json', '{');
  assert.match(readMemoryContext(root).memory_warnings.join(' '), /Invalid/);
  for (const current_state of ['../outside.md', '/etc/passwd', 42, null]) {
    write('.harness/memory.json', JSON.stringify({ current_state }));
    const result = readMemoryContext(root);
    assert.equal(result.current_state, '');
    assert.ok(result.memory_warnings.length);
  }
  const external = fixture(t);
  external.write('secret.md', 'not project memory');
  fs.symlinkSync(path.join(external.root, 'secret.md'), path.join(root, 'linked.md'));
  write('.harness/memory.json', JSON.stringify({ current_state: 'linked.md' }));
  assert.equal(readMemoryContext(root).current_state, '');
});

test('freshness reports dirty or changed snapshots, not semantic certainty', (t) => {
  const { root, write } = fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('commit', '--allow-empty', '-m', 'baseline');
  const baseline = git('rev-parse', 'HEAD');
  write('docs/CURRENT-STATE.md', `Verified commit: ${baseline}\n## Current truth\nBaseline`);
  assert.equal(readMemoryContext(root).freshness.status, 'review-needed');
  assert.equal(readMemoryContext(root).freshness.dirty, true);
  git('add', 'docs/CURRENT-STATE.md');
  git('commit', '-m', 'checkpoint');
  const result = readMemoryContext(root);
  assert.equal(result.freshness.dirty, false);
  assert.equal(result.freshness.verified_commit, baseline);
  assert.equal(result.freshness.status, 'review-needed');
  assert.notEqual(result.freshness.head, baseline);
});

test('DSH registers every handler and resume uses mapped context (host API stubs)', async (t) => {
  const { root, write } = fixture(t);
  write('.harness/memory.json', JSON.stringify({ current_state: 'notes.md' }));
  write('notes.md', '## Current truth\nExisting project\n## Next action\nReview changes');
  const adapter = new URL('../dsh/index.js', import.meta.url);
  const absolute = (relativePath) => pathToFileURL(fileURLToPath(new URL(relativePath, import.meta.url))).href;
  // Stub only unavailable DSH host dependencies and rewrite the module-relative
  // imports to absolute URLs, then execute the actual adapter source.
  const source = fs.readFileSync(adapter, 'utf8')
    .replace("import Schema from '@deepseek-ai/schemastery';", 'const Schema = { object: x => x, string: () => ({ default: x => x }), number: () => ({ default: x => x }) };')
    .replace("import { defineTool } from '@deepseek-ai/dsh-tools';", 'const defineTool = x => x;')
    .replace("'./skills/plan.js'", JSON.stringify(absolute('../dsh/skills/plan.js')))
    .replace("'./skills/state.js'", JSON.stringify(absolute('../dsh/skills/state.js')));
  const { apply } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  const handlers = new Map();
  const ctx = {
    tools: { register: (tool) => handlers.set(tool.name, tool) },
    skills: { registerProvider: () => () => {} },
    effect: (callback) => callback(),
    on: () => {},
    logger: { warn: () => {}, info: () => {} },
  };
  apply(ctx, { projectRoot: root, skillWatchIntervalMs: 0 });

  assert.deepEqual([...handlers.keys()].sort(), [
    'project_harness_activate_skills',
    'project_harness_find_skills',
    'project_harness_inventory',
    'project_harness_resume',
    'project_harness_select_specialist',
    'project_harness_skill_catalog',
  ]);

  const result = JSON.parse(await handlers.get('project_harness_resume').execute());
  assert.equal(result.current_state, 'Existing project');
  assert.equal(result.next_action, 'Review changes');
  assert.equal(result.harness_files_present, true);
  assert.equal(result.current_state_available, true);
  assert.equal(result.writes_performed, false);
  const inventory = JSON.parse(await handlers.get('project_harness_inventory').execute());
  assert.equal(inventory.writes_performed, false);
  const specialist = JSON.parse(await handlers.get('project_harness_select_specialist').execute());
  assert.equal(specialist.writes_performed, false);

  const catalog = JSON.parse(await handlers.get('project_harness_skill_catalog').execute({}, { agent: { session: { header: { cwd: root } } } }));
  assert.equal(catalog.writes_performed, false);
  assert.equal(catalog.project_root, root);
  assert.ok(catalog.visible_skills.some((entry) => entry.name === 'complexity-brake'));
  assert.equal(fs.existsSync(path.join(root, '.harness', 'state', 'skills.json')), false);

  const found = JSON.parse(await handlers.get('project_harness_find_skills').execute({ query: 'scraping pipeline' }, { agent: { session: { header: { cwd: root } } } }));
  assert.ok(found.matches.some((entry) => entry.name === 'scraping-pipeline'));
  assert.equal(found.writes_performed, false);

  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});
