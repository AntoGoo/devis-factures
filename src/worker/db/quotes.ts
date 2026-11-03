import type { QuoteDto, QuoteListItem } from '../../shared/api-types';
import type { Line } from '../../shared/lines';
import type { QuoteStatus } from '../../shared/status';
import { notFound } from '../errors';

export type QuoteRow = {
  id: string; user_id: string; client_id: string | null; number: string | null; status: QuoteStatus;
  object: string; intervention_address: string | null; lines_json: string; total_ht_cents: number;
  validity_days: number; planned_start: string; estimated_duration: string; payment_terms: string;
  planned_deposit_bp: number | null; quote_date: string | null; sent_at: string | null;
  accepted_at: string | null; refused_at: string | null; snapshot_json: string | null;
  created_at: string; updated_at: string;
};

export async function getQuoteRow(db: D1Database, userId: string, id: string): Promise<QuoteRow | null> {
  return db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').bind(id, userId).first<QuoteRow>();
}

export async function requireQuoteRow(db: D1Database, userId: string, id: string): Promise<QuoteRow> {
  const row = await getQuoteRow(db, userId, id);
  if (!row) throw notFound('Devis introuvable.');
  return row;
}

export function toQuoteDto(r: QuoteRow): QuoteDto {
  return {
    id: r.id, number: r.number, status: r.status, clientId: r.client_id, object: r.object,
    interventionAddress: r.intervention_address, lines: JSON.parse(r.lines_json) as Line[],
    validityDays: r.validity_days, plannedStart: r.planned_start, estimatedDuration: r.estimated_duration,
    paymentTerms: r.payment_terms, plannedDepositBp: r.planned_deposit_bp, quoteDate: r.quote_date,
    acceptedAt: r.accepted_at, refusedAt: r.refused_at, totalHtCents: r.total_ht_cents, updatedAt: r.updated_at,
  };
}

export async function listQuotes(db: D1Database, userId: string, status?: QuoteStatus): Promise<QuoteListItem[]> {
  const { results } = await db.prepare(
    `SELECT q.id, q.number, q.status, c.name AS client_name, q.object, q.total_ht_cents, q.quote_date, q.updated_at
     FROM quotes q LEFT JOIN clients c ON c.id = q.client_id AND c.user_id = q.user_id
     WHERE q.user_id = ?1 AND (?2 IS NULL OR q.status = ?2)
     ORDER BY q.updated_at DESC LIMIT 200`,
  ).bind(userId, status ?? null).all<{ id: string; number: string | null; status: QuoteStatus; client_name: string | null; object: string; total_ht_cents: number; quote_date: string | null; updated_at: string }>();
  return results.map((r) => ({
    id: r.id, number: r.number, status: r.status, clientName: r.client_name, object: r.object,
    totalHtCents: r.total_ht_cents, quoteDate: r.quote_date, updatedAt: r.updated_at,
  }));
}
