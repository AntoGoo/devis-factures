import { Hono } from 'hono';
import type { AppDeps, AppEnv } from './types';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.get('/api/health', (c) => c.json({ ok: true }));
  return app;
}
