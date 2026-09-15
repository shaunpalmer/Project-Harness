import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

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
 * Resolve and validate the workspace selected for Project Harness.
 *
 * @param {string} configuredRoot Workspace path supplied by DSH configuration.
 * @returns {{ ok: true, root: string } | { ok: false, code: string, message: string }} Resolution result.
 */
function resolveProjectRoot(configuredRoot) {
  const value = configuredRoot.trim();
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

function resumeProject(projectRoot) {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return JSON.stringify({ status: 'blocked', code: resolution.code, message: resolution.message }, null, 2);
  }

  const { root } = resolution;
  const task = readJson(root, '.harness/state/active-task.json');
  const currentState = readText(root, 'docs/CURRENT-STATE.md');
  const northStar = readText(root, 'docs/NORTH-STAR.md');

  return JSON.stringify({
    project_root: root,
    harness_files_present: Boolean(task || currentState || northStar),
    active_task: task,
    discovery: {
      system_model: markerStatus(root, '00-PLANNING/SYSTEM-MODEL.md', 'MODEL_STATUS: CONFIRMED'),
      architecture_hypothesis: markerStatus(root, '00-PLANNING/ARCHITECTURE-HYPOTHESIS.md', 'HYPOTHESIS_STATUS: ACCEPTED'),
    },
    current_state_available: Boolean(currentState),
    north_star_available: Boolean(northStar),
  }, null, 2);
}

function specialistFor(projectRoot) {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return {
      specialist: null,
      confidence: 'blocked',
      evidence: {},
      status: 'blocked',
      code: resolution.code,
      message: resolution.message,
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
      preset,
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
      preset,
    };
  }

  return {
    specialist: null,
    confidence: 'none',
    evidence: {},
    message: 'No installed Project Harness specialist matched this workspace yet.',
  };
}

function inventoryProject(projectRoot) {
  const resolution = resolveProjectRoot(projectRoot);
  if (!resolution.ok) {
    return JSON.stringify({ status: 'blocked', code: resolution.code, message: resolution.message }, null, 2);
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
 * Register the selected specialist's skills through DSH's native registry.
 * The catalogue exposes summaries; the full Markdown is read only when the
 * model invokes a skill by name.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx DSH plugin context.
 * @param {string} projectRoot Selected workspace root.
 * @returns {void}
 */
function registerSpecialistSkills(ctx, projectRoot) {
  const specialist = specialistFor(projectRoot);
  const requiredSkills = specialist.preset?.required_skills ?? [];
  const skills = requiredSkills
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

  if (skills.length === 0) return;

  ctx.effect(() => ctx.skills.registerProvider(() => ({
    name: 'project-harness',
    async list() {
      return skills;
    },
    async get(candidate) {
      const resolved = resolveSkill(projectRoot, candidate.locator);
      if (!resolved) return undefined;

      return {
        ...candidate,
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
    async execute() {
      return resumeProject(config.projectRoot);
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
    async execute() {
      return JSON.stringify(specialistFor(config.projectRoot), null, 2);
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
    async execute() {
      return inventoryProject(config.projectRoot);
    },
  }));
}
