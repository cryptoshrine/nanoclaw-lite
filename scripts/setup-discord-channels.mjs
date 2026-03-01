#!/usr/bin/env node
/**
 * Discord Channel Setup Script
 *
 * Creates the full Ball-AI Ops channel architecture:
 *   - 5 categories
 *   - 11 new text channels
 *   - Moves existing 6 channels into Content Pipeline category
 *   - Outputs env vars to append to .env
 *
 * Prerequisites: Klaw bot must have "Manage Channels" permission.
 *
 * Usage: node scripts/setup-discord-channels.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');

// Load token and server ID from .env
function loadEnv() {
  const content = readFileSync(ENV_PATH, 'utf-8');
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

const env = loadEnv();
const TOKEN = env.DISCORD_KLAW_TOKEN;
const SERVER = env.DISCORD_SERVER_ID;

if (!TOKEN || !SERVER) {
  console.error('Missing DISCORD_KLAW_TOKEN or DISCORD_SERVER_ID in .env');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const headers = {
  Authorization: `Bot ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Discord API ${method} ${path}: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function createCategory(name, position) {
  const ch = await api('POST', `/guilds/${SERVER}/channels`, {
    name,
    type: 4, // GUILD_CATEGORY
    position,
  });
  console.log(`  Category: ${name} -> ${ch.id}`);
  return ch.id;
}

async function createTextChannel(name, parentId, topic) {
  const body = { name, type: 0, parent_id: parentId };
  if (topic) body.topic = topic;
  const ch = await api('POST', `/guilds/${SERVER}/channels`, body);
  console.log(`  Channel: #${name} -> ${ch.id}`);
  return ch.id;
}

async function moveChannel(channelId, parentId) {
  await api('PATCH', `/channels/${channelId}`, { parent_id: parentId });
  console.log(`  Moved channel ${channelId} to category ${parentId}`);
}

async function main() {
  console.log('Ball-AI Ops — Discord Channel Setup\n');

  // Existing channel IDs from .env
  const existingChannels = {
    scoutAlerts: env.DISCORD_CHANNEL_SCOUT_ALERTS,
    researchDesk: env.DISCORD_CHANNEL_RESEARCH_DESK,
    contentDrafts: env.DISCORD_CHANNEL_CONTENT_DRAFTS,
    approvedQueue: env.DISCORD_CHANNEL_APPROVED_QUEUE,
    posted: env.DISCORD_CHANNEL_POSTED,
    pipelineLogs: env.DISCORD_CHANNEL_PIPELINE_LOGS,
  };

  // Step 1: Create categories
  console.log('Creating categories...');
  const catContentPipeline = await createCategory('Content Pipeline', 0);
  const catProjects = await createCategory('Projects', 1);
  const catAgentLines = await createCategory('Agent Lines', 2);
  const catIntelligence = await createCategory('Intelligence', 3);
  const catOperations = await createCategory('Operations', 4);

  // Step 2: Move existing channels into Content Pipeline category
  console.log('\nMoving existing channels to Content Pipeline...');
  for (const [name, id] of Object.entries(existingChannels)) {
    if (id) {
      try {
        await moveChannel(id, catContentPipeline);
      } catch (err) {
        console.warn(`  Warning: Could not move ${name} (${id}): ${err.message}`);
      }
    }
  }

  // Step 3: Create new Project channels
  console.log('\nCreating Project channels...');
  const ballAiDev = await createTextChannel('ball-ai-dev', catProjects, 'Ball-AI development: tasks, PRs, deploys, test results');
  const nanoclavDev = await createTextChannel('nanoclaw-dev', catProjects, 'NanoClaw agent system changes and updates');
  const remotionPipeline = await createTextChannel('remotion-pipeline', catProjects, 'Remotion video rendering status and outputs');
  const bettingSignals = await createTextChannel('betting-signals', catProjects, 'Value bets, scraper output, daily picks');

  // Step 4: Create Agent Line channels
  console.log('\nCreating Agent Line channels...');
  const devAgent = await createTextChannel('dev-agent', catAgentLines, 'Direct line to Ball-AI Dev specialist');
  const researchAgent = await createTextChannel('research-agent', catAgentLines, 'Direct line to Research specialist');
  const copywriterAgent = await createTextChannel('copywriter-agent', catAgentLines, 'Direct line to Copywriter specialist');

  // Step 5: Create Intelligence channels
  console.log('\nCreating Intelligence channels...');
  const dailyDigest = await createTextChannel('daily-digest', catIntelligence, 'Auto-generated daily summary of all agent activity');
  const xMetrics = await createTextChannel('x-metrics', catIntelligence, 'Follower growth, engagement stats, weekly reports');
  const competitorWatch = await createTextChannel('competitor-watch', catIntelligence, 'What other football analytics accounts are doing');

  // Step 6: Create Operations channels
  console.log('\nCreating Operations channels...');
  const general = await createTextChannel('general-ops', catOperations, 'Human chat, strategy discussions');
  const missionControl = await createTextChannel('mission-control', catOperations, 'System status, agent health, task overview');

  // Step 7: Output env vars
  const envBlock = `
# Discord Extended Channels (added by setup-discord-channels.mjs)
# Project Channels
DISCORD_CHANNEL_BALL_AI_DEV=${ballAiDev}
DISCORD_CHANNEL_NANOCLAW_DEV=${nanoclavDev}
DISCORD_CHANNEL_REMOTION_PIPELINE=${remotionPipeline}
DISCORD_CHANNEL_BETTING_SIGNALS=${bettingSignals}
# Agent Lines
DISCORD_CHANNEL_DEV_AGENT=${devAgent}
DISCORD_CHANNEL_RESEARCH_AGENT=${researchAgent}
DISCORD_CHANNEL_COPYWRITER_AGENT=${copywriterAgent}
# Intelligence
DISCORD_CHANNEL_DAILY_DIGEST=${dailyDigest}
DISCORD_CHANNEL_X_METRICS=${xMetrics}
DISCORD_CHANNEL_COMPETITOR_WATCH=${competitorWatch}
# Operations
DISCORD_CHANNEL_GENERAL=${general}
DISCORD_CHANNEL_MISSION_CONTROL=${missionControl}`;

  console.log('\n=== ENV VARS ===');
  console.log(envBlock);

  // Append to .env
  const currentEnv = readFileSync(ENV_PATH, 'utf-8');
  if (!currentEnv.includes('DISCORD_CHANNEL_BALL_AI_DEV')) {
    writeFileSync(ENV_PATH, currentEnv.trimEnd() + '\n' + envBlock + '\n');
    console.log('\n✅ Appended to .env');
  } else {
    console.log('\n⚠️ Extended channel vars already exist in .env — not appending');
  }

  console.log('\n✅ All channels created. Restart NanoClaw to pick up the new config.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
