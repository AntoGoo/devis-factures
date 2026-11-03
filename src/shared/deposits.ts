import { z } from 'zod';
import { MAX_LINE_ABS_CENTS } from './lines';

export type DepositInput = { mode: 'percent'; basisPoints: number } | { mode: 'amount'; cents: number };

export const DepositInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('percent'), basisPoints: z.number().int().min(1).max(10_000) }),
  z.object({ mode: z.literal('amount'), cents: z.number().int().min(1).max(MAX_LINE_ABS_CENTS) }),
]);

/** Acompte en pourcentage : arrondi au centime inférieur ; la facture de solde absorbe l'écart. */
export function depositAmountCents(quoteTotalCents: number, input: DepositInput): number {
  if (input.mode === 'amount') return input.cents;
  return Number((BigInt(quoteTotalCents) * BigInt(input.basisPoints)) / 10_000n);
}

export function checkDeposit(
  quoteTotalCents: number,
  existingCents: number[],
  newCents: number,
): { ok: true; remainingAfterCents: number } | { ok: false; reason: 'non_positive' | 'exceeds_quote_total'; remainingCents: number } {
  const remainingCents = quoteTotalCents - existingCents.reduce((s, c) => s + c, 0);
  if (newCents <= 0) return { ok: false, reason: 'non_positive', remainingCents };
  if (newCents > remainingCents) return { ok: false, reason: 'exceeds_quote_total', remainingCents };
  return { ok: true, remainingAfterCents: remainingCents - newCents };
}
