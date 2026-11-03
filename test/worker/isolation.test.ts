import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, createDeposit, quoteBody, seedAcceptedQuote, seedClient, seedQuote, twoUsers } from './fixtures';
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

  it('protège les devis et factures d’un autre utilisateur côté facturation (vigilance n° 5)', async () => {
    const { a, b } = await twoUsers(app);
    const clientOfA = await seedClient(app, a);
    const q = await seedAcceptedQuote(app, a, clientOfA.id);
    expect((await call(app, b, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 3000 })).status).toBe(404);
    expect((await call(app, b, 'POST', `/api/quotes/${q.quote.id}/final`)).status).toBe(404);
    const d = await createDeposit(app, a, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect((await call(app, b, 'GET', `/api/invoices/${d.invoice.id}`)).status).toBe(404);
    expect((await call(app, b, 'PUT', `/api/invoices/${d.invoice.id}`, { serviceDate: null, dueDate: null, notes: '' })).status).toBe(404);
    expect((await call(app, b, 'DELETE', `/api/invoices/${d.invoice.id}`)).status).toBe(404);
    expect((await json(await call(app, b, 'GET', '/api/invoices'))).items).toEqual([]);
    expect((await call(app, b, 'POST', '/api/invoices/standalone', { clientId: clientOfA.id })).status).toBe(404);
    const own = await json(await call(app, b, 'POST', '/api/invoices/standalone', {}));
    expect((await call(app, b, 'PUT', `/api/invoices/${own.invoice.id}`, { clientId: clientOfA.id, serviceDate: null, dueDate: null, notes: '' })).status).toBe(404);
    expect((await json(await call(app, b, 'GET', `/api/invoices/${own.invoice.id}`))).view.client).toBeNull();
  });

  it('interdit de payer ou d’annuler la facture d’un autre utilisateur', async () => {
    const { a, b } = await twoUsers(app);
    const client = await seedClient(app, a);
    const created = await json(await call(app, a, 'POST', '/api/invoices/standalone', { clientId: client.id }));
    await call(app, a, 'PUT', `/api/invoices/${created.invoice.id}`, { lines: [{ id: 'l', designation: 'X', quantityMilli: 1000, unit: 'u', unitPriceCents: 100, vatRate: null }], serviceDate: null, dueDate: null, notes: '' });
    expect((await call(app, b, 'POST', `/api/invoices/${created.invoice.id}/issue`)).status).toBe(404);
    await call(app, a, 'POST', `/api/invoices/${created.invoice.id}/issue`);
    expect((await call(app, b, 'PUT', `/api/invoices/${created.invoice.id}/payment`, { paidAt: '2026-11-03' })).status).toBe(404);
    expect((await call(app, b, 'POST', `/api/invoices/${created.invoice.id}/credit-note`)).status).toBe(404);
    expect((await json(await call(app, b, 'GET', '/api/numbering'))).series[2].next).toBe('A-2026-001');
  });
});
