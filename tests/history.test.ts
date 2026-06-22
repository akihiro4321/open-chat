import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRecentHistory } from '../src/history.js';

void test('完了済みと中断済みの会話だけを時系列で履歴に含める', () => {
  const history = selectRecentHistory([
    { role: 'user', content: '最初の質問', status: 'completed' },
    { role: 'assistant', content: '最初の回答', status: 'completed' },
    { role: 'assistant', content: '失敗した回答', status: 'failed' },
    { role: 'user', content: '次の質問', status: 'completed' },
    { role: 'assistant', content: '途中までの回答', status: 'cancelled' },
  ]);

  assert.deepEqual(history, [
    { role: 'user', content: '最初の質問' },
    { role: 'assistant', content: '最初の回答' },
    { role: 'user', content: '次の質問' },
    { role: 'assistant', content: '途中までの回答' },
  ]);
});

void test('最新40件を超える古い履歴を除外する', () => {
  const messages = Array.from({ length: 45 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: String(index),
    status: 'completed',
  }));

  const history = selectRecentHistory(messages);

  assert.equal(history.length, 40);
  assert.equal(history[0]?.content, '5');
  assert.equal(history.at(-1)?.content, '44');
});
