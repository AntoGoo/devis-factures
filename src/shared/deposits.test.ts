import { describe, expect, it } from 'vitest';
import { checkDeposit, depositAmountCents } from './deposits';

describe('depositAmountCents', () => {
  it('calcule un pourcentage du total à payer', () => {
    expect(depositAmountCents(400000, { mode: 'percent', basisPoints: 3000 })).toBe(120000); // 30 % de 4 000 €
    expect(depositAmountCents(400000, { mode: 'percent', basisPoints: 2000 })).toBe(80000);
  });

  it('arrondit toujours au centime inférieur', () => {
    expect(depositAmountCents(100001, { mode: 'percent', basisPoints: 3300 })).toBe(33000);  // 330,0033 € → 330,00 €
    expect(depositAmountCents(10000, { mode: 'percent', basisPoints: 3333 })).toBe(3333);    // 33,33 €
    expect(depositAmountCents(99999, { mode: 'percent', basisPoints: 5000 })).toBe(49999);   // 499,995 € → 499,99 €
    expect(depositAmountCents(292000, { mode: 'percent', basisPoints: 1250 })).toBe(36500);  // 12,5 %
  });

  it('reprend tel quel un montant fixe', () => {
    expect(depositAmountCents(400000, { mode: 'amount', cents: 50000 })).toBe(50000);
  });
});

describe('checkDeposit', () => {
  it('accepte tant que la somme des acomptes ne dépasse pas le total du devis', () => {
    expect(checkDeposit(400000, [120000], 280000)).toEqual({ ok: true, remainingAfterCents: 0 });
    expect(checkDeposit(400000, [120000], 80000)).toEqual({ ok: true, remainingAfterCents: 200000 });
  });

  it('refuse un dépassement et indique ce qui reste facturable', () => {
    expect(checkDeposit(400000, [120000, 200000], 80001)).toEqual({ ok: false, reason: 'exceeds_quote_total', remainingCents: 80000 });
  });

  it('refuse un acompte nul ou négatif', () => {
    expect(checkDeposit(400000, [], 0)).toEqual({ ok: false, reason: 'non_positive', remainingCents: 400000 });
  });
});
