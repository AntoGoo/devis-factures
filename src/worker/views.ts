import { buildDocumentView, parseSnapshot, type DocumentView } from '../shared/document';
import type { Line } from '../shared/lines';
import { getClient } from './db/clients';
import { getProfile } from './db/profiles';
import type { QuoteRow } from './db/quotes';
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
