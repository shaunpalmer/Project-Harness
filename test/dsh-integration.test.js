import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));

test('DSH bundle manifest points to the Project Harness Cordis patch', () => {
  const packageJson = readJson('package.json');
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(packageJson.main, 'dsh/index.js');
  assert.match(read('cordis.patch.yml'), /name: project-harness\s*$/m);
});

test('the DSH entry point is a thin shell over the testable skill modules', () => {
  const adapter = read('dsh/index.js');
  assert.match(adapter, /inject = \['tools', 'skills'\]/);
  assert.match(adapter, /from '\.\/skills\/plan\.js'/);
  assert.match(adapter, /project_harness_resume/);
  assert.match(adapter, /project_harness_inventory/);
  assert.match(adapter, /project_harness_select_specialist/);
  assert.match(adapter, /project_harness_skill_catalog/);
  assert.match(adapter, /project_harness_find_skills/);
  assert.match(adapter, /project_harness_activate_skills/);
  assert.match(adapter, /read-only/);
});

test('the plugin entry keeps the namespace export shape the Loader requires', () => {
  const adapter = read('dsh/index.js');

  // The cordis Loader's `unwrapExports` prefers `.default` over the module namespace, so a
  // stray `export default apply` silently discards `inject` and the plugin loads with no
  // services. docs/testing.md requires this assertion next to a Loader round trip; the live
  // probe performs the real `unwrapExports` call.
  assert.doesNotMatch(adapter, /export\s+default\b/);
  for (const exported of ['name', 'inject', 'Config', 'apply']) {
    assert.match(adapter, new RegExp(`export (?:const|function) ${exported}\\b`), `dsh/index.js must export ${exported} as a named export`);
  }
});

test('the DSH entry point performs no filesystem writes and starts no processes', () => {
  const adapter = read('dsh/index.js');
  assert.doesNotMatch(adapter, /execFile|spawn|process\.cwd\(\)|writeFile|renameSync|mkdirSync|rmSync/);
  // The read-only git probe is delegated to skills/git.js, which runs it through the
  // harness shell seam rather than spawning anything itself.
  assert.doesNotMatch(adapter, /node:child_process/);
  assert.match(adapter, /from '\.\/skills\/git\.js'/);
});

test('workspace selection is explicit, cwd-sensitive and rejects the DSH checkout', () => {
  const plan = read('dsh/skills/plan.js');
  assert.match(read('dsh/index.js'), /PROJECT_HARNESS_ROOT \?\? ''/);
  assert.match(plan, /WORKSPACE_NOT_CONFIGURED/);
  assert.match(plan, /WORKSPACE_NOT_FOUND/);
  assert.match(plan, /DSH_CHECKOUT_REJECTED/);
  assert.match(plan, /findProjectRoot/);
  assert.doesNotMatch(plan, /process\.cwd\(\)/);
});

