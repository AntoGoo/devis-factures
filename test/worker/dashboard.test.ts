import { describe, expect, it } from 'vitest';
import { seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp(); // 3 novembre 2026
const line = (cents: number) => ({ id: crypto.randomUUID(), designation: 'Travaux', quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function issuedInvoice(a: ReturnType<typeof testApp>, u: Awaited<ReturnType<typeof createAllowedUser>>, clientId: string, cents: number) {
  const created = await json(await call(a, u, 'POST', '/api/invoices/standalone', {}));
  await call(a, u, 'PUT', `/api/invoices/${created.invoice.id}`, { clientId, object: 'X', lines: [line(cents)], serviceDate: null, dueDate: null, notes: '' });
  await call(a, u, 'POST', `/api/invoices/${created.invoice.id}/issue`);
  return created.invoice.id as string;
}

describe('GET /api/dashboard', () => {
  it('calcule les trois indicateurs et la liste récente', async () => {
    const u = await createAllowedUser('karim@example.test', 'Karim Benali');
    await seedProfile(app, u);
    const client = await seedClient(app, u);

    await seedQuote(app, u, { clientId: client.id });                                  // brouillon : ignoré des indicateurs
    await seedQuote(app, u, { clientId: client.id, status: 'sent' });                  // 2 920,00 €
    await seedQuote(app, u, { clientId: client.id, lines: [line(453000)], status: 'sent' }); // 4 530,00 €

    const september = testApp(new Date('2026-09-01T10:00:00Z'));
    await issuedInvoice(september, u, client.id, 120000);                             // échéance 1er octobre : en retard
    await issuedInvoice(app, u, client.id, 366000);                                   // à payer
    const paidNow = await issuedInvoice(app, u, client.id, 72000);
    await call(app, u, 'PUT', `/api/invoices/${paidNow}/payment`, { paidAt: '2026-11-03' });
    const paidBefore = await issuedInvoice(september, u, client.id, 50000);
    await call(app, u, 'PUT', `/api/invoices/${paidBefore}/payment`, { paidAt: '2026-10-15' });
    const cancelled = await issuedInvoice(app, u, client.id, 99900);
    await call(app, u, 'POST', `/api/invoices/${cancelled}/credit-note`);

    const d = await json(await call(app, u, 'GET', '/api/dashboard'));
    expect(d).toMatchObject({
      today: '2026-11-03',
      greetingName: 'Karim',
      outstanding: { totalCents: 486000, lateCents: 120000 },
      pendingQuotes: { count: 2, totalCents: 745000 },
      collectedThisMonth: { totalCents: 72000, count: 1, monthLabel: 'novembre' },
    });
    expect(d.recent).toHaveLength(9); // 3 devis + 5 factures + 1 avoir
    expect(d.recent).toContainEqual(expect.objectContaining({ type: 'invoice', kindLabel: 'Avoir', status: { label: 'Avoir émis', tone: 'neutral' } }));
    expect(d.recent).toContainEqual(expect.objectContaining({ kindLabel: 'Facture', status: { label: 'En retard', tone: 'late' } }));

    const quotesOnly = await json(await call(app, u, 'GET', '/api/dashboard?filter=quotes'));
    expect(quotesOnly.recent.every((r: { type: string }) => r.type === 'quote')).toBe(true);
    expect(quotesOnly.recent.find((r: { number: string | null }) => r.number === null)).toMatchObject({ kindLabel: 'Devis (brouillon)', status: { label: 'Brouillon' } });
  });
});
