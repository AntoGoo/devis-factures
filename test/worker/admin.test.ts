import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, createAllowedUser, createUser, json, testApp } from './helpers';

const app = testApp();

async function boss() {
  return createUser('boss@example.test', 'Anto');
}

describe('API superadmin', () => {
  it('est interdite aux utilisateurs ordinaires', async () => {
    const lea = await createAllowedUser('lea@example.test');
    expect((await call(app, lea, 'GET', '/api/admin/emails')).status).toBe(403);
    expect((await call(app, lea, 'POST', '/api/admin/emails', { email: 'x@example.test' })).status).toBe(403);
  });

  it('ajoute une adresse normalisée et refuse les doublons', async () => {
    const admin = await boss();
    const res = await call(app, admin, 'POST', '/api/admin/emails', { email: '  Karim.Elec@Example.test ' });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ email: 'karim.elec@example.test', isSuperadmin: false });
    expect((await call(app, admin, 'POST', '/api/admin/emails', { email: 'karim.elec@example.test' })).status).toBe(409);
    expect((await call(app, admin, 'POST', '/api/admin/emails', { email: 'pas-une-adresse' })).status).toBe(400);
    expect((await call(app, admin, 'POST', '/api/admin/emails', { email: 'boss@example.test' })).status).toBe(409);
  });

  it('liste le superadmin en premier, avec entreprise et dernière connexion', async () => {
    const admin = await boss();
    const lea = await createAllowedUser('lea@example.test');
    await env.DB.prepare("INSERT INTO profiles (user_id, template_ref, trade_name, created_at, updated_at) VALUES (?, 'modele-01@1', 'Léa Morel – Studio', '', '')").bind(lea.id).run();
    await env.DB.prepare("INSERT INTO login_activity (email, last_login_at) VALUES ('lea@example.test', '2026-10-28T09:00:00.000Z')").run();
    await call(app, admin, 'POST', '/api/admin/emails', { email: 'jamais@example.test' });
    const { items } = await json(await call(app, admin, 'GET', '/api/admin/emails'));
    expect(items[0]).toMatchObject({ email: 'boss@example.test', isSuperadmin: true });
    expect(items).toContainEqual(expect.objectContaining({ email: 'lea@example.test', tradeName: 'Léa Morel – Studio', lastLoginAt: '2026-10-28T09:00:00.000Z' }));
    expect(items).toContainEqual(expect.objectContaining({ email: 'jamais@example.test', tradeName: null, lastLoginAt: null }));
  });

  it('retirer une adresse coupe l’accès et supprime les sessions, sans toucher aux données', async () => {
    const admin = await boss();
    const lea = await createAllowedUser('lea@example.test');
    await env.DB.prepare("INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('s1', '2030-01-01', 'tok', '', '', ?)").bind(lea.id).run();
    await env.DB.prepare("INSERT INTO profiles (user_id, template_ref, created_at, updated_at) VALUES (?, 'modele-01@1', '', '')").bind(lea.id).run();
    expect((await call(app, admin, 'DELETE', '/api/admin/emails/LEA@example.test')).status).toBe(204);
    expect((await call(app, lea, 'GET', '/api/me')).status).toBe(403);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').bind(lea.id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM profiles WHERE user_id = ?').bind(lea.id).first()).toEqual({ n: 1 });
  });

  it('ne retire pas le superadmin et répond 404 pour une adresse absente', async () => {
    const admin = await boss();
    expect((await call(app, admin, 'DELETE', '/api/admin/emails/boss@example.test')).status).toBe(400);
    expect((await call(app, admin, 'DELETE', '/api/admin/emails/inconnu@example.test')).status).toBe(404);
  });
});
