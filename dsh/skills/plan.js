/**
 * Project Harness skill planning, discovery and provider logic.
 *
 * Everything here is plain Node with no DSH imports, so it can be exercised by
 * the test suite against a stub host. `dsh/index.js` is only the DSH-facing
 * shell: it supplies `defineTool` and registers the provider this module
 * builds.
 *
 * @module dsh/skills/plan
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMemoryContext } from '../../scripts/memory-context.js';
import {
  discoverLibrary,
  discoverNativeSkills,
  libraryStatFingerprint,
  loadSkillDefinition,
  searchSkills,
} from './library.js';
import {
  buildEvidenceContext,
  composeSkillPlan,
  detectCapabilities,
  normalizePresetScope,
  readPreset,
  readVocabulary,
} from './composition.js';
import { containsExtension } from './scan.js';
import { SKILL_STATE_PATH, readSkillState, writeSkillState } from './state.js';

/** Project Harness package root, derived from this module's location. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Precedence rank for harness skills.
 *
 * 600 is DeepSeek Harness's `BUNDLED_SKILL_RANK`
 * (`packages/skill/skill/src/index.ts`). The native filesystem provider ranks
 * project roots at 100/200 and user roots at 400/500 inside the same layer, so
 * a project or user skill of the same name shadows the harness version without
 * Project Harness implementing shadowing at all.
 */
export const HARNESS_SKILL_RANK = 600;

/**
 * Origin bucket reported to DSH. Project Harness ships its library inside an
 * installed bundle, and this value is prompt-visible metadata rather than
 * precedence.
 */
export const HARNESS_SKILL_SOURCE = 'bundled';

/** Registered provider name. Must never be DSH's reserved `runtime`. */
export const SKILL_PROVIDER_NAME = 'project-harness';

/** Default poll interval for external skill-library changes. */
export const DEFAULT_SKILL_WATCH_INTERVAL_MS = 2000;

function readText(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(root, relativePath) {
  const content = readText(root, relativePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return { error: `Invalid JSON: ${relativePath}` };
  }
}

function markerStatus(root, relativePath, marker) {
  const content = readText(root, relativePath);
  return content?.split(/\r?\n/).some((line) => line.trim() === marker) ?? false;
}

/** Answer whether a path is a DeepSeek Harness source checkout. */
export function isDshCheckout(root) {
  return fs.existsSync(path.join(root, 'apps', 'cli', 'src', 'bin.ts'))
    && fs.existsSync(path.join(root, 'packages', 'boot'));
}

/**
 * Walk upward to the nearest ancestor containing `.git`, the way DSH's own
 * filesystem skill provider resolves a project root. Without a repository the
 * supplied directory is the workspace.
 *
 * @param {string} start Absolute directory to resolve from.
 * @returns {string} Absolute project root.
 */
export function findProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

/**
 * Resolve and validate the workspace selected for Project Harness.
 *
 * @param {string} configuredRoot Workspace path supplied by DSH configuration.
 * @returns {{ ok: true, root: string } | { ok: false, code: string, message: string }} Resolution result.
 */
export function resolveProjectRoot(configuredRoot) {
  const value = String(configuredRoot ?? '').trim();
  if (!value) {
    return {
      ok: false,
      code: 'WORKSPACE_NOT_CONFIGURED',
      message: 'Set PROJECT_HARNESS_ROOT or projectRoot before using Project Harness tools.',
    };
  }

  const root = path.resolve(value);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return {
      ok: false,
      code: 'WORKSPACE_NOT_FOUND',
      message: `Project Harness workspace does not exist or is not a directory: ${root}`,
    };
  }

  if (isDshCheckout(root)) {
    return {
      ok: false,
      code: 'DSH_CHECKOUT_REJECTED',
      message: `Refusing to use the DeepSeek Harness checkout as the Project Harness workspace: ${root}`,
    };
  }

  return { ok: true, root };
}

/**
 * Select the workspace one DSH operation should use.
 *
 * A calling session owns project identity, so an explicit session cwd always wins
 * and the configured root is only the agentless fallback. The selected cwd is
 * resolved to its nearest `.git` ancestor, the way DSH's own filesystem skill
 * provider resolves a project root.
 *
 * Selection performs no validation: an explicit cwd that turns out to be invalid
 * fails closed in {@link resolveWorkspace} rather than silently routing the
 * operation at a different project.
 *
 * @param {string | undefined} configuredRoot Configured fallback workspace.
 * @param {string | undefined} sessionCwd Calling DSH session workspace.
 * @returns {{ path: string, source: 'session-cwd' | 'configured-fallback' }} Selection with provenance.
 */
