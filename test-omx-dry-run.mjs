/**
 * OmX Dry Run Test
 * Creates a minimal 2-step workflow and lets the supervisor pick it up.
 * Step 1: A research step that just lists NanoClaw src files
 * Step 2: No gate — just complete
 *
 * Run: node test-omx-dry-run.mjs
 */

import fs from 'fs';
import path from 'path';

// Read the compiled supervisor
const { createOmxWorkflow, listActiveOmxWorkflows } = await import('./dist/omx-supervisor.js');

const workflowMarkdown = `# OmX Dry Run Test

## Step 1: List source files [specialist:research]
List all TypeScript files in the NanoClaw src/ directory.
Report the count and filenames via send_message.
OUTPUT: File listing

## Step 2: Verify health [specialist:research]
Read the NanoClaw package.json and report the project name and version via send_message.
OUTPUT: Project name and version
`;

const teamId = 'team-1775243031605-1p4ogs';
const chatJid = '6475227727@telegram';

try {
  const workflow = createOmxWorkflow({
    workflowContent: workflowMarkdown,
    taskDescription: 'OmX Dry Run — Verify Pipeline',
    groupFolder: 'main',
    chatJid,
    teamId,
    projectPath: 'C:/claw/nanoclaw',
  });

  console.log('Workflow created successfully!');
  console.log('  ID:', workflow.id);
  console.log('  Steps:', workflow.steps.length);
  console.log('  Status:', workflow.status);
  console.log('  Steps detail:');
  for (const step of workflow.steps) {
    console.log(`    Step ${step.number}: ${step.title} [${step.annotations.specialist}] — ${step.status}`);
  }

  // Verify it was saved
  const active = listActiveOmxWorkflows();
  console.log('\nActive workflows:', active.length);
  for (const wf of active) {
    console.log(`  ${wf.id}: ${wf.taskDescription} (${wf.status})`);
  }

  console.log('\nDry run workflow created. The scheduler will pick it up on next tick (within 60s).');
  console.log('Watch for specialist spawns and completion report in Telegram.');
} catch (err) {
  console.error('Failed to create workflow:', err);
  process.exit(1);
}
