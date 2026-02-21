/**
 * Markdown chunking and text utilities
 * Adapted from OpenClaw's internal.ts
 */

import crypto from 'crypto';

import {
  CHUNK_MAX_LINES,
  CHUNK_MIN_LINES,
  CHUNK_OVERLAP_LINES,
} from './config.js';
import { ChunkInfo } from './types.js';

/**
 * Compute SHA-256 hash of text.
 */
export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Compute chunk ID from group, path, line range, and content hash.
 */
export function chunkId(
  group: string,
  path: string,
  startLine: number,
  endLine: number,
  hash: string,
): string {
  const raw = `${group}:${path}:${startLine}:${endLine}:${hash}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Check if a line is a markdown heading.
 */
function isHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

/**
 * Check if a line is a blank separator.
 */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * Chunk markdown text into overlapping segments.
 * Splits at heading boundaries and blank lines, respecting min/max constraints.
 */
export function chunkMarkdown(text: string): ChunkInfo[] {
  const lines = text.split('\n');
  if (lines.length === 0) return [];

  const chunks: ChunkInfo[] = [];
  let currentStart = 0;
  let currentEnd = 0;

  function emitChunk(start: number, end: number): void {
    // Clamp to valid range
    const s = Math.max(0, start);
    const e = Math.min(lines.length - 1, end);

    if (e - s + 1 < CHUNK_MIN_LINES && chunks.length > 0) {
      // Too small — merge with previous chunk
      const prev = chunks[chunks.length - 1];
      const mergedText = lines.slice(prev.startLine, e + 1).join('\n');
      prev.endLine = e;
      prev.text = mergedText;
      prev.hash = hashText(mergedText);
      return;
    }

    const chunkText = lines.slice(s, e + 1).join('\n');
    if (chunkText.trim()) {
      chunks.push({
        text: chunkText,
        startLine: s,
        endLine: e,
        hash: hashText(chunkText),
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineCount = i - currentStart + 1;

    // Split at heading boundaries (if we have enough content)
    if (isHeading(lines[i]) && lineCount > CHUNK_MIN_LINES) {
      emitChunk(currentStart, i - 1);
      currentStart = Math.max(0, i - CHUNK_OVERLAP_LINES);
      currentEnd = i;
      continue;
    }

    // Split at max size
    if (lineCount >= CHUNK_MAX_LINES) {
      // Try to find a blank line to split at
      let splitAt = i;
      for (let j = i; j >= currentStart + CHUNK_MIN_LINES; j--) {
        if (isBlank(lines[j])) {
          splitAt = j;
          break;
        }
      }

      emitChunk(currentStart, splitAt);
      currentStart = Math.max(0, splitAt + 1 - CHUNK_OVERLAP_LINES);
      currentEnd = splitAt + 1;
      continue;
    }

    currentEnd = i;
  }

  // Emit final chunk
  if (currentStart <= lines.length - 1) {
    emitChunk(currentStart, lines.length - 1);
  }

  return chunks;
}
