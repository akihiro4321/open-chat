import assert from 'node:assert/strict';
import test from 'node:test';

import { searchKeywordChunks, tokenizeForKeywordSearch } from '../src/rag/keyword-search.js';
import { fuseRetrievedChunks } from '../src/rag/rank-fusion.js';
import type { RetrievedRagChunk } from '../src/rag/types.js';

type SearchChunk = Parameters<typeof searchKeywordChunks>[0]['chunks'][number];

const now = new Date('2026-01-01T00:00:00.000Z');

function createSearchChunk(input: {
  id: string;
  sequence: number;
  sourceName: string;
  text: string;
}): SearchChunk {
  return {
    id: input.id,
    ingestionRunId: 'run-1',
    documentId: `document-${input.id}`,
    sequence: input.sequence,
    startOffset: 0,
    endOffset: input.text.length,
    text: input.text,
    textHash: `hash-${input.id}`,
    createdAt: now,
    document: {
      id: `document-${input.id}`,
      ingestionRunId: 'run-1',
      sourcePath: `/docs/${input.sourceName}`,
      sourceName: input.sourceName,
      contentHash: `content-${input.id}`,
      contentLength: input.text.length,
      createdAt: now,
    },
  };
}

function createRetrievedChunk(input: {
  chunkId: string;
  score: number;
  sourceName?: string;
}): RetrievedRagChunk {
  return {
    chunkId: input.chunkId,
    documentId: `document-${input.chunkId}`,
    sourcePath: `/docs/${input.sourceName ?? input.chunkId}.md`,
    sourceName: input.sourceName ?? `${input.chunkId}.md`,
    sequence: 1,
    startOffset: 0,
    endOffset: 10,
    text: `chunk ${input.chunkId}`,
    score: input.score,
  };
}

void test('日本語キーワード検索用にCJK文字列を分割する', () => {
  const tokens = tokenizeForKeywordSearch('OpenAIのRAG検索');

  assert(tokens.includes('openai'));
  assert(tokens.includes('rag'));
  assert(tokens.includes('検索'));
});

void test('キーワード検索は一致するチャンクを上位に返す', () => {
  const results = searchKeywordChunks({
    chunks: [
      createSearchChunk({
        id: '1',
        sequence: 1,
        sourceName: 'rag.md',
        text: 'Open ChatではRAG検索で参考資料を取得します。',
      }),
      createSearchChunk({
        id: '2',
        sequence: 2,
        sourceName: 'agent.md',
        text: 'Function Callingでツールを呼び出します。',
      }),
    ],
    limit: 1,
    question: 'RAG検索',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.chunkId, '1');
  assert.equal(results[0]?.keywordScore, results[0]?.score);
});

void test('RRFは複数方式でヒットしたチャンクを上位に統合する', () => {
  const results = fuseRetrievedChunks({
    vectorChunks: [createRetrievedChunk({ chunkId: 'a', score: 0.1 })],
    keywordChunks: [
      createRetrievedChunk({ chunkId: 'b', score: 10 }),
      createRetrievedChunk({ chunkId: 'a', score: 8 }),
    ],
    limit: 2,
  });

  assert.equal(results[0]?.chunkId, 'a');
  assert.equal(results[0]?.vectorRank, 1);
  assert.equal(results[0]?.keywordRank, 2);
  assert.equal(results[1]?.chunkId, 'b');
  assert.equal(results[1]?.vectorRank, null);
  assert.equal(results[1]?.keywordRank, 1);
});
