import { describe, expect, it } from 'vitest';
import { blankDraft, draftFromLine, draftsToLines, insertPreset, liveTotals, moveDraft, parseDraft, presetFromDraft } from './lineDrafts';

const d = (designation: string, quantity: string, unitPrice: string) => ({ ...blankDraft(), designation, quantity, unitPrice });

describe('lignes en cours de saisie', () => {
  it('lit les saisies françaises', () => {
    expect(parseDraft(d('Prises', '8', '65')).line).toMatchObject({ quantityMilli: 8000, unitPriceCents: 6500 });
    expect(parseDraft(d('Main-d’œuvre', '2,5', '1 234,50')).line).toMatchObject({ quantityMilli: 2500, unitPriceCents: 123450 });
    expect(parseDraft(d('', '1', '')).line).toMatchObject({ unitPriceCents: 0 });
  });

  it('signale les champs invalides sans perdre la saisie', () => {
    const r = parseDraft(d('X', '1,2345', '12,345'));
    expect(r.line).toBeNull();
    expect(r.errors).toEqual({ quantity: expect.any(String), unitPrice: expect.any(String) });
    expect(draftsToLines([d('A', '1', '10'), d('B', 'x', '1')]).valid).toBe(false);
  });

  it('calcule les totaux en direct en ignorant les lignes vides et invalides', () => {
    expect(liveTotals([d('A', '1', '380'), d('B', '8', '65'), blankDraft(), d('C', 'x', '5')]).totalHtCents).toBe(90000);
  });

  it('reconstruit une saisie depuis une ligne enregistrée', () => {
    expect(draftFromLine({ id: 'l', designation: 'A', quantityMilli: 2500, unit: 'h', unitPriceCents: 4500, vatRate: null }))
      .toEqual({ id: 'l', designation: 'A', quantity: '2,5', unit: 'h', unitPrice: '45,00' });
    expect(draftFromLine({ id: 'v', designation: '', quantityMilli: 1000, unit: 'u', unitPriceCents: 0, vatRate: null }).unitPrice).toBe('');
  });

  it('déplace une ligne vers le haut ou le bas, sans sortir du tableau', () => {
    const ds = [d('A', '1', '1'), d('B', '1', '1'), d('C', '1', '1')];
    expect(moveDraft(ds, 2, -1).map((x) => x.designation)).toEqual(['A', 'C', 'B']);
    expect(moveDraft(ds, 0, -1)).toBe(ds);
  });

  it('insère une ligne type dans la première ligne vide, sinon à la fin', () => {
    const preset = { id: 'p', designation: 'Prise 16 A', unit: 'u', unitPriceCents: 6500, vatRate: null };
    const filled = insertPreset([d('A', '1', '1'), blankDraft(), blankDraft()], preset);
    expect(filled.map((x) => x.designation)).toEqual(['A', 'Prise 16 A', '']);
    expect(filled[1]!.unitPrice).toBe('65,00');
    expect(insertPreset([d('A', '1', '1')], preset)).toHaveLength(2);
  });

  it('prépare une ligne type depuis une ligne remplie', () => {
    expect(presetFromDraft(d('Forfait déplacement', '1', '35'))).toEqual({ designation: 'Forfait déplacement', unit: 'u', unitPriceCents: 3500, vatRate: null });
    expect(presetFromDraft(blankDraft())).toBeNull();
  });
});
