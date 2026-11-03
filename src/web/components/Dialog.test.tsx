// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

it('Échap ne ferme que la fenêtre ouverte en dernier, affichée au-dessus', () => {
  const closeFirst = vi.fn();
  const closeSecond = vi.fn();
  render(
    <>
      <Dialog open title="Nouveau client" onClose={closeFirst}>a</Dialog>
      <Dialog open title="Quitter la page ?" onClose={closeSecond}>b</Dialog>
    </>,
  );
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(closeSecond).toHaveBeenCalledTimes(1);
  expect(closeFirst).not.toHaveBeenCalled();
  const z = (name: string) => Number((screen.getByRole('dialog', { name }).parentElement as HTMLElement).style.zIndex);
  expect(z('Quitter la page ?')).toBeGreaterThan(z('Nouveau client'));
});
