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
  it('affiche le logo, le bouton Google et l’avertissement d’invitation sans session, sans bloc d’accroche', async () => {
    renderAt(401, { error: 'unauthenticated', message: '' });
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Devis & Factures — accueil' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: /Continuer avec Google/ })).toBeInTheDocument();
    expect(screen.getByText(/Accès sur invitation/)).toBeInTheDocument();
    expect(screen.queryByText('Du devis signé à la facture payée, sans ressaisir une ligne.')).not.toBeInTheDocument();
  });

  it('lance la connexion Google avec les bonnes redirections', async () => {
    renderAt(401, { error: 'unauthenticated', message: '' });
    await screen.findByRole('heading', { name: 'Connexion' });
    await userEvent.click(screen.getByRole('button', { name: /Continuer avec Google/ }));
    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/', errorCallbackURL: '/acces-refuse' });
  });

  it('renvoie vers / si une session valide existe déjà', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' }, isSuperadmin: false, onboarding: { templateRef: 'modele-01@1', profileComplete: true }, profileSummary: null });
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connexion' })).not.toBeInTheDocument();
  });

  it('affiche un message d’indisponibilité si Google renvoie une erreur', async () => {
    social.mockResolvedValueOnce({ data: null, error: { message: 'oauth_failed' } });
    renderAt(401, { error: 'unauthenticated', message: '' });
    await screen.findByRole('heading', { name: 'Connexion' });
    await userEvent.click(screen.getByRole('button', { name: /Continuer avec Google/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La connexion Google est indisponible pour le moment. Réessayez plus tard ou contactez l’administrateur.');
  });

  it('affiche un message d’indisponibilité si l’appel Google lève une exception', async () => {
    social.mockRejectedValueOnce(new Error('network down'));
    renderAt(401, { error: 'unauthenticated', message: '' });
    await screen.findByRole('heading', { name: 'Connexion' });
    await userEvent.click(screen.getByRole('button', { name: /Continuer avec Google/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La connexion Google est indisponible pour le moment. Réessayez plus tard ou contactez l’administrateur.');
  });

  it('désactive le bouton pendant l’appel de connexion', async () => {
    let resolveSocial: (value: { data: null; error: null }) => void = () => {};
    social.mockImplementationOnce(() => new Promise((resolve) => { resolveSocial = resolve; }));
    renderAt(401, { error: 'unauthenticated', message: '' });
    await screen.findByRole('heading', { name: 'Connexion' });
    const button = screen.getByRole('button', { name: /Continuer avec Google/ });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    resolveSocial({ data: null, error: null });
  });
});
