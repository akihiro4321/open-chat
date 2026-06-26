import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchRagTool, getCurrentTimeTool } from '../src/agent/tools.js';
import type { RetrievedRagChunk } from '../src/rag/types.js';

function createChunk(overrides: Partial<RetrievedRagChunk> = {}): RetrievedRagChunk {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    sourcePath: '/docs/sample.md',
    sourceName: 'sample.md',
    sequence: 1,
    startOffset: 0,
    endOffset: 10,
    text: '参考資料本文',
    score: 0.1,
    ...overrides,
  };
}

void test('getCurrentTimeTool: 指定タイムゾーンで現在日時を返す', async () => {
  const result = await getCurrentTimeTool.execute({ timezone: 'Asia/Tokyo' });
  const parsed = JSON.parse(result) as { timezone: string; currentTime: string };

  assert.equal(parsed.timezone, 'Asia/Tokyo');
  assert.match(parsed.currentTime, /\d{4}\/\d{2}\/\d{2}/);
});

void test('getCurrentTimeTool: timezone省略時はAsia/Tokyoを使う', async () => {
  const result = await getCurrentTimeTool.execute({});
  const parsed = JSON.parse(result) as { timezone: string };

  assert.equal(parsed.timezone, 'Asia/Tokyo');
});

void test('createSearchRagTool: 取得したチャンクを整形して返す', async () => {
  const tool = createSearchRagTool({
    retrieveRag: () =>
      Promise.resolve([
        createChunk({ chunkId: 'chunk-1', text: 'Aの事実' }),
        createChunk({ chunkId: 'chunk-2', text: 'Bの事実', sourceName: 'b.md' }),
      ]),
    loadConfig: () => ({
      apiKey: 'k',
      embeddingModel: 'm',
      embeddingDimensions: null,
      lancedbDir: 'd',
      chunkStrategy: 'fixed' as const,
      chunkSize: 1200,
      chunkOverlap: 200,
      topK: 4,
      retrievalMode: 'hybrid' as const,
    }),
  });

  const result = await tool.execute({ question: '質問' });

  assert.match(result, /\[1\] sample\.md/);
  assert.match(result, /Aの事実/);
  assert.match(result, /\[2\] b\.md/);
  assert.match(result, /Bの事実/);
});

void test('createSearchRagTool: 検索結果0件のときその旨を返す', async () => {
  const tool = createSearchRagTool({
    retrieveRag: () => Promise.resolve([]),
    loadConfig: () => ({
      apiKey: 'k',
      embeddingModel: 'm',
      embeddingDimensions: null,
      lancedbDir: 'd',
      chunkStrategy: 'fixed' as const,
      chunkSize: 1200,
      chunkOverlap: 200,
      topK: 4,
      retrievalMode: 'hybrid' as const,
    }),
  });

  const result = await tool.execute({ question: '質問' });

  assert.equal(result, '該当する参考資料は見つかりませんでした。');
});
