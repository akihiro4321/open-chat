import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { ZodError } from 'zod';

import { ApplicationError, GenerationCancelledError } from '../errors.js';
import { requestAnswerStreamWithTools, type StreamToolCall } from '../openai-client.js';
import { toOpenAITools } from './schema.js';
import type {
  AgentLoopOptions,
  AgentLoopResult,
  AgentToolCall,
  AgentToolResult,
  ToolDefinition,
} from './types.js';

interface ExecuteToolInput {
  call: StreamToolCall;
  registry: ReadonlyMap<string, ToolDefinition>;
}

interface ExecuteToolOutput {
  callId: string;
  name: string;
  output: string;
  isError: boolean;
}

function buildInitialInput(
  question: string,
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> | undefined,
): string | ResponseInputItem[] {
  if (!history || history.length === 0) {
    return question;
  }

  const items: ResponseInputItem[] = history.map((message) => ({
    type: 'message',
    role: message.role,
    content: message.content,
  }));
  items.push({ type: 'message', role: 'user', content: question });
  return items;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApplicationError) {
    return `[error:${error.category}] ${error.message}`;
  }

  if (error instanceof ZodError) {
    return `[error:invalid_request] 引数がスキーマと一致しません: ${error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')}`;
  }

  if (error instanceof Error) {
    return `[error:unknown] ${error.message}`;
  }

  return `[error:unknown] ${String(error)}`;
}

async function executeTool(input: ExecuteToolInput): Promise<ExecuteToolOutput> {
  const tool = input.registry.get(input.call.name);

  if (!tool) {
    return {
      callId: input.call.callId,
      name: input.call.name,
      output: `未知のツールです: ${input.call.name}`,
      isError: true,
    };
  }

  let parsedArguments: unknown;

  try {
    parsedArguments = JSON.parse(input.call.arguments);
  } catch (error: unknown) {
    return {
      callId: input.call.callId,
      name: input.call.name,
      output: toErrorMessage(
        new ApplicationError('invalid_request', 'ツール引数のJSONパースに失敗しました。', {
          cause: error,
        }),
      ),
      isError: true,
    };
  }

  const validation = tool.schema.safeParse(parsedArguments);

  if (!validation.success) {
    return {
      callId: input.call.callId,
      name: input.call.name,
      output: toErrorMessage(validation.error),
      isError: true,
    };
  }

  try {
    const output = await tool.execute(validation.data);

    return {
      callId: input.call.callId,
      name: input.call.name,
      output,
      isError: false,
    };
  } catch (error: unknown) {
    return {
      callId: input.call.callId,
      name: input.call.name,
      output: toErrorMessage(error),
      isError: true,
    };
  }
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const registry = new Map<string, ToolDefinition>();

  for (const tool of options.tools) {
    registry.set(tool.name, tool);
  }

  const openAITools = toOpenAITools(options.tools);
  const allToolCalls: AgentToolCall[] = [];
  const allToolResults: AgentToolResult[] = [];
  let currentInput: string | ResponseInputItem[] = buildInitialInput(
    options.question,
    options.history,
  );
  let finalAnswer = '';
  let finalModel = options.model;
  let iterations = 0;
  let finishReason: AgentLoopResult['finishReason'] = 'completed';

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    iterations = iteration + 1;

    if (options.signal?.aborted) {
      throw new GenerationCancelledError();
    }

    let streamResult;

    try {
      streamResult = await requestAnswerStreamWithTools(
        { apiKey: options.apiKey, model: options.model },
        {
          instruction: options.instruction,
          input: currentInput,
          tools: openAITools,
          parallelToolCalls: true,
        },
        options.signal
          ? {
              onTextDelta: (delta) => {
                options.onTextDelta?.(delta);
              },
              signal: options.signal,
            }
          : {
              onTextDelta: (delta) => {
                options.onTextDelta?.(delta);
              },
            },
      );
    } catch (error: unknown) {
      if (error instanceof GenerationCancelledError) {
        throw error;
      }

      throw error;
    }

    finalModel = streamResult.model;
    finalAnswer = streamResult.answer;

    if (streamResult.toolCalls.length === 0) {
      finishReason = 'completed';
      break;
    }

    const executed = await Promise.all(
      streamResult.toolCalls.map((call) =>
        executeTool({ call, registry }).then((result) => ({ call, result })),
      ),
    );

    const nextItems: ResponseInputItem[] = Array.isArray(currentInput) ? [...currentInput] : [];

    for (const { call, result } of executed) {
      allToolCalls.push({
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      });
      allToolResults.push({
        callId: result.callId,
        name: result.name,
        output: result.output,
        isError: result.isError,
      });

      nextItems.push({
        type: 'function_call',
        id: call.callId,
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      });
      nextItems.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: result.output,
      });
    }

    currentInput = nextItems;
  }

  if (finishReason === 'completed' && iterations >= options.maxIterations) {
    finishReason = 'max_iterations';
    finalAnswer = finalAnswer || 'ツール呼出しが上限に達したため、回答を生成できませんでした。';
  }

  return {
    answer: finalAnswer,
    model: finalModel,
    iterations,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    finishReason,
  };
}
