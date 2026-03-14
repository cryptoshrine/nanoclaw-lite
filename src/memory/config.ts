/**
 * Memory system configuration constants
 */

// Chunking
export const CHUNK_MAX_LINES = 40;
export const CHUNK_MIN_LINES = 5;
export const CHUNK_OVERLAP_LINES = 3;

// Embedding (local model via @xenova/transformers)
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_BATCH_SIZE = 16;

// Search
export const DEFAULT_MAX_RESULTS = 6;
export const DEFAULT_MIN_SCORE = 0.35;
export const VECTOR_WEIGHT = 0.7;
export const KEYWORD_WEIGHT = 0.3;
export const VECTOR_CANDIDATES_MULTIPLIER = 4;

// IPC
export const MEMORY_IPC_POLL_MS = 100;
export const MEMORY_IPC_TIMEOUT_MS = 30000;

// File watching
export const FILE_WATCH_DEBOUNCE_MS = 2000;
