import { expect, it } from 'vitest';
import { quoteActions } from './quoteActions';

it('propose les actions permises par le statut', () => {
  expect(quoteActions('draft')).toEqual(['send', 'delete']);
  expect(quoteActions('sent')).toEqual(['accept', 'refuse']);
  expect(quoteActions('accepted')).toEqual(['duplicate']);
  expect(quoteActions('refused')).toEqual(['duplicate']);
});
