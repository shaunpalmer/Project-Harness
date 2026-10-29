/**
 * Deterministic routing check for the generated skill index.
 *
 * The index is only useful if a task's own words land on the right line. This is
 * a vocabulary-coverage measure, not a model: it asks whether the trigger text of
 * the intended skill shares the words a person would actually use, and whether it
 * out-rates every other trigger. A description written in the author's jargon
 * fails here, and would be unlikely to be picked by a model either.
 *
 * The model-in-the-loop half of the same question (name / task / goal activation)
 * needs an agent and a key, so it is a separate, opt-in run.
 * @module dsh/skills/activation
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'use', 'used',
  'using', 'you', 'your', 'are', 'was', 'were', 'will', 'would', 'can', 'could',
  'should', 'must', 'have', 'has', 'had', 'not', 'but', 'its', 'it', 'a', 'an', 'of',
  'to', 'in', 'on', 'at', 'by', 'or', 'as', 'is', 'be', 'if', 'so', 'than', 'then',
  'any', 'all', 'more', 'most', 'other', 'they', 'them', 'their', 'there', 'these',
]);

/**
 * Significant words of a text, lowercased and sorted.
 * @param {string} text
 * @returns {string[]}
 */
export function stem(word) {
  let value = word
    .replace(/ies$/u, 'y')
    .replace(/(sses|shes|ches|xes)$/u, (m) => m.slice(0, -2))
    .replace(/(ing|ed)$/u, '');
  if (value !== word.replace(/ies$/u, 'y') && value.length < 3) value = word;
  if (value.length > 4 && value.endsWith('s') && !value.endsWith('ss')) value = value.slice(0, -1);
  return value;
}

export function tokens(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/u)
    .map((word) => word.replace(/^[.]+|[.]+$/gu, ''))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map(stem);
}

/**
 * Rank index entries against one prompt.
 * @param {Array<{name: string, description: string}>} skills
 * @param {string} prompt
 * @returns {Array<{name: string, score: number, matched: string[]}>}
 */
export function rankSkills(skills, prompt) {
  const query = [...new Set(tokens(prompt))];
  return skills
    .map((skill) => {
      const haystack = tokens(`${skill.name} ${skill.description}`);
      const set = new Set(haystack);
      const matched = query.filter((word) => set.has(word));
      // Name matches are worth more than description matches: the name is the
      // agent's handle on the skill, and it is what a task usually repeats.
      const named = query.includes(String(skill.name).toLowerCase()) ? 2 : 0;
      const score = (matched.length + named) / Math.sqrt(Math.max(haystack.length, 1));
      return { name: skill.name, score: Number(score.toFixed(4)), matched };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
