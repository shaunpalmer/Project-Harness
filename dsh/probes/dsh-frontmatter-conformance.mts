/**
 * Frontmatter conformance: Project Harness parser vs DSH's real provider.
 *
 * The library claims its skill files are valid input for DSH's own filesystem
 * provider. This probe proves or disproves that per file and per edge case by
 * parsing the same bytes through DSH's real provider and comparing the result
 * with `readSkillEntry()`.
 *
 * Prints one JSON object on stdout; exits non-zero when any case diverges.
 *
 *   node --import tsx/esm <this-file> <project-harness-root>
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem';

const packageRoot = process.argv[2];
if (typeof packageRoot !== 'string' || packageRoot === '') {
  console.error('usage: node --import tsx/esm dsh-frontmatter-conformance.mts <project-harness-root>');
  process.exit(2);
}

const { readSkillEntry } = await import(join(packageRoot, 'dsh', 'skills', 'library.js'));

const home = await mkdtemp(join(tmpdir(), 'dsh-ph-conf-'));
const root = join(home, '.dsh', 'skills');
await mkdir(root, { recursive: true });

const writeCase = async (name, raw) => {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), raw);
};

const longDescription = 'A routing description that is comfortably long enough to satisfy the harness gate.';

// Every shape our authored files use, plus the edge cases where a hand-written
// parser is most likely to diverge from a real YAML implementation.
const cases = {
  'plain-scalar': `---\nname: plain-scalar\ndescription: ${longDescription}\n---\nBody.\n`,
  'quoted-scalar': `---\nname: quoted-scalar\ndescription: "${longDescription} with: a colon"\n---\nBody.\n`,
  'hash-in-quoted': `---\nname: hash-in-quoted\ndescription: "${longDescription} # not a comment"\n---\nBody.\n`,
  'hash-unquoted': `---\nname: hash-unquoted\ndescription: ${longDescription} # a comment\n---\nBody.\n`,
  'leading-bracket': `---\nname: leading-bracket\ndescription: [draft] ${longDescription}\n---\nBody.\n`,
  'when-to-use': `---\nname: when-to-use\ndescription: "${longDescription}"\nwhenToUse: "Use when the probe needs it."\n---\nBody.\n`,
  'user-invocable-false': `---\nname: user-invocable-false\ndescription: "${longDescription}"\nuser-invocable: false\n---\nBody.\n`,
  'disable-model-yes': `---\nname: disable-model-yes\ndescription: "${longDescription}"\ndisable-model-invocation: yes\n---\nBody.\n`,
  'folded-scalar': `---\nname: folded-scalar\ndescription:\n  ${longDescription}\n---\nBody.\n`,
  'metadata-nested': `---\nname: metadata-nested\ndescription: "${longDescription}"\nmetadata:\n  harness:\n    layer: core\n    topics: [alpha, beta]\n    tags: [one, two]\n---\nBody.\n`,
  'metadata-block-array': `---\nname: metadata-block-array\ndescription: "${longDescription}"\nmetadata:\n  harness:\n    layer: capability\n    topics:\n      - alpha\n      - beta\n---\nBody.\n`,
  'legacy-invocation-key': `---\nname: legacy-invocation-key\ndescription: "${longDescription}"\nmodelInvocable: false\n---\nBody.\n`,
  'typed-scaling': `---\nname: typed-scaling\ndescription: "${longDescription}"\n---\nBody with a leading blank line\nand a trailing one.\n\n`,
  'body-fence': `---\nname: body-fence\ndescription: "${longDescription}"\n---\n\n# Heading\n\n\`\`\`\nnot: frontmatter\n---\n\`\`\`\n`,
};

for (const [name, raw] of Object.entries(cases)) await writeCase(name, raw);

// Also every file this package actually ships.
const shipped = [];
for (const entry of await readdir(join(packageRoot, '.github', 'skills'), { withFileTypes: true })) {
  if (entry.isDirectory()) {
    const source = join(packageRoot, '.github', 'skills', entry.name, 'SKILL.md');
    try {
      await readFile(source);
    } catch {
      continue;
    }
    await mkdir(join(root, entry.name), { recursive: true });
    await writeFile(join(root, entry.name, 'SKILL.md'), await readFile(source));
    shipped.push({ name: entry.name, path: source });
    continue;
  }
  if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md') {
    const base = entry.name.replace(/\.md$/, '');
    await mkdir(join(root, base), { recursive: true });
    await writeFile(join(root, base, 'SKILL.md'), await readFile(join(packageRoot, '.github', 'skills', entry.name)));
    shipped.push({ name: base, path: join(packageRoot, '.github', 'skills', entry.name) });
  }
}

const ctx = new Context();
await ctx.plugin(SkillRegistry);
await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false });

const dshNames = new Set((await ctx.skills.list({})).map((entry) => entry.name));
const results = [];

const compare = (label, our, theirs, fields) => {
  for (const field of fields) {
    const left = our?.[field];
    const right = theirs?.[field];
    results.push({
      case: label,
      field,
      ok: left === right,
      ours: left,
      dsh: right,
    });
  }
};

for (const [name, raw] of Object.entries(cases)) {
  const path = join(root, name, 'SKILL.md');
  const ours = readSkillEntry(path);

  if (!dshNames.has(name)) {
    // DSH dropped the file. We must drop it too, or we would advertise a skill the
    // native provider cannot see.
    results.push({
      case: name,
      field: 'rejection',
      ok: ours.ok === false,
      ours: ours.ok ? `accepted: ${ours.entry.description}` : `rejected: ${ours.reason}`,
      dsh: 'rejected',
    });
    continue;
  }

  const theirs = await ctx.skills.get(name, {});
  if (!ours.ok) {
    results.push({ case: name, field: 'rejection', ok: false, ours: `rejected: ${ours.reason}`, dsh: 'accepted' });
    continue;
  }

  results.push({ case: name, field: 'accepted-by-both', ok: true });
  compare(name, { description: ours.entry.description, whenToUse: ours.entry.whenToUse, content: ours.entry.body }, theirs, ['description', 'whenToUse', 'content']);
  results.push({
    case: name,
    field: 'invocation',
    ok: JSON.stringify(ours.entry.invocation) === JSON.stringify(theirs.invocation),
    ours: JSON.stringify(ours.entry.invocation),
    dsh: JSON.stringify(theirs.invocation),
  });
  const dshHarness = theirs.metadata?.harness;
  if (dshHarness !== undefined) {
    const mismatched = Object.entries(dshHarness)
      .filter(([key, value]) => JSON.stringify(ours.entry.harness[key]) !== JSON.stringify(value))
      .map(([key, value]) => `${key}: ours=${JSON.stringify(ours.entry.harness[key])} dsh=${JSON.stringify(value)}`);
    results.push({
      case: name,
      field: 'metadata.harness',
      ok: mismatched.length === 0,
      ours: JSON.stringify(ours.entry.harness),
      dsh: JSON.stringify(dshHarness),
      detail: mismatched.join('; '),
    });
  } else {
    results.push({
      case: name,
      field: 'metadata.harness',
      ok: true,
      ours: JSON.stringify(ours.entry.harness),
      dsh: 'absent (our defaults are ours to own)',
    });
  }
}

for (const entry of shipped) {
  const theirs = await ctx.skills.get(entry.name, {});
  const ours = readSkillEntry(entry.path);
  if (!ours.ok) {
    results.push({ case: `shipped:${entry.name}`, field: 'parsed', ok: false, ours: ours.reason, dsh: 'present' });
    continue;
  }
  if (theirs === undefined) {
    results.push({ case: `shipped:${entry.name}`, field: 'visible-to-dsh', ok: false, ours: 'parsed', dsh: 'missing' });
    continue;
  }
  compare(`shipped:${entry.name}`, { description: ours.entry.description, whenToUse: ours.entry.whenToUse, content: ours.entry.body }, theirs, ['description', 'whenToUse', 'content']);
  results.push({
    case: `shipped:${entry.name}`,
    field: 'invocation',
    ok: JSON.stringify(ours.entry.invocation) === JSON.stringify(theirs.invocation),
    ours: JSON.stringify(ours.entry.invocation),
    dsh: JSON.stringify(theirs.invocation),
  });
}

await ctx.fiber.dispose();
await rm(home, { recursive: true, force: true });

const failed = results.filter((entry) => !entry.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  cases: Object.keys(cases).length + shipped.length,
  checks: results.length,
  failed: failed.length,
  divergences: failed.map((entry) => `${entry.case}.${entry.field}`),
  detail: failed.map(({ case: c, field, ours, dsh, detail }) => ({ case: c, field, ours, dsh, detail })),
}, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
