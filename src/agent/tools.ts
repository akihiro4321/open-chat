import { z } from 'zod';

import type { ToolDefinition } from './types.js';

const getCurrentTimeSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('IANAタイムゾーン識別子。省略時はAsia/Tokyo。'),
});

type GetCurrentTimeInput = z.infer<typeof getCurrentTimeSchema>;

export const getCurrentTimeTool: ToolDefinition<typeof getCurrentTimeSchema> = {
  name: 'getCurrentTime',
  description:
    '現在の日時を指定タイムゾーンで返す。学習・テスト用途。副作用を持たないため並列実行可能。',
  schema: getCurrentTimeSchema,
  execute: (input) => {
    const timezone = input.timezone ?? 'Asia/Tokyo';
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('ja-JP', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    return Promise.resolve(JSON.stringify({ timezone, currentTime: formatted }));
  },
};

export const defaultTools: ReadonlyArray<ToolDefinition> = [getCurrentTimeTool];

export { getCurrentTimeSchema };
export type { GetCurrentTimeInput };
