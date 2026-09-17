/**
 * Project Harness skill library index.
 *
 * `.github/skills` is the canonical library root for both the installed package
 * and a handed-off project. Discovery is workspace-first, so a project that
 * carries its own copy of a skill wins over the packaged version.
 *
 * The library is deliberately larger than the model-facing catalogue:
 * composition selects what the model sees, and `project_harness_find_skills`
 * searches the rest on demand.
 *
 * @module dsh/skills/library
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readSkillMetadata } from './frontmatter.js';
import { isInside, readFileBounded, walkBounded } from './scan.js';

/** Library roots searched inside a workspace and inside the package. */
export const LIBRARY_DIRECTORIES = ['.github/skills'];

/** DSH-native project-local skill roots, ranked ahead of this provider. */
export const NATIVE_PROJECT_DIRECTORIES = ['.dsh/skills', '.agents/skills'];

const MAX_SKILL_BYTES = 262144;
const MAX_LIBRARY_ENTRIES = 400;

/**
 * Enumerate skill files below one root using the two shapes DSH accepts.
 *
 * DSH discovers `<name>/SKILL.md` bundles and flat `<name>.md` files; it does
 * not recurse. Anything else is not a skill and is reported as unindexed.
 *
 * @param {string} root Absolute directory.
 * @returns {{ skillFiles: {name: string, filePath: string, relativePath: string}[], unindexed: string[] }} Discovered files.
 */
export function listSkillFiles(root) {
  const skillFiles = [];
  const unindexed = [];
  if (!fs.existsSync(root)) return { skillFiles, unindexed };

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { skillFiles, unindexed };
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const bundle = path.join(absolute, 'SKILL.md');
      if (fs.existsSync(bundle)) {
        skillFiles.push({
          name: entry.name,
          filePath: bundle,
          relativePath: path.posix.join(path.basename(root), entry.name, 'SKILL.md'),
        });
      } else {
        unindexed.push(`${entry.name}/ (no SKILL.md)`);
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
      skillFiles.push({
        name: path.basename(entry.name, '.md'),
        filePath: absolute,
        relativePath: path.posix.join(path.basename(root), entry.name),
      });
      continue;
    }

    unindexed.push(entry.name);
  }

  return { skillFiles, unindexed };
}

/**
 * Parse and validate one skill file.
 *
 * @param {string} filePath Absolute skill file path.
 * @returns {{ ok: true, entry: object } | { ok: false, reason: string }} Parsed entry or a reason.
 */
export function readSkillEntry(filePath) {
  const content = readFileBounded(filePath, MAX_SKILL_BYTES);
  if (content === undefined) {
    return { ok: false, reason: `${filePath}: missing or larger than ${MAX_SKILL_BYTES} bytes` };
  }

  const parsed = readSkillMetadata(content, path.basename(filePath));
  if (!parsed.ok) return parsed;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { ok: false, reason: `${filePath}: unreadable` };
  }

  return {
    ok: true,
    entry: {
      ...parsed.skill,
      filePath,
      bytes: stat.size,
      modifiedMs: stat.mtimeMs,
    },
  };
}

/**
 * Build the merged library for one workspace.
 *
 * @param {{ packageRoot: string, workspaceRoot?: string, maxEntries?: number }} input Roots to merge.
 * @returns {{ skills: Map<string, object>, problems: string[], unindexed: string[], duplicates: string[] }} Library index.
 */
export function discoverLibrary(input) {
  const skills = new Map();
  const problems = [];
  const duplicates = [];
  const unindexed = [];

  const roots = [];
  if (typeof input.workspaceRoot === 'string' && input.workspaceRoot !== '') {
    roots.push({ root: input.workspaceRoot, origin: 'workspace' });
  }
  roots.push({ root: input.packageRoot, origin: 'package' });

  let inspected = 0;
  for (const { root, origin } of roots) {
    for (const directory of LIBRARY_DIRECTORIES) {
      const absoluteDirectory = path.join(root, directory);
      const { skillFiles, unindexed: skipped } = listSkillFiles(absoluteDirectory);

      for (const skippedName of skipped) {
        const label = `${directory}/${skippedName}`;
        if (!unindexed.includes(label)) unindexed.push(label);
      }

      for (const candidate of skillFiles) {
        inspected += 1;
        if (inspected > MAX_LIBRARY_ENTRIES) break;

        const parsed = readSkillEntry(candidate.filePath);
        if (!parsed.ok) {
          problems.push(`${origin}: ${parsed.reason}`);
          continue;
        }

        const entry = { ...parsed.entry, origin, libraryRoot: absoluteDirectory };

        if (entry.name !== candidate.name) {
          problems.push(
            `${origin}: ${candidate.relativePath} declares name "${entry.name}" but the path implies "${candidate.name}"`,
          );
        }

        const existing = skills.get(entry.name);
        if (existing !== undefined) {
          duplicates.push(
            `"${entry.name}" resolved from ${origin} (${entry.filePath}); shadowed ${existing.origin} (${existing.filePath})`,
          );
          continue;
        }
        skills.set(entry.name, entry);
      }
    }
  }

  return { skills, problems, unindexed, duplicates };
}

