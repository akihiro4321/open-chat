import type { z } from 'zod';

import type { ConversationMessage } from '../openai-client.js';

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<string>;
}

export interface AgentToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AgentToolResult {
  callId: string;
  name: string;
  output: string;
  isError: boolean;
}

export interface AgentLoopOptions {
  apiKey: string;
  model: string;
  instruction: string;
  question: string;
  history?: ReadonlyArray<ConversationMessage>;
  tools: ReadonlyArray<ToolDefinition>;
  maxIterations: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
}

export interface AgentLoopResult {
  answer: string;
  model: string;
  iterations: number;
  toolCalls: ReadonlyArray<AgentToolCall>;
  toolResults: ReadonlyArray<AgentToolResult>;
  finishReason: 'completed' | 'max_iterations' | 'cancelled' | 'failed';
}
