import { ConfigurationError, loadConfig } from './config.js';
import { ApplicationError, GenerationCancelledError } from './errors.js';
import type { ChatResult } from './openai-client.js';
import { requestAnswerStream, requestStructuredAnswer } from './openai-client.js';
import type { StructuredAnswer } from './structured-output.js';

const DEFAULT_INSTRUCTION = 'あなたは正確で簡潔な日本語で回答するアシスタントです。';

interface CliOptions {
  question: string;
  instruction: string;
  structured: boolean;
}

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function printUsage(): void {
  console.log(`使い方:
  npm run chat -- --question "質問" [--instruction "AIへの指示"] [--structured]

オプション:
  --structured  回答を分類・要約・要点の構造化データとして取得

必要な環境変数:
  OPENAI_API_KEY  OpenAI APIキー
  OPENAI_MODEL    使用するモデル名`);
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]?.trim();

  if (!value || value.startsWith('--')) {
    throw new InputError(`${name} の値を指定してください。`);
  }

  return value;
}

function parseArguments(args: string[]): CliOptions | null {
  let question: string | undefined;
  let instruction = DEFAULT_INSTRUCTION;
  let structured = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--help' || argument === '-h') {
      return null;
    }

    if (argument === '--question') {
      question = readOptionValue(args, index, '--question');
      index += 1;
      continue;
    }

    if (argument === '--instruction') {
      instruction = readOptionValue(args, index, '--instruction');
      index += 1;
      continue;
    }

    if (argument === '--structured') {
      structured = true;
      continue;
    }

    throw new InputError(`不明な引数です: ${argument ?? ''}`);
  }

  if (!question) {
    throw new InputError('--question は必須です。');
  }

  return { question, instruction, structured };
}

function printUsageResult(result: ChatResult['usage']): void {
  if (result) {
    console.log(
      `使用量: 入力 ${result.inputTokens} / 出力 ${result.outputTokens} / 合計 ${result.totalTokens} トークン`,
    );
  } else {
    console.log('使用量: 取得できませんでした');
  }
}

const CATEGORY_LABELS: Record<StructuredAnswer['category'], string> = {
  fact: '事実',
  explanation: '説明',
  procedure: '手順',
  other: 'その他',
};

async function runStructuredChat(options: CliOptions): Promise<void> {
  const result = await requestStructuredAnswer(loadConfig(), options);

  console.log(`質問: ${options.question}`);
  console.log('構造化回答:');
  console.log(`  分類: ${CATEGORY_LABELS[result.answer.category]}`);
  console.log(`  要約: ${result.answer.summary}`);
  console.log('  要点:');

  for (const keyPoint of result.answer.keyPoints) {
    console.log(`    - ${keyPoint}`);
  }

  console.log(`モデル: ${result.model}`);
  printUsageResult(result.usage);
}

async function runStreamingChat(options: CliOptions): Promise<void> {
  const config = loadConfig();
  console.log(`質問: ${options.question}`);
  process.stdout.write('回答: ');

  const abortController = new AbortController();
  const cancelGeneration = (): void => {
    abortController.abort();
  };
  process.once('SIGINT', cancelGeneration);

  let result: ChatResult;
  let hasReceivedText = false;

  try {
    result = await requestAnswerStream(config, options, {
      onTextDelta: (delta) => {
        hasReceivedText = true;
        process.stdout.write(delta);
      },
      signal: abortController.signal,
    });
  } catch (error: unknown) {
    process.stdout.write('\n');

    if (error instanceof GenerationCancelledError) {
      console.error('中断: 回答生成を中断しました。表示済みの内容は部分回答です。');
      process.exitCode = 130;
      return;
    }

    if (hasReceivedText) {
      console.error('注意: 表示済みの内容は、生成途中で終了した部分回答です。');
    }

    throw error;
  } finally {
    process.removeListener('SIGINT', cancelGeneration);
  }

  process.stdout.write('\n');
  console.log(`モデル: ${result.model}`);
  printUsageResult(result.usage);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (!options) {
    printUsage();
    return;
  }

  if (options.structured) {
    await runStructuredChat(options);
    return;
  }

  await runStreamingChat(options);
}

main().catch((error: unknown) => {
  if (
    error instanceof InputError ||
    error instanceof ConfigurationError ||
    error instanceof ApplicationError
  ) {
    console.error(`エラー: ${error.message}`);
  } else {
    console.error('エラー: OpenAIへの問い合わせに失敗しました。');
  }

  process.exitCode = 1;
});
