import { Hono } from 'hono';
import { z } from 'zod';
import type { InvoiceResponse } from '../../shared/api-types';
import { computeBalance } from '../../shared/balance';
import { addDays, isIsoDate, todayInParis, yearOf } from '../../shared/dates';
import { checkDeposit, depositAmountCents, DepositInputSchema } from '../../shared/deposits';
import { buildCreditView, buildDocumentView, parseSnapshot } from '../../shared/document';
import { EDITABLE_FIELDS, InvoiceDraftInput } from '../../shared/invoice';
import { blankLines, computeTotals, lineProblems, type Line } from '../../shared/lines';
import { formatEuros, formatPercent } from '../../shared/money';
import { getClient, requireClient } from '../db/clients';
import { invoiceLinks, listInvoices, listIssuedDeposits, quoteBillingState, requireInvoiceRow, toInvoiceDto, type InvoiceRow } from '../db/invoices';
import { requireCompleteProfile } from '../db/profiles';
import { getQuoteRow, requireQuoteRow, type QuoteRow } from '../db/quotes';
import { HttpError, validate } from '../errors';
import { runIssue } from '../numbering';
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

/**
 * Condition d'émission (alias d) : le brouillon est encore la version lue (aucun enregistrement entre-temps) ;
 * pour un solde, les acomptes déduits (`deductedCount` émis, aucun en brouillon) n'ont pas changé ;
 * pour un acompte, aucun solde n'a été émis.
 */
