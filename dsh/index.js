import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readMemoryContext } from '../scripts/memory-context.js';

export const name = 'project-harness';
export const inject = ['tools', 'skills'];

export const Config = Schema.object({
  projectRoot: Schema.string().default(process.env.PROJECT_HARNESS_ROOT ?? ''),
});

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_CATALOG_PATH = path.join(PACKAGE_ROOT, 'dsh', 'skill-catalog.json');
const SKILL_LAYERS = new Set(['core', 'specialist', 'capability', 'discovery']);
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function containsFileExtension(root, extension) {
  const pending = [root];
  let inspected = 0;

  while (pending.length > 0 && inspected < 2000) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (['.git', 'node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
      const filePath = path.join(current, entry.name);
      inspected += 1;
      if (entry.isDirectory()) {
        pending.push(filePath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        return true;
      }
      if (inspected >= 2000) break;
    }
  }

  return false;
}

/**
 * Resolve and validate one Project Harness workspace candidate.
 *
 * @param {string} projectRoot Workspace path selected for this operation.
 * @returns {{ ok: true, root: string } | { ok: false, code: string, message: string }} Resolution result.
 */
function resolveProjectRoot(projectRoot) {
  const value = String(projectRoot ?? '').trim();
  if (!value) {
    return {
      ok: false,
      code: 'WORKSPACE_NOT_CONFIGURED',
      message: 'No DSH session workspace or configured Project Harness fallback is available.',
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

  const isDshCheckout = fs.existsSync(path.join(root, 'apps', 'cli', 'src', 'bin.ts'))
    && fs.existsSync(path.join(root, 'packages', 'boot'));
  if (isDshCheckout) {
    return {
      ok: false,
      code: 'DSH_CHECKOUT_REJECTED',
      message: `Refusing to use the DeepSeek Harness checkout as the Project Harness workspace: ${root}`,
    };
  }

  return { ok: true, root };
}

/**
 * Select the workspace Project Harness should use for one DSH operation.
 * A calling session owns project identity; configured projectRoot is only the
 * fallback for agentless/CLI-style calls.
 *
 * @param {string | undefined} sessionCwd Calling DSH session workspace.
 * @param {string | undefined} configuredRoot Configured fallback workspace.
 * @returns {{ projectRoot: string, source: 'session-cwd' | 'configured-fallback' }} Selection.
 */
function selectProjectRoot(sessionCwd, configuredRoot) {
  if (typeof sessionCwd === 'string' && sessionCwd.trim()) {
    return { projectRoot: sessionCwd, source: 'session-cwd' };
  }

  return {
    projectRoot: String(configuredRoot ?? ''),
    source: 'configured-fallback',
  };
}

/**
 * Resolve project identity from the DSH tool execution context.
 *
 * @param {object | undefined} exec DSH tool execution context.
 * @param {string | undefined} configuredRoot Configured fallback workspace.
 * @returns {{ projectRoot: string, source: 'session-cwd' | 'configured-fallback' }} Selection.
 */
function selectProjectRootForExecution(exec, configuredRoot) {
  return selectProjectRoot(exec?.agent?.session?.header?.cwd, configuredRoot);
}

function resumeProject(projectRoot, projectRootSource = 'configured-fallback') {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return JSON.stringify({
      status: 'blocked',
      code: resolution.code,
      message: resolution.message,
      project_root_source: projectRootSource,
    }, null, 2);
  }

  const { root } = resolution;
  const task = readJson(root, '.harness/state/active-task.json');
  const memory = readMemoryContext(root);

  return JSON.stringify({
    ...memory,
    project_root: root,
    project_root_source: projectRootSource,
    harness_files_present: Boolean(task || memory.current_state_available || memory.north_star_available),
    active_task: task,
    discovery: {
      system_model: markerStatus(root, '00-PLANNING/SYSTEM-MODEL.md', 'MODEL_STATUS: CONFIRMED'),
      architecture_hypothesis: markerStatus(root, '00-PLANNING/ARCHITECTURE-HYPOTHESIS.md', 'HYPOTHESIS_STATUS: ACCEPTED'),
    },
  }, null, 2);
}

function specialistFor(projectRoot, projectRootSource = 'configured-fallback') {
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
    const presetPath = path.join(PACKAGE_ROOT, 'dsh', 'specialists', 'wordpress.json');
    const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
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

  if (hasPythonFiles && (hasPythonProjectMarker || hasProspectingShape)) {
    const presetPath = path.join(PACKAGE_ROOT, 'dsh', 'specialists', 'python-prospecting.json');
    const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
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

function inventoryProject(projectRoot, projectRootSource = 'configured-fallback') {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return JSON.stringify({
      status: 'blocked',
      code: resolution.code,
      message: resolution.message,
      project_root_source: projectRootSource,
    }, null, 2);
  }

  const { root } = resolution;
  const candidates = [
    '.harness/state/active-task.json',
    'docs/CURRENT-STATE.md',
    'docs/NORTH-STAR.md',
    'CURRENT_OUTPUTS.md',
    'planning_notes',
    'docs',
    'AGENTS.md',
    'README.md',
    '00-PLANNING',
  ];

  return JSON.stringify({
    project_root: root,
    project_root_source: projectRootSource,
    top_level: fs.readdirSync(root).sort(),
    memory_candidates: candidates.map((relativePath) => ({
      path: relativePath,
      present: fs.existsSync(path.join(root, relativePath)),
    })),
    writes_performed: false,
  }, null, 2);
}

/**
 * Load and validate the package-owned DSH skill catalog.
 * Specialist presets recommend skills; the catalog controls packaged availability.
 *
 * @returns {Array<object>} Validated skill catalog entries.
 */
function readSkillCatalog() {
  const parsed = JSON.parse(fs.readFileSync(SKILL_CATALOG_PATH, 'utf8'));
  if (parsed?.schema_version !== 1 || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid Project Harness skill catalog schema.');
  }

  const seen = new Set();
  return parsed.skills.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Skill catalog entries must be objects.');
    if (typeof entry.name !== 'string' || !SKILL_NAME.test(entry.name)) {
      throw new Error(`Invalid Project Harness skill name: ${String(entry.name)}`);
    }
    if (seen.has(entry.name)) throw new Error(`Duplicate Project Harness skill name: ${entry.name}`);
    seen.add(entry.name);
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new Error(`Skill ${entry.name} is missing a path.`);
    }
    if (typeof entry.description !== 'string' || !entry.description.trim()) {
      throw new Error(`Skill ${entry.name} is missing a description.`);
    }
    if (!SKILL_LAYERS.has(entry.layer)) {
      throw new Error(`Skill ${entry.name} has invalid layer: ${String(entry.layer)}`);
    }
    const invocation = entry.invocation ?? {};
    if (typeof invocation.modelInvocable !== 'boolean' || typeof invocation.userInvocable !== 'boolean') {
      throw new Error(`Skill ${entry.name} has invalid invocation policy.`);
    }
    return entry;
  });
}

