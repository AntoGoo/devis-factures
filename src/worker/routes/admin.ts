import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminEmailItem } from '../../shared/api-types';
import { isSuperadmin, normalizeEmail } from '../access';
import { HttpError, notFound, validate } from '../errors';
import { requireSuperadmin } from '../middleware';
import type { AppEnv } from '../types';

type Row = { email: string; added_at: string | null; last_login_at: string | null; trade_name: string | null };

const SELECT = `
  SELECT ? AS email, a.added_at, l.last_login_at, p.trade_name
  FROM (SELECT 1) AS one
  LEFT JOIN allowed_emails a ON a.email = ?
  LEFT JOIN login_activity l ON l.email = ?
  LEFT JOIN "user" u ON lower(u.email) = ?
  LEFT JOIN profiles p ON p.user_id = u.id`;

const toItem = (env: Env, r: Row): AdminEmailItem => ({
  email: r.email,
  isSuperadmin: isSuperadmin(env, r.email),
  tradeName: r.trade_name || null,
  lastLoginAt: r.last_login_at,
  addedAt: r.added_at,
});

async function itemFor(db: D1Database, env: Env, email: string): Promise<AdminEmailItem> {
  const row = await db.prepare(SELECT).bind(email, email, email, email).first<Row>();
  return toItem(env, row!);
}

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireSuperadmin)
  .get('/emails', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT a.email, a.added_at, l.last_login_at, p.trade_name
       FROM allowed_emails a
       LEFT JOIN login_activity l ON l.email = a.email
       LEFT JOIN "user" u ON lower(u.email) = a.email
       LEFT JOIN profiles p ON p.user_id = u.id
       ORDER BY a.added_at DESC`,
    ).all<Row>();
    const boss = await itemFor(c.env.DB, c.env, normalizeEmail(c.env.SUPERADMIN_EMAIL));
    return c.json({ items: [boss, ...results.filter((r) => !isSuperadmin(c.env, r.email)).map((r) => toItem(c.env, r))] });
  })
  .post('/emails', validate('json', z.object({ email: z.string().trim().email() })), async (c) => {
    const email = normalizeEmail(c.req.valid('json').email);
    if (isSuperadmin(c.env, email)) throw new HttpError(409, 'already_allowed', 'Cette adresse est celle du superadmin.');
    const res = await c.env.DB.prepare(
      'INSERT INTO allowed_emails (email, added_at, added_by) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING',
    ).bind(email, c.var.deps.now().toISOString(), normalizeEmail(c.var.user.email)).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'already_allowed', 'Cette adresse est déjà autorisée.');
    return c.json(await itemFor(c.env.DB, c.env, email), 201);
  })
  .delete('/emails/:email', async (c) => {
    const email = normalizeEmail(decodeURIComponent(c.req.param('email')));
    if (isSuperadmin(c.env, email)) throw new HttpError(400, 'cannot_remove_superadmin', 'Le superadmin ne peut pas être retiré.');
    const [removed] = await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(email),
      c.env.DB.prepare('DELETE FROM session WHERE userId IN (SELECT id FROM "user" WHERE lower(email) = ?)').bind(email),
    ]);
    if (removed.meta.changes === 0) throw notFound('Adresse absente de la liste.');
    return c.body(null, 204);
  });
