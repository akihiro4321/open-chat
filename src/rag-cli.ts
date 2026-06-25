import 'dotenv/config';

import { ConfigurationError, loadRagConfig } from '@/src/config.js';
import { ApplicationError } from '@/src/errors.js';
import { type ChunkingStrategy, ingestDocuments } from '@/src/rag/index.js';

interface RagCliOptions {
  path: string;
  chunkStrategy?: ChunkingStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
}

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function printUsage(): void {
  console.log(`使い方:
  npm run rag:ingest -- --path "取込対象のファイルまたはディレクトリ"

オプション:
  --chunk-strategy  チャンク戦略。fixed または markdown。未指定なら RAG_CHUNK_STRATEGY または fixed
  --chunk-size      チャンク文字数。未指定なら RAG_CHUNK_SIZE または 1200
  --chunk-overlap   チャンクの重なり文字数。未指定なら RAG_CHUNK_OVERLAP または 200

必要な環境変数:
  OPENAI_API_KEY          OpenAI APIキー
  OPENAI_EMBEDDING_MODEL  埋め込みモデル名

任意の環境変数:
  OPENAI_EMBEDDING_DIMENSIONS  埋め込み次元数
  RAG_LANCEDB_DIR              LanceDB保存先
  RAG_CHUNK_STRATEGY           既定チャンク戦略。fixed または markdown
  RAG_CHUNK_SIZE               既定チャンク文字数
  RAG_CHUNK_OVERLAP            既定オーバーラップ文字数`);
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]?.trim();

  if (!value || value.startsWith('--')) {
    throw new InputError(`${name} の値を指定してください。`);
  }

  return value;
}

function readPositiveIntegerValue(value: string, name: string): number {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new InputError(`${name} は正の整数で指定してください。`);
  }

  return numberValue;
}

function readChunkingStrategyValue(value: string, name: string): ChunkingStrategy {
  if (value !== 'fixed' && value !== 'markdown') {
    throw new InputError(`${name} は fixed または markdown で指定してください。`);
  }

  return value;
}

function parseArguments(args: string[]): RagCliOptions | null {
  let sourcePath: string | undefined;
  let chunkStrategy: ChunkingStrategy | undefined;
  let chunkSize: number | undefined;
  let chunkOverlap: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help' || argument === '-h') {
      return null;
    }

    if (argument === '--path') {
      sourcePath = readOptionValue(args, index, '--path');
      index += 1;
      continue;
    }

    if (argument === '--chunk-strategy') {
      chunkStrategy = readChunkingStrategyValue(
        readOptionValue(args, index, '--chunk-strategy'),
        argument,
      );
      index += 1;
      continue;
    }

    if (argument === '--chunk-size') {
      chunkSize = readPositiveIntegerValue(readOptionValue(args, index, '--chunk-size'), argument);
      index += 1;
      continue;
    }

    if (argument === '--chunk-overlap') {
      chunkOverlap = readPositiveIntegerValue(
        readOptionValue(args, index, '--chunk-overlap'),
        argument,
      );
      index += 1;
      continue;
    }

    throw new InputError(`不明な引数です: ${argument ?? ''}`);
  }

  if (!sourcePath) {
    throw new InputError('--path は必須です。');
  }

  return {
    path: sourcePath,
    ...(chunkStrategy ? { chunkStrategy } : {}),
    ...(chunkSize ? { chunkSize } : {}),
    ...(chunkOverlap ? { chunkOverlap } : {}),
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (!options) {
    printUsage();
    return;
  }

  const config = loadRagConfig();
  const chunkStrategy = options.chunkStrategy ?? config.chunkStrategy;
  const chunkSize = options.chunkSize ?? config.chunkSize;
  const chunkOverlap = options.chunkOverlap ?? config.chunkOverlap;

  if (chunkOverlap >= chunkSize) {
    throw new InputError('--chunk-overlap は --chunk-size より小さくしてください。');
  }

  const result = await ingestDocuments({
    sourcePath: options.path,
    chunkStrategy,
    chunkSize,
    chunkOverlap,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    lancedbDir: config.lancedbDir,
    apiKey: config.apiKey,
  });

  console.log('RAG文書取込が完了しました。');
  console.log(`取込ID: ${result.ingestionRunId}`);
  console.log(`チャンク戦略: ${chunkStrategy}`);
  console.log(`文書数: ${result.documentCount}`);
  console.log(`チャンク数: ${result.chunkCount}`);
  console.log(`LanceDB: ${result.lancedbUri}`);
  console.log(`テーブル: ${result.tableName}`);
}

main().catch((error: unknown) => {
  if (
    error instanceof InputError ||
    error instanceof ConfigurationError ||
    error instanceof ApplicationError
  ) {
    console.error(`エラー: ${error.message}`);
  } else {
    console.error('エラー: RAG文書取込に失敗しました。');
    console.error(error instanceof Error ? error.message : error);
  }

  process.exitCode = 1;
});
