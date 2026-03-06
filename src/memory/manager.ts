/**
 * MemoryManager — Core class for the memory system
 * Handles file indexing, embedding, and hybrid search
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../config.js';
import { logger } from '../logger.js';

import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_MIN_SCORE,
  FILE_WATCH_DEBOUNCE_MS,
  VECTOR_CANDIDATES_MULTIPLIER,
} from './config.js';
import { chunkId, chunkMarkdown, cosineSimilarity, hashText } from './chunker.js';
import { EmbeddingClient } from './embeddings.js';
import {
  bm25RankToScore,
  buildFtsQuery,
  mergeHybridResults,
  rankResults,
} from './hybrid.js';
import { MemoryChunk, MemorySearchResult } from './types.js';

const BUSY_RETRY_COUNT = 3;
const BUSY_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBusyRetry<T>(fn: () => T): Promise<T> {
  for (let attempt = 0; attempt < BUSY_RETRY_COUNT; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      const isBusy =
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_BUSY';
      if (!isBusy || attempt === BUSY_RETRY_COUNT - 1) throw err;
      logger.debug({ attempt: attempt + 1 }, 'SQLite busy, retrying');
      await sleep(BUSY_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new Error('unreachable');
}

export class MemoryManager {
  private db: Database.Database;
  private embedder: EmbeddingClient;
  private watchers = new Map<string, fs.FSWatcher>();
  private syncDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(db: Database.Database) {
    this.db = db;
    this.embedder = new EmbeddingClient();
  }

  /**
   * Sync all .md files in a group's directory into the memory index.
   * Only re-processes changed files (hash comparison).
   */
  async sync(groupFolder: string): Promise<void> {
    const groupDir = path.join(GROUPS_DIR, groupFolder);
    if (!fs.existsSync(groupDir)) return;

    const mdFiles = this.findMarkdownFiles(groupDir);

    // Get currently indexed files for this group
    const indexed = new Map<string, { hash: string; mtime: number }>();
    const rows = this.db
      .prepare('SELECT path, hash, mtime FROM memory_files WHERE group_folder = ?')
      .all(groupFolder) as Array<{ path: string; hash: string; mtime: number }>;
    for (const row of rows) {
      indexed.set(row.path, { hash: row.hash, mtime: row.mtime });
    }

    // Find files that need reindexing
    const toIndex: Array<{ filePath: string; relativePath: string }> = [];
    const currentPaths = new Set<string>();

    for (const absPath of mdFiles) {
      const relativePath = path.relative(groupDir, absPath);
      currentPaths.add(relativePath);

      const stat = fs.statSync(absPath);
      const existing = indexed.get(relativePath);

      // Fast path: skip files whose mtime hasn't changed (avoids reading file content)
      if (existing && Math.floor(stat.mtimeMs) === existing.mtime) {
        continue;
      }

      // mtime changed (or new file) — read content and compare hash
      const content = fs.readFileSync(absPath, 'utf-8');
      const fileHash = hashText(content);

      if (!existing || existing.hash !== fileHash) {
        toIndex.push({ filePath: absPath, relativePath });
      }
    }

    // Remove stale entries (files that no longer exist)
    for (const [indexedPath] of indexed) {
      if (!currentPaths.has(indexedPath)) {
        await this.removeFile(groupFolder, indexedPath);
      }
    }

    if (toIndex.length === 0) return;

    logger.info(
      { groupFolder, fileCount: toIndex.length },
      'Indexing memory files',
    );

    for (const { filePath, relativePath } of toIndex) {
      await this.indexFile(groupFolder, filePath, relativePath, 'file');
    }
  }

  /**
   * Search memory for a group using hybrid vector + keyword search.
   * Falls back to keyword-only if embeddings are unavailable.
   */
  async search(
    groupFolder: string,
    query: string,
    maxResults = DEFAULT_MAX_RESULTS,
    minScore = DEFAULT_MIN_SCORE,
  ): Promise<MemorySearchResult[]> {
    // Keyword search (always available)
    const keywordResults = this.keywordSearch(groupFolder, query);

    // Vector search (requires embeddings)
    let vectorResults: Array<{ id: string; score: number }> = [];
    if (this.embedder.isAvailable) {
      const queryEmbedding = await this.embedder.embed(query);
      if (queryEmbedding) {
        vectorResults = this.vectorSearch(
          groupFolder,
          queryEmbedding,
          maxResults * VECTOR_CANDIDATES_MULTIPLIER,
        );
      }
    }

    // If keyword-only mode, adjust minimum score down since no vector boost
    const effectiveMinScore = this.embedder.isAvailable
      ? minScore
      : minScore * 0.5;

    // Merge results
    let finalResults: MemorySearchResult[];

    if (vectorResults.length > 0) {
      const mergedScores = mergeHybridResults(vectorResults, keywordResults);

      // Build result objects
      const resultMap = new Map<string, MemorySearchResult>();
      const chunkRows = this.getChunksByIds(
        [...mergedScores.keys()],
        groupFolder,
      );

      for (const chunk of chunkRows) {
        const score = mergedScores.get(chunk.id);
        if (score !== undefined) {
          resultMap.set(chunk.id, {
            id: chunk.id,
            path: chunk.path,
            source: chunk.source as 'file' | 'conversation',
            start_line: chunk.start_line,
            end_line: chunk.end_line,
            text: chunk.text,
            score,
          });
        }
      }

      finalResults = rankResults(
        [...resultMap.values()],
        maxResults,
        effectiveMinScore,
      );
    } else {
      // Keyword-only results
      const chunkRows = this.getChunksByIds(
        keywordResults.map((r) => r.id),
        groupFolder,
      );

      const chunkMap = new Map(chunkRows.map((c) => [c.id, c]));

      finalResults = rankResults(
        keywordResults
          .map((kr) => {
            const chunk = chunkMap.get(kr.id);
            if (!chunk) return null;
            return {
              id: chunk.id,
              path: chunk.path,
              source: chunk.source as 'file' | 'conversation',
              start_line: chunk.start_line,
              end_line: chunk.end_line,
              text: chunk.text,
              score: kr.score,
            };
          })
          .filter((r): r is MemorySearchResult => r !== null),
        maxResults,
        effectiveMinScore,
      );
    }

    return finalResults;
  }

  /**
   * Read a file snippet (for memory_get requests).
   */
  readFile(
    groupFolder: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): string | null {
    const fullPath = path.join(GROUPS_DIR, groupFolder, filePath);

    // Security: ensure path stays within group directory
    const resolvedPath = path.resolve(fullPath);
    const groupDir = path.resolve(path.join(GROUPS_DIR, groupFolder));
    if (!resolvedPath.startsWith(groupDir)) {
      logger.warn(
        { groupFolder, filePath },
        'Path traversal attempt in memory_get blocked',
      );
      return null;
    }

    if (!fs.existsSync(resolvedPath)) return null;

    const content = fs.readFileSync(resolvedPath, 'utf-8');

    if (startLine !== undefined && endLine !== undefined) {
      const lines = content.split('\n');
      return lines.slice(startLine, endLine + 1).join('\n');
    }

    return content;
  }

  /**
   * Start watching a group's directory for file changes.
   */
  watchGroup(groupFolder: string): void {
    const groupDir = path.join(GROUPS_DIR, groupFolder);
    if (!fs.existsSync(groupDir)) return;

    // Don't double-watch
    if (this.watchers.has(groupFolder)) return;

    try {
      const watcher = fs.watch(
        groupDir,
        { recursive: true },
        (_event, filename) => {
          if (!filename || !filename.endsWith('.md')) return;

          // Debounce syncs
          const existing = this.syncDebounceTimers.get(groupFolder);
          if (existing) clearTimeout(existing);

          this.syncDebounceTimers.set(
            groupFolder,
            setTimeout(() => {
              this.syncDebounceTimers.delete(groupFolder);
              this.sync(groupFolder).catch((err) => {
                logger.error(
                  { groupFolder, err },
                  'Error in debounced memory sync',
                );
              });
            }, FILE_WATCH_DEBOUNCE_MS),
          );
        },
      );

      this.watchers.set(groupFolder, watcher);
      logger.debug({ groupFolder }, 'Memory file watcher started');
    } catch (err) {
      logger.warn(
        { groupFolder, err },
        'Failed to start memory file watcher',
      );
    }
  }

  /**
   * Stop all watchers and clean up.
   */
  destroy(): void {
    for (const [group, watcher] of this.watchers) {
      watcher.close();
      logger.debug({ group }, 'Memory file watcher closed');
    }
    this.watchers.clear();

    for (const timer of this.syncDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.syncDebounceTimers.clear();
  }

  // ─── Private Methods ────────────────────────────────────────────

  private findMarkdownFiles(dir: string): string[] {
    const files: string[] = [];

    function walk(currentDir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules, .git, etc.
          if (
            entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'logs'
          ) {
            continue;
          }
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    }

    walk(dir);
    return files;
  }

  private async indexFile(
    groupFolder: string,
    absPath: string,
    relativePath: string,
    source: 'file' | 'conversation',
  ): Promise<void> {
    const content = fs.readFileSync(absPath, 'utf-8');
    const fileHash = hashText(content);
    const stat = fs.statSync(absPath);

    // Chunk the file
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) return;

    // Get or compute embeddings
    const embeddings = await this.getEmbeddings(chunks.map((c) => c.text));

    // Use a transaction for atomicity
    const txn = this.db.transaction(() => {
      // Remove old chunks for this file
      const oldChunks = this.db
        .prepare(
          'SELECT id FROM memory_chunks WHERE path = ? AND group_folder = ?',
        )
        .all(relativePath, groupFolder) as Array<{ id: string }>;

      for (const old of oldChunks) {
        this.db
          .prepare('DELETE FROM memory_chunks_fts WHERE id = ?')
          .run(old.id);
      }
      this.db
        .prepare(
          'DELETE FROM memory_chunks WHERE path = ? AND group_folder = ?',
        )
        .run(relativePath, groupFolder);

      // Insert new chunks
      const now = Date.now();
      const insertChunk = this.db.prepare(`
        INSERT INTO memory_chunks (id, path, group_folder, source, start_line, end_line, hash, text, embedding, model, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO memory_chunks_fts (text, id, path, group_folder, source, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings ? embeddings[i] : [];
        const id = chunkId(
          groupFolder,
          relativePath,
          chunk.startLine,
          chunk.endLine,
          chunk.hash,
        );
        const model = this.embedder.isAvailable
          ? this.embedder.modelName
          : 'none';

        insertChunk.run(
          id,
          relativePath,
          groupFolder,
          source,
          chunk.startLine,
          chunk.endLine,
          chunk.hash,
          chunk.text,
          JSON.stringify(embedding),
          model,
          now,
        );

        insertFts.run(
          chunk.text,
          id,
          relativePath,
          groupFolder,
          source,
          chunk.startLine,
          chunk.endLine,
        );
      }

      // Update file record
      this.db
        .prepare(
          `INSERT OR REPLACE INTO memory_files (path, group_folder, source, hash, mtime, size)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          relativePath,
          groupFolder,
          source,
          fileHash,
          Math.floor(stat.mtimeMs),
          stat.size,
        );
    });

    await withBusyRetry(() => txn());

    logger.debug(
      { groupFolder, path: relativePath, chunks: chunks.length },
      'File indexed',
    );
  }

  private async removeFile(groupFolder: string, relativePath: string): Promise<void> {
    const txn = this.db.transaction(() => {
      const oldChunks = this.db
        .prepare(
          'SELECT id FROM memory_chunks WHERE path = ? AND group_folder = ?',
        )
        .all(relativePath, groupFolder) as Array<{ id: string }>;

      for (const old of oldChunks) {
        this.db
          .prepare('DELETE FROM memory_chunks_fts WHERE id = ?')
          .run(old.id);
      }

      this.db
        .prepare(
          'DELETE FROM memory_chunks WHERE path = ? AND group_folder = ?',
        )
        .run(relativePath, groupFolder);
      this.db
        .prepare(
          'DELETE FROM memory_files WHERE path = ? AND group_folder = ?',
        )
        .run(relativePath, groupFolder);
    });

    await withBusyRetry(() => txn());

    logger.debug({ groupFolder, path: relativePath }, 'File removed from index');
  }

  /**
   * Get embeddings for texts, using cache where possible.
   */
  private async getEmbeddings(
    texts: string[],
  ): Promise<number[][] | null> {
    if (!this.embedder.isAvailable) return null;

    const model = this.embedder.modelName;
    const result: number[][] = new Array(texts.length);
    const toEmbed: Array<{ index: number; text: string }> = [];

    // Check cache
    for (let i = 0; i < texts.length; i++) {
      const hash = hashText(texts[i]);
      const cached = this.db
        .prepare(
          'SELECT embedding FROM memory_embedding_cache WHERE hash = ? AND model = ?',
        )
        .get(hash, model) as { embedding: string } | undefined;

      if (cached) {
        result[i] = JSON.parse(cached.embedding);
      } else {
        toEmbed.push({ index: i, text: texts[i] });
      }
    }

    if (toEmbed.length === 0) return result;

    // Embed uncached texts
    const embeddings = await this.embedder.embedBatch(
      toEmbed.map((t) => t.text),
    );
    if (!embeddings) return null;

    // Cache and assign
    const now = Date.now();
    const insertCache = this.db.prepare(
      'INSERT OR REPLACE INTO memory_embedding_cache (hash, model, embedding, updated_at) VALUES (?, ?, ?, ?)',
    );

    for (let i = 0; i < toEmbed.length; i++) {
      const { index, text } = toEmbed[i];
      const embedding = embeddings[i];
      result[index] = embedding;

      const hash = hashText(text);
      insertCache.run(hash, model, JSON.stringify(embedding), now);
    }

    return result;
  }

  private vectorSearch(
    groupFolder: string,
    queryEmbedding: number[],
    maxCandidates: number,
  ): Array<{ id: string; score: number }> {
    // Load all chunk embeddings for this group
    const chunks = this.db
      .prepare(
        'SELECT id, embedding FROM memory_chunks WHERE group_folder = ?',
      )
      .all(groupFolder) as Array<{ id: string; embedding: string }>;

    // Compute cosine similarity
    const scored: Array<{ id: string; score: number }> = [];
    for (const chunk of chunks) {
      const embedding: number[] = JSON.parse(chunk.embedding);
      if (embedding.length === 0) continue;

      const score = cosineSimilarity(queryEmbedding, embedding);
      if (score > 0) {
        scored.push({ id: chunk.id, score });
      }
    }

    // Sort by score descending, take top candidates
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxCandidates);
  }

  private keywordSearch(
    groupFolder: string,
    query: string,
  ): Array<{ id: string; score: number }> {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT id, rank FROM memory_chunks_fts
         WHERE memory_chunks_fts MATCH ? AND group_folder = ?
         ORDER BY rank
         LIMIT 50`,
        )
        .all(ftsQuery, groupFolder) as Array<{ id: string; rank: number }>;

      return rows.map((r) => ({
        id: r.id,
        score: bm25RankToScore(r.rank),
      }));
    } catch (err) {
      logger.debug({ err, query: ftsQuery }, 'FTS query failed');
      return [];
    }
  }

  private getChunksByIds(
    ids: string[],
    groupFolder: string,
  ): Array<{
    id: string;
    path: string;
    source: string;
    start_line: number;
    end_line: number;
    text: string;
  }> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT id, path, source, start_line, end_line, text
       FROM memory_chunks
       WHERE id IN (${placeholders}) AND group_folder = ?`,
      )
      .all(...ids, groupFolder) as Array<{
      id: string;
      path: string;
      source: string;
      start_line: number;
      end_line: number;
      text: string;
    }>;
  }
}
