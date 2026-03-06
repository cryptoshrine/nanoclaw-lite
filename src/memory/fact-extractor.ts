/**
 * FactExtractor — automated fact extraction from conversation transcripts.
 *
 * After each agent session, the conversation is queued for async processing.
 * A debounced background worker uses Claude Haiku to extract structured facts,
 * which are stored in the memory_facts SQLite table and injected into
 * future agent sessions.
 */

import crypto from 'crypto';

import Database from 'better-sqlite3';

import { logger } from '../logger.js';

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction system. Given a conversation transcript, extract discrete facts that would be useful context in future conversations with this user.

Output ONLY a valid JSON array. Each element:
{
  "content": "brief factual statement",
  "category": "preference|knowledge|context|behavior|goal",
  "confidence": 0.5-1.0,
  "supersedes": "content of an existing fact this replaces, or null"
}

Rules:
- Extract only facts useful in future conversations
- Do NOT extract transient details (timestamps, greetings, "I'll look into that")
- Do NOT extract facts about the AI assistant itself
- Confidence 0.9+: explicit user statements ("I prefer...", "My name is...")
- Confidence 0.7-0.9: strongly implied from context
- Confidence 0.5-0.7: reasonable inference
- If a fact contradicts an existing one, set "supersedes" to the old fact content
- Maximum 10 facts per extraction
- Return empty array [] if no meaningful facts to extract`;

const DEBOUNCE_MS = 30_000;
const MAX_FACTS_PER_GROUP = 200;
const MIN_CONFIDENCE = 0.5;
const MAX_TRANSCRIPT_CHARS = 8000;

interface QueueEntry {
  groupFolder: string;
  transcripts: string[];
  sessionId?: string;
  queuedAt: number;
}

interface ExtractedFact {
  content: string;
  category: string;
  confidence: number;
  supersedes: string | null;
}

export interface StoredFact {
  id: string;
  group_folder: string;
  content: string;
  category: string;
  confidence: number;
  source_session: string | null;
  created_at: string;
  updated_at: string;
  superseded_by: string | null;
  access_count: number;
}

export class FactExtractor {
  private queue = new Map<string, QueueEntry>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private db: Database.Database;
  private oauthToken: string | undefined;

  constructor(db: Database.Database) {
    this.db = db;
    this.oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  get isAvailable(): boolean {
    return !!this.oauthToken;
  }

  /** Queue a conversation for fact extraction. Debounced per group. */
  enqueue(groupFolder: string, transcript: string, sessionId?: string): void {
    if (!this.isAvailable) {
      logger.debug('Fact extraction unavailable — no CLAUDE_CODE_OAUTH_TOKEN');
      return;
    }

    if (!transcript || transcript.length < 50) return;

    const existing = this.queue.get(groupFolder);
    if (existing) {
      existing.transcripts.push(transcript);
      existing.sessionId = sessionId || existing.sessionId;
    } else {
      this.queue.set(groupFolder, {
        groupFolder,
        transcripts: [transcript],
        sessionId,
        queuedAt: Date.now(),
      });
    }

    // Debounce: wait 30s after last enqueue for this group
    const timer = this.debounceTimers.get(groupFolder);
    if (timer) clearTimeout(timer);

    this.debounceTimers.set(
      groupFolder,
      setTimeout(() => {
        this.process(groupFolder).catch((err) => {
          logger.error({ groupFolder, err }, 'Fact extraction failed');
        });
      }, DEBOUNCE_MS),
    );
  }

  /** Get top N facts for a group, ordered by confidence. */
  getTopFacts(groupFolder: string, limit = 30): StoredFact[] {
    return this.db
      .prepare(
        `SELECT * FROM memory_facts
         WHERE group_folder = ? AND superseded_by IS NULL
         ORDER BY confidence DESC, access_count DESC
         LIMIT ?`,
      )
      .all(groupFolder, limit) as StoredFact[];
  }

  /** Increment access count for facts that were included in a session prompt. */
  markAccessed(factIds: string[]): void {
    if (factIds.length === 0) return;
    const placeholders = factIds.map(() => '?').join(',');
    this.db
      .prepare(
        `UPDATE memory_facts SET access_count = access_count + 1 WHERE id IN (${placeholders})`,
      )
      .run(...factIds);
  }

  /** Prune facts exceeding the per-group cap. Removes lowest confidence first. */
  prune(groupFolder: string): void {
    const count = (
      this.db
        .prepare(
          'SELECT COUNT(*) as cnt FROM memory_facts WHERE group_folder = ? AND superseded_by IS NULL',
        )
        .get(groupFolder) as { cnt: number }
    ).cnt;

    if (count <= MAX_FACTS_PER_GROUP) return;

    const toRemove = count - MAX_FACTS_PER_GROUP;
    this.db
      .prepare(
        `DELETE FROM memory_facts WHERE id IN (
           SELECT id FROM memory_facts
           WHERE group_folder = ? AND superseded_by IS NULL
           ORDER BY confidence ASC, access_count ASC
           LIMIT ?
         )`,
      )
      .run(groupFolder, toRemove);

    logger.info({ groupFolder, pruned: toRemove }, 'Pruned low-confidence facts');
  }

  /** Clean up timers on shutdown. */
  destroy(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.queue.clear();
  }

  // ─── Private ────────────────────────────────────────────

  private async process(groupFolder: string): Promise<void> {
    const entry = this.queue.get(groupFolder);
    if (!entry) return;
    this.queue.delete(groupFolder);
    this.debounceTimers.delete(groupFolder);

    const combinedTranscript = entry.transcripts
      .join('\n---\n')
      .slice(0, MAX_TRANSCRIPT_CHARS);

    const existingFacts = this.getTopFacts(groupFolder, 50);
    const extracted = await this.extractFacts(combinedTranscript, existingFacts);

    if (extracted.length === 0) {
      logger.debug({ groupFolder }, 'No facts extracted from conversation');
      return;
    }

    const now = new Date().toISOString();

    for (const fact of extracted) {
      // Handle supersession
      if (fact.supersedes) {
        const old = existingFacts.find(
          (f) => f.content.toLowerCase() === fact.supersedes!.toLowerCase(),
        );
        if (old) {
          this.db
            .prepare('UPDATE memory_facts SET superseded_by = ? WHERE id = ?')
            .run(fact.content, old.id);
        }
      }

      // Check for near-duplicate (same content already exists)
      const duplicate = existingFacts.find(
        (f) =>
          f.content.toLowerCase() === fact.content.toLowerCase() &&
          !f.superseded_by,
      );
      if (duplicate) {
        // Update confidence if the new extraction is more confident
        if (fact.confidence > duplicate.confidence) {
          this.db
            .prepare('UPDATE memory_facts SET confidence = ?, updated_at = ? WHERE id = ?')
            .run(fact.confidence, now, duplicate.id);
        }
        continue;
      }

      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO memory_facts (id, group_folder, content, category, confidence, source_session, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          groupFolder,
          fact.content,
          fact.category,
          fact.confidence,
          entry.sessionId || null,
          now,
          now,
        );
    }

    this.prune(groupFolder);

    logger.info(
      { groupFolder, factCount: extracted.length, sessionId: entry.sessionId },
      'Facts extracted and stored',
    );
  }

  private async extractFacts(
    transcript: string,
    existingFacts: StoredFact[],
  ): Promise<ExtractedFact[]> {
    if (!this.oauthToken) return [];

    const existingContext =
      existingFacts.length > 0
        ? `\n\nExisting facts (do not duplicate these, but you may supersede them if contradicted):\n${existingFacts.map((f) => `- [${f.category}] ${f.content}`).join('\n')}`
        : '';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${this.oauthToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 2000,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `${transcript}${existingContext}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        logger.error(
          { status: response.status, statusText: response.statusText },
          'Fact extraction API error',
        );
        return [];
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
      };
      const text = data.content?.[0]?.text;
      if (!text) return [];

      return this.parseFacts(text);
    } catch (err) {
      logger.error({ err }, 'Fact extraction request failed');
      return [];
    }
  }

  private parseFacts(text: string): ExtractedFact[] {
    try {
      // Extract JSON array from response (model might wrap in markdown code block)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item): item is ExtractedFact => {
          if (typeof item !== 'object' || item === null) return false;
          const f = item as Record<string, unknown>;
          return (
            typeof f.content === 'string' &&
            typeof f.category === 'string' &&
            typeof f.confidence === 'number' &&
            f.confidence >= MIN_CONFIDENCE &&
            ['preference', 'knowledge', 'context', 'behavior', 'goal'].includes(
              f.category as string,
            )
          );
        })
        .slice(0, 10)
        .map((f) => ({
          content: f.content,
          category: f.category,
          confidence: Math.min(1, Math.max(MIN_CONFIDENCE, f.confidence)),
          supersedes: typeof f.supersedes === 'string' ? f.supersedes : null,
        }));
    } catch (err) {
      logger.error({ err, text: text.slice(0, 200) }, 'Failed to parse extracted facts');
      return [];
    }
  }
}
