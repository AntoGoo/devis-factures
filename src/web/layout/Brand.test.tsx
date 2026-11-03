// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginPage } from '../pages/LoginPage';
import { AppShell } from './AppShell';
import { OnboardingLayout } from './OnboardingLayout';

afterEach(() => vi.unstubAllGlobals());

function renderAt(ui: ReactElement, path = '/') {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthenticated', message: '' }, { status: 401 })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>);
}

const brand = () => screen.findByRole('link', { name: 'Devis & Factures — accueil' });

it('le logo de la navigation principale ramène à l’accueil', async () => {
  renderAt(<AppShell />, '/devis');
  expect(await brand()).toHaveAttribute('href', '/');
});

it('le logo de l’accueil d’onboarding ramène à l’accueil', async () => {
  renderAt(<OnboardingLayout step={1}><p>Étape</p></OnboardingLayout>, '/bienvenue/modele');
  expect(await brand()).toHaveAttribute('href', '/');
});

it('le logo de la page de connexion ramène à l’accueil', async () => {
  renderAt(<LoginPage />, '/connexion');
  expect(await brand()).toHaveAttribute('href', '/');
});
