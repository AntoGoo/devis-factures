// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { InvoiceResponse } from '../../shared/api-types';
import { buildDocumentView } from '../../shared/document';
import { blankLines } from '../../shared/lines';
import { formatEuros } from '../../shared/money';
import { CLIENT_BUSINESS_DATA, PROFILE_DATA } from '../../shared/test-fixtures';
import { InvoicePage } from './InvoicePage';

afterEach(() => vi.unstubAllGlobals());

const invoice: InvoiceResponse = {
  invoice: {
    id: 'i1', kind: 'standalone', status: 'draft', number: null, quoteId: null, clientId: CLIENT_BUSINESS_DATA.id,
    object: '', interventionAddress: null, lines: blankLines(5), depositBp: null, totalHtCents: 0, amountDueCents: 0,
    serviceDate: null, dueDate: null, notes: '', issueDate: null, paidAt: null, cancelledAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z', display: 'draft',
  },
  view: buildDocumentView({
    kind: 'standalone', number: null, date: null, templateRef: 'modele-01@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
    object: '', interventionAddress: null, lines: blankLines(5), invoiceDates: { serviceDate: null, dueDate: null, notes: '' },
  }),
  links: { quote: null, creditNote: null, creditedInvoice: null },
};

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/profile') return Response.json({ profile: PROFILE_DATA });
    if (url === '/api/clients') return Response.json({ items: [CLIENT_BUSINESS_DATA] });
    if (url === '/api/invoices/i1' && (init?.method ?? 'GET') === 'GET') return Response.json(invoice);
    if (url === '/api/invoices/i1' && init?.method === 'PUT') return Response.json(invoice);
    return Response.json({});
  }));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/factures/i1']}>
        <Routes><Route path="/factures/:id" element={<InvoicePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('bloque l’émission tant qu’une ligne est invalide, avec une indication, et met à jour le total HT en direct', async () => {
  stubApi();
  const { container } = renderPage();

  const issueButton = await screen.findByRole('button', { name: 'Émettre la facture' });
  expect(issueButton).toBeEnabled();
  expect(screen.queryByText('Corrigez les champs en rouge avant de continuer.')).not.toBeInTheDocument();

  const totalHt = () => container.querySelector('.summary-row span:last-child')?.textContent;
  expect(totalHt()).toBe(formatEuros(0));

  const rows = screen.getAllByRole('row').slice(1);
  const price = within(rows[0]!).getByLabelText('Prix unitaire HT en euros');
  await userEvent.type(price, '100');

  // Le total HT se met à jour immédiatement, sans attendre la fin de l'enregistrement automatique.
  expect(totalHt()).toBe(formatEuros(10000));

  await userEvent.clear(price);
  await userEvent.type(price, '1,234'); // plus de 2 décimales : invalide

  expect(issueButton).toBeDisabled();
  expect(screen.getByText('Corrigez les champs en rouge avant de continuer.')).toBeInTheDocument();

  // Le bouton « Supprimer le brouillon » n’est pas concerné par la validité du formulaire.
  expect(screen.getByRole('button', { name: 'Supprimer le brouillon' })).toBeEnabled();
});

it('affiche le refus de l’émission dans la boîte de confirmation, et l’efface à la réouverture', async () => {
  stubApi();
  const base = vi.mocked(fetch).getMockImplementation()!;
  const message = 'Complétez l’adresse de facturation du client (rue, code postal, ville) avant d’émettre la facture.';
  vi.mocked(fetch).mockImplementation(async (url, init) => (url === '/api/invoices/i1/issue'
    ? Response.json({ error: 'client_address_required', message }, { status: 409 })
    : base(url, init)));
  renderPage();
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: 'Émettre la facture' }));
  let dialog = screen.getByRole('dialog', { name: 'Émettre la facture' });
  await user.click(within(dialog).getByRole('button', { name: 'Émettre la facture' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);

  await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  await user.click(screen.getByRole('button', { name: 'Émettre la facture' }));
  dialog = screen.getByRole('dialog', { name: 'Émettre la facture' });
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
});

it('indique le type de chaque client dans la liste, comme sur un devis', async () => {
  stubApi();
  renderPage();
  expect(await screen.findByRole('option', { name: 'SCI Les Tilleuls (professionnel)' })).toBeInTheDocument();
});

it('propose un lien de retour vers la liste des factures', async () => {
  stubApi();
  renderPage();
  expect(await screen.findByRole('link', { name: '← Factures' })).toHaveAttribute('href', '/factures');
});
