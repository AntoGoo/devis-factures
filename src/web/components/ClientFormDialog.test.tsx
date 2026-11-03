// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test-utils';
import { ClientFormDialog } from './ClientFormDialog';

afterEach(() => vi.unstubAllGlobals());

function setup(onSaved = vi.fn()) {
  renderWithRouter(<ClientFormDialog open onClose={() => {}} onSaved={onSaved} />);
  return onSaved;
}

it('ne demande le SIREN que pour un professionnel', async () => {
  setup();
  expect(screen.queryByLabelText('SIREN ou SIRET')).toBeNull();
  await userEvent.click(screen.getByLabelText('Professionnel'));
  expect(screen.getByLabelText('SIREN ou SIRET')).toBeInTheDocument();
});

it('crée le client et le renvoie', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'c1', type: 'individual', name: 'Mme Garnier' }, { status: 201 })));
  const onSaved = setup();
  await userEvent.type(screen.getByLabelText('Nom ou raison sociale'), 'Mme Garnier');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le client' }));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
});

it('demande confirmation avant de quitter la page quand la fenêtre ouverte a été modifiée', async () => {
  const { router } = renderWithRouter([
    { path: '/clients', element: <ClientFormDialog open onClose={() => {}} onSaved={() => {}} /> },
    { path: '/ailleurs', element: <h1>Ailleurs</h1> },
  ], { initialEntries: ['/clients'] });
  await userEvent.type(screen.getByLabelText('Nom ou raison sociale'), 'Mme Garnier');
  await act(() => router.navigate('/ailleurs'));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/clients');
});

it('ne retient pas la page quand la fenêtre est fermée', async () => {
  const { router } = renderWithRouter([
    { path: '/clients', element: <ClientFormDialog open={false} onClose={() => {}} onSaved={() => {}} /> },
    { path: '/ailleurs', element: <h1>Ailleurs</h1> },
  ], { initialEntries: ['/clients'] });
  await act(() => router.navigate('/ailleurs'));
  expect(await screen.findByRole('heading', { name: 'Ailleurs' })).toBeInTheDocument();
});
