import { Hono } from 'hono';
import type { BillingSummary } from '../../shared/api-types';
import { todayInParis } from '../../shared/dates';
import { parseSnapshot } from '../../shared/document';
import { listInvoices, quoteBillingState } from '../db/invoices';
import { requireQuoteRow } from '../db/quotes';
import { HttpError } from '../errors';
import type { AppEnv } from '../types';

export const billingRoutes = new Hono<AppEnv>().get('/quotes/:id/billing', async (c) => {
  const { DB } = c.env;
  const userId = c.var.user.id;
  const row = await requireQuoteRow(DB, userId, c.req.param('id'));
  if (row.status !== 'accepted' || !row.snapshot_json || !row.number || !row.accepted_at) {
    throw new HttpError(409, 'quote_not_accepted', 'Seul un devis accepté peut être facturé.');
  }
  const snap = parseSnapshot(row.snapshot_json);
  const total = snap.totals.totalDueCents;
  const state = await quoteBillingState(DB, userId, row.id);
  const invoiced = state.depositAmounts.reduce((s, x) => s + x, 0);
  const body: BillingSummary = {
    quote: {
      id: row.id, number: row.number, acceptedAt: row.accepted_at, clientName: snap.client?.name ?? '', object: snap.object,
      totalCents: total, plannedDepositBp: row.planned_deposit_bp, lineCount: snap.lines.length,
    },
    invoices: await listInvoices(DB, userId, { quoteId: row.id }, todayInParis(c.var.deps.now())),
    invoicedDepositsCents: invoiced,
    issuedDepositsCents: state.issuedDepositsCents,
    remainingToInvoiceCents: total - invoiced,
    activeFinal: state.activeFinal,
    draftDepositCount: state.draftDepositCount,
    canCreateDeposit: !state.activeFinal && invoiced < total,
    canPrepareFinal: !state.activeFinal && state.draftDepositCount === 0,
  };
  return c.json(body);
});
