import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package preview excludes nested package snapshots', () => {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const preview = JSON.parse(raw.trim())[0];
  assert.ok(preview, 'npm pack should return a package preview');
  assert.equal(preview.version, version);
  assert.equal(preview.files.some(({ path }) => path.endsWith('.tgz')), false);
});
