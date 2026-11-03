import { expect, it } from 'vitest';
import { buildDocumentView } from '../../shared/document';
import { CLIENT_BUSINESS_DATA, MOCKUP_LINES, PROFILE_DATA } from '../../shared/test-fixtures';
import { printTitle } from './printTitle';

const view = (number: string | null) => buildDocumentView({
  kind: 'standalone', number, date: '2026-11-03', templateRef: 'modele-01@1', profile: PROFILE_DATA,
  client: CLIENT_BUSINESS_DATA, object: '', interventionAddress: null, lines: MOCKUP_LINES,
});

it('nomme le fichier d’après le numéro et le client', () => {
  expect(printTitle(view('F-2026-004'))).toBe('F-2026-004 – SCI Les Tilleuls');
  expect(printTitle(view(null))).toBe('Facture (brouillon) – SCI Les Tilleuls');
});
