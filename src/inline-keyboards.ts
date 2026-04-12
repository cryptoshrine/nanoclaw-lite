/**
 * Inline Keyboards — Telegram approval buttons for human checkpoints.
 *
 * Agents can request user approval via the `request_approval` MCP tool.
 * This module tracks pending approvals and routes callback query responses
 * back to the waiting agent.
 *
 * Flow:
 * 1. Agent writes IPC file with type: 'request_approval'
 * 2. Host sends InlineKeyboard to Telegram
 * 3. User taps Approve/Reject
 * 4. Callback routed back to agent via IPC response file
 */

import fs from 'fs';
import path from 'path';
import { Bot, InlineKeyboard } from 'grammy';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export interface ApprovalRequest {
  /** Unique request ID */
  id: string;
  /** Chat JID to send buttons to */
  chatJid: string;
  /** IPC directory of the requesting agent (for writing response) */
  ipcDir: string;
  /** Group folder of the requester */
  groupFolder: string;
  /** Description shown to user */
  description: string;
  /** Custom button labels (default: Approve / Reject) */
  approveLabel?: string;
  rejectLabel?: string;
  /** Options for multi-choice approvals */
  options?: string[];
  /** Telegram message ID of the sent keyboard */
  telegramMessageId?: number;
  /** When the request was created */
  createdAt: number;
}

/** Pending approval requests, keyed by request ID */
const pendingApprovals = new Map<string, ApprovalRequest>();

/** Cleanup stale approvals after 30 minutes */
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Convert a JID to a Telegram chat ID.
 */
function jidToChatId(jid: string): number {
  return parseInt(jid.split('@')[0], 10);
}

/**
 * Send an inline keyboard to Telegram for a pending approval.
 */
export async function sendApprovalKeyboard(
  bot: Bot,
  request: ApprovalRequest,
): Promise<void> {
  const chatId = jidToChatId(request.chatJid);
  const keyboard = new InlineKeyboard();

  if (request.options && request.options.length > 0) {
    // Multi-choice: one button per option
    for (const option of request.options) {
      keyboard.text(option, `approval:${request.id}:${option}`).row();
    }
    // Always add a cancel button
    keyboard.text('Cancel', `approval:${request.id}:__cancel__`);
  } else {
    // Simple approve/reject
    const approveLabel = request.approveLabel || 'Approve';
    const rejectLabel = request.rejectLabel || 'Reject';
    keyboard
      .text(`✅ ${approveLabel}`, `approval:${request.id}:approved`)
      .text(`❌ ${rejectLabel}`, `approval:${request.id}:rejected`);
  }

  try {
    const msg = await bot.api.sendMessage(chatId, `🔔 *Approval Required*\n\n${request.description}`, {
      reply_markup: keyboard,
    });
    request.telegramMessageId = msg.message_id;
    pendingApprovals.set(request.id, request);
    logger.info({ requestId: request.id, chatId }, 'Approval keyboard sent');
  } catch (err) {
    logger.error({ requestId: request.id, err }, 'Failed to send approval keyboard');
    // Write rejection response so agent doesn't hang
    writeApprovalResponse(request, 'error', 'Failed to send approval keyboard');
  }
}

/**
 * Handle a callback query from Telegram inline buttons.
 * Returns true if this callback was handled by the approval system.
 */
