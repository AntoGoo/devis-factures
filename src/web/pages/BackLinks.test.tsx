// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BillingSummary } from '../../shared/api-types';
import { renderWithRouter } from '../test-utils';
import { QuoteBillingPage } from './QuoteBillingPage';
import { TemplatePickerPage } from './TemplatePickerPage';

afterEach(() => vi.unstubAllGlobals());

const billing: BillingSummary = {
  quote: { id: 'q1', number: 'D-2026-014', acceptedAt: '2026-10-01T10:00:00.000Z', clientName: 'SCI Les Tilleuls', object: 'Cuisine', totalCents: 400000, plannedDepositBp: 3000, lineCount: 3 },
  invoices: [], invoicedDepositsCents: 0, issuedDepositsCents: 0, remainingToInvoiceCents: 400000,
  activeFinal: null, draftDepositCount: 0, canCreateDeposit: true, canPrepareFinal: true,
};

it('la facturation d’un devis renvoie vers ce devis, numéro compris', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(billing)));
  renderWithRouter(<QuoteBillingPage />, { path: '/devis/:id/facturation', initialEntries: ['/devis/q1/facturation'] });
  expect(await screen.findByRole('link', { name: '← Devis D-2026-014' })).toHaveAttribute('href', '/devis/q1');
});

it('le choix du modèle depuis le profil renvoie vers le profil', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  renderWithRouter(<TemplatePickerPage mode="settings" />, { path: '/profil/modele' });
  expect(screen.getByRole('link', { name: '← Profil entreprise' })).toHaveAttribute('href', '/profil');
});

it('le choix du modèle à l’onboarding n’a pas de lien de retour', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  renderWithRouter(<TemplatePickerPage mode="onboarding" />, { path: '/bienvenue/modele' });
  expect(screen.queryByRole('link', { name: /^←/ })).not.toBeInTheDocument();
});
