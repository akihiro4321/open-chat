import assert from 'node:assert/strict';
import test from 'node:test';

import { runMultiAgent } from '../src/agent/multi-agent.js';
import type { AgentLoopOptions, AgentLoopResult, ToolDefinition } from '../src/agent/types.js';
import type { AppConfig } from '../src/config.js';
import type { ChatRequest, ChatResult } from '../src/openai-client.js';

function agentResult(answer: string, model: string): AgentLoopResult {
  return {
    answer,
    model,
    iterations: 1,
    toolCalls: [],
    toolResults: [],
    finishReason: 'completed',
  };
}

const readOnlyTool = {
  name: 'readOnly',
  description: '読取専用',
  schema: { safeParse: () => ({ success: true, data: {} }) },
  hasSideEffect: false,
  execute: () => Promise.resolve('ok'),
} as unknown as ToolDefinition;

const sideEffectTool = {
  ...readOnlyTool,
  name: 'sideEffect',
  hasSideEffect: true,
} as ToolDefinition;

void test('runMultiAgent: 役割別モデルで調査、計画、統合を固定順に実行する', async () => {
  const calls: Array<{ model: string; question: string; tools: string[] }> = [];
  const finalCalls: Array<{ model: string; question: string }> = [];

  const result = await runMultiAgent({
    apiKey: 'key',
    baseModel: 'base-model',
    question: '依頼本文',
    messageId: 'msg-1',
    maxIterations: 3,
    models: {
      researchModel: 'research-model',
      plannerModel: 'planner-model',
      supervisorModel: 'supervisor-model',
    },
    deps: {
      tools: [readOnlyTool, sideEffectTool],
      runLoop: (options: AgentLoopOptions) => {
        calls.push({
          model: options.model,
          question: options.question,
          tools: options.tools.map((tool) => tool.name),
        });
        return Promise.resolve(
          calls.length === 1
            ? agentResult('調査結果', options.model)
            : agentResult('計画結果', options.model),
        );
      },
      requestFinalAnswer: (config: AppConfig, request: ChatRequest): Promise<ChatResult> => {
        finalCalls.push({ model: config.model, question: request.question });
        return Promise.resolve({
          answer: '最終回答',
          model: config.model,
          usage: null,
        });
      },
    },
  });

  assert.deepEqual(
    calls.map((call) => call.model),
    ['research-model', 'planner-model'],
  );
  assert.deepEqual(calls[0]?.tools, ['readOnly']);
  assert.deepEqual(calls[1]?.tools, []);
  assert.match(calls[1]?.question ?? '', /調査結果/);
  assert.deepEqual(finalCalls, [{ model: 'supervisor-model', question: finalCalls[0]!.question }]);
  assert.match(finalCalls[0]?.question ?? '', /調査結果/);
  assert.match(finalCalls[0]?.question ?? '', /計画結果/);
  assert.deepEqual(result, {
    answer: '最終回答',
    model: 'supervisor-model',
    requestedModel: 'supervisor-model',
    roles: [
      { role: 'researcher', model: 'research-model' },
      { role: 'planner', model: 'planner-model' },
      { role: 'supervisor', model: 'supervisor-model' },
    ],
  });
});

void test('runMultiAgent: 役割別モデル未指定時はベースモデルを使う', async () => {
  const models: string[] = [];

  const result = await runMultiAgent({
    apiKey: 'key',
    baseModel: 'base-model',
    question: '依頼本文',
    messageId: 'msg-1',
    maxIterations: 3,
    models: {
      researchModel: null,
      plannerModel: null,
      supervisorModel: null,
    },
    deps: {
      tools: [readOnlyTool],
      runLoop: (options: AgentLoopOptions) => {
        models.push(options.model);
        return Promise.resolve(agentResult(`${options.model} result`, options.model));
      },
      requestFinalAnswer: (config: AppConfig): Promise<ChatResult> => {
        models.push(config.model);
        return Promise.resolve({ answer: '最終回答', model: config.model, usage: null });
      },
    },
  });

  assert.deepEqual(models, ['base-model', 'base-model', 'base-model']);
  assert.equal(result.requestedModel, 'base-model');
});
