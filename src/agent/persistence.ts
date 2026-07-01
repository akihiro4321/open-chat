import type { ResponseInputItem } from 'openai/resources/responses/responses';

import { prisma } from '../database.js';
import type { AgentRunRecord, AgentToolCall, AgentToolResult } from './types.js';

export function serializeAgentRunInput(items: string | ResponseInputItem[]): string {
  if (typeof items === 'string') {
    return JSON.stringify({ inputType: 'string', value: items });
  }

  return JSON.stringify({ inputType: 'items', value: items });
}

export function deserializeAgentRunInput(json: string): string | ResponseInputItem[] {
  const parsed = JSON.parse(json) as { inputType: string; value: unknown };

  if (parsed.inputType === 'string') {
    return parsed.value as string;
  }

  return parsed.value as ResponseInputItem[];
}

export async function createAgentRun(input: {
  messageId: string;
  model: string;
  maxIterations: number;
  currentIteration: number;
  currentInput: string | ResponseInputItem[];
  toolCalls: AgentToolCall[];
  toolResults: AgentToolResult[];
  pendingCallIds: string[];
}): Promise<AgentRunRecord> {
  const record = await prisma.agentRun.create({
    data: {
      messageId: input.messageId,
      status: 'waiting_approval',
      model: input.model,
      maxIterations: input.maxIterations,
      currentIteration: input.currentIteration,
      currentInputJson: serializeAgentRunInput(input.currentInput),
      toolCallsJson: JSON.stringify(input.toolCalls),
      toolResultsJson: JSON.stringify(input.toolResults),
      pendingCallIdsJson: JSON.stringify(input.pendingCallIds),
    },
  });

  return {
    id: record.id,
    messageId: record.messageId,
    status: record.status as AgentRunRecord['status'],
    model: record.model,
    maxIterations: record.maxIterations,
    currentIteration: record.currentIteration,
    currentInputJson: record.currentInputJson,
    toolCallsJson: record.toolCallsJson,
    toolResultsJson: record.toolResultsJson,
    pendingCallIdsJson: record.pendingCallIdsJson,
  };
}

export async function loadAgentRun(agentRunId: string): Promise<AgentRunRecord | null> {
  const record = await prisma.agentRun.findUnique({ where: { id: agentRunId } });

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    messageId: record.messageId,
    status: record.status as AgentRunRecord['status'],
    model: record.model,
    maxIterations: record.maxIterations,
    currentIteration: record.currentIteration,
    currentInputJson: record.currentInputJson,
    toolCallsJson: record.toolCallsJson,
    toolResultsJson: record.toolResultsJson,
    pendingCallIdsJson: record.pendingCallIdsJson,
  };
}

export async function loadAgentRunByMessageId(messageId: string): Promise<AgentRunRecord | null> {
  const record = await prisma.agentRun.findUnique({ where: { messageId } });

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    messageId: record.messageId,
    status: record.status as AgentRunRecord['status'],
    model: record.model,
    maxIterations: record.maxIterations,
    currentIteration: record.currentIteration,
    currentInputJson: record.currentInputJson,
    toolCallsJson: record.toolCallsJson,
    toolResultsJson: record.toolResultsJson,
    pendingCallIdsJson: record.pendingCallIdsJson,
  };
}

export async function updateAgentRunStatus(
  agentRunId: string,
  status: AgentRunRecord['status'],
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: { status },
  });
}

export async function createToolCall(input: {
  agentRunId: string;
  callId: string;
  name: string;
  arguments: string;
}): Promise<string> {
  const record = await prisma.toolCall.create({
    data: {
      agentRunId: input.agentRunId,
      callId: input.callId,
      name: input.name,
      arguments: input.arguments,
      output: null,
      isError: false,
    },
  });

  return record.id;
}

export async function createApproval(input: {
  toolCallId: string;
  status: 'pending';
}): Promise<string> {
  const record = await prisma.approval.create({
    data: {
      toolCallId: input.toolCallId,
      status: input.status,
    },
  });

  return record.id;
}

export async function resolveApproval(
  toolCallId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  await prisma.approval.update({
    where: { toolCallId },
    data: { status, resolvedAt: new Date() },
  });
}

export async function resolveApprovalByCallId(
  agentRunId: string,
  callId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const toolCall = await prisma.toolCall.findFirst({
    where: { agentRunId, callId },
    select: { id: true },
  });

  if (!toolCall) {
    return;
  }

  await resolveApproval(toolCall.id, status);
}

export async function updateToolCallResult(input: {
  agentRunId: string;
  callId: string;
  output: string;
  isError: boolean;
}): Promise<void> {
  await prisma.toolCall.updateMany({
    where: { agentRunId: input.agentRunId, callId: input.callId },
    data: { output: input.output, isError: input.isError },
  });
}

export async function cancelPendingApprovals(agentRunId: string): Promise<void> {
  await prisma.approval.updateMany({
    where: {
      toolCall: { agentRunId },
      status: 'pending',
    },
    data: { status: 'rejected', resolvedAt: new Date() },
  });
}

export async function rejectAgentRun(agentRunId: string): Promise<void> {
  await updateAgentRunStatus(agentRunId, 'rejected');
  await cancelPendingApprovals(agentRunId);
}
