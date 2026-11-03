import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, seedClient, twoUsers } from './fixtures';
import { call, json, testApp } from './helpers';

const app = testApp();

describe('cloisonnement par utilisateur', () => {
  it('rend les clients d’un autre utilisateur invisibles et intouchables', async () => {
    const { a, b } = await twoUsers(app);
    const c = await seedClient(app, a);
    expect((await call(app, b, 'GET', `/api/clients/${c.id}`)).status).toBe(404);
    expect((await call(app, b, 'PUT', `/api/clients/${c.id}`, CLIENT_BUSINESS)).status).toBe(404);
    expect((await call(app, b, 'DELETE', `/api/clients/${c.id}`)).status).toBe(404);
    expect((await json(await call(app, b, 'GET', '/api/clients'))).items).toEqual([]);
    expect((await call(app, a, 'GET', `/api/clients/${c.id}`)).status).toBe(200);
  });

  it('rend les lignes types d’un autre utilisateur invisibles et intouchables', async () => {
    const { a, b } = await twoUsers(app);
    const p = await json(await call(app, a, 'POST', '/api/presets', { designation: 'Forfait', unit: 'forfait', unitPriceCents: 100, vatRate: null }));
    expect((await call(app, b, 'PUT', `/api/presets/${p.id}`, { designation: 'X', unit: 'u', unitPriceCents: 1, vatRate: null })).status).toBe(404);
    expect((await call(app, b, 'DELETE', `/api/presets/${p.id}`)).status).toBe(404);
    expect((await json(await call(app, b, 'GET', '/api/presets'))).items).toEqual([]);
  });
});
