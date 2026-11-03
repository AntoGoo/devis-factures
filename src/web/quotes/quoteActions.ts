import type { QuoteStatus } from '../../shared/status';

export type QuoteAction = 'send' | 'accept' | 'refuse' | 'duplicate' | 'delete';

export function quoteActions(status: QuoteStatus): QuoteAction[] {
  switch (status) {
    case 'draft': return ['send', 'delete'];
    case 'sent': return ['accept', 'refuse'];
    case 'accepted':
    case 'refused': return ['duplicate'];
  }
}
