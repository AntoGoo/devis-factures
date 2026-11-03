export type DeductedDeposit = { invoiceId: string; number: string; issueDate: string; amountCents: number };

export function computeBalance(totalHtCents: number, deposits: { amountCents: number }[]) {
  const depositsTotalCents = deposits.reduce((s, d) => s + d.amountCents, 0);
  return { totalHtCents, depositsTotalCents, remainingCents: totalHtCents - depositsTotalCents };
}
