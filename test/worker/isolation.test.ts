import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, quoteBody, seedClient, seedQuote, twoUsers } from './fixtures';
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

  it('rend les devis d’un autre utilisateur invisibles et intouchables', async () => {
    const { a, b } = await twoUsers(app);
    const client = await seedClient(app, a);
    const q = await seedQuote(app, a, { clientId: client.id, status: 'sent' });
    for (const [method, path] of [
      ['GET', `/api/quotes/${q.quote.id}`], ['DELETE', `/api/quotes/${q.quote.id}`], ['POST', `/api/quotes/${q.quote.id}/send`],
      ['POST', `/api/quotes/${q.quote.id}/accept`], ['POST', `/api/quotes/${q.quote.id}/refuse`], ['POST', `/api/quotes/${q.quote.id}/duplicate`],
    ] as const) {
      expect((await call(app, b, method, path)).status).toBe(404);
    }
    expect((await call(app, b, 'PUT', `/api/quotes/${q.quote.id}`, quoteBody(null))).status).toBe(404);
    expect((await json(await call(app, b, 'GET', '/api/quotes'))).items).toEqual([]);
  });

  it('refuse le client d’un autre utilisateur sur un devis (vigilance n° 5)', async () => {
    const { a, b } = await twoUsers(app);
    const clientOfA = await seedClient(app, a);
    const { quote } = await json(await call(app, b, 'POST', '/api/quotes', {}));
    const res = await call(app, b, 'PUT', `/api/quotes/${quote.id}`, quoteBody(clientOfA.id));
    expect(res.status).toBe(404);
    const after = await json(await call(app, b, 'GET', `/api/quotes/${quote.id}`));
    expect(after.quote.clientId).toBeNull();
    expect(after.view.client).toBeNull();
    expect((await call(app, b, 'POST', '/api/quotes', { clientId: clientOfA.id })).status).toBe(404);
  });
});
