/**
 * OmX Pattern 3: Mailbox-Based Communication
 *
 * Per-step JSON mailbox files enabling specialist → supervisor progress reporting.
 * Specialists write updates to their mailbox file; the supervisor reads them
 * each tick and forwards new messages to Telegram.
 *
 * Mailbox directory: data/omx-workflows/{workflow-id}/mailbox/
 * Per-step file:     mailbox/{stepNumber}.json  (JSON array of MailboxMessage)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { OMX_WORKFLOWS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  created_at: string;
  read_at?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mailboxDir(workflowId: string): string {
  return path.join(OMX_WORKFLOWS_DIR, workflowId, 'mailbox');
}

function mailboxPath(workflowId: string, stepNumber: number): string {
  return path.join(mailboxDir(workflowId), `${stepNumber}.json`);
}

function readMailboxFile(filePath: string): MailboxMessage[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMailboxFile(filePath: string, messages: MailboxMessage[]): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(messages, null, 2));
  fs.renameSync(tmpPath, filePath);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the mailbox directory for a workflow.
 * Called when a workflow is created.
 */
export function initMailbox(workflowId: string): void {
  const dir = mailboxDir(workflowId);
  fs.mkdirSync(dir, { recursive: true });
  logger.debug({ workflowId }, 'OmX mailbox initialized');
}

/**
 * Write a message to a step's mailbox.
 * Appends to the existing array in the JSON file.
 */
export function writeMessage(
  workflowId: string,
  stepNumber: number,
  message: Omit<MailboxMessage, 'id' | 'created_at'>,
): MailboxMessage {
  const filePath = mailboxPath(workflowId, stepNumber);
  const messages = readMailboxFile(filePath);

  const full: MailboxMessage = {
    id: crypto.randomUUID(),
    from: message.from,
    to: message.to,
    body: message.body,
    created_at: new Date().toISOString(),
  };

  messages.push(full);
  writeMailboxFile(filePath, messages);

  logger.debug(
    { workflowId, stepNumber, messageId: full.id, from: full.from },
    'Mailbox message written',
  );

  return full;
}

/**
 * Read all messages for a step's mailbox.
 */
export function readMailbox(workflowId: string, stepNumber: number): MailboxMessage[] {
  return readMailboxFile(mailboxPath(workflowId, stepNumber));
}

/**
 * Get unread messages (where read_at is null/undefined) for a step.
 */
export function getUnreadMessages(workflowId: string, stepNumber: number): MailboxMessage[] {
  const messages = readMailboxFile(mailboxPath(workflowId, stepNumber));
  return messages.filter(m => !m.read_at);
}

/**
 * Mark a specific message as delivered by setting read_at.
 * Returns true if the message was found and marked, false otherwise.
 */
export function markDelivered(workflowId: string, stepNumber: number, messageId: string): boolean {
  const filePath = mailboxPath(workflowId, stepNumber);
  const messages = readMailboxFile(filePath);

  const msg = messages.find(m => m.id === messageId);
  if (!msg) return false;

  msg.read_at = new Date().toISOString();
  writeMailboxFile(filePath, messages);

  logger.debug(
    { workflowId, stepNumber, messageId },
    'Mailbox message marked delivered',
  );

  return true;
}
