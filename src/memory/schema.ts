/**
 * Memory system database schema
 * Uses better-sqlite3 (existing project dependency)
 */

import Database from 'better-sqlite3';

/**
 * Initialize memory tables in the existing database.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export function initMemorySchema(db: Database.Database): void {
  db.exec(`
    -- Indexed files per group with content hashes for change detection
    CREATE TABLE IF NOT EXISTS memory_files (
      path TEXT NOT NULL,
      group_folder TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'file',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY (path, group_folder)
    );

    -- Text chunks with embeddings
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      group_folder TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'file',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_group
      ON memory_chunks(group_folder);

    -- Embedding cache (avoids re-embedding identical text)
    CREATE TABLE IF NOT EXISTS memory_embedding_cache (
      hash TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Automated fact extraction from conversations
    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      source_session TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      superseded_by TEXT,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_group
      ON memory_facts(group_folder);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_confidence
      ON memory_facts(confidence DESC);
  `);

  // FTS5 virtual table — must be created separately
  // Use try/catch because "IF NOT EXISTS" for virtual tables
  // can behave differently across SQLite versions
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        group_folder UNINDEXED,
        source UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      );
    `);
  } catch {
    // Table already exists
  }
}
