import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getAllChats, storeChatMetadata } from './db.js';
import { getAvailableGroups, _setRegisteredGroups } from './index.js';

beforeEach(() => {
  _initTestDatabase();
  _setRegisteredGroups({});
});

// --- JID ownership patterns ---

describe('JID ownership patterns', () => {
  it('Telegram group JID: ends with @telegram', () => {
    const jid = '-12345678@telegram';
    expect(jid.endsWith('@telegram')).toBe(true);
  });

  it('Telegram DM JID: ends with @telegram', () => {
    const jid = '12345678@telegram';
    expect(jid.endsWith('@telegram')).toBe(true);
  });

  it('unknown JID format: does not match Telegram pattern', () => {
    const jid = 'unknown:12345';
    expect(jid.endsWith('@telegram')).toBe(false);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only @telegram JIDs', () => {
    storeChatMetadata('group1@telegram', '2024-01-01T00:00:01.000Z', 'Group 1');
    storeChatMetadata('user@other', '2024-01-01T00:00:02.000Z', 'Other');
    storeChatMetadata('group2@telegram', '2024-01-01T00:00:03.000Z', 'Group 2');

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.jid.endsWith('@telegram'))).toBe(true);
  });

  it('excludes __group_sync__ sentinel', () => {
    storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group@telegram', '2024-01-01T00:00:01.000Z', 'Group');

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group@telegram');
  });

  it('marks registered groups correctly', () => {
    storeChatMetadata('reg@telegram', '2024-01-01T00:00:01.000Z', 'Registered');
    storeChatMetadata('unreg@telegram', '2024-01-01T00:00:02.000Z', 'Unregistered');

    _setRegisteredGroups({
      'reg@telegram': {
        name: 'Registered',
        folder: 'registered',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

    const groups = getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'reg@telegram');
    const unreg = groups.find((g) => g.jid === 'unreg@telegram');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', () => {
    storeChatMetadata('old@telegram', '2024-01-01T00:00:01.000Z', 'Old');
    storeChatMetadata('new@telegram', '2024-01-01T00:00:05.000Z', 'New');
    storeChatMetadata('mid@telegram', '2024-01-01T00:00:03.000Z', 'Mid');

    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('new@telegram');
    expect(groups[1].jid).toBe('mid@telegram');
    expect(groups[2].jid).toBe('old@telegram');
  });

  it('returns empty array when no chats exist', () => {
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(0);
  });
});
