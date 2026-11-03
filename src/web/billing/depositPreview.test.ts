import { describe, expect, it } from 'vitest';
import { depositPreview, percentInput } from './depositPreview';

describe('depositPreview (maquette : devis de 4 000 €, 1 200 € déjà facturés)', () => {
  it('calcule le montant et le reste à facturer', () => {
    expect(depositPreview(400000, 120000, 'percent', '20')).toMatchObject({ input: { mode: 'percent', basisPoints: 2000 }, amountCents: 80000, remainingAfterCents: 200000, error: null });
    expect(depositPreview(400000, 120000, 'percent', '12,5 %').amountCents).toBe(50000);
    expect(depositPreview(400000, 120000, 'amount', '1 000').input).toEqual({ mode: 'amount', cents: 100000 });
  });

  it('refuse un dépassement et les saisies invalides', () => {
    expect(depositPreview(400000, 120000, 'amount', '3000')).toMatchObject({ input: null, error: expect.stringContaining('Dépasse') });
    expect(depositPreview(400000, 120000, 'percent', '0').error).not.toBeNull();
    expect(depositPreview(400000, 120000, 'amount', '12,345').error).not.toBeNull();
    expect(depositPreview(400000, 120000, 'percent', '')).toEqual({ input: null, amountCents: null, remainingAfterCents: null, error: null });
  });

  it('écrit un pourcentage modifiable', () => {
    expect(percentInput(2000)).toBe('20');
    expect(percentInput(1250)).toBe('12,5');
  });
});
