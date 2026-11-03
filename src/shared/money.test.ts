import { describe, expect, it } from 'vitest';
import { formatCentsForInput, formatEuros, formatPercent, formatQuantity, parseEuros, parsePercent, parseQuantity } from './money';

// Intl utilise des espaces insécables (U+202F, U+00A0) : on les normalise pour comparer.
const plain = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-');

describe('formatEuros', () => {
  it('formate au format francais', () => {
    expect(plain(formatEuros(123450))).toBe('1 234,50 €');
    expect(plain(formatEuros(0))).toBe('0,00 €');
    expect(plain(formatEuros(-280000))).toBe('-2 800,00 €');
  });
});

describe('formatCentsForInput', () => {
  it('ecrit une valeur modifiable sans separateur de milliers', () => {
    expect(formatCentsForInput(123450)).toBe('1234,50');
    expect(formatCentsForInput(5)).toBe('0,05');
    expect(formatCentsForInput(-5000)).toBe('-50,00');
  });
});

describe('parseEuros (vigilance n 1 : saisie a la francaise)', () => {
  it.each([
    ['380', 38000],
    ['380,5', 38050],
    ['1150.00', 115000],
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ['1 234,56', 123456],
    ['1.234,56', 123456],
    [' 45 € ', 4500],
    ['45€', 4500],
    ['-50', -5000],
    ['0', 0],
  ])('lit %j comme %i centimes', (input, cents) => {
    expect(parseEuros(input)).toBe(cents);
  });

  it.each(['', '  ', 'abc', '12,345', '1,2,3', '--5', '1e5', '12.'])('refuse %j', (input) => {
    expect(parseEuros(input)).toBeNull();
  });

  it('refuse les montants au-dela d\'un milliard d\'euros', () => {
    expect(parseEuros('1000000001')).toBeNull();
  });
});

describe('quantites', () => {
  it.each([
    ['1', 1000],
    ['2,5', 2500],
    ['0,125', 125],
    ['8', 8000],
    ['1 000', 1000000],
  ])('lit %j comme %i milliemes', (input, milli) => {
    expect(parseQuantity(input)).toBe(milli);
  });

  it.each(['', '-1', '0,1234', 'x'])('refuse %j', (input) => {
    expect(parseQuantity(input)).toBeNull();
  });

  it('formate sans zeros inutiles', () => {
    expect(formatQuantity(1000)).toBe('1');
    expect(formatQuantity(2500)).toBe('2,5');
    expect(plain(formatQuantity(1250000))).toBe('1 250');
  });
});

describe('pourcentages', () => {
  it.each([
    ['20', 2000],
    ['20 %', 2000],
    ['12,5%', 1250],
    ['100', 10000],
  ])('lit %j comme %i points de base', (input, bp) => {
    expect(parsePercent(input)).toBe(bp);
  });

  it.each(['0', '100,01', '-5', '', '12,345'])('refuse %j', (input) => {
    expect(parsePercent(input)).toBeNull();
  });

  it('formate', () => {
    expect(plain(formatPercent(2000))).toBe('20 %');
    expect(plain(formatPercent(1250))).toBe('12,5 %');
  });
});
