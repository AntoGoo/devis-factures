// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.unstubAllGlobals());

describe('AccessDeniedPage', () => {
  it('affiche le message d’accès refusé sans paramètre error', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    expect(await screen.findByRole('heading', { name: 'Accès sur invitation' })).toBeInTheDocument();
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