/**
 * Discover DSH-native project and user skills for reporting.
 *
 * Project Harness does not serve these roots — DSH's own filesystem provider
 * does, at a higher rank. They are read here so `find_skills` can tell the
 * model that a project-local skill already exists and already shadows ours.
 *
 * @param {string} [workspaceRoot] Absolute workspace root.
 * @param {{ includeUserRoots?: boolean }} [options] Discovery options.
 * @returns {object[]} Native skills, never throwing on unreadable roots.
 */
export function discoverNativeSkills(workspaceRoot, options = {}) {
  const found = [];
  const seen = new Set();

  const roots = [];
  if (typeof workspaceRoot === 'string' && workspaceRoot !== '') {
    for (const directory of NATIVE_PROJECT_DIRECTORIES) {
      roots.push({ directory: path.join(workspaceRoot, directory), source: directory === '.dsh/skills' ? 'project-dsh' : 'project-agents' });
    }
  }
  if (options.includeUserRoots !== false) {
    roots.push({ directory: path.join(resolveDshHome(), 'skills'), source: 'user-dsh', skipSystem: true });
    roots.push({ directory: path.join(resolveAgentsHome(), 'skills'), source: 'user-agents' });
  }

  for (const { directory, source, skipSystem } of roots) {
    const { skillFiles } = listSkillFiles(directory);
    for (const candidate of skillFiles) {
      if (skipSystem === true && candidate.relativePath.includes('.system/')) continue;
      const parsed = readSkillEntry(candidate.filePath);
      if (!parsed.ok) continue;
      if (seen.has(parsed.entry.name)) continue;
      seen.add(parsed.entry.name);
      found.push({
        name: parsed.entry.name,
        description: parsed.entry.description,
        whenToUse: parsed.entry.whenToUse,
        source,
        filePath: parsed.entry.filePath,
      });
    }
  }

  return found;
}

function resolveDshHome() {
  return process.env.DSH_HOME ?? path.join(homedir(), '.dsh');
}

function resolveAgentsHome() {
  return process.env.DSH_AGENTS_HOME ?? path.join(homedir(), '.agents');
}

/**
 * Compute a cheap fingerprint over the skill files in one or more library roots.
 *
 * This is deliberately stat-based rather than content-based. DSH's registry
 * caches a completed catalogue and returns it without calling `list()` again
 * until something invalidates, so the fingerprint has to be cheap enough to
 * recompute on a short poll. Any content change — a new description, an edited
 * body, an added or removed skill — moves `size` or `mtimeMs`, which is all the
 * poll needs to know.
 *
 * @param {string[]} roots Absolute directories whose `.github/skills` entries are fingerprinted.
 * @returns {string} Stable fingerprint.
 */
export function libraryStatFingerprint(roots) {
  const rows = [];

  for (const root of roots) {
    if (typeof root !== 'string' || root === '') continue;
    for (const directory of LIBRARY_DIRECTORIES) {
      const absolute = path.join(root, directory);
      const { skillFiles } = listSkillFiles(absolute);
      for (const candidate of skillFiles) {
        let stats;
        try {
          stats = fs.statSync(candidate.filePath);
        } catch {
          rows.push(`${absolute}|${candidate.relativePath}|missing`);
          continue;
        }
        rows.push(`${absolute}|${candidate.relativePath}|${stats.size}|${Math.round(stats.mtimeMs)}`);
      }
    }
  }

  return createHash('sha256').update(rows.sort().join('\n')).digest('hex');
}

/**
 * Read one skill definition for `provider.get()`.
 *
 * @param {string} filePath Absolute skill file path.
 * @param {string[]} allowedRoots Absolute directories the read must stay inside.
 * @returns {object | undefined} Definition fields, or undefined when no longer loadable.
 */
export function loadSkillDefinition(filePath, allowedRoots) {
  if (typeof filePath !== 'string' || filePath === '') return undefined;
  const absolute = path.resolve(filePath);
  if (!allowedRoots.some((root) => isInside(root, absolute))) return undefined;

  const parsed = readSkillEntry(absolute);
  if (!parsed.ok) return undefined;

  return {
    name: parsed.entry.name,
    description: parsed.entry.description,
    ...(parsed.entry.whenToUse === undefined ? {} : { whenToUse: parsed.entry.whenToUse }),
    invocation: parsed.entry.invocation,
    resourceBase: { kind: 'directory', path: path.dirname(absolute) },
    path: absolute,
    metadata: { harness: parsed.entry.harness },
    content: parsed.entry.body,
  };
}