export function selectWorkspace(configuredRoot, sessionCwd) {
  if (typeof sessionCwd === 'string' && sessionCwd.trim() !== '') {
    return { path: findProjectRoot(sessionCwd), source: 'session-cwd' };
  }

  return { path: String(configuredRoot ?? '').trim(), source: 'configured-fallback' };
}

/**
 * Resolve and validate the workspace for one operation.
 *
 * @param {string | undefined} configuredRoot Configured fallback workspace.
 * @param {string | undefined} sessionCwd Calling DSH session workspace.
 * @returns {{ ok: true, root: string, source: string } | { ok: false, code: string, message: string, source: string }} Resolution result.
 */
export function resolveWorkspace(configuredRoot, sessionCwd) {
  const selected = selectWorkspace(configuredRoot, sessionCwd);
  const resolution = resolveProjectRoot(selected.path);
  if (!resolution.ok) {
    return { ok: false, code: resolution.code, message: resolution.message, source: selected.source };
  }
  return { ok: true, root: resolution.root, source: selected.source };
}

/** Read the calling agent's session cwd from a DSH tool execution context. */
export function lookupCwd(exec) {
  return exec?.agent?.session?.header?.cwd;
}

/** Keep the extension probe used by specialist detection. */
export function containsFileExtension(root, extension) {
  return containsExtension(root, extension);
}

/**
 * Read one workspace's compact memory.
 *
 * @param {string} projectRoot Selected workspace root.
 * @param {string} projectRootSource Provenance of that root.
 * @param {{ runGit?: Function, signal?: AbortSignal }} [options] Injected git runner and the caller's abort signal.
 * @returns {Promise<object>} Resume report.
 */
export async function resumeProject(projectRoot, projectRootSource = 'configured-fallback', options = {}) {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return {
      status: 'blocked',
      code: resolution.code,
      message: resolution.message,
      project_root_source: projectRootSource,
      writes_performed: false,
    };
  }

  const { root } = resolution;
  const task = readJson(root, '.harness/state/active-task.json');
  const memory = await readMemoryContext(root, options);

  return {
    ...memory,
    project_root: root,
    project_root_source: projectRootSource,
    harness_files_present: Boolean(task || memory.current_state_available || memory.north_star_available),
    active_task: task,
    discovery: {
      system_model: markerStatus(root, '00-PLANNING/SYSTEM-MODEL.md', 'MODEL_STATUS: CONFIRMED'),
      architecture_hypothesis: markerStatus(root, '00-PLANNING/ARCHITECTURE-HYPOTHESIS.md', 'HYPOTHESIS_STATUS: ACCEPTED'),
    },
  };
}

