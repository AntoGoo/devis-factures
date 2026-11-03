import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, PROFILE, createDeposit, seedAcceptedQuote, seedClient, seedProfile } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const line = (cents: number, designation = 'Travaux') => ({ id: crypto.randomUUID(), designation, quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function ready() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  return { u, client };
}

async function standalone(a: typeof app, u: Awaited<ReturnType<typeof ready>>['u'], clientId: string | null, lines = [line(12000)], extra = {}) {
  const created = await json(await call(a, u, 'POST', '/api/invoices/standalone', {}));
  await call(a, u, 'PUT', `/api/invoices/${created.invoice.id}`, { clientId, object: 'Dépannage', lines, serviceDate: null, dueDate: null, notes: '', ...extra });
  return created.invoice.id as string;
}

const issue = (a: typeof app, u: Awaited<ReturnType<typeof ready>>['u'], id: string) => call(a, u, 'POST', `/api/invoices/${id}/issue`);

describe('émission', () => {
  it('numérote, date, fixe l’échéance et fige l’instantané', async () => {
    const { u, client } = await ready();
    const id = await standalone(app, u, client.id);
    const res = await issue(app, u, id);
    expect(res.status).toBe(200);
    const r = await json(res);
    expect(r.invoice).toMatchObject({ status: 'issued', number: 'F-2026-001', issueDate: '2026-11-03', dueDate: '2026-12-03', serviceDate: '2026-11-03', display: 'to_pay' });
    expect(r.view).toMatchObject({ number: 'F-2026-001', date: '2026-11-03', invoiceTerms: { dueDate: '2026-12-03' } });
  });

  it('rend la facture émise inaltérable, insupprimable et indépendante du profil', async () => {
    const { u, client } = await ready();
    const id = await standalone(app, u, client.id);
    await issue(app, u, id);
    expect((await call(app, u, 'PUT', `/api/invoices/${id}`, { serviceDate: null, dueDate: null, notes: 'x' })).status).toBe(409);
    expect((await call(app, u, 'DELETE', `/api/invoices/${id}`)).status).toBe(409);
    await call(app, u, 'PUT', '/api/profile', { ...PROFILE, street: '1 rue Neuve' });
    await call(app, u, 'PUT', `/api/clients/${client.id}`, { ...CLIENT_BUSINESS, name: 'Nouveau nom' });
    const { view } = await json(await call(app, u, 'GET', `/api/invoices/${id}`));
    expect(view.company.street).toBe('8 rue de la Fosse');
    expect(view.client.name).toBe('SCI Les Tilleuls');
  });

  it('ne consomme qu’un numéro en cas de double clic (vigilance n° 3)', async () => {
    const { u, client } = await ready();
    const id = await standalone(app, u, client.id);
    const [a, b] = await Promise.all([issue(app, u, id), issue(app, u, id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const next = await json(await issue(app, u, await standalone(app, u, client.id)));
    expect(next.invoice.number).toBe('F-2026-002');
  });

  it('change de suite au 1er janvier à minuit, heure de Paris (vigilance n° 4)', async () => {
    const { u, client } = await ready();
    await issue(app, u, await standalone(app, u, client.id));
    const newYear = testApp(new Date('2026-12-31T23:30:00Z'));
    const r = await json(await issue(newYear, u, await standalone(newYear, u, client.id)));
    expect(r.invoice).toMatchObject({ number: 'F-2027-001', issueDate: '2027-01-01' });
  });

  it('refuse l’émission sans client, sans SIREN pour un professionnel, sans ligne, ou avec une échéance passée', async () => {
    const { u, client } = await ready();
    expect(await json(await issue(app, u, await standalone(app, u, null)))).toMatchObject({ error: 'client_missing' });
    const noSiren = await seedClient(app, u, { ...CLIENT_BUSINESS, siren: '' });
    expect(await json(await issue(app, u, await standalone(app, u, noSiren.id)))).toMatchObject({ error: 'client_siren_required' });
    expect(await json(await issue(app, u, await standalone(app, u, client.id, [])))).toMatchObject({ error: 'no_lines' });
    expect(await json(await issue(app, u, await standalone(app, u, client.id, [line(500, '')])))).toMatchObject({ error: 'missing_designation' });
    expect(await json(await issue(app, u, await standalone(app, u, client.id, [line(12000)], { dueDate: '2026-11-01' })))).toMatchObject({ error: 'due_before_issue' });
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('F-2026-001');
  });

  it('refuse l’émission tant que l’adresse de facturation du client est incomplète (spec § 8)', async () => {
    const { u } = await ready();
    for (const missing of ['street', 'postalCode', 'city'] as const) {
      const partial = await seedClient(app, u, { ...CLIENT_BUSINESS, [missing]: '' });
      const res = await issue(app, u, await standalone(app, u, partial.id));
      expect(res.status).toBe(409);
      expect(await json(res)).toEqual({
        error: 'client_address_required',
        message: 'Complétez l’adresse de facturation du client (rue, code postal, ville) avant d’émettre la facture.',
      });
    }
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('F-2026-001');
  });
});

describe('acomptes et solde', () => {
  it('déduit les acomptes émis du solde et les fige dans l’instantané', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d1 = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect((await json(await issue(app, u, d1.invoice.id))).invoice.number).toBe('F-2026-001');
    const d2 = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 2000 });
    expect((await json(await issue(app, u, d2.invoice.id))).invoice.number).toBe('F-2026-002');
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const r = await json(await issue(app, u, f.invoice.id));
    expect(r.invoice).toMatchObject({ number: 'F-2026-003', totalHtCents: 292000, amountDueCents: 146000 });
    expect(r.view.title).toBe('Facture de solde');
    expect(r.view.deductions.deposits.map((x: { number: string }) => x.number)).toEqual(['F-2026-001', 'F-2026-002']);
    expect(r.view.deductions.remainingCents).toBe(146000);
  });

  it('émet une facture directe (solde sans acompte) titrée « Facture »', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const r = await json(await issue(app, u, f.invoice.id));
    expect(r.view).toMatchObject({ title: 'Facture', deductions: null, totals: { totalDueCents: 292000 } });
  });

  it('bloque un solde inférieur aux acomptes, sans consommer de numéro', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 10000 });
    await issue(app, u, d.invoice.id);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    await call(app, u, 'PUT', `/api/invoices/${f.invoice.id}`, { lines: [line(100000)], serviceDate: null, dueDate: null, notes: '' });
    expect(await json(await issue(app, u, f.invoice.id))).toMatchObject({ error: 'negative_remaining' });
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('F-2026-002');
  });

  it('prend l’entreprise et le client au moment de l’émission, les lignes dans l’instantané du devis', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await call(app, u, 'PUT', `/api/clients/${client.id}`, { ...CLIENT_BUSINESS, city: 'Rezé' });
    await call(app, u, 'PUT', '/api/profile', { ...PROFILE, phone: '07 00 00 00 00' });
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const r = await json(await issue(app, u, f.invoice.id));
    expect(r.view.client.city).toBe('Rezé');
    expect(r.view.company.phone).toBe('07 00 00 00 00');
    expect(r.view.lines.map((l: { designation: string }) => l.designation)).toEqual(q.view.lines.map((l: { designation: string }) => l.designation));
    expect(r.view.references.quote).toEqual({ number: 'D-2026-001', date: '2026-11-03' });
  });
});
