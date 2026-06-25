import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { prisma } from '@/src/database.js';

import { splitDocumentIntoChunks } from './chunker.js';
import { ACTIVE_RAG_INDEX_ID } from './constants.js';
import { createEmbeddings } from './embeddings.js';
import { loadSourceDocuments } from './file-loader.js';
import type {
  IngestDocumentsInput,
  IngestDocumentsResult,
  PreparedDocument,
  RagVectorRecord,
} from './types.js';
import { writeVectorTable } from './vector-store.js';

function createTableName(ingestionRunId: string): string {
  return `rag_${ingestionRunId.replaceAll('-', '_')}`;
}

function prepareVectorRecords(
  documents: PreparedDocument[],
  embeddings: number[][],
): RagVectorRecord[] {
  const chunks = documents.flatMap((document) =>
    document.chunks.map((chunk) => ({ chunk, document })),
  );

  return chunks.map(({ chunk, document }, index) => ({
    vector: embeddings[index] ?? [],
    chunkId: chunk.id,
    documentId: document.id,
    ingestionRunId: chunk.ingestionRunId,
    sequence: chunk.sequence,
    sourcePath: document.sourcePath,
    sourceName: document.sourceName,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    text: chunk.text,
    contentHash: document.contentHash,
    textHash: chunk.textHash,
  }));
}

export async function ingestDocuments(input: IngestDocumentsInput): Promise<IngestDocumentsResult> {
  const ingestionRunId = randomUUID();
  const tableName = createTableName(ingestionRunId);
  const resolvedSourcePath = path.resolve(input.sourcePath);

  await prisma.ragIngestionRun.create({
    data: {
      id: ingestionRunId,
      status: 'running',
      sourcePath: resolvedSourcePath,
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
      embeddingModel: input.embeddingModel,
      embeddingDimensions: input.embeddingDimensions,
      lancedbUri: path.resolve(input.lancedbDir),
      tableName,
    },
  });

  try {
    const sourceDocuments = await loadSourceDocuments(resolvedSourcePath);

    if (sourceDocuments.length === 0) {
      throw new Error('.md または .txt の取込対象文書が見つかりませんでした。');
    }

    const documents = sourceDocuments.map((document) => {
      const documentId = randomUUID();

      return {
        ...document,
        id: documentId,
        chunks: splitDocumentIntoChunks(document, documentId, ingestionRunId, {
          chunkSize: input.chunkSize,
          chunkOverlap: input.chunkOverlap,
        }),
      };
    });
    const chunks = documents.flatMap((document) => document.chunks);

    if (chunks.length === 0) {
      throw new Error('取込対象文書からチャンクを作成できませんでした。');
    }

    const embeddings = await createEmbeddings(
      input,
      chunks.map((chunk) => chunk.text),
    );
    const records = prepareVectorRecords(documents, embeddings);
    const vectorStore = await writeVectorTable(input.lancedbDir, tableName, records);

    await prisma.$transaction(async (transaction) => {
      await transaction.ragDocument.createMany({
        data: documents.map((document) => ({
          id: document.id,
          ingestionRunId,
          sourcePath: document.sourcePath,
          sourceName: document.sourceName,
          contentHash: document.contentHash,
          contentLength: document.content.length,
        })),
      });
      await transaction.ragChunk.createMany({
        data: chunks.map((chunk) => ({
          id: chunk.id,
          ingestionRunId: chunk.ingestionRunId,
          documentId: chunk.documentId,
          sequence: chunk.sequence,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          text: chunk.text,
          textHash: chunk.textHash,
        })),
      });
      await transaction.ragIngestionRun.update({
        where: { id: ingestionRunId },
        data: {
          status: 'completed',
          documentCount: documents.length,
          chunkCount: chunks.length,
          lancedbUri: vectorStore.lancedbUri,
          completedAt: new Date(),
        },
      });
      await transaction.activeRagIndex.upsert({
        where: { id: ACTIVE_RAG_INDEX_ID },
        create: {
          id: ACTIVE_RAG_INDEX_ID,
          ingestionRunId,
        },
        update: {
          ingestionRunId,
          activatedAt: new Date(),
        },
      });
    });

    return {
      ingestionRunId,
      tableName,
      documentCount: documents.length,
      chunkCount: chunks.length,
      lancedbUri: vectorStore.lancedbUri,
    };
  } catch (error: unknown) {
    await prisma.ragIngestionRun.update({
      where: { id: ingestionRunId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : '不明なエラー',
        completedAt: new Date(),
      },
    });

    throw error;
  }
}
