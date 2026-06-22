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
      allowedModels: ['test-model'],
      fallbackModel: null,
    },
  );
});

void test('許可モデルとフォールバックモデルを読み込む', () => {
  assert.deepEqual(
    loadConfig({
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'primary-model',
      OPENAI_ALLOWED_MODELS: 'primary-model, fallback-model, primary-model',
      OPENAI_FALLBACK_MODEL: 'fallback-model',
    }),
    {
      apiKey: 'test-key',
      model: 'primary-model',
      allowedModels: ['primary-model', 'fallback-model'],
      fallbackModel: 'fallback-model',
    },
  );
});

void test('既定モデルが許可一覧に含まれなければ設定エラーにする', () => {
  assert.throws(
    () =>
      loadConfig({
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'primary-model',
        OPENAI_ALLOWED_MODELS: 'another-model',
      }),
    ConfigurationError,
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
