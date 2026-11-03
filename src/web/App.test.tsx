// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

it('affiche la connexion quand personne n’est connecté', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthenticated', message: '' }), { status: 401 })));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
});
