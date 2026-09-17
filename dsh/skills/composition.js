/**
 * Evidence detection and skill composition.
 *
 * The model-facing skill catalogue is small on purpose: every visible skill
 * spends context. Composition decides what is visible from three sources —
 * always-on harness controls, the matched specialist, and capabilities proven
 * by workspace evidence — while `find-skills` keeps the rest reachable.
 *
 * All detection runs off one bounded directory walk plus a bounded manifest
 * read, so a catalogue read never turns into a full repository scan.
 *
 * @module dsh/skills/composition
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_MAX_ENTRIES,
  hasDirectory,
  hasFile,
  listChildren,
  readFileBounded,
  readInside,
  walkBounded,
} from './scan.js';

const MANIFEST_FILES = [
  'composer.json',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'Gemfile',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
];

const SOURCE_EXTENSIONS = [
  '.php',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.rb',
  '.go',
  '.java',
  '.cs',
];

const PRESENTATION_EXTENSIONS = [
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.twig',
  '.vue',
  '.svelte',
  '.blade.php',
];

const PRESENTATION_DIRECTORIES = [
  'templates',
  'template',
  'views',
  'view',
  'components',
  'partials',
  'layouts',
  'theme',
  'themes',
  'assets',
  'css',
  'scss',
  'styles',
  'widgets',
  'blocks',
];

const PERSISTENCE_DIRECTORIES = ['migrations', 'migration', 'db', 'database', 'schema', 'fixtures', 'seeds'];

const API_DIRECTORIES = ['api', 'apis', 'routes', 'route', 'controllers', 'controller', 'endpoints', 'handlers'];

const SCRAPER_DIRECTORIES = ['scrapers', 'scraper', 'crawlers', 'crawler', 'spiders', 'parsers', 'ingest', 'ingestion'];

const TEST_DIRECTORIES = ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e'];

const MAX_SOURCE_PROBES = 40;
const MAX_SOURCE_BYTES = 24576;

/**
 * Evidence detectors, keyed by the token a capability declares in
 * `capabilities.json`. Each detector is a pure function of one bounded
 * {@link buildEvidenceContext} result.
 */
export const EVIDENCE_DETECTORS = new Map([
  ['tests-present', (context) => (
    hasAnyDirectory(context, TEST_DIRECTORIES)
    || context.files.some((file) => /(^|\/)[^/]+\.(test|spec)\.[a-z]+$/u.test(file))
    || matchesDependencies(context, /\b(phpunit|pest|jest|vitest|mocha|pytest|playwright|cypress|rspec|junit)\b/u)
  )],
  ['persistence-surface', (context) => (
    hasAnyDirectory(context, PERSISTENCE_DIRECTORIES)
    || context.files.some((file) => file.endsWith('.sql'))
    || context.basenames.has('alembic.ini')
    || /^schema\./u.test([...context.basenames].find((name) => name.startsWith('schema.')) ?? '')
    || context.markers.has('wordpress-database')
    || matchesDependencies(context, /\b(sqlalchemy|django|prisma|drizzle|sequelize|typeorm|knex|mysql|mariadb|postgres|postgresql|sqlite|pdo|eloquent|doctrine|mongoose|redis)\b/u)
  )],
  ['api-surface', (context) => (
    hasAnyDirectory(context, API_DIRECTORIES)
    || [...context.basenames].some((name) => /^(openapi|swagger|asyncapi)\./u.test(name))
    || context.markers.has('rest-route')
    || context.markers.has('web-route')
    || matchesDependencies(context, /\b(fastapi|express|flask|django|laravel|symfony|nestjs|koa|hapi|actix|axum|gin|spring-boot)\b/u)
  )],
  ['presentation-surface', (context) => (
    hasAnyDirectory(context, PRESENTATION_DIRECTORIES)
    || context.files.some((file) => PRESENTATION_EXTENSIONS.some((extension) => file.endsWith(extension)))
  )],
  ['browser-dependency', (context) => (
    matchesDependencies(context, /\b(playwright|puppeteer|selenium|chromedriver|chrome-devtools|cypress|webdriverio)\b/u)
  )],
  ['class-declarations', (context) => context.markers.has('class-declaration')],
  ['scraper-sources', (context) => (
    hasAnyDirectory(context, SCRAPER_DIRECTORIES)
    || context.files.some((file) => /(scrape|scraper|crawl|spider|parse)/iu.test(file))
    || matchesDependencies(context, /\b(scrapy|beautifulsoup4?|bs4|lxml|cheerio|parsel|trafilatura|htmlparser)\b/u)
  )],
  ['planning-artifacts', (context) => (
    hasDirectory(context.root, '00-PLANNING')
    || ['PRD.md', 'TECH-SPEC.md', 'SYSTEM-MODEL.md', 'ARCHITECTURE-HYPOTHESIS.md']
      .some((name) => hasFile(context.root, name) || hasFile(path.join(context.root, '00-PLANNING'), name))
  )],
  ['docs-present', (context) => (
    (hasDirectory(context.root, 'docs') && context.files.some((file) => file.startsWith('docs/') && file.endsWith('.md')))
    || hasFile(context.root, 'README.md')
  )],
]);

