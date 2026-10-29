// scripts/harness-init.js
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredDirs = [
  'src',
  '00-PLANNING',
  '.github/skills',
];

const requiredFiles = [
  'PROJECT-INTAKE.md',
  'AGENTS.md',
  'AI-NOTES.md',
  'HARNESS-LOOP.md',
];

/**
 * The skill library is only useful if the agent can load it, and the bindings are
 * only true if something checks them. Boot verifies them, so a file that is not a
 * skill (or a binding that points at nothing) fails here instead of being found
 * months later in a catalogue nobody read.
 *
 * Skipped when this tree carries no library, so a minimal project fixture still
 * initialises; the check runs wherever `dsh/skills/library.js` exists.
 * @returns {boolean} whether the library verified.
 */
function verifySkillLibrary() {
  const verify = path.join(PROJECT_ROOT, 'scripts', 'skills-verify.js');
  const library = path.join(PROJECT_ROOT, 'dsh', 'skills', 'library.js');
  if (!fs.existsSync(verify) || !fs.existsSync(library)) {
    console.log('ℹ️  No skill library in this tree - skipping skill verification.');
    return true;
  }
  console.log('\n🧠 Verifying the skill library...');
  const result = spawnSync(process.execPath, [verify], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) {
    if (output !== '') console.log(output);
    return true;
  }
  if (output !== '') console.error(output);
  console.error('\n⛔ Skill verification failed: a file under .github/skills cannot be loaded, or a binding points at nothing.');
  console.error('   Declare an intentional non-skill in dsh/skills/unindexed-allowlist.json, or remove it.');
  return false;
}

function ensureDirectory(dir) {
  const fullPath = path.join(PROJECT_ROOT, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
}

function checkRequiredFiles() {
  console.log('\n🔍 Checking required files...');
  let missing = [];

  requiredFiles.forEach(file => {
    const fullPath = path.join(PROJECT_ROOT, file);
    if (!fs.existsSync(fullPath)) {
      missing.push(file);
      console.log(`   ❌ Missing: ${file}`);
    } else {
      console.log(`   ✅ Found: ${file}`);
    }
  });

  if (missing.length > 0) {
    console.log('\n⚠️  Some required files are missing. Run setup again after adding them.');
  } else {
    console.log('\n✅ All core files present.');
  }
  return missing.length === 0;
}

function main() {
  console.log('🚀 Initializing AI Project Harness...\n');

  // Validate before making changes so incomplete copies fail without a success message.
  if (!checkRequiredFiles()) {
    process.exitCode = 1;
    return;
  }

  // A skill nobody can load is not a skill. Verify before anything is written.
  if (!verifySkillLibrary()) {
    process.exitCode = 1;
    return;
  }

  // Create required directories
  console.log('📁 Ensuring directory structure...');
  requiredDirs.forEach(ensureDirectory);

  // Create lock file by default (forces planning first)
  const lockFile = path.join(PROJECT_ROOT, '.planning-lock');
  if (!fs.existsSync(lockFile)) {
    fs.writeFileSync(lockFile, 'LOCKED - Complete planning before coding\n');
    console.log('🔒 Initial lock applied (planning required)');
  }

  console.log('\n🎉 Harness initialization complete!');
  console.log('\nNext steps:');
  console.log('   1. Fill out PROJECT-INTAKE.md');
  console.log('   2. Run: node scripts/lock-project.js status');
  console.log('   3. Start working with your AI agent');
}

main();
