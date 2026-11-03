import { Hono } from 'hono';
import { z } from 'zod';
import type { NumberingInfo } from '../../shared/api-types';
import { todayInParis, yearOf } from '../../shared/dates';
import { formatDocumentNumber, type Series } from '../../shared/numbering';
import { ProfileInput } from '../../shared/profile';
import { isKnownTemplateRef } from '../../templates/catalog';
import { getProfile, saveProfile, setTemplate } from '../db/profiles';
import { HttpError, validate } from '../errors';
import type { AppContext, AppEnv } from '../types';

const SERIES: Series[] = ['D', 'F', 'A'];

async function numberingInfo(c: AppContext): Promise<NumberingInfo> {
  const userId = c.var.user.id;
  const profile = await getProfile(c.env.DB, userId);
  const prefixes: Record<Series, string> = {
    D: profile?.prefixQuote ?? 'D',
    F: profile?.prefixInvoice ?? 'F',
    A: profile?.prefixCredit ?? 'A',
  };
  const year = yearOf(todayInParis(c.var.deps.now()));
  const { results } = await c.env.DB.prepare('SELECT series, year, last_value FROM counters WHERE user_id = ?')
    .bind(userId)
    .all<{ series: Series; year: number; last_value: number }>();
  return {
    year,
    series: SERIES.map((s) => {
      const current = results.find((r) => r.series === s && r.year === year);
      return {
        series: s,
        prefix: prefixes[s],
        next: formatDocumentNumber(prefixes[s], year, (current?.last_value ?? 0) + 1),
        startEditable: !results.some((r) => r.series === s),
      };
    }),
  };
}

export const profileRoutes = new Hono<AppEnv>()
  .get('/profile', async (c) => c.json({ profile: await getProfile(c.env.DB, c.var.user.id) }))
  .put('/profile', validate('json', ProfileInput), async (c) => {
    await saveProfile(c.env.DB, c.var.user.id, c.req.valid('json'), c.var.deps.now().toISOString());
    return c.json({ profile: await getProfile(c.env.DB, c.var.user.id) });
  })
  .put('/profile/template', validate('json', z.object({ templateRef: z.string().refine(isKnownTemplateRef, 'Modèle inconnu') })), async (c) => {
    await setTemplate(c.env.DB, c.var.user.id, c.req.valid('json').templateRef, c.var.deps.now().toISOString());
    return c.json({ profile: await getProfile(c.env.DB, c.var.user.id) });
  })
  .get('/numbering', async (c) => c.json(await numberingInfo(c)))
  .put(
    '/numbering/start',
    validate('json', z.object({ series: z.enum(['D', 'F', 'A']), startNumber: z.number().int().min(1).max(999_999) })),
    async (c) => {
      const { series, startNumber } = c.req.valid('json');
      const userId = c.var.user.id;
      const year = yearOf(todayInParis(c.var.deps.now()));
      const res = await c.env.DB.prepare(
        `INSERT INTO counters (user_id, series, year, last_value)
         SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM counters WHERE user_id = ? AND series = ?)`,
      ).bind(userId, series, year, startNumber - 1, userId, series).run();
      if (res.meta.changes === 0) {
        throw new HttpError(409, 'numbering_locked', 'Le numéro de départ ne peut plus être modifié pour cette série.');
      }
      return c.json(await numberingInfo(c));
    },
  );
