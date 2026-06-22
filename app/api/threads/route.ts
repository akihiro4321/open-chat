import { createThread, listThreads } from '../../../src/threads.js';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ threads: await listThreads() });
}

export async function POST(): Promise<Response> {
  return Response.json(await createThread(), { status: 201 });
}
