// ── Council Session Store ────────────────────────────────────────────
// Persists council sessions to disk as JSON files.
// Sessions are stored in data/council/ directory.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { CouncilSession } from './types.js';

const STORE_DIR = join(process.cwd(), 'data', 'council');

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

export class CouncilStore {
  /** Save a session to disk */
  static save(session: CouncilSession): void {
    ensureDir();
    const filePath = join(STORE_DIR, `${session.id}.json`);
    writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /** Load a session by ID */
  static load(sessionId: string): CouncilSession | null {
    const filePath = join(STORE_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as CouncilSession;
    } catch {
      return null;
    }
  }

  /** List all sessions (most recent first) */
  static list(): CouncilSession[] {
    ensureDir();
    const files = readdirSync(STORE_DIR).filter((f) => f.endsWith('.json'));

    const sessions: CouncilSession[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(STORE_DIR, file), 'utf-8');
        sessions.push(JSON.parse(raw));
      } catch {
        // Skip corrupt files
      }
    }

    // Sort by createdAt descending
    sessions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return sessions;
  }

  /** Delete a session */
  static delete(sessionId: string): boolean {
    const filePath = join(STORE_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return false;

    try {
      const { unlinkSync } = require('fs');
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
