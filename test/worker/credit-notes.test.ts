import { describe, expect, it } from 'vitest';
import { PROFILE, createDeposit, seedAcceptedQuote, seedClient, seedProfile } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const line = (cents: number) => ({ id: crypto.randomUUID(), designation: 'Travaux', quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function issuedStandalone() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  const created = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
  await call(app, u, 'PUT', `/api/invoices/${created.invoice.id}`, { clientId: client.id, object: 'Dépannage', lines: [line(72000)], serviceDate: null, dueDate: null, notes: '' });
  await call(app, u, 'POST', `/api/invoices/${created.invoice.id}/issue`);
  return { u, client, id: created.invoice.id as string };
}

describe('paiement', () => {
  it('marque une facture émise payée, puis annule le paiement', async () => {
    const { u, id } = await issuedStandalone();
    const paid = await json(await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-11-03' }));
    expect(paid.invoice).toMatchObject({ paidAt: '2026-11-03', display: 'paid' });
    expect((await json(await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: null }))).invoice.display).toBe('to_pay');
  });

  it('refuse une date de paiement dans le futur (heure de Paris)', async () => {
    const { u, id } = await issuedStandalone();
    const res = await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-11-04' });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'paid_in_future', message: 'La date de paiement ne peut pas être dans le futur.' });
    expect((await json(await call(app, u, 'GET', `/api/invoices/${id}`))).invoice.paidAt).toBeNull();
    // 3 novembre 23 h 30 UTC = 4 novembre à Paris : le 4 est aujourd'hui.
    const lateEvening = testApp(new Date('2026-11-03T23:30:00Z'));
    expect((await call(lateEvening, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-11-04' })).status).toBe(200);
  });

  it('refuse un paiement sur un brouillon ou antérieur à l’émission', async () => {
    const { u, id } = await issuedStandalone();
    expect(await json(await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-10-01' }))).toMatchObject({ error: 'paid_before_issue' });
    const draft = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
    expect(await json(await call(app, u, 'PUT', `/api/invoices/${draft.invoice.id}/payment`, { paidAt: '2026-11-03' }))).toMatchObject({ error: 'not_payable' });
  });
});

describe('avoirs', () => {
  it('annule entièrement une facture : numéro A, montant négatif, référence à la facture', async () => {
    const { u, id } = await issuedStandalone();
    const res = await call(app, u, 'POST', `/api/invoices/${id}/credit-note`);
    expect(res.status).toBe(201);
    const credit = await json(res);
    expect(credit.invoice).toMatchObject({ kind: 'credit', status: 'issued', number: 'A-2026-001', totalHtCents: -72000, amountDueCents: -72000, display: 'credit' });
    expect(credit.view).toMatchObject({ title: 'Avoir', number: 'A-2026-001', references: { creditedInvoice: { number: 'F-2026-001', date: '2026-11-03' } } });
    expect(credit.links.creditedInvoice).toEqual({ id, number: 'F-2026-001' });
    const original = await json(await call(app, u, 'GET', `/api/invoices/${id}`));
    expect(original.invoice).toMatchObject({ status: 'cancelled', display: 'cancelled' });
    expect(original.links.creditNote).toEqual({ id: credit.invoice.id, number: 'A-2026-001' });
  });

  it('répond 409 number_conflict quand le préfixe d’avoir reprend un ancien préfixe de facture déjà utilisé', async () => {
    const { u, id } = await issuedStandalone(); // F-2026-001
    expect((await call(app, u, 'PUT', '/api/profile', { ...PROFILE, prefixInvoice: 'FA', prefixCredit: 'F' })).status).toBe(200);
    const res = await call(app, u, 'POST', `/api/invoices/${id}/credit-note`);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'number_conflict', message: 'Ce numéro existe déjà : vérifiez les préfixes de numérotation dans votre profil.' });
    // Rien n'a changé : la facture reste émise, aucun avoir, aucun numéro consommé.
    expect((await json(await call(app, u, 'GET', `/api/invoices/${id}`))).invoice.status).toBe('issued');
    expect((await json(await call(app, u, 'GET', '/api/invoices?kind=credit'))).items).toEqual([]);
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[2].next).toBe('F-2026-001');
  });

  it('ne crée qu’un avoir par facture, même en cas de double clic (vigilance n° 3)', async () => {
    const { u, id } = await issuedStandalone();
    const [a, b] = await Promise.all([call(app, u, 'POST', `/api/invoices/${id}/credit-note`), call(app, u, 'POST', `/api/invoices/${id}/credit-note`)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[2].next).toBe('A-2026-002');
  });

  it('refuse un avoir sur un brouillon ou sur un avoir, et un avoir ne se supprime pas', async () => {
    const { u, id } = await issuedStandalone();
    const draft = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
    expect(await json(await call(app, u, 'POST', `/api/invoices/${draft.invoice.id}/credit-note`))).toMatchObject({ error: 'not_creditable' });
    const credit = await json(await call(app, u, 'POST', `/api/invoices/${id}/credit-note`));
    expect((await call(app, u, 'POST', `/api/invoices/${credit.invoice.id}/credit-note`)).status).toBe(409);
    expect((await call(app, u, 'DELETE', `/api/invoices/${credit.invoice.id}`)).status).toBe(409);
  });

  it('annule une facture payée en gardant la date de paiement', async () => {
    const { u, id } = await issuedStandalone();
    await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-11-03' });
    await call(app, u, 'POST', `/api/invoices/${id}/credit-note`);
    expect((await json(await call(app, u, 'GET', `/api/invoices/${id}`))).invoice).toMatchObject({ status: 'cancelled', paidAt: '2026-11-03' });
  });

  it('protège un acompte déduit par un solde émis, puis permet un nouveau solde après annulation', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    await call(app, u, 'POST', `/api/invoices/${d.invoice.id}/issue`);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    await call(app, u, 'POST', `/api/invoices/${f.invoice.id}/issue`);

    expect(await json(await call(app, u, 'POST', `/api/invoices/${d.invoice.id}/credit-note`))).toMatchObject({ error: 'deposit_deducted' });

    const creditFinal = await json(await call(app, u, 'POST', `/api/invoices/${f.invoice.id}/credit-note`));
    expect(creditFinal.view.totals).toEqual({ totalHtCents: -292000, vatCents: 0, totalDueCents: -204400 });
    expect((await call(app, u, 'POST', `/api/invoices/${d.invoice.id}/credit-note`)).status).toBe(201);
    expect((await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`)).status).toBe(201);
  });
});
