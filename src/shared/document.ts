import { computeBalance, type DeductedDeposit } from './balance';
import type { ClientData } from './client';
import { EI_SUFFIX, NO_DISCOUNT_MENTION, RECOVERY_INDEMNITY_MENTION, VAT_FRANCHISE_MENTION } from './legal';
import { computeTotals, filledLines, type Line, type Totals } from './lines';
import type { ProfileData } from './profile';

export type DocumentKind = 'quote' | 'deposit' | 'final' | 'standalone' | 'credit';
export type DocRef = { number: string; date: string };

export type CompanyBlock = {
  tradeName: string;
  legalName: string; // « Prénom Nom EI »
  activityLine: string;
  street: string;
  postalCode: string;
  city: string;
  siret: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  insurance: { insurer: string; policy: string; area: string } | null;
};

export type ClientBlock = { type: 'individual' | 'business'; name: string; street: string; postalCode: string; city: string; siren: string };

export type QuoteTerms = { validityDays: number; plannedStart: string; estimatedDuration: string; paymentTerms: string; plannedDepositBp: number | null };

export type InvoiceTerms = {
  serviceDate: string | null; // null tant que la facture est en brouillon sans date choisie
  dueDate: string | null;
  latePenaltyText: string;
  recoveryIndemnity: string | null;
  discount: string;
  paymentDetails: string;
  notes: string;
};

export type DocumentView = {
  schemaVersion: 1;
  kind: DocumentKind;
  title: string;
  number: string | null;
  date: string | null;
  templateRef: string;
  vatMention: string;
  company: CompanyBlock;
  client: ClientBlock | null;
  object: string;
  interventionAddress: string | null;
  lines: Line[];
  totals: Totals;
  dueLabel: string;
  deductions: { deposits: DeductedDeposit[]; remainingCents: number } | null;
  quoteTerms: QuoteTerms | null;
  invoiceTerms: InvoiceTerms | null;
  references: { quote: DocRef | null; creditedInvoice: DocRef | null };
};

export type BuildViewInput = {
  kind: Exclude<DocumentKind, 'credit'>;
  number: string | null;
  date: string | null;
  templateRef: string;
  profile: ProfileData;
  client: ClientData | null;
  object: string;
  interventionAddress: string | null;
  lines: Line[];
  quoteTerms?: QuoteTerms;
  invoiceDates?: { serviceDate: string | null; dueDate: string | null; notes: string };
  deductedDeposits?: DeductedDeposit[];
  quoteRef?: DocRef | null;
};

export type CreditContext = { date: string; templateRef: string; profile: ProfileData; client: ClientData | null; creditedRef: DocRef };

export const KIND_TITLE: Record<DocumentKind, string> = {
  quote: 'Devis',
  deposit: 'Facture d’acompte',
  final: 'Facture de solde',
  standalone: 'Facture',
  credit: 'Avoir',
};

function companyBlock(p: ProfileData): CompanyBlock {
  return {
    tradeName: p.tradeName,
    legalName: `${p.ownerName} ${EI_SUFFIX}`,
    activityLine: p.activityLine,
    street: p.street,
    postalCode: p.postalCode,
    city: p.city,
    siret: p.siret,
    phone: p.phone,
    email: p.email,
    logoDataUrl: p.logoDataUrl,
    insurance: p.insurer ? { insurer: p.insurer, policy: p.insurancePolicy, area: p.insuranceArea } : null,
  };
}

function clientBlock(c: ClientData | null): ClientBlock | null {
  return c ? { type: c.type, name: c.name, street: c.street, postalCode: c.postalCode, city: c.city, siren: c.siren } : null;
}

/** Mentions de paiement d'une facture ou d'un avoir (spec § 8) ; l'indemnité de 40 € ne vise que les clients professionnels. */
function paymentTerms(
  profile: ProfileData,
  client: ClientData | null,
  dates: Pick<InvoiceTerms, 'serviceDate' | 'dueDate' | 'notes'>,
): InvoiceTerms {
  return {
    serviceDate: dates.serviceDate,
    dueDate: dates.dueDate,
    latePenaltyText: profile.latePenaltyText,
    recoveryIndemnity: client?.type === 'business' ? RECOVERY_INDEMNITY_MENTION : null,
    discount: NO_DISCOUNT_MENTION,
    paymentDetails: profile.paymentDetails,
    notes: dates.notes,
  };
}

export function buildDocumentView(input: BuildViewInput): DocumentView {
  const lines = filledLines(input.lines);
  const totals = computeTotals(lines);
  const isInvoice = input.kind !== 'quote';
  const deposits = input.kind === 'final' ? input.deductedDeposits ?? [] : [];
  const hasDeductions = deposits.length > 0;
  const balance = computeBalance(totals.totalHtCents, deposits);

  return {
    schemaVersion: 1,
    kind: input.kind,
    title: input.kind === 'final' && !hasDeductions ? 'Facture' : KIND_TITLE[input.kind],
    number: input.number,
    date: input.date,
    templateRef: input.templateRef,
    vatMention: VAT_FRANCHISE_MENTION,
    company: companyBlock(input.profile),
    client: clientBlock(input.client),
    object: input.object,
    interventionAddress: input.interventionAddress,
    lines,
    totals: hasDeductions ? { ...totals, totalDueCents: balance.remainingCents } : totals,
    dueLabel: hasDeductions ? 'Reste à payer' : 'Total à payer',
    deductions: hasDeductions ? { deposits, remainingCents: balance.remainingCents } : null,
    quoteTerms: input.kind === 'quote' ? input.quoteTerms ?? null : null,
    invoiceTerms: isInvoice
      ? paymentTerms(input.profile, input.client, {
          serviceDate: input.invoiceDates?.serviceDate ?? null,
          dueDate: input.invoiceDates?.dueDate ?? null,
          notes: input.invoiceDates?.notes ?? '',
        })
      : null,
    references: { quote: input.quoteRef ?? null, creditedInvoice: null },
  };
}

/**
 * Avoir total : reprend les lignes et déductions de la facture annulée, en négatif.
 * Il porte les mentions de paiement (profil et client actuels) et la date de prestation de la facture annulée, sans échéance.
 */
export function buildCreditView(original: DocumentView, ctx: CreditContext): DocumentView {
  const lines = original.lines.map((l) => ({ ...l, unitPriceCents: -l.unitPriceCents }));
  const totals = computeTotals(lines);
  const deductions = original.deductions
    ? { deposits: original.deductions.deposits, remainingCents: -original.deductions.remainingCents }
    : null;
  return {
    ...original,
    kind: 'credit',
    title: KIND_TITLE.credit,
    number: null,
    date: ctx.date,
    templateRef: ctx.templateRef,
    company: companyBlock(ctx.profile),
    client: clientBlock(ctx.client),
    lines,
    totals: deductions ? { ...totals, totalDueCents: deductions.remainingCents } : totals,
    dueLabel: 'Montant de l’avoir',
    deductions,
    quoteTerms: null,
    invoiceTerms: paymentTerms(ctx.profile, ctx.client, { serviceDate: original.invoiceTerms?.serviceDate ?? null, dueDate: null, notes: '' }),
    references: { quote: original.references.quote, creditedInvoice: ctx.creditedRef },
  };
}

export function parseSnapshot(json: string): DocumentView {
  const view = JSON.parse(json) as DocumentView;
  if (view.schemaVersion !== 1) throw new Error(`Version d’instantané inconnue : ${String(view.schemaVersion)}`);
  return view;
}
