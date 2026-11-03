import { Hono } from 'hono';
import { getAuth } from './auth';
import { onError } from './errors';
import { requireUser, sameOrigin } from './middleware';
import { adminRoutes } from './routes/admin';
import { billingRoutes } from './routes/billing';
import { clientRoutes } from './routes/clients';
import { dashboardRoutes } from './routes/dashboard';
import { invoiceRoutes } from './routes/invoices';
import { meRoutes } from './routes/me';
import { presetRoutes } from './routes/presets';
import { profileRoutes } from './routes/profile';
import { quoteRoutes } from './routes/quotes';
import { securityHeaders } from './security-headers';
import type { AppDeps, AppEnv } from './types';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.use('*', securityHeaders);
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  // Routes publiques : déclarées AVANT l'API protégée, elles répondent sans passer par requireUser.
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => getAuth(c.env).handler(c.req.raw));

  const api = new Hono<AppEnv>();
  api.use('*', sameOrigin, requireUser);
  api.route('/', meRoutes);
  api.route('/', profileRoutes);
  api.route('/clients', clientRoutes);
  api.route('/presets', presetRoutes);
  api.route('/quotes', quoteRoutes);
  api.route('/', invoiceRoutes);
  api.route('/', billingRoutes);
  api.route('/', dashboardRoutes);
  api.route('/admin', adminRoutes);

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'not_found', message: 'Adresse inconnue.' }, 404));
  return app;
}
