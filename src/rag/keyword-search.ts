import type { Prisma } from '@/generated/prisma/client.js';

import type { RetrievedRagChunk } from './types.js';

type KeywordSearchChunk = Prisma.RagChunkGetPayload<{
  include: { document: true };
}>;

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const TOKEN_PATTERN = /[a-z0-9_]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

function toCjkBigrams(value: string): string[] {
  const characters = [...value];

  if (characters.length <= 1) {
    return characters;
  }

  const bigrams = [];

  for (let index = 0; index < characters.length - 1; index += 1) {
    bigrams.push(`${characters[index]}${characters[index + 1]}`);
  }

  return bigrams;
}

export function tokenizeForKeywordSearch(text: string): string[] {
  const normalized = normalizeText(text);
  const matches = normalized.match(TOKEN_PATTERN) ?? [];

  return matches.flatMap((match) => {
    if (!CJK_PATTERN.test(match)) {
      return match.length >= 2 ? [match] : [];
    }

    const tokens = toCjkBigrams(match);
    return match.length <= 12 ? [match, ...tokens] : tokens;
  });
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
}

function scoreChunk(input: {
  averageLength: number;
  documentCount: number;
  documentFrequency: Map<string, number>;
  queryTerms: string[];
  termCounts: Map<string, number>;
  tokenCount: number;
}): number {
  if (input.tokenCount === 0) {
    return 0;
  }

  return input.queryTerms.reduce((score, term) => {
    const termFrequency = input.termCounts.get(term) ?? 0;

    if (termFrequency === 0) {
      return score;
    }

    const documentFrequency = input.documentFrequency.get(term) ?? 0;
    const inverseDocumentFrequency = Math.log(
      1 + (input.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );
    const denominator =
      termFrequency + BM25_K1 * (1 - BM25_B + BM25_B * (input.tokenCount / input.averageLength));

    return score + inverseDocumentFrequency * ((termFrequency * (BM25_K1 + 1)) / denominator);
  }, 0);
}

function toRetrievedRagChunk(chunk: KeywordSearchChunk, score: number): RetrievedRagChunk {
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    sourcePath: chunk.document.sourcePath,
    sourceName: chunk.document.sourceName,
    sequence: chunk.sequence,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    text: chunk.text,
    score,
    keywordScore: score,
  };
}

export function searchKeywordChunks(input: {
  chunks: KeywordSearchChunk[];
  limit: number;
  question: string;
}): RetrievedRagChunk[] {
  const queryTerms = [...new Set(tokenizeForKeywordSearch(input.question))];

  if (queryTerms.length === 0 || input.chunks.length === 0) {
    return [];
  }

  const preparedChunks = input.chunks.map((chunk) => {
    const tokens = tokenizeForKeywordSearch(chunk.text);
    return {
      chunk,
      termCounts: countTerms(tokens),
      tokenCount: tokens.length,
    };
  });
  const averageLength =
    preparedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / preparedChunks.length || 1;
  const documentFrequency = new Map<string, number>();

  for (const preparedChunk of preparedChunks) {
    for (const term of new Set(preparedChunk.termCounts.keys())) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const normalizedQuestion = normalizeText(input.question);

  return preparedChunks
    .map((preparedChunk) => {
      const bm25Score = scoreChunk({
        averageLength,
        documentCount: preparedChunks.length,
        documentFrequency,
        queryTerms,
        termCounts: preparedChunk.termCounts,
        tokenCount: preparedChunk.tokenCount,
      });
      const exactPhraseBonus = normalizeText(preparedChunk.chunk.text).includes(normalizedQuestion)
        ? 1
        : 0;

      return {
        chunk: preparedChunk.chunk,
        score: bm25Score + exactPhraseBonus,
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit)
    .map((result) => toRetrievedRagChunk(result.chunk, result.score));
}
