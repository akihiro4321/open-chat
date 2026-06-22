import OpenAI from 'openai';

import type { AppConfig } from './config.js';
import { ApplicationError, classifyOpenAIError } from './errors.js';
import { withRetry } from './retry.js';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 4_000;

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
    logLevel: 'off',
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });

  return withRetry(
    async () => {
      try {
        const response = await client.responses.create({
          model: config.model,
          instructions: request.instruction,
          input: request.question,
        });
        const answer = response.output_text.trim();

        if (!answer) {
          throw new ApplicationError(
            'invalid_response',
            'OpenAIから回答本文を取得できませんでした。',
          );
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
      } catch (error: unknown) {
        throw classifyOpenAIError(error);
      }
    },
    {
      maxRetries: MAX_RETRIES,
      initialDelayMs: INITIAL_RETRY_DELAY_MS,
      maxDelayMs: MAX_RETRY_DELAY_MS,
    },
  );
}
