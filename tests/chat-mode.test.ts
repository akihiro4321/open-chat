import assert from 'node:assert/strict';
import test from 'node:test';

import { chatModeSchema, chatRequestSchema } from '../src/chat-protocol.js';

const TEST_REQUEST_ID = '00000000-0000-4000-8000-000000000000';

void test('chatModeSchema: static、agent、propose、multi_agent を受け入れる', () => {
  assert.deepEqual(chatModeSchema.parse('static'), 'static');
  assert.deepEqual(chatModeSchema.parse('agent'), 'agent');
  assert.deepEqual(chatModeSchema.parse('propose'), 'propose');
  assert.deepEqual(chatModeSchema.parse('multi_agent'), 'multi_agent');
});

void test('chatModeSchema: 不正な値を拒否する', () => {
  assert.throws(() => chatModeSchema.parse('foo'));
  assert.throws(() => chatModeSchema.parse(''));
  assert.throws(() => chatModeSchema.parse(null));
});

void test('chatRequestSchema: mode省略時はバリデーション成功する', () => {
  const result = chatRequestSchema.parse({
    threadId: 'thread-1',
    requestId: TEST_REQUEST_ID,
    message: '質問',
  });

  assert.equal(result.mode, undefined);
});

void test('chatRequestSchema: mode=agentをバリデーションする', () => {
  const result = chatRequestSchema.parse({
    threadId: 'thread-1',
    requestId: TEST_REQUEST_ID,
    message: '質問',
    mode: 'agent',
  });

  assert.equal(result.mode, 'agent');
});

void test('chatRequestSchema: mode=proposeをバリデーションする', () => {
  const result = chatRequestSchema.parse({
    threadId: 'thread-1',
    requestId: TEST_REQUEST_ID,
    message: '質問',
    mode: 'propose',
  });

  assert.equal(result.mode, 'propose');
});

void test('chatRequestSchema: mode=multi_agentをバリデーションする', () => {
  const result = chatRequestSchema.parse({
    threadId: 'thread-1',
    requestId: TEST_REQUEST_ID,
    message: '質問',
    mode: 'multi_agent',
  });

  assert.equal(result.mode, 'multi_agent');
});

void test('chatRequestSchema: 不正なmodeを拒否する', () => {
  assert.throws(() =>
    chatRequestSchema.parse({
      threadId: 'thread-1',
      requestId: TEST_REQUEST_ID,
      message: '質問',
      mode: 'foo',
    }),
  );
});
