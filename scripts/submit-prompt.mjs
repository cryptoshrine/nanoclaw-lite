#!/usr/bin/env node
/**
 * Submit a prompt to Ball-AI and wait for it to complete.
 * Headless — no recording, just login + submit + wait + screenshot.
 *
 * Usage: node scripts/submit-prompt.mjs "Your query here" [--wait 1800]
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const BALL_AI_DIR = resolve(PROJECT_ROOT, 'groups', 'main', 'BALL-AI-2');
const URL = 'https://app.ball-ai.xyz';

// Parse args
const args = process.argv.slice(2);
let query = '';
let maxWaitSec = 1800; // 30 min default

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--wait') { maxWaitSec = parseInt(args[++i], 10); }
  else if (!query && !args[i].startsWith('-')) { query = args[i]; }
}

if (!query) {
  console.error('Usage: node scripts/submit-prompt.mjs "Your query"');
  process.exit(1);
}

// Load creds from Ball-AI .env
function loadCredentials() {
  const envPath = resolve(BALL_AI_DIR, '.env');
  if (!existsSync(envPath)) { console.error('.env not found'); process.exit(1); }
  const content = readFileSync(envPath, 'utf-8');
  const email = content.match(/^TEST_USER_EMAIL=(.+)$/m)?.[1]?.trim();
  const password = content.match(/^TEST_USER_PASSWORD=(.+)$/m)?.[1]?.trim();
  if (!email || !password) { console.error('Creds not found in .env'); process.exit(1); }
  return { email, password };
}

async function main() {
  const creds = loadCredentials();
  const outputDir = resolve(PROJECT_ROOT, 'output', 'screenshots');
  mkdirSync(outputDir, { recursive: true });

  console.log(`Query: "${query}"`);
  console.log(`Max wait: ${maxWaitSec}s`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    // Login
    console.log('Logging in...');
    await page.goto(`${URL}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.locator('input[type="email"]').fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(3000);
    console.log(`Logged in, at: ${page.url()}`);

    // Navigate to chat
    console.log('Navigating to chat...');
    await page.goto(`${URL}/chat`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // New chat if available
    const newChatBtn = page.locator('button:has-text("New Chat"), button:has-text("New chat"), a:has-text("New Chat")');
    if (await newChatBtn.count() > 0) {
      await newChatBtn.first().click();
      await page.waitForTimeout(1000);
    }

    // Type and send
    console.log('Typing query...');
    const chatInput = page.locator('textarea[placeholder*="football"], textarea[placeholder*="Ask"], input[placeholder*="football"], input[placeholder*="Ask"]');
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
    await chatInput.click();
    await chatInput.fill(query);
    await page.waitForTimeout(500);

    const sendBtn = page.locator('button[type="submit"], button:has-text("Send")');
    if (await sendBtn.count() > 0 && await sendBtn.first().isEnabled()) {
      await sendBtn.first().click();
    } else {
      await page.keyboard.press('Enter');
    }
    console.log('Prompt sent!');

    // Wait for completion
    const startWait = Date.now();
    const maxWait = maxWaitSec * 1000;

    try {
      await page.locator('button:has-text("Stop")').waitFor({ state: 'visible', timeout: 15000 });
      console.log('Processing started (Stop button visible)');
    } catch {
      console.log('Stop button not detected, continuing...');
    }

    let completed = false;
    while (Date.now() - startWait < maxWait) {
      await page.waitForTimeout(5000);
      const elapsed = Math.round((Date.now() - startWait) / 1000);

      const stopBtn = await page.locator('button:has-text("Stop")').count();
      if (stopBtn === 0 && elapsed > 15) {
        const textarea = page.locator('textarea[placeholder*="football"], textarea[placeholder*="Ask"]');
        const isDisabled = await textarea.isDisabled().catch(() => true);
        if (!isDisabled) {
          console.log(`Response complete (${elapsed}s)`);
          completed = true;
          break;
        }
      }

      const downloadBtn = await page.locator('button:has-text("Download"), a:has-text("Download")').count();
      if (downloadBtn > 0) {
        console.log(`Download button appeared (${elapsed}s)`);
        completed = true;
        break;
      }

      if (elapsed % 30 === 0) {
        console.log(`Still waiting... (${elapsed}s, processing=${stopBtn > 0})`);
      }
    }

    if (!completed) {
      console.log('Timed out waiting for response');
    }

    // Take screenshot
    await page.waitForTimeout(3000);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const screenshotPath = resolve(outputDir, `ballai_${ts}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);
    console.log('DONE');

  } catch (err) {
    console.error('Error:', err.message);
    const errPath = resolve(outputDir, 'ballai_error.png');
    await page.screenshot({ path: errPath }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