/**
 * Build one bounded evidence context for a workspace.
 *
 * @param {string} projectRoot Absolute workspace root.
 * @param {{ maxEntries?: number }} [options] Walk limit.
 * @returns {object} Evidence context consumed by {@link EVIDENCE_DETECTORS}.
 */
export function buildEvidenceContext(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const walk = walkBounded(root, { maxEntries });
  const directories = new Set(walk.directories.map((directory) => directory.split('/')[0]));
  const basenames = new Set(walk.files.map((file) => path.basename(file).toLowerCase()));

  const dependencyParts = [];
  for (const manifest of MANIFEST_FILES) {
    const content = readInside(root, manifest);
    if (content !== undefined) dependencyParts.push(content);
  }

  const context = {
    root,
    files: walk.files,
    directories,
    basenames,
    truncated: walk.truncated,
    dependencies: dependencyParts.join('\n').toLowerCase(),
    markers: new Set(),
  };

  probeSourceMarkers(context);
  return context;
}

function probeSourceMarkers(context) {
  const candidates = context.files
    .filter((file) => SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .slice(0, MAX_SOURCE_PROBES);

  const wanted = new Map([
    ['wordpress-database', /\$wpdb|dbDelta/iu],
    ['rest-route', /register_rest_route|rest_api_init/iu],
    ['web-route', /@app\.route|APIRouter\(|FastAPI\(|express\.Router\(|Router\(\)|@(Get|Post|Put|Delete)Mapping/iu],
    ['class-declaration', /(?:^|[\s;{}()])(?:final\s+|abstract\s+|export\s+|public\s+)?class\s+[A-Z]/u],
  ]);

  for (const file of candidates) {
    if (wanted.size === 0) break;
    const content = readFileBounded(path.join(context.root, file), MAX_SOURCE_BYTES);
    if (content === undefined) continue;
    for (const [marker, pattern] of [...wanted]) {
      if (pattern.test(content)) {
        context.markers.add(marker);
        wanted.delete(marker);
      }
    }
  }
}

function hasAnyDirectory(context, names) {
  return names.some((name) => context.directories.has(name));
}

function matchesDependencies(context, pattern) {
  return pattern.test(context.dependencies);
}

/**
 * Read the shared capability vocabulary.
 *
 * @param {string} packageRoot Absolute Project Harness package root.
 * @returns {object | undefined} Parsed vocabulary, or undefined when unreadable.
 */
export function readVocabulary(packageRoot) {
  return readJson(path.join(packageRoot, 'dsh', 'skills', 'capabilities.json'));
}

/**
 * Read one specialist preset.
 *
 * @param {string} packageRoot Absolute Project Harness package root.
 * @param {string} id Preset id, for example `wordpress-coding`.
 * @returns {object | undefined} Parsed preset, or undefined when unreadable.
 */
export function readPreset(packageRoot, id) {
  if (!/^[a-z0-9-]+$/u.test(id ?? '')) return undefined;
  return readJson(path.join(packageRoot, 'dsh', 'specialists', `${id}.json`));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Compose the visible skill set for one workspace.
 *
 * Later sources never replace an earlier one: a skill keeps the first tier and
 * reason that claimed it, so a core skill referenced by a capability stays core.
 *
 * @param {object} input Composition inputs.
 * @param {object} input.vocabulary Shared capability vocabulary.
 * @param {object | undefined} input.basePreset Generic preset providing the default capability scope.
 * @param {object | undefined} input.specialistPreset Matched specialist preset, when any.
 * @param {string[]} [input.detected] Capabilities proven by workspace evidence.
 * @param {string[]} [input.activated] Skills activated explicitly in this workspace.
 * @param {Set<string> | undefined} [input.available] Library skill names; unknown names are skipped.
 * @returns {{ entries: {name: string, tier: string, reason: string, capability?: string}[], unknown: string[] }} Composed plan.
 */
export function composeSkillPlan(input) {
  const vocabulary = input.vocabulary ?? { core_skills: [], discovery_skills: [], capabilities: {} };
  const capabilities = vocabulary.capabilities ?? {};
  const available = input.available;
  const entries = new Map();
  const unknown = [];

  const add = (name, tier, reason, capability) => {
    if (typeof name !== 'string' || name === '') return;
    if (available !== undefined && !available.has(name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return;
    }
    if (entries.has(name)) return;
    entries.set(name, { name, tier, reason, ...(capability === undefined ? {} : { capability }) });
  };

  for (const name of vocabulary.core_skills ?? []) {
    add(name, 'core', 'core harness control; always composed');
  }
  for (const name of vocabulary.discovery_skills ?? []) {
    add(name, 'discovery', 'skill discovery entry point; always composed');
  }

  const detected = new Set(input.detected ?? []);
  const eligible = new Map();
  const order = [];

  const registerEligibility = (preset) => {
    const defaults = new Set(preset?.default_capabilities ?? []);
    for (const capability of preset?.capability_skills ?? []) {
      if (!eligible.has(capability)) order.push(capability);
      eligible.set(capability, (eligible.get(capability) ?? false) || defaults.has(capability));
    }
    for (const capability of defaults) {
      if (!eligible.has(capability)) {
        order.push(capability);
        eligible.set(capability, true);
      }
    }
  };

  registerEligibility(input.basePreset);
  registerEligibility(input.specialistPreset);

  for (const name of input.specialistPreset?.specialist_skills ?? []) {
    add(name, 'specialist', `specialist: ${input.specialistPreset.id}`);
  }
  for (const name of input.specialistPreset?.extra_skills ?? []) {
    add(name, 'specialist', `preset addition: ${input.specialistPreset.id}`);
  }

  for (const capability of order) {
    const isDefault = eligible.get(capability) === true;
    if (!isDefault && !detected.has(capability)) continue;
    const skills = capabilities[capability]?.skills ?? [];
    if (skills.length === 0) continue;
    const reason = isDefault ? `default capability: ${capability}` : `evidence: ${capability}`;
    for (const name of skills) add(name, 'capability', reason, capability);
  }

  for (const name of input.activated ?? []) {
    add(name, 'activated', 'activated for this workspace');
  }

  return { entries: [...entries.values()], unknown };
}

/**
 * Report which capabilities a workspace proves.
 *
 * @param {object} context Evidence context.
 * @param {object} vocabulary Shared capability vocabulary.
 * @returns {string[]} Detected capability names, in vocabulary order.
 */
export function detectCapabilities(context, vocabulary) {
  const detected = [];
  for (const [capability, definition] of Object.entries(vocabulary.capabilities ?? {})) {
    for (const token of definition.evidence ?? []) {
      const detector = EVIDENCE_DETECTORS.get(token);
      if (detector === undefined) continue;
      if (detector(context) === true) {
        detected.push(capability);
        break;
      }
    }
  }
  return detected;
}

/**
 * Parse a preset's `required_skills` into composition semantics.
 *
 * Retained so an older preset that predates composition still resolves instead
 * of silently composing nothing.
 *
 * @param {object | undefined} preset Specialist preset.
 * @param {object} vocabulary Shared capability vocabulary.
 * @returns {{ specialist_skills: string[], capability_skills: string[], default_capabilities: string[] }} Normalized scope.
 */
export function normalizePresetScope(preset, vocabulary) {
  if (preset === undefined || preset === null) {
    return { specialist_skills: [], capability_skills: [], default_capabilities: [] };
  }
  if (Array.isArray(preset.required_skills)) {
    const capabilitySkills = new Set();
    for (const definition of Object.values(vocabulary.capabilities ?? {})) {
      for (const skill of definition.skills ?? []) capabilitySkills.add(skill);
    }
    const paths = preset.required_skills;
    const names = paths.map((entry) => skillNameFromPath(entry));
    return {
      specialist_skills: names.filter((name) => !capabilitySkills.has(name)),
      capability_skills: [],
      default_capabilities: [],
    };
  }
  return {
    specialist_skills: preset.specialist_skills ?? [],
    capability_skills: preset.capability_skills ?? [],
    default_capabilities: preset.default_capabilities ?? [],
  };
}

/**
 * Derive a DSH skill name from a Project Harness skill path.
 *
 * Matches the native provider's two accepted shapes: a `<name>/SKILL.md`
 * directory bundle and a flat `<name>.md` file.
 *
 * @param {string} relativePath Project-relative Markdown skill path.
 * @returns {string} DSH skill name.
 */
export function skillNameFromPath(relativePath) {
  const normalized = String(relativePath).replaceAll('\\', '/');
  const name = normalized.endsWith('/SKILL.md')
    ? normalized.split('/').at(-2)
    : path.basename(normalized, '.md');

  return String(name).toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

/** List the installed specialist preset ids. */
export function listPresetIds(packageRoot) {
  return listChildren(path.join(packageRoot, 'dsh', 'specialists'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.basename(name, '.json'));
}
