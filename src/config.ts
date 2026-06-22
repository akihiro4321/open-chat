export interface AppConfig {
  apiKey: string;
  model: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const model = environment.OPENAI_MODEL?.trim();

  if (!apiKey) {
    throw new ConfigurationError('環境変数 OPENAI_API_KEY を設定してください。');
  }

  if (!model) {
    throw new ConfigurationError('環境変数 OPENAI_MODEL を設定してください。');
  }

  return { apiKey, model };
}
