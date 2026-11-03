import { Hono } from 'hono';
import { ClientInput } from '../../shared/client';
import { insertClient, listClients, requireClient, updateClient } from '../db/clients';
import { HttpError, notFound, validate } from '../errors';
import type { AppEnv } from '../types';

export const clientRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await listClients(c.env.DB, c.var.user.id) }))
  .post('/', validate('json', ClientInput), async (c) =>
    c.json(await insertClient(c.env.DB, c.var.user.id, c.req.valid('json'), c.var.deps.now().toISOString()), 201))
  .get('/:id', async (c) => c.json(await requireClient(c.env.DB, c.var.user.id, c.req.param('id'))))
  .put('/:id', validate('json', ClientInput), async (c) =>
    c.json(await updateClient(c.env.DB, c.var.user.id, c.req.param('id'), c.req.valid('json'), c.var.deps.now().toISOString())))
  .delete('/:id', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const id = c.req.param('id');
    await requireClient(DB, userId, id);
    const used = await DB.prepare(
      'SELECT EXISTS (SELECT 1 FROM quotes WHERE client_id = ?1 AND user_id = ?2) OR EXISTS (SELECT 1 FROM invoices WHERE client_id = ?1 AND user_id = ?2) AS used',
    ).bind(id, userId).first<{ used: number }>();
    if (used?.used) throw new HttpError(409, 'client_in_use', 'Ce client figure sur des devis ou des factures : il ne peut pas être supprimé.');
    const res = await DB.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?').bind(id, userId).run();
    if (res.meta.changes === 0) throw notFound('Client introuvable.');
    return c.body(null, 204);
  });
