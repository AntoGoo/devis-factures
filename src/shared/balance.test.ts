import { describe, expect, it } from 'vitest';
import { depositAmountCents } from './deposits';
import { computeBalance } from './balance';

describe('computeBalance', () => {
  it('déduit les acomptes du total', () => {
    expect(computeBalance(400000, [{ amountCents: 120000 }])).toEqual({ totalHtCents: 400000, depositsTotalCents: 120000, remainingCents: 280000 });
  });

  it('donne le total entier sans acompte (facture directe)', () => {
    expect(computeBalance(292000, [])).toEqual({ totalHtCents: 292000, depositsTotalCents: 0, remainingCents: 292000 });
  });

  it('absorbe les centimes perdus par l’arrondi des acomptes', () => {
    const total = 10000; // 100,00 €
    const deposits = [1, 2, 3].map(() => ({ amountCents: depositAmountCents(total, { mode: 'percent', basisPoints: 3333 }) }));
    const b = computeBalance(total, deposits);
    expect(b.depositsTotalCents).toBe(9999);
    expect(b.remainingCents).toBe(1);
    expect(b.depositsTotalCents + b.remainingCents).toBe(total);
  });

  it('signale un reste négatif quand le total a baissé sous les acomptes', () => {
    expect(computeBalance(100000, [{ amountCents: 120000 }]).remainingCents).toBe(-20000);
  });
});
