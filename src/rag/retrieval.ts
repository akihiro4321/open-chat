import * as lancedb from '@lancedb/lancedb';

import { prisma } from '@/src/database.js';
import { ApplicationError } from '@/src/errors.js';

import { ACTIVE_RAG_INDEX_ID } from './constants.js';
import { createEmbeddings, type EmbeddingConfig } from './embeddings.js';
import { searchKeywordChunks } from './keyword-search.js';
import { fuseRetrievedChunks } from './rank-fusion.js';
import type { RetrievalMode, RetrievedRagChunk } from './types.js';

export interface RetrieveRagContextInput extends EmbeddingConfig {
  lancedbDir: string;
  question: string;
  retrievalMode: RetrievalMode;
  topK: number;
}

interface LanceDbSearchRow {
  chunkId?: unknown;
  documentId?: unknown;
  sourcePath?: unknown;
  sourceName?: unknown;
  sequence?: unknown;
  startOffset?: unknown;
  endOffset?: unknown;
  text?: unknown;
  _distance?: unknown;
}

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ApplicationError('invalid_response', `RAG検索結果の ${fieldName} が不正です。`);
  }

  return value;
}

function assertNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('invalid_response', `RAG検索結果の ${fieldName} が不正です。`);
  }

  return value;
}

function toRetrievedChunk(row: LanceDbSearchRow, rank: number): RetrievedRagChunk {
  const score = typeof row._distance === 'number' ? row._distance : null;

  return {
    chunkId: assertString(row.chunkId, 'chunkId'),
    documentId: assertString(row.documentId, 'documentId'),
    sourcePath: assertString(row.sourcePath, 'sourcePath'),
    sourceName: assertString(row.sourceName, 'sourceName'),
    sequence: assertNumber(row.sequence, 'sequence'),
    startOffset: assertNumber(row.startOffset, 'startOffset'),
    endOffset: assertNumber(row.endOffset, 'endOffset'),
    text: assertString(row.text, 'text'),
    score,
    vectorRank: rank,
    vectorScore: score,
  };
}

async function findActiveIngestionRun() {
  const activeIndex = await prisma.activeRagIndex.findUnique({
    where: { id: ACTIVE_RAG_INDEX_ID },
    include: { ingestionRun: true },
  });

  if (!activeIndex || activeIndex.ingestionRun.status !== 'completed') {
    throw new ApplicationError(
      'invalid_request',
      'RAG索引がまだありません。先に npm run rag:ingest -- --path "取込対象パス" を実行してください。',
    );
  }

  return activeIndex.ingestionRun;
}

async function retrieveVectorChunks(input: {
  embeddingConfig: EmbeddingConfig;
  lancedbDir: string;
  limit: number;
  question: string;
  tableName: string;
}): Promise<RetrievedRagChunk[]> {
  const [queryVector] = await createEmbeddings(input.embeddingConfig, [input.question]);

  if (!queryVector) {
    throw new ApplicationError('invalid_response', '質問の埋め込みを作成できませんでした。');
  }

  const database = await lancedb.connect(input.lancedbDir);
  const table = await database.openTable(input.tableName);
  const rows = (await table
    .vectorSearch(queryVector)
    .limit(input.limit)
    .select([
      'chunkId',
      'documentId',
      'sourcePath',
      'sourceName',
      'sequence',
      'startOffset',
      'endOffset',
      'text',
      '_distance',
    ])
    .toArray()) as LanceDbSearchRow[];

  return rows.map((row, index) => toRetrievedChunk(row, index + 1));
}

async function retrieveKeywordChunks(input: {
  ingestionRunId: string;
  limit: number;
  question: string;
}): Promise<RetrievedRagChunk[]> {
  const chunks = await prisma.ragChunk.findMany({
    where: { ingestionRunId: input.ingestionRunId },
    include: { document: true },
    orderBy: [{ documentId: 'asc' }, { sequence: 'asc' }],
  });

  return searchKeywordChunks({
    chunks,
    limit: input.limit,
    question: input.question,
  }).map((chunk, index) => ({
    ...chunk,
    keywordRank: index + 1,
  }));
}

export async function retrieveRagContext(
  input: RetrieveRagContextInput,
): Promise<RetrievedRagChunk[]> {
  const ingestionRun = await findActiveIngestionRun();
  const candidateLimit = input.retrievalMode === 'hybrid' ? input.topK * 2 : input.topK;

  if (input.retrievalMode === 'keyword') {
    return retrieveKeywordChunks({
      ingestionRunId: ingestionRun.id,
      limit: input.topK,
      question: input.question,
    });
  }

  const vectorChunks = await retrieveVectorChunks({
    embeddingConfig: input,
    lancedbDir: input.lancedbDir,
    limit: candidateLimit,
    question: input.question,
    tableName: ingestionRun.tableName,
  });

  if (input.retrievalMode === 'vector') {
    return vectorChunks.slice(0, input.topK);
  }

  const keywordChunks = await retrieveKeywordChunks({
    ingestionRunId: ingestionRun.id,
    limit: candidateLimit,
    question: input.question,
  });

  return fuseRetrievedChunks({
    keywordChunks,
    limit: input.topK,
    vectorChunks,
  });
}
