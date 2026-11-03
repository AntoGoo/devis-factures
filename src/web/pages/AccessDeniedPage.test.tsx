// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessDeniedPage } from './AccessDeniedPage';

function renderAt(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/acces-refuse']}>
        <Routes>
          <Route path="/acces-refuse" element={<AccessDeniedPage />} />
          <Route path="/" element={<p>Contenu protégé</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AccessDeniedPage', () => {
  it('affiche le message d’accès refusé sans session autorisée', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    expect(await screen.findByRole('heading', { name: 'Accès sur invitation' })).toBeInTheDocument();
  });

  it('renvoie vers / si l’utilisateur est désormais autorisé', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' }, isSuperadmin: false, onboarding: { templateRef: 'modele-01@1', profileComplete: true }, profileSummary: null });
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Accès sur invitation' })).not.toBeInTheDocument();
  });
});
