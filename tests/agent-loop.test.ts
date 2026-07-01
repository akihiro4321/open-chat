import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentLoop } from '../src/agent/loop.js';
import { defaultTools } from '../src/agent/tools.js';
import { GenerationCancelledError } from '../src/errors.js';

const TEST_API_KEY = 'test-api-key';
const TEST_MODEL = 'test-model';

function streamResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface MockResponsesOptions {
  text: string;
  toolCalls?: Array<{ callId: string; name: string; arguments: string }>;
}

function makeMockFetch(optionsByCall: MockResponsesOptions[]): {
  fetch: typeof fetch;
  captured: Array<Record<string, unknown>>;
} {
  let index = 0;
  const captured: Array<Record<string, unknown>> = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    captured.push((await request.clone().json()) as Record<string, unknown>);

    const fallback = optionsByCall[optionsByCall.length - 1];
    const options = optionsByCall[index] ?? fallback;

    if (!options) {
      throw new Error('No mock fetch options configured.');
    }

    index += 1;

    const events: unknown[] = [];

    if (options.text) {
      events.push({
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: options.text,
        logprobs: [],
        sequence_number: 1,
      });
    }

    for (const [i, call] of (options.toolCalls ?? []).entries()) {
      events.push({
        type: 'response.function_call_arguments.delta',
        item_id: call.callId,
        output_index: i,
        delta: call.arguments,
        sequence_number: events.length + 1,
      });
      events.push({
        type: 'response.function_call_arguments.done',
        item_id: call.callId,
        output_index: i,
        name: call.name,
        arguments: call.arguments,
        sequence_number: events.length + 1,
      });
    }

    events.push({
      type: 'response.completed',
      sequence_number: events.length + 1,
      response: {
        model: TEST_MODEL,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        output: (options.toolCalls ?? []).map((call) => ({
          id: call.callId,
          type: 'function_call',
          call_id: call.callId,
          name: call.name,
          arguments: call.arguments,
        })),
      },
    });

    return streamResponse(events);
  };

  return { fetch: mockFetch, captured };
}

void test('runAgentLoop: ツール呼出しなしで最終回答を返す', async (context) => {
  const originalFetch = globalThis.fetch;
  const { fetch } = makeMockFetch([{ text: '直接回答です。' }]);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = fetch;

  const result = await runAgentLoop({
    apiKey: TEST_API_KEY,
    model: TEST_MODEL,
    instruction: 'テスト用指示',
    question: 'こんにちは',
    messageId: 'test-msg',
    tools: defaultTools,
    maxIterations: 3,
  });

  assert.equal(result.answer, '直接回答です。');
  assert.equal(result.iterations, 1);
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.toolResults.length, 0);
});

void test('runAgentLoop: ツールを1回呼び出して最終回答まで反復する', async (context) => {
  const originalFetch = globalThis.fetch;
  const { fetch, captured } = makeMockFetch([
    {
      text: '',
      toolCalls: [
        {
          callId: 'fc_1',
          name: 'getCurrentTime',
          arguments: '{"timezone":"Asia/Tokyo"}',
        },
      ],
    },
    { text: '現在時刻はXXです。' },
  ]);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = fetch;

  const deltas: string[] = [];

  const result = await runAgentLoop({
    apiKey: TEST_API_KEY,
    model: TEST_MODEL,
    instruction: 'テスト用指示',
    question: '現在時刻は？',
    messageId: 'test-msg',
    tools: defaultTools,
    maxIterations: 3,
    onTextDelta: (delta) => deltas.push(delta),
  });

  assert.equal(result.iterations, 2);
  assert.equal(result.finishReason, 'completed');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, 'getCurrentTime');
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.isError, false);
  assert.equal(result.answer, '現在時刻はXXです。');
  assert.deepEqual(deltas, ['現在時刻はXXです。']);

  // 2回目のリクエストにはfunction_call_outputが含まれる
  const secondRequest = captured[1] as { input?: unknown };
  const input = secondRequest.input;
  assert.ok(Array.isArray(input));
  const items = input as Array<Record<string, unknown>>;
  assert.ok(items.some((item) => item.type === 'function_call'));
  assert.ok(items.some((item) => item.type === 'function_call_output'));
});

void test('runAgentLoop: 複数ツールを1ターンで並列実行する', async (context) => {
  const originalFetch = globalThis.fetch;
  const { fetch } = makeMockFetch([
    {
      text: '',
      toolCalls: [
        {
          callId: 'fc_a',
          name: 'getCurrentTime',
          arguments: '{"timezone":"Asia/Tokyo"}',
        },
        {
          callId: 'fc_b',
          name: 'getCurrentTime',
          arguments: '{"timezone":"UTC"}',
        },
      ],
    },
    { text: '両方取得しました。' },
  ]);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = fetch;

  const result = await runAgentLoop({
    apiKey: TEST_API_KEY,
    model: TEST_MODEL,
    instruction: 'テスト用指示',
    question: '複数の時刻は？',
    messageId: 'test-msg',
    tools: defaultTools,
    maxIterations: 3,
  });

  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolResults.length, 2);
  assert.equal(result.iterations, 2);
});

