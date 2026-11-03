import type { InvoiceDto, InvoiceLinks, InvoiceListItem } from '../../shared/api-types';
import type { DeductedDeposit } from '../../shared/balance';
import type { Line } from '../../shared/lines';
import { invoiceDisplay, type InvoiceKind, type InvoiceStatus } from '../../shared/status';
import { notFound } from '../errors';

export type InvoiceRow = {
  id: string; user_id: string; kind: InvoiceKind; quote_id: string | null; credited_invoice_id: string | null;
  credited_by_id: string | null; client_id: string | null; number: string | null; status: InvoiceStatus;
  object: string; intervention_address: string | null; lines_json: string; deposit_bp: number | null;
  total_ht_cents: number; amount_due_cents: number; service_date: string | null; due_date: string | null;
  notes: string; issue_date: string | null; paid_at: string | null; cancelled_at: string | null;
  snapshot_json: string | null; created_at: string; updated_at: string;
};

export async function getInvoiceRow(db: D1Database, userId: string, id: string): Promise<InvoiceRow | null> {
  return db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').bind(id, userId).first<InvoiceRow>();
}

export async function requireInvoiceRow(db: D1Database, userId: string, id: string): Promise<InvoiceRow> {
  const row = await getInvoiceRow(db, userId, id);
  if (!row) throw notFound('Facture introuvable.');
  return row;
}

export function toInvoiceDto(r: InvoiceRow, today: string): InvoiceDto {
  return {
    id: r.id, kind: r.kind, status: r.status, number: r.number, quoteId: r.quote_id, clientId: r.client_id,
    object: r.object, interventionAddress: r.intervention_address, lines: JSON.parse(r.lines_json) as Line[],
    depositBp: r.deposit_bp, totalHtCents: r.total_ht_cents, amountDueCents: r.amount_due_cents,
    serviceDate: r.service_date, dueDate: r.due_date, notes: r.notes, issueDate: r.issue_date, paidAt: r.paid_at,
    cancelledAt: r.cancelled_at, updatedAt: r.updated_at,
    display: invoiceDisplay({ kind: r.kind, status: r.status, paidAt: r.paid_at, dueDate: r.due_date }, today),
  };
}

export async function invoiceLinks(db: D1Database, userId: string, r: InvoiceRow): Promise<InvoiceLinks> {
  const one = async (table: 'quotes' | 'invoices', id: string | null) =>
    id ? db.prepare(`SELECT id, number FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, userId).first<{ id: string; number: string | null }>() : null;
  return {
    quote: await one('quotes', r.quote_id),
    creditNote: await one('invoices', r.credited_by_id),
    creditedInvoice: await one('invoices', r.credited_invoice_id),
  };
}

type ListRow = { id: string; kind: InvoiceKind; status: InvoiceStatus; number: string | null; client_name: string | null; issue_date: string | null; due_date: string | null; amount_due_cents: number; paid_at: string | null; deposit_bp: number | null; quote_id: string | null };

export async function listInvoices(db: D1Database, userId: string, f: { kind?: InvoiceKind; quoteId?: string }, today: string): Promise<InvoiceListItem[]> {
  const { results } = await db.prepare(
    `SELECT i.id, i.kind, i.status, i.number, c.name AS client_name, i.issue_date, i.due_date, i.amount_due_cents, i.paid_at, i.deposit_bp, i.quote_id
     FROM invoices i LEFT JOIN clients c ON c.id = i.client_id AND c.user_id = i.user_id
     WHERE i.user_id = ?1 AND (?2 IS NULL OR i.kind = ?2) AND (?3 IS NULL OR i.quote_id = ?3)
     ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.number DESC LIMIT 200`,
  ).bind(userId, f.kind ?? null, f.quoteId ?? null).all<ListRow>();
  return results.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, number: r.number, clientName: r.client_name, issueDate: r.issue_date,
    dueDate: r.due_date, amountDueCents: r.amount_due_cents, paidAt: r.paid_at, depositBp: r.deposit_bp, quoteId: r.quote_id,
    display: invoiceDisplay({ kind: r.kind, status: r.status, paidAt: r.paid_at, dueDate: r.due_date }, today),
  }));
}

export async function listIssuedDeposits(db: D1Database, userId: string, quoteId: string): Promise<DeductedDeposit[]> {
  const { results } = await db.prepare(
    `SELECT id, number, issue_date, amount_due_cents FROM invoices
     WHERE user_id = ? AND quote_id = ? AND kind = 'deposit' AND status = 'issued' ORDER BY issue_date, number`,
  ).bind(userId, quoteId).all<{ id: string; number: string; issue_date: string; amount_due_cents: number }>();
  return results.map((r) => ({ invoiceId: r.id, number: r.number, issueDate: r.issue_date, amountCents: r.amount_due_cents }));
}

export async function quoteBillingState(db: D1Database, userId: string, quoteId: string) {
  const { results } = await db.prepare(
    "SELECT id, kind, status, amount_due_cents FROM invoices WHERE user_id = ? AND quote_id = ? AND kind IN ('deposit', 'final') AND status != 'cancelled'",
  ).bind(userId, quoteId).all<{ id: string; kind: InvoiceKind; status: InvoiceStatus; amount_due_cents: number }>();
  const deposits = results.filter((r) => r.kind === 'deposit');
  const final = results.find((r) => r.kind === 'final');
  return {
    depositAmounts: deposits.map((d) => d.amount_due_cents),
    draftDepositCount: deposits.filter((d) => d.status === 'draft').length,
    issuedDepositsCents: deposits.filter((d) => d.status === 'issued').reduce((s, d) => s + d.amount_due_cents, 0),
    activeFinal: final ? { id: final.id, status: final.status } : null,
  };
}
