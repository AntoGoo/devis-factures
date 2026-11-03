// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PROFILE_DATA } from '../../shared/test-fixtures';
import { renderWithRouter } from '../test-utils';
import { ProfilePage } from './ProfilePage';

afterEach(() => vi.unstubAllGlobals());

it('affiche la mention de franchise et envoie un profil complet', async () => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/numbering') return Response.json({ year: 2026, series: [
      { series: 'D', prefix: 'D', next: 'D-2026-001', startEditable: true },
      { series: 'F', prefix: 'F', next: 'F-2026-001', startEditable: true },
      { series: 'A', prefix: 'A', next: 'A-2026-001', startEditable: true },
    ] });
    if (url === '/api/profile' && (init?.method ?? 'GET') === 'GET') return Response.json({ profile: null });
    return Response.json({ profile: {} });
  }));
  renderWithRouter([
    { path: '/bienvenue/entreprise', element: <ProfilePage mode="onboarding" /> },
    { path: '/', element: <h1>Tableau de bord</h1> },
  ], { initialEntries: ['/bienvenue/entreprise'] });

  expect(await screen.findByText(/TVA non applicable, art\. 293 B du CGI/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Prénom et nom'), 'Karim Benali');
  await userEvent.type(screen.getByLabelText('Adresse'), '8 rue de la Fosse');
  await userEvent.type(screen.getByLabelText('Code postal'), '44000');
  await userEvent.type(screen.getByLabelText('Ville'), 'Nantes');
  await userEvent.type(screen.getByLabelText('SIRET'), '912 345 678 00019');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/profile')).toBe(true));
  const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/profile')!;
  expect(put.body).toMatchObject({ ownerName: 'Karim Benali', siret: '912 345 678 00019', defaultPaymentDelayDays: 30, units: ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'] });
  // L’enregistrement réussi de l’onboarding mène au tableau de bord sans demander de confirmation.
  expect(await screen.findByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Quitter la page ?' })).not.toBeInTheDocument();
});

function renderSettings() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/numbering') return Response.json({ year: 2026, series: [] });
    if (url === '/api/profile') return Response.json({ profile: PROFILE_DATA });
    return Response.json({});
  }));
  return renderWithRouter([
    { path: '/profil', element: <ProfilePage mode="settings" /> },
    { path: '/profil/modele', element: <h1>Choix du modèle</h1> },
  ], { initialEntries: ['/profil'] });
}

it('demande confirmation avant de quitter un profil modifié', async () => {
  const { router } = renderSettings();
  const city = await screen.findByLabelText('Ville');
  await waitFor(() => expect(city).toHaveValue(PROFILE_DATA.city));
  await userEvent.type(city, ' Centre');
  await userEvent.click(screen.getByRole('link', { name: 'Changer de modèle' }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/profil');
});

it('laisse quitter sans question après un enregistrement réussi', async () => {
  renderSettings();
  const city = await screen.findByLabelText('Ville');
  await waitFor(() => expect(city).toHaveValue(PROFILE_DATA.city));
  await userEvent.type(city, ' Centre');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await screen.findByText('Profil enregistré.');
  await userEvent.click(screen.getByRole('link', { name: 'Changer de modèle' }));
  expect(await screen.findByRole('heading', { name: 'Choix du modèle' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Quitter la page ?' })).not.toBeInTheDocument();
});
