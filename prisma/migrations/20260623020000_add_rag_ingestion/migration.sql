-- CreateTable
CREATE TABLE "RagIngestionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "chunkSize" INTEGER NOT NULL,
    "chunkOverlap" INTEGER NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDimensions" INTEGER,
    "lancedbUri" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "RagDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingestionRunId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contentLength" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RagDocument_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "RagIngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RagChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingestionRunId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RagChunk_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "RagIngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RagChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "RagDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActiveRagIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingestionRunId" TEXT NOT NULL,
    "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActiveRagIndex_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "RagIngestionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RagIngestionRun_tableName_key" ON "RagIngestionRun"("tableName");

-- CreateIndex
CREATE INDEX "RagDocument_ingestionRunId_idx" ON "RagDocument"("ingestionRunId");

-- CreateIndex
CREATE INDEX "RagDocument_contentHash_idx" ON "RagDocument"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "RagChunk_documentId_sequence_key" ON "RagChunk"("documentId", "sequence");

-- CreateIndex
CREATE INDEX "RagChunk_ingestionRunId_idx" ON "RagChunk"("ingestionRunId");

-- CreateIndex
CREATE INDEX "RagChunk_textHash_idx" ON "RagChunk"("textHash");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveRagIndex_ingestionRunId_key" ON "ActiveRagIndex"("ingestionRunId");
