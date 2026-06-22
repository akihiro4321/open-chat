import { ConfigurationError, loadConfig } from '@/src/config.js';

export const runtime = 'nodejs';

export function GET(): Response {
  try {
    const config = loadConfig();
    return Response.json({
      defaultModel: config.model,
      models: config.allowedModels,
      fallbackModel: config.fallbackModel,
    });
  } catch (error: unknown) {
    const message =
      error instanceof ConfigurationError ? error.message : 'モデル設定を読み込めませんでした。';
    return Response.json({ message }, { status: 500 });
  }
}
