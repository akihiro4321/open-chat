import * as lancedb from '@lancedb/lancedb';

import { prisma } from '@/src/database.js';
import { ApplicationError } from '@/src/errors.js';

import { ACTIVE_RAG_INDEX_ID } from './constants.js';
import { createEmbeddings, type EmbeddingConfig } from './embeddings.js';
import type { RetrievedRagChunk } from './types.js';

export interface RetrieveRagContextInput extends EmbeddingConfig {
  lancedbDir: string;
  question: string;
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

function toRetrievedChunk(row: LanceDbSearchRow): RetrievedRagChunk {
  return {
    chunkId: assertString(row.chunkId, 'chunkId'),
    documentId: assertString(row.documentId, 'documentId'),
    sourcePath: assertString(row.sourcePath, 'sourcePath'),
    sourceName: assertString(row.sourceName, 'sourceName'),
    sequence: assertNumber(row.sequence, 'sequence'),
    startOffset: assertNumber(row.startOffset, 'startOffset'),
    endOffset: assertNumber(row.endOffset, 'endOffset'),
    text: assertString(row.text, 'text'),
    score: typeof row._distance === 'number' ? row._distance : null,
  };
}

export async function retrieveRagContext(
  input: RetrieveRagContextInput,
): Promise<RetrievedRagChunk[]> {
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

  const [queryVector] = await createEmbeddings(input, [input.question]);

  if (!queryVector) {
    throw new ApplicationError('invalid_response', '質問の埋め込みを作成できませんでした。');
  }

  const database = await lancedb.connect(input.lancedbDir);
  const table = await database.openTable(activeIndex.ingestionRun.tableName);
  const rows = (await table
    .vectorSearch(queryVector)
    .limit(input.topK)
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

  return rows.map(toRetrievedChunk);
}
