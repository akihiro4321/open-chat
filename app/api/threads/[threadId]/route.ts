import { z } from 'zod';

import { loadConfig } from '@/src/config.js';
import { deleteThread, getThread, updateThreadModel } from '@/src/threads.js';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ threadId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { threadId } = await context.params;
  const thread = await getThread(threadId);

  if (!thread) {
    return Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
  }

  const config = loadConfig();
  return Response.json({ ...thread, model: thread.model ?? config.model });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { threadId } = await context.params;
  const deleted = await deleteThread(threadId);

  return deleted
    ? new Response(null, { status: 204 })
    : Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
}

const updateModelSchema = z.object({ model: z.string().trim().min(1) });

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const parsed = updateModelSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ message: 'モデルを指定してください。' }, { status: 400 });
  }

  const config = loadConfig();

  if (!config.allowedModels.includes(parsed.data.model)) {
    return Response.json({ message: '許可されていないモデルです。' }, { status: 400 });
  }

  const { threadId } = await context.params;

  try {
    return Response.json(await updateThreadModel(threadId, parsed.data.model));
  } catch {
    return Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
  }
}
