// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { blankDraft, type DraftLine } from './lineDrafts';
import { LinesEditor } from './LinesEditor';

const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ').replace(/−/g, '-');

function Editor({ initial }: { initial: DraftLine[] }) {
  const [drafts, setDrafts] = useState(initial);
  return <LinesEditor drafts={drafts} onChange={setDrafts} units={['u', 'h', 'forfait']} />;
}

// LinesEditor utilise TanStack Query (lignes types) : il lui faut un QueryClient.
const Harness = ({ initial }: { initial: DraftLine[] }) => (
  <QueryClientProvider client={new QueryClient()}><Editor initial={initial} /></QueryClientProvider>
);

const rows = () => screen.getAllByRole('row').slice(1); // sans l'en-tête

describe('LinesEditor', () => {
  it('affiche 5 lignes vides par défaut et le compteur', () => {
    render(<Harness initial={[1, 2, 3, 4, 5].map(() => blankDraft())} />);
    expect(rows()).toHaveLength(5);
    expect(screen.getByText('5 lignes')).toBeInTheDocument();
  });

  it('calcule le total de la ligne pendant la saisie', async () => {
    render(<Harness initial={[blankDraft()]} />);
    const row = rows()[0]!;
    await userEvent.type(within(row).getByLabelText('Désignation'), 'Prises 16 A');
    await userEvent.clear(within(row).getByLabelText('Quantité'));
    await userEvent.type(within(row).getByLabelText('Quantité'), '8');
    await userEvent.type(within(row).getByLabelText('Prix unitaire HT en euros'), '65');
    expect(plain(within(row).getByTestId('line-total').textContent)).toBe('520,00 €');
  });

  it('ajoute, supprime et réordonne des lignes', async () => {
    render(<Harness initial={[{ ...blankDraft(), designation: 'A' }, { ...blankDraft(), designation: 'B' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    expect(rows()).toHaveLength(3);
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Descendre la ligne' }));
    expect((within(rows()[0]!).getByLabelText('Désignation') as HTMLInputElement).value).toBe('B');
    await userEvent.click(within(rows()[2]!).getByRole('button', { name: 'Supprimer la ligne' }));
    expect(rows()).toHaveLength(2);
  });

  it('signale un prix invalide', async () => {
    render(<Harness initial={[blankDraft()]} />);
    const price = within(rows()[0]!).getByLabelText('Prix unitaire HT en euros');
    await userEvent.type(price, '12,345');
    expect(price).toHaveAttribute('aria-invalid', 'true');
  });
});
