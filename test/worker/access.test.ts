import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isEmailAllowed, normalizeEmail, recordLogin } from '../../src/worker/access';
import { allow, call, createAllowedUser, createUser, json, testApp } from './helpers';

describe('liste d’accès', () => {
  it('normalise les adresses', () => {
    expect(normalizeEmail('  Karim.Elec@Gmail.com ')).toBe('karim.elec@gmail.com');
  });

  it('autorise toujours le superadmin, quelle que soit la casse', async () => {
    expect(await isEmailAllowed(env.DB, 'boss@example.test', 'BOSS@example.test')).toBe(true);
  });

  it('autorise une adresse de la liste, refuse les autres', async () => {
    await allow('lea@example.test');
    expect(await isEmailAllowed(env.DB, 'boss@example.test', 'Lea@Example.test')).toBe(true);
    expect(await isEmailAllowed(env.DB, 'boss@example.test', 'intrus@example.test')).toBe(false);
  });

  it('enregistre la dernière connexion', async () => {
    await recordLogin(env.DB, 'lea@example.test', new Date('2026-11-02T17:42:00Z'));
    await recordLogin(env.DB, 'lea@example.test', new Date('2026-11-03T08:00:00Z'));
    const row = await env.DB.prepare("SELECT last_login_at FROM login_activity WHERE email = 'lea@example.test'").first<{ last_login_at: string }>();
    expect(row?.last_login_at).toBe('2026-11-03T08:00:00.000Z');
  });
});

describe('GET /api/me', () => {
  const app = testApp();

  it('répond 401 sans session', async () => {
    const res = await call(app, null, 'GET', '/api/me');
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: 'unauthenticated' });
  });

  it('répond 403 not_invited si l’adresse a été retirée de la liste', async () => {
    const user = await createUser('ancien@example.test');
    const res = await call(app, user, 'GET', '/api/me');
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: 'not_invited' });
  });

  it('renvoie l’utilisateur et son rôle', async () => {
    const user = await createAllowedUser('lea@example.test', 'Léa Morel');
    const boss = await createUser('boss@example.test', 'Anto');
    expect(await json(await call(app, user, 'GET', '/api/me'))).toMatchObject({ user: { email: 'lea@example.test' }, isSuperadmin: false });
    expect(await json(await call(app, boss, 'GET', '/api/me'))).toMatchObject({ isSuperadmin: true });
  });

  it('laisse /api/health public', async () => {
    expect((await call(app, null, 'GET', '/api/health')).status).toBe(200);
  });

  it('refuse une écriture venant d’une autre origine', async () => {
    const user = await createAllowedUser('lea@example.test');
    const res = await call(app, user, 'POST', '/api/me', {}, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});
