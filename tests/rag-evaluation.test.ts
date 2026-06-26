import assert from 'node:assert/strict';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  evaluateRagDataset,
  evaluateRagItem,
  loadRagEvaluationDataset,
} from '../src/rag/evaluation.js';
import type {
  RagEvaluationDataset,
  RagEvaluationItem,
  RetrievedRagChunk,
} from '../src/rag/types.js';

function createRetrievedChunk(input: {
  chunkId: string;
  documentId: string;
  text?: string;
}): RetrievedRagChunk {
  return {
    chunkId: input.chunkId,
    documentId: input.documentId,
    sourcePath: `/docs/${input.documentId}.md`,
    sourceName: `${input.documentId}.md`,
    sequence: 1,
    startOffset: 0,
    endOffset: 10,
    text: input.text ?? `text for ${input.chunkId}`,
    score: 0.1,
  };
}

function createDatasetItem(overrides: Partial<RagEvaluationItem> = {}): RagEvaluationItem {
  return {
    id: 'q-1',
    question: 'RAGの評価指標は？',
    expectedChunkIds: [],
    expectedDocumentIds: [],
    ...overrides,
  };
}

function createDataset(items: RagEvaluationItem[]): RagEvaluationDataset {
  return { items };
}

void test('loadRagEvaluationDataset: 正常なJSONを読み込んでデータセットを返す', async () => {
  const datasetPath = path.join(
    tmpdir(),
    `rag-eval-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  await writeFile(
    datasetPath,
    JSON.stringify({
      items: [
        {
          id: 'q-1',
          question: '質問1',
          expectedChunkIds: ['chunk-a'],
          expectedDocumentIds: [],
        },
      ],
    }),
    'utf8',
  );

  try {
    const dataset = await loadRagEvaluationDataset(datasetPath);

    assert.equal(dataset.items.length, 1);
    assert.equal(dataset.items[0]?.id, 'q-1');
    assert.equal(dataset.items[0]?.expectedChunkIds[0], 'chunk-a');
  } finally {
    await unlink(datasetPath);
  }
});

void test('loadRagEvaluationDataset: items が空のときエラーになる', async () => {
  const datasetPath = path.join(
    tmpdir(),
    `rag-eval-empty-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  await writeFile(datasetPath, JSON.stringify({ items: [] }), 'utf8');

  try {
    await assert.rejects(loadRagEvaluationDataset(datasetPath), /items/);
  } finally {
    await unlink(datasetPath);
  }
});

void test('loadRagEvaluationDataset: expectedChunkIds と expectedDocumentIds が両方空のときエラーになる', async () => {
  const datasetPath = path.join(
    tmpdir(),
    `rag-eval-noexp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  await writeFile(
    datasetPath,
    JSON.stringify({
      items: [
        {
          id: 'q-1',
          question: '質問1',
          expectedChunkIds: [],
          expectedDocumentIds: [],
        },
      ],
    }),
    'utf8',
  );

  try {
    await assert.rejects(
      loadRagEvaluationDataset(datasetPath),
      /expectedChunkIds または expectedDocumentIds/,
    );
  } finally {
    await unlink(datasetPath);
  }
});

void test('loadRagEvaluationDataset: 必須項目が欠けるとエラーになる', async () => {
  const datasetPath = path.join(
    tmpdir(),
    `rag-eval-missing-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  await writeFile(
    datasetPath,
    JSON.stringify({
      items: [
        {
          id: '',
          question: '質問1',
          expectedChunkIds: ['chunk-a'],
          expectedDocumentIds: [],
        },
      ],
    }),
    'utf8',
  );

  try {
    await assert.rejects(loadRagEvaluationDataset(datasetPath));
  } finally {
    await unlink(datasetPath);
  }
});

void test('loadRagEvaluationDataset: 存在しないファイルはエラーになる', async () => {
  const missingPath = path.join(
    tmpdir(),
    `rag-eval-missing-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  await assert.rejects(loadRagEvaluationDataset(missingPath), /ENOENT/);
});

void test('loadRagEvaluationDataset: JSON が壊れているとエラーになる', async () => {
  const datasetPath = path.join(
    tmpdir(),
    `rag-eval-broken-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  await writeFile(datasetPath, '{ items: [ }', 'utf8');

  try {
    await assert.rejects(loadRagEvaluationDataset(datasetPath));
  } finally {
    await unlink(datasetPath);
  }
});

void test('evaluateRagItem: 全件が上位にヒットすると Recall/MRR/nDCG が 1 になる', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1', 'c2'] });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c2', documentId: 'd1' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.equal(result.metrics.recallAtK, 1);
  assert.equal(result.metrics.mrr, 1);
  assert.equal(result.metrics.ndcg, 1);
  assert.equal(result.firstRelevantRank, 1);
  assert.deepEqual(result.matchedExpectedIds, ['chunk:c1', 'chunk:c2']);
});

void test('evaluateRagItem: 1件目の正解が無いと MRR は 0 になる', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1'] });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'other', documentId: 'd1' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.equal(result.metrics.recallAtK, 0);
  assert.equal(result.metrics.mrr, 0);
  assert.equal(result.metrics.ndcg, 0);
  assert.equal(result.firstRelevantRank, null);
});

void test('evaluateRagItem: 2件目に正解があると MRR は 0.5 になる', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1'] });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'other', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.equal(result.firstRelevantRank, 2);
  assert.equal(result.metrics.mrr, 0.5);
});

