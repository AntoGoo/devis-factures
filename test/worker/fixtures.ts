import { call, createAllowedUser, testApp } from './helpers';
import type { SessionUser } from '../../src/worker/types';

type App = ReturnType<typeof testApp>;

export const PROFILE = {
  tradeName: 'Benali Électricité',
  ownerName: 'Karim Benali',
  activityLine: 'Électricité générale • Installation • Rénovation',
  street: '8 rue de la Fosse',
  postalCode: '44000',
  city: 'Nantes',
  siret: '912 345 678 00019',
  phone: '06 12 34 56 78',
  email: 'contact@benali-elec.fr',
  logoDataUrl: null,
  insurer: 'MAAF Pro',
  insurancePolicy: 'DEC-4471209',
  insuranceArea: 'France métropolitaine',
  defaultQuoteValidityDays: 30,
  defaultPaymentDelayDays: 30,
  latePenaltyText: 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.',
  paymentDetails: 'FR76 3000 6000 0112 3456 7890 189',
  prefixQuote: 'D',
  prefixInvoice: 'F',
  prefixCredit: 'A',
  units: ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'],
};

export async function seedProfile(app: App, user: SessionUser, overrides: Partial<typeof PROFILE> = {}): Promise<void> {
  const t = await call(app, user, 'PUT', '/api/profile/template', { templateRef: 'modele-01@1' });
  if (t.status !== 200) throw new Error(`template: ${t.status} ${await t.text()}`);
  const p = await call(app, user, 'PUT', '/api/profile', { ...PROFILE, ...overrides });
  if (p.status !== 200) throw new Error(`profile: ${p.status} ${await p.text()}`);
}

export async function twoUsers(app: App): Promise<{ a: SessionUser; b: SessionUser }> {
  const a = await createAllowedUser('karim@example.test', 'Karim Benali');
  const b = await createAllowedUser('lea@example.test', 'Léa Morel');
  await seedProfile(app, a);
  await seedProfile(app, b, { tradeName: 'Léa Morel – Studio', ownerName: 'Léa Morel', siret: '80122233300015' });
  return { a, b };
}
