import { describe, expect, it } from 'vitest';
import { ProfileInput, isProfileComplete } from './profile';
import { formatDocumentNumber } from './numbering';

const base = {
  tradeName: 'Benali Électricité', ownerName: 'Karim Benali', activityLine: '', street: '8 rue de la Fosse', postalCode: '44000', city: 'Nantes',
  siret: '912 345 678 00019', phone: '', email: '', logoDataUrl: null, insurer: '', insurancePolicy: '', insuranceArea: '',
  defaultQuoteValidityDays: 30, defaultPaymentDelayDays: 30, latePenaltyText: 'Pénalités…', paymentDetails: '',
  prefixQuote: 'd', prefixInvoice: 'F', prefixCredit: 'A', units: ['u', 'h'],
};

describe('ProfileInput', () => {
  it('nettoie le SIRET et met les préfixes en majuscules', () => {
    const p = ProfileInput.parse(base);
    expect(p.siret).toBe('91234567800019');
    expect(p.prefixQuote).toBe('D');
  });

  it('refuse un SIRET incomplet, des préfixes identiques, un délai de paiement > 60 jours', () => {
    expect(ProfileInput.safeParse({ ...base, siret: '123' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, prefixCredit: 'F' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, defaultPaymentDelayDays: 61 }).success).toBe(false);
  });

  it('refuse un logo qui n’est pas une image PNG/JPEG en data URL ou trop lourd', () => {
    expect(ProfileInput.safeParse({ ...base, logoDataUrl: 'https://exemple.fr/logo.png' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, logoDataUrl: 'data:image/png;base64,' + 'A'.repeat(280_001) }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }).success).toBe(true);
  });
});

describe('isProfileComplete', () => {
  it('exige nom, adresse et SIRET', () => {
    const full = { ...ProfileInput.parse(base), templateRef: 'modele-01@1', vatRegime: 'franchise' as const };
    expect(isProfileComplete(full)).toBe(true);
    expect(isProfileComplete({ ...full, siret: '' })).toBe(false);
    expect(isProfileComplete({ ...full, city: '' })).toBe(false);
  });
});

describe('formatDocumentNumber', () => {
  it('complète sur 3 chiffres au minimum', () => {
    expect(formatDocumentNumber('F', 2026, 1)).toBe('F-2026-001');
    expect(formatDocumentNumber('FA', 2027, 1234)).toBe('FA-2027-1234');
  });
});
