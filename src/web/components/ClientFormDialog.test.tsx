// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientFormDialog } from './ClientFormDialog';

afterEach(() => vi.unstubAllGlobals());

function setup(onSaved = vi.fn()) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><ClientFormDialog open onClose={() => {}} onSaved={onSaved} /></QueryClientProvider>);
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
