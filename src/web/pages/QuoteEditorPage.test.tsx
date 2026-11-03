// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { QuoteResponse } from '../../shared/api-types';
import { buildDocumentView } from '../../shared/document';
import { blankLines } from '../../shared/lines';
import { CLIENT_BUSINESS_DATA, PROFILE_DATA } from '../../shared/test-fixtures';
import { QuoteEditorPage } from './QuoteEditorPage';

afterEach(() => vi.unstubAllGlobals());

const quote: QuoteResponse = {
  quote: {
    id: 'q1', number: null, status: 'draft', quoteDate: null, acceptedAt: null, refusedAt: null, totalHtCents: 0, updatedAt: '2026-01-01T00:00:00.000Z',
    clientId: CLIENT_BUSINESS_DATA.id, object: '', interventionAddress: null, lines: blankLines(5), validityDays: 30,
    plannedStart: '', estimatedDuration: '', paymentTerms: '', plannedDepositBp: null,
  },
  view: buildDocumentView({
    kind: 'quote', number: null, date: null, templateRef: 'modele-01@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
    object: '', interventionAddress: null, lines: blankLines(5),
  }),
};

function stubApi() {
  const puts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/profile') return Response.json({ profile: PROFILE_DATA });
    if (url === '/api/clients') return Response.json({ items: [CLIENT_BUSINESS_DATA] });
    if (url === '/api/quotes/q1' && (init?.method ?? 'GET') === 'GET') return Response.json(quote);
    if (url === '/api/quotes/q1' && init?.method === 'PUT') {
      puts.push(init.body ? JSON.parse(String(init.body)) : undefined);
      return Response.json(quote);
    }
    return Response.json({});
  }));
  return puts;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/devis/q1']}>
        <Routes><Route path="/devis/:id" element={<QuoteEditorPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('bloque les actions de statut tant qu’un champ du devis est invalide, avec une indication', async () => {
  stubApi();
  renderPage();

  const sendButton = await screen.findByRole('button', { name: 'Marquer comme envoyé' });
  expect(sendButton).toBeEnabled();
  expect(screen.queryByText('Corrigez les champs en rouge avant de continuer.')).not.toBeInTheDocument();

  const rows = screen.getAllByRole('row').slice(1);
  const price = within(rows[0]!).getByLabelText('Prix unitaire HT en euros');
  await userEvent.type(price, '12,345'); // plus de 2 décimales : invalide

  expect(sendButton).toBeDisabled();
  expect(screen.getByText('Corrigez les champs en rouge avant de continuer.')).toBeInTheDocument();

  // Le bouton « Supprimer le brouillon » n’est pas concerné par la validité du formulaire.
  expect(screen.getByRole('button', { name: 'Supprimer le brouillon' })).toBeEnabled();
});

it('propose un lien de retour vers la liste des devis', async () => {
  stubApi();
  renderPage();
  expect(await screen.findByRole('link', { name: '← Devis' })).toHaveAttribute('href', '/devis');
});
