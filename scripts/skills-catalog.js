#!/usr/bin/env node
/**
 * Generate `dsh/skill-catalog.json` from the skill library.
 *
 * Skill frontmatter is the single source of truth; this file is a generated,
 * verified view of it. Run after adding, removing, renaming or re-describing a
 * skill, then `npm run skills:verify` proves the written file matches the library.
 *
 * Usage:
 *   node scripts/skills-catalog.js           # write the catalog
 *   node scripts/skills-catalog.js --check    # fail if the catalog is stale
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverLibrary } from '../dsh/skills/library.js';
import { CATALOG_PATH, buildCatalog, readCatalog, serializeCatalog } from '../dsh/skills/catalog.js';
import { SKILL_INDEX_BUDGET, applyIndexBlock, buildIndexBlock, heaviest } from '../dsh/skills/agent-index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  const check = process.argv.includes('--check');
  const library = discoverLibrary({ packageRoot: ROOT });

  if (library.problems.length > 0) {
    console.error('Refusing to generate a catalog from a broken library:');
    for (const problem of library.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const expected = serializeCatalog(buildCatalog(library, ROOT));
  const agentsFile = path.join(ROOT, 'AGENTS.md');
  const skills = [...library.skills.values()].map((entry) => ({ name: entry.name, description: entry.description }));
  const block = buildIndexBlock(skills);

  // The index is always in context, so its size is a deliberate purchase.
  if (block.length > SKILL_INDEX_BUDGET) {
    console.error(`The skill index is ${block.length} characters, over its ${SKILL_INDEX_BUDGET} budget.`);
    console.error('Shorten these triggers (the description decides whether the skill is ever used):');
    for (const row of heaviest(skills)) console.error(`  - ${row.name}: ${row.length} characters`);
    process.exitCode = 1;
    return;
  }
  const absolute = path.join(ROOT, CATALOG_PATH);
  const committed = readCatalog(ROOT);

  if (check) {
    if (!committed.ok) {
      for (const problem of committed.problems) console.error(`  - ${problem}`);
      console.error(`\n${CATALOG_PATH} is missing or invalid.`);
      process.exitCode = 1;
      return;
    }
    if (committed.text !== expected) {
      console.error(`${CATALOG_PATH} is stale. Run: npm run skills:catalog`);
      process.exitCode = 1;
      return;
    }
    const currentAgents = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : '';
    if (!currentAgents.includes(block)) {
      console.error('AGENTS.md skill index is stale or missing. Run: npm run skills:catalog');
      process.exitCode = 1;
      return;
    }
    console.log(`${CATALOG_PATH} is current (${library.skills.size} entries).`);
    return;
  }

  fs.writeFileSync(absolute, expected, 'utf8');
  console.log(`Wrote ${CATALOG_PATH} (${library.skills.size} entries).`);

  const before = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : '';
  const after = applyIndexBlock(before, block);
  if (after !== before) {
    fs.writeFileSync(agentsFile, after, 'utf8');
    console.log(`Wrote the skill index into AGENTS.md (${block.length} of ${SKILL_INDEX_BUDGET} characters).`);
  } else {
    console.log(`AGENTS.md skill index is current (${block.length} of ${SKILL_INDEX_BUDGET} characters).`);
  }
}

main();