export function specialistFor(projectRoot, projectRootSource = 'configured-fallback') {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return {
      specialist: null,
      confidence: 'blocked',
      evidence: {},
      status: 'blocked',
      code: resolution.code,
      message: resolution.message,
      project_root_source: projectRootSource,
      writes_performed: false,
    };
  }

  const { root } = resolution;
  const topLevel = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const composer = readText(root, 'composer.json') ?? '';
  const packageJson = readText(root, 'package.json') ?? '';
  const hasWordPressDirectory = topLevel.includes('wp-content') || topLevel.includes('wp-admin');
  const hasWordPressConfig = topLevel.includes('wp-config.php') || /wordpress/i.test(composer);
  const phpFiles = topLevel.filter((entry) => entry.endsWith('.php')).slice(0, 20);
  const hasPluginHeader = phpFiles.some((entry) => /Plugin Name:/i.test(readText(root, entry) ?? ''));
  const hasWordPressDependency = /wordpress/i.test(`${composer}\n${packageJson}`);

  const hasPythonFiles = containsFileExtension(root, '.py');
  const hasPythonProjectMarker = [
    'pyproject.toml',
    'requirements.txt',
    'setup.py',
    'tox.ini',
  ].some((entry) => topLevel.includes(entry));
  const hasProspectingShape = [
    'prospecting',
    'data',
    'Data',
    'config',
    'planning_notes',
  ].some((entry) => topLevel.includes(entry));

  if (hasPluginHeader || hasWordPressConfig || hasWordPressDirectory || hasWordPressDependency) {
    const preset = readPreset(PACKAGE_ROOT, 'wordpress-coding');
    if (preset !== undefined) {
      return {
        specialist: preset.id,
        confidence: hasPluginHeader || hasWordPressConfig ? 'high' : 'medium',
        evidence: {
          plugin_header: hasPluginHeader,
          wordpress_config_or_dependency: hasWordPressConfig || hasWordPressDependency,
          wordpress_directory: hasWordPressDirectory,
        },
        project_root: root,
        project_root_source: projectRootSource,
        preset,
        writes_performed: false,
      };
    }
  }

  if (hasPythonFiles && (hasPythonProjectMarker || hasProspectingShape)) {
    const preset = readPreset(PACKAGE_ROOT, 'python-prospecting');
    if (preset !== undefined) {
      return {
        specialist: preset.id,
        confidence: hasPythonProjectMarker ? 'high' : 'medium',
        evidence: {
          python_files: hasPythonFiles,
          python_project_marker: hasPythonProjectMarker,
          prospecting_shape: hasProspectingShape,
        },
        project_root: root,
        project_root_source: projectRootSource,
        preset,
        writes_performed: false,
      };
    }
  }

  return {
    specialist: null,
    confidence: 'none',
    evidence: {},
    project_root: root,
    project_root_source: projectRootSource,
    message: 'No installed Project Harness specialist matched this workspace yet.',
    writes_performed: false,
  };
}

export function inventoryProject(projectRoot, projectRootSource = 'configured-fallback') {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return {
      status: 'blocked',
      code: resolution.code,
      message: resolution.message,
      project_root_source: projectRootSource,
      writes_performed: false,
    };
  }

  const { root } = resolution;
  const candidates = [
    '.harness/state/active-task.json',
    '.harness/state/skills.json',
    'docs/CURRENT-STATE.md',
    'docs/NORTH-STAR.md',
    'CURRENT_OUTPUTS.md',
    'planning_notes',
    'docs',
    'AGENTS.md',
    'README.md',
    '00-PLANNING',
    '.dsh/skills',
    '.agents/skills',
  ];

  return {
    project_root: root,
    project_root_source: projectRootSource,
    top_level: fs.readdirSync(root).sort(),
    memory_candidates: candidates.map((relativePath) => ({
      path: relativePath,
      present: fs.existsSync(path.join(root, relativePath)),
    })),
    writes_performed: false,
  };
}

function emptyPlan(vocabulary, code, reason, source) {
  return {
    workspace: null,
    workspaceSource: source,
    unavailable: reason,
    unavailableCode: code,
    vocabulary,
    specialist: null,
    specialistConfidence: 'none',
    specialistEvidence: {},
    entries: [],
    detected: [],
    activated: [],
    suppressed: [],
    library: new Map(),
    librarySize: 0,
    problems: [],
    unindexed: [],
    duplicates: [],
    stateProblems: [],
    unknownReferences: [],
  };
}

/**
 * Normalize a specialist preset into composition scope.
 *
 * @param {object | undefined} preset Raw preset, if a specialist matched.
 * @param {object} vocabulary Shared capability vocabulary.
 * @returns {object | undefined} Preset with `specialist_skills`, `capability_skills` and `default_capabilities`.
 */
export function normalizeSpecialistPreset(preset, vocabulary) {
  if (preset === undefined || preset === null) return undefined;
  return { ...preset, ...normalizePresetScope(preset, vocabulary) };
}

/**
 * Build the complete skill plan for one workspace in a single pass.
 *
 * @param {string} configuredRoot Configured workspace root.
 * @param {string | undefined} cwd Caller cwd supplied by DSH.
 * @returns {object} Plan with composed entries, evidence, activation state and library problems.
 */
