import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { SourceDocument } from './types.js';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt']);

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function collectDocumentPaths(inputPath: string): Promise<string[]> {
  const entry = await stat(inputPath);

  if (entry.isFile()) {
    return SUPPORTED_EXTENSIONS.has(path.extname(inputPath).toLowerCase()) ? [inputPath] : [];
  }

  if (!entry.isDirectory()) {
    return [];
  }

  const entries = await readdir(inputPath, { withFileTypes: true });
  const children = await Promise.all(
    entries
      .filter((child) => !child.name.startsWith('.'))
      .map((child) => collectDocumentPaths(path.join(inputPath, child.name))),
  );

  return children.flat();
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

export async function loadSourceDocuments(sourcePath: string): Promise<SourceDocument[]> {
  const resolvedSourcePath = path.resolve(sourcePath);
  const documentPaths = await collectDocumentPaths(resolvedSourcePath);
  const documents = await Promise.all(
    documentPaths.sort().map(async (documentPath) => {
      const content = normalizeContent(await readFile(documentPath, 'utf8'));

      return {
        sourcePath: documentPath,
        sourceName: path.relative(resolvedSourcePath, documentPath) || path.basename(documentPath),
        content,
        contentHash: hashContent(content),
      };
    }),
  );

  return documents.filter((document) => document.content.length > 0);
}
