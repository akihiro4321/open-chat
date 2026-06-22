import assert from 'node:assert/strict';
import test from 'node:test';

import { requestAnswer } from '../src/openai-client.js';

void test('Responses APIの応答をアプリ内の結果形式へ変換する', async (context) => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requestBody = await request.clone().json();

    return new Response(
      JSON.stringify({
        id: 'resp_test',
        object: 'response',
        created_at: 1,
        status: 'completed',
        error: null,
        incomplete_details: null,
        instructions: 'test instruction',
        max_output_tokens: null,
        model: 'test-response-model',
        output: [
          {
            id: 'msg_test',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: ' テスト回答 ',
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
        parallel_tool_calls: true,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: false,
        temperature: 1,
        text: { format: { type: 'text' } },
        tool_choice: 'auto',
        tools: [],
        top_p: 1,
        truncation: 'disabled',
        usage: {
          input_tokens: 3,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 8,
        },
        metadata: {},
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  const result = await requestAnswer(
    { apiKey: 'test-key', model: 'test-request-model' },
    { instruction: 'test instruction', question: 'test question' },
  );

  assert.deepEqual(result, {
    answer: 'テスト回答',
    model: 'test-response-model',
    usage: {
      inputTokens: 3,
      outputTokens: 5,
      totalTokens: 8,
    },
  });
  assert.deepEqual(requestBody, {
    model: 'test-request-model',
    instructions: 'test instruction',
    input: 'test question',
  });
});
