import { ApplicationError, markRetryExhausted } from './errors.js';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let retryCount = 0;

  while (true) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof ApplicationError) || !error.retryable) {
        throw error;
      }

      if (retryCount >= options.maxRetries) {
        throw markRetryExhausted(error);
      }

      const delayMs = Math.min(options.initialDelayMs * 2 ** retryCount, options.maxDelayMs);
      retryCount += 1;
      await sleep(delayMs);
    }
  }
}
