// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ data: { success: true }, error: null })) }));
vi.mock('../auth-client', () => ({ authClient: { signOut } }));

import { AccessDeniedPage } from './AccessDeniedPage';

function renderAt(status: number, body: unknown, path = '/acces-refuse') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/acces-refuse" element={<AccessDeniedPage />} />
          <Route path="/" element={<p>Contenu protégé</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { vi.unstubAllGlobals(); signOut.mockClear(); });

describe('AccessDeniedPage', () => {
  it('affiche le message d’accès refusé sans paramètre error', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    expect(await screen.findByRole('heading', { name: 'Accès sur invitation' })).toBeInTheDocument();
  });

  it('propose « Accueil » à la place de « Revenir à la connexion » sur un refus d’invitation, avec le logo', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    await screen.findByRole('heading', { name: 'Accès sur invitation' });
    expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: 'Revenir à la connexion' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Devis & Factures — accueil' })).toHaveAttribute('href', '/');
  });

  it('« Accueil » ferme la session refusée avant de revenir à l’accueil', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    await userEvent.click(await screen.findByRole('link', { name: 'Accueil' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
  });

  it.each(['invalid_code', 'access_denied'])('propose « Réessayer » et « Accueil » pour ?error=%s, avec le logo', async (error) => {
    renderAt(403, { error: 'not_invited', message: '' }, `/acces-refuse?error=${error}`);
    expect(await screen.findByRole('link', { name: 'Réessayer' })).toHaveAttribute('href', '/connexion');
    expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Devis & Factures — accueil' })).toHaveAttribute('href', '/');
  });

  it('affiche le message d’accès refusé pour ?error=not_invited', async () => {
    renderAt(403, { error: 'not_invited', message: '' }, '/acces-refuse?error=not_invited');
    expect(await screen.findByRole('heading', { name: 'Accès sur invitation' })).toBeInTheDocument();
  });

  it('affiche une erreur technique pour ?error=invalid_code, avec le code et un lien Réessayer', async () => {
    renderAt(403, { error: 'not_invited', message: '' }, '/acces-refuse?error=invalid_code');
    expect(await screen.findByRole('heading', { name: 'La connexion n’a pas abouti' })).toBeInTheDocument();
    expect(screen.getByText('Code : invalid_code')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Réessayer' })).toHaveAttribute('href', '/connexion');
  });

  it('affiche une annulation pour ?error=access_denied', async () => {
    renderAt(403, { error: 'not_invited', message: '' }, '/acces-refuse?error=access_denied');
    expect(await screen.findByRole('heading', { name: 'Connexion annulée' })).toBeInTheDocument();
    expect(screen.getByText('Vous avez annulé la connexion avec Google.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('assainit un code non conforme en "inconnu" pour ?error=<script>', async () => {
    renderAt(403, { error: 'not_invited', message: '' }, '/acces-refuse?error=%3Cscript%3E');
    expect(await screen.findByRole('heading', { name: 'La connexion n’a pas abouti' })).toBeInTheDocument();
    expect(screen.getByText('Code : inconnu')).toBeInTheDocument();
  });

  it('n’affiche jamais error_description', async () => {
    renderAt(403, { error: 'not_invited', message: '' }, '/acces-refuse?error=invalid_code&error_description=Secret%20interne');
    await screen.findByRole('heading', { name: 'La connexion n’a pas abouti' });
    expect(screen.queryByText(/Secret interne/)).not.toBeInTheDocument();
  });

  it('renvoie vers / si l’utilisateur est désormais autorisé', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' }, isSuperadmin: false, onboarding: { templateRef: 'modele-01@1', profileComplete: true }, profileSummary: null });
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Accès sur invitation' })).not.toBeInTheDocument();
  });
});
