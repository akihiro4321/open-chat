import OpenAI from 'openai';

import type { AppConfig } from './config.js';

export interface ChatRequest {
  instruction: string;
  question: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  answer: string;
  model: string;
  usage: TokenUsage | null;
}

export async function requestAnswer(config: AppConfig, request: ChatRequest): Promise<ChatResult> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    // 再試行条件と回数はバッチ2でアプリケーション側に明示する。
    maxRetries: 0,
  });
  const response = await client.responses.create({
    model: config.model,
    instructions: request.instruction,
    input: request.question,
  });
  const answer = response.output_text.trim();

  if (!answer) {
    throw new Error('OpenAIから回答本文を取得できませんでした。');
  }

  return {
    answer,
    model: response.model,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null,
  };
}
