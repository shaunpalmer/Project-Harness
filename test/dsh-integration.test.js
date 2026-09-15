import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('DSH bundle manifest points to the Project Harness Cordis patch', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.match(fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8'), /project-harness\/dsh\/index\.js/);
});

test('DSH adapter is read-only and exposes the compact resume tool', () => {
  const adapter = fs.readFileSync(path.join(ROOT, 'dsh', 'index.js'), 'utf8');
  assert.match(adapter, /project_harness_resume/);
  assert.match(adapter, /read-only/);
  assert.doesNotMatch(adapter, /execFile|spawn|writeFile|rmSync|git /);
});
