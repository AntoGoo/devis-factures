export type Series = 'D' | 'F' | 'A';

/** Doit rester identique au printf('%s-%d-%03d') de src/worker/numbering.ts. */
export function formatDocumentNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(3, '0')}`;
}
