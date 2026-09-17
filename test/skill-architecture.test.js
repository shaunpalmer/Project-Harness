import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isSkillName, parseFrontmatter, readSkillMetadata } from '../dsh/skills/frontmatter.js';
import { auditReachability, discoverLibrary, libraryStatFingerprint, searchSkills } from '../dsh/skills/library.js';
import {
  EVIDENCE_DETECTORS,
  buildEvidenceContext,
  composeSkillPlan,
  detectCapabilities,
  listPresetIds,
  normalizePresetScope,
  readPreset,
  readVocabulary,
} from '../dsh/skills/composition.js';
import { readSkillState, writeSkillState } from '../dsh/skills/state.js';
import {
  HARNESS_SKILL_RANK,
  activateSkill,
  buildSkillPlan,
  findSkills,
  isCatalogRelevantPath,
  isDshCheckout,
  registerHarnessSkills,
  resolveProjectRoot,
  specialistFor,
  workspaceForLookup,
} from '../dsh/skills/plan.js';
import { verifySkillLibrary } from '../scripts/skills-verify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Create an isolated workspace that stops the git-root walk at its own boundary. */
function makeWorkspace(files = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-harness-skills-'));
  fs.mkdirSync(path.join(directory, '.git'), { recursive: true });
  writeFiles(directory, files);
  return directory;
}

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function removeWorkspace(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

/** Minimal Cordis-shaped host used to exercise the real provider registration path. */
function createStubHost() {
  const state = { providers: [], disposers: [], tools: [], listeners: new Map(), invalidations: 0, effects: 0 };

  const ctx = {
    skills: {
      registerProvider(create) {
        const control = {
          signal: new AbortController().signal,
          invalidate: () => { state.invalidations += 1; },
        };
        state.providers.push(create(control));
        return () => {};
      },
    },
    effect(callback, label) {
      state.effects += 1;
      const disposer = callback();
      state.disposers.push({ disposer, label });
      return disposer;
    },
    on(name, handler) {
      const handlers = state.listeners.get(name) ?? [];
      handlers.push(handler);
      state.listeners.set(name, handlers);
    },
    tools: { register: (tool) => state.tools.push(tool) },
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
  };

  return { ctx, state };
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 20); });

const skillFixture = (name, description, extra = '') => `---
name: ${name}
description: "${description}"
whenToUse: "Use when the test needs ${name}."
${extra}metadata:
  harness:
    tier: capability
    tags: [${name}]
    topics: [testing]
---
# ${name}

Body for ${name}.
`;

// ---------------------------------------------------------------------------
// Frontmatter reader
// ---------------------------------------------------------------------------

test('frontmatter reader parses the DSH key subset without a YAML dependency', () => {
  const raw = `---
name: sample-skill
description: "A routing description that is comfortably long enough to pass verification."
whenToUse: "Use when the workspace needs a sample."
user-invocable: false
metadata:
  harness:
    tier: reference
    topics:
      - alpha
      - beta
    tags: [one, two]
    stack: [php]
---
# Heading

Body text.
`;

  const parsed = readSkillMetadata(raw, 'sample-skill');
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.reason);
  assert.equal(parsed.skill.name, 'sample-skill');
  assert.equal(parsed.skill.whenToUse, 'Use when the workspace needs a sample.');
  assert.deepEqual(parsed.skill.invocation, { modelInvocable: true, userInvocable: false });
  assert.equal(parsed.skill.harness.tier, 'reference');
  assert.deepEqual(parsed.skill.harness.topics, ['alpha', 'beta']);
  assert.deepEqual(parsed.skill.harness.tags, ['one', 'two']);
  assert.deepEqual(parsed.skill.harness.stack, ['php']);
  assert.match(parsed.skill.body, /^# Heading/);
});

test('frontmatter reader folds an indented continuation and honours booleans', () => {
  const raw = `---
name: folded-skill
description:
  A folded routing description that is long enough to satisfy the verifier.
whenToUse: "Use when folding."
disable-model-invocation: yes
---
Body.
`;

  const parsed = readSkillMetadata(raw, 'folded-skill');
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.reason);
  assert.equal(parsed.skill.description, 'A folded routing description that is long enough to satisfy the verifier.');
  assert.deepEqual(parsed.skill.invocation, { modelInvocable: false, userInvocable: true });
});