void test('evaluateRagItem: retrievedChunks が空のとき全指標が 0 になる', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1'] });

  const result = evaluateRagItem({ item, retrievedChunks: [] });

  assert.equal(result.metrics.recallAtK, 0);
  assert.equal(result.metrics.mrr, 0);
  assert.equal(result.metrics.ndcg, 0);
  assert.equal(result.firstRelevantRank, null);
});

void test('evaluateRagItem: expectedChunkIds を優先してマッチ判定する', () => {
  const item = createDatasetItem({
    expectedChunkIds: ['c1'],
    expectedDocumentIds: ['d1'],
  });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.deepEqual(result.expectedIds, ['chunk:c1']);
});

void test('evaluateRagItem: expectedChunkIds が空なら expectedDocumentIds で判定する', () => {
  const item = createDatasetItem({
    expectedChunkIds: [],
    expectedDocumentIds: ['d1', 'd2'],
  });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c2', documentId: 'other' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.deepEqual(result.expectedIds, ['document:d1', 'document:d2']);
  assert.equal(result.metrics.recallAtK, 0.5);
  assert.equal(result.firstRelevantRank, 1);
});

void test('evaluateRagItem: 重複する expectedChunkIds は1件としてカウントする', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1', 'c1', 'c2'] });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c2', documentId: 'd1' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.deepEqual(result.expectedIds, ['chunk:c1', 'chunk:c2']);
  assert.equal(result.metrics.recallAtK, 1);
});

void test('evaluateRagItem: nDCG は順序を考慮する', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1', 'c2'] });
  const goodOrder: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c2', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c3', documentId: 'd1' }),
  ];
  const badOrder: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c3', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c2', documentId: 'd1' }),
  ];

  const goodResult = evaluateRagItem({ item, retrievedChunks: goodOrder });
  const badResult = evaluateRagItem({ item, retrievedChunks: badOrder });

  assert.ok(goodResult.metrics.ndcg > badResult.metrics.ndcg);
  assert.ok(badResult.metrics.ndcg > 0);
  assert.ok(badResult.metrics.ndcg < 1);
});

void test('evaluateRagItem: 同じ chunkId が複数回登場しても matched に重複しない', () => {
  const item = createDatasetItem({ expectedChunkIds: ['c1'] });
  const retrieved: RetrievedRagChunk[] = [
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
    createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' }),
  ];

  const result = evaluateRagItem({ item, retrievedChunks: retrieved });

  assert.deepEqual(result.matchedExpectedIds, ['chunk:c1']);
  assert.equal(result.metrics.recallAtK, 1);
});

void test('evaluateRagDataset: 各項目を評価して平均メトリクスを返す', async () => {
  const dataset = createDataset([
    createDatasetItem({ id: 'q-1', expectedChunkIds: ['c1'] }),
    createDatasetItem({ id: 'q-2', expectedChunkIds: ['c2'] }),
  ]);

  const result = await evaluateRagDataset({
    dataset,
    retrieve: (item) => {
      if (item.id === 'q-1') {
        return Promise.resolve([createRetrievedChunk({ chunkId: 'c1', documentId: 'd1' })]);
      }

      return Promise.resolve([
        createRetrievedChunk({ chunkId: 'other', documentId: 'd1' }),
        createRetrievedChunk({ chunkId: 'c2', documentId: 'd1' }),
      ]);
    },
  });

  assert.equal(result.itemCount, 2);
  assert.equal(result.metrics.recallAtK, 1);
  assert.equal(result.metrics.mrr, (1 + 0.5) / 2);
  assert.equal(result.items.length, 2);
});

void test('evaluateRagDataset: retrieve 関数が各項目の question で順番に呼ばれる', async () => {
  const dataset = createDataset([
    createDatasetItem({ id: 'q-1', question: 'Q1', expectedChunkIds: ['c1'] }),
    createDatasetItem({ id: 'q-2', question: 'Q2', expectedChunkIds: ['c2'] }),
  ]);
  const calls: string[] = [];

  await evaluateRagDataset({
    dataset,
    retrieve: (item) => {
      calls.push(item.question);
      return Promise.resolve([createRetrievedChunk({ chunkId: `c-${item.id}`, documentId: 'd1' })]);
    },
  });

  assert.deepEqual(calls, ['Q1', 'Q2']);
});
