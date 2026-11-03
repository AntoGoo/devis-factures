import { DEFAULT_TEMPLATE_REF } from '../../templates/catalog';
import { isProfileComplete, type ProfileCompletenessFields, type ProfileData, type ProfileInput } from '../../shared/profile';
import { HttpError } from '../errors';

const FIELDS = [
  ['tradeName', 'trade_name'], ['ownerName', 'owner_name'], ['activityLine', 'activity_line'],
  ['street', 'street'], ['postalCode', 'postal_code'], ['city', 'city'], ['siret', 'siret'],
  ['phone', 'phone'], ['email', 'email'], ['logoDataUrl', 'logo_data_url'],
  ['insurer', 'insurer'], ['insurancePolicy', 'insurance_policy'], ['insuranceArea', 'insurance_area'],
  ['defaultQuoteValidityDays', 'default_quote_validity_days'], ['defaultPaymentDelayDays', 'default_payment_delay_days'],
  ['latePenaltyText', 'late_penalty_text'], ['paymentDetails', 'payment_details'],
  ['prefixQuote', 'prefix_quote'], ['prefixInvoice', 'prefix_invoice'], ['prefixCredit', 'prefix_credit'],
] as const;

type Row = Record<string, unknown> & { template_ref: string; vat_regime: string; units_json: string };

function rowToProfile(r: Row): ProfileData {
  const p = Object.fromEntries(FIELDS.map(([k, col]) => [k, r[col]])) as Omit<ProfileInput, 'units'>;
  return { ...p, units: JSON.parse(r.units_json), templateRef: r.template_ref, vatRegime: 'franchise' };
}

export async function getProfile(db: D1Database, userId: string): Promise<ProfileData | null> {
  const row = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first<Row>();
  return row ? rowToProfile(row) : null;
}

export type ProfileSummary = ProfileCompletenessFields & Pick<ProfileData, 'templateRef' | 'tradeName'>;

/** Lecture légère pour /api/me et le tableau de bord : jamais le logo (jusqu'à plusieurs centaines de Ko). */
export async function getProfileSummary(db: D1Database, userId: string): Promise<ProfileSummary | null> {
  return db
    .prepare(
      `SELECT template_ref AS templateRef, owner_name AS ownerName, trade_name AS tradeName,
         street, postal_code AS postalCode, city, siret
       FROM profiles WHERE user_id = ?`,
    )
    .bind(userId)
    .first<ProfileSummary>();
}

export async function requireCompleteProfile(db: D1Database, userId: string): Promise<ProfileData> {
  const p = await getProfile(db, userId);
  if (!p || !isProfileComplete(p)) {
    throw new HttpError(409, 'profile_incomplete', 'Complétez votre profil entreprise (nom, adresse, SIRET) avant de continuer.');
  }
  return p;
}

export async function setTemplate(db: D1Database, userId: string, ref: string, nowIso: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profiles (user_id, template_ref, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET template_ref = excluded.template_ref, updated_at = excluded.updated_at`,
    )
    .bind(userId, ref, nowIso, nowIso)
    .run();
}

export async function saveProfile(db: D1Database, userId: string, input: ProfileInput, nowIso: string): Promise<void> {
  const cols = FIELDS.map(([, col]) => col);
  const values = FIELDS.map(([k]) => input[k]);
  await db
    .prepare(
      `INSERT INTO profiles (user_id, template_ref, ${cols.join(', ')}, units_json, created_at, updated_at)
       VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
         units_json = excluded.units_json, updated_at = excluded.updated_at`,
    )
    .bind(userId, DEFAULT_TEMPLATE_REF, ...values, JSON.stringify(input.units), nowIso, nowIso)
    .run();
}