export function issueGuard(inv: InvoiceRow, deductedCount: number | null): { sql: string; params: (string | number | null)[] } {
  const sql = ['AND d.updated_at = ?'];
  const params: (string | number | null)[] = [inv.updated_at];
  if (inv.kind === 'final' && deductedCount !== null) {
    sql.push(`AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.quote_id = d.quote_id AND x.kind = 'deposit' AND x.status = 'draft')
              AND (SELECT COUNT(*) FROM invoices x WHERE x.quote_id = d.quote_id AND x.kind = 'deposit' AND x.status = 'issued') = ?`);
    params.push(deductedCount);
  }
  if (inv.kind === 'deposit') {
    sql.push(`AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.quote_id = d.quote_id AND x.kind = 'final' AND x.status = 'issued')`);
  }
  return { sql: sql.join(' '), params };
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

  .post('/invoices/:id/issue', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const inv = await requireInvoiceRow(DB, userId, c.req.param('id'));
    if (inv.status !== 'draft' || inv.kind === 'credit') throw new HttpError(409, 'not_draft', 'Cette facture est déjà émise.');
    const profile = await requireCompleteProfile(DB, userId);
    const client = inv.client_id ? await getClient(DB, userId, inv.client_id) : null;
    if (!client) throw new HttpError(409, 'client_missing', 'Choisissez un client avant d’émettre la facture.');
    if (client.type === 'business' && !client.siren) {
      throw new HttpError(409, 'client_siren_required', 'Ajoutez le SIREN de ce client professionnel avant d’émettre la facture.');
    }
    if (!client.street.trim() || !client.postalCode.trim() || !client.city.trim()) {
      throw new HttpError(409, 'client_address_required', 'Complétez l’adresse de facturation du client (rue, code postal, ville) avant d’émettre la facture.');
    }
    const lines = JSON.parse(inv.lines_json) as Line[];
    const problems = lineProblems(lines);
    if (problems.filledCount === 0) throw new HttpError(409, 'no_lines', 'Ajoutez au moins une ligne remplie.');
    if (problems.missingDesignation.length > 0) {
      throw new HttpError(409, 'missing_designation', `Chaque ligne chiffrée doit avoir une désignation (ligne ${problems.missingDesignation.join(', ')}).`);
    }
    if (computeTotals(lines).totalHtCents <= 0) throw new HttpError(409, 'non_positive_total', 'Le total de la facture doit être positif.');

    const issueDate = today(c);
    const serviceDate = inv.service_date ?? issueDate;
    const dueDate = inv.due_date ?? addDays(issueDate, profile.defaultPaymentDelayDays);
    if (dueDate < issueDate) throw new HttpError(409, 'due_before_issue', 'L’échéance ne peut pas précéder la date d’émission.');

    const quote = inv.quote_id ? await getQuoteRow(DB, userId, inv.quote_id) : null;
    let deducted: Awaited<ReturnType<typeof listIssuedDeposits>> = [];
    let deductedCount: number | null = null;
    if (inv.kind === 'final' && quote) {
      if ((await quoteBillingState(DB, userId, quote.id)).draftDepositCount > 0) {
        throw new HttpError(409, 'pending_deposit_draft', 'Émettez ou supprimez d’abord la facture d’acompte en brouillon.');
      }
      deducted = await listIssuedDeposits(DB, userId, quote.id);
      deductedCount = deducted.length;
      if (computeBalance(computeTotals(lines).totalHtCents, deducted).remainingCents < 0) {
        throw new HttpError(409, 'negative_remaining', 'Le total du solde est inférieur aux acomptes déjà facturés. Ajustez les lignes.');
      }
    }

    const view = buildDocumentView({
      kind: inv.kind, number: null, date: issueDate, templateRef: profile.templateRef, profile, client,
      object: inv.object, interventionAddress: inv.intervention_address, lines,
      invoiceDates: { serviceDate, dueDate, notes: inv.notes },
      deductedDeposits: inv.kind === 'final' ? deducted : undefined,
      quoteRef: quote?.number && quote.quote_date ? { number: quote.number, date: quote.quote_date } : null,
    });
    const result = await runIssue(DB, {
      table: 'invoices', docId: inv.id, userId, series: 'F', year: yearOf(issueDate), prefix: profile.prefixInvoice,
      set: {
        status: 'issued', issue_date: issueDate, service_date: serviceDate, due_date: dueDate,
        total_ht_cents: view.totals.totalHtCents, amount_due_cents: view.totals.totalDueCents, updated_at: nowIso(c),
      },
      snapshotJson: JSON.stringify(view),
      guard: issueGuard(inv, deductedCount),
    });
    if (!result.issued) throw new HttpError(409, 'not_draft', 'La facture a été modifiée entre-temps. Rechargez la page.');
    return respondInvoice(c, inv.id);
  })

  .put('/invoices/:id/payment', validate('json', z.object({ paidAt: z.string().refine(isIsoDate).nullable() })), async (c) => {
    const row = await requireInvoiceRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const notPayable = new HttpError(409, 'not_payable', 'Seule une facture émise et non annulée peut être marquée payée.');
    if (row.status !== 'issued' || row.kind === 'credit') throw notPayable;
    const { paidAt } = c.req.valid('json');
    if (paidAt && row.issue_date && paidAt < row.issue_date) throw new HttpError(409, 'paid_before_issue', 'La date de paiement précède la date d’émission.');
    if (paidAt && paidAt > today(c)) throw new HttpError(409, 'paid_in_future', 'La date de paiement ne peut pas être dans le futur.');
    const res = await c.env.DB.prepare(
      "UPDATE invoices SET paid_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'issued' AND kind != 'credit'",
    ).bind(paidAt, nowIso(c), row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notPayable;
    return respondInvoice(c, row.id);
  })

  .post('/invoices/:id/credit-note', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const orig = await requireInvoiceRow(DB, userId, c.req.param('id'));
    const notCreditable = new HttpError(409, 'not_creditable', 'Seule une facture émise et non annulée peut recevoir un avoir.');
    if (orig.kind === 'credit' || orig.status !== 'issued' || !orig.snapshot_json || !orig.number || !orig.issue_date) throw notCreditable;
    if (orig.kind === 'deposit' && orig.quote_id) {
      const state = await quoteBillingState(DB, userId, orig.quote_id);
      if (state.activeFinal?.status === 'issued') {
        throw new HttpError(409, 'deposit_deducted', 'Cet acompte est déduit par la facture de solde : annulez d’abord le solde par un avoir.');
      }
    }
    const profile = await requireCompleteProfile(DB, userId);
    const client = orig.client_id ? await getClient(DB, userId, orig.client_id) : null;
    const issueDate = today(c);
    const view = buildCreditView(parseSnapshot(orig.snapshot_json), {
      date: issueDate, templateRef: profile.templateRef, profile, client, creditedRef: { number: orig.number, date: orig.issue_date },
    });
    const creditId = crypto.randomUUID();
    const now = nowIso(c);
    const before = [
      // 1. Annule la facture d'origine si elle est encore annulable, en la reliant à l'avoir.
      DB.prepare(
        `UPDATE invoices SET status = 'cancelled', cancelled_at = ?, credited_by_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'issued' AND kind != 'credit'
           AND NOT (kind = 'deposit' AND EXISTS (
             SELECT 1 FROM invoices f WHERE f.quote_id = invoices.quote_id AND f.user_id = invoices.user_id AND f.kind = 'final' AND f.status = 'issued'
           ))`,
      ).bind(now, creditId, now, orig.id, userId),
      // 2. Crée l'avoir en brouillon seulement si l'annulation ci-dessus a eu lieu.
      DB.prepare(
        `INSERT INTO invoices (id, user_id, kind, quote_id, credited_invoice_id, client_id, status, object, intervention_address, lines_json, total_ht_cents, amount_due_cents, created_at, updated_at)
         SELECT ?, ?, 'credit', ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM invoices WHERE id = ? AND user_id = ? AND credited_by_id = ?)`,
      ).bind(creditId, userId, orig.quote_id, orig.id, orig.client_id, view.object, view.interventionAddress, JSON.stringify(view.lines),
        view.totals.totalHtCents, view.totals.totalDueCents, now, now, orig.id, userId, creditId),
    ];
    // 3. Numérote l'avoir (série A) dans le même batch.
    const result = await runIssue(DB, {
      table: 'invoices', docId: creditId, userId, series: 'A', year: yearOf(issueDate), prefix: profile.prefixCredit,
      set: { status: 'issued', issue_date: issueDate, updated_at: now }, snapshotJson: JSON.stringify(view),
    }, { before });
    if (!result.issued) throw notCreditable;
    return respondInvoice(c, creditId, 201);
  })

  .delete('/invoices/:id', async (c) => {
    const row = await requireInvoiceRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare("DELETE FROM invoices WHERE id = ? AND user_id = ? AND status = 'draft' AND kind != 'credit'").bind(row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notDraft();
    return c.body(null, 204);
  });
