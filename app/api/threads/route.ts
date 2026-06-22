import { ConfigurationError, loadConfig } from '@/src/config.js';
import { createThread, listThreads } from '@/src/threads.js';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ threads: await listThreads() });
}

export async function POST(): Promise<Response> {
  try {
    const config = loadConfig();
    return Response.json(await createThread(config.model), { status: 201 });
  } catch (error: unknown) {
    const message =
      error instanceof ConfigurationError ? error.message : 'スレッドを作成できませんでした。';
    return Response.json({ message }, { status: 500 });
  }
}
