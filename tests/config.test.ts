import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigurationError, loadConfig } from '../src/config.js';

void test('APIキーとモデル名の前後空白を除いて読み込む', () => {
  assert.deepEqual(
    loadConfig({
      OPENAI_API_KEY: ' test-key ',
      OPENAI_MODEL: ' test-model ',
    }),
    {
      apiKey: 'test-key',
      model: 'test-model',
    },
  );
});

void test('APIキーが未設定なら設定エラーにする', () => {
  assert.throws(
    () => loadConfig({ OPENAI_MODEL: 'test-model' }),
    (error: unknown) =>
      error instanceof ConfigurationError && error.message.includes('OPENAI_API_KEY'),
  );
});

void test('モデル名が未設定なら設定エラーにする', () => {
  assert.throws(
    () => loadConfig({ OPENAI_API_KEY: 'test-key' }),
    (error: unknown) =>
      error instanceof ConfigurationError && error.message.includes('OPENAI_MODEL'),
  );
});
