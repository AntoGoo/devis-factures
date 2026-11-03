import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, CLIENT_INDIVIDUAL, seedClient } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

describe('clients', () => {
  it('crée, liste par nom, lit, modifie et supprime', async () => {
    const u = await createAllowedUser('karim@example.test');
    const tilleuls = await seedClient(app, u);
    expect(tilleuls).toMatchObject({ name: 'SCI Les Tilleuls', siren: '801222333', type: 'business' });
    await seedClient(app, u, { ...CLIENT_INDIVIDUAL });
    expect((await json(await call(app, u, 'GET', '/api/clients'))).items.map((c: { name: string }) => c.name)).toEqual(['M. et Mme Lefèvre', 'SCI Les Tilleuls']);
    const updated = await json(await call(app, u, 'PUT', `/api/clients/${tilleuls.id}`, { ...CLIENT_BUSINESS, city: 'Rezé' }));
    expect(updated.city).toBe('Rezé');
    expect((await call(app, u, 'DELETE', `/api/clients/${tilleuls.id}`)).status).toBe(204);
    expect((await call(app, u, 'GET', `/api/clients/${tilleuls.id}`)).status).toBe(404);
  });

  it('valide le nom et le SIREN', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect((await call(app, u, 'POST', '/api/clients', { ...CLIENT_BUSINESS, name: ' ' })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/clients', { ...CLIENT_BUSINESS, siren: '1234' })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/clients', { ...CLIENT_BUSINESS, siren: '801 222 333 00015' })).status).toBe(201);
  });

  it('refuse de supprimer un client utilisé par un document', async () => {
    const u = await createAllowedUser('karim@example.test');
    const c = await seedClient(app, u);
    await env.DB.prepare("INSERT INTO quotes (id, user_id, client_id, validity_days, created_at, updated_at) VALUES ('q1', ?, ?, 30, '', '')").bind(u.id, c.id).run();
    const res = await call(app, u, 'DELETE', `/api/clients/${c.id}`);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'client_in_use' });
  });
});
