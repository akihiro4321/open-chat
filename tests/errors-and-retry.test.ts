import assert from 'node:assert/strict';
import test from 'node:test';

import OpenAI from 'openai';

import { ApplicationError, classifyOpenAIError } from '../src/errors.js';
import { withRetry } from '../src/retry.js';

void test('認証エラーを再試行不可に分類し、SDKの生メッセージを隠す', () => {
  const source = new OpenAI.AuthenticationError(
    401,
    { message: 'secret-sdk-message' },
    'secret-sdk-message',
    new Headers(),
  );

  const result = classifyOpenAIError(source);

  assert.equal(result.category, 'authentication');
  assert.equal(result.retryable, false);
  assert.doesNotMatch(result.message, /secret-sdk-message/);
});

void test('利用制限エラーを再試行可能に分類する', () => {
  const source = new OpenAI.RateLimitError(
    429,
    { message: 'rate limited' },
    'rate limited',
    new Headers(),
  );

  const result = classifyOpenAIError(source);

  assert.equal(result.category, 'rate_limit');
  assert.equal(result.retryable, true);
});

void test('一時障害は指数的に待機して成功するまで再試行する', async () => {
  const delays: number[] = [];
  let attempts = 0;

  const result = await withRetry(
    () => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.reject(
          new ApplicationError('service_unavailable', '一時障害', { retryable: true }),
        );
      }
      return Promise.resolve('成功');
    },
    {
      maxRetries: 2,
      initialDelayMs: 10,
      maxDelayMs: 100,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    },
  );

  assert.equal(result, '成功');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});

void test('再試行上限に達したら終了する', async () => {
  let attempts = 0;

  await assert.rejects(
    withRetry(
      () => {
        attempts += 1;
        return Promise.reject(new ApplicationError('connection', '通信障害', { retryable: true }));
      },
      {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        sleep: () => Promise.resolve(),
      },
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      !error.retryable &&
      error.message.includes('再試行しても回復しませんでした'),
  );

  assert.equal(attempts, 3);
});

void test('再試行不可のエラーは直ちに終了する', async () => {
  let attempts = 0;

  await assert.rejects(
    withRetry(
      () => {
        attempts += 1;
        return Promise.reject(new ApplicationError('invalid_request', '入力不正'));
      },
      {
        maxRetries: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        sleep: () => Promise.resolve(),
      },
    ),
    ApplicationError,
  );

  assert.equal(attempts, 1);
});
