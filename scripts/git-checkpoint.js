import { execSync } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function checkpoint() {
    console.log('--- 🚦 GIT CHECKPOINT GATE ---');
    // ⛔ RETIRED 2026-10-29 (J80). This script ran `git add .`, committed with a timestamp
    // message and pushed unconditionally — in a scratch repo it committed `.env`.
    // README.md:166, docs/VERSION-CONTROL.md:61 and docs/LEGACY-CONTROLS.md:5 already call it
    // a legacy experiment; it now enforces that instead of contradicting it.
    console.error('⛔ git-checkpoint.js is retired: it staged everything and pushed unconditionally.');
    console.error('   Use the supported path: npm run vcs -- checkpoint --file <paths>');
    process.exit(1);
    
    // 1. Show the user what's changed
    const status = execSync('git status --short').toString();
    if (!status) {
        console.log('No changes to commit.');
        process.exit(0);
    }
    console.log('Changes pending:\n', status);

    // 2. Draft the Commit Message from AI-NOTES.md
    // We assume the AI has been keeping notes in this file during the session
    const notes = execSync('cat AI-NOTES.md').toString();
    
    console.log('\nSuggested Commit Message based on AI-NOTES.md:\n');
    console.log(notes.slice(-500)); // Show the latest log
    
    // 3. The Human Gate
    rl.question('\nAre you ready to push to GitHub? (y/n): ', (answer) => {
        if (answer.toLowerCase() === 'y') {
            try {
                execSync('git add .');
                execSync(`git commit -m "Feature: ${new Date().toISOString()}"`); // Or prompt for specific msg
                execSync('git push');
                console.log('✅ Changes pushed to remote.');
            } catch (e) {
                console.error('Git operation failed:', e.message);
            }
        } else {
            console.log('🛑 Push aborted. Safe to continue working.');
        }
        rl.close();
    });
}

checkpoint();
