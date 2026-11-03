import { Hono } from 'hono';
import { z } from 'zod';
import type { QuoteResponse } from '../../shared/api-types';
import { todayInParis, yearOf } from '../../shared/dates';
import { blankLines, computeTotals, lineProblems, type Line } from '../../shared/lines';
import { QuoteDraftInput } from '../../shared/quote';
import { requireClient } from '../db/clients';
import { requireCompleteProfile } from '../db/profiles';
import { listQuotes, requireQuoteRow, toQuoteDto, type QuoteRow } from '../db/quotes';
import { HttpError, validate } from '../errors';
import { runIssue } from '../numbering';
import type { AppContext, AppEnv } from '../types';
import { quoteView } from '../views';

async function respond(c: AppContext, id: string, status: 200 | 201 = 200) {
  const row = await requireQuoteRow(c.env.DB, c.var.user.id, id);
  const body: QuoteResponse = { quote: toQuoteDto(row), view: await quoteView(c.env.DB, c.var.user.id, row) };
  return c.json(body, status);
}

const nowIso = (c: AppContext) => c.var.deps.now().toISOString();
const notSent = () => new HttpError(409, 'not_sent', 'Seul un devis envoyé peut être accepté ou refusé.');

async function insertQuote(
  c: AppContext,
  values: Omit<QuoteRow, 'id' | 'user_id' | 'number' | 'status' | 'quote_date' | 'sent_at' | 'accepted_at' | 'refused_at' | 'snapshot_json' | 'created_at' | 'updated_at'>,
) {
  const id = crypto.randomUUID();
  const now = nowIso(c);
  await c.env.DB.prepare(
    `INSERT INTO quotes (id, user_id, client_id, status, object, intervention_address, lines_json, total_ht_cents, validity_days,
       planned_start, estimated_duration, payment_terms, planned_deposit_bp, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.user.id, values.client_id, values.object, values.intervention_address, values.lines_json, values.total_ht_cents,
    values.validity_days, values.planned_start, values.estimated_duration, values.payment_terms, values.planned_deposit_bp, now, now).run();
  return id;
}

export const quoteRoutes = new Hono<AppEnv>()
  .get('/', validate('query', z.object({ status: z.enum(['draft', 'sent', 'accepted', 'refused']).optional() })), async (c) =>
    c.json({ items: await listQuotes(c.env.DB, c.var.user.id, c.req.valid('query').status) }))

  .post('/', validate('json', z.object({ clientId: z.string().min(1).optional() })), async (c) => {
    const { DB } = c.env;
    const profile = await requireCompleteProfile(DB, c.var.user.id);
    const { clientId } = c.req.valid('json');
    if (clientId) await requireClient(DB, c.var.user.id, clientId);
    const id = await insertQuote(c, {
      client_id: clientId ?? null, object: '', intervention_address: null,
      lines_json: JSON.stringify(blankLines(5, profile.units[0] ?? 'u')), total_ht_cents: 0,
      validity_days: profile.defaultQuoteValidityDays, planned_start: '', estimated_duration: '', payment_terms: '', planned_deposit_bp: null,
    });
    return respond(c, id, 201);
  })

  .get('/:id', (c) => respond(c, c.req.param('id')))

  .put('/:id', validate('json', QuoteDraftInput), async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireQuoteRow(DB, userId, c.req.param('id'));
    if (row.status !== 'draft' && row.status !== 'sent') throw new HttpError(409, 'frozen', 'Ce devis est figé : il ne peut plus être modifié.');
    const input = c.req.valid('json');
    if (input.clientId) await requireClient(DB, userId, input.clientId);
    const res = await DB.prepare(
      `UPDATE quotes SET client_id = ?, object = ?, intervention_address = ?, lines_json = ?, total_ht_cents = ?, validity_days = ?,
         planned_start = ?, estimated_duration = ?, payment_terms = ?, planned_deposit_bp = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status IN ('draft', 'sent')`,
    ).bind(input.clientId, input.object, input.interventionAddress || null, JSON.stringify(input.lines), computeTotals(input.lines).totalHtCents,
      input.validityDays, input.plannedStart, input.estimatedDuration, input.paymentTerms, input.plannedDepositBp, nowIso(c), row.id, userId).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'frozen', 'Ce devis est figé : il ne peut plus être modifié.');
    return respond(c, row.id);
  })

  .delete('/:id', async (c) => {
    const row = await requireQuoteRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare("DELETE FROM quotes WHERE id = ? AND user_id = ? AND status = 'draft'").bind(row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'not_draft', 'Seul un brouillon peut être supprimé.');
    return c.body(null, 204);
  })

  .post('/:id/send', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireQuoteRow(DB, userId, c.req.param('id'));
    if (row.status !== 'draft') throw new HttpError(409, 'not_draft', 'Ce devis a déjà été envoyé.');
    const profile = await requireCompleteProfile(DB, userId);
    if (!row.client_id) throw new HttpError(409, 'client_missing', 'Choisissez un client avant d’envoyer le devis.');
    const problems = lineProblems(JSON.parse(row.lines_json) as Line[]);
    if (problems.filledCount === 0) throw new HttpError(409, 'no_lines', 'Ajoutez au moins une ligne remplie.');
    if (problems.missingDesignation.length > 0) {
      throw new HttpError(409, 'missing_designation', `Chaque ligne chiffrée doit avoir une désignation (ligne ${problems.missingDesignation.join(', ')}).`);
    }
    const today = todayInParis(c.var.deps.now());
    const result = await runIssue(DB, {
      table: 'quotes', docId: row.id, userId, series: 'D', year: yearOf(today), prefix: profile.prefixQuote,
      set: { status: 'sent', quote_date: today, sent_at: nowIso(c), updated_at: nowIso(c) },
    });
    if (!result.issued) throw new HttpError(409, 'not_draft', 'Ce devis a déjà été envoyé.');
    return respond(c, row.id);
  })

  .post('/:id/accept', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireQuoteRow(DB, userId, c.req.param('id'));
    if (row.status !== 'sent') throw notSent();
    const view = await quoteView(DB, userId, row);
    const res = await DB.prepare(
      "UPDATE quotes SET status = 'accepted', accepted_at = ?, snapshot_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'sent'",
    ).bind(nowIso(c), JSON.stringify(view), nowIso(c), row.id, userId).run();
    if (res.meta.changes === 0) throw notSent();
    return respond(c, row.id);
  })

  .post('/:id/refuse', async (c) => {
    const row = await requireQuoteRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare(
      "UPDATE quotes SET status = 'refused', refused_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'sent'",
    ).bind(nowIso(c), nowIso(c), row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notSent();
    return respond(c, row.id);
  })

  .post('/:id/duplicate', async (c) => {
    const row = await requireQuoteRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const lines = (JSON.parse(row.lines_json) as Line[]).map((l) => ({ ...l, id: crypto.randomUUID() }));
    const id = await insertQuote(c, {
      client_id: row.client_id, object: row.object, intervention_address: row.intervention_address,
      lines_json: JSON.stringify(lines), total_ht_cents: row.total_ht_cents, validity_days: row.validity_days,
      planned_start: row.planned_start, estimated_duration: row.estimated_duration, payment_terms: row.payment_terms,
      planned_deposit_bp: row.planned_deposit_bp,
    });
    return respond(c, id, 201);
  });
