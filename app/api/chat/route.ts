import { chatRequestSchema } from '@/src/chat-protocol.js';
import { type AppConfig, ConfigurationError, loadConfig } from '@/src/config.js';
import { ApplicationError, GenerationCancelledError } from '@/src/errors.js';
import { selectRecentHistory } from '@/src/history.js';
import { requestAnswer, requestAnswerStreamWithFallback } from '@/src/openai-client.js';
import {
  beginGeneration,
  DEFAULT_THREAD_TITLE,
  finishGeneration,
  getPriorMessages,
  getThreadModel,
  markGenerationEnded,
  updateThreadTitle,
} from '@/src/threads.js';

export const runtime = 'nodejs';

const CHAT_INSTRUCTION = 'あなたは正確で簡潔な日本語で回答するアシスタントです。';

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

function publicErrorMessage(error: unknown): string {
  if (error instanceof ApplicationError || error instanceof ConfigurationError) {
    return error.message;
  }

  return '回答の生成中に予期しない問題が発生しました。';
}

export async function POST(request: Request): Promise<Response> {
  const parsedRequest = chatRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsedRequest.success) {
    return Response.json(
      { message: '質問を1文字以上10,000文字以内で入力してください。' },
      { status: 400 },
    );
  }

  let config;

  try {
    config = loadConfig();
  } catch (error: unknown) {
    return Response.json({ message: publicErrorMessage(error) }, { status: 500 });
  }

  const storedThread = await getThreadModel(parsedRequest.data.threadId);

  if (!storedThread) {
    return Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
  }

  const selectedModel = storedThread.model ?? config.model;

  if (!config.allowedModels.includes(selectedModel)) {
    return Response.json(
      { message: 'このスレッドで選択されているモデルは現在利用できません。' },
      { status: 400 },
    );
  }

  const selectedConfig = { apiKey: config.apiKey, model: selectedModel };

  const generation = await beginGeneration(
    parsedRequest.data.threadId,
    parsedRequest.data.requestId,
    parsedRequest.data.message,
  );

  if (!generation) {
    return Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
  }

  if (generation.duplicate || !generation.assistantMessage) {
    return Response.json({ message: '同じメッセージはすでに送信されています。' }, { status: 409 });
  }

  const assistantMessage = generation.assistantMessage;
  const storedMessages = await getPriorMessages(parsedRequest.data.threadId, [
    generation.userMessage.id,
    assistantMessage.id,
  ]);
  const history = selectRecentHistory(
    storedMessages.flatMap((message) =>
      message.role === 'user' || message.role === 'assistant'
        ? [{ ...message, role: message.role }]
        : [],
    ),
  );

  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  let isClosed = false;
  let streamedAnswer = '';
  const stream = new ReadableStream<Uint8Array>({
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
        selectedConfig,
        config.fallbackModel,
        {
          instruction: CHAT_INSTRUCTION,
          question: parsedRequest.data.message,
          history,
        },
        {
          onTextDelta: (delta) => {
            streamedAnswer += delta;
            send({ type: 'delta', delta });
          },
          signal: AbortSignal.any([request.signal, streamAbortController.signal]),
        },
      )
        .then(async (result) => {
          await finishGeneration(
            assistantMessage.id,
            result.answer,
            result.model,
            result.usage,
            result.requestedModel,
            result.fallbackUsed,
          );
          const title =
            generation.thread.title === DEFAULT_THREAD_TITLE
              ? await generateThreadTitle(selectedConfig, parsedRequest.data.message)
              : generation.thread.title;

          if (title !== generation.thread.title) {
            await updateThreadTitle(parsedRequest.data.threadId, title);
          }

          send({
            type: 'done',
            assistantMessageId: assistantMessage.id,
            threadTitle: title,
            model: result.model,
            requestedModel: result.requestedModel,
            fallbackUsed: result.fallbackUsed,
            usage: result.usage,
          });
        })
        .catch(async (error: unknown) => {
          const cancelled = error instanceof GenerationCancelledError;
          await markGenerationEnded(
            assistantMessage.id,
            streamedAnswer,
            cancelled ? 'cancelled' : 'failed',
          ).catch(() => undefined);

          if (!cancelled) {
            send({ type: 'error', message: publicErrorMessage(error) });
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

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
