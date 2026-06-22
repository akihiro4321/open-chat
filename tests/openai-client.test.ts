import assert from 'node:assert/strict';
import test from 'node:test';

import { GenerationCancelledError } from '../src/errors.js';
import { requestAnswer, requestAnswerStream } from '../src/openai-client.js';

function streamResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

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

void test('Responses APIの本文差分を到着順に通知し完了結果を返す', async (context) => {
  const originalFetch = globalThis.fetch;
  const deltas: string[] = [];
  let requestBody: unknown;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requestBody = await request.clone().json();

    return streamResponse([
      {
        type: 'response.output_text.delta',
        item_id: 'msg_test',
        output_index: 0,
        content_index: 0,
        delta: '東京',
        logprobs: [],
        sequence_number: 1,
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_test',
        output_index: 0,
        content_index: 0,
        delta: 'です。',
        logprobs: [],
        sequence_number: 2,
      },
      {
        type: 'response.completed',
        sequence_number: 3,
        response: {
          model: 'test-response-model',
          usage: {
            input_tokens: 3,
            output_tokens: 4,
            total_tokens: 7,
          },
        },
      },
    ]);
  };

  const result = await requestAnswerStream(
    { apiKey: 'test-key', model: 'test-request-model' },
    { instruction: 'test instruction', question: 'test question' },
    { onTextDelta: (delta) => deltas.push(delta) },
  );

  assert.deepEqual(deltas, ['東京', 'です。']);
  assert.deepEqual(result, {
    answer: '東京です。',
    model: 'test-response-model',
    usage: {
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    },
  });
  assert.deepEqual(requestBody, {
    model: 'test-request-model',
    instructions: 'test instruction',
    input: 'test question',
    stream: true,
  });
});

void test('本文表示後に生成が失敗しても再試行しない', async (context) => {
  const originalFetch = globalThis.fetch;
  const deltas: string[] = [];
  let requestCount = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = () => {
    requestCount += 1;

    return Promise.resolve(
      streamResponse([
        {
          type: 'response.output_text.delta',
          item_id: 'msg_test',
          output_index: 0,
          content_index: 0,
          delta: '部分回答',
          logprobs: [],
          sequence_number: 1,
        },
        {
          type: 'response.failed',
          sequence_number: 2,
          response: {},
        },
      ]),
    );
  };

  await assert.rejects(
    requestAnswerStream(
      { apiKey: 'test-key', model: 'test-model' },
      { instruction: 'test instruction', question: 'test question' },
      { onTextDelta: (delta) => deltas.push(delta) },
    ),
    /回答生成に失敗しました/,
  );

  assert.deepEqual(deltas, ['部分回答']);
  assert.equal(requestCount, 1);
});

void test('AbortSignalによる中断を利用者の中断として扱う', async (context) => {
  const originalFetch = globalThis.fetch;
  const abortController = new AbortController();
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const rejectAsAborted = (): void => reject(new DOMException('Aborted', 'AbortError'));

      if (signal?.aborted) {
        rejectAsAborted();
        return;
      }

      signal?.addEventListener('abort', rejectAsAborted, { once: true });
    });

  const result = requestAnswerStream(
    { apiKey: 'test-key', model: 'test-model' },
    { instruction: 'test instruction', question: 'test question' },
    {
      onTextDelta: () => undefined,
      signal: abortController.signal,
    },
  );
  abortController.abort();

  await assert.rejects(result, GenerationCancelledError);
});
