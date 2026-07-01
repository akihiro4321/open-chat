import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigurationError, loadAgentConfig, loadConfig, loadRagConfig } from '../src/config.js';

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

void test('エージェントの役割別モデルを読み込む', () => {
  assert.deepEqual(
    loadAgentConfig({
      AGENT_MAX_ITERATIONS: '7',
      AGENT_RESEARCH_MODEL: 'research-model',
      AGENT_PLANNER_MODEL: 'planner-model',
      AGENT_SUPERVISOR_MODEL: 'supervisor-model',
    }),
    {
      maxIterations: 7,
      researchModel: 'research-model',
      plannerModel: 'planner-model',
      supervisorModel: 'supervisor-model',
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

void test('RAGチャンク戦略を読み込む', () => {
  assert.equal(
    loadRagConfig({
      OPENAI_API_KEY: 'test-key',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      RAG_CHUNK_STRATEGY: 'markdown',
    }).chunkStrategy,
    'markdown',
  );
});

void test('不明なRAGチャンク戦略を拒否する', () => {
  assert.throws(
    () =>
      loadRagConfig({
        OPENAI_API_KEY: 'test-key',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
        RAG_CHUNK_STRATEGY: 'semantic',
      }),
    (error: unknown) =>
      error instanceof ConfigurationError && error.message.includes('RAG_CHUNK_STRATEGY'),
  );
});

void test('RAG検索方式を読み込む', () => {
  assert.equal(
    loadRagConfig({
      OPENAI_API_KEY: 'test-key',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      RAG_RETRIEVAL_MODE: 'keyword',
    }).retrievalMode,
    'keyword',
  );
});

void test('不明なRAG検索方式を拒否する', () => {
  assert.throws(
    () =>
      loadRagConfig({
        OPENAI_API_KEY: 'test-key',
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
        RAG_RETRIEVAL_MODE: 'fulltext',
      }),
    (error: unknown) =>
      error instanceof ConfigurationError && error.message.includes('RAG_RETRIEVAL_MODE'),
  );
});
