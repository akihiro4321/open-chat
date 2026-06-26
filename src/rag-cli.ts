import 'dotenv/config';

import { ConfigurationError, loadRagConfig } from '@/src/config.js';
import { ApplicationError } from '@/src/errors.js';
import {
  type ChunkingStrategy,
  evaluateRagDataset,
  ingestDocuments,
  loadRagEvaluationDataset,
  type RagEvaluationResult,
  type RetrievalMode,
  retrieveRagContext,
} from '@/src/rag/index.js';

interface IngestOptions {
  command: 'ingest';
  path: string;
  chunkStrategy?: ChunkingStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
}

interface SearchOptions {
  command: 'search';
  question: string;
  retrievalMode?: RetrievalMode;
  topK?: number;
}

type EvaluationRetrievalMode = RetrievalMode | 'all';

interface EvaluateOptions {
  command: 'evaluate';
  datasetPath: string;
  retrievalMode?: EvaluationRetrievalMode;
  topK?: number;
}

type RagCliOptions = EvaluateOptions | IngestOptions | SearchOptions;

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function printUsage(): void {
  console.log(`使い方:
  npm run rag:ingest -- --path "取込対象のファイルまたはディレクトリ"
  npm run rag:search -- --question "検索したい質問"
  npm run rag:evaluate -- --dataset "評価データJSON"

取込オプション:
  --chunk-strategy  チャンク戦略。fixed または markdown。未指定なら RAG_CHUNK_STRATEGY または fixed
  --chunk-size      チャンク文字数。未指定なら RAG_CHUNK_SIZE または 1200
  --chunk-overlap   チャンクの重なり文字数。未指定なら RAG_CHUNK_OVERLAP または 200

検索オプション:
  --question        検索したい質問
  --retrieval-mode  検索方式。vector、keyword、hybrid。未指定なら RAG_RETRIEVAL_MODE または hybrid
  --top-k           検索件数。未指定なら RAG_TOP_K または 4

評価オプション:
  --dataset         評価データJSONのパス
  --retrieval-mode  検索方式。vector、keyword、hybrid、all。未指定なら RAG_RETRIEVAL_MODE または hybrid
  --top-k           検索件数。未指定なら RAG_TOP_K または 4

必要な環境変数:
  OPENAI_API_KEY          OpenAI APIキー
  OPENAI_EMBEDDING_MODEL  埋め込みモデル名

任意の環境変数:
  OPENAI_EMBEDDING_DIMENSIONS  埋め込み次元数
  RAG_LANCEDB_DIR              LanceDB保存先
  RAG_CHUNK_STRATEGY           既定チャンク戦略。fixed または markdown
  RAG_CHUNK_SIZE               既定チャンク文字数
  RAG_CHUNK_OVERLAP            既定オーバーラップ文字数
  RAG_TOP_K                    既定検索件数
  RAG_RETRIEVAL_MODE           既定検索方式。vector、keyword、hybrid`);
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

function readRetrievalModeValue(value: string, name: string): RetrievalMode {
  if (value !== 'vector' && value !== 'keyword' && value !== 'hybrid') {
    throw new InputError(`${name} は vector、keyword、hybrid のいずれかで指定してください。`);
  }

  return value;
}

function readEvaluationRetrievalModeValue(value: string, name: string): EvaluationRetrievalMode {
  if (value === 'all') {
    return value;
  }

  return readRetrievalModeValue(value, name);
}

function parseIngestArguments(args: string[]): IngestOptions {
  let sourcePath: string | undefined;
  let chunkStrategy: ChunkingStrategy | undefined;
  let chunkSize: number | undefined;
  let chunkOverlap: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

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
    command: 'ingest',
    path: sourcePath,
    ...(chunkStrategy ? { chunkStrategy } : {}),
    ...(chunkSize ? { chunkSize } : {}),
    ...(chunkOverlap ? { chunkOverlap } : {}),
  };
}

function parseSearchArguments(args: string[]): SearchOptions {
  let question: string | undefined;
  let retrievalMode: RetrievalMode | undefined;
  let topK: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--question' || argument === '-q') {
      question = readOptionValue(args, index, '--question');
      index += 1;
      continue;
    }

    if (argument === '--retrieval-mode') {
      retrievalMode = readRetrievalModeValue(readOptionValue(args, index, argument), argument);
      index += 1;
      continue;
    }

    if (argument === '--top-k') {
      topK = readPositiveIntegerValue(readOptionValue(args, index, argument), argument);
      index += 1;
      continue;
    }

    throw new InputError(`不明な引数です: ${argument ?? ''}`);
  }

  if (!question) {
    throw new InputError('--question は必須です。');
  }

  return {
    command: 'search',
    question,
    ...(retrievalMode ? { retrievalMode } : {}),
    ...(topK ? { topK } : {}),
  };
}

