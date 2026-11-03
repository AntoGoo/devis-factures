// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildCreditView, buildDocumentView, type BuildViewInput } from '../../shared/document';
import { CLIENT_BUSINESS_DATA, CLIENT_INDIVIDUAL_DATA, MOCKUP_LINES, PROFILE_DATA } from '../../shared/test-fixtures';
import { getTemplate } from '../../templates/registry';
import { DocumentRenderer } from './DocumentRenderer';

const plain = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ').replace(/−/g, '-');
const text = () => plain(document.body.textContent);

const quote = (templateRef = 'modele-01@1', number: string | null = 'D-2026-016') => buildDocumentView({
  kind: 'quote', number, date: number ? '2026-10-31' : null, templateRef, profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
  object: 'Rénovation électrique du rez-de-chaussée', interventionAddress: '12 rue des Tilleuls, 44000 Nantes', lines: MOCKUP_LINES,
  quoteTerms: { validityDays: 30, plannedStart: 'Semaine du 23 novembre', estimatedDuration: '4 jours', paymentTerms: 'Acompte de 30 % à la signature', plannedDepositBp: 3000 },
});

const invoice = (o: Partial<BuildViewInput> = {}) => buildDocumentView({
  kind: 'standalone', number: 'F-2026-025', date: '2026-10-15', templateRef: 'modele-01@1', profile: PROFILE_DATA,
  client: CLIENT_BUSINESS_DATA, object: 'Dépannage', interventionAddress: null, lines: MOCKUP_LINES,
  invoiceDates: { serviceDate: '2026-10-14', dueDate: '2026-11-14', notes: '' }, ...o,
});

const show = (view: ReturnType<typeof quote>) => render(<DocumentRenderer view={view} template={getTemplate(view.templateRef)} />);

describe('DocumentRenderer', () => {
  it('rend un devis complet', () => {
    show(quote());
    expect(screen.getByRole('heading', { level: 1, name: 'Devis' })).toBeInTheDocument();
    for (const t of ['N° D-2026-016', '31 octobre 2026', 'Karim Benali EI', 'SIRET 912 345 678 00019', 'SIREN 801 222 333',
      'Intervention : 12 rue des Tilleuls, 44000 Nantes', 'TVA non applicable, art. 293 B du CGI', 'Validité du devis : 30 jours',
      'Bon pour accord', 'Nom et signature du client :', 'Assurance professionnelle MAAF Pro n° DEC-4471209, France métropolitaine']) {
      expect(text()).toContain(t);
    }
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect(text().match(/2 920,00 €/g)).toHaveLength(2);
  });

  it('applique la classe et les libellés du modèle', () => {
    const { container } = show(quote('modele-02@1'));
    expect(container.querySelector('.doc.tpl-modele-02-v1')).not.toBeNull();
    const labels = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(labels).toEqual(['De', 'Pour', 'Modalités', 'Bon pour accord']);
    expect(text()).not.toContain('Merci de votre confiance');
  });

  it('remercie seulement dans le modèle Raffiné', () => {
    show(quote('modele-03@1'));
    expect(text()).toContain('Merci de votre confiance');
  });

  it('indique un brouillon sans numéro ni date', () => {
    show(quote('modele-01@1', null));
    expect(text()).toContain('Brouillon');
    expect(text()).not.toContain('N° ');
  });

  it('porte les mentions de facture, dont les 40 € pour un professionnel seulement', () => {
    const { unmount } = show(invoice());
    for (const t of ['Date de la prestation : 14 octobre 2026', 'Échéance : 14 novembre 2026', 'Pas d’escompte pour paiement anticipé.', 'Indemnité forfaitaire pour frais de recouvrement', 'pénalités au taux']) {
      expect(text()).toContain(t);
    }
    expect(text()).not.toContain('Bon pour accord');
    unmount();
    show(invoice({ client: CLIENT_INDIVIDUAL_DATA }));
    expect(text()).not.toContain('Indemnité forfaitaire');
  });

  it('liste les acomptes déduits sur une facture de solde', () => {
    show(invoice({
      kind: 'final', number: 'F-2026-027', quoteRef: { number: 'D-2026-015', date: '2026-10-20' },
      deductedDeposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }],
    }));
    expect(screen.getByRole('heading', { level: 1, name: 'Facture de solde' })).toBeInTheDocument();
    expect(text()).toContain('Devis n° D-2026-015 du 20 octobre 2026');
    expect(text()).toContain('Acompte F-2026-026 du 28 oct. 2026');
    expect(text()).toContain('-876,00 €');
    expect(text()).toContain('Reste à payer');
    expect(text()).toContain('2 044,00 €');
  });

  it('rend un avoir avec la facture annulée et des montants négatifs', () => {
    const original = { ...invoice(), number: 'F-2026-025' };
    show({ ...buildCreditView(original, { date: '2026-11-03', templateRef: 'modele-01@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, creditedRef: { number: 'F-2026-025', date: '2026-10-15' } }), number: 'A-2026-001' });
    expect(screen.getByRole('heading', { level: 1, name: 'Avoir' })).toBeInTheDocument();
    expect(text()).toContain('Annule la facture n° F-2026-025 du 15 octobre 2026');
    expect(text()).toContain('Montant de l’avoir');
    expect(text()).toContain('-2 920,00 €');
  });
});
