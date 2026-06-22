export interface AppConfig {
  apiKey: string;
  model: string;
}

export interface RuntimeConfig extends AppConfig {
  allowedModels: string[];
  fallbackModel: string | null;
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
