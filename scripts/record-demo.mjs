#!/usr/bin/env node
/**
 * Ball-AI Demo Recorder
 *
 * Records a video of Ball-AI's chat UI processing a query.
 * Uses Playwright's built-in video recording with patched bitrate for crisp output.
 *
 * Usage:
 *   node scripts/record-demo.mjs "Generate an xG timeline for Arsenal vs Tottenham"
 *   node scripts/record-demo.mjs --query "Show me a shot map for Liverpool" --output demo.mp4
 *
 * Options:
 *   --query, -q     The query to type into Ball-AI chat (required, or pass as first arg)
 *   --output, -o    Output MP4 file path (default: output/demos/demo_<timestamp>.mp4)
 *   --url           Ball-AI frontend URL (default: http://localhost:5173)
 *   --no-login      Skip login step (if already authenticated)
 *   --wait-viz      Max seconds to wait for visualization (default: 90)
 *   --pause-end     Seconds to pause on final result (default: 5)
 *   --type-delay    Milliseconds between keystrokes (default: 40)
 *
 * Prerequisites:
 *   - Ball-AI backend running on port 8123
 *   - Ball-AI frontend running on port 5173
 *   - ffmpeg in PATH or at known Windows location
 */

import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const BALL_AI_DIR = resolve(PROJECT_ROOT, 'groups', 'main', 'BALL-AI-2');

// ── Parse Args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    query: '',
    output: '',
    url: 'http://localhost:5173',
    login: true,
    waitViz: 90,
    pauseEnd: 5,
    typeDelay: 40,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--query' || arg === '-q') { opts.query = args[++i]; }
    else if (arg === '--output' || arg === '-o') { opts.output = args[++i]; }
    else if (arg === '--url') { opts.url = args[++i]; }
    else if (arg === '--no-login') { opts.login = false; }
    else if (arg === '--wait-viz') { opts.waitViz = parseInt(args[++i], 10); }
    else if (arg === '--pause-end') { opts.pauseEnd = parseInt(args[++i], 10); }
    else if (arg === '--type-delay') { opts.typeDelay = parseInt(args[++i], 10); }
    else if (!opts.query && !arg.startsWith('-')) { opts.query = arg; }
  }

  if (!opts.query) {
    console.error('Usage: node scripts/record-demo.mjs "Your Ball-AI query here"');
    process.exit(1);
  }

  if (!opts.output) {
    const demoDir = resolve(PROJECT_ROOT, 'output', 'demos');
    mkdirSync(demoDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    opts.output = resolve(demoDir, `demo_${ts}.mp4`);
  }

  return opts;
}

// ── Find ffmpeg ─────────────────────────────────────────────────────────────

function findFfmpeg() {
  const candidates = [
    'ffmpeg',
    'C:\\Users\\USER\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
  ];

  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" -version`, { stdio: 'pipe' });
      return candidate;
    } catch { /* try next */ }
  }

  console.error('ffmpeg not found. Install with: winget install -e --id Gyan.FFmpeg');
  process.exit(1);
}

// ── Load Ball-AI credentials ────────────────────────────────────────────────

