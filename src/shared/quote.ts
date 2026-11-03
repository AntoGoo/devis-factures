import { z } from 'zod';
import { LinesSchema } from './lines';

export const QuoteDraftInput = z.object({
  clientId: z.string().min(1).nullable(),
  object: z.string().trim().max(300),
  interventionAddress: z.string().trim().max(300).nullable(),
  lines: LinesSchema,
  validityDays: z.number().int().min(1).max(365),
  plannedStart: z.string().trim().max(120),
  estimatedDuration: z.string().trim().max(120),
  paymentTerms: z.string().trim().max(500),
  plannedDepositBp: z.number().int().min(1).max(10_000).nullable(),
});

export type QuoteDraftInput = z.infer<typeof QuoteDraftInput>;
