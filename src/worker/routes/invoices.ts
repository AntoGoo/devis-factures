import { Hono } from 'hono';
import { z } from 'zod';
import type { InvoiceResponse } from '../../shared/api-types';
import { todayInParis } from '../../shared/dates';
import { checkDeposit, depositAmountCents, DepositInputSchema } from '../../shared/deposits';
import { parseSnapshot } from '../../shared/document';
import { EDITABLE_FIELDS, InvoiceDraftInput } from '../../shared/invoice';
import { blankLines, computeTotals, type Line } from '../../shared/lines';
import { formatEuros, formatPercent } from '../../shared/money';
import { requireClient } from '../db/clients';
import { invoiceLinks, listInvoices, quoteBillingState, requireInvoiceRow, toInvoiceDto, type InvoiceRow } from '../db/invoices';
import { requireCompleteProfile } from '../db/profiles';
import { requireQuoteRow, type QuoteRow } from '../db/quotes';
import { HttpError, validate } from '../errors';
import type { AppContext, AppEnv } from '../types';
import { invoiceView } from '../views';

export const today = (c: AppContext) => todayInParis(c.var.deps.now());
const nowIso = (c: AppContext) => c.var.deps.now().toISOString();
const notDraft = () => new HttpError(409, 'not_draft', 'Une facture émise ne peut plus être modifiée ni supprimée. Corrigez-la par un avoir.');

export async function respondInvoice(c: AppContext, id: string, status: 200 | 201 = 200) {
  const row = await requireInvoiceRow(c.env.DB, c.var.user.id, id);
  const body: InvoiceResponse = {
    invoice: toInvoiceDto(row, today(c)),
    view: await invoiceView(c.env.DB, c.var.user.id, row),
    links: await invoiceLinks(c.env.DB, c.var.user.id, row),
  };
  return c.json(body, status);
}

function requireAccepted(q: QuoteRow): QuoteRow & { snapshot_json: string; number: string } {
  if (q.status !== 'accepted' || !q.snapshot_json || !q.number) throw new HttpError(409, 'quote_not_accepted', 'Seul un devis accepté peut être facturé.');
  return q as QuoteRow & { snapshot_json: string; number: string };
}

async function insertDraft(c: AppContext, v: { kind: InvoiceRow['kind']; quoteId: string | null; clientId: string | null; object: string; interventionAddress: string | null; lines: Line[]; depositBp?: number | null; amountDueCents?: number }) {
  const id = crypto.randomUUID();
  const total = computeTotals(v.lines).totalHtCents;
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, user_id, kind, quote_id, client_id, status, object, intervention_address, lines_json, deposit_bp, total_ht_cents, amount_due_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.user.id, v.kind, v.quoteId, v.clientId, v.object, v.interventionAddress, JSON.stringify(v.lines), v.depositBp ?? null, total, v.amountDueCents ?? total, nowIso(c), nowIso(c)).run();
  return id;
}

