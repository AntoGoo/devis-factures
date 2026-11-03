import { expect, it } from 'vitest';
import { QUOTE_STATUS } from './status';

it('libelle les statuts de devis en français', () => {
  expect(Object.values(QUOTE_STATUS).map((s) => s.label)).toEqual(['Brouillon', 'Envoyé', 'Accepté', 'Refusé']);
});
