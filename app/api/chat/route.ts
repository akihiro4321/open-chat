import {
  createChatStream,
  prepareChatGeneration,
  publicChatErrorMessage,
  publicChatErrorStatus,
} from '@/src/chat/chat-service.js';
import { chatRequestSchema } from '@/src/chat-protocol.js';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const parsedRequest = chatRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsedRequest.success) {
    return Response.json(
      { message: '質問を1文字以上10,000文字以内で入力してください。' },
      { status: 400 },
    );
  }

  try {
    const preparedGeneration = await prepareChatGeneration({
      threadId: parsedRequest.data.threadId,
      requestId: parsedRequest.data.requestId,
      message: parsedRequest.data.message,
      mode: parsedRequest.data.mode,
    });

    return new Response(createChatStream(preparedGeneration, request.signal), {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: unknown) {
    return Response.json(
      { message: publicChatErrorMessage(error) },
      { status: publicChatErrorStatus(error) },
    );
  }
}
