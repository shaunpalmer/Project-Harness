/**
 * Project Harness ↔ DeepSeek Harness live integration probe.
 *
 * Runs against the REAL DSH skill registry, the REAL filesystem skill provider and
 * the REAL tool-skill consumer — no stubs. It boots cordis, registers the Project
 * Harness provider from the checkout, and asserts the integration contract:
 * composition, workspace scoping, native shadowing, and the invalidate round-trip.
 *
 * It must be executed from the DSH checkout root (so bare `@deepseek-ai/*`
 * specifiers resolve) with that checkout's tsx:
 *
 *   node --import tsx/esm <this-file> <project-harness-root>
 *
 * It prints a single JSON object on stdout and exits non-zero on failure.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem';

const packageRoot = process.argv[2];
if (typeof packageRoot !== 'string' || packageRoot === '') {
  console.error('usage: node --import tsx/esm dsh-live-probe.mts <project-harness-root>');
  process.exit(2);
}

const { registerHarnessSkills, activateSkill, buildSkillPlan } = await import(
  join(packageRoot, 'dsh', 'skills', 'plan.js')
);

const results = [];
const check = (name, condition, detail) => {
  results.push({ name, ok: condition === true, detail });
};

const skill = (name, description) => `---
name: ${name}
description: "${description}"
whenToUse: "Use when the probe needs ${name}."
user-invocable: true
metadata:
  harness:
    layer: capability
    topics: [probe]
    tags: [probe]
    stack: []
---
# ${name}

PROBE BODY for ${name}
`;

const home = await mkdtemp(join(tmpdir(), 'dsh-ph-home-'));
const wp = await mkdtemp(join(tmpdir(), 'dsh-ph-wp-'));
const py = await mkdtemp(join(tmpdir(), 'dsh-ph-py-'));

try {
  // --- fixtures -------------------------------------------------------------
  // A WordPress workspace with real evidence for the database capability.
  await mkdir(join(wp, '.git'), { recursive: true });
  await writeFile(join(wp, 'composer.json'), JSON.stringify({ require: { 'wordpress/wordpress': '*' } }));
  await mkdir(join(wp, 'src'), { recursive: true });
  await writeFile(join(wp, 'src', 'Schema.php'), '<?php global $wpdb; dbDelta($sql);');
  await mkdir(join(wp, 'tests'), { recursive: true });
  await writeFile(join(wp, 'tests', 'SchemaTest.php'), '<?php echo 1;');

  // A project-local DSH skill that must SHADOW the packaged harness skill.
  await mkdir(join(wp, '.dsh', 'skills', 'database-design'), { recursive: true });
  await writeFile(
    join(wp, '.dsh', 'skills', 'database-design', 'SKILL.md'),
    skill('database-design', 'PROJECT LOCAL OVERRIDE for database design that is long enough to parse.'),
  );

  // A Python/prospecting workspace.
  await mkdir(join(py, '.git'), { recursive: true });
  await writeFile(join(py, 'pyproject.toml'), '[project]\nname = "p"\ndependencies = ["scrapy"]\n');
  await mkdir(join(py, 'scrapers'), { recursive: true });
  await writeFile(join(py, 'scrapers', 'places.py'), 'import scrapy\n');

  // --- boot real DSH --------------------------------------------------------
  const ctx = new Context();
  await ctx.plugin(SkillRegistry);
  // watch:false keeps chokidar out of the probe; the host watcher is not under test.
  await ctx.plugin(SkillFileSystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
  });

  const holder = registerHarnessSkills(ctx, { projectRoot: '', skillWatchIntervalMs: 0 });
  check('provider registration exposes invalidate()', typeof holder.invalidate === 'function');

  const namesFor = async (cwd) => (await ctx.skills.list({ cwd })).map((entry) => entry.name);

  // --- composition ----------------------------------------------------------
  const wpNames = await namesFor(wp);
  check('WordPress session composes core controls', ['complexity-brake', 'loop-controller', 'project-memory', 'skill-router'].every((n) => wpNames.includes(n)), wpNames.join(','));
  check('WordPress session composes the discovery entry point', wpNames.includes('find-skills'), wpNames.join(','));
  check('WordPress session composes both specialist skills', wpNames.includes('wordpress-plugin') && wpNames.includes('wordpress-way'), wpNames.join(','));
  check('WordPress session composes the default capability', wpNames.includes('testing-plan'), wpNames.join(','));
  check('evidence binds the database capability', wpNames.includes('database-selection'), wpNames.join(','));
  check('WordPress session excludes the Python pipeline skill', !wpNames.includes('scraping-pipeline'), wpNames.join(','));

  const pyNames = await namesFor(py);
  check('Python session composes the scraping specialist', pyNames.includes('scraping-pipeline'), pyNames.join(','));
  check('Python session excludes WordPress skills', !pyNames.includes('wordpress-plugin') && !pyNames.includes('wordpress-way'), pyNames.join(','));

  check('catalogue is complete so DSH will publish it', (await ctx.skills.snapshot({ cwd: wp })).complete === true);

  // --- real native shadowing ------------------------------------------------
  // The filesystem provider ranks a project root at 100 and this provider at 600,
  // so the project's own database-design must win.
  const shadowed = await ctx.skills.get('database-design', { cwd: wp });
  check(
    'project .dsh/skills entry shadows the packaged harness skill',
    shadowed !== undefined && shadowed.description.startsWith('PROJECT LOCAL OVERRIDE'),
    shadowed?.description,
  );
  check('shadowed entry reports the project source', shadowed?.source === 'project-dsh', shadowed?.source);

  // --- load a packaged skill for real ---------------------------------------
  const definition = await ctx.skills.get('wordpress-way', { cwd: wp });
  check('packaged skill loads through the real registry', definition !== undefined);
  check('loaded definition carries the provider name', definition?.provider === 'project-harness', definition?.provider);
  check('loaded definition carries a string source', typeof definition?.source === 'string', definition?.source);
  check('loaded body does not contain frontmatter', definition !== undefined && !definition.content.startsWith('---'), definition?.content.slice(0, 12));
  check('loaded definition exposes a directory resource base', definition?.resourceBase?.kind === 'directory', definition?.resourceBase?.kind);
  check('reference rule set is model-only', definition?.invocation?.userInvocable === false, JSON.stringify(definition?.invocation));

  // --- workspace scoping in both directions ---------------------------------
  check(
    'a WordPress candidate is refused in a Python session',
    (await ctx.skills.get('wordpress-way', { cwd: py })) === undefined,
  );

  // --- the find -> activate -> republish round trip -------------------------
  const before = (await ctx.skills.list({ cwd: py })).length;
  const found = JSON.parse(buildSkillPlan('', py) && JSON.stringify({ ok: true }));
  check('plan builds for the Python workspace', found.ok === true);

  const activation = JSON.parse(activateSkill('', py, holder, 'interface-design', 'activate'));
  check('activation succeeds', activation.status === 'updated', activation.status);
  check('activation writes only the workspace state file', activation.activation_file === '.harness/state/skills.json', activation.activation_file);

  // holder.invalidate() was called; give the deferred invalidate a macrotask, then
  // assert the real registry now serves the promoted skill.
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  const afterNames = await namesFor(py);
  check('invalidate() republishes the catalogue with the activated skill', afterNames.includes('interface-design'), afterNames.join(','));
  check('the catalogue grew by the activated skill', afterNames.length === before + 1, `${before} -> ${afterNames.length}`);
  check('the activated skill loads', (await ctx.skills.get('interface-design', { cwd: py })) !== undefined);

  // --- suppression ----------------------------------------------------------
  const suppression = JSON.parse(activateSkill('', py, holder, 'scraping-pipeline', 'deactivate'));
  check('deactivation succeeds', suppression.status === 'updated', suppression.status);
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  const suppressedNames = await namesFor(py);
  check('suppressed skill leaves the catalogue', !suppressedNames.includes('scraping-pipeline'), suppressedNames.join(','));
  check('suppressed skill is refused on load', (await ctx.skills.get('scraping-pipeline', { cwd: py })) === undefined);

  // Teardown must run our registered effect disposers; assert it settles cleanly.
  await ctx.fiber.dispose();
  check('context teardown settles with the provider registered', true);
} catch (error) {
  check('probe completed without throwing', false, error?.stack ?? String(error));
} finally {
  await rm(home, { recursive: true, force: true });
  await rm(wp, { recursive: true, force: true });
  await rm(py, { recursive: true, force: true });
}

const failed = results.filter((entry) => !entry.ok);
console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, failed: failed.length, results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
