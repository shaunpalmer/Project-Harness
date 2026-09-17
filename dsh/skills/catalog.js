/**
 * Package-owned skill catalog.
 *
 * `dsh/skill-catalog.json` is a single machine-readable statement of what the
 * installed package ships: every curated skill with its path, layer, routing
 * description, invocation policy and search tags. It is the file to read when you
 * want the whole catalog without walking the library.
 *
 * It is **generated** from the skill library — frontmatter remains the single
 * source of truth — and `npm run skills:verify` fails when the committed file and
 * the library disagree, so a stale catalog cannot ship. Regenerate with
 * `npm run skills:catalog`.
 *
 * The validator is deliberately strict and reports every problem rather than
 * throwing on the first one, because the caller is a verification gate that should
 * show everything wrong in one pass.
 *
 * @module dsh/skills/catalog
 */

import fs from 'node:fs';
import path from 'node:path';
import { isSkillName } from './frontmatter.js';
import { readFileBounded } from './scan.js';

/** Package-relative path of the generated catalog. */
export const CATALOG_PATH = 'dsh/skill-catalog.json';

/** Supported catalog schema. Bump only with a migration. */
export const CATALOG_SCHEMA_VERSION = 1;

/**
 * The layer vocabulary.
 *
 * `core` and `discovery` are always composed; `specialist` and `capability` are
 * composed from a matched preset or from workspace evidence; `reference` marks a
 * model-only rule set that a human has no reason to invoke.
 */
export const SKILL_LAYERS = ['core', 'discovery', 'specialist', 'capability', 'reference'];

const CATALOG_KEYS = ['schema_version', 'generated_from', 'skills'];
const ENTRY_KEYS = ['name', 'path', 'layer', 'description', 'when_to_use', 'invocation', 'tags', 'topics'];
const MIN_DESCRIPTION_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Build the catalog for one library index.
 *
 * Entries are sorted by name and serialized with a fixed key order so the file is
 * stable under regeneration and a diff is meaningful.
 *
 * @param {{ skills: Map<string, object> }} library Result of `discoverLibrary`.
 * @param {string} packageRoot Absolute package root, used to make paths relative.
 * @returns {object} Catalog document.
 */
