// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { QuoteResponse } from '../../shared/api-types';
import { buildDocumentView } from '../../shared/document';
import { blankLines } from '../../shared/lines';
import { CLIENT_BUSINESS_DATA, PROFILE_DATA } from '../../shared/test-fixtures';
import { renderWithRouter } from '../test-utils';
import { QuoteEditorPage } from './QuoteEditorPage';

afterEach(() => vi.unstubAllGlobals());

const quote: QuoteResponse = {
  quote: {
    id: 'q1', number: null, status: 'draft', quoteDate: null, acceptedAt: null, refusedAt: null, totalHtCents: 0, updatedAt: '2026-01-01T00:00:00.000Z',
    clientId: CLIENT_BUSINESS_DATA.id, object: '', interventionAddress: null, lines: blankLines(5), validityDays: 30,
    plannedStart: '', estimatedDuration: '', paymentTerms: '', plannedDepositBp: null,
  },
  view: buildDocumentView({
    kind: 'quote', number: null, date: null, templateRef: 'modele-01@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
    object: '', interventionAddress: null, lines: blankLines(5),
  }),
};

function stubApi({ putStatus = 200 } = {}) {
  const puts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/profile') return Response.json({ profile: PROFILE_DATA });
    if (url === '/api/clients') return Response.json({ items: [CLIENT_BUSINESS_DATA] });
    if (url === '/api/quotes/q1' && (init?.method ?? 'GET') === 'GET') return Response.json(quote);
    if (url === '/api/quotes/q1' && init?.method === 'PUT') {
      puts.push(init.body ? JSON.parse(String(init.body)) : undefined);
      return putStatus === 200 ? Response.json(quote) : Response.json({ error: 'internal', message: 'Panne' }, { status: putStatus });
    }
    return Response.json({});
  }));
  return puts;
}

function renderPage() {
  return renderWithRouter([
    { path: '/devis/:id', element: <QuoteEditorPage /> },
    { path: '/devis', element: <h1>Liste des devis</h1> },
  ], { initialEntries: ['/devis/q1'] });
}

it('bloque les actions de statut tant qu’un champ du devis est invalide, avec une indication', async () => {
  stubApi();
  renderPage();

  const sendButton = await screen.findByRole('button', { name: 'Marquer comme envoyé' });
  expect(sendButton).toBeEnabled();
  expect(screen.queryByText('Corrigez les champs en rouge avant de continuer.')).not.toBeInTheDocument();

  const rows = screen.getAllByRole('row').slice(1);
  const price = within(rows[0]!).getByLabelText('Prix unitaire HT en euros');
  await userEvent.type(price, '12,345'); // plus de 2 décimales : invalide

  expect(sendButton).toBeDisabled();
  expect(screen.getByText('Corrigez les champs en rouge avant de continuer.')).toBeInTheDocument();

  // Le bouton « Supprimer le brouillon » n’est pas concerné par la validité du formulaire.
  expect(screen.getByRole('button', { name: 'Supprimer le brouillon' })).toBeEnabled();
});

it('propose un lien de retour vers la liste des devis', async () => {
  stubApi();
  renderPage();
  expect(await screen.findByRole('link', { name: '← Devis' })).toHaveAttribute('href', '/devis');
});

it('enregistre une modification valide avant de quitter, sans rien demander', async () => {
  const puts = stubApi();
  renderPage();
  await userEvent.type(await screen.findByLabelText('Objet'), 'Cuisine');
  await userEvent.click(screen.getByRole('link', { name: '← Devis' }));
  expect(await screen.findByRole('heading', { name: 'Liste des devis' })).toBeInTheDocument();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ object: 'Cuisine' });
  expect(screen.queryByRole('dialog', { name: 'Quitter la page ?' })).not.toBeInTheDocument();
});

it('demande confirmation avant de quitter quand l’enregistrement échoue', async () => {
  const puts = stubApi({ putStatus: 500 });
  const { router } = renderPage();
  await userEvent.type(await screen.findByLabelText('Objet'), 'Cuisine');
  await userEvent.click(screen.getByRole('link', { name: '← Devis' }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
  expect(puts.length).toBeGreaterThan(0);
  expect(router.state.location.pathname).toBe('/devis/q1');
});

it('demande confirmation avant de quitter quand un champ est invalide', async () => {
  const puts = stubApi();
  renderPage();
  await screen.findByRole('button', { name: 'Marquer comme envoyé' });
  const price = within(screen.getAllByRole('row')[1]!).getByLabelText('Prix unitaire HT en euros');
  await userEvent.type(price, '12,345');
  await userEvent.click(screen.getByRole('link', { name: '← Devis' }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la page ?' })).toBeInTheDocument();
  expect(puts).toHaveLength(0);
});

it('ne demande rien après la suppression du brouillon, même avec un champ invalide', async () => {
  stubApi();
  vi.stubGlobal('confirm', vi.fn(() => true));
  renderPage();
  await screen.findByRole('button', { name: 'Marquer comme envoyé' });
  await userEvent.type(within(screen.getAllByRole('row')[1]!).getByLabelText('Prix unitaire HT en euros'), '12,345');
  await userEvent.click(screen.getByRole('button', { name: 'Supprimer le brouillon' }));
  expect(await screen.findByRole('heading', { name: 'Liste des devis' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quitter la page ?' })).not.toBeInTheDocument());
});
