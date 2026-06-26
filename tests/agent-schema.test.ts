import assert from 'node:assert/strict';
import test from 'node:test';

import { toOpenAITool, toOpenAITools } from '../src/agent/schema.js';
import { defaultTools } from '../src/agent/tools.js';

void test('toOpenAITool: ZodスキーマをOpenAI Function形式に変換する', () => {
  const tool = defaultTools[0];
  assert.ok(tool);

  const openAITool = toOpenAITool(tool);

  assert.equal(openAITool.type, 'function');
  assert.equal(openAITool.name, 'getCurrentTime');
  assert.equal(openAITool.strict, true);
  assert.equal(typeof openAITool.description, 'string');
  assert.ok(openAITool.description.length > 0);
  assert.ok(typeof openAITool.parameters === 'object');
});

void test('toOpenAITool: parametersにZodスキーマのフィールドが反映される', () => {
  const tool = defaultTools[0];
  assert.ok(tool);

  const parameters = toOpenAITool(tool).parameters as Record<string, unknown>;
  const properties = parameters.properties as Record<string, Record<string, unknown>>;

  assert.equal(properties.timezone?.type, 'string');
});

void test('toOpenAITools: 複数ツールを配列に変換する', () => {
  const openAITools = toOpenAITools(defaultTools);

  assert.equal(openAITools.length, defaultTools.length);
  for (const tool of openAITools) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.strict, true);
  }
});