export function buildCatalog(library, packageRoot) {
  const skills = [...library.skills.values()]
    .map((entry) => ({
      name: entry.name,
      path: path.relative(packageRoot, entry.filePath).split(path.sep).join('/'),
      layer: entry.harness.layer,
      description: entry.description,
      ...(entry.whenToUse === undefined ? {} : { when_to_use: entry.whenToUse }),
      invocation: {
        modelInvocable: entry.invocation.modelInvocable,
        userInvocable: entry.invocation.userInvocable,
      },
      tags: [...entry.harness.tags],
      topics: [...entry.harness.topics],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    schema_version: CATALOG_SCHEMA_VERSION,
    generated_from: 'skill frontmatter; regenerate with npm run skills:catalog',
    skills,
  };
}

/**
 * Serialize a catalog to the exact bytes that belong in the repository.
 *
 * @param {object} catalog Catalog document.
 * @returns {string} Stable JSON text with a trailing newline.
 */
export function serializeCatalog(catalog) {
  const ordered = {
    schema_version: catalog.schema_version,
    generated_from: catalog.generated_from,
    skills: catalog.skills,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Validate a parsed catalog document.
 *
 * @param {unknown} catalog Parsed JSON.
 * @param {{ packageRoot?: string }} [options] When `packageRoot` is supplied, each entry's file must exist and declare the same name.
 * @returns {{ ok: boolean, problems: string[], entries: object[] }} Validation result. `problems` lists every fault.
 */
export function validateCatalog(catalog, options = {}) {
  const problems = [];

  if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
    return { ok: false, problems: ['catalog must be a JSON object'], entries: [] };
  }

  for (const key of Object.keys(catalog)) {
    if (!CATALOG_KEYS.includes(key)) problems.push(`catalog has unexpected key "${key}"`);
  }
  for (const key of CATALOG_KEYS) {
    if (!Object.hasOwn(catalog, key)) problems.push(`catalog is missing required key "${key}"`);
  }
  if (catalog.schema_version !== CATALOG_SCHEMA_VERSION) {
    problems.push(`catalog schema_version must be ${CATALOG_SCHEMA_VERSION}, found ${String(catalog.schema_version)}`);
  }
  if (typeof catalog.generated_from !== 'string' || catalog.generated_from.trim() === '') {
    problems.push('catalog generated_from must be a non-empty string');
  }
  if (!Array.isArray(catalog.skills)) {
    problems.push('catalog skills must be an array');
    return { ok: false, problems, entries: [] };
  }

  const seen = new Set();
  for (const [index, entry] of catalog.skills.entries()) {
    const label = `catalog.skills[${index}]`;

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${label} must be an object`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(key)) problems.push(`${label} has unexpected key "${key}"`);
    }

    if (!isSkillName(entry.name)) {
      problems.push(`${label} has an invalid skill name: ${String(entry.name)}`);
      continue;
    }
    const name = entry.name;

    if (seen.has(name)) problems.push(`duplicate skill name in catalog: ${name}`);
    seen.add(name);

    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      problems.push(`${name} is missing a path`);
    } else if (path.isAbsolute(entry.path) || entry.path.split('/').includes('..')) {
      problems.push(`${name} path must be package-relative: ${entry.path}`);
    }

    if (!SKILL_LAYERS.includes(entry.layer)) {
      problems.push(`${name} has invalid layer "${String(entry.layer)}"; expected one of ${SKILL_LAYERS.join(', ')}`);
    }

    if (typeof entry.description !== 'string' || entry.description.trim() === '') {
      problems.push(`${name} is missing a description`);
    } else if (entry.description.length < MIN_DESCRIPTION_LENGTH || entry.description.length > MAX_DESCRIPTION_LENGTH) {
      problems.push(`${name} description must be ${MIN_DESCRIPTION_LENGTH}-${MAX_DESCRIPTION_LENGTH} characters`);
    } else if (entry.description.startsWith('SKILL:')) {
      problems.push(`${name} description repeats a heading instead of describing routing`);
    }

    if (entry.when_to_use !== undefined && (typeof entry.when_to_use !== 'string' || entry.when_to_use.trim() === '')) {
      problems.push(`${name} when_to_use must be a non-empty string when present`);
    }

    const invocation = entry.invocation;
    if (typeof invocation !== 'object' || invocation === null || Array.isArray(invocation)) {
      problems.push(`${name} is missing an invocation policy`);
    } else {
      if (typeof invocation.modelInvocable !== 'boolean') problems.push(`${name} invocation.modelInvocable must be a boolean`);
      if (typeof invocation.userInvocable !== 'boolean') problems.push(`${name} invocation.userInvocable must be a boolean`);
    }

    for (const field of ['tags', 'topics']) {
      if (!Array.isArray(entry[field])) {
        problems.push(`${name} ${field} must be an array`);
        continue;
      }
      for (const value of entry[field]) {
        if (typeof value !== 'string' || value.trim() === '') problems.push(`${name} ${field} must contain non-empty strings`);
      }
    }

    if (typeof options.packageRoot === 'string' && options.packageRoot !== '' && typeof entry.path === 'string' && entry.path.trim() !== '') {
      const absolute = path.join(options.packageRoot, entry.path);
      if (!fs.existsSync(absolute)) {
        problems.push(`${name} path does not exist in the package: ${entry.path}`);
      }
    }
  }

  return { ok: problems.length === 0, problems, entries: catalog.skills };
}

/**
 * Read and validate the committed catalog.
 *
 * @param {string} packageRoot Absolute package root.
 * @returns {{ ok: boolean, problems: string[], catalog?: object, text?: string }} Read result.
 */
export function readCatalog(packageRoot) {
  const absolute = path.join(packageRoot, CATALOG_PATH);
  const text = readFileBounded(absolute);
  if (text === undefined) {
    return { ok: false, problems: [`${CATALOG_PATH} is missing or unreadable`] };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`${CATALOG_PATH} is not valid JSON: ${error.message}`] };
  }

  const result = validateCatalog(parsed, { packageRoot });
  return { ...result, catalog: parsed, text };
}
