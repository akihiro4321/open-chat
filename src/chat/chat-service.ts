import type { ResponseInputItem } from 'openai/resources/responses/responses';

import { defaultTools, runAgentLoop } from '@/src/agent/index.js';
import {
  deserializeAgentRunInput,
  loadAgentRun,
  rejectAgentRun,
  resolveApproval,
  updateAgentRunStatus,
} from '@/src/agent/persistence.js';
import { toOpenAITools } from '@/src/agent/schema.js';
import type { AgentToolCall, AgentToolResult } from '@/src/agent/types.js';
import type { ChatMode } from '@/src/chat-protocol.js';
import {
  type AppConfig,
  ConfigurationError,
  loadAgentConfig,
  loadConfig,
  loadRagConfig,
} from '@/src/config.js';
import { ApplicationError, GenerationCancelledError, WaitingApprovalError } from '@/src/errors.js';
import { selectRecentHistory } from '@/src/history.js';
import type { ConversationMessage } from '@/src/openai-client.js';
import {
  requestAnswer,
  requestAnswerStreamWithFallback,
  requestAnswerStreamWithTools,
} from '@/src/openai-client.js';
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
  mode: ChatMode | undefined;
}

export interface PreparedChatGeneration {
  assistantMessageId: string;
  fallbackModel: string | null;
  history: ConversationMessage[];
  originalQuestion: string;
  mode: ChatMode;
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
    keywordRank: chunk.keywordRank ?? null,
    keywordScore: chunk.keywordScore ?? null,
    vectorRank: chunk.vectorRank ?? null,
    vectorScore: chunk.vectorScore ?? null,
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
    retrievalMode: ragConfig.retrievalMode,
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
  const mode: ChatMode = input.mode ?? 'static';
  const storedThread = await getThreadModel(input.threadId);

  if (!storedThread) {
    throw new ChatServiceError(404, '指定されたスレッドが見つかりません。');
  }

  const selectedModel = storedThread.model ?? config.model;

  if (!config.allowedModels.includes(selectedModel)) {
    throw new ChatServiceError(400, 'このスレッドで選択されているモデルは現在利用できません。');
  }

  const ragRequest =
    mode === 'static'
      ? await prepareRagChatRequest(input.message)
      : { instruction: CHAT_INSTRUCTION, question: input.message, sources: [] };
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
    mode,
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
  if (input.mode === 'agent' || input.mode === 'propose') {
    return createAgentChatStream(input, requestSignal);
  }

  return createStaticChatStream(input, requestSignal);
}

function createStaticChatStream(
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

function createAgentChatStream(
  input: PreparedChatGeneration,
  requestSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  let isClosed = false;
  let streamedAnswer = '';
  const agentConfig = loadAgentConfig();

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

      void runAgentLoop({
        apiKey: input.selectedConfig.apiKey,
        model: input.selectedConfig.model,
        instruction: input.ragRequest.instruction,
        question: input.originalQuestion,
        messageId: input.assistantMessageId,
        history: input.history,
        tools: defaultTools,
        maxIterations: agentConfig.maxIterations,
        signal: AbortSignal.any([requestSignal, streamAbortController.signal]),
        onTextDelta: (delta) => {
          streamedAnswer += delta;
          send({ type: 'delta', delta });
        },
      })
        .then(async (result) => {
          await finishGeneration(
            input.assistantMessageId,
            result.answer,
            result.model,
            null,
            input.selectedConfig.model,
            false,
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
            requestedModel: input.selectedConfig.model,
            fallbackUsed: false,
            usage: null,
            sources: [],
          });
        })
        .catch(async (error: unknown) => {
          if (error instanceof WaitingApprovalError) {
            await markGenerationEnded(input.assistantMessageId, streamedAnswer, 'failed').catch(
              () => undefined,
            );

            send({
              type: 'waiting_approval',
              assistantMessageId: input.assistantMessageId,
              threadTitle: input.threadTitle,
              model: input.selectedConfig.model,
              agentRunId: error.agentRunId,
            });
          } else {
            const cancelled = error instanceof GenerationCancelledError;
            await markGenerationEnded(
              input.assistantMessageId,
              streamedAnswer,
              cancelled ? 'cancelled' : 'failed',
            ).catch(() => undefined);

            if (!cancelled) {
              send({ type: 'error', message: publicChatErrorMessage(error) });
            }
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

export async function resumeAgentLoop(input: {
  agentRunId: string;
  action: 'approve' | 'reject';
  config: AppConfig;
}): Promise<{ answer: string; model: string }> {
  const agentRun = await loadAgentRun(input.agentRunId);

  if (!agentRun) {
    throw new ChatServiceError(404, '承認待ちのエージェント実行が見つかりません。');
  }

  if (agentRun.status !== 'waiting_approval') {
    throw new ChatServiceError(409, 'このエージェント実行はすでに処理されています。');
  }

  if (input.action === 'reject') {
    await rejectAgentRun(input.agentRunId);
    return { answer: 'ツールの実行が却下されました。', model: agentRun.model };
  }

  const pendingCallIds: string[] = JSON.parse(agentRun.pendingCallIdsJson) as string[];
  const toolCalls: AgentToolCall[] = JSON.parse(agentRun.toolCallsJson) as AgentToolCall[];
  const toolResults: AgentToolResult[] = JSON.parse(agentRun.toolResultsJson) as AgentToolResult[];
  const pendingToolCalls = toolCalls.filter((tc) => pendingCallIds.includes(tc.callId));
  const openAITools = toOpenAITools(defaultTools);

  for (const toolCall of pendingToolCalls) {
    await resolveApproval(toolCall.callId, 'approved');

    const tool = defaultTools.find((t) => t.name === toolCall.name);

    if (tool) {
      try {
        const parsed = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        const output = await tool.execute(parsed);
        toolResults.push({
          callId: toolCall.callId,
          name: toolCall.name,
          output,
          isError: false,
        });
      } catch (error: unknown) {
        toolResults.push({
          callId: toolCall.callId,
          name: toolCall.name,
          output: error instanceof Error ? error.message : String(error),
          isError: true,
        });
      }
    }
  }

  const currentInput = deserializeAgentRunInput(agentRun.currentInputJson);
  const nextItems: ResponseInputItem[] = Array.isArray(currentInput) ? [...currentInput] : [];

  for (const tc of toolCalls) {
    if (!pendingCallIds.includes(tc.callId)) continue;
    nextItems.push({
      type: 'function_call',
      id: tc.callId,
      call_id: tc.callId,
      name: tc.name,
      arguments: tc.arguments,
    });
  }

  for (const tr of toolResults) {
    if (!pendingCallIds.includes(tr.callId)) continue;
    nextItems.push({
      type: 'function_call_output',
      call_id: tr.callId,
      output: tr.output,
    });
  }

  const streamResult = await requestAnswerStreamWithTools(
    input.config,
    {
      instruction: CHAT_INSTRUCTION,
      input: nextItems,
      tools: openAITools,
      parallelToolCalls: true,
    },
    {
      onTextDelta: () => undefined,
    },
  );

  await updateAgentRunStatus(input.agentRunId, 'completed');

  return { answer: streamResult.answer, model: streamResult.model };
}
