import type { ClientData } from './client';
import type { Line } from './lines';
import type { ProfileData } from './profile';

export const PROFILE_DATA: ProfileData = {
  templateRef: 'modele-01@1', vatRegime: 'franchise',
  tradeName: 'Benali Électricité', ownerName: 'Karim Benali', activityLine: 'Électricité générale • Installation • Rénovation',
  street: '8 rue de la Fosse', postalCode: '44000', city: 'Nantes', siret: '91234567800019',
  phone: '06 12 34 56 78', email: 'contact@benali-elec.fr', logoDataUrl: null,
  insurer: 'MAAF Pro', insurancePolicy: 'DEC-4471209', insuranceArea: 'France métropolitaine',
  defaultQuoteValidityDays: 30, defaultPaymentDelayDays: 30,
  latePenaltyText: 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.',
  paymentDetails: 'FR76 3000 6000 0112 3456 7890 189',
  prefixQuote: 'D', prefixInvoice: 'F', prefixCredit: 'A', units: ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'],
};

export const CLIENT_BUSINESS_DATA: ClientData = {
  id: 'c-pro', type: 'business', name: 'SCI Les Tilleuls', street: '3 place Royale', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '801222333', email: '', phone: '',
};

export const CLIENT_INDIVIDUAL_DATA: ClientData = {
  id: 'c-part', type: 'individual', name: 'M. et Mme Lefèvre', street: '5 rue Kervégan', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '', email: '', phone: '',
};

const l = (id: string, designation: string, q: number, unit: string, p: number): Line => ({ id, designation, quantityMilli: q, unit, unitPriceCents: p, vatRate: null });

export const MOCKUP_LINES: Line[] = [
  l('l1', 'Mise en sécurité et dépose de l’ancien tableau', 1000, 'forfait', 38000),
  l('l2', 'Fourniture et pose d’un tableau électrique 3 rangées', 1000, 'u', 115000),
  l('l3', 'Création de prises de courant 16 A', 8000, 'u', 6500),
  l('l4', 'Points lumineux avec interrupteur', 6000, 'u', 9500),
  l('l5', 'Raccordement, essais et vérifications', 1000, 'forfait', 30000),
];
