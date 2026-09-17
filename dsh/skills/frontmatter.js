/**
 * DSH-compatible skill frontmatter reader.
 *
 * DeepSeek Harness parses skill frontmatter with the `yaml` package and reads
 * exactly these keys (`packages/skill/skill-filesystem/src/index.ts`):
 *
 *   name, description, whenToUse, disable-model-invocation, user-invocable,
 *   metadata
 *
 * This module implements the subset of YAML that Project Harness skill files
 * are allowed to use, with no runtime dependency, so the same files can be
 * consumed by DSH's native filesystem provider unchanged. The supported subset
 * is deliberately small and is enforced by `scripts/skills-verify.js`:
 *
 *   - one document, opened and closed by a `---` line;
 *   - `key: scalar`, `key: [a, b]`, `key:` + nested map, `key:` + `- item`;
 *   - plain, single-quoted and double-quoted scalars;
 *   - a folded scalar that starts on the line after its key and continues on
 *     indented lines, joined with spaces.
 *
 * A plain scalar must be complete on its own line or start on the next one.
 * Anchors, aliases, tags, multi-document streams, block scalars (`|`, `>`),
 * flow maps and YAML comments are not supported and are reported as errors
 * rather than silently mis-parsed, so a file outside the subset fails loudly
 * instead of reaching the model with a corrupted description.
 *
 * @module dsh/skills/frontmatter
 */

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Frontmatter keys DSH rejects when they use a legacy spelling. */
const LEGACY_INVOCATION_KEYS = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
]);

const LAYERS = new Set(['core', 'discovery', 'specialist', 'capability', 'reference']);

/**
 * Minimum routing-description length.
 *
 * DSH only requires a non-empty description, but the description is the entire
 * model-facing routing surface, so a stub like "WordPress skill" cannot route
 * anything. Rejecting it at parse time keeps an unroutable skill out of the
 * catalogue instead of spending context on it.
 */
const MIN_DESCRIPTION_LENGTH = 40;

/**
 * Split raw text into a frontmatter block and the remaining body.
 *
 * @param {string} raw File content.
 * @returns {{ data: Record<string, unknown>, body: string } | undefined} Parsed block, or undefined when absent/malformed.
 */
export function parseFrontmatter(raw) {
  if (typeof raw !== 'string') return undefined;

  const lines = raw.split(/\r?\n/u);
  if (lines[0]?.replace(/\r$/u, '') !== '---') return undefined;

  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replace(/\r$/u, '') === '---') {
      closing = index;
      break;
    }
  }
  if (closing < 0) return undefined;

  const block = [];
  for (let index = 1; index < closing; index += 1) {
    block.push(lines[index]);
  }

  const data = parseBlock(block);
  if (data === undefined) return undefined;

  return { data, body: lines.slice(closing + 1).join('\n') };
}

/**
 * Read one Project Harness skill file into DSH's skill contract.
 *
 * Returns a result object rather than throwing so callers can report every
 * problem in the library instead of failing on the first file.
 *
 * @param {string} content Raw Markdown file content.
 * @param {string} [fallbackName] Name derived from the file path, used in messages.
 * @returns {{ ok: true, skill: object } | { ok: false, reason: string }} Parsed skill or a reason it is unusable.
 */
export function readSkillMetadata(content, fallbackName = 'skill') {
  const parsed = parseFrontmatter(content);
  if (parsed === undefined) {
    return { ok: false, reason: `${fallbackName}: missing or malformed YAML frontmatter` };
  }

  const { data, body } = parsed;

  for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(data, legacy)) {
      return { ok: false, reason: `${fallbackName}: frontmatter field "${legacy}" is unsupported; use "${canonical}"` };
    }
  }

  const name = stringField(data, 'name');
  if (name === undefined) return { ok: false, reason: `${fallbackName}: frontmatter requires a non-empty "name"` };
  if (!SKILL_NAME_PATTERN.test(name)) {
    return { ok: false, reason: `${fallbackName}: invalid skill name "${name}" (must be kebab-case)` };
  }

  const description = stringField(data, 'description');
  if (description === undefined) {
    return { ok: false, reason: `${fallbackName}: frontmatter requires a non-empty "description"` };
  }
  if (description.length > 500) {
    return { ok: false, reason: `${fallbackName}: description is ${description.length} characters; DSH renders at most 500` };
  }
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      reason: `${fallbackName}: description is only ${description.length} characters and cannot route the model`,
    };
  }
  if (description.startsWith('SKILL:')) {
    return { ok: false, reason: `${fallbackName}: description must describe routing, not repeat the H1 heading` };
  }

  const whenToUse = stringField(data, 'whenToUse');
  if (data.whenToUse !== undefined && whenToUse === undefined) {
    return { ok: false, reason: `${fallbackName}: "whenToUse" must be a non-empty string when present` };
  }

  let invocation;
  try {
    invocation = readInvocation(data, fallbackName);
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  const harness = readHarnessMetadata(data, fallbackName);
  if (typeof harness === 'string') return { ok: false, reason: harness };

  return {
    ok: true,
    skill: {
      name,
      description,
      ...(whenToUse === undefined ? {} : { whenToUse }),
      invocation,
      harness,
      body: body.replace(/^\s+|\s+$/gu, ''),
    },
  };
}