void test('runAgentLoop: 未知のツールはエラーとして差し戻される', async (context) => {
  const originalFetch = globalThis.fetch;
  const { fetch } = makeMockFetch([
    {
      text: '',
      toolCalls: [
        {
          callId: 'fc_unknown',
          name: 'unknownTool',
          arguments: '{}',
        },
      ],
    },
    { text: '該当ツールはありません。' },
  ]);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = fetch;

  const result = await runAgentLoop({
    apiKey: TEST_API_KEY,
    model: TEST_MODEL,
    instruction: 'テスト用指示',
    question: 'ツールを呼んで',
    messageId: 'test-msg',
    tools: defaultTools,
    maxIterations: 3,
  });

  assert.equal(result.toolResults[0]?.isError, true);
  assert.match(result.toolResults[0]?.output ?? '', /未知のツールです/);
  assert.equal(result.finishReason, 'completed');
});

void test('runAgentLoop: 引数のスキーマ違反はLLMへ差し戻される', async (context) => {
  const originalFetch = globalThis.fetch;
  const { fetch } = makeMockFetch([
    {
      text: '',
      toolCalls: [
        {
          callId: 'fc_invalid',
          name: 'getCurrentTime',
          arguments: '{"timezone":""}',
        },
      ],
    },
    { text: '再試行します。' },
  ]);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = fetch;

  const result = await runAgentLoop({
    apiKey: TEST_API_KEY,
    model: TEST_MODEL,
    instruction: 'テスト用指示',
    question: 'テスト',
    messageId: 'test-msg',
    tools: defaultTools,
    maxIterations: 3,
  });

  assert.equal(result.toolResults[0]?.isError, true);
  assert.match(result.toolResults[0]?.output ?? '', /引数がスキーマと一致しません/);
  assert.equal(result.finishReason, 'completed');
});

void test('runAgentLoop: ツール実行失敗時はエラー文字列をLLMに返す', async () => {
  const failingTool = {
    name: 'failingTool',
    description: '失敗するツール',
    schema: defaultTools[0]!.schema,
    hasSideEffect: false,
    execute: () => Promise.reject(new Error('boom')),
  };

  const originalFetch = globalThis.fetch;
  const { fetch } = makeMockFetch([
    {
      text: '',
      toolCalls: [
        {
          callId: 'fc_fail',
          name: 'failingTool',
          arguments: '{}',
        },
      ],
    },
    { text: '失敗を受け取りました。' },
  ]);
  globalThis.fetch = fetch;

  try {
    const result = await runAgentLoop({
      apiKey: TEST_API_KEY,
      model: TEST_MODEL,
      instruction: 'テスト用指示',
      question: 'テスト',
      messageId: 'test-msg',
      tools: [failingTool],
      maxIterations: 3,
    });

    assert.equal(result.toolResults[0]?.isError, true);
    assert.match(result.toolResults[0]?.output ?? '', /boom/);
    assert.equal(result.finishReason, 'completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('runAgentLoop: 反復上限に達したらmax_iterationsで停止する', async (context) => {
  const originalFetch = globalThis.fetch;
  const alwaysToolCall = {
    text: '',
    toolCalls: [
      {
        callId: 'fc_loop',
        name: 'getCurrentTime',
        arguments: '{"timezone":"Asia/Tokyo"}',
      },
    ],
  };
  const { fetch } = makeMockFetch([alwaysToolCall, alwaysToolCall, alwaysToolCall]);
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = fetch;

  const result = await runAgentLoop({
    apiKey: TEST_API_KEY,
    model: TEST_MODEL,
    instruction: 'テスト用指示',
    question: '無限ループ',
    messageId: 'test-msg',
    tools: defaultTools,
    maxIterations: 3,
  });

  assert.equal(result.iterations, 3);
  assert.equal(result.finishReason, 'max_iterations');
  assert.match(result.answer, /ツール呼出しが上限に達し/);
});

void test('runAgentLoop: キャンセルはGenerationCancelledErrorで伝播する', async (context) => {
  const originalFetch = globalThis.fetch;
  const abortController = new AbortController();
  abortController.abort();
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = makeMockFetch([{ text: '呼ばれない' }]).fetch;

  await assert.rejects(
    runAgentLoop({
      apiKey: TEST_API_KEY,
      model: TEST_MODEL,
      instruction: 'テスト用指示',
      question: 'テスト',
      messageId: 'test-msg',
      tools: defaultTools,
      maxIterations: 3,
      signal: abortController.signal,
    }),
    GenerationCancelledError,
  );
});
