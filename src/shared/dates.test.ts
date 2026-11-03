import { describe, expect, it } from 'vitest';
import { addDays, formatDateLong, formatDateShort, isIsoDate, monthRange, todayInParis, yearOf } from './dates';

describe('todayInParis (vigilance n 4 : minuit du 1er janvier)', () => {
  it('donne la date de Paris, pas celle de UTC', () => {
    expect(todayInParis(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayInParis(new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
    expect(todayInParis(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
    expect(todayInParis(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });
});

describe('calculs de dates', () => {
  it('ajoute des jours en franchissant les mois et annees', () => {
    expect(addDays('2026-11-03', 30)).toBe('2026-12-03');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('extrait l\'annee', () => {
    expect(yearOf('2027-01-01')).toBe(2027);
  });

  it('donne les bornes du mois', () => {
    expect(monthRange('2026-11-03')).toEqual({ start: '2026-11-01', end: '2026-12-01' });
    expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('valide le format', () => {
    expect(isIsoDate('2026-11-03')).toBe(true);
    expect(isIsoDate('2026-13-03')).toBe(false);
    expect(isIsoDate('03/11/2026')).toBe(false);
  });
});

describe('formats francais', () => {
  it('ecrit les dates longues et courtes', () => {
    expect(formatDateLong('2026-10-31')).toBe('31 octobre 2026');
    expect(formatDateShort('2026-10-28')).toBe('28 oct. 2026');
  });
});