/**
 * Normalize DSH's two independent invocation controls.
 *
 * DSH defaults an omitted field to `true`; `user-invocable: false` marks a
 * model-only reference skill and `disable-model-invocation: true` marks one
 * reachable only through the human `/name` gesture.
 *
 * @param {Record<string, unknown>} data Frontmatter keys.
 * @param {string} subject Name used in error messages.
 * @returns {{ modelInvocable: boolean, userInvocable: boolean }} Resolved policy.
 */
export function readInvocation(data, subject) {
  const disableModel = booleanField(data, 'disable-model-invocation', subject);
  const userInvocable = booleanField(data, 'user-invocable', subject);
  return {
    modelInvocable: disableModel !== true,
    userInvocable: userInvocable !== false,
  };
}

/**
 * Read `metadata.harness` — Project Harness composition data carried inside
 * DSH's sanctioned metadata passthrough.
 *
 * `topics` are descriptive search terms for `project_harness_find_skills`. They
 * are deliberately distinct from the composition capability keys in
 * `dsh/skills/capabilities.json`, which select whole skills rather than
 * describing one.
 *
 * @param {Record<string, unknown>} data Frontmatter keys.
 * @param {string} subject Name used in error messages.
 * @returns {{ layer: string, topics: string[], tags: string[], stack: string[] } | string} Metadata, or an error message.
 */
function readHarnessMetadata(data, subject) {
  const empty = { layer: 'capability', topics: [], tags: [], stack: [] };
  if (data.metadata === undefined || data.metadata === null) return empty;
  if (!isPlainObject(data.metadata)) {
    return `${subject}: "metadata" must be a mapping`;
  }

  const harness = data.metadata.harness;
  if (harness === undefined || harness === null) return empty;
  if (!isPlainObject(harness)) {
    return `${subject}: "metadata.harness" must be a mapping`;
  }

  // `tier` was the earlier spelling of `layer`; accept it so a skill copied from an
  // older branch, or a project-local override written against it, still parses.
  const declared = harness.layer ?? harness.tier;
  const layer = declared === undefined ? 'capability' : declared;
  if (typeof layer !== 'string' || !LAYERS.has(layer)) {
    return `${subject}: metadata.harness.layer must be one of ${[...LAYERS].join(', ')}`;
  }

  const topics = stringArray(harness.topics, `${subject}: metadata.harness.topics`);
  if (typeof topics === 'string') return topics;

  const tags = stringArray(harness.tags, `${subject}: metadata.harness.tags`);
  if (typeof tags === 'string') return tags;

  const stack = stringArray(harness.stack, `${subject}: metadata.harness.stack`);
  if (typeof stack === 'string') return stack;

  return { layer, topics, tags, stack };
}

function parseBlock(blockLines) {
  const lines = [];
  for (let index = 0; index < blockLines.length; index += 1) {
    const raw = blockLines[index].replace(/\r$/u, '');
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (raw.trimStart().startsWith('\t')) return undefined;
    lines.push({ indent, text: raw.trim(), no: index + 2 });
  }

  try {
    const state = { i: 0 };
    return parseMap(lines, state, lines[0]?.indent ?? 0);
  } catch {
    return undefined;
  }
}

function parseMap(lines, state, indent) {
  const out = {};
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`unexpected indentation on frontmatter line ${line.no}`);
    if (line.text.startsWith('- ')) break;

    const match = /^([A-Za-z0-9_.-]+):(.*)$/u.exec(line.text);
    if (match === null) throw new Error(`unreadable frontmatter line ${line.no}: ${line.text}`);

    const key = match[1];
    const inline = match[2].trim();
    state.i += 1;

    if (inline !== '') {
      out[key] = parseScalar(inline);
      continue;
    }

    const next = lines[state.i];
    if (next === undefined || next.indent <= indent) {
      out[key] = null;
      continue;
    }
    if (next.text.startsWith('- ')) {
      out[key] = parseSequence(lines, state, next.indent);
      continue;
    }
    if (/^([A-Za-z0-9_.-]+):(.*)$/u.test(next.text)) {
      out[key] = parseMap(lines, state, next.indent);
      continue;
    }
    out[key] = parseFolded(lines, state, next.indent);
  }
  return out;
}

function parseSequence(lines, state, indent) {
  const out = [];
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`unexpected indentation on frontmatter line ${line.no}`);
    if (!line.text.startsWith('- ')) break;
    out.push(parseScalar(line.text.slice(2).trim()));
    state.i += 1;
  }
  return out;
}

function parseFolded(lines, state, indent) {
  const parts = [];
  while (state.i < lines.length && lines[state.i].indent >= indent) {
    parts.push(lines[state.i].text);
    state.i += 1;
  }
  return parts.join(' ');
}

function parseScalar(text) {
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return splitInline(inner).map((part) => parseScalar(part.trim()));
  }
  if (text === '{}') return {};
  if (text === '[]') return [];

  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/gu, '$1');
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/gu, "'");
  }

  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/u.test(text)) return Number.parseInt(text, 10);

  return text;
}

/** Split an inline array body on commas that are not inside quotes. */
function splitInline(inner) {
  const parts = [];
  let current = '';
  let quote = '';
  for (const character of inner) {
    if (quote !== '') {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function stringField(data, key) {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function booleanField(data, key, subject) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  throw new Error(`${subject}: frontmatter field "${key}" must be a boolean`);
}

function stringArray(value, subject) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return `${subject} must be a list`;
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return `${subject} must contain non-empty strings`;
    out.push(item.trim());
  }
  return out;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a string is a valid DSH skill name. */
export function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_PATTERN.test(name);
}
