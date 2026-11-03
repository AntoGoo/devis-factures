// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DepositPanel } from './DepositPanel';

const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ').replace(/−/g, '-');

it('reprend la maquette et crée un acompte en montant fixe', async () => {
  const onCreate = vi.fn();
  render(<DepositPanel totalCents={400000} alreadyInvoicedCents={120000} defaultBp={2000} onCreate={onCreate} />);
  expect(plain(screen.getByTestId('deposit-amount').textContent)).toBe('800,00 €');
  expect(plain(screen.getByTestId('deposit-remaining').textContent)).toBe('2 000,00 €');
  await userEvent.click(screen.getByRole('radio', { name: 'Montant' }));
  const input = screen.getByLabelText('Montant HT');
  await userEvent.type(input, '3000');
  expect(screen.getByRole('alert')).toHaveTextContent('Dépasse');
  expect(screen.getByRole('button', { name: 'Créer la facture d’acompte' })).toBeDisabled();
  await userEvent.clear(input);
  await userEvent.type(input, '500');
  await userEvent.click(screen.getByRole('button', { name: 'Créer la facture d’acompte' }));
  expect(onCreate).toHaveBeenCalledWith({ mode: 'amount', cents: 50000 });
});

it('n’affiche que le titre, la raison et le bouton désactivé quand un acompte est impossible', () => {
  const onCreate = vi.fn();
  render(<DepositPanel totalCents={400000} alreadyInvoicedCents={120000} defaultBp={2000} disabledReason="Une facture de solde existe : plus d’acompte possible." onCreate={onCreate} />);
  expect(screen.getByRole('heading', { name: 'Nouvel acompte' })).toBeInTheDocument();
  expect(screen.getByText('Une facture de solde existe : plus d’acompte possible.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Créer la facture d’acompte' })).toBeDisabled();
  expect(screen.queryByText('Restera à facturer')).not.toBeInTheDocument();
  expect(screen.queryByTestId('deposit-amount')).not.toBeInTheDocument();
  expect(screen.queryByTestId('deposit-remaining')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Pourcentage du total')).not.toBeInTheDocument();
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
});
