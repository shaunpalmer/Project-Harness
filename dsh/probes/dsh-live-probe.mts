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
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import AgentRegistry from '@deepseek-ai/dsh-agent';
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

  // --- plugin entry shape ---------------------------------------------------
  // The cordis Loader normalizes a plugin module with `unwrapExports`, which prefers
  // `.default` over the namespace. A stray `export default apply` would therefore discard
  // `inject`, and the plugin would load into a fiber with no services. docs/testing.md
  // requires an explicit `'default' in module` assertion plus an unwrapExports round trip,
  // because a Loader smoke alone stays green when this regresses.
  let pluginNamespace;
  try {
    pluginNamespace = await import(pathToFileURL(join(packageRoot, 'dsh', 'index.js')).href);
  } catch (error) {
    pluginNamespace = undefined;
    // Only a missing peer is a legitimate skip: the source checkout has no node_modules
    // beside it, so `@deepseek-ai/*` cannot resolve. Any other failure — a syntax error, an
    // export mistake, a bad top-level import — must be red, because it is exactly the
    // load-time breakage this section exists to catch.
    const missingPeer = error?.code === 'ERR_MODULE_NOT_FOUND' && /@deepseek-ai\//u.test(String(error?.message));
    check(
      missingPeer
        ? 'plugin entry importable (skipped: peer dependencies are not installed beside packageRoot)'
        : 'plugin entry importable',
      missingPeer,
      missingPeer
        ? `run with --package-root pointing at an installed package to include this check: ${error.message}`
        : String(error?.stack ?? error),
    );
  }

  if (pluginNamespace !== undefined) {
    check('plugin entry has no default export', !('default' in pluginNamespace), Object.keys(pluginNamespace).join(','));
    check(
      'plugin entry exports the namespace form',
      typeof pluginNamespace.name === 'string'
        && Array.isArray(pluginNamespace.inject)
        && typeof pluginNamespace.apply === 'function'
        && pluginNamespace.Config !== undefined,
      Object.keys(pluginNamespace).join(','),
    );

    const unwrapped = Loader.prototype.unwrapExports(pluginNamespace);
    check(
      'unwrapExports preserves the namespace plugin',
      unwrapped !== null && typeof unwrapped === 'object'
        && unwrapped.name === 'project-harness'
        && Array.isArray(unwrapped.inject)
        && typeof unwrapped.apply === 'function',
      typeof unwrapped === 'function' ? 'unwrapped to a bare function' : Object.keys(unwrapped ?? {}).join(','),
    );
    check(
      'unwrapExports preserves the declared injection',
      Array.isArray(unwrapped?.inject) && unwrapped.inject.includes('tools') && unwrapped.inject.includes('skills'),
      JSON.stringify(unwrapped?.inject),
    );

    // Prove the guard is not vacuous: a default export must actually break it.
    const withDefault = { ...pluginNamespace, default: pluginNamespace.apply };
    const broken = Loader.prototype.unwrapExports(withDefault);
    check(
      'a default export would drop inject (the regression this guards)',
      typeof broken?.inject === 'undefined' && typeof broken === 'function',
      typeof broken === 'function' ? 'unwrapped to the bare apply function, losing inject' : 'premise did not hold',
    );
  }

  // --- tool layer through the real registry ---------------------------------
  // The provider is covered above; the six tools are only ever exercised against a stub
  // `defineTool` elsewhere, so this registers them with the real tool runtime and reads
  // back what the registry materializes.
  if (pluginNamespace !== undefined) {
    const toolContext = new Context();
    await toolContext.plugin(SystemPrompt);
    await toolContext.plugin(ToolRuntime);
    await toolContext.plugin(AgentRegistry);
    await toolContext.plugin(SkillRegistry);
    await toolContext.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    });

    pluginNamespace.apply(toolContext, { projectRoot: '', skillWatchIntervalMs: 0 });

    const projection = toolContext.tools.schemas().map((entry: any) => entry.name).sort();
    // No shell service is mounted here on purpose: `shell` is requested with a nested
    // `ctx.inject`, so an assembly without it must still register every tool rather than
    // leaving the plugin PENDING and silently losing all six.
    check(
      'all six tools register with the real tool runtime and no shell service mounted',
      projection.length === 6 && projection.includes('project_harness_find_skills') && projection.includes('project_harness_activate_skills'),
      projection.join(','),
    );

    // The model-facing projection carries name, description and parameters only; an output
    // schema never reaches the model, which is why the canonical value can be structured
    // without changing what the model reads.
    const first = toolContext.tools.schemas()[0];
    check(
      'the model-facing projection exposes no output schema',
      first !== undefined && !Object.hasOwn(first, 'output') && Object.hasOwn(first, 'parameters'),
      Object.keys(first ?? {}).join(','),
    );

    // A tool returning one canonical JSON value declares DSH's `json` author spec, which
    // normalizes to the unconstrained JSON Schema node. A string root would force a
    // programmatic caller to parse prose out of the result.
    const stringRooted = [];
    const missing = [];
    for (const name of projection) {
      const definition: any = toolContext.tools.get(name);
      if (definition === undefined) {
        missing.push(name);
        continue;
      }
      const schema = definition.output?.schema;
      const unconstrained = schema !== undefined && typeof schema === 'object' && !Object.hasOwn(schema, 'type');
      if (!unconstrained) stringRooted.push(`${name}=${JSON.stringify(schema)}`);
    }

    check('every tool definition is readable from the registry', missing.length === 0, missing.join(','));
    check(
      'every tool returns one unconstrained JSON canonical value',
      stringRooted.length === 0,
      stringRooted.join(',') || 'all six are unconstrained',
    );

    await toolContext.fiber.dispose();
  }

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
  // The report builders return canonical objects, so a programmatic caller reads fields
  // directly instead of parsing a string.
  const pythonPlan = buildSkillPlan('', py);
  check('plan builds for the Python workspace as an object', typeof pythonPlan === 'object' && Array.isArray(pythonPlan.entries));
  check('plan entries carry their library record', pythonPlan.entries.every((entry) => typeof entry.library?.description === 'string'));

  const activation = activateSkill('', py, holder, 'interface-design', 'activate');
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
  const suppression = activateSkill('', py, holder, 'scraping-pipeline', 'deactivate');
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
