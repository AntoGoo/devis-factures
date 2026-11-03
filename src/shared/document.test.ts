import { describe, expect, it } from 'vitest';
import { blankLines } from './lines';
import { buildCreditView, buildDocumentView, parseSnapshot, type BuildViewInput } from './document';
import { NO_DISCOUNT_MENTION, RECOVERY_INDEMNITY_MENTION, VAT_FRANCHISE_MENTION } from './legal';
import { CLIENT_BUSINESS_DATA, CLIENT_INDIVIDUAL_DATA, MOCKUP_LINES, PROFILE_DATA } from './test-fixtures';

const quoteInput: BuildViewInput = {
  kind: 'quote', number: 'D-2026-016', date: '2026-10-31', templateRef: 'modele-02@1',
  profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, object: 'Rénovation électrique du rez-de-chaussée',
  interventionAddress: '12 rue des Tilleuls, 44000 Nantes', lines: [...MOCKUP_LINES, ...blankLines(2)],
  quoteTerms: { validityDays: 30, plannedStart: 'Semaine du 23 novembre', estimatedDuration: '4 jours', paymentTerms: 'Acompte de 30 % à la signature', plannedDepositBp: 3000 },
};

const invoiceInput = (overrides: Partial<BuildViewInput> = {}): BuildViewInput => ({
  kind: 'standalone', number: null, date: '2026-11-03', templateRef: 'modele-01@1', profile: PROFILE_DATA,
  client: CLIENT_BUSINESS_DATA, object: 'Dépannage', interventionAddress: null, lines: MOCKUP_LINES,
  invoiceDates: { serviceDate: '2026-11-02', dueDate: '2026-12-03', notes: '' }, ...overrides,
});

describe('buildDocumentView : devis', () => {
  const view = buildDocumentView(quoteInput);

  it('reprend l’entreprise avec la mention EI et le modèle demandé', () => {
    expect(view.title).toBe('Devis');
    expect(view.templateRef).toBe('modele-02@1');
    expect(view.company).toMatchObject({ tradeName: 'Benali Électricité', legalName: 'Karim Benali EI', siret: '91234567800019' });
    expect(view.company.insurance).toEqual({ insurer: 'MAAF Pro', policy: 'DEC-4471209', area: 'France métropolitaine' });
  });

  it('retire les lignes vides et calcule les totaux (vigilance n° 2)', () => {
    expect(view.lines).toHaveLength(5);
    expect(view.totals).toEqual({ totalHtCents: 292000, vatCents: 0, totalDueCents: 292000 });
    expect(view.vatMention).toBe(VAT_FRANCHISE_MENTION);
    expect(view.dueLabel).toBe('Total à payer');
  });

  it('porte les modalités du devis et pas celles d’une facture', () => {
    expect(view.quoteTerms?.validityDays).toBe(30);
    expect(view.invoiceTerms).toBeNull();
    expect(view.deductions).toBeNull();
  });

  it('omet l’assurance quand aucun assureur n’est renseigné', () => {
    expect(buildDocumentView({ ...quoteInput, profile: { ...PROFILE_DATA, insurer: '' } }).company.insurance).toBeNull();
  });
});