function parseEvaluateArguments(args: string[]): EvaluateOptions {
  let datasetPath: string | undefined;
  let retrievalMode: EvaluationRetrievalMode | undefined;
  let topK: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--dataset') {
      datasetPath = readOptionValue(args, index, argument);
      index += 1;
      continue;
    }

    if (argument === '--retrieval-mode') {
      retrievalMode = readEvaluationRetrievalModeValue(
        readOptionValue(args, index, argument),
        argument,
      );
      index += 1;
      continue;
    }

    if (argument === '--top-k') {
      topK = readPositiveIntegerValue(readOptionValue(args, index, argument), argument);
      index += 1;
      continue;
    }

    throw new InputError(`不明な引数です: ${argument ?? ''}`);
  }

  if (!datasetPath) {
    throw new InputError('--dataset は必須です。');
  }

  return {
    command: 'evaluate',
    datasetPath,
    ...(retrievalMode ? { retrievalMode } : {}),
    ...(topK ? { topK } : {}),
  };
}

function parseArguments(args: string[]): RagCliOptions | null {
  if (args.includes('--help') || args.includes('-h')) {
    return null;
  }

  const [command, ...rest] = args;

  if (command === 'search') {
    return parseSearchArguments(rest);
  }

  if (command === 'ingest') {
    return parseIngestArguments(rest);
  }

  if (command === 'evaluate') {
    return parseEvaluateArguments(rest);
  }

  return parseIngestArguments(args);
}

async function runIngest(options: IngestOptions): Promise<void> {
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

function toPreview(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim().slice(0, 160);
}

async function runSearch(options: SearchOptions): Promise<void> {
  const config = loadRagConfig();
  const retrievalMode = options.retrievalMode ?? config.retrievalMode;
  const topK = options.topK ?? config.topK;
  const chunks = await retrieveRagContext({
    apiKey: config.apiKey,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    lancedbDir: config.lancedbDir,
    question: options.question,
    retrievalMode,
    topK,
  });

  console.log(`検索方式: ${retrievalMode}`);
  console.log(`検索件数: ${chunks.length}`);

  chunks.forEach((chunk, index) => {
    console.log('');
    console.log(`[${index + 1}] ${chunk.sourceName}`);
    console.log(`path: ${chunk.sourcePath}`);
    console.log(`range: ${chunk.startOffset}-${chunk.endOffset}`);
    console.log(`score: ${chunk.score ?? '-'}`);
    console.log(
      `vectorRank: ${chunk.vectorRank ?? '-'} / keywordRank: ${chunk.keywordRank ?? '-'}`,
    );
    console.log(`preview: ${toPreview(chunk.text)}`);
  });
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}

function printEvaluationResult(mode: RetrievalMode, result: RagEvaluationResult): void {
  console.log('');
  console.log(`検索方式: ${mode}`);
  console.log(`評価件数: ${result.itemCount}`);
  console.log(`Recall@k: ${formatMetric(result.metrics.recallAtK)}`);
  console.log(`MRR: ${formatMetric(result.metrics.mrr)}`);
  console.log(`nDCG: ${formatMetric(result.metrics.ndcg)}`);

  result.items.forEach((item) => {
    console.log('');
    console.log(`[${item.id}] ${item.question}`);
    console.log(`expected: ${item.expectedIds.join(', ')}`);
    console.log(`matched: ${item.matchedExpectedIds.join(', ') || '-'}`);
    console.log(`firstRelevantRank: ${item.firstRelevantRank ?? '-'}`);
    console.log(
      `metrics: recall=${formatMetric(item.metrics.recallAtK)}, mrr=${formatMetric(
        item.metrics.mrr,
      )}, ndcg=${formatMetric(item.metrics.ndcg)}`,
    );
  });
}

async function runEvaluate(options: EvaluateOptions): Promise<void> {
  const config = loadRagConfig();
  const dataset = await loadRagEvaluationDataset(options.datasetPath);
  const retrievalMode = options.retrievalMode ?? config.retrievalMode;
  const topK = options.topK ?? config.topK;
  const modes: RetrievalMode[] =
    retrievalMode === 'all' ? ['vector', 'keyword', 'hybrid'] : [retrievalMode];

  for (const mode of modes) {
    const result = await evaluateRagDataset({
      dataset,
      retrieve: (item) =>
        retrieveRagContext({
          apiKey: config.apiKey,
          embeddingModel: config.embeddingModel,
          embeddingDimensions: config.embeddingDimensions,
          lancedbDir: config.lancedbDir,
          question: item.question,
          retrievalMode: mode,
          topK,
        }),
    });

    printEvaluationResult(mode, result);
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (!options) {
    printUsage();
    return;
  }

  if (options.command === 'search') {
    await runSearch(options);
    return;
  }

  if (options.command === 'evaluate') {
    await runEvaluate(options);
    return;
  }

  await runIngest(options);
}

main().catch((error: unknown) => {
  if (
    error instanceof InputError ||
    error instanceof ConfigurationError ||
    error instanceof ApplicationError
  ) {
    console.error(`エラー: ${error.message}`);
  } else {
    console.error('エラー: RAG CLIの実行に失敗しました。');
    console.error(error instanceof Error ? error.message : error);
  }

  process.exitCode = 1;
});