function loadCredentials() {
  const envPath = resolve(BALL_AI_DIR, '.env');
  if (!existsSync(envPath)) {
    console.error(`Ball-AI .env not found at: ${envPath}`);
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf-8');
  const email = content.match(/^TEST_USER_EMAIL=(.+)$/m)?.[1]?.trim();
  const password = content.match(/^TEST_USER_PASSWORD=(.+)$/m)?.[1]?.trim();

  if (!email || !password) {
    console.error('TEST_USER_EMAIL or TEST_USER_PASSWORD not found in Ball-AI .env');
    process.exit(1);
  }

  return { email, password };
}

// (Bitrate patching is done inline in record() below)

// ── Main Recording Flow ─────────────────────────────────────────────────────

async function record(opts) {
  const ffmpeg = findFfmpeg();
  const creds = opts.login ? loadCredentials() : null;

  console.log('\n🎬 Ball-AI Demo Recorder');
  console.log(`Query: "${opts.query}"`);
  console.log(`Output: ${opts.output}`);
  console.log(`Frontend: ${opts.url}\n`);

  // Patch bitrate for quality
  try {
    const recorderPath = resolve(
      PROJECT_ROOT, 'node_modules', 'playwright-core', 'lib', 'server', 'videoRecorder.js',
    );
    if (existsSync(recorderPath)) {
      let content = readFileSync(recorderPath, 'utf-8');
      if (content.includes('-b:v 1M')) {
        content = content.replace('-b:v 1M', '-b:v 8M');
        writeFileSync(recorderPath, content);
        console.log('✓ Patched Playwright video bitrate to 8Mbps');
      }
    }
  } catch (err) {
    console.warn('Could not patch bitrate:', err.message);
  }

  // Create temp dir for WebM recording
  const tempDir = resolve(PROJECT_ROOT, 'output', 'demos', '.tmp');
  mkdirSync(tempDir, { recursive: true });

  // Launch browser with video recording
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: tempDir,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Login ──
    if (opts.login && creds) {
      console.log('Logging in...');
      await page.goto(`${opts.url}/login`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      // Fill email
      const emailInput = page.locator('input[type="email"]');
      await emailInput.click();
      await emailInput.fill(creds.email);

      // Fill password
      const passwordInput = page.locator('input[type="password"]');
      await passwordInput.click();
      await passwordInput.fill(creds.password);

      // Click the submit Sign In button (inside the form, not the tab selector)
      const signInBtn = page.locator('form button[type="submit"]');
      await signInBtn.click();
      await page.waitForTimeout(3000);

      // Verify we landed on a page (chat or dashboard)
      const url = page.url();
      console.log(`  Logged in, now at: ${url}`);
    }

    // ── Step 2: Navigate to chat ──
    console.log('Navigating to chat...');
    await page.goto(`${opts.url}/chat`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Start a new chat if there's a "New Chat" button
    const newChatBtn = page.locator('button:has-text("New Chat"), button:has-text("New chat"), a:has-text("New Chat")');
    if (await newChatBtn.count() > 0) {
      await newChatBtn.first().click();
      await page.waitForTimeout(1000);
    }

    // ── Step 3: Type the query character by character ──
    console.log(`Typing query: "${opts.query}"`);
    const chatInput = page.locator('textarea[placeholder*="football"], textarea[placeholder*="Ask"], input[placeholder*="football"], input[placeholder*="Ask"]');
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });
    await chatInput.click();

    // Type character by character for the recording effect
    await page.keyboard.type(opts.query, { delay: opts.typeDelay });
    await page.waitForTimeout(500);

    // ── Step 4: Send the message ──
    console.log('Sending message...');
    // Try clicking the send button, or press Enter
    const sendBtn = page.locator('button[type="submit"], button:has-text("Send")');
    if (await sendBtn.count() > 0 && await sendBtn.first().isEnabled()) {
      await sendBtn.first().click();
    } else {
      await page.keyboard.press('Enter');
    }

    // ── Step 5: Wait for response + visualization ──
    console.log(`Waiting for response (up to ${opts.waitViz}s)...`);

    const startWait = Date.now();
    const maxWait = opts.waitViz * 1000;
    let responseComplete = false;

    // First, wait for the "Stop" button to appear (indicates processing started)
    try {
      await page.locator('button:has-text("Stop")').waitFor({ state: 'visible', timeout: 15000 });
      console.log('  Processing started (Stop button visible)');
    } catch {
      console.log('  Stop button not detected, continuing...');
    }

    // Now wait for processing to finish: Stop button disappears OR textarea becomes enabled
    while (Date.now() - startWait < maxWait) {
      await page.waitForTimeout(2000);
      const elapsed = Math.round((Date.now() - startWait) / 1000);

      // Check if the Stop button is gone (processing complete)
      const stopBtn = await page.locator('button:has-text("Stop")').count();
      if (stopBtn === 0 && elapsed > 10) {
        // Double-check: textarea should be enabled
        const textarea = page.locator('textarea[placeholder*="football"], textarea[placeholder*="Ask"]');
        const isDisabled = await textarea.isDisabled().catch(() => true);
        if (!isDisabled) {
          console.log(`  Response complete (${elapsed}s)`);
          responseComplete = true;
          break;
        }
      }

      // Check for visualization elements
      const vizCount = await page.locator('svg, img[src*="blob:"], canvas, [class*="artifact"] img').count();
      if (vizCount > 0 && stopBtn === 0) {
        console.log(`  Visualization detected (${vizCount} elements, ${elapsed}s)`);
        responseComplete = true;
        break;
      }

      // Check for Download button
      const downloadBtn = await page.locator('button:has-text("Download"), a:has-text("Download")').count();
      if (downloadBtn > 0) {
        console.log(`  Download button appeared (${elapsed}s)`);
        responseComplete = true;
        break;
      }

      if (elapsed % 10 === 0) {
        console.log(`  Still waiting... (${elapsed}s, stop_btn=${stopBtn > 0})`);
      }
    }

    if (!responseComplete) {
      console.log('  Timed out waiting for response');
    }

    // ── Step 6: Pause on result ──
    console.log(`Pausing ${opts.pauseEnd}s on final result...`);
    await page.waitForTimeout(opts.pauseEnd * 1000);

  } catch (err) {
    console.error('Recording error:', err.message);
  }

  // ── Step 7: Close and save ──
  console.log('Closing browser and saving video...');
  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  if (!videoPath || !existsSync(videoPath)) {
    console.error('Video file not found after recording');
    process.exit(1);
  }

  console.log(`WebM saved: ${videoPath}`);

  // ── Step 8: Convert WebM to MP4 ──
  console.log('Converting to MP4...');
  const outputDir = dirname(opts.output);
  mkdirSync(outputDir, { recursive: true });

  const ffmpegCmd = `"${ffmpeg}" -y -i "${videoPath}" -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -an "${opts.output}"`;
  try {
    execSync(ffmpegCmd, { stdio: 'pipe' });
    console.log(`✅ MP4 saved: ${opts.output}`);

    // Clean up WebM
    try { unlinkSync(videoPath); } catch { /* ignore */ }

    // Print file size
    const stats = statSync(opts.output);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`   Size: ${sizeMB}MB`);
    console.log(`   Ready to upload to X!`);
  } catch (err) {
    console.error('ffmpeg conversion failed:', err.message);
    console.log(`WebM file preserved at: ${videoPath}`);
    process.exit(1);
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

const opts = parseArgs();
record(opts).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
