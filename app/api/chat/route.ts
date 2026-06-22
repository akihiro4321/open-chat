import { chatRequestSchema } from '../../../src/chat-protocol.js';
import { ConfigurationError, loadConfig } from '../../../src/config.js';
import { ApplicationError, GenerationCancelledError } from '../../../src/errors.js';
import { requestAnswerStream } from '../../../src/openai-client.js';

export const runtime = 'nodejs';

const CHAT_INSTRUCTION = 'あなたは正確で簡潔な日本語で回答するアシスタントです。';

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

  const encoder = new TextEncoder();
  const streamAbortController = new AbortController();
  let isClosed = false;
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

      void requestAnswerStream(
        config,
        {
          instruction: CHAT_INSTRUCTION,
          question: parsedRequest.data.message,
        },
        {
          onTextDelta: (delta) => send({ type: 'delta', delta }),
          signal: AbortSignal.any([request.signal, streamAbortController.signal]),
        },
      )
        .then((result) => {
          send({ type: 'done', model: result.model, usage: result.usage });
        })
        .catch((error: unknown) => {
          if (!(error instanceof GenerationCancelledError)) {
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
