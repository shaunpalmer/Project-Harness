import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

function fixture(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const write = (relativePath, content) => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  return { root, write };
}

function pythonFixture(t) {
  const project = fixture(t, 'project-harness-python');
  project.write('requirements.txt', 'requests\n');
  project.write('scraper.py', 'def run():\n    return "ok"\n');
  project.write('CURRENT_OUTPUTS.md', '## Current truth\nPython fixture\n');
  return project;
}

function wordpressFixture(t) {
  const project = fixture(t, 'project-harness-wordpress');
  project.write('intent-prefetch.php', `<?php
/**
 * Plugin Name: Intent Prefetch
 * Description: Fixture plugin for DSH workspace routing.
 * Version: 1.0.0
 */
`);
  project.write('README.md', '# Intent Prefetch\n');
  return project;
}

async function loadAdapter() {
  const adapter = new URL('../dsh/index.js', import.meta.url);
  const source = fs.readFileSync(adapter, 'utf8')
    .replace("import Schema from '@deepseek-ai/schemastery';", 'const Schema = { object: x => x, string: () => ({ default: x => x }) };')
    .replace("import { defineTool } from '@deepseek-ai/dsh-tools';", 'const defineTool = x => x;')
    .replace("'../scripts/memory-context.js'", JSON.stringify(pathToFileURL(fileURLToPath(new URL('../scripts/memory-context.js', import.meta.url))).href))
    .replace('fileURLToPath(import.meta.url)', JSON.stringify(fileURLToPath(adapter)));

  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

async function harnessFor(t, configuredRoot) {
  const { apply } = await loadAdapter();
  const handlers = new Map();
  let provider;

  const ctx = {
    effect(register) {
      const dispose = register();
      if (typeof dispose === 'function') t.after(dispose);
      return dispose;
    },
    tools: {
      register(tool) {
        handlers.set(tool.name, tool);
      },
    },
    skills: {
      registerProvider(factory) {
        provider = factory({
          signal: new AbortController().signal,
          invalidate() {},
        });
        return () => {};
      },
    },
  };

  apply(ctx, { projectRoot: configuredRoot });
  assert.ok(provider, 'Project Harness should register one skill provider');
  return { handlers, provider };
}

function execFor(cwd) {
  return {
    agent: { session: { header: { cwd } } },
    signal: new AbortController().signal,
  };
}

function skillNames(skills) {
  return skills.map((skill) => skill.name).sort();
}

test('DSH session cwd overrides a configured Python fallback for tools and skills', async (t) => {
  const python = pythonFixture(t);
  const wordpress = wordpressFixture(t);
  const { handlers, provider } = await harnessFor(t, python.root);
  const exec = execFor(wordpress.root);

  const inventory = JSON.parse(await handlers.get('project_harness_inventory').execute({}, exec));
  assert.equal(inventory.project_root, wordpress.root);
  assert.equal(inventory.project_root_source, 'session-cwd');

  const resume = JSON.parse(await handlers.get('project_harness_resume').execute({}, exec));
  assert.equal(resume.project_root, wordpress.root);
  assert.equal(resume.project_root_source, 'session-cwd');

  const specialist = JSON.parse(await handlers.get('project_harness_select_specialist').execute({}, exec));
  assert.equal(specialist.specialist, 'wordpress-coding');
  assert.equal(specialist.confidence, 'high');
  assert.equal(specialist.project_root, wordpress.root);
  assert.equal(specialist.project_root_source, 'session-cwd');
  assert.equal(specialist.evidence.plugin_header, true);

  const skills = await provider.list({ cwd: wordpress.root });
  const names = skillNames(skills);
  assert.ok(names.includes('wordpress-plugin'));
  assert.ok(names.includes('wordpress-way'));
  assert.ok(!names.includes('scraping-pipeline'));

  const wordpressPlugin = skills.find((skill) => skill.name === 'wordpress-plugin');
  assert.ok(wordpressPlugin);
  assert.equal(await provider.get(wordpressPlugin, { cwd: python.root }), undefined);
});

test('Python and WordPress sessions stay isolated under one Project Harness registration', async (t) => {
  const python = pythonFixture(t);
  const wordpress = wordpressFixture(t);
  const { handlers, provider } = await harnessFor(t, python.root);

  const select = handlers.get('project_harness_select_specialist');

  const pythonFirst = JSON.parse(await select.execute({}, execFor(python.root)));
  const wordpressFirst = JSON.parse(await select.execute({}, execFor(wordpress.root)));
  const pythonAgain = JSON.parse(await select.execute({}, execFor(python.root)));
  const wordpressAgain = JSON.parse(await select.execute({}, execFor(wordpress.root)));

  assert.equal(pythonFirst.specialist, 'python-prospecting');
  assert.equal(wordpressFirst.specialist, 'wordpress-coding');
  assert.equal(pythonAgain.specialist, 'python-prospecting');
  assert.equal(wordpressAgain.specialist, 'wordpress-coding');

  const pythonSkills = skillNames(await provider.list({ cwd: python.root }));
  const wordpressSkills = skillNames(await provider.list({ cwd: wordpress.root }));

  assert.ok(pythonSkills.includes('scraping-pipeline'));
  assert.ok(!pythonSkills.includes('wordpress-plugin'));
  assert.ok(wordpressSkills.includes('wordpress-plugin'));
  assert.ok(!wordpressSkills.includes('scraping-pipeline'));
});

test('configured projectRoot remains the agentless fallback', async (t) => {
  const python = pythonFixture(t);
  const { handlers, provider } = await harnessFor(t, python.root);

  const specialist = JSON.parse(await handlers.get('project_harness_select_specialist').execute({}, undefined));
  assert.equal(specialist.specialist, 'python-prospecting');
  assert.equal(specialist.project_root, python.root);
  assert.equal(specialist.project_root_source, 'configured-fallback');

  const inventory = JSON.parse(await handlers.get('project_harness_inventory').execute({}, undefined));
  assert.equal(inventory.project_root, python.root);
  assert.equal(inventory.project_root_source, 'configured-fallback');

  const skills = skillNames(await provider.list({}));
  assert.ok(skills.includes('scraping-pipeline'));
});

test('an invalid session cwd fails closed instead of falling back to another project', async (t) => {
  const python = pythonFixture(t);
  const { handlers } = await harnessFor(t, python.root);
  const missing = path.join(os.tmpdir(), `missing-project-harness-${Date.now()}`);

  const specialist = JSON.parse(await handlers.get('project_harness_select_specialist').execute({}, execFor(missing)));
  assert.equal(specialist.specialist, null);
  assert.equal(specialist.status, 'blocked');
  assert.equal(specialist.code, 'WORKSPACE_NOT_FOUND');
  assert.equal(specialist.project_root_source, 'session-cwd');
});
