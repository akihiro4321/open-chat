import { ConfigurationError, loadConfig } from './config.js';
import { requestAnswer } from './openai-client.js';

const DEFAULT_INSTRUCTION = 'あなたは正確で簡潔な日本語で回答するアシスタントです。';

interface CliOptions {
  question: string;
  instruction: string;
}

class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function printUsage(): void {
  console.log(`使い方:
  npm run chat -- --question "質問" [--instruction "AIへの指示"]

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

    throw new InputError(`不明な引数です: ${argument ?? ''}`);
  }

  if (!question) {
    throw new InputError('--question は必須です。');
  }

  return { question, instruction };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (!options) {
    printUsage();
    return;
  }

  const config = loadConfig();
  const result = await requestAnswer(config, options);

  console.log(`質問: ${options.question}`);
  console.log(`回答: ${result.answer}`);
  console.log(`モデル: ${result.model}`);

  if (result.usage) {
    console.log(
      `使用量: 入力 ${result.usage.inputTokens} / 出力 ${result.usage.outputTokens} / 合計 ${result.usage.totalTokens} トークン`,
    );
  } else {
    console.log('使用量: 取得できませんでした');
  }
}

main().catch((error: unknown) => {
  if (error instanceof InputError || error instanceof ConfigurationError) {
    console.error(`エラー: ${error.message}`);
  } else {
    console.error('エラー: OpenAIへの問い合わせに失敗しました。');
  }

  process.exitCode = 1;
});
