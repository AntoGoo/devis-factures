// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DocumentToolbar } from './DocumentToolbar';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Preview() {
  return <p>Aperçu ouvert{useLocation().search}</p>;
}

function renderToolbar(beforeOpen?: () => Promise<void>, label?: string) {
  return render(
    <MemoryRouter initialEntries={['/devis/q1']}>
      <Routes>
        <Route path="/devis/q1" element={<DocumentToolbar printPath="/imprimer/devis/q1" beforeOpen={beforeOpen} label={label} />} />
        <Route path="/imprimer/devis/q1" element={<Preview />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocumentToolbar', () => {
  it('attend la fin de beforeOpen avant de naviguer vers l’aperçu', async () => {
    const d = deferred<void>();
    renderToolbar(() => d.promise);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /Aperçu et PDF/ });

    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.queryByText(/Aperçu ouvert/)).not.toBeInTheDocument();

    d.resolve();
    expect(await screen.findByText('Aperçu ouvert?auto=1')).toBeInTheDocument();
  });

  it('en lien d’aperçu (label), attend aussi beforeOpen puis ouvre l’aperçu sans impression automatique', async () => {
    const d = deferred<void>();
    renderToolbar(() => d.promise, 'Voir l’aperçu');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Voir l’aperçu' }));
    expect(screen.queryByText(/Aperçu ouvert/)).not.toBeInTheDocument();

    d.resolve();
    expect(await screen.findByText('Aperçu ouvert')).toBeInTheDocument();
  });

  it('ne navigue pas et affiche une alerte quand beforeOpen échoue', async () => {
    const beforeOpen = vi.fn(async () => { throw new Error('Échec réseau'); });
    renderToolbar(beforeOpen);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Aperçu et PDF/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enregistrement impossible : Échec réseau. L’aperçu n’a pas été ouvert.');
    expect(screen.queryByText(/Aperçu ouvert/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aperçu et PDF/ })).not.toBeDisabled();
  });
});
