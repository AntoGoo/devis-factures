// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { QuoteListItem } from '../../shared/api-types';
import { QuotesListPage } from './QuotesListPage';

afterEach(() => vi.unstubAllGlobals());

const items: QuoteListItem[] = [
  { id: 'q1', number: 'D-2026-001', status: 'sent', clientName: 'SCI Les Tilleuls', object: 'Rénovation', totalHtCents: 292000, quoteDate: '2026-11-03', updatedAt: '2026-11-03T10:00:00.000Z' },
  { id: 'q2', number: null, status: 'draft', clientName: null, object: '', totalHtCents: 0, quoteDate: null, updatedAt: '2026-11-03T09:00:00.000Z' },
];

it('rend chaque devis joignable au clavier par un lien sur son numéro', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/devis']}>
        <Routes>
          <Route path="/devis" element={<QuotesListPage />} />
          <Route path="/devis/:id" element={<p>Devis ouvert</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('link', { name: 'D-2026-001' })).toHaveAttribute('href', '/devis/q1');
  const draft = screen.getByRole('link', { name: 'Devis (brouillon)' });
  expect(draft).toHaveAttribute('href', '/devis/q2');

  const user = userEvent.setup();
  draft.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByText('Devis ouvert')).toBeInTheDocument();
});
