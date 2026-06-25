export interface AppConfig {
  apiKey: string;
  model: string;
}

export interface RuntimeConfig extends AppConfig {
  allowedModels: string[];
  fallbackModel: string | null;
}

export interface RagConfig {
  apiKey: string;
  embeddingModel: string;
  embeddingDimensions: number | null;
  lancedbDir: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const model = environment.OPENAI_MODEL?.trim();

  if (!apiKey) {
    throw new ConfigurationError('環境変数 OPENAI_API_KEY を設定してください。');
  }

  if (!model) {
    throw new ConfigurationError('環境変数 OPENAI_MODEL を設定してください。');
  }

  const configuredModels = environment.OPENAI_ALLOWED_MODELS?.split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const allowedModels = [...new Set(configuredModels?.length ? configuredModels : [model])];

  if (!allowedModels.includes(model)) {
    throw new ConfigurationError('OPENAI_MODELはOPENAI_ALLOWED_MODELSに含めてください。');
  }

  const fallbackModel = environment.OPENAI_FALLBACK_MODEL?.trim() || null;

  if (fallbackModel && !allowedModels.includes(fallbackModel)) {
    throw new ConfigurationError('OPENAI_FALLBACK_MODELはOPENAI_ALLOWED_MODELSに含めてください。');
  }

  return { apiKey, model, allowedModels, fallbackModel };
}

function readPositiveInteger(
  environment: Record<string, string | undefined>,
  name: string,
): number | null {
  const rawValue = environment[name]?.trim();

  if (!rawValue) {
    return null;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError(`${name} は正の整数で指定してください。`);
  }

  return value;
}

export function loadRagConfig(
  environment: Record<string, string | undefined> = process.env,
): RagConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const embeddingModel = environment.OPENAI_EMBEDDING_MODEL?.trim();
  const lancedbDir = environment.RAG_LANCEDB_DIR?.trim() || 'data/lancedb';
  const chunkSize = readPositiveInteger(environment, 'RAG_CHUNK_SIZE') ?? 1200;
  const chunkOverlap = readPositiveInteger(environment, 'RAG_CHUNK_OVERLAP') ?? 200;
  const topK = readPositiveInteger(environment, 'RAG_TOP_K') ?? 4;
  const embeddingDimensions = readPositiveInteger(environment, 'OPENAI_EMBEDDING_DIMENSIONS');

  if (!apiKey) {
    throw new ConfigurationError('環境変数 OPENAI_API_KEY を設定してください。');
  }

  if (!embeddingModel) {
    throw new ConfigurationError('環境変数 OPENAI_EMBEDDING_MODEL を設定してください。');
  }

  if (chunkOverlap >= chunkSize) {
    throw new ConfigurationError('RAG_CHUNK_OVERLAP は RAG_CHUNK_SIZE より小さくしてください。');
  }

  return {
    apiKey,
    embeddingModel,
    embeddingDimensions,
    lancedbDir,
    chunkSize,
    chunkOverlap,
    topK,
  };
}
