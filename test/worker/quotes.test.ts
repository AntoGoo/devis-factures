import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, PROFILE, quoteBody, seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

async function ready() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  return { u, client };
}

describe('création et modification', () => {
  it('crée un brouillon avec 5 lignes vides et les réglages du profil', async () => {
    const { u } = await ready();
    const res = await call(app, u, 'POST', '/api/quotes', {});
    expect(res.status).toBe(201);
    const { quote, view } = await json(res);
    expect(quote).toMatchObject({ status: 'draft', number: null, validityDays: 30, totalHtCents: 0 });
    expect(quote.lines).toHaveLength(5);
    expect(quote.lines.every((l: { designation: string }) => l.designation === '')).toBe(true);
    expect(view).toMatchObject({ title: 'Devis', number: null, lines: [] });
  });

  it('exige un profil complet', async () => {
    const u = await createAllowedUser('karim@example.test');
    const res = await call(app, u, 'POST', '/api/quotes', {});
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'profile_incomplete' });
  });

  it('enregistre et recalcule le total côté serveur, lignes vides comprises en brouillon', async () => {
    const { u, client } = await ready();
    const { quote } = await json(await call(app, u, 'POST', '/api/quotes', {}));
    const body = quoteBody(client.id, [...quoteBody(client.id).lines, { id: 'vide', designation: '', quantityMilli: 1000, unit: 'u', unitPriceCents: 0, vatRate: null }]);
    const saved = await json(await call(app, u, 'PUT', `/api/quotes/${quote.id}`, body));
    expect(saved.quote.totalHtCents).toBe(292000);
    expect(saved.quote.lines).toHaveLength(6);
    expect(saved.view.lines).toHaveLength(5);
    expect(saved.view.client).toMatchObject({ name: 'SCI Les Tilleuls' });
  });
});

describe('envoi et numérotation', () => {
  it('refuse l’envoi sans client, sans ligne remplie, ou avec une ligne chiffrée sans désignation', async () => {
    const { u, client } = await ready();
    const { quote } = await json(await call(app, u, 'POST', '/api/quotes', {}));
    expect(await json(await call(app, u, 'POST', `/api/quotes/${quote.id}/send`))).toMatchObject({ error: 'client_missing' });
    await call(app, u, 'PUT', `/api/quotes/${quote.id}`, quoteBody(client.id, []));
    expect(await json(await call(app, u, 'POST', `/api/quotes/${quote.id}/send`))).toMatchObject({ error: 'no_lines' });
    await call(app, u, 'PUT', `/api/quotes/${quote.id}`, quoteBody(client.id, [{ id: 'x', designation: '', quantityMilli: 1000, unit: 'u', unitPriceCents: 500, vatRate: null }]));
    expect(await json(await call(app, u, 'POST', `/api/quotes/${quote.id}/send`))).toMatchObject({ error: 'missing_designation' });
  });

  it('attribue D-2026-001 à l’envoi, puis des numéros continus ; un brouillon supprimé ne consomme rien', async () => {
    const { u, client } = await ready();
    const first = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(first.quote).toMatchObject({ number: 'D-2026-001', status: 'sent', quoteDate: '2026-11-03' });
    expect(first.view).toMatchObject({ number: 'D-2026-001', date: '2026-11-03' });
    const throwaway = await json(await call(app, u, 'POST', '/api/quotes', {}));
    expect((await call(app, u, 'DELETE', `/api/quotes/${throwaway.quote.id}`)).status).toBe(204);
    const second = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(second.quote.number).toBe('D-2026-002');
  });

  it('répond 409 à un second envoi (double clic, vigilance n° 3)', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    const again = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/send`);
    expect(again.status).toBe(409);
    const next = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(next.quote.number).toBe('D-2026-002');
  });

  it('laisse un devis envoyé modifiable', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    const res = await call(app, u, 'PUT', `/api/quotes/${q.quote.id}`, { ...quoteBody(client.id), object: 'Objet corrigé' });
    expect(res.status).toBe(200);
    expect((await json(res)).quote).toMatchObject({ object: 'Objet corrigé', number: 'D-2026-001', status: 'sent' });
  });
});

describe('acceptation, refus, duplication', () => {
  it('fige le devis accepté : instantané, plus de modification ni de suppression', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'accepted' });
    expect(q.quote).toMatchObject({ status: 'accepted', acceptedAt: expect.any(String) });
    expect((await call(app, u, 'PUT', `/api/quotes/${q.quote.id}`, quoteBody(client.id))).status).toBe(409);
    expect((await call(app, u, 'DELETE', `/api/quotes/${q.quote.id}`)).status).toBe(409);
  });

  it('affiche le devis accepté depuis son instantané, même après changement du profil et du client', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'accepted' });
    await call(app, u, 'PUT', '/api/profile', { ...PROFILE, tradeName: 'Nouveau nom', street: '1 rue Neuve' });
    await call(app, u, 'PUT', `/api/clients/${client.id}`, { ...CLIENT_BUSINESS, name: 'Autre raison sociale' });
    await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-03@1' });
    const { view } = await json(await call(app, u, 'GET', `/api/quotes/${q.quote.id}`));
    expect(view.company).toMatchObject({ tradeName: 'Benali Électricité', street: '8 rue de la Fosse' });
    expect(view.client).toMatchObject({ name: 'SCI Les Tilleuls' });
    expect(view.templateRef).toBe('modele-01@1');
  });

  it('n’accepte ou ne refuse qu’un devis envoyé', async () => {
    const { u, client } = await ready();
    const draft = await seedQuote(app, u, { clientId: client.id });
    expect((await call(app, u, 'POST', `/api/quotes/${draft.quote.id}/accept`)).status).toBe(409);
    const sent = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    const refused = await json(await call(app, u, 'POST', `/api/quotes/${sent.quote.id}/refuse`));
    expect(refused.quote.status).toBe('refused');
    expect((await call(app, u, 'POST', `/api/quotes/${sent.quote.id}/accept`)).status).toBe(409);
    expect((await call(app, u, 'PUT', `/api/quotes/${sent.quote.id}`, quoteBody(client.id))).status).toBe(409);
  });

  it('duplique en un nouveau brouillon sans numéro', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'accepted' });
    const res = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/duplicate`);
    expect(res.status).toBe(201);
    const copy = (await json(res)).quote;
    expect(copy).toMatchObject({ status: 'draft', number: null, clientId: client.id, object: q.quote.object, totalHtCents: 292000 });
    expect(copy.id).not.toBe(q.quote.id);
    expect(copy.lines[0].id).not.toBe(q.quote.lines[0].id);
  });

  it('liste les devis, filtrables par statut', async () => {
    const { u, client } = await ready();
    await seedQuote(app, u, { clientId: client.id });
    await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect((await json(await call(app, u, 'GET', '/api/quotes'))).items).toHaveLength(2);
    const sent = (await json(await call(app, u, 'GET', '/api/quotes?status=sent'))).items;
    expect(sent).toEqual([expect.objectContaining({ number: 'D-2026-001', clientName: 'SCI Les Tilleuls', totalHtCents: 292000 })]);
  });
});
