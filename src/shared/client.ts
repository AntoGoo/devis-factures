import { z } from 'zod';

export const ClientInput = z.object({
  type: z.enum(['individual', 'business']),
  name: z.string().trim().min(1, 'Nom obligatoire').max(200),
  street: z.string().trim().max(200),
  postalCode: z.string().trim().max(10),
  city: z.string().trim().max(100),
  country: z.string().trim().length(2),
  siren: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^(\d{9}|\d{14})?$/, 'SIREN (9 chiffres) ou SIRET (14 chiffres)')),
  email: z.union([z.literal(''), z.string().trim().pipe(z.email('Adresse e-mail invalide'))]),
  phone: z.string().trim().max(30),
});

export type ClientInput = z.infer<typeof ClientInput>;
export type ClientData = ClientInput & { id: string };

export const CLIENT_TYPE_LABEL: Record<ClientInput['type'], string> = { individual: 'particulier', business: 'professionnel' };
