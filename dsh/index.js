import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  DEFAULT_SKILL_WATCH_INTERVAL_MS,
  activateSkill,
  buildSkillPlan,
  findSkills,
  inventoryProject,
  lookupCwd,
  registerHarnessSkills,
  skillCatalogReport,
  resumeProject,
  selectWorkspace,
  specialistFor,
} from './skills/plan.js';
import { SKILL_STATE_PATH } from './skills/state.js';
import { createShellGitRunner } from './skills/git.js';

export const name = 'project-harness';
export const inject = ['tools', 'skills'];

export const Config = Schema.object({
  projectRoot: Schema.string().default(process.env.PROJECT_HARNESS_ROOT ?? ''),
  // Constrained in the schema so bad configuration fails while the plugin loads with an
  // actionable error instead of silently disabling catalogue refresh. 0 turns the poll off
  // for a deployment that watches the library some other way.
  skillWatchIntervalMs: Schema.number().step(1).min(0).default(DEFAULT_SKILL_WATCH_INTERVAL_MS),
});

export function apply(ctx, config) {
  const holder = registerHarnessSkills(ctx, config);

  /**
   * Prefer the harness shell executor for the read-only git probe.
   *
   * `shell` is deliberately NOT in this plugin's top-level `inject`: a service nobody
   * provides leaves a plugin PENDING, which would take all six tools down with it. Only
   * the probe needs it, so it is requested here and merely upgrades the runner when it
   * appears. `ctx.inject` unloads and re-runs this callback whenever the service changes,
   * so a hot-replaced shell is followed without restarting the tools.
   *
   * With no shell mounted the probe keeps `scripts/git-probe.js`'s local runner, which is
   * scrubbed, bounded and abortable — a deployment can lose the seam, never the hygiene.
   */
  let shellGitRunner;
  if (typeof ctx.inject === 'function') {
    ctx.inject(['shell'], (shellCtx) => {
      shellGitRunner = createShellGitRunner(shellCtx.shell);
      return () => { shellGitRunner = undefined; };
    });
  }

  /**
   * Select the workspace for one tool call: the calling session cwd wins, and the
   * configured root is only the agentless fallback. Selection deliberately does not
   * validate, so an explicit cwd that is missing fails closed with
   * `WORKSPACE_NOT_FOUND` instead of quietly routing at another project.
   */
  const workspaceFor = (exec) => selectWorkspace(config.projectRoot, lookupCwd(exec));

  /**
   * Refuse to start work the caller has already cancelled.
   *
   * The registry contains a throw as the call's error result, so a cancelled call is
   * reported as cancelled instead of completing and returning evidence nobody wants.
   */
  const abortCheck = (exec) => {
    if (exec?.signal?.aborted === true) throw exec.signal.reason;
  };

  /**
   * Every tool returns one canonical JSON value rather than a pre-stringified blob, so a
   * programmatic caller (PTC mode reaches these as `await tools.<name>(args)`) receives
   * structured fields instead of having to parse prose. The model sees the same text,
   * because `render` owns the model-facing projection.
   */
  const reportOutput = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };

  ctx.tools.register(defineTool({
    name: 'project_harness_resume',
    description: 'Resume a Project Harness workspace by reading its compact memory and discovery status. This is read-only.',
    parameters: {},
    output: reportOutput,
    async execute(_args, exec) {
      abortCheck(exec);
      const selected = workspaceFor(exec);
      // The only tool with child work: it forwards the runner and the caller's signal.
      return resumeProject(selected.path, selected.source, {
        runGit: shellGitRunner,
        signal: exec?.signal,
      });
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_select_specialist',
    description: 'Select a Project Harness specialist from workspace evidence. Currently routes WordPress and Python prospecting projects.',
    parameters: {},
    output: reportOutput,
    async execute(_args, exec) {
      abortCheck(exec);
      const selected = workspaceFor(exec);
      return specialistFor(selected.path, selected.source);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_inventory',
    description: 'Inventory an existing Project Harness workspace and identify possible memory sources. This is read-only and never initializes or modifies files.',
    parameters: {},
    output: reportOutput,
    async execute(_args, exec) {
      abortCheck(exec);
      const selected = workspaceFor(exec);
      return inventoryProject(selected.path, selected.source);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_skill_catalog',
    description: 'Show the composed Project Harness skill catalogue for the selected workspace: which skills the model can currently see, which layer composed each one, which capabilities workspace evidence proved, and which skills the workspace has activated or suppressed. Read-only.',
    parameters: {},
    output: reportOutput,
    async execute(_args, exec) {
      abortCheck(exec);
      return skillCatalogReport(buildSkillPlan(config.projectRoot, lookupCwd(exec)));
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_find_skills',
    description: 'Search the full Project Harness skill library rather than only the visible catalogue, plus any DSH-native project and user skills. Use when the current catalogue lacks a capability, before writing instructions by hand, or before installing an external skill. Read-only.',
    parameters: {
      query: { type: 'string', required: true, description: 'What the task needs, for example "database migrations" or "browser debugging".' },
      limit: { type: 'number', description: 'Maximum matches to return. Defaults to 8.' },
    },
    output: reportOutput,
    async execute(args, exec) {
      abortCheck(exec);
      const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 25) : 8;
      return findSkills(config.projectRoot, lookupCwd(exec), args.query, limit);
    },
  }));

  ctx.tools.register(defineTool({
    name: 'project_harness_activate_skills',
    description: `Activate, deactivate or reset one Project Harness skill in the selected workspace so DSH republishes its model-facing skill catalogue. Use after project_harness_find_skills finds a skill that should be visible, or to suppress a skill the evidence bound but the workspace does not want. Writes only ${SKILL_STATE_PATH}.`,
    parameters: {
      name: { type: 'string', description: 'Exact kebab-case skill name from project_harness_find_skills. Omit for a reset.' },
      action: { type: 'string', description: 'One of activate, deactivate or reset. Defaults to activate.' },
    },
    output: reportOutput,
    async execute(args, exec) {
      abortCheck(exec);
      return activateSkill(config.projectRoot, lookupCwd(exec), holder, args.name, args.action);
    },
  }));
}
