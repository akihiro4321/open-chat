import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type {
  RagEvaluationDataset,
  RagEvaluationItem,
  RagEvaluationItemResult,
  RagEvaluationMetrics,
  RagEvaluationResult,
  RetrievedRagChunk,
} from './types.js';

const evaluationItemSchema = z
  .object({
    id: z.string().trim().min(1),
    question: z.string().trim().min(1),
    expectedChunkIds: z.array(z.string().trim().min(1)).default([]),
    expectedDocumentIds: z.array(z.string().trim().min(1)).default([]),
  })
  .superRefine((item, context) => {
    if (item.expectedChunkIds.length === 0 && item.expectedDocumentIds.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'expectedChunkIds または expectedDocumentIds を1件以上指定してください。',
      });
    }
  });

const evaluationDatasetSchema = z.object({
  items: z.array(evaluationItemSchema).min(1),
});

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function toExpectedIds(item: RagEvaluationItem): string[] {
  if (item.expectedChunkIds.length > 0) {
    return uniqueValues(item.expectedChunkIds.map((chunkId) => `chunk:${chunkId}`));
  }

  return uniqueValues(item.expectedDocumentIds.map((documentId) => `document:${documentId}`));
}

function toMatchedExpectedIds(chunk: RetrievedRagChunk, expectedIds: Set<string>): string[] {
  const matchedIds = [];
  const chunkExpectedId = `chunk:${chunk.chunkId}`;
  const documentExpectedId = `document:${chunk.documentId}`;

  if (expectedIds.has(chunkExpectedId)) {
    matchedIds.push(chunkExpectedId);
  }

  if (expectedIds.has(documentExpectedId)) {
    matchedIds.push(documentExpectedId);
  }

  return matchedIds;
}

function calculateDcg(relevanceByRank: number[]): number {
  return relevanceByRank.reduce((score, relevance, index) => {
    if (relevance === 0) {
      return score;
    }

    return score + relevance / Math.log2(index + 2);
  }, 0);
}

function calculateNdcg(input: { expectedCount: number; relevanceByRank: number[] }): number {
  if (input.expectedCount === 0 || input.relevanceByRank.length === 0) {
    return 0;
  }

  const idealRelevanceByRank = Array.from(
    { length: Math.min(input.expectedCount, input.relevanceByRank.length) },
    () => 1,
  );
  const idealDcg = calculateDcg(idealRelevanceByRank);

  if (idealDcg === 0) {
    return 0;
  }

  return calculateDcg(input.relevanceByRank) / idealDcg;
}

function averageMetrics(results: RagEvaluationItemResult[]): RagEvaluationMetrics {
  if (results.length === 0) {
    return {
      recallAtK: 0,
      mrr: 0,
      ndcg: 0,
    };
  }

  const totals = results.reduce(
    (metrics, result) => ({
      recallAtK: metrics.recallAtK + result.metrics.recallAtK,
      mrr: metrics.mrr + result.metrics.mrr,
      ndcg: metrics.ndcg + result.metrics.ndcg,
    }),
    {
      recallAtK: 0,
      mrr: 0,
      ndcg: 0,
    },
  );

  return {
    recallAtK: totals.recallAtK / results.length,
    mrr: totals.mrr / results.length,
    ndcg: totals.ndcg / results.length,
  };
}

export async function loadRagEvaluationDataset(datasetPath: string): Promise<RagEvaluationDataset> {
  const content = await readFile(datasetPath, 'utf8');
  const parsedJson = JSON.parse(content) as unknown;

  return evaluationDatasetSchema.parse(parsedJson);
}

export function evaluateRagItem(input: {
  item: RagEvaluationItem;
  retrievedChunks: RetrievedRagChunk[];
}): RagEvaluationItemResult {
  const expectedIds = toExpectedIds(input.item);
  const expectedIdSet = new Set(expectedIds);
  const matchedExpectedIds = new Set<string>();
  const relevanceByRank: number[] = [];
  let firstRelevantRank: number | null = null;

  input.retrievedChunks.forEach((chunk, index) => {
    const newlyMatchedIds = toMatchedExpectedIds(chunk, expectedIdSet).filter(
      (expectedId) => !matchedExpectedIds.has(expectedId),
    );

    if (newlyMatchedIds.length > 0 && firstRelevantRank === null) {
      firstRelevantRank = index + 1;
    }

    for (const matchedId of newlyMatchedIds) {
      matchedExpectedIds.add(matchedId);
    }

    relevanceByRank.push(newlyMatchedIds.length > 0 ? 1 : 0);
  });

  return {
    id: input.item.id,
    question: input.item.question,
    expectedIds,
    matchedExpectedIds: [...matchedExpectedIds],
    retrievedChunkIds: input.retrievedChunks.map((chunk) => chunk.chunkId),
    retrievedDocumentIds: input.retrievedChunks.map((chunk) => chunk.documentId),
    firstRelevantRank,
    metrics: {
      recallAtK: matchedExpectedIds.size / expectedIds.length,
      mrr: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
      ndcg: calculateNdcg({
        expectedCount: expectedIds.length,
        relevanceByRank,
      }),
    },
  };
}

export async function evaluateRagDataset(input: {
  dataset: RagEvaluationDataset;
  retrieve: (item: RagEvaluationItem) => Promise<RetrievedRagChunk[]>;
}): Promise<RagEvaluationResult> {
  const items = [];

  for (const item of input.dataset.items) {
    const retrievedChunks = await input.retrieve(item);
    items.push(evaluateRagItem({ item, retrievedChunks }));
  }

  return {
    itemCount: items.length,
    metrics: averageMetrics(items),
    items,
  };
}
