import { Hono } from 'hono';
import { PresetInput } from '../../shared/preset';
import { deletePreset, insertPreset, listPresets, updatePreset } from '../db/presets';
import { validate } from '../errors';
import type { AppEnv } from '../types';

export const presetRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await listPresets(c.env.DB, c.var.user.id) }))
  .post('/', validate('json', PresetInput), async (c) =>
    c.json(await insertPreset(c.env.DB, c.var.user.id, c.req.valid('json'), c.var.deps.now().toISOString()), 201))
  .put('/:id', validate('json', PresetInput), async (c) =>
    c.json(await updatePreset(c.env.DB, c.var.user.id, c.req.param('id'), c.req.valid('json'), c.var.deps.now().toISOString())))
  .delete('/:id', async (c) => {
    await deletePreset(c.env.DB, c.var.user.id, c.req.param('id'));
    return c.body(null, 204);
  });