export const invoiceRoutes = new Hono<AppEnv>()
  .post('/quotes/:id/deposits', validate('json', DepositInputSchema), async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const quote = requireAccepted(await requireQuoteRow(DB, userId, c.req.param('id')));
    const snap = parseSnapshot(quote.snapshot_json);
    const totalCents = snap.totals.totalDueCents;
    const input = c.req.valid('json');
    const amount = depositAmountCents(totalCents, input);
    const state = await quoteBillingState(DB, userId, quote.id);
    if (state.activeFinal) throw new HttpError(409, 'final_exists', 'Une facture de solde existe déjà pour ce devis : plus d’acompte possible.');
    const check = checkDeposit(totalCents, state.depositAmounts, amount);
    if (!check.ok) {
      throw check.reason === 'non_positive'
        ? new HttpError(409, 'deposit_non_positive', 'Le montant de l’acompte doit être positif.')
        : new HttpError(409, 'deposit_exceeds_total', `La somme des acomptes dépasserait le total du devis. Reste facturable : ${formatEuros(check.remainingCents)}.`);
    }
    const label = input.mode === 'percent' ? `Acompte de ${formatPercent(input.basisPoints)} sur le devis ${quote.number}` : `Acompte sur le devis ${quote.number}`;
    const line: Line = { id: crypto.randomUUID(), designation: snap.object ? `${label} – ${snap.object}` : label, quantityMilli: 1000, unit: 'forfait', unitPriceCents: amount, vatRate: null };
    const id = crypto.randomUUID();
    // Le plafond et l'absence de solde sont revérifiés dans l'INSERT lui-même (deux onglets, double clic).
    const res = await DB.prepare(
      `INSERT INTO invoices (id, user_id, kind, quote_id, client_id, status, object, intervention_address, lines_json, deposit_bp, total_ht_cents, amount_due_cents, created_at, updated_at)
       SELECT ?, ?, 'deposit', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COALESCE(SUM(amount_due_cents), 0) FROM invoices WHERE user_id = ? AND quote_id = ? AND kind = 'deposit' AND status != 'cancelled') + ? <= ?
         AND NOT EXISTS (SELECT 1 FROM invoices WHERE user_id = ? AND quote_id = ? AND kind = 'final' AND status != 'cancelled')`,
    ).bind(id, userId, quote.id, quote.client_id, snap.object, snap.interventionAddress, JSON.stringify([line]),
      input.mode === 'percent' ? input.basisPoints : null, amount, amount, nowIso(c), nowIso(c), userId, quote.id, amount, totalCents, userId, quote.id).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'deposit_exceeds_total', 'La facturation de ce devis a changé entre-temps. Rechargez la page.');
    return respondInvoice(c, id, 201);
  })

  .post('/quotes/:id/final', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const quote = requireAccepted(await requireQuoteRow(DB, userId, c.req.param('id')));
    const state = await quoteBillingState(DB, userId, quote.id);
    if (state.activeFinal) throw new HttpError(409, 'final_exists', 'Une facture de solde existe déjà pour ce devis.');
    if (state.draftDepositCount > 0) throw new HttpError(409, 'pending_deposit_draft', 'Émettez ou supprimez d’abord la facture d’acompte en brouillon.');
    const snap = parseSnapshot(quote.snapshot_json);
    const lines = snap.lines.map((l) => ({ ...l, id: crypto.randomUUID() }));
    const total = computeTotals(lines).totalHtCents;
    const id = crypto.randomUUID();
    try {
      // L'absence d'acompte en brouillon est revérifiée dans l'INSERT lui-même (deux onglets, double clic).
      const res = await DB.prepare(
        `INSERT INTO invoices (id, user_id, kind, quote_id, client_id, status, object, intervention_address, lines_json, total_ht_cents, amount_due_cents, created_at, updated_at)
         SELECT ?, ?, 'final', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE user_id = ? AND quote_id = ? AND kind = 'deposit' AND status = 'draft')`,
      ).bind(id, userId, quote.id, quote.client_id, snap.object, snap.interventionAddress, JSON.stringify(lines),
        total, total - state.issuedDepositsCents, nowIso(c), nowIso(c), userId, quote.id).run();
      if (res.meta.changes === 0) throw new HttpError(409, 'pending_deposit_draft', 'Émettez ou supprimez d’abord la facture d’acompte en brouillon.');
      return respondInvoice(c, id, 201);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'final_exists', 'Une facture de solde existe déjà pour ce devis.');
      throw e;
    }
  })

  .post('/invoices/standalone', validate('json', z.object({ clientId: z.string().min(1).optional() })), async (c) => {
    const profile = await requireCompleteProfile(c.env.DB, c.var.user.id);
    const { clientId } = c.req.valid('json');
    if (clientId) await requireClient(c.env.DB, c.var.user.id, clientId);
    const id = await insertDraft(c, { kind: 'standalone', quoteId: null, clientId: clientId ?? null, object: '', interventionAddress: null, lines: blankLines(5, profile.units[0] ?? 'u') });
    return respondInvoice(c, id, 201);
  })

  .get('/invoices', validate('query', z.object({ kind: z.enum(['deposit', 'final', 'standalone', 'credit']).optional(), quoteId: z.string().optional() })), async (c) =>
    c.json({ items: await listInvoices(c.env.DB, c.var.user.id, c.req.valid('query'), today(c)) }))

  .get('/invoices/:id', (c) => respondInvoice(c, c.req.param('id')))

  .put('/invoices/:id', validate('json', InvoiceDraftInput), async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireInvoiceRow(DB, userId, c.req.param('id'));
    if (row.status !== 'draft' || row.kind === 'credit') throw notDraft();
    const input = c.req.valid('json');
    const allowed = EDITABLE_FIELDS[row.kind];
    const refused = (Object.keys(input) as (keyof InvoiceDraftInput)[]).filter((k) => input[k] !== undefined && !allowed.includes(k));
    if (refused.length > 0) throw new HttpError(400, 'field_not_editable', `Champ non modifiable pour ce type de facture : ${refused.join(', ')}.`);
    if (input.clientId) await requireClient(DB, userId, input.clientId);

    const lines = input.lines ?? (JSON.parse(row.lines_json) as Line[]);
    const total = computeTotals(lines).totalHtCents;
    const issuedDeposits = row.kind === 'final' && row.quote_id ? (await quoteBillingState(DB, userId, row.quote_id)).issuedDepositsCents : 0;
    const res = await DB.prepare(
      `UPDATE invoices SET client_id = ?, object = ?, intervention_address = ?, lines_json = ?, total_ht_cents = ?, amount_due_cents = ?,
         service_date = ?, due_date = ?, notes = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'draft'`,
    ).bind(
      input.clientId !== undefined ? input.clientId : row.client_id,
      input.object ?? row.object,
      input.interventionAddress !== undefined ? input.interventionAddress || null : row.intervention_address,
      JSON.stringify(lines), total, total - issuedDeposits,
      input.serviceDate, input.dueDate, input.notes, nowIso(c), row.id, userId,
    ).run();
    if (res.meta.changes === 0) throw notDraft();
    return respondInvoice(c, row.id);
  })

  .delete('/invoices/:id', async (c) => {
    const row = await requireInvoiceRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare("DELETE FROM invoices WHERE id = ? AND user_id = ? AND status = 'draft' AND kind != 'credit'").bind(row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notDraft();
    return c.body(null, 204);
  });
