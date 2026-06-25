import { type AppConfig, ConfigurationError, loadConfig, loadRagConfig } from '@/src/config.js';
import { ApplicationError, GenerationCancelledError } from '@/src/errors.js';
import { selectRecentHistory } from '@/src/history.js';
import type { ConversationMessage } from '@/src/openai-client.js';
import { requestAnswer, requestAnswerStreamWithFallback } from '@/src/openai-client.js';
import {
  buildRagInstruction,
  buildRagQuestion,
  type RagSourceReference,
  retrieveRagContext,
} from '@/src/rag/index.js';
import {
  beginGeneration,
  DEFAULT_THREAD_TITLE,
  finishGeneration,
  getPriorMessages,
  getThreadModel,
  markGenerationEnded,
  updateThreadTitle,
} from '@/src/threads.js';

const CHAT_INSTRUCTION = 'あなたは正確で簡潔な日本語で回答するアシスタントです。';

export interface PreparedRagChatRequest {
  instruction: string;
  question: string;
  sources: RagSourceReference[];
}

export interface PrepareChatGenerationInput {
  threadId: string;
  requestId: string;
  message: string;
}

export interface PreparedChatGeneration {
  assistantMessageId: string;
  fallbackModel: string | null;
  history: ConversationMessage[];
  originalQuestion: string;
  ragRequest: PreparedRagChatRequest;
  selectedConfig: AppConfig;
  threadId: string;
  threadTitle: string;
}

export class ChatServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChatServiceError';
    this.status = status;
  }
}

export function publicChatErrorMessage(error: unknown): string {
  if (
    error instanceof ApplicationError ||
    error instanceof ChatServiceError ||
    error instanceof ConfigurationError
  ) {
    return error.message;
  }

  return '回答の生成中に予期しない問題が発生しました。';
}

export function publicChatErrorStatus(error: unknown): number {
  if (error instanceof ChatServiceError) {
    return error.status;
  }

  if (error instanceof ApplicationError && error.category === 'invalid_request') {
    return 400;
  }

  return 500;
}

function toRagSourceReference(chunk: RagSourceReference): RagSourceReference {
  return {
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    sourcePath: chunk.sourcePath,
    sourceName: chunk.sourceName,
    sequence: chunk.sequence,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    score: chunk.score,
  };
}

async function prepareRagChatRequest(question: string): Promise<PreparedRagChatRequest> {
  const ragConfig = loadRagConfig();
  const ragChunks = await retrieveRagContext({
    apiKey: ragConfig.apiKey,
    embeddingModel: ragConfig.embeddingModel,
    embeddingDimensions: ragConfig.embeddingDimensions,
    lancedbDir: ragConfig.lancedbDir,
    question,
    topK: ragConfig.topK,
  });

  return {
    instruction: buildRagInstruction(CHAT_INSTRUCTION),
    question: buildRagQuestion(question, ragChunks),
    sources: ragChunks.map(toRagSourceReference),
  };
}

function fallbackTitle(question: string): string {
  const normalized = question.replaceAll(/\s+/g, ' ').trim();
  return normalized.length <= 30 ? normalized : `${normalized.slice(0, 29)}…`;
}

async function generateThreadTitle(config: AppConfig, question: string): Promise<string> {
  try {
    const result = await requestAnswer(config, {
      instruction:
        '会話の最初の質問を表す日本語の短いタイトルだけを返してください。引用符や句点は不要で、30文字以内にしてください。',
      question,
    });
    const title = result.answer
      .replaceAll(/[「」『』"']/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim();
    return title ? title.slice(0, 30) : fallbackTitle(question);
  } catch {
    return fallbackTitle(question);
  }
}

export async function prepareChatGeneration(
  input: PrepareChatGenerationInput,
): Promise<PreparedChatGeneration> {
  const config = loadConfig();
  const storedThread = await getThreadModel(input.threadId);

  if (!storedThread) {
    throw new ChatServiceError(404, '指定されたスレッドが見つかりません。');
  }

  const selectedModel = storedThread.model ?? config.model;

  if (!config.allowedModels.includes(selectedModel)) {
    throw new ChatServiceError(400, 'このスレッドで選択されているモデルは現在利用できません。');
  }

  const ragRequest = await prepareRagChatRequest(input.message);
  const generation = await beginGeneration(input.threadId, input.requestId, input.message);

  if (!generation) {
    throw new ChatServiceError(404, '指定されたスレッドが見つかりません。');
  }

  if (generation.duplicate || !generation.assistantMessage) {
    throw new ChatServiceError(409, '同じメッセージはすでに送信されています。');
  }

  const storedMessages = await getPriorMessages(input.threadId, [
    generation.userMessage.id,
    generation.assistantMessage.id,
  ]);
  const history = selectRecentHistory(
    storedMessages.flatMap((message) =>
      message.role === 'user' || message.role === 'assistant'
        ? [{ ...message, role: message.role }]
        : [],
    ),
  );

  return {
    assistantMessageId: generation.assistantMessage.id,
    fallbackModel: config.fallbackModel,
    history,
    originalQuestion: input.message,
    ragRequest,
    selectedConfig: { apiKey: config.apiKey, model: selectedModel },
    threadId: input.threadId,
    threadTitle: generation.thread.title,
  };
}

export function createChatStream(
  input: PreparedChatGeneration,
  requestSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  let isClosed = false;
  let streamedAnswer = '';

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object): void => {
        if (isClosed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          isClosed = true;
          streamAbortController.abort();
        }
      };

      void requestAnswerStreamWithFallback(
        input.selectedConfig,
        input.fallbackModel,
        {
          instruction: input.ragRequest.instruction,
          question: input.ragRequest.question,
          history: input.history,
        },
        {
          onTextDelta: (delta) => {
            streamedAnswer += delta;
            send({ type: 'delta', delta });
          },
          signal: AbortSignal.any([requestSignal, streamAbortController.signal]),
        },
      )
        .then(async (result) => {
          await finishGeneration(
            input.assistantMessageId,
            result.answer,
            result.model,
            result.usage,
            result.requestedModel,
            result.fallbackUsed,
          );
          const title =
            input.threadTitle === DEFAULT_THREAD_TITLE
              ? await generateThreadTitle(input.selectedConfig, input.originalQuestion)
              : input.threadTitle;

          if (title !== input.threadTitle) {
            await updateThreadTitle(input.threadId, title);
          }

          send({
            type: 'done',
            assistantMessageId: input.assistantMessageId,
            threadTitle: title,
            model: result.model,
            requestedModel: result.requestedModel,
            fallbackUsed: result.fallbackUsed,
            usage: result.usage,
            sources: input.ragRequest.sources,
          });
        })
        .catch(async (error: unknown) => {
          const cancelled = error instanceof GenerationCancelledError;
          await markGenerationEnded(
            input.assistantMessageId,
            streamedAnswer,
            cancelled ? 'cancelled' : 'failed',
          ).catch(() => undefined);

          if (!cancelled) {
            send({ type: 'error', message: publicChatErrorMessage(error) });
          }
        })
        .finally(() => {
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        });
    },
    cancel() {
      isClosed = true;
      streamAbortController.abort();
    },
  });
}
