import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  initMailbox,
  writeMessage,
  readMailbox,
  getUnreadMessages,
  markDelivered,
} from './omx-mailbox.js';

// Mock OMX_WORKFLOWS_DIR to use a temp directory
let tmpDir: string;

vi.mock('./config.js', () => ({
  get OMX_WORKFLOWS_DIR() {
    return tmpDir;
  },
}));

// Suppress logger noise in tests
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('omx-mailbox', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omx-mailbox-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initMailbox', () => {
    it('creates the mailbox directory structure', () => {
      initMailbox('wf-1');

      const mailboxPath = path.join(tmpDir, 'wf-1', 'mailbox');
      expect(fs.existsSync(mailboxPath)).toBe(true);
      expect(fs.statSync(mailboxPath).isDirectory()).toBe(true);
    });

    it('is idempotent — calling twice does not error', () => {
      initMailbox('wf-2');
      initMailbox('wf-2');

      const mailboxPath = path.join(tmpDir, 'wf-2', 'mailbox');
      expect(fs.existsSync(mailboxPath)).toBe(true);
    });
  });

  describe('writeMessage + getUnreadMessages', () => {
    it('write then read returns the message', () => {
      initMailbox('wf-rw');

      const msg = writeMessage('wf-rw', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Step 1 complete',
      });

      expect(msg.id).toBeTypeOf('string');
      expect(msg.from).toBe('specialist-A');
      expect(msg.to).toBe('supervisor');
      expect(msg.body).toBe('Step 1 complete');
      expect(msg.created_at).toBeTypeOf('string');
      expect(msg.read_at).toBeUndefined();

      const unread = getUnreadMessages('wf-rw', 1);
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(msg.id);
      expect(unread[0].body).toBe('Step 1 complete');
    });

    it('works without calling initMailbox first', () => {
      // writeMessage should auto-create directories
      const msg = writeMessage('wf-noinit', 3, {
        from: 'specialist-B',
        to: 'supervisor',
        body: 'Auto-created',
      });

      expect(msg.id).toBeTypeOf('string');
      const unread = getUnreadMessages('wf-noinit', 3);
      expect(unread).toHaveLength(1);
    });
  });

  describe('markDelivered', () => {
    it('marks message as read — no longer appears in unread', () => {
      initMailbox('wf-mark');

      const msg = writeMessage('wf-mark', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Progress update',
      });

      expect(getUnreadMessages('wf-mark', 1)).toHaveLength(1);

      const result = markDelivered('wf-mark', 1, msg.id);
      expect(result).toBe(true);

      expect(getUnreadMessages('wf-mark', 1)).toHaveLength(0);
    });

    it('returns false for non-existent message id', () => {
      initMailbox('wf-nomark');
      writeMessage('wf-nomark', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Test',
      });

      const result = markDelivered('wf-nomark', 1, 'non-existent-id');
      expect(result).toBe(false);
    });

    it('sets read_at on the delivered message', () => {
      initMailbox('wf-readat');

      const msg = writeMessage('wf-readat', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Check read_at',
      });

      markDelivered('wf-readat', 1, msg.id);

      const allMessages = readMailbox('wf-readat', 1);
      expect(allMessages).toHaveLength(1);
      expect(allMessages[0].read_at).toBeTypeOf('string');
    });
  });

  describe('getUnreadMessages', () => {
    it('returns empty array for non-existent mailbox', () => {
      const messages = getUnreadMessages('wf-ghost', 99);
      expect(messages).toEqual([]);
    });

    it('returns empty array for empty mailbox', () => {
      initMailbox('wf-empty');
      const messages = getUnreadMessages('wf-empty', 1);
      expect(messages).toEqual([]);
    });
  });

  describe('multiple messages', () => {
    it('returns all messages in order', () => {
      initMailbox('wf-multi');

      const msg1 = writeMessage('wf-multi', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'First',
      });

      const msg2 = writeMessage('wf-multi', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Second',
      });

      const msg3 = writeMessage('wf-multi', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Third',
      });

      const unread = getUnreadMessages('wf-multi', 1);
      expect(unread).toHaveLength(3);
      expect(unread[0].body).toBe('First');
      expect(unread[1].body).toBe('Second');
      expect(unread[2].body).toBe('Third');
    });

    it('only returns unread after some are marked delivered', () => {
      initMailbox('wf-partial');

      const msg1 = writeMessage('wf-partial', 1, {
        from: 'A',
        to: 'sup',
        body: 'Msg 1',
      });

      const msg2 = writeMessage('wf-partial', 1, {
        from: 'A',
        to: 'sup',
        body: 'Msg 2',
      });

      const msg3 = writeMessage('wf-partial', 1, {
        from: 'A',
        to: 'sup',
        body: 'Msg 3',
      });

      markDelivered('wf-partial', 1, msg1.id);
      markDelivered('wf-partial', 1, msg3.id);

      const unread = getUnreadMessages('wf-partial', 1);
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(msg2.id);
    });
  });

  describe('step isolation', () => {
    it('messages from different steps do not cross-contaminate', () => {
      initMailbox('wf-iso');

      writeMessage('wf-iso', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Step 1 msg',
      });

      writeMessage('wf-iso', 2, {
        from: 'specialist-B',
        to: 'supervisor',
        body: 'Step 2 msg',
      });

      writeMessage('wf-iso', 1, {
        from: 'specialist-A',
        to: 'supervisor',
        body: 'Another step 1 msg',
      });

      const step1Msgs = getUnreadMessages('wf-iso', 1);
      const step2Msgs = getUnreadMessages('wf-iso', 2);

      expect(step1Msgs).toHaveLength(2);
      expect(step2Msgs).toHaveLength(1);

      expect(step1Msgs[0].body).toBe('Step 1 msg');
      expect(step1Msgs[1].body).toBe('Another step 1 msg');
      expect(step2Msgs[0].body).toBe('Step 2 msg');
    });
  });

  describe('readMailbox', () => {
    it('returns all messages including read ones', () => {
      initMailbox('wf-all');

      const msg1 = writeMessage('wf-all', 1, {
        from: 'A',
        to: 'sup',
        body: 'Read me',
      });

      writeMessage('wf-all', 1, {
        from: 'A',
        to: 'sup',
        body: 'Still unread',
      });

      markDelivered('wf-all', 1, msg1.id);

      const all = readMailbox('wf-all', 1);
      expect(all).toHaveLength(2);

      const unread = getUnreadMessages('wf-all', 1);
      expect(unread).toHaveLength(1);
    });
  });
});
