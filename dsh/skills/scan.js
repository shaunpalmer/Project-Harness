/**
 * Bounded, dependency-free workspace scanning.
 *
 * Every read in this module is capped: directory walks stop at `maxEntries`,
 * file reads stop at `maxBytes`, and generated/vendor trees are never entered.
 * DSH skill discovery runs on every catalogue read, so an unbounded walk would
 * make the model-facing catalogue the slowest thing in the session.
 *
 * @module dsh/skills/scan
 */

import fs from 'node:fs';
import path from 'node:path';

/** Directories that never contain authored evidence for skill routing. */
export const DEFAULT_SKIP_DIRECTORIES = [
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'vendor',
  'build',
  'dist',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.terraform',
];

export const DEFAULT_MAX_ENTRIES = 2000;
export const DEFAULT_MAX_BYTES = 262144;

/**
 * Answer whether a resolved path stays inside a resolved parent.
 *
 * @param {string} parent Absolute parent directory.
 * @param {string} candidate Absolute candidate path.
 * @returns {boolean} Whether `candidate` is `parent` or below it.
 */
export function isInside(parent, candidate) {
  const from = path.resolve(parent);
  const to = path.resolve(candidate);
  return to === from || to.startsWith(`${from}${path.sep}`);
}

/**
 * Read a UTF-8 text file, refusing anything above the byte cap.
 *
 * @param {string} filePath Absolute file path.
 * @param {number} [maxBytes] Maximum accepted size.
 * @returns {string | undefined} File content, or undefined when missing or oversized.
 */
export function readFileBounded(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > maxBytes) return undefined;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Walk a directory tree breadth-first within an entry budget.
 *
 * @param {string} root Absolute directory to walk.
 * @param {{ maxEntries?: number, maxDepth?: number, skipDirectories?: string[] }} [options] Walk limits.
 * @returns {{ directories: string[], files: string[], truncated: boolean }} Discovered paths, relative to `root`, sorted.
 */
export function walkBounded(root, options = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDepth = options.maxDepth ?? 6;
  const skip = new Set(options.skipDirectories ?? DEFAULT_SKIP_DIRECTORIES);

  const directories = [];
  const files = [];
  let inspected = 0;
  let truncated = false;

  const pending = [{ directory: path.resolve(root), depth: 0 }];
  while (pending.length > 0) {
    const { directory, depth } = pending.shift();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      inspected += 1;
      if (inspected > maxEntries) {
        truncated = true;
        break;
      }

      const absolute = path.join(directory, entry.name);
      const relative = path.relative(path.resolve(root), absolute).split(path.sep).join('/');

      if (entry.isDirectory()) {
        directories.push(relative);
        if (depth + 1 < maxDepth) pending.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      if (entry.isFile()) files.push(relative);
    }

    if (truncated) break;
  }

  directories.sort();
  files.sort();
  return { directories, files, truncated };
}

/**
 * Answer whether any file below `root` carries an extension.
 *
 * @param {string} root Absolute directory to inspect.
 * @param {string} extension Extension including the dot, for example `.py`.
 * @param {{ maxEntries?: number }} [options] Walk limit.
 * @returns {boolean} Whether a matching file exists.
 */
export function containsExtension(root, extension, options = {}) {
  if (!fs.existsSync(root)) return false;
  const { files } = walkBounded(root, options);
  return files.some((file) => file.endsWith(extension));
}

/**
 * List the immediate child names of a directory without following errors.
 *
 * @param {string} directory Absolute directory.
 * @returns {string[]} Sorted child names, or an empty array when unreadable.
 */
export function listChildren(directory) {
  try {
    return fs.readdirSync(directory).sort();
  } catch {
    return [];
  }
}

/**
 * Answer whether one immediate child exists and is a directory.
 *
 * @param {string} root Absolute parent directory.
 * @param {string} name Child name.
 * @returns {boolean} Whether the child directory exists.
 */
export function hasDirectory(root, name) {
  try {
    return fs.statSync(path.join(root, name)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Answer whether one immediate child exists as a file.
 *
 * @param {string} root Absolute parent directory.
 * @param {string} name Child name.
 * @returns {boolean} Whether the child file exists.
 */
export function hasFile(root, name) {
  try {
    return fs.statSync(path.join(root, name)).isFile();
  } catch {
    return false;
  }
}

/**
 * Collect file names below a directory matching a predicate.
 *
 * @param {string} root Absolute directory.
 * @param {(relativePath: string) => boolean} predicate Matcher over the relative path.
 * @param {{ maxEntries?: number, maxDepth?: number }} [options] Walk limits.
 * @returns {string[]} Matching relative paths.
 */
export function findFiles(root, predicate, options = {}) {
  if (!fs.existsSync(root)) return [];
  return walkBounded(root, options).files.filter(predicate);
}

/**
 * Read a UTF-8 file's content at a path known to be inside `root`.
 *
 * @param {string} root Absolute directory the read must stay inside.
 * @param {string} relativePath Path relative to `root`.
 * @returns {string | undefined} Content, or undefined when outside the root or unreadable.
 */
export function readInside(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (!isInside(root, absolute)) return undefined;
  return readFileBounded(absolute);
}
