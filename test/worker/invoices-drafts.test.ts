import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, createDeposit, seedAcceptedQuote, seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const line = (cents: number) => ({ id: crypto.randomUUID(), designation: 'Travaux', quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function ready() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  return { u, client };
}

describe('factures d’acompte', () => {
  it('crée un acompte de 30 % sur un devis accepté de 2 920,00 €', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const r = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect(r.invoice).toMatchObject({ kind: 'deposit', status: 'draft', number: null, depositBp: 3000, totalHtCents: 87600, amountDueCents: 87600, clientId: client.id, quoteId: q.quote.id });
    expect(r.invoice.lines).toHaveLength(1);
    expect(r.invoice.lines[0].designation.replace(/\s/g, ' ')).toContain('Acompte de 30 % sur le devis D-2026-001');
    expect(r.view).toMatchObject({ title: 'Facture d’acompte', references: { quote: { number: 'D-2026-001', date: '2026-11-03' } } });
    expect(r.links.quote).toEqual({ id: q.quote.id, number: 'D-2026-001' });
  });

  it('arrondit au centime inférieur et accepte un montant fixe', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id, [line(100001)]); // 1 000,01 €
    expect((await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3300 })).invoice.amountDueCents).toBe(33000);
    expect((await createDeposit(app, u, q.quote.id, { mode: 'amount', cents: 50000 })).invoice.amountDueCents).toBe(50000);
  });

  it('refuse un acompte qui ferait dépasser le total ; un acompte annulé ne compte plus', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const first = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 7000 });
    const res = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 4000 });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'deposit_exceeds_total' });
    await env.DB.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").bind(first.invoice.id).run();
    expect((await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 4000 })).status).toBe(201);
  });

  it('refuse un acompte sur un devis non accepté', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 3000 }))).toMatchObject({ error: 'quote_not_accepted' });
  });

  it('libère le plafond quand on supprime un brouillon d’acompte', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 10000 });
    expect((await call(app, u, 'DELETE', `/api/invoices/${d.invoice.id}`)).status).toBe(204);
    expect((await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 10000 })).status).toBe(201);
  });
});

describe('facture de solde et facture sans devis', () => {
  it('prépare le solde avec les lignes de l’instantané du devis', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const res = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`);
    expect(res.status).toBe(201);
    const r = await json(res);
    expect(r.invoice).toMatchObject({ kind: 'final', status: 'draft', totalHtCents: 292000, amountDueCents: 292000, object: 'Rénovation électrique du rez-de-chaussée' });
    expect(r.invoice.lines).toHaveLength(5);
    expect(r.view.title).toBe('Facture');
  });

  it('n’autorise qu’un solde actif, et plus d’acompte ensuite', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`);
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`))).toMatchObject({ error: 'final_exists' });
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 1000 }))).toMatchObject({ error: 'final_exists' });
  });

  it('refuse de préparer le solde tant qu’un acompte est en brouillon', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`))).toMatchObject({ error: 'pending_deposit_draft' });
  });

  it('crée une facture sans devis avec 5 lignes vides, modifiable', async () => {
    const { u, client } = await ready();
    const created = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
    expect(created.invoice).toMatchObject({ kind: 'standalone', clientId: null });
    expect(created.invoice.lines).toHaveLength(5);
    const saved = await json(await call(app, u, 'PUT', `/api/invoices/${created.invoice.id}`, {
      clientId: client.id, object: 'Dépannage', lines: [line(12000)], serviceDate: '2026-11-02', dueDate: null, notes: '',
    }));
    expect(saved.invoice).toMatchObject({ totalHtCents: 12000, amountDueCents: 12000, serviceDate: '2026-11-02' });
    expect(saved.view).toMatchObject({ title: 'Facture', client: { name: 'SCI Les Tilleuls' } });
  });

  it('limite les champs modifiables selon le type de facture', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect(await json(await call(app, u, 'PUT', `/api/invoices/${d.invoice.id}`, { lines: [line(1)], serviceDate: null, dueDate: null, notes: '' }))).toMatchObject({ error: 'field_not_editable' });
    expect((await call(app, u, 'PUT', `/api/invoices/${d.invoice.id}`, { serviceDate: '2026-11-04', dueDate: '2026-11-20', notes: 'Merci' })).status).toBe(200);
    await call(app, u, 'DELETE', `/api/invoices/${d.invoice.id}`);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const other = await seedClient(app, u, { ...CLIENT_BUSINESS, name: 'Autre' });
    expect((await call(app, u, 'PUT', `/api/invoices/${f.invoice.id}`, { clientId: other.id, serviceDate: null, dueDate: null, notes: '' })).status).toBe(400);
  });

  it('liste les factures d’un devis', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    await call(app, u, 'POST', '/api/invoices/standalone', {});
    expect((await json(await call(app, u, 'GET', `/api/invoices?quoteId=${q.quote.id}`))).items).toHaveLength(1);
    expect((await json(await call(app, u, 'GET', '/api/invoices'))).items).toHaveLength(2);
  });
});
