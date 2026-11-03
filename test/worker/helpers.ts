import { env } from 'cloudflare:test';
import { createApp } from '../../src/worker/app';
import type { AppDeps, SessionUser } from '../../src/worker/types';

export const TODAY = new Date('2026-11-03T10:00:00Z');
type App = ReturnType<typeof createApp>;

export async function createUser(email: string, name = 'Karim Benali'): Promise<SessionUser> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  ).bind(id, name, email, now, now).run();
  return { id, email, name };
}

export async function allow(email: string): Promise<void> {
  await env.DB.prepare('INSERT INTO allowed_emails (email, added_at, added_by) VALUES (?, ?, ?)')
    .bind(email.trim().toLowerCase(), new Date().toISOString(), 'boss@example.test')
    .run();
}

export async function createAllowedUser(email: string, name?: string): Promise<SessionUser> {
  await allow(email);
  return createUser(email, name);
}

/**
 * Application de test : l'utilisateur connecté est lu dans l'en-tête x-test-user.
 * L'horloge avance d'une milliseconde à chaque lecture, pour que les tris par date de mise à jour soient stables.
 */
export function testApp(now: Date = TODAY): App {
  let tick = 0;
  const deps: AppDeps = {
    now: () => new Date(now.getTime() + tick++),
    getSessionUser: async (req) => {
      const id = req.headers.get('x-test-user');
      if (!id) return null;
      return env.DB.prepare('SELECT id, email, name FROM "user" WHERE id = ?').bind(id).first<SessionUser>();
    },
  };
  return createApp(deps);
}

export function call(
  app: App,
  user: SessionUser | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (user) headers['x-test-user'] = user.id;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env),
  );
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
