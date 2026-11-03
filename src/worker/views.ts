import { buildDocumentView, parseSnapshot, type DocumentView } from '../shared/document';
import type { Line } from '../shared/lines';
import { getClient } from './db/clients';
import { listIssuedDeposits, type InvoiceRow } from './db/invoices';
import { getProfile } from './db/profiles';
import { getQuoteRow, type QuoteRow } from './db/quotes';
import { HttpError } from './errors';

export async function quoteView(db: D1Database, userId: string, q: QuoteRow): Promise<DocumentView> {
  if (q.snapshot_json) return parseSnapshot(q.snapshot_json);
  const profile = await getProfile(db, userId);
  if (!profile) throw new HttpError(409, 'profile_incomplete', 'Complétez votre profil entreprise avant de continuer.');
  const client = q.client_id ? await getClient(db, userId, q.client_id) : null;
  return buildDocumentView({
    kind: 'quote', number: q.number, date: q.quote_date, templateRef: profile.templateRef, profile, client,
    object: q.object, interventionAddress: q.intervention_address, lines: JSON.parse(q.lines_json) as Line[],
    quoteTerms: {
      validityDays: q.validity_days, plannedStart: q.planned_start, estimatedDuration: q.estimated_duration,
      paymentTerms: q.payment_terms, plannedDepositBp: q.planned_deposit_bp,
    },
  });
}

export async function invoiceView(db: D1Database, userId: string, inv: InvoiceRow): Promise<DocumentView> {
  if (inv.snapshot_json) return parseSnapshot(inv.snapshot_json);
  if (inv.kind === 'credit') throw new Error('Un avoir est toujours figé.');
  const profile = await getProfile(db, userId);
  if (!profile) throw new HttpError(409, 'profile_incomplete', 'Complétez votre profil entreprise avant de continuer.');
  const client = inv.client_id ? await getClient(db, userId, inv.client_id) : null;
  const quote = inv.quote_id ? await getQuoteRow(db, userId, inv.quote_id) : null;
  return buildDocumentView({
    kind: inv.kind, number: inv.number, date: inv.issue_date, templateRef: profile.templateRef, profile, client,
    object: inv.object, interventionAddress: inv.intervention_address, lines: JSON.parse(inv.lines_json) as Line[],
    invoiceDates: { serviceDate: inv.service_date, dueDate: inv.due_date, notes: inv.notes },
    deductedDeposits: inv.kind === 'final' && quote ? await listIssuedDeposits(db, userId, quote.id) : undefined,
    quoteRef: quote?.number && quote.quote_date ? { number: quote.number, date: quote.quote_date } : null,
  });
}
