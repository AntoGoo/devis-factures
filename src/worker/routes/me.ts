import { Hono } from 'hono';
import { isSuperadmin } from '../access';
import type { AppEnv } from '../types';

export const meRoutes = new Hono<AppEnv>().get('/me', (c) => {
  const user = c.var.user;
  return c.json({ user, isSuperadmin: isSuperadmin(c.env, user.email) });
});
