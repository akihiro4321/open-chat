import assert from 'node:assert/strict';
import test from 'node:test';

import { splitDocumentIntoChunks } from '../src/rag/chunker.js';
import type { SourceDocument } from '../src/rag/index.js';

const sourceDocument: SourceDocument = {
  sourcePath: '/tmp/sample.md',
  sourceName: 'sample.md',
  contentHash: 'hash',
  content: `前書き

# 概要
Open Chatは学習用のチャットアプリです。

## 詳細
RAGでは文書を分割して検索します。`,
};

void test('fixedチャンク戦略は文字数で分割する', () => {
  const chunks = splitDocumentIntoChunks(sourceDocument, 'document-1', 'run-1', {
    chunkStrategy: 'fixed',
    chunkSize: 20,
    chunkOverlap: 5,
  });

  assert.ok(chunks.length > 1);
  assert.equal(chunks[0]?.sequence, 0);
  assert.equal(chunks[1]?.startOffset, 15);
});

void test('markdownチャンク戦略は見出し境界を優先する', () => {
  const chunks = splitDocumentIntoChunks(sourceDocument, 'document-1', 'run-1', {
    chunkStrategy: 'markdown',
    chunkSize: 1000,
    chunkOverlap: 100,
  });

  assert.deepEqual(
    chunks.map((chunk) => chunk.text.split('\n')[0]),
    ['前書き', '# 概要', '## 詳細'],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.sequence),
    [0, 1, 2],
  );
});
