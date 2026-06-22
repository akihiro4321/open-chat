import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../app/api/chat/route.js';

void test('チャットAPIは不正なJSONを400で拒否する', async () => {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    message: '質問を1文字以上10,000文字以内で入力してください。',
  });
});

void test('チャットAPIは空の質問を400で拒否する', async () => {
  const response = await POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '  ' }),
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  assert.equal(response.status, 400);
});
