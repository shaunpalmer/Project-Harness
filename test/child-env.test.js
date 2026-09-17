import assert from 'node:assert/strict';
import test from 'node:test';

import { HARNESS_ENV_PREFIX, SENSITIVE_ENV_PATTERN, droppedEnvKeys, scrubbedEnv } from '../scripts/child-env.js';

/**
 * The scrub exists because a spawned `git` must never inherit the harness process's
 * credentials. These tests pin the rule itself and its application, so a future edit
 * cannot quietly widen what a child receives.
 */

test('the scrub rule matches the harness seam exactly', () => {
  // Mirrors `SENSITIVE_ENV_PATTERN` in packages/subprocess/subprocess/src/index.ts.
  assert.equal(SENSITIVE_ENV_PATTERN.source, 'KEY|PASSWORD|SECRET|TOKEN');
  assert.equal(SENSITIVE_ENV_PATTERN.flags, 'i');
  assert.equal(HARNESS_ENV_PREFIX, 'DSH_');
});

test('credential-shaped keys are dropped and ordinary keys survive', () => {
  const dropped = droppedEnvKeys({
    HOME: '/home/example',
    API_KEY: 'sk-live',
    DB_PASSWORD: 'hunter2',
    MY_SECRET: 's',
    GH_TOKEN: 'ghp_x',
    dsh_home: '/home/example/.dsh',
    PATH: '/usr/bin',
  });

  assert.deepEqual(dropped.sort(), ['API_KEY', 'DB_PASSWORD', 'GH_TOKEN', 'MY_SECRET', 'dsh_home']);
});

test('the pattern is substring and case insensitive, as the seam is', () => {
  // `MONKEY` contains KEY and is dropped by the harness rule too; the point of matching
  // the seam character-for-character is that the two cannot disagree.
  assert.deepEqual(droppedEnvKeys({ api_key: '1', mySecret: '2', MONKEY: '3', HOME: '/h' }).sort(),
    ['MONKEY', 'api_key', 'mySecret']);
});

test('scrubbedEnv removes ambient credentials and keeps everything else', (t) => {
  const previous = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  });

  process.env.PH_PROBE_TOKEN = 'must-not-leak';
  process.env.PH_PROBE_PASSWORD = 'must-not-leak';
  process.env.DSH_PROBE_INTERNAL = 'must-not-leak';
  process.env.PH_PROBE_KEEP = 'kept';

  const env = scrubbedEnv();

  assert.equal(env.PH_PROBE_TOKEN, undefined);
  assert.equal(env.PH_PROBE_PASSWORD, undefined);
  assert.equal(env.DSH_PROBE_INTERNAL, undefined, 'the harness-owned DSH_ namespace is dropped too');
  assert.equal(env.PH_PROBE_KEEP, 'kept');
  assert.equal(typeof env.PATH, 'string', 'an ordinary ambient key must survive');
});

test('scrubbedEnv applies overrides after the scrub and honours removal', () => {
  const env = scrubbedEnv({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', PATH: undefined });

  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(env.PATH, undefined);
  // A caller cannot smuggle a credential back in through the override channel by accident
  // of ordering: overrides are explicit, so they win deliberately.
  assert.equal(scrubbedEnv({ SAFE_TOKEN: 'explicit' }).SAFE_TOKEN, 'explicit');
});

// ---------------------------------------------------------------------------
// The git probe: bounded, scrubbed, abortable, and allowlisted
// ---------------------------------------------------------------------------

test('the probe runs only allowlisted argv and builds only literal commands', async () => {
  const { GIT_PROBE_COMMANDS, gitCommandFor } = await import('../scripts/git-probe.js');

  assert.equal(gitCommandFor(GIT_PROBE_COMMANDS.head), 'git rev-parse HEAD');
  assert.equal(gitCommandFor(GIT_PROBE_COMMANDS.toplevel), 'git rev-parse --show-toplevel');
  // Anything outside the table is refused, so no caller value can reach a shell.
  assert.throws(() => gitCommandFor(['rev-parse', 'HEAD; rm -rf /']), /Refusing an unlisted git probe/);
  assert.throws(() => gitCommandFor(['status', '--porcelain', '--untracked-files=normal', '--extra']), /Refusing an unlisted git probe/);
});

test('an aborted signal is reported as cancellation, not as a probe failure', async () => {
  const { abortedBy, throwIfAborted } = await import('../scripts/git-probe.js');

  const controller = new AbortController();
  controller.abort(new Error('caller went away'));

  assert.equal(abortedBy(controller.signal, new Error('x')), true);
  assert.equal(abortedBy(undefined, Object.assign(new Error('x'), { name: 'AbortError' })), true);
  assert.equal(abortedBy(new AbortController().signal, new Error('x')), false);
  assert.throws(() => throwIfAborted(controller.signal), /caller went away/);
  assert.doesNotThrow(() => throwIfAborted(new AbortController().signal));
});

test('the shell runner is built from the allowlist and forwards the workspace and signal', async () => {
  const { createShellGitRunner } = await import('../dsh/skills/git.js');
  const { GIT_PROBE_COMMANDS } = await import('../scripts/git-probe.js');

  const calls = [];
  const shell = {
    resolve(request) {
      calls.push(request);
      return { ...request, workdir: request.workdir ?? '/resolved' };
    },
    async run(spec) {
      assert.equal(spec.workdir, '/workspace');
      return { exitCode: 0, timedOut: false, aborted: false, timeoutMs: 2000, stdout: { text: 'abc123\n', truncated: false } };
    },
  };

  const controller = new AbortController();
  const runGit = createShellGitRunner(shell);
  const head = await runGit(GIT_PROBE_COMMANDS.head, { cwd: '/workspace', signal: controller.signal });

  assert.equal(head, 'abc123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git rev-parse HEAD');
  assert.equal(calls[0].workdir, '/workspace', 'the workspace travels as a field, never inside the command');
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(calls[0].env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(calls[0].env.GIT_OPTIONAL_LOCKS, '0');
});

test('the shell runner treats a nonzero exit, timeout, abort and truncation as failures', async () => {
  const { createShellGitRunner } = await import('../dsh/skills/git.js');
  const { GIT_PROBE_COMMANDS } = await import('../scripts/git-probe.js');

  const resultFor = (override) => ({
    resolve: (request) => request,
    run: async () => ({ exitCode: 0, timedOut: false, aborted: false, timeoutMs: 2000, stdout: { text: 'x', truncated: false }, ...override }),
  });

  const runGit = (override) => createShellGitRunner(resultFor(override))(GIT_PROBE_COMMANDS.head, { cwd: '/w' });

  await assert.rejects(runGit({ exitCode: 128 }), /exited with 128/);
  await assert.rejects(runGit({ timedOut: true }), /timed out/);
  await assert.rejects(runGit({ aborted: true }), /aborted/);
  await assert.rejects(runGit({ stdout: { text: 'trunc', truncated: true } }), /more output than the probe budget/);
});
