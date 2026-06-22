import assert from 'node:assert/strict';
import test from 'node:test';

import { chatRequestSchema, chatStreamEventSchema } from '../src/chat-protocol.js';

void test('チャットAPIの入力から前後空白を除去する', () => {
  assert.deepEqual(
    chatRequestSchema.parse({
      threadId: 'thread-1',
      requestId: 'f33f0550-4331-47ca-8d28-591572f88f48',
      message: '  質問  ',
    }),
    {
      threadId: 'thread-1',
      requestId: 'f33f0550-4331-47ca-8d28-591572f88f48',
      message: '質問',
    },
  );
});

void test('空の質問と上限を超える質問を拒否する', () => {
  assert.equal(chatRequestSchema.safeParse({ message: '   ' }).success, false);
  assert.equal(chatRequestSchema.safeParse({ message: 'a'.repeat(10_001) }).success, false);
});

void test('ストリームイベントの種類ごとの形式を検証する', () => {
  assert.equal(chatStreamEventSchema.safeParse({ type: 'delta', delta: '回答' }).success, true);
  assert.equal(
    chatStreamEventSchema.safeParse({
      type: 'done',
      assistantMessageId: 'message-1',
      threadTitle: 'テスト',
      model: 'test-model',
      usage: null,
    }).success,
    true,
  );
  assert.equal(
    chatStreamEventSchema.safeParse({ type: 'error', message: '失敗しました。' }).success,
    true,
  );
  assert.equal(chatStreamEventSchema.safeParse({ type: 'unknown' }).success, false);
});
