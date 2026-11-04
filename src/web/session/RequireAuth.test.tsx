// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';

function renderAt(status: number, body: unknown) {
  renderWith(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

function renderWith(response: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => response));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<p>Contenu protégé</p>} />
          </Route>
          <Route path="/connexion" element={<p>Page de connexion</p>} />
          <Route path="/acces-refuse" element={<p>Page accès refusé</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('RequireAuth', () => {
  it('renvoie vers la connexion sans session', async () => {
    renderAt(401, { error: 'unauthenticated', message: '' });
    expect(await screen.findByText('Page de connexion')).toBeInTheDocument();
  });

  it('renvoie vers Accès refusé si l’adresse n’est pas invitée', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    expect(await screen.findByText('Page accès refusé')).toBeInTheDocument();
  });

  it('affiche le contenu pour un utilisateur autorisé', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' }, isSuperadmin: false, onboarding: { templateRef: 'modele-01@1', profileComplete: true }, profileSummary: null });
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
  });

  it('affiche une erreur au lieu de planter si /api/me renvoie une page HTML', async () => {
    renderWith(new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Réponse inattendue du serveur.');
    expect(screen.queryByText('Contenu protégé')).not.toBeInTheDocument();
  });

  it('affiche une erreur au lieu de planter si /api/me renvoie un JSON incomplet', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Réponse inattendue du serveur.');
    expect(screen.queryByText('Contenu protégé')).not.toBeInTheDocument();
  });
});