export async function handleCallbackQuery(
  bot: Bot,
  callbackQueryId: string,
  data: string,
  chatId: number,
): Promise<boolean> {
  if (!data.startsWith('approval:')) return false;

  const parts = data.split(':');
  if (parts.length < 3) return false;

  const requestId = parts[1];
  const choice = parts.slice(2).join(':'); // Handle colons in option text

  const request = pendingApprovals.get(requestId);
  if (!request) {
    await bot.api.answerCallbackQuery(callbackQueryId, {
      text: 'This approval has expired.',
      show_alert: true,
    });
    return true;
  }

  // Write response to agent IPC
  const status = choice === '__cancel__' ? 'rejected'
    : choice === 'rejected' ? 'rejected'
    : 'approved';
  writeApprovalResponse(request, status, choice);

  // Update the Telegram message to show the result
  const resultIcon = status === 'approved' ? '✅' : '❌';
  const resultText = `${resultIcon} ${status === 'approved' ? 'Approved' : 'Rejected'}: ${choice === '__cancel__' ? 'Cancelled' : choice}`;

  try {
    if (request.telegramMessageId) {
      await bot.api.editMessageText(
        chatId,
        request.telegramMessageId,
        `${request.description}\n\n${resultText}`,
      );
    }
    await bot.api.answerCallbackQuery(callbackQueryId, { text: resultText });
  } catch (err) {
    logger.debug({ requestId, err }, 'Failed to update approval message');
  }

  pendingApprovals.delete(requestId);
  return true;
}

/**
 * Write the approval response back to the agent via IPC.
 * Creates a response file the agent can poll for.
 */
function writeApprovalResponse(
  request: ApprovalRequest,
  status: 'approved' | 'rejected' | 'error',
  choice: string,
): void {
  const responseDir = path.join(request.ipcDir, 'responses');
  fs.mkdirSync(responseDir, { recursive: true });

  const response = {
    type: 'approval_response',
    requestId: request.id,
    status,
    choice,
    timestamp: new Date().toISOString(),
  };

  const filePath = path.join(responseDir, `approval-${request.id}.json`);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(response, null, 2));
  fs.renameSync(tmpPath, filePath);

  logger.info({ requestId: request.id, status, choice }, 'Approval response written');
}

/**
 * Register the callback_query handler on the bot.
 * Call this during bot setup.
 */
export function registerCallbackHandler(bot: Bot): void {
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!data || !chatId) return;

    const handled = await handleCallbackQuery(
      bot,
      ctx.callbackQuery.id,
      data,
      chatId,
    );

    if (!handled) {
      await ctx.answerCallbackQuery({ text: 'Unknown action' });
    }
  });

  logger.info('Inline keyboard callback handler registered');
}

/**
 * Process an approval request from IPC.
 * Called by the IPC watcher when it sees a request_approval task.
 */
export async function processApprovalRequest(
  bot: Bot,
  data: {
    requestId: string;
    chatJid: string;
    description: string;
    approveLabel?: string;
    rejectLabel?: string;
    options?: string[];
    ipcDir: string;
    groupFolder: string;
  },
): Promise<void> {
  const request: ApprovalRequest = {
    id: data.requestId || `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatJid: data.chatJid,
    ipcDir: data.ipcDir,
    groupFolder: data.groupFolder,
    description: data.description,
    approveLabel: data.approveLabel,
    rejectLabel: data.rejectLabel,
    options: data.options,
    createdAt: Date.now(),
  };

  await sendApprovalKeyboard(bot, request);
}

/**
 * Respond to a pending approval from KlawHQ (WebSocket).
 * Returns true if the approval was found and responded to.
 */
export function respondToApproval(requestId: string, approved: boolean): boolean {
  const request = pendingApprovals.get(requestId);
  if (!request) return false;

  const status = approved ? 'approved' : 'rejected';
  const choice = approved ? 'approved' : 'rejected';
  writeApprovalResponse(request, status, choice);
  pendingApprovals.delete(requestId);

  logger.info({ requestId, approved }, 'Approval responded');
  return true;
}

/**
 * Cleanup stale approvals (called periodically).
 */
export function cleanupStaleApprovals(): void {
  const now = Date.now();
  for (const [id, request] of pendingApprovals) {
    if (now - request.createdAt > APPROVAL_TIMEOUT_MS) {
      writeApprovalResponse(request, 'rejected', 'Timed out (30 minutes)');
      pendingApprovals.delete(id);
      logger.info({ requestId: id }, 'Stale approval cleaned up');
    }
  }
}