test('the skill provider follows the DSH provider contract', () => {
  const plan = read('dsh/skills/plan.js');
  assert.match(plan, /registerProvider\(\(control\)/);
  assert.match(plan, /control\.invalidate\(\)/);
  assert.match(plan, /async list\(options = \{\}\)/);
  assert.match(plan, /async get\(candidate, options = \{\}\)/);
  assert.match(plan, /options\.cwd/);
  assert.match(plan, /const HARNESS_SKILL_RANK = 600/);
  assert.match(plan, /source: HARNESS_SKILL_SOURCE/);
  assert.match(plan, /provider: SKILL_PROVIDER_NAME/);
  assert.match(plan, /resourceBase: \{ kind: 'directory'/);
  // The catalogue is kept fresh by a poll and the host mutation recorder.
  assert.match(plan, /setInterval/);
  assert.match(plan, /ctx\.on\('fs\/observed'/);
});

test('the single workspace write is the activation record', () => {
  const state = read('dsh/skills/state.js');
  assert.match(state, /SKILL_STATE_PATH = '\.harness\/state\/skills\.json'/);
  assert.match(state, /renameSync/);
  assert.doesNotMatch(state, /execFile|spawn|node:child_process/);
  // The temp file must be unpredictable, exclusive and owner-only.
  assert.match(state, /randomBytes/);
  assert.match(state, /flag: 'wx'/);
  assert.match(state, /mode: 0o600/);
  assert.equal(
    fs.existsSync(path.join(ROOT, '.harness', 'state', 'skills.json')),
    false,
    'installing the harness must not create an activation record',
  );
});

test('specialist presets compose capabilities instead of listing paths', () => {
  const wordpress = readJson('dsh/specialists/wordpress-coding.json');
  assert.equal(wordpress.id, 'wordpress-coding');
  assert.deepEqual(wordpress.specialist_skills, ['wordpress-plugin', 'wordpress-way']);
  assert.ok(wordpress.capability_skills.includes('database'));
  assert.ok(wordpress.capability_skills.includes('api'));
  assert.ok(wordpress.default_capabilities.includes('testing'));
  assert.equal(wordpress.required_skills, undefined);
  assert.ok(wordpress.excluded_domains.includes('sales'));
  assert.ok(wordpress.excluded_domains.includes('seo'));

  const python = readJson('dsh/specialists/python-prospecting.json');
  assert.equal(python.id, 'python-prospecting');
  assert.deepEqual(python.specialist_skills, ['scraping-pipeline']);
  assert.deepEqual(python.default_capabilities, ['testing', 'logging']);
  assert.equal(python.required_skills, undefined);

  const generic = readJson('dsh/specialists/generic.json');
  assert.equal(generic.id, 'generic');
  assert.deepEqual(generic.specialist_skills, []);
  assert.ok(generic.capability_skills.includes('testing'));
});

test('every preset file name matches the id it declares', () => {
  const directory = path.join(ROOT, 'dsh', 'specialists');
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith('.json')) continue;
    const preset = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    assert.equal(preset.id, path.basename(file, '.json'));
  }
});

test('the capability vocabulary is data, not hard-coded composition', () => {
  const vocabulary = readJson('dsh/skills/capabilities.json');
  assert.equal(vocabulary.schema_version, 1);
  assert.deepEqual(vocabulary.core_skills, [
    'complexity-brake',
    'loop-controller',
    'project-memory',
    'skill-router',
  ]);
  assert.deepEqual(vocabulary.discovery_skills, ['find-skills']);

  for (const [capability, definition] of Object.entries(vocabulary.capabilities)) {
    assert.ok(Array.isArray(definition.skills) && definition.skills.length > 0, `${capability} binds no skills`);
    assert.ok(Array.isArray(definition.evidence), `${capability} needs an evidence list`);
  }
});

test('the package declares the documented dependency roles and ships what it reads', () => {
  const packageJson = readJson('package.json');

  // Cordis and the tool registry are provided by the host at runtime, so they are peers.
  // Schemastery is a runtime validator and belongs in dependencies, matching the
  // documented package pattern and the published dsh-github-intelligence bundle. pnpm
  // reports the two peers as missing because a profile lists the host bundles rather than
  // depending on them; that warning is inherent to an out-of-tree DSH bundle.
  assert.deepEqual(Object.keys(packageJson.peerDependencies).sort(), [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-tools',
  ]);
  assert.deepEqual(Object.keys(packageJson.dependencies), ['@deepseek-ai/schemastery']);

  // The plugin reads these from its own package root, so the published package must carry
  // them. A missing entry here breaks the installed bundle while the source checkout still
  // works, which is exactly the failure a files allowlist can introduce.
  // Both surfaces must survive publication: the DSH bundle reads dsh/, cordis.patch.yml,
  // .github/skills and scripts/memory-context.js from its own root, and the toolkit keeps
  // its scripts and root contracts. tests, docs, planning artifacts and dsh/probes are
  // development-only and are deliberately not published.
  for (const shipped of ['cordis.patch.yml', 'dsh/index.js', 'dsh/skills', 'dsh/specialists', '.github/skills', 'scripts', 'ENGINEERING-DEFAULTS.md', 'AGENTS.md']) {
    assert.ok(packageJson.files.includes(shipped), `package files must include ${shipped}`);
  }
});
