import { z } from 'zod';

import { resumeAgentLoop } from '@/src/chat/chat-service.js';
import { loadConfig } from '@/src/config.js';

export const runtime = 'nodejs';

const approveRequestSchema = z.object({
  action: z.enum(['approve', 'reject']),
  agentRunId: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  const parsedRequest = approveRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsedRequest.success) {
    return Response.json(
      { message: 'action（approve/reject）と agentRunId を指定してください。' },
      { status: 400 },
    );
  }

  try {
    const config = loadConfig();
    const result = await resumeAgentLoop({
      agentRunId: parsedRequest.data.agentRunId,
      action: parsedRequest.data.action,
      config: { apiKey: config.apiKey, model: config.model },
    });

    return Response.json({ answer: result.answer, model: result.model });
  } catch (error: unknown) {
    const status =
      error instanceof Error && 'status' in error
        ? (error as unknown as { status: number }).status
        : 500;

    return Response.json(
      { message: error instanceof Error ? error.message : '承認処理に失敗しました。' },
      { status },
    );
  }
}
