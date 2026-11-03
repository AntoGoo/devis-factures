import type { QuoteResponse } from '../../src/shared/api-types';
import type { ClientData, ClientInput } from '../../src/shared/client';
import type { Line } from '../../src/shared/lines';
import { MOCKUP_LINES } from '../../src/shared/test-fixtures';
import type { SessionUser } from '../../src/worker/types';
import { call, createAllowedUser, json, testApp } from './helpers';

export { MOCKUP_LINES };

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

export const CLIENT_BUSINESS = {
  type: 'business' as const, name: 'SCI Les Tilleuls', street: '3 place Royale', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '801 222 333', email: 'gestion@tilleuls.example', phone: '',
};
export const CLIENT_INDIVIDUAL = {
  type: 'individual' as const, name: 'M. et Mme Lefèvre', street: '5 rue Kervégan', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '', email: '', phone: '06 00 00 00 00',
};

export async function seedClient(app: App, user: SessionUser, overrides: Partial<ClientInput> = {}): Promise<ClientData> {
  const res = await call(app, user, 'POST', '/api/clients', { ...CLIENT_BUSINESS, ...overrides });
  if (res.status !== 201) throw new Error(`client: ${res.status} ${await res.text()}`);
  return json<ClientData>(res);
}

export function quoteBody(clientId: string | null, lines: Line[] = MOCKUP_LINES) {
  return {
    clientId,
    object: 'Rénovation électrique du rez-de-chaussée',
    interventionAddress: '12 rue des Tilleuls, 44000 Nantes',
    lines,
    validityDays: 30,
    plannedStart: 'Semaine du 23 novembre',
    estimatedDuration: '4 jours',
    paymentTerms: 'Acompte de 30 % à la signature, solde à réception de facture.',
    plannedDepositBp: 3000,
  };
}

export async function seedQuote(
  app: App,
  user: SessionUser,
  opts: { clientId: string; lines?: Line[]; status?: 'draft' | 'sent' | 'accepted' },
): Promise<QuoteResponse> {
  const created = await json<QuoteResponse>(await call(app, user, 'POST', '/api/quotes', {}));
  const id = created.quote.id;
  let res = await call(app, user, 'PUT', `/api/quotes/${id}`, quoteBody(opts.clientId, opts.lines));
  if (opts.status === 'sent' || opts.status === 'accepted') res = await call(app, user, 'POST', `/api/quotes/${id}/send`);
  if (opts.status === 'accepted') res = await call(app, user, 'POST', `/api/quotes/${id}/accept`);
  if (res.status !== 200) throw new Error(`quote: ${res.status} ${await res.text()}`);
  return json<QuoteResponse>(res);
}

export async function twoUsers(app: App): Promise<{ a: SessionUser; b: SessionUser }> {
  const a = await createAllowedUser('karim@example.test', 'Karim Benali');
  const b = await createAllowedUser('lea@example.test', 'Léa Morel');
  await seedProfile(app, a);
  await seedProfile(app, b, { tradeName: 'Léa Morel – Studio', ownerName: 'Léa Morel', siret: '80122233300015' });
  return { a, b };
}
