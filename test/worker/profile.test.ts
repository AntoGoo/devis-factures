import { describe, expect, it } from 'vitest';
import { PROFILE, seedProfile } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

describe('profil', () => {
  it('n’existe pas au premier démarrage', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect(await json(await call(app, u, 'GET', '/api/profile'))).toEqual({ profile: null });
    expect(await json(await call(app, u, 'GET', '/api/me'))).toMatchObject({ onboarding: { templateRef: null, profileComplete: false }, profileSummary: null });
  });

  it('enregistre le modèle choisi, refuse un modèle inconnu', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect((await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-99@1' })).status).toBe(400);
    expect((await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-03@1' })).status).toBe(200);
    expect(await json(await call(app, u, 'GET', '/api/me'))).toMatchObject({ onboarding: { templateRef: 'modele-03@1', profileComplete: false } });
  });

  it('marque le profil complet après enregistrement et garde le modèle', async () => {
    const u = await createAllowedUser('karim@example.test');
    await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-02@1' });
    const res = await call(app, u, 'PUT', '/api/profile', PROFILE);
    expect(res.status).toBe(200);
    expect((await json(res)).profile).toMatchObject({ siret: '91234567800019', templateRef: 'modele-02@1', vatRegime: 'franchise' });
    expect(await json(await call(app, u, 'GET', '/api/me'))).toMatchObject({ onboarding: { profileComplete: true }, profileSummary: { ownerName: 'Karim Benali', tradeName: 'Benali Électricité' } });
  });

  it('répond 400 avec les champs fautifs', async () => {
    const u = await createAllowedUser('karim@example.test');
    const res = await call(app, u, 'PUT', '/api/profile', { ...PROFILE, siret: '12', prefixCredit: 'F' });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.issues.map((i: { path: string[] }) => i.path[0])).toEqual(expect.arrayContaining(['siret', 'prefixCredit']));
  });

  it('ne montre à chacun que son propre profil', async () => {
    const a = await createAllowedUser('karim@example.test');
    const b = await createAllowedUser('lea@example.test');
    await seedProfile(app, a);
    expect(await json(await call(app, b, 'GET', '/api/profile'))).toEqual({ profile: null });
  });
});

describe('numérotation (réglages)', () => {
  it('annonce les prochains numéros de l’année en cours', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const info = await json(await call(app, u, 'GET', '/api/numbering'));
    expect(info).toEqual({
      year: 2026,
      series: [
        { series: 'D', prefix: 'D', next: 'D-2026-001', startEditable: true },
        { series: 'F', prefix: 'F', next: 'F-2026-001', startEditable: true },
        { series: 'A', prefix: 'A', next: 'A-2026-001', startEditable: true },
      ],
    });
  });

  it('accepte un numéro de départ une seule fois par série', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const res = await call(app, u, 'PUT', '/api/numbering/start', { series: 'F', startNumber: 42 });
    expect(res.status).toBe(200);
    expect((await json(res)).series[1]).toEqual({ series: 'F', prefix: 'F', next: 'F-2026-042', startEditable: false });
    expect((await call(app, u, 'PUT', '/api/numbering/start', { series: 'F', startNumber: 50 })).status).toBe(409);
    expect((await call(app, u, 'PUT', '/api/numbering/start', { series: 'F', startNumber: 0 })).status).toBe(400);
  });

  it('suit les préfixes du profil', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u, { prefixInvoice: 'FA' });
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('FA-2026-001');
  });
});
