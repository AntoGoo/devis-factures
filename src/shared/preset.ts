import { z } from 'zod';

export const PresetInput = z.object({
  designation: z.string().trim().min(1, 'Désignation obligatoire').max(500),
  unit: z.string().trim().min(1).max(20),
  unitPriceCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  vatRate: z.null(), // V1 : franchise de TVA
});

export type PresetInput = z.infer<typeof PresetInput>;
export type PresetData = PresetInput & { id: string };
