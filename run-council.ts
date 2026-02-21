// Quick runner script for council session
// Usage: npx tsx run-council.ts "topic here"

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import { runCouncilSession } from './src/council/orchestrator.js';
import { CouncilStore } from './src/council/store.js';

const topic = process.argv[2];
if (!topic) {
  console.error('Usage: npx tsx run-council.ts "topic"');
  process.exit(1);
}

const sessionId = randomUUID();
console.log(`\n⚔️  Council Session: ${sessionId.slice(0, 8)}`);
console.log(`📋 Topic: ${topic}\n`);

async function main() {
  try {
    const session = await runCouncilSession(topic, (event) => {
      if (event.type === 'phase_started') {
        console.log(`\n━━━ Phase: ${event.data?.phase?.toUpperCase()} ━━━`);
      }
      if (event.type === 'admiral_response') {
        const admiral = event.data?.admiralId || 'unknown';
        const preview = event.data?.content?.slice(0, 100) || '';
        console.log(`  ✓ ${admiral}: ${preview}...`);
      }
      if (event.type === 'vote_result') {
        console.log(`\n🗳️  Votes:`, JSON.stringify(event.data?.votes, null, 2));
        console.log(`🏆 Winner: ${event.data?.winner}`);
      }
      // Save progress
      if (event.session) {
        CouncilStore.save(event.session);
      }
    });

    CouncilStore.save(session);

    console.log(`\n✅ Session complete: ${session.status}`);
    console.log(`📊 Messages: ${session.messages.length}`);

    if (session.finalPlan) {
      // Save final plan to a readable file
      const planPath = path.join('data', 'council', `plan-${sessionId.slice(0, 8)}.md`);
      fs.writeFileSync(planPath, `# Council Plan: ${topic}\n\n${session.finalPlan}`, 'utf-8');
      console.log(`📝 Plan saved: ${planPath}`);
    }

    if (session.error) {
      console.error(`❌ Error: ${session.error}`);
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
