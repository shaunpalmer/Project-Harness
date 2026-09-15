import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'project-harness';
export const inject = ['tools'];

export const Config = Schema.object({
  projectRoot: Schema.string().default(process.env.PROJECT_HARNESS_ROOT ?? process.cwd()),
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

function resumeProject(projectRoot) {
  const root = path.resolve(projectRoot);
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
  const root = path.resolve(projectRoot);
  const topLevel = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const composer = readText(root, 'composer.json') ?? '';
  const packageJson = readText(root, 'package.json') ?? '';
  const hasWordPressDirectory = topLevel.includes('wp-content') || topLevel.includes('wp-admin');
  const hasWordPressConfig = topLevel.includes('wp-config.php') || /wordpress/i.test(composer);
  const phpFiles = topLevel.filter((entry) => entry.endsWith('.php')).slice(0, 20);
  const hasPluginHeader = phpFiles.some((entry) => /Plugin Name:/i.test(readText(root, entry) ?? ''));
  const hasWordPressDependency = /wordpress/i.test(`${composer}\n${packageJson}`);

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

  return {
    specialist: null,
    confidence: 'none',
    evidence: {},
    message: 'No installed Project Harness specialist matched this workspace yet.',
  };
}

export function apply(ctx, config) {
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
    description: 'Select a Project Harness specialist from workspace evidence. Currently routes WordPress coding projects only.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return JSON.stringify(specialistFor(config.projectRoot), null, 2);
    },
  }));
}