/**
 * Rank and score library skills against a free-text query.
 *
 * Deterministic: exact name, then name prefix, then description, then tags,
 * topics and stack. Returns an empty result for an empty query rather than the
 * whole library, so a vague search cannot flood the context.
 *
 * @param {object[]} skills Library entries.
 * @param {string} query Search text.
 * @param {{ limit?: number }} [options] Result limit.
 * @returns {{ entry: object, score: number, matches: string[] }[]} Ranked matches.
 */
export function searchSkills(skills, query, options = {}) {
  const limit = options.limit ?? 8;
  const normalised = String(query ?? '').toLowerCase().trim();
  if (normalised === '') return [];

  const terms = normalised.split(/[^a-z0-9]+/u).filter((term) => term.length > 1);
  if (terms.length === 0) return [];

  const results = [];
  for (const entry of skills) {
    const name = entry.name.toLowerCase();
    const description = entry.description.toLowerCase();
    const whenToUse = (entry.whenToUse ?? '').toLowerCase();
    const tags = (entry.harness?.tags ?? []).map((tag) => String(tag).toLowerCase());
    const topics = (entry.harness?.topics ?? []).map((topic) => String(topic).toLowerCase());
    const stack = (entry.harness?.stack ?? []).map((item) => String(item).toLowerCase());

    let score = 0;
    const matches = [];

    if (name === normalised) {
      score += 100;
      matches.push('name');
    } else if (name.includes(normalised)) {
      score += 60;
      matches.push('name');
    }

    for (const term of terms) {
      if (name.includes(term)) { score += 12; matches.push(`name:${term}`); }
      if (tags.some((tag) => tag.includes(term))) { score += 8; matches.push(`tag:${term}`); }
      if (topics.some((topic) => topic.includes(term))) { score += 6; matches.push(`topic:${term}`); }
      if (stack.some((item) => item.includes(term))) { score += 4; matches.push(`stack:${term}`); }
      if (description.includes(term)) { score += 3; matches.push(`description:${term}`); }
      if (whenToUse.includes(term)) { score += 2; matches.push(`whenToUse:${term}`); }
    }

    if (score > 0) {
      results.push({ entry, score, matches: [...new Set(matches)] });
    }
  }

  results.sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));
  return results.slice(0, limit);
}

/**
 * Check that every library skill is reachable through composition or discovery.
 *
 * @param {Map<string, object>} skills Library index.
 * @param {object} vocabulary Shared capability vocabulary.
 * @param {object[]} presets Specialist presets.
 * @returns {{ referenced: string[], unbound: string[], unknown: string[] }} Reachability report.
 */
export function auditReachability(skills, vocabulary, presets) {
  const referenced = new Set([
    ...(vocabulary.core_skills ?? []),
    ...(vocabulary.discovery_skills ?? []),
  ]);
  const unknown = [];

  const note = (name) => {
    if (!skills.has(name) && !unknown.includes(name)) unknown.push(name);
  };

  for (const [capability, definition] of Object.entries(vocabulary.capabilities ?? {})) {
    for (const name of definition.skills ?? []) {
      referenced.add(name);
      note(name);
    }
    if ((definition.evidence ?? []).length === 0 && (definition.skills ?? []).length > 0) {
      referenced.add(`${capability} (activation-only)`);
    }
  }

  for (const preset of presets) {
    for (const name of preset.specialist_skills ?? []) {
      referenced.add(name);
      note(name);
    }
    for (const name of preset.extra_skills ?? []) {
      referenced.add(name);
      note(name);
    }
    for (const capability of preset.capability_skills ?? []) {
      if (vocabulary.capabilities?.[capability] === undefined) {
        unknown.push(`capability "${capability}" from preset "${preset.id}"`);
      }
    }
    for (const capability of preset.default_capabilities ?? []) {
      if (vocabulary.capabilities?.[capability] === undefined) {
        unknown.push(`default capability "${capability}" from preset "${preset.id}"`);
      }
    }
  }

  const unbound = [...skills.keys()].filter((name) => !referenced.has(name));
  return { referenced: [...referenced], unbound, unknown };
}

/**
 * Scan a directory tree for a marker, used only by the verify CLI.
 *
 * @param {string} root Absolute directory.
 * @returns {string[]} Relative file paths below the root.
 */
export function listTree(root) {
  return walkBounded(root, { maxEntries: 5000 }).files;
}
