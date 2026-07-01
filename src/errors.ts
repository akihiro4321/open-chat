import OpenAI from 'openai';

export type ErrorCategory =
  | 'authentication'
  | 'permission'
  | 'invalid_request'
  | 'rate_limit'
  | 'timeout'
  | 'connection'
  | 'service_unavailable'
  | 'refusal'
  | 'incomplete_response'
  | 'invalid_response'
  | 'unknown';

interface ApplicationErrorOptions {
  cause?: unknown;
  retryable?: boolean;
}

export class ApplicationError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;

  constructor(category: ErrorCategory, message: string, options: ApplicationErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'ApplicationError';
    this.category = category;
    this.retryable = options.retryable ?? false;
  }
}

export class GenerationCancelledError extends Error {
  constructor() {
    super('回答生成を中断しました。');
    this.name = 'GenerationCancelledError';
  }
}

export class WaitingApprovalError extends Error {
  readonly agentRunId: string;

  constructor(agentRunId: string) {
    super('副作用ツールの承認待ちです。');
    this.name = 'WaitingApprovalError';
    this.agentRunId = agentRunId;
  }
}

export function classifyOpenAIError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof OpenAI.AuthenticationError) {
    return new ApplicationError(
      'authentication',
      'OpenAI APIの認証に失敗しました。OPENAI_API_KEYを確認してください。',
      { cause: error },
    );
  }

  if (error instanceof OpenAI.PermissionDeniedError) {
    return new ApplicationError(
      'permission',
      'OpenAI APIまたは指定モデルを利用する権限がありません。APIキーとモデル設定を確認してください。',
      { cause: error },
    );
  }

  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof OpenAI.NotFoundError ||
    error instanceof OpenAI.UnprocessableEntityError
  ) {
    return new ApplicationError(
      'invalid_request',
      'OpenAI APIへのリクエストが受け付けられませんでした。質問とOPENAI_MODELを確認してください。',
      { cause: error },
    );
  }

  if (error instanceof OpenAI.RateLimitError) {
    return new ApplicationError(
      'rate_limit',
      'OpenAI APIの利用制限に達しました。時間を置いて再実行してください。',
      { cause: error, retryable: true },
    );
  }

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ApplicationError('timeout', 'OpenAI APIから制限時間内に応答がありませんでした。', {
      cause: error,
      retryable: true,
    });
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return new ApplicationError(
      'connection',
      'OpenAI APIへ接続できませんでした。ネットワーク接続を確認してください。',
      { cause: error, retryable: true },
    );
  }

  if (error instanceof OpenAI.ConflictError || error instanceof OpenAI.InternalServerError) {
    return new ApplicationError('service_unavailable', 'OpenAI APIで一時的な問題が発生しました。', {
      cause: error,
      retryable: true,
    });
  }

  if (error instanceof OpenAI.APIError) {
    const retryable =
      error.status === 408 ||
      error.status === 409 ||
      error.status === 429 ||
      (typeof error.status === 'number' && error.status >= 500);

    return new ApplicationError(
      retryable ? 'service_unavailable' : 'unknown',
      retryable
        ? 'OpenAI APIで一時的な問題が発生しました。'
        : 'OpenAI APIへの問い合わせに失敗しました。',
      { cause: error, retryable },
    );
  }

  return new ApplicationError('unknown', '予期しないエラーが発生しました。', {
    cause: error,
  });
}

export function markRetryExhausted(error: ApplicationError): ApplicationError {
  return new ApplicationError(
    error.category,
    `${error.message} 再試行しても回復しませんでした。時間を置いて再実行してください。`,
    { cause: error },
  );
}
