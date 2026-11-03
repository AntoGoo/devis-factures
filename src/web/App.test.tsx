// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App, routes } from './App';
import { renderWithRouter } from './test-utils';

afterEach(() => vi.unstubAllGlobals());

const unauthenticated = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthenticated', message: '' }), { status: 401 })));

it('affiche la connexion quand personne n’est connecté', async () => {
  unauthenticated();
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
});

it('affiche « Page introuvable » pour une adresse inconnue, avec un lien vers l’accueil', async () => {
  unauthenticated();
  renderWithRouter(routes, { initialEntries: ['/nimporte/quoi'] });
  expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
  expect(screen.getByText('Cette adresse ne correspond à aucune page de l’application.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('href', '/');
});
