import { describe, expect, it } from 'vitest';
import { LineSchema, blankLines, computeTotals, filledLines, isBlankLine, lineProblems, lineTotalCents, type Line } from './lines';

const line = (q: number, p: number, designation = 'Prestation'): Line => ({ id: crypto.randomUUID(), designation, quantityMilli: q, unit: 'u', unitPriceCents: p, vatRate: null });

// Lignes de la maquette Devis : 380 + 1 150 + 8 × 65 + 6 × 95 + 300 = 2 920 €
const MOCKUP = [line(1000, 38000), line(1000, 115000), line(8000, 6500), line(6000, 9500), line(1000, 30000)];

describe('lineTotalCents', () => {
  it('multiplie quantité et prix unitaire', () => {
    expect(lineTotalCents({ quantityMilli: 1000, unitPriceCents: 38000 })).toBe(38000);
    expect(lineTotalCents({ quantityMilli: 2500, unitPriceCents: 4500 })).toBe(11250);
    expect(lineTotalCents({ quantityMilli: 8000, unitPriceCents: 6500 })).toBe(52000);
  });

  it('arrondit au centime le plus proche, le demi-centime s’éloignant de zéro', () => {
    expect(lineTotalCents({ quantityMilli: 125, unitPriceCents: 100 })).toBe(13);   // 12,5 c → 13 c
    expect(lineTotalCents({ quantityMilli: 124, unitPriceCents: 100 })).toBe(12);   // 12,4 c → 12 c
    expect(lineTotalCents({ quantityMilli: 125, unitPriceCents: -100 })).toBe(-13); // remise
    expect(lineTotalCents({ quantityMilli: 333, unitPriceCents: 1000 })).toBe(333);
  });

  it('reste exact sur de grands nombres', () => {
    expect(lineTotalCents({ quantityMilli: 1_000_000_000, unitPriceCents: 99_999 })).toBe(99_999_000_000);
  });
});

describe('computeTotals', () => {
  it('donne 2 920,00 € pour le devis de la maquette, TVA nulle, total à payer = total HT', () => {
    expect(computeTotals(MOCKUP)).toEqual({ totalHtCents: 292000, vatCents: 0, totalDueCents: 292000 });
  });

  it('additionne les totaux de ligne déjà arrondis (ce qui est imprimé)', () => {
    const lines = [line(333, 100), line(333, 100), line(333, 100)]; // 0,333 × 1,00 € = 0,33 € chacune
    expect(computeTotals(lines).totalHtCents).toBe(99);
  });

  it('ignore les lignes vides (vigilance n° 2)', () => {
    expect(computeTotals([...MOCKUP, ...blankLines(3)]).totalHtCents).toBe(292000);
    expect(computeTotals(blankLines(5))).toEqual({ totalHtCents: 0, vatCents: 0, totalDueCents: 0 });
  });

  it('accepte une ligne de remise négative', () => {
    expect(computeTotals([line(1000, 10000), line(1000, -1500, 'Remise fidélité')]).totalHtCents).toBe(8500);
  });
});

describe('lignes vides et problèmes de saisie (vigilance n° 2)', () => {
  it('reconnaît une ligne vide : ni désignation ni prix', () => {
    expect(isBlankLine(blankLines(1)[0]!)).toBe(true);
    expect(isBlankLine({ ...blankLines(1)[0]!, designation: '  ' })).toBe(true);
    expect(isBlankLine(line(1000, 0, 'Déplacement offert'))).toBe(false);
    expect(isBlankLine(line(1000, 500, ''))).toBe(false);
  });

  it('crée 5 lignes vides distinctes, quantité 1', () => {
    const lines = blankLines(5, 'forfait');
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((l) => l.id)).size).toBe(5);
    expect(lines[0]).toMatchObject({ designation: '', quantityMilli: 1000, unit: 'forfait', unitPriceCents: 0, vatRate: null });
  });

  it('compte les lignes remplies et signale une ligne chiffrée sans désignation', () => {
    const lines = [line(1000, 38000), blankLines(1)[0]!, line(1000, 500, '')];
    expect(filledLines(lines)).toHaveLength(2);
    expect(lineProblems(lines)).toEqual({ filledCount: 2, missingDesignation: [3] });
    expect(lineProblems(blankLines(5))).toEqual({ filledCount: 0, missingDesignation: [] });
  });
});

describe('LineSchema', () => {
  it('refuse un taux de TVA en V1, une quantité négative, un prix décimal', () => {
    const ok = line(1000, 100);
    expect(LineSchema.safeParse(ok).success).toBe(true);
    expect(LineSchema.safeParse({ ...ok, vatRate: 20 }).success).toBe(false);
    expect(LineSchema.safeParse({ ...ok, quantityMilli: -1 }).success).toBe(false);
    expect(LineSchema.safeParse({ ...ok, unitPriceCents: 10.5 }).success).toBe(false);
  });
});
