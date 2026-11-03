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
