/**
 * Hybrid search: BM25 + vector merge
 * Adapted from OpenClaw's hybrid.ts
 */

import { KEYWORD_WEIGHT, VECTOR_WEIGHT } from './config.js';
import { MemorySearchResult } from './types.js';

/**
 * Build an FTS5 query string from a natural language query.
 * Splits into words, wraps each in quotes, joins with OR.
 */
export function buildFtsQuery(query: string): string {
  const words = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) return '';

  // Use OR to get broad matches, FTS5 will rank by BM25
  return words.map((w) => `"${w}"`).join(' OR ');
}

/**
 * Convert BM25 rank (negative) to a 0–1 score.
 * FTS5 bm25() returns negative values where more negative = better match.
 */
export function bm25RankToScore(rank: number): number {
  // rank is negative; -rank makes it positive
  // Use a sigmoid-like normalization
  const positiveRank = -rank;
  if (positiveRank <= 0) return 0;
  // Normalize: typical BM25 scores range ~0.5 to 20
  return Math.min(1, positiveRank / (positiveRank + 5));
}

interface ScoredResult {
  id: string;
  vectorScore: number;
  keywordScore: number;
}

/**
 * Merge vector and keyword search results using weighted combination.
 * Returns merged scores keyed by chunk ID.
 */
export function mergeHybridResults(
  vectorResults: Array<{ id: string; score: number }>,
  keywordResults: Array<{ id: string; score: number }>,
): Map<string, number> {
  const merged = new Map<string, ScoredResult>();

  for (const v of vectorResults) {
    merged.set(v.id, {
      id: v.id,
      vectorScore: v.score,
      keywordScore: 0,
    });
  }

  for (const k of keywordResults) {
    const existing = merged.get(k.id);
    if (existing) {
      existing.keywordScore = k.score;
    } else {
      merged.set(k.id, {
        id: k.id,
        vectorScore: 0,
        keywordScore: k.score,
      });
    }
  }

  const scores = new Map<string, number>();
  for (const [id, result] of merged) {
    const score =
      result.vectorScore * VECTOR_WEIGHT +
      result.keywordScore * KEYWORD_WEIGHT;
    scores.set(id, score);
  }

  return scores;
}

/**
 * Sort and filter search results by score.
 */
export function rankResults(
  results: MemorySearchResult[],
  maxResults: number,
  minScore: number,
): MemorySearchResult[] {
  return results
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
