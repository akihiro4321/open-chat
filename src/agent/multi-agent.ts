import type { AppConfig } from '../config.js';
import { type ConversationMessage, requestAnswer } from '../openai-client.js';
import { runAgentLoop } from './loop.js';
import { createSearchRagTool, getCurrentTimeTool } from './tools.js';
import type { AgentLoopResult, ToolDefinition } from './types.js';

const RESEARCH_INSTRUCTION = [
  'あなたは調査担当エージェントです。',
  '利用可能な読取専用ツールを使い、回答に必要な事実、根拠、未確認点を整理してください。',
  '副作用のある操作は提案せず、実行もしません。',
].join('\n');

const PLANNER_INSTRUCTION = [
  'あなたは実行計画担当エージェントです。',
  '利用者の依頼と調査結果を読み、実行可能な手順、判断点、リスクを簡潔に整理してください。',
  '外部送信や破壊的操作が必要な場合は、人間承認が必要な提案として扱ってください。',
].join('\n');

const SUPERVISOR_INSTRUCTION = [
  'あなたはスーパーバイザーです。',
  '調査担当と実行計画担当の結果を統合し、利用者への最終回答を日本語で作成してください。',
  '担当エージェントの結果に矛盾があれば明示し、根拠が不足する内容は断定しないでください。',
].join('\n');

export interface MultiAgentModelConfig {
  researchModel: string | null;
  plannerModel: string | null;
  supervisorModel: string | null;
}

export interface MultiAgentResult {
  answer: string;
  model: string;
  requestedModel: string;
  roles: Array<{
    role: 'researcher' | 'planner' | 'supervisor';
    model: string;
  }>;
}

export interface MultiAgentDeps {
  runLoop: typeof runAgentLoop;
  requestFinalAnswer: typeof requestAnswer;
  tools: ReadonlyArray<ToolDefinition>;
}

const defaultDeps: MultiAgentDeps = {
  runLoop: runAgentLoop,
  requestFinalAnswer: requestAnswer,
  tools: [getCurrentTimeTool, createSearchRagTool()],
};

function roleConfig(base: AppConfig, model: string | null): AppConfig {
  return { ...base, model: model ?? base.model };
}

function buildPlannerQuestion(question: string, research: AgentLoopResult): string {
  return [
    `利用者の依頼:\n${question}`,
    `調査担当の結果:\n${research.answer}`,
    `調査担当が使ったツール:\n${research.toolCalls.map((call) => call.name).join(', ') || 'なし'}`,
  ].join('\n\n');
}

function buildSupervisorQuestion(input: {
  question: string;
  research: AgentLoopResult;
  planner: AgentLoopResult;
}): string {
  return [
    `利用者の依頼:\n${input.question}`,
    `調査担当の結果:\n${input.research.answer}`,
    `実行計画担当の結果:\n${input.planner.answer}`,
    '上記を統合して最終回答を作成してください。',
  ].join('\n\n');
}

export async function runMultiAgent(input: {
  apiKey: string;
  baseModel: string;
  question: string;
  messageId: string;
  history?: ReadonlyArray<ConversationMessage>;
  maxIterations: number;
  models: MultiAgentModelConfig;
  deps?: Partial<MultiAgentDeps>;
}): Promise<MultiAgentResult> {
  const deps = { ...defaultDeps, ...input.deps };
  const baseConfig = { apiKey: input.apiKey, model: input.baseModel };
  const researchConfig = roleConfig(baseConfig, input.models.researchModel);
  const plannerConfig = roleConfig(baseConfig, input.models.plannerModel);
  const supervisorConfig = roleConfig(baseConfig, input.models.supervisorModel);
  const history = input.history ? [...input.history] : undefined;

  const researchOptions = {
    apiKey: researchConfig.apiKey,
    model: researchConfig.model,
    instruction: RESEARCH_INSTRUCTION,
    question: input.question,
    messageId: `${input.messageId}:researcher`,
    tools: deps.tools.filter((tool) => !tool.hasSideEffect),
    maxIterations: input.maxIterations,
    ...(history ? { history } : {}),
  };
  const research = await deps.runLoop(researchOptions);

  const plannerOptions = {
    apiKey: plannerConfig.apiKey,
    model: plannerConfig.model,
    instruction: PLANNER_INSTRUCTION,
    question: buildPlannerQuestion(input.question, research),
    messageId: `${input.messageId}:planner`,
    tools: [],
    maxIterations: input.maxIterations,
    ...(history ? { history } : {}),
  };
  const planner = await deps.runLoop(plannerOptions);

  const final = await deps.requestFinalAnswer(supervisorConfig, {
    instruction: SUPERVISOR_INSTRUCTION,
    question: buildSupervisorQuestion({ question: input.question, research, planner }),
    ...(history ? { history } : {}),
  });

  return {
    answer: final.answer,
    model: final.model,
    requestedModel: supervisorConfig.model,
    roles: [
      { role: 'researcher', model: research.model },
      { role: 'planner', model: planner.model },
      { role: 'supervisor', model: final.model },
    ],
  };
}
