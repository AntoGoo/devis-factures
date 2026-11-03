import { Hono } from 'hono';
import { z } from 'zod';
import type { DashboardData, RecentDocument } from '../../shared/api-types';
import { monthRange, todayInParis } from '../../shared/dates';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL, QUOTE_STATUS, invoiceDisplay, type InvoiceKind, type InvoiceStatus, type QuoteStatus } from '../../shared/status';
import { getProfile } from '../db/profiles';
import { validate } from '../errors';
import type { AppEnv } from '../types';

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });

export const dashboardRoutes = new Hono<AppEnv>().get(
  '/dashboard',
  validate('query', z.object({ filter: z.enum(['all', 'quotes', 'invoices']).default('all') })),
  async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const { filter } = c.req.valid('query');
    const today = todayInParis(c.var.deps.now());
    const month = monthRange(today);

    const [outstanding, pending, collected, quotes, invoices] = await DB.batch([
      DB.prepare(
        `SELECT COALESCE(SUM(amount_due_cents), 0) AS total, COALESCE(SUM(CASE WHEN due_date < ? THEN amount_due_cents ELSE 0 END), 0) AS late
         FROM invoices WHERE user_id = ? AND status = 'issued' AND paid_at IS NULL AND kind != 'credit'`,
      ).bind(today, userId),
      DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_ht_cents), 0) AS total FROM quotes WHERE user_id = ? AND status = 'sent'").bind(userId),
      DB.prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount_due_cents), 0) AS total FROM invoices WHERE user_id = ? AND kind != 'credit' AND paid_at >= ? AND paid_at < ?",
      ).bind(userId, month.start, month.end),
      DB.prepare(
        `SELECT q.id, q.number, q.status, c.name AS client_name, q.quote_date AS date, q.total_ht_cents AS amount, q.updated_at
         FROM quotes q LEFT JOIN clients c ON c.id = q.client_id AND c.user_id = q.user_id
         WHERE q.user_id = ? ORDER BY q.updated_at DESC LIMIT 10`,
      ).bind(userId),
      DB.prepare(
        `SELECT i.id, i.number, i.kind, i.status, i.paid_at, i.due_date, c.name AS client_name, i.issue_date AS date, i.amount_due_cents AS amount, i.updated_at
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id AND c.user_id = i.user_id
         WHERE i.user_id = ? ORDER BY i.updated_at DESC LIMIT 10`,
      ).bind(userId),
    ]);

    type Q = { id: string; number: string | null; status: QuoteStatus; client_name: string | null; date: string | null; amount: number; updated_at: string };
    type I = { id: string; number: string | null; kind: InvoiceKind; status: InvoiceStatus; paid_at: string | null; due_date: string | null; client_name: string | null; date: string | null; amount: number; updated_at: string };

    const recentQuotes: RecentDocument[] = (quotes!.results as Q[]).map((q) => ({
      type: 'quote', id: q.id, number: q.number, kindLabel: q.status === 'draft' ? 'Devis (brouillon)' : 'Devis',
      clientName: q.client_name, date: q.date, amountCents: q.amount, status: QUOTE_STATUS[q.status], updatedAt: q.updated_at,
    }));
    const recentInvoices: RecentDocument[] = (invoices!.results as I[]).map((i) => ({
      type: 'invoice', id: i.id, number: i.number,
      kindLabel: `${INVOICE_KIND_LABEL[i.kind]}${i.status === 'draft' ? ' (brouillon)' : ''}`,
      clientName: i.client_name, date: i.date, amountCents: i.amount,
      status: INVOICE_DISPLAY[invoiceDisplay({ kind: i.kind, status: i.status, paidAt: i.paid_at, dueDate: i.due_date }, today)],
      updatedAt: i.updated_at,
    }));
    const recent = [...(filter === 'invoices' ? [] : recentQuotes), ...(filter === 'quotes' ? [] : recentInvoices)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10);

    const profile = await getProfile(DB, userId);
    const o = outstanding!.results[0] as { total: number; late: number };
    const p = pending!.results[0] as { n: number; total: number };
    const k = collected!.results[0] as { n: number; total: number };
    const body: DashboardData = {
      today,
      greetingName: ((profile?.ownerName || c.var.user.name).split(/\s+/)[0]) ?? '',
      outstanding: { totalCents: o.total, lateCents: o.late },
      pendingQuotes: { count: p.n, totalCents: p.total },
      collectedThisMonth: { totalCents: k.total, count: k.n, monthLabel: MONTH.format(new Date(`${month.start}T00:00:00Z`)) },
      recent,
    };
    return c.json(body);
  },
);
