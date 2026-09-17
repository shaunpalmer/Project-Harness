#!/usr/bin/env node
/**
 * Verify the Project Harness skill library metadata and composition bindings.
 *
 * Fails loudly on anything that would make DSH advertise a broken catalogue:
 * a skill without valid frontmatter, a name that disagrees with its path, an
 * evidence token with no detector, or a capability/preset that points at a
 * skill which does not exist.
 *
 * Reports but does not fail on entries that are not skills (a stray asset in
 * the skill root) or on skills reachable only through `find_skills`, because
 * those are reachable by design.
 *
 * Usage:
 *   node scripts/skills-verify.js [--workspace /path] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditReachability, discoverLibrary } from '../dsh/skills/library.js';
import { EVIDENCE_DETECTORS, listPresetIds, readPreset, readVocabulary } from '../dsh/skills/composition.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { _: [], json: false, workspace: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--workspace') {
      args.workspace = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    args._.push(token);
  }
  return args;
}

export function verifySkillLibrary(options = {}) {
  const packageRoot = options.packageRoot ?? ROOT;
  const workspaceRoot = options.workspaceRoot ?? '';
  const failures = [];
  const warnings = [];

  const vocabulary = readVocabulary(packageRoot);
  if (vocabulary === undefined) {
    failures.push('dsh/skills/capabilities.json is missing or not valid JSON');
    return { failures, warnings, skills: new Map(), presets: [] };
  }
  if (vocabulary.schema_version !== 1) {
    failures.push(`capabilities.json has unsupported schema_version ${String(vocabulary.schema_version)}`);
  }

  const presetIds = listPresetIds(packageRoot);
  const presets = [];
  for (const id of presetIds) {
    const preset = readPreset(packageRoot, id);
    if (preset === undefined) {
      failures.push(`dsh/specialists/${id}.json is not valid JSON`);
      continue;
    }
    if (preset.id !== id) {
      failures.push(`dsh/specialists/${id}.json declares id "${String(preset.id)}"`);
    }
    presets.push(preset);
  }

  const library = discoverLibrary({
    packageRoot,
    ...(workspaceRoot === '' ? {} : { workspaceRoot }),
  });

  for (const problem of library.problems) failures.push(`library: ${problem}`);

  const names = new Set();
  for (const [name, entry] of library.skills) {
    if (names.has(name)) failures.push(`duplicate skill name "${name}"`);
    names.add(name);

    if (entry.harness.tier === undefined) failures.push(`${name}: missing metadata.harness.tier`);
    if (entry.harness.tags.length === 0) warnings.push(`${name}: no metadata.harness.tags`);
    if (entry.harness.topics.length === 0) warnings.push(`${name}: no metadata.harness.topics`);
    if (entry.whenToUse === undefined) warnings.push(`${name}: no whenToUse`);
    if (entry.description.length < 40) {
      failures.push(`${name}: description is only ${entry.description.length} characters and cannot route the model`);
    }
    if (/^#|^SKILL:/u.test(entry.description)) {
      failures.push(`${name}: description repeats a heading instead of describing routing`);
    }
  }

  for (const [capability, definition] of Object.entries(vocabulary.capabilities ?? {})) {
    for (const token of definition.evidence ?? []) {
      if (!EVIDENCE_DETECTORS.has(token)) {
        failures.push(`capability "${capability}" declares evidence token "${token}" with no detector`);
      }
    }
    if ((definition.skills ?? []).length === 0) {
      failures.push(`capability "${capability}" binds no skills`);
    }
  }

  const audit = auditReachability(library.skills, vocabulary, presets);
  for (const unknown of audit.unknown) failures.push(`unknown skill or capability reference: ${unknown}`);

  for (const preset of presets) {
    const declared = new Set([
      ...(preset.capability_skills ?? []),
      ...(preset.default_capabilities ?? []),
    ]);
    for (const capability of declared) {
      if (vocabulary.capabilities?.[capability] === undefined) {
        failures.push(`preset "${preset.id}" references unknown capability "${capability}"`);
      }
    }
    if (preset.id !== 'generic' && (preset.specialist_skills ?? []).length === 0 && (preset.extra_skills ?? []).length === 0) {
      warnings.push(`preset "${preset.id}" contributes no specialist skill`);
    }
  }

  if (library.duplicates.length > 0) {
    for (const duplicate of library.duplicates) warnings.push(`shadowed: ${duplicate}`);
  }
  for (const entry of library.unindexed) warnings.push(`not a skill (unindexed): ${entry}`);
  for (const unbound of audit.unbound) {
    warnings.push(`"${unbound}" is reachable only through project_harness_find_skills`);
  }

  return { failures, warnings, skills: library.skills, presets, vocabulary, audit };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifySkillLibrary({
    packageRoot: ROOT,
    workspaceRoot: args.workspace,
  });

  if (args.json) {
    console.log(JSON.stringify({
      ok: result.failures.length === 0,
      failures: result.failures,
      warnings: result.warnings,
      skills: [...result.skills.values()].map((entry) => ({
        name: entry.name,
        tier: entry.harness.tier,
        description_length: entry.description.length,
        tags: entry.harness.tags,
        user_invocable: entry.invocation.userInvocable,
      })),
      presets: result.presets.map((preset) => preset.id),
    }, null, 2));
    process.exitCode = result.failures.length === 0 ? 0 : 1;
    return;
  }

  console.log(`Skill library: ${result.skills.size} skills, ${result.presets.length} presets`);
  const byTier = new Map();
  for (const entry of result.skills.values()) {
    const tier = entry.harness.tier;
    byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
  }
  for (const [tier, count] of [...byTier].sort()) console.log(`  ${tier}: ${count}`);

  if (result.warnings.length > 0) {
    console.log(`\n${result.warnings.length} warning(s):`);
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }

  if (result.failures.length > 0) {
    console.error(`\nSkill metadata verification failed with ${result.failures.length} problem(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nSkill metadata verification passed.');
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main();
}
