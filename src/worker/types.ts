import type { Context } from 'hono';

export type SessionUser = { id: string; email: string; name: string };

export type AppDeps = {
  getSessionUser: (req: Request, env: Env) => Promise<SessionUser | null>;
  now: () => Date;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: AppDeps; user: SessionUser };
};

export type AppContext = Context<AppEnv>;
