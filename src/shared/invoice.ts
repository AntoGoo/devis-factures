import { z } from 'zod';
import { isIsoDate } from './dates';
import { LinesSchema } from './lines';
import type { InvoiceKind } from './status';

const isoDate = z.string().refine(isIsoDate, 'Date attendue au format AAAA-MM-JJ');

export const InvoiceDraftInput = z.object({
  clientId: z.string().min(1).nullable().optional(),
  object: z.string().trim().max(300).optional(),
  interventionAddress: z.string().trim().max(300).nullable().optional(),
  lines: LinesSchema.optional(),
  serviceDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  notes: z.string().trim().max(1000),
});

export type InvoiceDraftInput = z.infer<typeof InvoiceDraftInput>;

/** Champs modifiables d'un brouillon, selon son type (les dates et les notes le sont toujours). */
export const EDITABLE_FIELDS: Record<Exclude<InvoiceKind, 'credit'>, (keyof InvoiceDraftInput)[]> = {
  deposit: ['serviceDate', 'dueDate', 'notes'],
  final: ['object', 'interventionAddress', 'lines', 'serviceDate', 'dueDate', 'notes'],
  standalone: ['clientId', 'object', 'interventionAddress', 'lines', 'serviceDate', 'dueDate', 'notes'],
};
