export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused';
export type Tone = 'draft' | 'wait' | 'late' | 'paid' | 'ok' | 'neutral';

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'draft' },
  sent: { label: 'Envoyé', tone: 'draft' },
  accepted: { label: 'Accepté', tone: 'ok' },
  refused: { label: 'Refusé', tone: 'late' },
};

export type InvoiceKind = 'deposit' | 'final' | 'standalone' | 'credit';
export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';
export type InvoiceDisplay = 'draft' | 'to_pay' | 'late' | 'paid' | 'cancelled' | 'credit';

export const INVOICE_DISPLAY: Record<InvoiceDisplay, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'draft' },
  to_pay: { label: 'À payer', tone: 'wait' },
  late: { label: 'En retard', tone: 'late' },
  paid: { label: 'Payée', tone: 'paid' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
  credit: { label: 'Avoir émis', tone: 'neutral' },
};

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  deposit: 'Facture d’acompte',
  final: 'Facture de solde',
  standalone: 'Facture',
  credit: 'Avoir',
};

export function invoiceDisplay(
  i: { kind: InvoiceKind; status: InvoiceStatus; paidAt: string | null; dueDate: string | null },
  today: string,
): InvoiceDisplay {
  if (i.status === 'draft') return 'draft';
  if (i.kind === 'credit') return 'credit';
  if (i.status === 'cancelled') return 'cancelled';
  if (i.paidAt) return 'paid';
  if (i.dueDate && i.dueDate < today) return 'late';
  return 'to_pay';
}
