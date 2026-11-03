import { z } from 'zod';

export const DEFAULT_UNITS = ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'];
const text = (max: number) => z.string().trim().max(max);
const prefix = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, '1 à 6 lettres ou chiffres');

export const ProfileInput = z
  .object({
    tradeName: text(120),
    ownerName: text(120).min(1, 'Prénom et nom obligatoires'),
    activityLine: text(200),
    street: text(200).min(1, 'Adresse obligatoire'),
    postalCode: text(10).min(1, 'Code postal obligatoire'),
    city: text(100).min(1, 'Ville obligatoire'),
    siret: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^\d{14}$/, 'Le SIRET compte 14 chiffres')),
    phone: text(30),
    email: z.union([z.literal(''), z.string().trim().pipe(z.email('Adresse e-mail invalide'))]),
    logoDataUrl: z.string().max(280_000, 'Logo trop lourd (200 Ko maximum)').regex(/^data:image\/(png|jpeg);base64,/, 'Logo PNG ou JPEG attendu').nullable(),
    insurer: text(120),
    insurancePolicy: text(120),
    insuranceArea: text(120),
    defaultQuoteValidityDays: z.number().int().min(1).max(365),
    defaultPaymentDelayDays: z.number().int().min(0).max(60, '60 jours au maximum (article L441-10 du Code de commerce)'),
    latePenaltyText: text(500).min(1),
    paymentDetails: text(300),
    prefixQuote: prefix,
    prefixInvoice: prefix,
    prefixCredit: prefix,
    units: z.array(text(20).min(1)).min(1).max(30),
  })
  .refine((p) => new Set([p.prefixQuote, p.prefixInvoice, p.prefixCredit]).size === 3, {
    message: 'Les trois préfixes doivent être différents',
    path: ['prefixCredit'],
  });

export type ProfileInput = z.infer<typeof ProfileInput>;
export type ProfileData = ProfileInput & { templateRef: string; vatRegime: 'franchise' };

export function isProfileComplete(p: ProfileData): boolean {
  return p.ownerName !== '' && p.street !== '' && p.postalCode !== '' && p.city !== '' && /^\d{14}$/.test(p.siret);
}
