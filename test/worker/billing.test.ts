import { describe, expect, it } from 'vitest';
import { createDeposit, seedAcceptedQuote, seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

describe('GET /api/quotes/:id/billing', () => {
  it('résume la facturation d’un devis accepté', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedAcceptedQuote(app, u, client.id);
    const d1 = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    await call(app, u, 'POST', `/api/invoices/${d1.invoice.id}/issue`);
    await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 2000 });
    const b = await json(await call(app, u, 'GET', `/api/quotes/${q.quote.id}/billing`));
    expect(b).toMatchObject({
      quote: { number: 'D-2026-001', clientName: 'SCI Les Tilleuls', totalCents: 292000, plannedDepositBp: 3000, lineCount: 5 },
      invoicedDepositsCents: 146000, issuedDepositsCents: 87600, remainingToInvoiceCents: 146000,
      activeFinal: null, draftDepositCount: 1, canCreateDeposit: true, canPrepareFinal: false,
    });
    expect(b.invoices).toHaveLength(2);
  });

  it('ferme les acomptes une fois le solde préparé', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedAcceptedQuote(app, u, client.id);
    await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`);
    expect(await json(await call(app, u, 'GET', `/api/quotes/${q.quote.id}/billing`))).toMatchObject({ canCreateDeposit: false, canPrepareFinal: false, activeFinal: { status: 'draft' } });
  });

  it('répond 409 pour un devis non accepté', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect((await call(app, u, 'GET', `/api/quotes/${q.quote.id}/billing`)).status).toBe(409);
  });
});
