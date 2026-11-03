// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test-utils';
import { LinePresetsPage } from './LinePresetsPage';

afterEach(() => vi.unstubAllGlobals());

const preset = { id: 'p1', designation: 'Pose de carrelage', unit: 'm²', unitPriceCents: 4500, vatRate: null };

function renderPage() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/presets' ? { items: [preset] } : { profile: null })));
  return renderWithRouter([
    { path: '/lignes-types', element: <LinePresetsPage /> },
    { path: '/ailleurs', element: <h1>Ailleurs</h1> },
  ], { initialEntries: ['/lignes-types'] });
}

it('demande confirmation avant de quitter une ligne type en cours de saisie', async () => {
  const { router } = renderPage();
  await userEvent.type(screen.getByLabelText('Désignation'), 'Dépose');
  await act(() => router.navigate('/ailleurs'));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
});

it('laisse quitter une ligne type ouverte en modification mais inchangée', async () => {
  const { router } = renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
  expect(screen.getByLabelText('Désignation')).toHaveValue('Pose de carrelage');
  await act(() => router.navigate('/ailleurs'));
  expect(await screen.findByRole('heading', { name: 'Ailleurs' })).toBeInTheDocument();
});

it('demande confirmation quand la ligne type ouverte a été modifiée', async () => {
  const { router } = renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
  await userEvent.type(screen.getByLabelText('P.U. HT'), '0');
  await act(() => router.navigate('/ailleurs'));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
});
