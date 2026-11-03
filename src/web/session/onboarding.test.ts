import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../../shared/api-types';
import { onboardingRedirect } from './onboarding';

const me = (templateRef: string | null, profileComplete: boolean): MeResponse => ({
  user: { id: 'u', email: 'a@b.c', name: 'A' },
  isSuperadmin: false,
  onboarding: { templateRef, profileComplete },
  profileSummary: null,
});

describe('onboardingRedirect', () => {
  it('commence par le choix du modèle', () => {
    expect(onboardingRedirect(me(null, false), '/')).toBe('/bienvenue/modele');
    expect(onboardingRedirect(me(null, false), '/bienvenue/modele')).toBeNull();
  });

  it('enchaîne sur le profil une fois le modèle choisi', () => {
    expect(onboardingRedirect(me('modele-01@1', false), '/devis')).toBe('/bienvenue/entreprise');
    expect(onboardingRedirect(me('modele-01@1', false), '/bienvenue/entreprise')).toBeNull();
    expect(onboardingRedirect(me('modele-01@1', false), '/bienvenue/modele')).toBeNull();
  });

  it('laisse passer un profil complet et le sort du parcours d’accueil', () => {
    expect(onboardingRedirect(me('modele-01@1', true), '/devis')).toBeNull();
    expect(onboardingRedirect(me('modele-01@1', true), '/bienvenue/modele')).toBe('/');
  });

  it('laisse le superadmin gérer les accès avant d’avoir rempli son profil', () => {
    expect(onboardingRedirect({ ...me(null, false), isSuperadmin: true }, '/admin')).toBeNull();
  });
});