describe('buildDocumentView : factures', () => {
  it('ajoute l’indemnité de 40 € pour un client professionnel seulement', () => {
    expect(buildDocumentView(invoiceInput()).invoiceTerms?.recoveryIndemnity).toBe(RECOVERY_INDEMNITY_MENTION);
    expect(buildDocumentView(invoiceInput({ client: CLIENT_INDIVIDUAL_DATA })).invoiceTerms?.recoveryIndemnity).toBeNull();
  });

  it('porte échéance, pénalités, escompte et coordonnées de paiement', () => {
    expect(buildDocumentView(invoiceInput()).invoiceTerms).toMatchObject({
      serviceDate: '2026-11-02', dueDate: '2026-12-03', latePenaltyText: PROFILE_DATA.latePenaltyText,
      discount: NO_DISCOUNT_MENTION, paymentDetails: PROFILE_DATA.paymentDetails,
    });
  });

  it('titre selon la nature de la facture', () => {
    expect(buildDocumentView(invoiceInput()).title).toBe('Facture');
    expect(buildDocumentView(invoiceInput({ kind: 'deposit', quoteRef: { number: 'D-2026-015', date: '2026-10-20' } })).title).toBe('Facture d’acompte');
    expect(buildDocumentView(invoiceInput({ kind: 'final', deductedDeposits: [] })).title).toBe('Facture');
  });

  it('déduit les acomptes sur une facture de solde', () => {
    const view = buildDocumentView(invoiceInput({
      kind: 'final', quoteRef: { number: 'D-2026-015', date: '2026-10-20' },
      deductedDeposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }],
    }));
    expect(view.title).toBe('Facture de solde');
    expect(view.totals).toEqual({ totalHtCents: 292000, vatCents: 0, totalDueCents: 204400 });
    expect(view.deductions).toEqual({ deposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }], remainingCents: 204400 });
    expect(view.dueLabel).toBe('Reste à payer');
    expect(view.references.quote).toEqual({ number: 'D-2026-015', date: '2026-10-20' });
  });
});

describe('buildCreditView', () => {
  it('annule exactement une facture de solde : lignes et reste dû en négatif', () => {
    const original = { ...buildDocumentView(invoiceInput({
      kind: 'final', deductedDeposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }],
    })), number: 'F-2026-027' };
    const credit = buildCreditView(original, {
      date: '2026-11-10', templateRef: 'modele-03@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
      creditedRef: { number: 'F-2026-027', date: '2026-11-03' },
    });
    expect(credit.kind).toBe('credit');
    expect(credit.title).toBe('Avoir');
    expect(credit.number).toBeNull();
    expect(credit.lines[0]!.unitPriceCents).toBe(-38000);
    expect(credit.totals).toEqual({ totalHtCents: -292000, vatCents: 0, totalDueCents: -204400 });
    expect(credit.dueLabel).toBe('Montant de l’avoir');
    expect(credit.references.creditedInvoice).toEqual({ number: 'F-2026-027', date: '2026-11-03' });
  });

  it('porte les mentions de facture : prestation d’origine, pénalités, indemnité, escompte, règlement, sans échéance', () => {
    const original = { ...buildDocumentView(invoiceInput({ invoiceDates: { serviceDate: '2026-11-02', dueDate: '2026-12-03', notes: 'Note de la facture' } })), number: 'F-2026-027' };
    const ctx = { date: '2026-11-10', templateRef: 'modele-01@1', profile: { ...PROFILE_DATA, paymentDetails: 'IBAN actuel' }, creditedRef: { number: 'F-2026-027', date: '2026-11-03' } };
    expect(buildCreditView(original, { ...ctx, client: CLIENT_BUSINESS_DATA }).invoiceTerms).toEqual({
      serviceDate: '2026-11-02', dueDate: null, latePenaltyText: PROFILE_DATA.latePenaltyText, recoveryIndemnity: RECOVERY_INDEMNITY_MENTION,
      discount: NO_DISCOUNT_MENTION, paymentDetails: 'IBAN actuel', notes: '',
    });
    // L'indemnité de 40 € suit le client courant.
    expect(buildCreditView(original, { ...ctx, client: CLIENT_INDIVIDUAL_DATA }).invoiceTerms?.recoveryIndemnity).toBeNull();
    // Sans date de prestation connue dans l'instantané, l'avoir n'en invente pas.
    expect(buildCreditView({ ...original, invoiceTerms: null }, { ...ctx, client: CLIENT_BUSINESS_DATA }).invoiceTerms?.serviceDate).toBeNull();
  });
});

describe('parseSnapshot', () => {
  it('relit un instantané et refuse une version inconnue', () => {
    const view = buildDocumentView(quoteInput);
    expect(parseSnapshot(JSON.stringify(view))).toEqual(view);
    expect(() => parseSnapshot(JSON.stringify({ ...view, schemaVersion: 2 }))).toThrow();
  });
});
