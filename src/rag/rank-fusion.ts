import type { RetrievedRagChunk } from './types.js';

const RRF_K = 60;

function cloneWithRank(input: {
  chunk: RetrievedRagChunk;
  keywordRank?: number | null;
  vectorRank?: number | null;
}): RetrievedRagChunk {
  return {
    ...input.chunk,
    keywordRank: input.keywordRank ?? input.chunk.keywordRank ?? null,
    keywordScore: input.chunk.keywordScore ?? null,
    vectorRank: input.vectorRank ?? input.chunk.vectorRank ?? null,
    vectorScore: input.chunk.vectorScore ?? null,
  };
}

export function fuseRetrievedChunks(input: {
  keywordChunks: RetrievedRagChunk[];
  limit: number;
  vectorChunks: RetrievedRagChunk[];
}): RetrievedRagChunk[] {
  const candidates = new Map<
    string,
    {
      chunk: RetrievedRagChunk;
      keywordRank: number | null;
      keywordScore: number | null;
      rrfScore: number;
      vectorRank: number | null;
      vectorScore: number | null;
    }
  >();

  input.vectorChunks.forEach((chunk, index) => {
    const rank = index + 1;
    candidates.set(chunk.chunkId, {
      chunk: cloneWithRank({ chunk, vectorRank: rank }),
      keywordRank: null,
      keywordScore: null,
      rrfScore: 1 / (RRF_K + rank),
      vectorRank: rank,
      vectorScore: chunk.score,
    });
  });

  input.keywordChunks.forEach((chunk, index) => {
    const rank = index + 1;
    const existing = candidates.get(chunk.chunkId);

    if (existing) {
      existing.keywordRank = rank;
      existing.keywordScore = chunk.score;
      existing.rrfScore += 1 / (RRF_K + rank);
      return;
    }

    candidates.set(chunk.chunkId, {
      chunk: cloneWithRank({ chunk, keywordRank: rank }),
      keywordRank: rank,
      keywordScore: chunk.score,
      rrfScore: 1 / (RRF_K + rank),
      vectorRank: null,
      vectorScore: null,
    });
  });

  return [...candidates.values()]
    .sort((left, right) => {
      if (right.rrfScore !== left.rrfScore) {
        return right.rrfScore - left.rrfScore;
      }

      const leftBestRank = Math.min(
        left.vectorRank ?? Number.POSITIVE_INFINITY,
        left.keywordRank ?? Number.POSITIVE_INFINITY,
      );
      const rightBestRank = Math.min(
        right.vectorRank ?? Number.POSITIVE_INFINITY,
        right.keywordRank ?? Number.POSITIVE_INFINITY,
      );

      return leftBestRank - rightBestRank;
    })
    .slice(0, input.limit)
    .map((candidate) => ({
      ...candidate.chunk,
      keywordRank: candidate.keywordRank,
      keywordScore: candidate.keywordScore,
      score: candidate.rrfScore,
      vectorRank: candidate.vectorRank,
      vectorScore: candidate.vectorScore,
    }));
}
