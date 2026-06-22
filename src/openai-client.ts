import OpenAI from 'openai';

import type { AppConfig } from './config.js';
import { ApplicationError, classifyOpenAIError, GenerationCancelledError } from './errors.js';
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

export interface StreamOptions {
  onTextDelta: (delta: string) => void;
  signal?: AbortSignal;
}

function createClient(config: AppConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    logLevel: 'off',
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

function toTokenUsage(
  usage:
    | {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
      }
    | null
    | undefined,
): TokenUsage | null {
  return usage
    ? {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
      }
    : null;
}

export async function requestAnswer(config: AppConfig, request: ChatRequest): Promise<ChatResult> {
  const client = createClient(config);

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
          usage: toTokenUsage(response.usage),
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

export async function requestAnswerStream(
  config: AppConfig,
  request: ChatRequest,
  options: StreamOptions,
): Promise<ChatResult> {
  const client = createClient(config);

  return withRetry(
    async () => {
      let answer = '';
      let completedResult: ChatResult | undefined;

      try {
        const stream = await client.responses.create(
          {
            model: config.model,
            instructions: request.instruction,
            input: request.question,
            stream: true,
          },
          { signal: options.signal },
        );

        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            answer += event.delta;
            options.onTextDelta(event.delta);
            continue;
          }

          if (event.type === 'response.completed') {
            completedResult = {
              answer: answer.trim(),
              model: event.response.model,
              usage: toTokenUsage(event.response.usage),
            };
            continue;
          }

          if (event.type === 'response.failed') {
            throw new ApplicationError(
              'service_unavailable',
              'OpenAI APIで回答生成に失敗しました。',
              { retryable: answer.length === 0 },
            );
          }

          if (event.type === 'response.incomplete') {
            throw new ApplicationError(
              'invalid_response',
              'OpenAIからの回答生成が完了しませんでした。',
            );
          }

          if (event.type === 'error') {
            throw new ApplicationError('unknown', 'OpenAI APIで回答生成に失敗しました。');
          }
        }

        if (!completedResult || !completedResult.answer) {
          throw new ApplicationError(
            'invalid_response',
            'OpenAIから回答本文を取得できませんでした。',
          );
        }

        return completedResult;
      } catch (error: unknown) {
        if (options.signal?.aborted) {
          throw new GenerationCancelledError();
        }

        const applicationError = classifyOpenAIError(error);

        if (answer.length > 0 && applicationError.retryable) {
          throw new ApplicationError(applicationError.category, applicationError.message, {
            cause: applicationError,
          });
        }

        throw applicationError;
      }
    },
    {
      maxRetries: MAX_RETRIES,
      initialDelayMs: INITIAL_RETRY_DELAY_MS,
      maxDelayMs: MAX_RETRY_DELAY_MS,
    },
  );
}
