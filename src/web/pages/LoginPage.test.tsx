// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { social } = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock('../auth-client', () => ({ authClient: { signIn: { social } } }));

import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('affiche l’accroche, le bouton Google et l’avertissement d’invitation', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Du devis signé à la facture payée, sans ressaisir une ligne.' })).toBeInTheDocument();
    expect(screen.getByText(/Accès sur invitation/)).toBeInTheDocument();
  });

  it('lance la connexion Google avec les bonnes redirections', async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /Continuer avec Google/ }));
    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/', errorCallbackURL: '/acces-refuse' });
  });
});
