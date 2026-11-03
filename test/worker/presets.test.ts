import { describe, expect, it } from 'vitest';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const PRESET = { designation: 'Création de prise de courant 16 A', unit: 'u', unitPriceCents: 6500, vatRate: null };

describe('lignes types', () => {
  it('crée, liste, modifie et supprime', async () => {
    const u = await createAllowedUser('karim@example.test');
    const p = await json(await call(app, u, 'POST', '/api/presets', PRESET));
    expect(p).toMatchObject(PRESET);
    expect((await json(await call(app, u, 'GET', '/api/presets'))).items).toHaveLength(1);
    expect(await json(await call(app, u, 'PUT', `/api/presets/${p.id}`, { ...PRESET, unitPriceCents: 7000 }))).toMatchObject({ unitPriceCents: 7000 });
    expect((await call(app, u, 'DELETE', `/api/presets/${p.id}`)).status).toBe(204);
  });

  it('refuse une désignation vide, un prix décimal et un taux de TVA en V1', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect((await call(app, u, 'POST', '/api/presets', { ...PRESET, designation: '' })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/presets', { ...PRESET, unitPriceCents: 65.5 })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/presets', { ...PRESET, vatRate: 20 })).status).toBe(400);
  });
});