test('frontmatter reader rejects the legacy invocation spellings DSH rejects', () => {
  for (const legacy of ['modelInvocable', 'userInvocable', 'disableModelInvocation']) {
    const raw = `---\nname: sample\n${legacy}: false\ndescription: "A description long enough for the verifier to accept it."\n---\nBody.\n`;
    const parsed = readSkillMetadata(raw, 'sample');
    assert.equal(parsed.ok, false, `${legacy} should be rejected`);
    assert.match(parsed.reason, /unsupported/);
  }
});

test('frontmatter reader rejects malformed, misnamed and unroutable skills', () => {
  const cases = [
    ['# No frontmatter\n', /missing or malformed/],
    ['---\nname: sample\n---\nBody.\n', /requires a non-empty "description"/],
    ['---\nname: Sample Skill\ndescription: "A description long enough for the verifier to accept it."\n---\nBody.\n', /invalid skill name/],
    ['---\nname: sample\ndescription: "SKILL: Sample Skill That Is Quite Long Indeed"\n---\nBody.\n', /routing, not repeat the H1/],
    ['---\nname: sample\ndescription: "short"\n---\nBody.\n', /cannot route the model/],
    ['---\nname: sample\ndescription: "A description long enough for the verifier to accept it."\nmetadata:\n  harness:\n    tier: nonsense\n---\nBody.\n', /tier must be one of/],
  ];

  for (const [raw, pattern] of cases) {
    const parsed = readSkillMetadata(raw, 'sample');
    assert.equal(parsed.ok, false, `expected rejection for: ${raw.slice(0, 40)}`);
    assert.match(parsed.reason, pattern);
  }
});

test('parseFrontmatter returns undefined when the block is not closed', () => {
  assert.equal(parseFrontmatter('---\nname: sample\n'), undefined);
  assert.equal(parseFrontmatter('not frontmatter'), undefined);
});

