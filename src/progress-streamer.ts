/**
 * ProgressStreamer — polls specialist progress.json files and forwards
 * throttled updates to Telegram.
 *
 * Each specialist writes a progress.json to their IPC directory during execution.
 * This streamer picks up changes and sends updates to the originating chat,
 * editing the same Telegram message to avoid spam.
 *
 * DeerFlow Phase 2: Real-time specialist progress in chat.
 */

import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

/** Minimum interval between progress updates per specialist (ms) */
const THROTTLE_MS = 30_000;

/** How often to poll for progress updates (ms) */
const POLL_MS = 3_000;

interface ProgressEntry {
  groupFolder: string;
  sessionId: string;
  status: 'running' | 'completed' | 'error';
  startedAt: string;
  lastUpdate: string;
  prompt: string;
  currentStep: string | null;
  error: string | null;
}

interface TrackedSpecialist {
  memberId: string;
  name: string;
  chatJid: string;
  lastNotifiedAt: number;
  lastStatus: string;
  lastStep: string | null;
  telegramMessageId: number | null;
}

export interface ProgressStreamerDeps {
  /** Send a progress message and return the Telegram message ID (for editing later) */
  sendProgressMessage: (jid: string, text: string) => Promise<number | null>;
  editMessage: (jid: string, messageId: number, text: string) => Promise<void>;
  getTeammateInfo: (memberId: string) => { name: string; chatJid: string; teamId: string } | null;
}

export class ProgressStreamer {
  private tracked = new Map<string, TrackedSpecialist>();
  private running = false;
  private deps: ProgressStreamerDeps;

  constructor(deps: ProgressStreamerDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
    logger.info('Progress streamer started');
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      await this.checkProgress();
    } catch (err) {
      logger.debug({ err }, 'Progress poll error (non-fatal)');
    }

    setTimeout(() => this.poll(), POLL_MS);
  }

  private async checkProgress(): Promise<void> {
    const teammatesDir = path.join(DATA_DIR, 'ipc', 'teammates');
    if (!fs.existsSync(teammatesDir)) return;

    let memberDirs: string[];
    try {
      memberDirs = fs.readdirSync(teammatesDir).filter((f) => {
        try {
          return fs.statSync(path.join(teammatesDir, f)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      return;
    }

    for (const memberId of memberDirs) {
      const progressPath = path.join(teammatesDir, memberId, 'progress.json');
      if (!fs.existsSync(progressPath)) continue;

      let progress: ProgressEntry;
      try {
        progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
      } catch {
        continue;
      }

      const tracked = this.tracked.get(memberId);
      const now = Date.now();

      // Skip if nothing changed
      if (tracked && tracked.lastStatus === progress.status && tracked.lastStep === progress.currentStep) {
        continue;
      }

      // Get teammate info for chat routing
      const info = this.deps.getTeammateInfo(memberId);
      if (!info) continue;

      // Initialize tracking
      if (!tracked) {
        this.tracked.set(memberId, {
          memberId,
          name: info.name,
          chatJid: info.chatJid,
          lastNotifiedAt: 0,
          lastStatus: '',
          lastStep: null,
          telegramMessageId: null,
        });
      }

      const entry = this.tracked.get(memberId)!;

      // Throttle: skip if too recent (unless it's a terminal state)
      const isTerminal = progress.status === 'completed' || progress.status === 'error';
      if (!isTerminal && now - entry.lastNotifiedAt < THROTTLE_MS) {
        // Update tracking but don't send
        entry.lastStatus = progress.status;
        entry.lastStep = progress.currentStep;
        continue;
      }

      // Build progress message
      const statusIcon = progress.status === 'running' ? '⏳'
        : progress.status === 'completed' ? '✅'
        : '❌';
      const elapsed = Math.round((Date.now() - new Date(progress.startedAt).getTime()) / 1000);
      const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

      let text = `${statusIcon} *${info.name}* (${elapsedStr})`;
      if (progress.currentStep) {
        text += `\n${progress.currentStep}`;
      }
      if (progress.error) {
        text += `\nError: ${progress.error.slice(0, 200)}`;
      }

      try {
        if (entry.telegramMessageId && !isTerminal) {
          // Edit existing message for inline progress
          await this.deps.editMessage(entry.chatJid, entry.telegramMessageId, text);
        } else {
          // Send new message (first update or terminal state)
          const msgId = await this.deps.sendProgressMessage(entry.chatJid, text);
          if (msgId && !isTerminal) {
            entry.telegramMessageId = msgId;
          }
        }
      } catch (err) {
        logger.debug({ memberId, err }, 'Progress message send/edit failed');
      }

      // Update tracking
      entry.lastNotifiedAt = now;
      entry.lastStatus = progress.status;
      entry.lastStep = progress.currentStep;

      // Clean up on terminal state
      if (isTerminal) {
        this.tracked.delete(memberId);
        // Clean up the progress file
        try {
          fs.unlinkSync(progressPath);
        } catch { /* ignore */ }
      }
    }
  }
}
