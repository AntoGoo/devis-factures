import { z } from 'zod';

export const MAX_LINE_ABS_CENTS = 100_000_000_000;

export type Line = {
  id: string;
  designation: string;
  quantityMilli: number;
  unit: string;
  unitPriceCents: number;
  vatRate: null; // prévu pour la TVA, toujours null en V1
};

export type Totals = { totalHtCents: number; vatCents: number; totalDueCents: number };

/** quantité (millièmes) × prix (centimes) / 1000, arrondi au plus proche, demi-centime éloigné de zéro. */
export function lineTotalCents(l: Pick<Line, 'quantityMilli' | 'unitPriceCents'>): number {
  const product = BigInt(l.quantityMilli) * BigInt(l.unitPriceCents);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = abs / 1000n + (abs % 1000n >= 500n ? 1n : 0n);
  return Number(negative ? -rounded : rounded);
}

export const LineSchema = z
  .object({
    id: z.string().min(1).max(64),
    designation: z.string().max(500),
    quantityMilli: z.number().int().min(0).max(1_000_000_000),
    unit: z.string().max(20),
    unitPriceCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    vatRate: z.null(),
  })
  .refine((l) => Math.abs(lineTotalCents(l)) <= MAX_LINE_ABS_CENTS, 'Montant de ligne trop élevé');

export const LinesSchema = z.array(LineSchema).max(200, '200 lignes au maximum');

export function isBlankLine(l: Pick<Line, 'designation' | 'unitPriceCents'>): boolean {
  return l.designation.trim() === '' && l.unitPriceCents === 0;
}

export function filledLines(lines: Line[]): Line[] {
  return lines.filter((l) => !isBlankLine(l));
}

export function blankLine(unit = 'u'): Line {
  return { id: crypto.randomUUID(), designation: '', quantityMilli: 1000, unit, unitPriceCents: 0, vatRate: null };
}

export function blankLines(n: number, unit = 'u'): Line[] {
  return Array.from({ length: n }, () => blankLine(unit));
}

export function lineProblems(lines: Line[]): { filledCount: number; missingDesignation: number[] } {
  const missingDesignation: number[] = [];
  let filledCount = 0;
  lines.forEach((l, i) => {
    if (isBlankLine(l)) return;
    filledCount += 1;
    if (l.designation.trim() === '') missingDesignation.push(i + 1);
  });
  return { filledCount, missingDesignation };
}

export function computeTotals(lines: Line[]): Totals {
  const totalHtCents = filledLines(lines).reduce((sum, l) => sum + lineTotalCents(l), 0);
  return { totalHtCents, vatCents: 0, totalDueCents: totalHtCents }; // franchise en base : pas de TVA
}