/**
 * Convert a legacy Project Harness skill path into its kebab-case identity.
 * This remains only for backward-compatible specialist presets.
 *
 * @param {string} relativePath Project-relative Markdown skill path.
 * @returns {string} Skill name.
 */
function skillNameFromPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const name = normalized.endsWith('/SKILL.md')
    ? normalized.split('/').at(-2)
    : path.basename(normalized, '.md');

  return name.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

/**
 * Flatten the specialist's recommended skill profile into one set of names.
 * Availability remains controlled by the package catalog and DSH's other layers.
 *
 * @param {object | undefined} preset Specialist preset.
 * @returns {Set<string>} Recommended skill names.
 */
function recommendedSkillNames(preset) {
  const profile = preset?.skill_profile;
  if (profile && typeof profile === 'object') {
    const names = Object.values(profile)
      .flatMap((value) => Array.isArray(value) ? value : [])
      .filter((value) => typeof value === 'string');
    return new Set(names);
  }

  return new Set((preset?.required_skills ?? []).map(skillNameFromPath));
}

/**
 * Resolve a packaged Project Harness skill from the selected workspace first,
 * then the installed Project Harness package. The project copy is an override
 * for curated Project Harness skills only; arbitrary project/user skills remain
 * DSH's native filesystem provider responsibility.
 *
 * @param {string} projectRoot Selected workspace root.
 * @param {string} relativePath Catalog skill path.
 * @returns {{ content: string, filePath: string } | null} Skill file or null.
 */
function resolveSkill(projectRoot, relativePath) {
  for (const root of [path.resolve(projectRoot), PACKAGE_ROOT]) {
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) continue;

    return {
      content: fs.readFileSync(filePath, 'utf8'),
      filePath,
    };
  }

  return null;
}

/**
 * Build the Project Harness packaged skill catalog for one workspace.
 * All curated entries stay discoverable; specialist profiles only mark which
 * ones are recommended for the detected project type.
 *
 * @param {string} projectRoot Selected workspace root.
 * @param {'session-cwd' | 'configured-fallback'} projectRootSource Root provenance.
 * @returns {Array<object>} DSH skill candidates.
 */
