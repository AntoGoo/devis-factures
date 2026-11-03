import { Hono } from 'hono';
import { createAuth } from './auth';
import { onError } from './errors';
import { requireUser, sameOrigin } from './middleware';
import { adminRoutes } from './routes/admin';
import { clientRoutes } from './routes/clients';
import { meRoutes } from './routes/me';
import { presetRoutes } from './routes/presets';
import { profileRoutes } from './routes/profile';
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
  app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

  const api = new Hono<AppEnv>();
  api.use('*', sameOrigin, requireUser);
  api.route('/', meRoutes);
  api.route('/', profileRoutes);
  api.route('/clients', clientRoutes);
  api.route('/presets', presetRoutes);
  api.route('/admin', adminRoutes);

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'not_found', message: 'Adresse inconnue.' }, 404));
  return app;
}
