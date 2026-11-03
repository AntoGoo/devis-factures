import type { DocumentView } from './document';
import type { Line } from './lines';
import type { Series } from './numbering';
import type { QuoteDraftInput } from './quote';
import type { InvoiceDisplay, InvoiceKind, InvoiceStatus, QuoteStatus, Tone } from './status';

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

export type InvoiceDto = {
  id: string; kind: InvoiceKind; status: InvoiceStatus; number: string | null;
  quoteId: string | null; clientId: string | null; object: string; interventionAddress: string | null;
  lines: Line[]; depositBp: number | null; totalHtCents: number; amountDueCents: number;
  serviceDate: string | null; dueDate: string | null; notes: string;
  issueDate: string | null; paidAt: string | null; cancelledAt: string | null; updatedAt: string;
  display: InvoiceDisplay;
};

export type InvoiceListItem = {
  id: string; kind: InvoiceKind; status: InvoiceStatus; number: string | null; clientName: string | null;
  issueDate: string | null; dueDate: string | null; amountDueCents: number; paidAt: string | null;
  depositBp: number | null; quoteId: string | null; display: InvoiceDisplay;
};

type Link = { id: string; number: string | null } | null;
export type InvoiceLinks = { quote: Link; creditNote: Link; creditedInvoice: Link };
export type InvoiceResponse = { invoice: InvoiceDto; view: DocumentView; links: InvoiceLinks };

export type BillingSummary = {
  quote: {
    id: string;
    number: string;
    acceptedAt: string;
    clientName: string;
    object: string;
    totalCents: number;
    plannedDepositBp: number | null;
    lineCount: number;
  };
  invoices: InvoiceListItem[];
  invoicedDepositsCents: number;
  issuedDepositsCents: number;
  remainingToInvoiceCents: number;
  activeFinal: { id: string; status: InvoiceStatus } | null;
  draftDepositCount: number;
  canCreateDeposit: boolean;
  canPrepareFinal: boolean;
};

export type RecentDocument = {
  type: 'quote' | 'invoice';
  id: string;
  number: string | null;
  kindLabel: string;
  clientName: string | null;
  date: string | null;
  amountCents: number;
  status: { label: string; tone: Tone };
  updatedAt: string;
};

export type DashboardData = {
  today: string;
  greetingName: string;
  outstanding: { totalCents: number; lateCents: number };
  pendingQuotes: { count: number; totalCents: number };
  collectedThisMonth: { totalCents: number; count: number; monthLabel: string };
  recent: RecentDocument[];
};
