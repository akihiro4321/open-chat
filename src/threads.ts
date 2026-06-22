import { prisma } from './database.js';
import type { TokenUsage } from './openai-client.js';

export const DEFAULT_THREAD_TITLE = '新しいチャット';

export async function listThreads() {
  return prisma.thread.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

export async function createThread() {
  return prisma.thread.create({ data: {}, select: { id: true, title: true } });
}

export async function getThread(threadId: string) {
  return prisma.thread.findUnique({
    where: { id: threadId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { modelRun: true },
      },
    },
  });
}

export async function deleteThread(threadId: string): Promise<boolean> {
  const result = await prisma.thread.deleteMany({ where: { id: threadId } });
  return result.count > 0;
}

export async function beginGeneration(threadId: string, requestId: string, question: string) {
  return prisma.$transaction(async (transaction) => {
    const thread = await transaction.thread.findUnique({ where: { id: threadId } });

    if (!thread) {
      return null;
    }

    const existing = await transaction.message.findUnique({ where: { requestId } });

    if (existing) {
      return { duplicate: true as const, thread, userMessage: existing, assistantMessage: null };
    }

    const userMessage = await transaction.message.create({
      data: { threadId, requestId, role: 'user', content: question, status: 'completed' },
    });
    const assistantMessage = await transaction.message.create({
      data: { threadId, role: 'assistant', content: '', status: 'streaming' },
    });
    await transaction.thread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

    return { duplicate: false as const, thread, userMessage, assistantMessage };
  });
}

export async function getPriorMessages(threadId: string, excludedMessageIds: string[]) {
  return prisma.message.findMany({
    where: { threadId, id: { notIn: excludedMessageIds } },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, status: true },
  });
}

export async function finishGeneration(
  messageId: string,
  content: string,
  model: string,
  usage: TokenUsage | null,
) {
  return prisma.message.update({
    where: { id: messageId },
    data: {
      content,
      status: 'completed',
      modelRun: {
        create: {
          model,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
        },
      },
    },
  });
}

export async function markGenerationEnded(
  messageId: string,
  content: string,
  status: 'cancelled' | 'failed',
) {
  return prisma.message.update({ where: { id: messageId }, data: { content, status } });
}

export async function updateThreadTitle(threadId: string, title: string) {
  return prisma.thread.update({ where: { id: threadId }, data: { title } });
}
