import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('DSH bundle manifest points to the Project Harness Cordis patch', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(packageJson.main, 'dsh/index.js');
  assert.match(fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8'), /name: project-harness\s*$/m);
});

test('DSH adapter is read-only and exposes the compact resume tool', () => {
  const adapter = fs.readFileSync(path.join(ROOT, 'dsh', 'index.js'), 'utf8');
  assert.match(adapter, /inject = \['tools', 'skills'\]/);
  assert.match(adapter, /project_harness_resume/);
  assert.match(adapter, /project_harness_inventory/);
  assert.match(adapter, /read-only/);
  assert.doesNotMatch(adapter, /execFile|spawn|writeFile|rmSync|git /);
});

test('workspace selection is explicit and rejects the DSH checkout fallback', () => {
  const adapter = fs.readFileSync(path.join(ROOT, 'dsh', 'index.js'), 'utf8');
  assert.match(adapter, /PROJECT_HARNESS_ROOT \?\? ''/);
  assert.match(adapter, /WORKSPACE_NOT_CONFIGURED/);
  assert.match(adapter, /DSH_CHECKOUT_REJECTED/);
  assert.doesNotMatch(adapter, /process\.cwd\(\)/);
});

test('WordPress routing registers native on-demand DSH skills', () => {
  const adapter = fs.readFileSync(path.join(ROOT, 'dsh', 'index.js'), 'utf8');
  assert.match(adapter, /registerProvider/);
  assert.match(adapter, /modelInvocable: true/);
  assert.match(adapter, /resolveSkill/);
});

test('WordPress specialist preset is present and keeps non-coding domains separate', () => {
  const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh', 'specialists', 'wordpress.json'), 'utf8'));
  assert.equal(preset.id, 'wordpress-coding');
  assert.ok(preset.required_skills.includes('.github/skills/wordpress-plugin/SKILL.md'));
  assert.ok(preset.excluded_domains.includes('sales'));
  assert.ok(preset.excluded_domains.includes('seo'));
});

test('Python prospecting specialist preset composes existing pipeline skills', () => {
  const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh', 'specialists', 'python-prospecting.json'), 'utf8'));
  const adapter = fs.readFileSync(path.join(ROOT, 'dsh', 'index.js'), 'utf8');
  assert.equal(preset.id, 'python-prospecting');
  assert.ok(preset.required_skills.includes('.github/skills/scraping-pipeline/SKILL.md'));
  assert.ok(preset.required_skills.includes('.github/skills/testing-plan/SKILL.md'));
  assert.match(adapter, /python-prospecting/);
  assert.match(adapter, /containsFileExtension/);
});
