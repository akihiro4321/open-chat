import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function environmentWithoutOpenAISettings(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.OPENAI_API_KEY;
  delete environment.OPENAI_MODEL;
  return environment;
}

void test('helpは設定なしでも使い方を表示して正常終了する', async () => {
  const result = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', '--help'],
    {
      cwd: process.cwd(),
      env: environmentWithoutOpenAISettings(),
    },
  );

  assert.match(result.stdout, /使い方/);
  assert.equal(result.stderr, '');
});

void test('質問が未指定ならエラーを表示して終了コード1にする', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts'], {
      cwd: process.cwd(),
      env: environmentWithoutOpenAISettings(),
    }),
    (error: unknown) => {
      if (!(error instanceof Error) || !('code' in error) || !('stderr' in error)) {
        return false;
      }

      return error.code === 1 && String(error.stderr).includes('--question は必須です。');
    },
  );
});

void test('APIキーが未設定ならエラーを表示して終了コード1にする', async () => {
  const environment = environmentWithoutOpenAISettings();
  environment.OPENAI_MODEL = 'test-model';

  await assert.rejects(
    execFileAsync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--question', 'テスト質問'], {
      cwd: process.cwd(),
      env: environment,
    }),
    (error: unknown) => {
      if (!(error instanceof Error) || !('code' in error) || !('stderr' in error)) {
        return false;
      }

      const stderr = String(error.stderr);
      return error.code === 1 && stderr.includes('OPENAI_API_KEY') && !stderr.includes('test-key');
    },
  );
});
