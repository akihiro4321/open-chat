import { deleteThread, getThread } from '../../../../src/threads.js';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ threadId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { threadId } = await context.params;
  const thread = await getThread(threadId);

  return thread
    ? Response.json(thread)
    : Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { threadId } = await context.params;
  const deleted = await deleteThread(threadId);

  return deleted
    ? new Response(null, { status: 204 })
    : Response.json({ message: '指定されたスレッドが見つかりません。' }, { status: 404 });
}
