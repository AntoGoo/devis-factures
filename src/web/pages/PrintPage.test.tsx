// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { buildDocumentView } from '../../shared/document';
import { CLIENT_BUSINESS_DATA, MOCKUP_LINES, PROFILE_DATA } from '../../shared/test-fixtures';
import { PrintPage } from './PrintPage';

afterEach(() => vi.unstubAllGlobals());

it('fixe le titre puis lance l’impression une fois les polices prêtes', async () => {
  const view = buildDocumentView({ kind: 'quote', number: 'D-2026-016', date: '2026-10-31', templateRef: 'modele-02@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, object: '', interventionAddress: null, lines: MOCKUP_LINES, quoteTerms: { validityDays: 30, plannedStart: '', estimatedDuration: '', paymentTerms: '', plannedDepositBp: null } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ view })));
  const print = vi.fn();
  vi.stubGlobal('print', print);
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/imprimer/devis/q1?auto=1']}>
        <Routes><Route path="/imprimer/:type/:id" element={<PrintPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Devis' })).toBeInTheDocument();
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(document.title).toBe('D-2026-016 – SCI Les Tilleuls');
  expect(screen.getByText(/Enregistrer au format PDF/)).toBeInTheDocument();
});

it('recharge le document à chaque ouverture et n’imprime que la version fraîche', async () => {
  const quoteTerms = { validityDays: 30, plannedStart: '', estimatedDuration: '', paymentTerms: '', plannedDepositBp: null };
  const base = { kind: 'quote' as const, date: '2026-10-31', templateRef: 'modele-02@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, object: '', interventionAddress: null, lines: MOCKUP_LINES, quoteTerms };
  let current = buildDocumentView({ ...base, number: null });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ view: current })));
  const printedWithNumber: boolean[] = [];
  vi.stubGlobal('print', vi.fn(() => { printedWithNumber.push(screen.queryAllByText('N° D-2026-016').length > 0); }));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  // Même réglage que le client de l’application : données « fraîches » 30 s.
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const page = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/imprimer/devis/q1?auto=1']}>
        <Routes><Route path="/imprimer/:type/:id" element={<PrintPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  const first = render(page());
  await waitFor(() => expect(printedWithNumber).toEqual([false]));
  first.unmount();

  current = buildDocumentView({ ...base, number: 'D-2026-016' });
  render(page());
  await waitFor(() => expect(printedWithNumber).toHaveLength(2));
  expect(printedWithNumber).toEqual([false, true]);
  expect(screen.getAllByText('N° D-2026-016').length).toBeGreaterThan(0);
});
