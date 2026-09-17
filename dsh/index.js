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
 * Convert a Project Harness skill path into DSH's kebab-case skill identity.
 *
 * @param {string} relativePath Project-relative Markdown skill path.
 * @returns {string} DSH skill name.
 */
function skillNameFromPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const name = normalized.endsWith('/SKILL.md')
    ? normalized.split('/').at(-2)
    : path.basename(normalized, '.md');

  return name.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

/**
 * Produce a short routing description without loading the full skill body into
 * the model-facing catalogue.
 *
 * @param {string} content Markdown skill content.
 * @param {string} name Skill identity.
 * @returns {string} Short description.
 */
function skillDescription(content, name) {
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/u, '');
  const heading = withoutFrontmatter.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  const paragraph = withoutFrontmatter
    .split(/\r?\n\s*\r?\n/u)
    .map((part) => part.replace(/\r?\n/g, ' ').trim())
    .find((part) => part && !part.startsWith('#'));

  return (heading || paragraph || `Project Harness skill: ${name}.`).slice(0, 500);
}

/**
 * Resolve a skill from the selected workspace first, then the installed
 * Project Harness package. This keeps generated projects authoritative while
 * still allowing the bundle to work before a project handoff has copied the
 * skills locally.
 *
 * @param {string} projectRoot Selected workspace root.
 * @param {string} relativePath Project-relative skill path.
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
 * Build the specialist skill catalogue for one workspace.
 *
 * @param {string} projectRoot Selected workspace root.
 * @param {'session-cwd' | 'configured-fallback'} projectRootSource Root provenance.
 * @returns {Array<object>} DSH skill candidates for the selected specialist.
 */
function specialistSkills(projectRoot, projectRootSource) {
  const specialist = specialistFor(projectRoot, projectRootSource);
  const requiredSkills = specialist.preset?.required_skills ?? [];

  return requiredSkills
    .map((relativePath) => {
      const resolved = resolveSkill(projectRoot, relativePath);
      if (!resolved) return null;

      const name = skillNameFromPath(relativePath);
      return {
        name,
        description: skillDescription(resolved.content, name),
        whenToUse: `Use for ${specialist.specialist} work in the selected workspace.`,
        source: 'project-harness',
        provider: 'project-harness',
        rank: 250,
        locator: relativePath,
        path: resolved.filePath,
        invocation: { modelInvocable: true, userInvocable: true },
      };
    })
    .filter(Boolean);
}

/**
 * Register a cwd-sensitive Project Harness skill provider. DSH supplies the
 * active session workspace in SkillLookupOptions.cwd; configured projectRoot
 * remains only the agentless fallback.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx DSH plugin context.
 * @param {string} configuredRoot Configured fallback workspace root.
 * @returns {void}
 */
function registerSpecialistSkills(ctx, configuredRoot) {
  ctx.effect(() => ctx.skills.registerProvider(() => ({
    name: 'project-harness',
    async list(options = {}) {
      const selected = selectProjectRoot(options.cwd, configuredRoot);
      return specialistSkills(selected.projectRoot, selected.source);
    },
    async get(candidate, options = {}) {
      const selected = selectProjectRoot(options.cwd, configuredRoot);
      const specialist = specialistFor(selected.projectRoot, selected.source);
      const allowedSkills = new Set(specialist.preset?.required_skills ?? []);

      if (typeof candidate.locator !== 'string' || !allowedSkills.has(candidate.locator)) {
        return undefined;
      }

      const resolved = resolveSkill(selected.projectRoot, candidate.locator);
      if (!resolved) return undefined;

      const name = skillNameFromPath(candidate.locator);
      if (name !== candidate.name) return undefined;

      return {
        ...candidate,
        description: skillDescription(resolved.content, name),
        whenToUse: `Use for ${specialist.specialist} work in the selected workspace.`,
        content: resolved.content,
        path: resolved.filePath,
        resourceBase: { kind: 'directory', path: path.dirname(resolved.filePath) },
      };
    },
  })));
}

export function apply(ctx, config) {
  registerSpecialistSkills(ctx, config.projectRoot);

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
    description: 'Select a Project Harness specialist from workspace evidence. Currently routes WordPress and Python prospecting projects.',
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
