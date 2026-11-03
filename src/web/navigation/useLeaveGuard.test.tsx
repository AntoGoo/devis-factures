// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test-utils';
import { useLeaveGuard } from './useLeaveGuard';

function Form({ initialDirty = false, trySave }: { initialDirty?: boolean; trySave?: () => Promise<boolean> }) {
  const [dirty, setDirty] = useState(initialDirty);
  const { prompt, bypass } = useLeaveGuard({ dirty, trySave });
  const navigate = useNavigate();
  return (
    <>
      <h1>Formulaire</h1>
      <button type="button" onClick={() => setDirty(true)}>Modifier</button>
      <Link to="/ailleurs">Ailleurs</Link>
      <Link to="/form?onglet=2">Même page</Link>
      {/* Action réussie suivie d'une navigation lancée par la page : jamais de confirmation. */}
      <button type="button" onClick={() => { setDirty(false); bypass(); navigate('/ailleurs'); }}>Supprimer</button>
      {prompt}
    </>
  );
}

function renderForm(props: Parameters<typeof Form>[0] = {}) {
  return renderWithRouter([
    { path: '/form', element: <Form {...props} /> },
    { path: '/ailleurs', element: <h1>Ailleurs</h1> },
  ], { initialEntries: ['/form'] });
}

const dialog = () => screen.queryByRole('dialog', { name: 'Quitter la page ?' });

it('laisse naviguer librement sans modification', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));
  expect(await screen.findByRole('heading', { name: 'Ailleurs' })).toBeInTheDocument();
  expect(dialog()).toBeNull();
});

it('demande confirmation quand la page est modifiée : « Rester » reste, « Quitter sans enregistrer » part', async () => {
  const { router } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Modifier' }));
  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));

  const d = await screen.findByRole('dialog', { name: 'Quitter la page ?' });
  expect(within(d).getByText('Des modifications ne sont pas enregistrées. Quitter la page ?')).toBeInTheDocument();
  await userEvent.click(within(d).getByRole('button', { name: 'Rester' }));
  expect(dialog()).toBeNull();
  expect(router.state.location.pathname).toBe('/form');

  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).getByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(await screen.findByRole('heading', { name: 'Ailleurs' })).toBeInTheDocument();
});

it('Échap équivaut à « Rester »', async () => {
  const { router } = renderForm({ initialDirty: true });
  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));
  await screen.findByRole('dialog', { name: 'Quitter la page ?' });
  await userEvent.keyboard('{Escape}');
  expect(dialog()).toBeNull();
  expect(router.state.location.pathname).toBe('/form');
});

it('enregistre puis part sans rien demander quand trySave réussit', async () => {
  const trySave = vi.fn(async () => true);
  renderForm({ initialDirty: true, trySave });
  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));
  expect(await screen.findByRole('heading', { name: 'Ailleurs' })).toBeInTheDocument();
  expect(trySave).toHaveBeenCalledTimes(1);
  expect(dialog()).toBeNull();
});

it.each([
  ['échoue', async () => false],
  ['rejette', async () => { throw new Error('réseau'); }],
])('demande confirmation quand trySave %s', async (_, impl) => {
  const trySave = vi.fn(impl);
  const { router } = renderForm({ initialDirty: true, trySave });
  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
  expect(trySave).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe('/form');
});

it('retient la fermeture de l’onglet seulement quand la page est modifiée', async () => {
  renderForm();
  const unload = () => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };
  expect(unload()).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Modifier' }));
  expect(unload()).toBe(true);
});

it('ne demande rien pour une navigation lancée par la page après une action', async () => {
  renderForm({ initialDirty: true });
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
  expect(await screen.findByRole('heading', { name: 'Ailleurs' })).toBeInTheDocument();
  expect(dialog()).toBeNull();
});

it('ne bloque pas un changement de paramètres sur la même page', async () => {
  const { router } = renderForm({ initialDirty: true });
  await userEvent.click(screen.getByRole('link', { name: 'Même page' }));
  await waitFor(() => expect(router.state.location.search).toBe('?onglet=2'));
  expect(dialog()).toBeNull();
});

it('consulte toutes les gardes de la page, même imbriquées', async () => {
  function Nested() {
    const [dirty, setDirty] = useState(false);
    const { prompt } = useLeaveGuard({ dirty });
    return <><button type="button" onClick={() => setDirty(true)}>Modifier la fenêtre</button>{prompt}</>;
  }
  function Outer() {
    const { prompt } = useLeaveGuard({ dirty: false, trySave: async () => true });
    return <><Nested /><Link to="/ailleurs">Ailleurs</Link>{prompt}</>;
  }
  const { router } = renderWithRouter([{ path: '/form', element: <Outer /> }, { path: '/ailleurs', element: <h1>Ailleurs</h1> }], { initialEntries: ['/form'] });
  await userEvent.click(screen.getByRole('button', { name: 'Modifier la fenêtre' }));
  await userEvent.click(screen.getByRole('link', { name: 'Ailleurs' }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(router.state.location.pathname).toBe('/form');
});
