import { Hono } from 'hono';
import { onError } from './errors';
import { requireUser, sameOrigin } from './middleware';
import { meRoutes } from './routes/me';
import type { AppDeps, AppEnv } from './types';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  // Routes publiques : déclarées AVANT l'API protégée, elles répondent sans passer par requireUser.
  app.get('/api/health', (c) => c.json({ ok: true }));

  const api = new Hono<AppEnv>();
  api.use('*', sameOrigin, requireUser);
  api.route('/', meRoutes);

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'not_found', message: 'Adresse inconnue.' }, 404));
  return app;
}
