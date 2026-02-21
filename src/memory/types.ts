/**
 * Memory system types for NanoClaw
 * Adapted from OpenClaw's memory system
 */

export interface MemoryFile {
  path: string;
  group_folder: string;
  source: 'file' | 'conversation';
  hash: string;
  mtime: number;
  size: number;
}

export interface MemoryChunk {
  id: string;
  path: string;
  group_folder: string;
  source: 'file' | 'conversation';
  start_line: number;
  end_line: number;
  hash: string;
  text: string;
  embedding: number[];
  model: string;
  updated_at: number;
}

export interface MemorySearchResult {
  id: string;
  path: string;
  source: 'file' | 'conversation';
  start_line: number;
  end_line: number;
  text: string;
  score: number;
}

export interface MemorySearchRequest {
  type: 'memory_search';
  id: string;
  query: string;
  maxResults?: number;
  minScore?: number;
}

export interface MemoryGetRequest {
  type: 'memory_get';
  id: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

export type MemoryIpcRequest = MemorySearchRequest | MemoryGetRequest;

export interface MemoryIpcResponse {
  id: string;
  status: 'success' | 'error';
  results?: MemorySearchResult[];
  content?: string;
  error?: string;
}

export interface ChunkInfo {
  text: string;
  startLine: number;
  endLine: number;
  hash: string;
}
