import { createHash, randomUUID } from 'node:crypto';

import type { ChunkingOptions, DocumentChunk, SourceDocument } from './types.js';

const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+.+$/gm;

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function createChunk(
  document: SourceDocument,
  documentId: string,
  ingestionRunId: string,
  sequence: number,
  startOffset: number,
  endOffset: number,
): DocumentChunk | null {
  const text = document.content.slice(startOffset, endOffset).trim();

  if (!text) {
    return null;
  }

  return {
    id: randomUUID(),
    documentId,
    ingestionRunId,
    sequence,
    startOffset,
    endOffset,
    text,
    textHash: hashText(text),
  };
}

function splitRangeIntoFixedChunks(
  document: SourceDocument,
  documentId: string,
  ingestionRunId: string,
  options: ChunkingOptions,
  startOffset: number,
  endOffset: number,
  initialSequence: number,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let currentStartOffset = startOffset;
  let sequence = initialSequence;

  while (currentStartOffset < endOffset) {
    const currentEndOffset = Math.min(currentStartOffset + options.chunkSize, endOffset);
    const chunk = createChunk(
      document,
      documentId,
      ingestionRunId,
      sequence,
      currentStartOffset,
      currentEndOffset,
    );

    if (chunk) {
      chunks.push(chunk);
      sequence += 1;
    }

    if (currentEndOffset === endOffset) {
      break;
    }

    currentStartOffset = currentEndOffset - options.chunkOverlap;
  }

  return chunks;
}

function findMarkdownSectionStartOffsets(content: string): number[] {
  const headingStarts = [...content.matchAll(MARKDOWN_HEADING_PATTERN)].map((match) => match.index);

  if (headingStarts.length === 0) {
    return [];
  }

  return headingStarts[0] === 0 ? headingStarts : [0, ...headingStarts];
}

function splitDocumentIntoMarkdownChunks(
  document: SourceDocument,
  documentId: string,
  ingestionRunId: string,
  options: ChunkingOptions,
): DocumentChunk[] {
  const sectionStarts = findMarkdownSectionStartOffsets(document.content);

  if (sectionStarts.length === 0) {
    return splitRangeIntoFixedChunks(
      document,
      documentId,
      ingestionRunId,
      options,
      0,
      document.content.length,
      0,
    );
  }

  const chunks: DocumentChunk[] = [];
  let sequence = 0;

  for (const [index, sectionStart] of sectionStarts.entries()) {
    const sectionEnd = sectionStarts[index + 1] ?? document.content.length;
    const sectionChunks = splitRangeIntoFixedChunks(
      document,
      documentId,
      ingestionRunId,
      options,
      sectionStart,
      sectionEnd,
      sequence,
    );
    chunks.push(...sectionChunks);
    sequence += sectionChunks.length;
  }

  return chunks;
}

export function splitDocumentIntoChunks(
  document: SourceDocument,
  documentId: string,
  ingestionRunId: string,
  options: ChunkingOptions,
): DocumentChunk[] {
  if (options.chunkStrategy === 'markdown') {
    return splitDocumentIntoMarkdownChunks(document, documentId, ingestionRunId, options);
  }

  return splitRangeIntoFixedChunks(
    document,
    documentId,
    ingestionRunId,
    options,
    0,
    document.content.length,
    0,
  );
}
