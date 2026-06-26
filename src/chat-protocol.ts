import { z } from 'zod';

export const chatModeSchema = z.enum(['static', 'agent']);

export const chatRequestSchema = z.object({
  threadId: z.string().min(1),
  requestId: z.uuid(),
  message: z.string().trim().min(1).max(10_000),
  mode: chatModeSchema.optional(),
});

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

const ragSourceSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  sourcePath: z.string(),
  sourceName: z.string(),
  sequence: z.number().int().nonnegative(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  score: z.number().nullable(),
});

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), delta: z.string() }),
  z.object({
    type: z.literal('done'),
    assistantMessageId: z.string(),
    threadTitle: z.string(),
    model: z.string(),
    requestedModel: z.string(),
    fallbackUsed: z.boolean(),
    usage: tokenUsageSchema.nullable(),
    sources: z.array(ragSourceSchema),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
export type ChatMode = z.infer<typeof chatModeSchema>;
