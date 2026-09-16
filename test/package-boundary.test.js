import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('package preview excludes nested package snapshots', () => {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const preview = JSON.parse(raw.trim())[0];
  assert.ok(preview, 'npm pack should return a package preview');
  assert.equal(preview.version, '0.4.2');
  assert.equal(preview.files.some(({ path }) => path.endsWith('.tgz')), false);
});
