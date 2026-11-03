// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><ProfilePage mode="onboarding" /></MemoryRouter></QueryClientProvider>);

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
});
