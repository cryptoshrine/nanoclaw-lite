import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { DmAllowlist } from './types.js';
import { loadJson, saveJson } from './utils.js';

const ALLOWLIST_PATH = path.join(DATA_DIR, 'dm-allowlist.json');
const DEFAULT_ALLOWLIST: DmAllowlist = { allowed_user_ids: [], pending_requests: [] };

let dmAllowlist: DmAllowlist = { ...DEFAULT_ALLOWLIST };

/** Rate-limit map: userId → last rejection timestamp (ms) */
export const dmRejectTimes = new Map<number, number>();

export function loadDmAllowlist(): DmAllowlist {
  dmAllowlist = loadJson<DmAllowlist>(ALLOWLIST_PATH, { ...DEFAULT_ALLOWLIST });
  return dmAllowlist;
}

function saveDmAllowlist(): void {
  saveJson(ALLOWLIST_PATH, dmAllowlist);
}

export function getDmAllowlist(): DmAllowlist {
  return dmAllowlist;
}

export function addToDmAllowlist(userId: number): boolean {
  if (dmAllowlist.allowed_user_ids.includes(userId)) return false;
  dmAllowlist.allowed_user_ids.push(userId);
  // Remove from pending if present
  dmAllowlist.pending_requests = dmAllowlist.pending_requests.filter(
    (p) => p.user_id !== userId,
  );
  saveDmAllowlist();
  logger.info({ userId }, 'Added user to DM allowlist');
  return true;
}

export function removeFromDmAllowlist(userId: number): boolean {
  const idx = dmAllowlist.allowed_user_ids.indexOf(userId);
  if (idx === -1) return false;
  dmAllowlist.allowed_user_ids.splice(idx, 1);
  saveDmAllowlist();
  logger.info({ userId }, 'Removed user from DM allowlist');
  return true;
}

export function addPendingRequest(
  userId: number,
  username?: string,
  firstName?: string,
): void {
  const alreadyPending = dmAllowlist.pending_requests.some(
    (p) => p.user_id === userId,
  );
  if (!alreadyPending) {
    dmAllowlist.pending_requests.push({
      user_id: userId,
      username,
      first_name: firstName,
      requested_at: new Date().toISOString(),
    });
    saveDmAllowlist();
  }
}
