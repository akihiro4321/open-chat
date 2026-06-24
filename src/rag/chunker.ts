import { createHash, randomUUID } from 'node:crypto';

import type { ChunkingOptions, DocumentChunk, SourceDocument } from './types.js';

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function splitDocumentIntoChunks(
  document: SourceDocument,
  documentId: string,
  ingestionRunId: string,
  options: ChunkingOptions,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let startOffset = 0;
  let sequence = 0;

  while (startOffset < document.content.length) {
    const endOffset = Math.min(startOffset + options.chunkSize, document.content.length);
    const text = document.content.slice(startOffset, endOffset).trim();

    if (text) {
      chunks.push({
        id: randomUUID(),
        documentId,
        ingestionRunId,
        sequence,
        startOffset,
        endOffset,
        text,
        textHash: hashText(text),
      });
      sequence += 1;
    }

    if (endOffset === document.content.length) {
      break;
    }

    startOffset = endOffset - options.chunkOverlap;
  }

  return chunks;
}