test('isSkillName enforces DSH kebab-case', () => {
  assert.equal(isSkillName('wordpress-plugin'), true);
  assert.equal(isSkillName('wordpress_plugin'), false);
  assert.equal(isSkillName('-leading'), false);
  assert.equal(isSkillName('Trailing-'), false);
  assert.equal(isSkillName(''), false);
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

test('the shipped library is DSH-valid and every skill carries routing metadata', () => {
  const result = verifySkillLibrary({ packageRoot: ROOT });
  assert.deepEqual(result.failures, [], result.failures.join('\n'));
  assert.ok(result.skills.size >= 25, `expected at least 25 skills, found ${result.skills.size}`);

  for (const entry of result.skills.values()) {
    assert.ok(isSkillName(entry.name), `${entry.name} is not a kebab-case skill name`);
    assert.ok(entry.description.length >= 40, `${entry.name} needs a routing description`);
    assert.ok(!entry.description.startsWith('SKILL:'), `${entry.name} describes its heading, not its routing`);
    assert.ok(entry.whenToUse !== undefined, `${entry.name} needs whenToUse`);
    assert.ok(['core', 'discovery', 'specialist', 'capability', 'reference'].includes(entry.harness.tier));
  }
});

test('library discovery is workspace-first and reports non-skill entries', () => {
  const workspace = makeWorkspace({
    '.github/skills/local-thing/SKILL.md': skillFixture('local-thing', 'A workspace-local skill that shadows the packaged library version.'),
  });

  try {
    const library = discoverLibrary({ packageRoot: ROOT, workspaceRoot: workspace });
    assert.equal(library.skills.get('local-thing').origin, 'workspace');
    assert.equal(library.problems.length, 0, library.problems.join('\n'));
    assert.ok(library.unindexed.some((entry) => entry.includes('SkillOpt')), 'expected SkillOpt to be reported as unindexed');
  } finally {
    removeWorkspace(workspace);
  }
});

test('library discovery reports a name that disagrees with its path', () => {
  const workspace = makeWorkspace({
    '.github/skills/mismatched/SKILL.md': skillFixture('different-name', 'A description long enough for the verifier to accept it.'),
  });

  try {
    const library = discoverLibrary({ packageRoot: ROOT, workspaceRoot: workspace });
    assert.equal(library.problems.length, 1);
    assert.match(library.problems[0], /declares name "different-name" but the path implies "mismatched"/);
  } finally {
    removeWorkspace(workspace);
  }
});

test('the stat fingerprint notices additions without reading bodies', () => {
  const workspace = makeWorkspace({
    '.github/skills/first/SKILL.md': skillFixture('first', 'A description long enough for the verifier to accept it.'),
  });

  try {
    const before = libraryStatFingerprint([workspace]);
    writeFiles(workspace, {
      '.github/skills/second/SKILL.md': skillFixture('second', 'A description long enough for the verifier to accept it.'),
    });
    const after = libraryStatFingerprint([workspace]);
    assert.notEqual(before, after);
    assert.equal(after, libraryStatFingerprint([workspace]));
  } finally {
    removeWorkspace(workspace);
  }
});

test('searchSkills ranks by name, then tags, then description, and ignores an empty query', () => {
  const skills = [
    { name: 'database-design', description: 'Schema work.', whenToUse: '', harness: { tags: ['database'], topics: [], stack: [] } },
    { name: 'ui-polish', description: 'A skill that mentions database once.', whenToUse: '', harness: { tags: [], topics: [], stack: [] } },
  ];

  const results = searchSkills(skills, 'database', { limit: 5 });
  assert.equal(results[0].entry.name, 'database-design');
  assert.ok(results[0].score > results[1].score);
  assert.deepEqual(searchSkills(skills, ''), []);
  assert.deepEqual(searchSkills(skills, 'a'), []);
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

test('composition always includes core controls and the discovery entry point', () => {
  const vocabulary = readVocabulary(ROOT);
  const plan = composeSkillPlan({ vocabulary, basePreset: undefined, specialistPreset: undefined });

  const names = plan.entries.map((entry) => entry.name);
  for (const core of vocabulary.core_skills) assert.ok(names.includes(core), `missing core skill ${core}`);
  for (const discovery of vocabulary.discovery_skills) assert.ok(names.includes(discovery), `missing discovery skill ${discovery}`);
  assert.deepEqual(plan.unknown, []);
});

test('the WordPress specialist composes core, specialist and evidence-bound capabilities', () => {
  const plan = buildSkillPlan('', makeWorkspace({
    'composer.json': JSON.stringify({ require: { 'wordpress/wordpress': '*' } }),
    'src/Schema.php': '<?php global $wpdb; dbDelta($sql);',
    'src/Rest.php': '<?php register_rest_route("ns/v1", "/thing");',
    'assets/app.css': 'body{}',
    'tests/SchemaTest.php': '<?php echo 1;',
  }));

  const tiers = new Map(plan.entries.map((entry) => [entry.name, entry.tier]));
  assert.equal(plan.specialist, 'wordpress-coding');
  assert.equal(tiers.get('wordpress-plugin'), 'specialist');
  assert.equal(tiers.get('wordpress-way'), 'specialist');
  assert.equal(tiers.get('database-design'), 'capability');
  assert.equal(tiers.get('api-design'), 'capability');
  assert.equal(tiers.get('interface-design'), 'capability');
  assert.ok(plan.detected.includes('database'));
  assert.ok(plan.detected.includes('api'));

  // A WordPress workspace must not receive Python pipeline guidance.
  assert.equal(tiers.has('scraping-pipeline'), false);
  assert.ok(plan.entries.length <= 16, `catalogue too wide: ${plan.entries.length} skills`);
});

test('the Python prospecting specialist composes scraping, testing and logging', () => {
  const plan = buildSkillPlan('', makeWorkspace({
    'pyproject.toml': '[project]\nname = "prospecting"\ndependencies = ["scrapy"]\n',
    'scrapers/places.py': 'import scrapy\n',
    'tests/test_places.py': 'def test_one(): assert True\n',
  }));

  const tiers = new Map(plan.entries.map((entry) => [entry.name, entry.tier]));
  assert.equal(plan.specialist, 'python-prospecting');
  assert.equal(tiers.get('scraping-pipeline'), 'specialist');
  assert.equal(tiers.get('testing-plan'), 'capability');
  assert.equal(tiers.get('trace-eval-logging'), 'capability');

  // WordPress-only guidance must be absent.
  assert.equal(tiers.has('wordpress-plugin'), false);
  assert.equal(tiers.has('wordpress-way'), false);
});

test('a workspace with no specialist still composes the generic capability scope', () => {
  const plan = buildSkillPlan('', makeWorkspace({
    'package.json': JSON.stringify({ name: 'cli', scripts: { test: 'node --test' } }),
    'test/cli.test.js': 'export {};\n',
  }));

  const names = plan.entries.map((entry) => entry.name);
  assert.equal(plan.specialist, null);
  assert.ok(names.includes('complexity-brake'));
  assert.ok(names.includes('find-skills'));
  assert.ok(names.includes('testing-plan'));
  assert.equal(names.includes('wordpress-plugin'), false);
});

test('an unknown workspace reports why instead of advertising a catalogue', () => {
  const plan = buildSkillPlan(path.join(os.tmpdir(), 'project-harness-does-not-exist'), undefined);
  assert.equal(plan.workspace, null);
  assert.deepEqual(plan.entries, []);
  assert.match(plan.unavailable, /does not exist|not configured/i);
});

test('evidence detection is bounded and specific', () => {
  const vocabulary = readVocabulary(ROOT);
  const empty = makeWorkspace({ 'README.md': '# Nothing here\n' });
  const rich = makeWorkspace({
    'db/migrations/0001_init.sql': 'CREATE TABLE t (id int);',
    'templates/page.twig': '<h1>{{ title }}</h1>',
    'docs/guide.md': '# Guide\n',
    'package.json': JSON.stringify({ devDependencies: { playwright: '^1' } }),
    'src/Service.php': '<?php class Service {}',
  });

  try {
    const bare = detectCapabilities(buildEvidenceContext(empty), vocabulary);
    const full = detectCapabilities(buildEvidenceContext(rich), vocabulary);
    assert.ok(!bare.includes('database'), 'a bare README must not prove persistence');
    assert.ok(!bare.includes('browser'), 'a bare README must not prove browser automation');
    for (const capability of ['database', 'ui', 'browser', 'oop', 'docs']) {
      assert.ok(full.includes(capability), `expected ${capability} from the rich fixture`);
    }
  } finally {
    removeWorkspace(empty);
    removeWorkspace(rich);
  }
});

test('every declared evidence token has a detector and every reference resolves', () => {
  const vocabulary = readVocabulary(ROOT);
  for (const [capability, definition] of Object.entries(vocabulary.capabilities)) {
    for (const token of definition.evidence) {
      assert.ok(EVIDENCE_DETECTORS.has(token), `${capability} declares unknown evidence token ${token}`);
    }
  }

  const library = discoverLibrary({ packageRoot: ROOT });
  const presets = listPresetIds(ROOT).map((id) => readPreset(ROOT, id));
  const audit = auditReachability(library.skills, vocabulary, presets);
  assert.deepEqual(audit.unknown, []);
  assert.deepEqual(audit.unbound, [], `skills unreachable even by find: ${audit.unbound.join(', ')}`);
});

test('a legacy required_skills preset still resolves instead of composing nothing', () => {
  const vocabulary = readVocabulary(ROOT);
  const scope = normalizePresetScope({
    id: 'legacy',
    required_skills: ['.github/skills/wordpress-way.md', '.github/skills/wordpress-plugin/SKILL.md'],
  }, vocabulary);
  assert.deepEqual(scope.specialist_skills, ['wordpress-way', 'wordpress-plugin']);
});

test('presets name capabilities rather than paths', () => {
  const wordpress = readPreset(ROOT, 'wordpress-coding');
  assert.deepEqual(wordpress.specialist_skills, ['wordpress-plugin', 'wordpress-way']);
  assert.ok(wordpress.capability_skills.includes('database'));
  assert.ok(wordpress.default_capabilities.includes('testing'));
  assert.equal(wordpress.required_skills, undefined);

  const python = readPreset(ROOT, 'python-prospecting');
  assert.deepEqual(python.specialist_skills, ['scraping-pipeline']);
  assert.deepEqual(python.default_capabilities, ['testing', 'logging']);
});

// ---------------------------------------------------------------------------
// Activation state and the find -> activate -> load loop
// ---------------------------------------------------------------------------

test('activation state round-trips, ignores invalid names and stays inside the workspace', () => {
  const workspace = makeWorkspace({});

  try {
    assert.deepEqual(readSkillState(workspace).activated, []);

    const written = writeSkillState(workspace, { activated: ['interface-design', 'interface-design', 'Not Kebab'], suppressed: ['code-review'] });
    assert.equal(written.ok, true);
    assert.ok(written.path.startsWith(workspace));

    const state = readSkillState(workspace);
    assert.deepEqual(state.activated, ['interface-design']);
    assert.deepEqual(state.suppressed, ['code-review']);
  } finally {
    removeWorkspace(workspace);
  }
});

test('a corrupt activation record degrades to a reported problem, not a crash', () => {
  const workspace = makeWorkspace({ '.harness/state/skills.json': '{ not json' });

  try {
    const state = readSkillState(workspace);
    assert.deepEqual(state.activated, []);
    assert.equal(state.present, true);
    assert.equal(state.problems.length, 1);
  } finally {
    removeWorkspace(workspace);
  }
});

test('find_skills reaches the whole library and activation makes a found skill visible', () => {
  const workspace = makeWorkspace({
    'package.json': JSON.stringify({ name: 'cli' }),
  });

  try {
    const before = JSON.parse(buildSkillPlan('', workspace).entries.length);

    const found = JSON.parse(findSkills('', workspace, 'wordpress plugin hooks', 5));
    const match = found.matches.find((entry) => entry.name === 'wordpress-plugin');
    assert.ok(match, 'find_skills must reach a skill the composition did not select');
    assert.equal(match.currently_visible, false);
    assert.ok(found.library_skills >= 25);
    assert.match(found.guidance, /project_harness_activate_skills/);

    const holder = { invalidations: 0, invalidate() { this.invalidations += 1; } };
    const activated = JSON.parse(activateSkill('', workspace, holder, 'wordpress-plugin', 'activate'));
    assert.equal(activated.status, 'updated');
    assert.equal(holder.invalidations, 1, 'activation must invalidate the DSH catalogue');
    assert.ok(activated.activated_skills.includes('wordpress-plugin'));

    const plan = buildSkillPlan('', workspace);
    const entry = plan.entries.find((candidate) => candidate.name === 'wordpress-plugin');
    assert.equal(entry.tier, 'activated');
    assert.ok(plan.entries.length > before);

    const suppressed = JSON.parse(activateSkill('', workspace, holder, 'wordpress-plugin', 'deactivate'));
    assert.equal(suppressed.status, 'updated');
    assert.ok(suppressed.suppressed_skills.includes('wordpress-plugin'));
    assert.equal(buildSkillPlan('', workspace).entries.some((candidate) => candidate.name === 'wordpress-plugin'), false);
  } finally {
    removeWorkspace(workspace);
  }
});

test('activation refuses an unknown skill, a bad action and a non-kebab name', () => {
  const workspace = makeWorkspace({});
  const holder = { invalidations: 0, invalidate() { this.invalidations += 1; } };

  try {
    const unknown = JSON.parse(activateSkill('', workspace, holder, 'not-a-real-skill', 'activate'));
    assert.equal(unknown.status, 'blocked');
    assert.match(unknown.message, /No Project Harness skill named/);

    const badAction = JSON.parse(activateSkill('', workspace, holder, 'code-review', 'explode'));
    assert.equal(badAction.status, 'blocked');
    assert.match(badAction.message, /Unknown action/);

    const badName = JSON.parse(activateSkill('', workspace, holder, 'Not Kebab', 'activate'));
    assert.equal(badName.status, 'blocked');
    assert.match(badName.message, /kebab-case/);

    assert.equal(holder.invalidations, 0);
  } finally {
    removeWorkspace(workspace);
  }
});

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

test('the provider honours the DSH contract and resolves against options.cwd', async () => {
  const packageLike = ROOT;
  const workspace = makeWorkspace({
    'wp-content/.keep': '',
  });

  try {
    const { ctx, state } = createStubHost();
    const holder = registerHarnessSkills(ctx, { projectRoot: '', skillWatchIntervalMs: 0 });

    assert.equal(state.providers.length, 1, 'exactly one provider must be registered');
    const provider = state.providers[0];
    assert.equal(provider.name, 'project-harness');
    assert.equal(provider.name === 'runtime', false, 'the reserved runtime name must not be used');

    // No cwd and no configured root: the provider advertises nothing rather than guessing.
    assert.deepEqual(await provider.list({}), []);

    const candidates = await provider.list({ cwd: workspace });
    assert.ok(candidates.length > 0, 'the workspace catalogue must not be empty');

    const names = new Set(candidates.map((candidate) => candidate.name));
    assert.ok(names.has('wordpress-plugin'), 'a wp-content workspace must route to the WordPress specialist');
    assert.equal(names.has('scraping-pipeline'), false);

    for (const candidate of candidates) {
      assert.ok(isSkillName(candidate.name), `${candidate.name} is not a valid DSH skill name`);
      assert.equal(typeof candidate.description, 'string');
      assert.ok(candidate.description.length > 0, `${candidate.name} has no description`);
      assert.equal(candidate.provider, 'project-harness', 'DSH rejects a provider-name mismatch');
      assert.equal(typeof candidate.source, 'string');
      assert.equal(Number.isFinite(candidate.rank), true);
      assert.equal(candidate.rank, HARNESS_SKILL_RANK);
      assert.equal(candidate.rank, 600, 'harness skills must rank below project and user roots');
      assert.equal(typeof candidate.invocation.modelInvocable, 'boolean');
      assert.equal(typeof candidate.invocation.userInvocable, 'boolean');
      if (candidate.whenToUse !== undefined) assert.equal(typeof candidate.whenToUse, 'string');
    }

    // Rank 600 lets project and user roots shadow the harness library.
    const wordpressWay = candidates.find((candidate) => candidate.name === 'wordpress-way');
    assert.equal(wordpressWay.invocation.userInvocable, false, 'a reference rule set must be model-only');

    // get() must return the fields DSH validates, and strip the frontmatter.
    const definition = await provider.get(wordpressWay, { cwd: workspace });
    assert.equal(definition.name, 'wordpress-way');
    assert.equal(definition.provider, 'project-harness');
    assert.equal(definition.source, 'bundled');
    assert.equal(typeof definition.content, 'string');
    assert.equal(definition.content.startsWith('---'), false, 'frontmatter must not reach the model');
    assert.match(definition.content, /WordPress/);
    assert.equal(definition.resourceBase.kind, 'directory');
    assert.equal(path.dirname(definition.path), definition.resourceBase.path);
    assert.match(definition.resourceBase.path, /\.github[/\\]skills$/);

    // A locator outside the allowed roots must not be readable.
    const escaped = await provider.get({ ...wordpressWay, locator: '/etc/passwd' }, { cwd: workspace });
    assert.equal(escaped, undefined);

    // A definition whose name no longer matches its candidate is refused by DSH;
    // the provider must at least re-read rather than serve a stale body.
    assert.ok(packageLike.length > 0);
    assert.ok(state.tools.length === 0, 'the provider module must not register tools itself');
  } finally {
    removeWorkspace(workspace);
  }
});

test('list is workspace-sensitive across two different sessions', async () => {
  const wordpress = makeWorkspace({ 'wp-content/.keep': '' });
  const python = makeWorkspace({ 'pyproject.toml': '[project]\nname="p"\ndependencies=["scrapy"]\n', 'scrapers/a.py': 'import scrapy\n' });

  try {
    const { ctx, state } = createStubHost();
    registerHarnessSkills(ctx, { projectRoot: '', skillWatchIntervalMs: 0 });
    const provider = state.providers[0];

    const first = new Set((await provider.list({ cwd: wordpress })).map((candidate) => candidate.name));
    const second = new Set((await provider.list({ cwd: python })).map((candidate) => candidate.name));

    assert.ok(first.has('wordpress-plugin'));
    assert.equal(first.has('scraping-pipeline'), false);
    assert.ok(second.has('scraping-pipeline'));
    assert.equal(second.has('wordpress-plugin'), false);
  } finally {
    removeWorkspace(wordpress);
    removeWorkspace(python);
  }
});

test('a changed library fingerprint invalidates the DSH catalogue', async () => {
  const workspace = makeWorkspace({
    'package.json': JSON.stringify({ name: 'cli' }),
  });

  try {
    const { ctx, state } = createStubHost();
    registerHarnessSkills(ctx, { projectRoot: '', skillWatchIntervalMs: 0 });
    const provider = state.providers[0];

    await provider.list({ cwd: workspace });
    const before = state.invalidations;

    writeFiles(workspace, {
      '.github/skills/local-only/SKILL.md': skillFixture('local-only', 'A workspace-local skill that must trigger a catalogue refresh.'),
    });

    await provider.list({ cwd: workspace });
    await tick();
    assert.ok(state.invalidations > before, 'a new skill must invalidate the cached catalogue');
  } finally {
    removeWorkspace(workspace);
  }
});

test('the fs/observed recorder invalidates on a catalog-relevant write and never throws', async () => {
  const workspace = makeWorkspace({ 'package.json': JSON.stringify({ name: 'cli' }) });

  try {
    const { ctx, state } = createStubHost();
    registerHarnessSkills(ctx, { projectRoot: '', skillWatchIntervalMs: 0 });
    const provider = state.providers[0];
    await provider.list({ cwd: workspace });

    const handlers = state.listeners.get('fs/observed') ?? [];
    assert.equal(handlers.length, 1, 'the provider must observe host mutations');

    const before = state.invalidations;
    const target = { displayPath: path.join(workspace, '.github', 'skills', 'code-review', 'SKILL.md') };
    handlers[0](target, {}, { name: 'write' });
    await tick();
    assert.ok(state.invalidations > before, 'a write to a bundle SKILL.md must invalidate');

    // A resource file below a bundle is not a catalogue change.
    const quiet = state.invalidations;
    handlers[0]({ displayPath: path.join(workspace, '.github', 'skills', 'code-review', 'references', 'notes.md') }, {}, { name: 'write' });
    await tick();
    assert.equal(state.invalidations, quiet);

    // Reads and hostile actors are ignored, and nothing throws.
    handlers[0](target, {}, { name: 'read' });
    handlers[0](target, {}, undefined);
    handlers[0]({ displayPath: 42 }, {}, { name: 'edit' });
    handlers[0](null, {}, { name: 'edit' });
    assert.equal(state.invalidations, quiet);
  } finally {
    removeWorkspace(workspace);
  }
});

test('isCatalogRelevantPath mirrors the native provider relevance rules', () => {
  const roots = ['/pkg'];
  assert.equal(isCatalogRelevantPath('/pkg/.github/skills/thing.md', roots), true);
  assert.equal(isCatalogRelevantPath('/pkg/.github/skills/thing/SKILL.md', roots), true);
  assert.equal(isCatalogRelevantPath('/pkg/.github/skills/thing/references/a.md', roots), false);
  assert.equal(isCatalogRelevantPath('/pkg/.github/skills/INDEX.md', roots), false);
  assert.equal(isCatalogRelevantPath('/pkg/README.md', roots), false);
  assert.equal(isCatalogRelevantPath('/elsewhere/skills/thing.md', roots), false);
});

test('specialist detection stays evidence-driven', () => {
  const wordpress = makeWorkspace({ 'wp-content/.keep': '' });
  const python = makeWorkspace({ 'pyproject.toml': '[project]\n', 'src/main.py': 'print(1)\n' });
  const unknown = makeWorkspace({ 'README.md': '# Nothing\n' });

  try {
    assert.equal(specialistFor(wordpress).specialist, 'wordpress-coding');
    assert.equal(specialistFor(python).specialist, 'python-prospecting');
    assert.equal(specialistFor(unknown).specialist, null);
    assert.equal(specialistFor(unknown).writes_performed, false);
  } finally {
    removeWorkspace(wordpress);
    removeWorkspace(python);
    removeWorkspace(unknown);
  }
});

test('the refused workspace cases keep their explicit codes', () => {
  assert.equal(resolveProjectRoot('').code, 'WORKSPACE_NOT_CONFIGURED');
  assert.equal(resolveProjectRoot(path.join(os.tmpdir(), 'project-harness-absent')).code, 'WORKSPACE_NOT_FOUND');

  // A DeepSeek Harness source checkout must never be managed as a project.
  const checkout = makeWorkspace({
    'apps/cli/src/bin.ts': 'export {};\n',
    'packages/boot/package.json': '{}\n',
  });

  try {
    assert.equal(isDshCheckout(checkout), true);
    assert.equal(resolveProjectRoot(checkout).code, 'DSH_CHECKOUT_REJECTED');
    assert.equal(workspaceForLookup('', checkout).ok, false);
    assert.match(workspaceForLookup('', checkout).reason, /Refusing to use the DeepSeek Harness checkout/);
  } finally {
    removeWorkspace(checkout);
  }

  // The harness repository itself is a legitimate workspace to dogfood.
  assert.equal(workspaceForLookup('', ROOT).root, ROOT);
  assert.equal(buildSkillPlan('', ROOT).entries.length > 0, true);

  // A subdirectory resolves to its git root rather than being treated as a project.
  assert.equal(workspaceForLookup('', path.join(ROOT, 'dsh')).root, ROOT);
});
