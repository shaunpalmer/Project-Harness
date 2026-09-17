/**
 * Workspace skill activation state.
 *
 * This is the only file Project Harness writes for skill routing, and it lives
 * in `.harness/state/`, which the harness already owns. It records the two
 * decisions evidence cannot make for the model:
 *
 *   - `activated_skills`  — skills promoted into this workspace's catalogue
 *                           after `project_harness_find_skills` found them.
 *   - `suppressed_skills` — skills the evidence bound but this workspace does
 *                           not want.
 *
 * Reads are bounded and never throw; writes are atomic and path-contained.
 *
 * @module dsh/skills/state
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isSkillName } from './frontmatter.js';
import { isInside, readFileBounded } from './scan.js';

/** Workspace-relative activation record. */
export const SKILL_STATE_PATH = '.harness/state/skills.json';

const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 65536;

/**
 * Read the workspace activation record.
 *
 * @param {string} projectRoot Absolute workspace root.
 * @returns {{ activated: string[], suppressed: string[], problems: string[], present: boolean }} Current state.
 */
export function readSkillState(projectRoot) {
  const empty = { activated: [], suppressed: [], problems: [], present: false };
  if (typeof projectRoot !== 'string' || projectRoot === '') return empty;

  const filePath = path.join(path.resolve(projectRoot), SKILL_STATE_PATH);
  if (!isInside(projectRoot, filePath)) return empty;

  const content = readFileBounded(filePath, MAX_STATE_BYTES);
  if (content === undefined) return empty;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ...empty, present: true, problems: [`${SKILL_STATE_PATH} is not valid JSON`] };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...empty, present: true, problems: [`${SKILL_STATE_PATH} must contain a JSON object`] };
  }

  const problems = [];
  if (parsed.schema_version !== undefined && parsed.schema_version !== SCHEMA_VERSION) {
    problems.push(`${SKILL_STATE_PATH} has unsupported schema_version ${String(parsed.schema_version)}`);
  }

  return {
    activated: readNames(parsed.activated_skills, 'activated_skills', problems),
    suppressed: readNames(parsed.suppressed_skills, 'suppressed_skills', problems),
    problems,
    present: true,
  };
}

function readNames(value, field, problems) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${SKILL_STATE_PATH} field "${field}" must be a list`);
    return [];
  }
  const names = [];
  for (const item of value) {
    if (!isSkillName(item)) {
      problems.push(`${SKILL_STATE_PATH} field "${field}" contains an invalid skill name: ${String(item)}`);
      continue;
    }
    if (!names.includes(item)) names.push(item);
  }
  return names;
}

/**
 * Resolve a workspace root to its canonical path.
 *
 * Containment tested against a raw path can be defeated by a symlinked workspace; the
 * documented canon is filesystem resolution first, lexical second
 * (`docs/subsystems/workspace.md`). Falls back to the lexical path when the directory
 * does not exist yet, so the caller still reports its own "not a directory" error.
 *
 * @param {string} projectRoot Workspace root as supplied.
 * @returns {string} Canonical absolute root.
 */
function canonicalRoot(projectRoot) {
  const resolved = path.resolve(projectRoot);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Write the workspace activation record atomically and privately.
 *
 * The write follows the defensive rules for temp files: a private directory, a random
 * name, and an exclusive owner-only create. A predictable name in a shared directory
 * invites a symlink race, and a temp file left behind after a failed rename leaks the
 * previous content.
 *
 * @param {string} projectRoot Absolute workspace root.
 * @param {{ activated: string[], suppressed: string[] }} state Names to persist.
 * @param {string} [now] ISO timestamp, injectable for tests.
 * @returns {{ ok: true, path: string } | { ok: false, message: string }} Write result.
 */
export function writeSkillState(projectRoot, state, now = new Date().toISOString()) {
  if (typeof projectRoot !== 'string' || projectRoot === '') {
    return { ok: false, message: 'A workspace root is required before skill activation can be recorded.' };
  }

  const root = canonicalRoot(projectRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, message: `Workspace does not exist or is not a directory: ${root}` };
  }

  const harnessDirectory = path.join(root, '.harness');
  // Refuse before creating anything: a symlinked `.harness` would put the mkdir itself
  // outside the workspace, so the escape has to be caught before the directory exists.
  if (fs.existsSync(harnessDirectory) && !isInside(root, fs.realpathSync(harnessDirectory))) {
    return { ok: false, message: `Refusing to write outside the workspace: ${harnessDirectory}` };
  }

  const directory = path.join(harnessDirectory, 'state');
  const filePath = path.join(directory, 'skills.json');
  if (!isInside(root, filePath)) {
    return { ok: false, message: `Refusing to write outside the workspace: ${filePath}` };
  }

  const activated = normalise(state.activated);
  const suppressed = normalise(state.suppressed);
  const payload = {
    schema_version: SCHEMA_VERSION,
    activated_skills: activated,
    suppressed_skills: suppressed,
    updated: now,
  };

  let temporary;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    // Re-check after creation: a symlinked state directory may have been created rather
    // than rejected by the pre-check above.
    if (!isInside(root, fs.realpathSync(directory))) {
      return { ok: false, message: `Refusing to write outside the workspace: ${directory}` };
    }

    temporary = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      // 'wx' fails rather than following an existing path, so a planted symlink cannot
      // redirect the write; 0o600 keeps the record owner-only.
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (temporary !== undefined) {
      try {
        fs.unlinkSync(temporary);
      } catch { /* The rename already consumed it, or it was never created. */ }
    }
    return { ok: false, message: `Could not record skill activation: ${error.message}` };
  }

  return { ok: true, path: filePath };
}

function normalise(names) {
  if (!Array.isArray(names)) return [];
  const out = [];
  for (const name of names) {
    if (isSkillName(name) && !out.includes(name)) out.push(name);
  }
  return out.sort();
}
