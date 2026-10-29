import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { rankSkills } from '../dsh/skills/activation.js';
import { INDEX_END, INDEX_START } from '../dsh/skills/agent-index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The routing surface the agent actually reads: the generated AGENTS.md block. */
function visibleIndex() {
  const text = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const start = text.indexOf(INDEX_START);
  const end = text.indexOf(INDEX_END);
  assert.ok(start !== -1 && end > start, 'AGENTS.md carries no skill index');
  const body = text.slice(start, end);
  const rows = [...body.matchAll(/^- `([^`]+)` — (.*)$/gmu)];
  assert.ok(rows.length > 0, 'the index block has no rows');
  return rows.map((row) => ({ name: row[1], description: row[2] }));
}

const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/skill-activation.json'), 'utf8'));

test('the visible index routes a named skill, a task and a goal to the right line', () => {
  const skills = visibleIndex();
  const failures = [];
  for (const item of fixtures.cases) {
    const ranked = rankSkills(skills, item.prompt);
    const position = ranked.findIndex((entry) => entry.name === item.expect);
    if (item.expect === null) {
      const top = ranked[0];
      if (top !== undefined && top.score > 0) {
        failures.push(`"${item.prompt}" should match nothing, but ${top.name} scored ${top.score}`);
      }
      continue;
    }
    const limit = item.level === 'goal' ? 1 : 0;
    if (position === -1 || position > limit) {
      const top = ranked[0];
      failures.push(
        `"${item.prompt}" expected ${item.expect} at rank <= ${limit + 1}, got rank ${position + 1} (top: ${top.name} ${top.score})`,
      );
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});
