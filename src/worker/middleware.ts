import type { MiddlewareHandler } from 'hono';
import { isEmailAllowed, isSuperadmin } from './access';
import { HttpError } from './errors';
import type { AppEnv } from './types';

/** Refuse toute écriture dont l'en-tête Origin n'est pas celle de l'application. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('origin');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && origin !== new URL(c.env.BETTER_AUTH_URL).origin) {
    throw new HttpError(403, 'forbidden', 'Origine refusée.');
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await c.var.deps.getSessionUser(c.req.raw, c.env);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Connexion requise.');
  if (!(await isEmailAllowed(c.env.DB, c.env.SUPERADMIN_EMAIL, user.email))) {
    throw new HttpError(403, 'not_invited', 'Accès sur invitation. Votre adresse n’est pas autorisée.');
  }
  c.set('user', user);
  await next();
};

export const requireSuperadmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isSuperadmin(c.env, c.var.user.email)) throw new HttpError(403, 'forbidden', 'Réservé au superadmin.');
  await next();
};
