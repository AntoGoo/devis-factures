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
});
