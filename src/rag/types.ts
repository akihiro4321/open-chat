export type ChunkingStrategy = 'fixed' | 'markdown';

export interface SourceDocument {
  sourcePath: string;
  sourceName: string;
  content: string;
  contentHash: string;
}

export interface ChunkingOptions {
  chunkStrategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  ingestionRunId: string;
  sequence: number;
  startOffset: number;
  endOffset: number;
  text: string;
  textHash: string;
}

export interface PreparedDocument extends SourceDocument {
  id: string;
  chunks: DocumentChunk[];
}

export interface RagVectorRecord {
  vector: number[];
  chunkId: string;
  documentId: string;
  ingestionRunId: string;
  sequence: number;
  sourcePath: string;
  sourceName: string;
  startOffset: number;
  endOffset: number;
  text: string;
  contentHash: string;
  textHash: string;
}

export interface IngestDocumentsInput {
  apiKey: string;
  sourcePath: string;
  chunkStrategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingDimensions: number | null;
  lancedbDir: string;
}

export interface IngestDocumentsResult {
  ingestionRunId: string;
  tableName: string;
  documentCount: number;
  chunkCount: number;
  lancedbUri: string;
}

export interface RagSourceReference {
  chunkId: string;
  documentId: string;
  sourcePath: string;
  sourceName: string;
  sequence: number;
  startOffset: number;
  endOffset: number;
  score: number | null;
}

export interface RetrievedRagChunk extends RagSourceReference {
  text: string;
}
