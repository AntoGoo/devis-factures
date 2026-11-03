import type { MeResponse } from '../../shared/api-types';

export function onboardingRedirect(me: MeResponse, pathname: string): string | null {
  if (pathname.startsWith('/admin')) return null;
  const { templateRef, profileComplete } = me.onboarding;
  if (!templateRef) return pathname === '/bienvenue/modele' ? null : '/bienvenue/modele';
  if (!profileComplete) return pathname.startsWith('/bienvenue/') ? null : '/bienvenue/entreprise';
  return pathname.startsWith('/bienvenue/') ? '/' : null;
}
