/**
 * Child-process environment hygiene.
 *
 * A spawned command must never inherit the harness process's credentials. DeepSeek
 * Harness enforces this in its subprocess seam
 * (`packages/subprocess/subprocess/src/index.ts`, `scrubbedParentEnv()`), which drops
 * every key matching `/KEY|PASSWORD|SECRET|TOKEN/i` plus its own `DSH_*` namespace
 * before any child starts.
 *
 * Project Harness runs a read-only `git` probe from two callers: the DSH tools, which
 * reach the seam, and the CLI, which has no Cordis context. This module mirrors the
 * seam's rule exactly so the CLI path is scrubbed to the same standard instead of
 * leaking the ambient environment, and so a deployment without the shell service
 * degrades to an equivalently safe spawn rather than an unsafe one.
 *
 * @module scripts/child-env
 */

/**
 * Environment keys never handed to a child process.
 *
 * Kept character-identical to the DSH seam's pattern so the two cannot drift into
 * disagreeing about what counts as a credential.
 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

/** Harness-owned environment namespace, dropped from every child by the seam. */
export const HARNESS_ENV_PREFIX = 'DSH_';

/**
 * Build a child environment with credentials removed.
 *
 * Ambient proxy variables are preserved deliberately: a `git` probe must be able to
 * reach the same network the harness does.
 *
 * @param {Record<string, string | undefined>} [overrides] Entries applied after the scrub. An `undefined` value removes the key.
 * @returns {Record<string, string>} Fresh environment object safe to hand to a spawn.
 */
export function scrubbedEnv(overrides = {}) {
  const env = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERN.test(key)) continue;
    if (key.toUpperCase().startsWith(HARNESS_ENV_PREFIX)) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }
    env[key] = String(value);
  }

  return env;
}

/**
 * Report which keys the scrub would remove from a candidate environment.
 *
 * Exposed so a verification gate can prove the rule against a synthetic environment
 * instead of asserting on the real process environment.
 *
 * @param {Record<string, string | undefined>} environment Candidate environment.
 * @returns {string[]} Keys the scrub removes, in input order.
 */
export function droppedEnvKeys(environment) {
  const dropped = [];
  for (const key of Object.keys(environment)) {
    if (SENSITIVE_ENV_PATTERN.test(key) || key.toUpperCase().startsWith(HARNESS_ENV_PREFIX)) {
      dropped.push(key);
    }
  }
  return dropped;
}
