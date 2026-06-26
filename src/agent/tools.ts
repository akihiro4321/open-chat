import { z } from 'zod';

import { loadRagConfig } from '../config.js';
import { type RetrievedRagChunk, retrieveRagContext } from '../rag/index.js';
import type { ToolDefinition } from './types.js';

const getCurrentTimeSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('IANAタイムゾーン識別子。省略時はAsia/Tokyo。'),
});

type GetCurrentTimeInput = z.infer<typeof getCurrentTimeSchema>;

export const getCurrentTimeTool: ToolDefinition<typeof getCurrentTimeSchema> = {
  name: 'getCurrentTime',
  description:
    '現在の日時を指定タイムゾーンで返す。学習・テスト用途。副作用を持たないため並列実行可能。',
  schema: getCurrentTimeSchema,
  execute: (input) => {
    const timezone = input.timezone ?? 'Asia/Tokyo';
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('ja-JP', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    return Promise.resolve(JSON.stringify({ timezone, currentTime: formatted }));
  },
};

const searchRagSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .describe('ローカル文書から参照情報を探すための日本語の質問'),
});

export type SearchRagInput = z.infer<typeof searchRagSchema>;

export interface SearchRagToolDeps {
  retrieveRag: typeof retrieveRagContext;
  loadConfig: typeof loadRagConfig;
}

const defaultSearchRagDeps: SearchRagToolDeps = {
  retrieveRag: retrieveRagContext,
  loadConfig: loadRagConfig,
};

function formatChunks(chunks: RetrievedRagChunk[]): string {
  if (chunks.length === 0) {
    return '該当する参考資料は見つかりませんでした。';
  }

  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.sourceName} (${chunk.sourcePath} ${chunk.startOffset}-${chunk.endOffset})\n${chunk.text}`,
    )
    .join('\n\n---\n\n');
}

export function createSearchRagTool(
  deps: SearchRagToolDeps = defaultSearchRagDeps,
): ToolDefinition<typeof searchRagSchema> {
  return {
    name: 'searchRag',
    description:
      'ローカルRAG索引から質問に関連する参考資料を検索する。回答に必要な根拠を探すために使う。副作用なし。',
    schema: searchRagSchema,
    execute: async (input) => {
      const config = deps.loadConfig();
      const chunks = await deps.retrieveRag({
        apiKey: config.apiKey,
        embeddingModel: config.embeddingModel,
        embeddingDimensions: config.embeddingDimensions,
        lancedbDir: config.lancedbDir,
        question: input.question,
        retrievalMode: config.retrievalMode,
        topK: config.topK,
      });

      return formatChunks(chunks);
    },
  };
}

export const defaultTools: ReadonlyArray<ToolDefinition> = [
  getCurrentTimeTool,
  createSearchRagTool(),
];

export { getCurrentTimeSchema, searchRagSchema };
export type { GetCurrentTimeInput };
