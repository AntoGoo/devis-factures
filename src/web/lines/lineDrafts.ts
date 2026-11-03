import { computeTotals, isBlankLine, type Line, type Totals } from '../../shared/lines';
import { formatCentsForInput, formatQuantity, parseEuros, parseQuantity } from '../../shared/money';
import type { PresetData, PresetInput } from '../../shared/preset';

export type DraftLine = { id: string; designation: string; quantity: string; unit: string; unitPrice: string };
export type DraftErrors = { quantity?: string; unitPrice?: string };

const plain = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-');

export function blankDraft(unit = 'u'): DraftLine {
  return { id: crypto.randomUUID(), designation: '', quantity: '1', unit, unitPrice: '' };
}

export function draftFromLine(l: Line): DraftLine {
  return {
    id: l.id,
    designation: l.designation,
    quantity: plain(formatQuantity(l.quantityMilli)),
    unit: l.unit,
    unitPrice: isBlankLine(l) ? '' : formatCentsForInput(l.unitPriceCents),
  };
}

export function parseDraft(d: DraftLine): { line: Line | null; errors: DraftErrors } {
  const quantityMilli = parseQuantity(d.quantity);
  const unitPriceCents = d.unitPrice.trim() === '' ? 0 : parseEuros(d.unitPrice);
  const errors: DraftErrors = {};
  if (quantityMilli === null) errors.quantity = 'Quantité invalide (3 décimales au plus).';
  if (unitPriceCents === null) errors.unitPrice = 'Prix invalide (2 décimales au plus).';
  if (quantityMilli === null || unitPriceCents === null) return { line: null, errors };
  return { line: { id: d.id, designation: d.designation, quantityMilli, unit: d.unit, unitPriceCents, vatRate: null }, errors };
}

export function draftsToLines(ds: DraftLine[]): { lines: Line[]; valid: boolean } {
  const parsed = ds.map(parseDraft);
  return { lines: parsed.flatMap((p) => (p.line ? [p.line] : [])), valid: parsed.every((p) => p.line !== null) };
}

export function liveTotals(ds: DraftLine[]): Totals {
  return computeTotals(draftsToLines(ds).lines);
}

export function moveDraft(ds: DraftLine[], index: number, delta: -1 | 1): DraftLine[] {
  const target = index + delta;
  if (target < 0 || target >= ds.length) return ds;
  const next = [...ds];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function insertPreset(ds: DraftLine[], p: PresetData): DraftLine[] {
  const filled: DraftLine = { id: crypto.randomUUID(), designation: p.designation, quantity: '1', unit: p.unit, unitPrice: formatCentsForInput(p.unitPriceCents) };
  const blank = ds.findIndex((d) => d.designation.trim() === '' && d.unitPrice.trim() === '');
  if (blank === -1) return [...ds, filled];
  return ds.map((d, i) => (i === blank ? filled : d));
}

export function presetFromDraft(d: DraftLine): PresetInput | null {
  const { line } = parseDraft(d);
  if (!line || line.designation.trim() === '') return null;
  return { designation: line.designation.trim(), unit: line.unit, unitPriceCents: line.unitPriceCents, vatRate: null };
}
