import type { DocumentView } from './document';
import type { Series } from './numbering';
import type { QuoteDraftInput } from './quote';
import type { QuoteStatus } from './status';

export type MeResponse = {
  user: { id: string; email: string; name: string };
  isSuperadmin: boolean;
  onboarding: { templateRef: string | null; profileComplete: boolean };
  profileSummary: { ownerName: string; tradeName: string } | null;
};

export type NumberingInfo = {
  year: number;
  series: { series: Series; prefix: string; next: string; startEditable: boolean }[];
};

export type AdminEmailItem = {
  email: string;
  isSuperadmin: boolean;
  tradeName: string | null;
  lastLoginAt: string | null;
  addedAt: string | null;
};

export type QuoteDto = QuoteDraftInput & {
  id: string;
  number: string | null;
  status: QuoteStatus;
  quoteDate: string | null;
  acceptedAt: string | null;
  refusedAt: string | null;
  totalHtCents: number;
  updatedAt: string;
};

export type QuoteListItem = {
  id: string;
  number: string | null;
  status: QuoteStatus;
  clientName: string | null;
  object: string;
  totalHtCents: number;
  quoteDate: string | null;
  updatedAt: string;
};

export type QuoteResponse = { quote: QuoteDto; view: DocumentView };