function projectHarnessSkills(projectRoot, projectRootSource) {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) return [];

  const specialist = specialistFor(resolution.root, projectRootSource);
  const recommended = recommendedSkillNames(specialist.preset);

  return readSkillCatalog()
    .map((entry) => {
      const resolved = resolveSkill(resolution.root, entry.path);
      if (!resolved) return null;
      const isRecommended = recommended.has(entry.name)
        || (specialist.specialist === null && entry.layer === 'discovery');

      return {
        name: entry.name,
        description: entry.description,
        ...(entry.when_to_use ? { whenToUse: entry.when_to_use } : {}),
        source: 'project-harness',
        provider: 'project-harness',
        rank: 250,
        locator: { name: entry.name, path: entry.path },
        path: resolved.filePath,
        invocation: entry.invocation,
        metadata: {
          projectHarnessLayer: entry.layer,
          recommended: isRecommended,
          specialist: specialist.specialist,
        },
      };
    })
    .filter(Boolean);
}

/**
 * Resolve one provider candidate against the current catalog and workspace.
 *
 * @param {object} candidate Candidate selected by DSH.
 * @param {string} projectRoot Current workspace root.
 * @returns {{ entry: object, resolved: { content: string, filePath: string } } | null} Valid load target.
 */
function resolveCatalogCandidate(candidate, projectRoot) {
  if (!candidate?.locator || typeof candidate.locator !== 'object') return null;
  const locatorName = candidate.locator.name;
  const locatorPath = candidate.locator.path;
  if (typeof locatorName !== 'string' || typeof locatorPath !== 'string') return null;
  if (candidate.name !== locatorName) return null;

  const entry = readSkillCatalog().find((item) => item.name === locatorName && item.path === locatorPath);
  if (!entry) return null;
  const resolved = resolveSkill(projectRoot, entry.path);
  if (!resolved) return null;
  return { entry, resolved };
}

/**
 * Register a cwd-sensitive Project Harness skill provider. DSH owns cross-layer
 * merging and project/user discovery; this provider supplies the curated global
 * Project Harness catalog and uses provider-scoped invalidation for manifest changes.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx DSH plugin context.
 * @param {string} configuredRoot Configured fallback workspace root.
 * @returns {void}
 */
function registerProjectHarnessSkills(ctx, configuredRoot) {
  ctx.effect(() => {
    let invalidate = () => {};
    const disposeProvider = ctx.skills.registerProvider((control) => {
      invalidate = control.invalidate;
      return {
        name: 'project-harness',
        async list(options = {}) {
          options.signal?.throwIfAborted?.();
          const selected = selectProjectRoot(options.cwd, configuredRoot);
          return projectHarnessSkills(selected.projectRoot, selected.source);
        },
        async get(candidate, options = {}) {
          options.signal?.throwIfAborted?.();
          const selected = selectProjectRoot(options.cwd, configuredRoot);
          const resolution = resolveProjectRoot(selected.projectRoot);
          if (!resolution.ok) return undefined;
          const loaded = resolveCatalogCandidate(candidate, resolution.root);
          if (!loaded) return undefined;

          return {
            ...candidate,
            description: loaded.entry.description,
            ...(loaded.entry.when_to_use ? { whenToUse: loaded.entry.when_to_use } : {}),
            invocation: loaded.entry.invocation,
            content: loaded.resolved.content,
            path: loaded.resolved.filePath,
            resourceBase: { kind: 'directory', path: path.dirname(loaded.resolved.filePath) },
          };
        },
      };
    });

    const onCatalogChange = (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) invalidate();
    };
    fs.watchFile(SKILL_CATALOG_PATH, { persistent: false, interval: 500 }, onCatalogChange);

    return () => {
      fs.unwatchFile(SKILL_CATALOG_PATH, onCatalogChange);
      disposeProvider();
    };
  });
}

export function apply(ctx, config) {
  registerProjectHarnessSkills(ctx, config.projectRoot);

  ctx.tools.register(defineTool({
    name: 'project_harness_resume',
    description: 'Resume a Project Harness workspace by reading its compact memory and discovery status. This is read-only.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      const selected = selectProjectRootForExecution(exec, config.projectRoot);
      return resumeProject(selected.projectRoot, selected.source);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_select_specialist',
    description: 'Select a Project Harness specialist from workspace evidence. Specialist profiles recommend skill layers; the wider curated catalog stays discoverable on demand.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      const selected = selectProjectRootForExecution(exec, config.projectRoot);
      return JSON.stringify(specialistFor(selected.projectRoot, selected.source), null, 2);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_inventory',
    description: 'Inventory an existing Project Harness workspace and identify possible memory sources. This is read-only and never initializes or modifies files.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      const selected = selectProjectRootForExecution(exec, config.projectRoot);
      return inventoryProject(selected.projectRoot, selected.source);
    },
  }));
}
