import { depositAmountCents, type DepositInput } from '../../shared/deposits';
import { formatEuros, parseEuros, parsePercent } from '../../shared/money';

export type DepositMode = 'percent' | 'amount';
type Preview = { input: DepositInput | null; amountCents: number | null; remainingAfterCents: number | null; error: string | null };

export const percentInput = (bp: number) => String(bp / 100).replace('.', ',');

export function depositPreview(totalCents: number, alreadyCents: number, mode: DepositMode, raw: string): Preview {
  const empty: Preview = { input: null, amountCents: null, remainingAfterCents: null, error: null };
  if (raw.trim() === '') return empty;
  let input: DepositInput;
  if (mode === 'percent') {
    const bp = parsePercent(raw);
    if (bp === null) return { ...empty, error: 'Pourcentage invalide : entre 0 et 100, 2 décimales au plus.' };
    input = { mode, basisPoints: bp };
  } else {
    const cents = parseEuros(raw);
    if (cents === null || cents <= 0) return { ...empty, error: 'Montant invalide : positif, 2 décimales au plus.' };
    input = { mode, cents };
  }
  const amountCents = depositAmountCents(totalCents, input);
  const remaining = totalCents - alreadyCents;
  if (amountCents <= 0) return { ...empty, amountCents, error: 'Le montant de l’acompte doit être positif.' };
  if (amountCents > remaining) {
    return { input: null, amountCents, remainingAfterCents: remaining - amountCents, error: `Dépasse le reste à facturer (${formatEuros(remaining)}).` };
  }
  return { input, amountCents, remainingAfterCents: remaining - amountCents, error: null };
}
