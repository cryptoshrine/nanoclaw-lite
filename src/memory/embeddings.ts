/**
 * OpenAI embedding client (simplified)
 * Falls back to null when OPENAI_API_KEY is not set
 */

import { EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL } from './config.js';
import { logger } from '../logger.js';

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class EmbeddingClient {
  private apiKey: string | null;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || null;
    this.model = EMBEDDING_MODEL;

    if (!this.apiKey) {
      logger.warn(
        'OPENAI_API_KEY not set — memory search will use keyword-only mode',
      );
    }
  }

  get isAvailable(): boolean {
    return this.apiKey !== null;
  }

  get modelName(): string {
    return this.model;
  }

  /**
   * Embed a single text string.
   * Returns null if the API key is not configured.
   */
  async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;

    const results = await this.embedBatch([text]);
    return results ? results[0] : null;
  }

  /**
   * Embed multiple texts in batches.
   * Returns null if the API key is not configured.
   */
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    if (!this.apiKey) return null;
    if (texts.length === 0) return [];

    const allEmbeddings: number[][] = new Array(texts.length);

    // Process in batches
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const response = await this.callApi(batch);

      if (!response) {
        return null;
      }

      for (const item of response.data) {
        allEmbeddings[i + item.index] = item.embedding;
      }
    }

    return allEmbeddings;
  }

  private async callApi(
    texts: string[],
    retries = 3,
  ): Promise<EmbeddingResponse | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(
          'https://api.openai.com/v1/embeddings',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              input: texts,
              model: this.model,
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 429 && attempt < retries) {
            // Rate limited — back off
            const delay = 1000 * attempt;
            logger.warn(
              { attempt, delay },
              'Embedding API rate limited, retrying',
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          logger.error(
            { status: response.status, error: errorText },
            'Embedding API error',
          );
          return null;
        }

        return (await response.json()) as EmbeddingResponse;
      } catch (err) {
        if (attempt < retries) {
          const delay = 1000 * attempt;
          logger.warn({ attempt, delay, err }, 'Embedding API request failed, retrying');
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        logger.error({ err }, 'Embedding API request failed after retries');
        return null;
      }
    }

    return null;
  }
}
