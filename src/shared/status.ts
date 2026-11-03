export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused';
export type Tone = 'draft' | 'wait' | 'late' | 'paid' | 'ok' | 'neutral';

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'draft' },
  sent: { label: 'Envoyé', tone: 'draft' },
  accepted: { label: 'Accepté', tone: 'ok' },
  refused: { label: 'Refusé', tone: 'late' },
};
