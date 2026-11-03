import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { D1Dialect } from 'kysely-d1';
import { NotInvitedError, accessHooks } from './access';
import type { SessionUser } from './types';

function asForbidden(err: unknown): never {
  if (err instanceof NotInvitedError) throw new APIError('FORBIDDEN', { code: 'not_invited', message: 'not_invited' });
  throw err;
}

export function createAuth(env: Env) {
  const hooks = accessHooks(env, () => new Date());
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: { dialect: new D1Dialect({ database: env.DB }), type: 'sqlite' },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            await hooks.beforeUserCreate(user.email).catch(asForbidden);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            await hooks.beforeSessionCreate(session.userId).catch(asForbidden);
          },
          after: async (session) => {
            await hooks.afterSessionCreate(session.userId);
          },
        },
      },
    },
  });
}

// Une instance par isolat : `env` est le même objet d'une requête à l'autre, inutile de tout reconstruire.
const instances = new WeakMap<Env, ReturnType<typeof createAuth>>();

export function getAuth(env: Env): ReturnType<typeof createAuth> {
  let auth = instances.get(env);
  if (!auth) {
    auth = createAuth(env);
    instances.set(env, auth);
  }
  return auth;
}

export async function betterAuthSessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const result = await getAuth(env).api.getSession({ headers: req.headers });
  if (!result) return null;
  return { id: result.user.id, email: result.user.email, name: result.user.name };
}