export function buildSkillPlan(configuredRoot, cwd) {
  const vocabulary = readVocabulary(PACKAGE_ROOT) ?? {};
  const resolved = resolveWorkspace(configuredRoot, cwd);

  if (!resolved.ok) return emptyPlan(vocabulary, resolved.code, resolved.message, resolved.source);

  const basePreset = readPreset(PACKAGE_ROOT, 'generic');
  const root = resolved.root;
  const specialist = specialistFor(root);
  const specialistPreset = normalizeSpecialistPreset(specialist.preset, vocabulary);
  const library = discoverLibrary({ packageRoot: PACKAGE_ROOT, workspaceRoot: root });
  const detected = detectCapabilities(buildEvidenceContext(root), vocabulary);
  const state = readSkillState(root);

  const composed = composeSkillPlan({
    vocabulary,
    basePreset,
    specialistPreset,
    detected,
    activated: state.activated,
    available: new Set(library.skills.keys()),
  });

  // A project or user skill in `.dsh/skills` wins over this provider at the DSH registry
  // layer. Composition still selects the harness entry, but the description the model
  // actually reads comes from the nearer copy, so record it and let the reports say which
  // layer is speaking instead of contradicting the catalogue DSH renders.
  const nativeByName = new Map(discoverNativeSkills(root).map((entry) => [entry.name, entry]));

  const suppressed = new Set(state.suppressed);
  const entries = composed.entries
    .filter((entry) => !suppressed.has(entry.name))
    .map((entry) => ({
      ...entry,
      library: library.skills.get(entry.name),
      ...(nativeByName.has(entry.name) ? { native: nativeByName.get(entry.name) } : {}),
    }));

  return {
    workspace: root,
    workspaceSource: resolved.source,
    unavailable: null,
    vocabulary,
    specialist: specialist.specialist,
    specialistConfidence: specialist.confidence,
    specialistEvidence: specialist.evidence,
    entries,
    detected,
    activated: state.activated,
    suppressed: state.suppressed,
    library: library.skills,
    librarySize: library.skills.size,
    problems: library.problems,
    unindexed: library.unindexed,
    duplicates: library.duplicates,
    stateProblems: state.problems,
    unknownReferences: composed.unknown,
  };
}

/**
 * Convert one composed entry into a DSH skill candidate.
 *
 * @param {object} entry Composed entry carrying its library record.
 * @returns {object} DSH candidate.
 */
export function toCandidate(entry) {
  const filePath = entry.library.filePath;
  return {
    name: entry.name,
    description: entry.library.description,
    ...(entry.library.whenToUse === undefined ? {} : { whenToUse: entry.library.whenToUse }),
    invocation: entry.library.invocation,
    source: HARNESS_SKILL_SOURCE,
    provider: SKILL_PROVIDER_NAME,
    rank: HARNESS_SKILL_RANK,
    locator: filePath,
    path: filePath,
    resourceBase: { kind: 'directory', path: path.dirname(filePath) },
    metadata: {
      layer: entry.layer,
      reason: entry.reason,
      ...(entry.capability === undefined ? {} : { capability: entry.capability }),
      harness: entry.library.harness,
    },
  };
}

/**
 * List the library roots a `get()` call is allowed to read from.
 *
 * @param {string} configuredRoot Configured workspace root.
 * @param {string | undefined} cwd Caller cwd supplied by DSH.
 * @returns {string[]} Absolute `.github/skills` directories.
 */
export function allowedSkillRoots(configuredRoot, cwd) {
  const roots = [path.join(PACKAGE_ROOT, '.github', 'skills')];
  const candidates = [cwd ?? '', configuredRoot ?? ''];

  for (const candidate of candidates) {
    if (String(candidate).trim() === '') continue;
    const resolved = resolveProjectRoot(findProjectRoot(candidate));
    if (resolved.ok) roots.push(path.join(resolved.root, '.github', 'skills'));
  }
  return roots;
}

/**
 * Answer whether a mutated path could change the skill catalogue.
 *
 * Mirrors DSH's `isPotentialSkillPath`: a depth-1 `.md` file or a depth-2
 * `SKILL.md`. Resource files below a bundle are not catalog changes.
 *
 * @param {string} filePath Absolute or display path that was written.
 * @param {string[]} roots Absolute package and workspace roots to test against.
 * @returns {boolean} Whether the path is catalog-relevant.
 */
export function isCatalogRelevantPath(filePath, roots) {
  const directories = roots.map((root) => path.join(root, '.github', 'skills'));

  for (const directory of directories) {
    const relative = path.relative(directory, path.resolve(filePath));
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const segments = relative.split(path.sep);
    if (segments.length === 1 && segments[0].endsWith('.md') && segments[0] !== 'INDEX.md') return true;
    if (segments.length === 2 && segments[1] === 'SKILL.md') return true;
  }
  return false;
}

