// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { social } = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock('../auth-client', () => ({ authClient: { signIn: { social } } }));

import { LoginPage } from './LoginPage';

function renderAt(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/connexion']}>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/" element={<p>Contenu protégé</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('affiche l’accroche, le bouton Google et l’avertissement d’invitation sans session', async () => {
    renderAt(401, { error: 'unauthenticated', message: '' });
    expect(await screen.findByRole('heading', { name: 'Du devis signé à la facture payée, sans ressaisir une ligne.' })).toBeInTheDocument();
    expect(screen.getByText(/Accès sur invitation/)).toBeInTheDocument();
  });

  it('lance la connexion Google avec les bonnes redirections', async () => {
    renderAt(401, { error: 'unauthenticated', message: '' });
    await screen.findByRole('heading', { name: 'Du devis signé à la facture payée, sans ressaisir une ligne.' });
    await userEvent.click(screen.getByRole('button', { name: /Continuer avec Google/ }));
    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/', errorCallbackURL: '/acces-refuse' });
  });

  it('renvoie vers / si une session valide existe déjà', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' }, isSuperadmin: false, onboarding: { templateRef: 'modele-01@1', profileComplete: true }, profileSummary: null });
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Du devis signé à la facture payée, sans ressaisir une ligne.' })).not.toBeInTheDocument();
  });
});
