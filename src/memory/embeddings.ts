/**
 * Local embedding client using @xenova/transformers
 * Runs all-MiniLM-L6-v2 locally — no API keys, no cloud, zero cost.
 * Model auto-downloads on first run (~80MB), cached in .cache/
 */

import { EMBEDDING_MODEL } from './config.js';
import { logger } from '../logger.js';

// @xenova/transformers has complex union types that don't play nice with strict TS.
// Using `any` for the pipeline instance is the pragmatic choice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<boolean> {
  if (extractor) return true;

  if (initPromise) {
    await initPromise;
    return extractor !== null;
  }

  initPromise = (async () => {
    try {
      const { pipeline } = await import('@xenova/transformers');
      logger.info({ model: EMBEDDING_MODEL }, 'Loading local embedding model...');
      extractor = await pipeline('feature-extraction', EMBEDDING_MODEL);
      logger.info({ model: EMBEDDING_MODEL }, 'Local embedding model loaded');
    } catch (err) {
      logger.error({ err }, 'Failed to load local embedding model — memory will use keyword-only search');
      extractor = null;
    }
  })();

  await initPromise;
  return extractor !== null;
}

export class EmbeddingClient {
  private model: string;

  constructor() {
    this.model = EMBEDDING_MODEL;
    // Trigger initialization in background (non-blocking)
    ensureInitialized().catch(() => {});
  }

  get isAvailable(): boolean {
    // Always return true — model will be loaded when needed
    // The actual availability check happens in embed/embedBatch
    return true;
  }

  get modelName(): string {
    return this.model;
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[] | null> {
    const results = await this.embedBatch([text]);
    return results ? results[0] : null;
  }

  /**
   * Embed multiple texts in batches.
   * Returns Float32Arrays as number[] for JSON serialization compatibility.
   */
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    if (texts.length === 0) return [];

    const ready = await ensureInitialized();
    if (!ready || !extractor) return null;

    try {
      const allEmbeddings: number[][] = [];

      // Process in batches to avoid memory pressure
      for (let i = 0; i < texts.length; i += 8) {
        const batch = texts.slice(i, i + 8);
        const output = await extractor(batch, {
          pooling: 'mean',
          normalize: true,
        });

        // output.data is a flat Float32Array of shape [batch_size, 384]
        const dims = 384;
        for (let j = 0; j < batch.length; j++) {
          const start = j * dims;
          const end = start + dims;
          allEmbeddings.push(Array.from(output.data.slice(start, end)));
        }
      }

      return allEmbeddings;
    } catch (err) {
      logger.error({ err }, 'Local embedding failed');
      return null;
    }
  }
}
