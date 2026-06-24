import OpenAI from 'openai';

import { ApplicationError, classifyOpenAIError } from '@/src/errors.js';

const EMBEDDING_BATCH_SIZE = 64;

export interface EmbeddingConfig {
  apiKey: string;
  embeddingModel: string;
  embeddingDimensions: number | null;
}

function createClient(config: EmbeddingConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    logLevel: 'off',
    maxRetries: 0,
    timeout: 30_000,
  });
}

export async function createEmbeddings(
  config: EmbeddingConfig,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const client = createClient(config);
  const embeddings: number[][] = [];

  try {
    for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = inputs.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const response = await client.embeddings.create({
        model: config.embeddingModel,
        input: batch,
        encoding_format: 'float',
        ...(config.embeddingDimensions ? { dimensions: config.embeddingDimensions } : {}),
      });

      const batchEmbeddings = [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);

      if (batchEmbeddings.length !== batch.length) {
        throw new ApplicationError(
          'invalid_response',
          'OpenAIからチャンク数と一致する埋め込みを取得できませんでした。',
        );
      }

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  } catch (error: unknown) {
    throw classifyOpenAIError(error);
  }
}
