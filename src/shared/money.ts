export const MAX_ABS_CENTS = 100_000_000_000; // 1 milliard d'euros

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const QTY = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const PCT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatEuros(cents: number): string {
  return EUR.format(cents / 100);
}

export function formatCentsForInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Normalise une saisie décimale française ; renvoie [signe, partie entière, décimales] ou null. */
function splitDecimal(input: string, maxDecimals: number, allowNegative: boolean): [number, string, string] | null {
  let s = input.replace(/[\s  ]/g, '').replace(/€$/, '').replace(/%$/, '');
  if (s === '') return null;
  let sign = 1;
  if (s.startsWith('-')) {
    if (!allowNegative) return null;
    sign = -1;
    s = s.slice(1);
  }
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, ''); // « 1.234,56 »
  s = s.replace(',', '.');
  const re = new RegExp(`^(\\d+)(?:\\.(\\d{1,${maxDecimals}}))?$`);
  const m = re.exec(s);
  if (!m) return null;
  return [sign, m[1], m[2] ?? ''];
}

function toScaled(intPart: string, frac: string, decimals: number): number {
  return Number(intPart) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
}

export function parseEuros(input: string): number | null {
  const parts = splitDecimal(input, 2, true);
  if (!parts) return null;
  const [sign, i, f] = parts;
  const cents = sign * toScaled(i, f, 2);
  if (Math.abs(cents) > MAX_ABS_CENTS) return null;
  return cents === 0 ? 0 : cents;
}

export function parseQuantity(input: string): number | null {
  const parts = splitDecimal(input, 3, false);
  if (!parts) return null;
  const milli = toScaled(parts[1], parts[2], 3);
  return milli > 1_000_000_000 ? null : milli;
}

export function formatQuantity(milli: number): string {
  return QTY.format(milli / 1000);
}

export function parsePercent(input: string): number | null {
  const parts = splitDecimal(input, 2, false);
  if (!parts) return null;
  const bp = toScaled(parts[1], parts[2], 2);
  return bp > 0 && bp <= 10_000 ? bp : null;
}

export function formatPercent(bp: number): string {
  return `${PCT.format(bp / 100)} %`;
}
