import type OpenAI from 'openai';
import { z } from 'zod';

import type { ToolDefinition } from './types.js';

export interface OpenAITool {
  type: 'function';
  name: string;
  description: string;
  parameters: { [key: string]: unknown };
  strict: true;
}

function zodParametersToJsonSchema(schema: z.ZodType): { [key: string]: unknown } {
  const jsonSchema = z.toJSONSchema(schema, { target: 'openApi3' }) as { [key: string]: unknown };

  if (!jsonSchema.properties && jsonSchema.type === 'object') {
    jsonSchema.properties = {};
  }

  return jsonSchema;
}

export function toOpenAITool<TSchema extends z.ZodType>(tool: ToolDefinition<TSchema>): OpenAITool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: zodParametersToJsonSchema(tool.schema),
    strict: true,
  };
}

export function toOpenAITools(tools: ReadonlyArray<ToolDefinition>): OpenAI.Responses.Tool[] {
  return tools.map((tool) => toOpenAITool(tool) as OpenAI.Responses.Tool);
}
