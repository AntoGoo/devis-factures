import { expect, it } from 'vitest';
import { invoiceDisplay, QUOTE_STATUS } from './status';

it('libelle les statuts de devis en français', () => {
  expect(Object.values(QUOTE_STATUS).map((s) => s.label)).toEqual(['Brouillon', 'Envoyé', 'Accepté', 'Refusé']);
});

it('déduit l’état affiché d’une facture', () => {
  const base = { kind: 'deposit' as const, status: 'issued' as const, paidAt: null, dueDate: '2026-11-12' };
  expect(invoiceDisplay({ ...base, status: 'draft' }, '2026-11-03')).toBe('draft');
  expect(invoiceDisplay(base, '2026-11-03')).toBe('to_pay');
  expect(invoiceDisplay(base, '2026-11-13')).toBe('late');
  expect(invoiceDisplay({ ...base, paidAt: '2026-11-10' }, '2026-11-13')).toBe('paid');
  expect(invoiceDisplay({ ...base, status: 'cancelled', paidAt: '2026-11-10' }, '2026-11-13')).toBe('cancelled');
  expect(invoiceDisplay({ ...base, kind: 'credit' }, '2026-11-13')).toBe('credit');
});
