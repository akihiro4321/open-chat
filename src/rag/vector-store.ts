import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import * as lancedb from '@lancedb/lancedb';

import type { RagVectorRecord } from './types.js';

export interface VectorStoreWriteResult {
  lancedbUri: string;
  tableName: string;
}

export async function writeVectorTable(
  lancedbDir: string,
  tableName: string,
  records: RagVectorRecord[],
): Promise<VectorStoreWriteResult> {
  if (records.length === 0) {
    throw new Error('LanceDBへ書き込むチャンクがありません。');
  }

  const lancedbUri = path.resolve(lancedbDir);
  await mkdir(lancedbUri, { recursive: true });

  const database = await lancedb.connect(lancedbUri);
  await database.createTable(tableName, records as unknown as Record<string, unknown>[], {
    mode: 'overwrite',
  });

  return { lancedbUri, tableName };
}