/**
 * Register the composed catalogue with DSH's skill registry and keep it fresh.
 *
 * Invalidation has three sources, mirroring DSH's own filesystem provider:
 *
 *   1. a stat poll, because DSH serves a cache hit without ever calling
 *      `list()` again, so an in-`list()` check alone cannot notice an external
 *      add, remove or description edit;
 *   2. the `fs/observed` host-mutation hook, for immediate notice when a
 *      first-party `write` or `edit` touches a catalog-relevant path;
 *   3. an explicit call from the activation tool, which is the one change that
 *      must be visible to the very next model step.
 *
 * @param {{ skills: object, effect: Function, on: Function }} ctx DSH plugin context.
 * @param {object} config Resolved plugin configuration.
 * @param {object} [holder] Mutable bag receiving the registration's control handles.
 * @returns {object} The holder, with `invalidate()` available after registration.
 */
export function registerHarnessSkills(ctx, config, holder = {}) {
  let previousFingerprint;
  let lastWorkspace = null;

  const libraryRoots = () => (lastWorkspace === null ? [PACKAGE_ROOT] : [PACKAGE_ROOT, lastWorkspace]);
  const currentFingerprint = () => libraryStatFingerprint(libraryRoots());

  const noticeChange = () => {
    const fingerprint = currentFingerprint();
    if (fingerprint === previousFingerprint) return;
    previousFingerprint = fingerprint;
    holder.invalidate?.();
  };

  ctx.effect(() => ctx.skills.registerProvider((control) => {
    holder.invalidate = () => { scheduleInvalidate(control); };
    holder.control = control;

    return {
      name: SKILL_PROVIDER_NAME,
      async list(options = {}) {
        const resolved = resolveWorkspace(config.projectRoot, options.cwd);
        lastWorkspace = resolved.ok ? resolved.root : null;

        // Belt and braces alongside the poll: a workspace switch or an edit
        // that landed between polls is observed here without a delay.
        if (previousFingerprint === undefined) {
          previousFingerprint = currentFingerprint();
        } else {
          noticeChange();
        }

        return buildSkillPlan(config.projectRoot, options.cwd).entries.map(toCandidate);
      },
      async get(candidate, options = {}) {
        // The catalogue is workspace-scoped in both directions. A candidate the
        // current workspace would not have offered must not load, so a skill
        // resolved for one session cannot be pulled into another.
        const plan = buildSkillPlan(config.projectRoot, options.cwd);
        const entry = plan.entries.find((item) => item.name === candidate.name);
        if (entry === undefined) return undefined;
        if (path.resolve(candidate.locator) !== path.resolve(entry.library.filePath)) return undefined;

        const definition = loadSkillDefinition(
          candidate.locator,
          allowedSkillRoots(config.projectRoot, options.cwd),
        );
        if (definition === undefined) return undefined;

        // DSH validates the loaded definition, so it must carry the identity
        // fields the native filesystem provider also returns.
        const source = typeof candidate.source === 'string' ? candidate.source : HARNESS_SKILL_SOURCE;
        return { ...definition, source, provider: SKILL_PROVIDER_NAME };
      },
    };
  }));

  const intervalMs = Number.isFinite(config.skillWatchIntervalMs)
    ? config.skillWatchIntervalMs
    : DEFAULT_SKILL_WATCH_INTERVAL_MS;

  if (intervalMs > 0) {
    ctx.effect(() => {
      const timer = setInterval(noticeChange, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      return () => clearInterval(timer);
    }, 'project-harness skill catalogue poll');
  }

  if (typeof ctx.on === 'function') {
    ctx.on('fs/observed', (target, _observation, actor) => {
      // DSH requires this listener to be a synchronous recorder: a throw would
      // fail the tool call that produced the observation.
      try {
        const toolName = actor !== null && typeof actor === 'object' ? actor.name : undefined;
        if (toolName !== 'edit' && toolName !== 'write') return;
        const displayPath = target !== null && typeof target === 'object' ? target.displayPath : undefined;
        if (typeof displayPath !== 'string') return;
        if (!isCatalogRelevantPath(displayPath, libraryRoots())) return;
        previousFingerprint = currentFingerprint();
        holder.invalidate?.();
      } catch {
        // A recorder must never break the write that produced the observation.
      }
    });
  }

  return holder;
}

function scheduleInvalidate(control, delay = 0) {
  const timer = setTimeout(() => {
    try {
      control.invalidate();
    } catch {
      // Disposal between scheduling and delivery is expected; DSH already
      // ignores invalidation from a disposed registration.
    }
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * Render the composed plan for `project_harness_skill_catalog`.
 *
 * @param {object} plan Composed plan.
 * @returns {object} Report.
 */
export function skillCatalogReport(plan) {
  if (plan.workspace === null) {
    return {
      status: 'blocked',
      code: plan.unavailableCode,
      message: plan.unavailable,
      project_root_source: plan.workspaceSource,
      visible_skills: [],
      writes_performed: false,
    };
  }

  return {
    project_root: plan.workspace,
    project_root_source: plan.workspaceSource,
    specialist: plan.specialist,
    specialist_confidence: plan.specialistConfidence,
    detected_capabilities: plan.detected,
    visible_skills: plan.entries.map((entry) => ({
      name: entry.name,
      layer: entry.layer,
      reason: entry.reason,
      model_invocable: entry.library.invocation.modelInvocable,
      user_invocable: entry.library.invocation.userInvocable,
      description: entry.native?.description ?? entry.library.description,
      ...(entry.native === undefined ? {} : {
        shadowed_by_native: true,
        native_source: entry.native.source,
        native_description: entry.native.description,
        harness_description: entry.library.description,
      }),
    })),
    library_skills: plan.librarySize,
    activated_skills: plan.activated,
    suppressed_skills: plan.suppressed,
    activation_file: SKILL_STATE_PATH,
    ...(plan.problems.length > 0 ? { library_problems: plan.problems } : {}),
    ...(plan.unindexed.length > 0 ? { unindexed_entries: plan.unindexed } : {}),
    ...(plan.duplicates.length > 0 ? { shadowed_skills: plan.duplicates } : {}),
    ...(plan.stateProblems.length > 0 ? { activation_problems: plan.stateProblems } : {}),
    ...(plan.unknownReferences.length > 0 ? { unknown_skill_references: plan.unknownReferences } : {}),
    writes_performed: false,
  };
}

/**
 * Search the whole library for `project_harness_find_skills`.
 *
 * @param {string} configuredRoot Configured workspace root.
 * @param {string | undefined} cwd Caller cwd supplied by DSH.
 * @param {string} query Free-text need.
 * @param {number} limit Maximum matches.
 * @returns {object} Report.
 */
export function findSkills(configuredRoot, cwd, query, limit = 8) {
  const plan = buildSkillPlan(configuredRoot, cwd);
  const librarySkills = [...plan.library.values()];
  const native = discoverNativeSkills(plan.workspace ?? undefined);

  // Search the union of the shipped library and the nearer DSH-native layer, with exactly
  // one corpus entry per name. A native override REPLACES the library entry rather than
  // joining it, because a duplicate would let the superseded library copy win the sort and
  // report a description DSH will never publish.
  const nativeByName = new Map(native.map((entry) => [entry.name, entry]));

  const corpus = librarySkills.map((entry) => {
    const override = nativeByName.get(entry.name);
    if (override === undefined) return entry;
    return {
      ...entry,
      description: override.description,
      ...(override.whenToUse === undefined ? {} : { whenToUse: override.whenToUse }),
      origin: override.source,
      shadowedByNative: true,
    };
  });

  for (const entry of native) {
    if (plan.library.has(entry.name)) continue;
    corpus.push({
      name: entry.name,
      description: entry.description,
      ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
      harness: { layer: 'project-local', tags: [], topics: [], stack: [] },
      origin: entry.source,
      nativeOnly: true,
    });
  }

  const matches = searchSkills(corpus, query, { limit });

  // A native-only skill is visible in the model's catalogue even though this package did
  // not compose it, because DSH's own provider serves it.
  const visible = new Set([
    ...plan.entries.map((entry) => entry.name),
    ...native.map((entry) => entry.name),
  ]);
  const activated = new Set(plan.activated);
  const suppressed = new Set(plan.suppressed);

  return {
    query,
    project_root: plan.workspace,
    library_skills: librarySkills.length,
    matches: matches.map(({ entry, score, matches: matched }) => ({
      name: entry.name,
      description: entry.description,
      ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
      layer: entry.harness.layer,
      tags: entry.harness.tags,
      score,
      matched_on: matched,
      origin: entry.origin ?? 'project-harness',
      currently_visible: visible.has(entry.name),
      ...(entry.shadowedByNative === true ? { shadowed_by_native: true } : {}),
      ...(entry.nativeOnly === true ? { native_only: true, activate_with: 'not required; DSH serves this skill from a nearer layer' } : {}),
      ...(suppressed.has(entry.name) ? { suppressed: true } : {}),
      ...(activated.has(entry.name) ? { activated: true } : {}),
    })),
    ...(native.length > 0 ? {
      dsh_native_skills: native.map((entry) => ({
        name: entry.name,
        description: entry.description,
        source: entry.source,
        shadows_harness_skill: librarySkills.some((skill) => skill.name === entry.name),
        path: entry.filePath,
      })),
    } : {}),
    guidance: matches.length === 0
      ? 'Nothing matched. Widen the query, or search the installable ecosystem with the find-skills skill (npx skills find <query>).'
      : 'Call project_harness_activate_skills with a name whose currently_visible is false and native_only is absent, then load it with the skill tool.',
    writes_performed: false,
  };
}

/**
 * Activate, deactivate or reset one skill for a workspace.
 *
 * @param {string} configuredRoot Configured workspace root.
 * @param {string | undefined} cwd Caller cwd supplied by DSH.
 * @param {object} holder Provider holder whose `invalidate()` republishes the catalogue.
 * @param {string | undefined} rawName Skill name.
 * @param {string | undefined} rawAction One of activate, deactivate, reset.
 * @returns {object} Report.
 */
export function activateSkill(configuredRoot, cwd, holder, rawName, rawAction) {
  const resolved = resolveWorkspace(configuredRoot, cwd);
  if (!resolved.ok) {
    return {
      status: 'blocked',
      code: resolved.code,
      message: resolved.message,
      project_root_source: resolved.source,
      writes_performed: false,
    };
  }

  const root = resolved.root;
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const mode = typeof rawAction === 'string' && rawAction.trim() !== ''
    ? rawAction.trim().toLowerCase()
    : 'activate';

  if (!['activate', 'deactivate', 'reset'].includes(mode)) {
    return {
      status: 'blocked',
      message: `Unknown action "${mode}". Use "activate", "deactivate" or "reset".`,
      writes_performed: false,
    };
  }

  const state = readSkillState(root);
  let activated = [...state.activated];
  let suppressed = [...state.suppressed];

  if (mode === 'reset') {
    activated = [];
    suppressed = [];
  } else {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      return {
        status: 'blocked',
        message: 'A kebab-case skill name is required. Use project_harness_find_skills to find one.',
        writes_performed: false,
      };
    }

    const library = discoverLibrary({ packageRoot: PACKAGE_ROOT, workspaceRoot: root });
    if (!library.skills.has(name)) {
      return {
        status: 'blocked',
        message: `No Project Harness skill named "${name}" exists in this workspace or the installed package.`,
        available_skill_count: library.skills.size,
        writes_performed: false,
      };
    }

    if (mode === 'activate') {
      if (!activated.includes(name)) activated.push(name);
      suppressed = suppressed.filter((entry) => entry !== name);
    } else {
      activated = activated.filter((entry) => entry !== name);
      if (!suppressed.includes(name)) suppressed.push(name);
    }
  }

  const written = writeSkillState(root, { activated, suppressed });
  if (!written.ok) {
    return { status: 'blocked', message: written.message, writes_performed: false };
  }

  holder?.invalidate?.();
  const plan = buildSkillPlan(configuredRoot, cwd);

  return {
    status: 'updated',
    action: mode,
    skill: name === '' ? null : name,
    activation_file: path.relative(root, written.path).split(path.sep).join('/'),
    activated_skills: plan.activated,
    suppressed_skills: plan.suppressed,
    visible_skills: plan.entries.map((entry) => `${entry.name} (${entry.layer})`),
    note: 'DSH republishes the model-facing skill catalogue after this change; load the skill with the skill tool.',
    writes_performed: true,
  };
}
