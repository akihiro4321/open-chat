import { z } from 'zod';

export const structuredAnswerSchema = z.object({
  category: z
    .enum(['fact', 'explanation', 'procedure', 'other'])
    .describe('質問への回答種別。事実、説明、手順、その他のいずれか'),
  summary: z.string().describe('質問に対する簡潔な回答または要約'),
  keyPoints: z.array(z.string()).describe('回答を理解するために重要な要点'),
});

export type StructuredAnswer = z.infer<typeof structuredAnswerSchema>;
