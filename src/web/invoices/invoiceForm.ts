import type { InvoiceDto } from '../../shared/api-types';
import { EDITABLE_FIELDS, type InvoiceDraftInput } from '../../shared/invoice';
import type { InvoiceKind, InvoiceStatus } from '../../shared/status';
import { draftFromLine, draftsToLines, type DraftLine } from '../lines/lineDrafts';

export type InvoiceAction = 'issue' | 'delete' | 'pay' | 'unpay' | 'credit';

export function invoiceActions(i: { kind: InvoiceKind; status: InvoiceStatus; paidAt: string | null }): InvoiceAction[] {
  if (i.status === 'draft') return ['issue', 'delete'];
  if (i.kind === 'credit' || i.status === 'cancelled') return [];
  return [i.paidAt ? 'unpay' : 'pay', 'credit'];
}

export type InvoiceFormState = {
  clientId: string | null; object: string; interventionAddress: string; drafts: DraftLine[];
  serviceDate: string; dueDate: string; notes: string;
};

export function initialInvoiceForm(inv: InvoiceDto): InvoiceFormState {
  return {
    clientId: inv.clientId, object: inv.object, interventionAddress: inv.interventionAddress ?? '',
    drafts: inv.lines.map(draftFromLine), serviceDate: inv.serviceDate ?? '', dueDate: inv.dueDate ?? '', notes: inv.notes,
  };
}

export function invoicePayload(kind: Exclude<InvoiceKind, 'credit'>, f: InvoiceFormState): InvoiceDraftInput | null {
  const allowed = EDITABLE_FIELDS[kind];
  const { lines, valid } = draftsToLines(f.drafts);
  if (allowed.includes('lines') && !valid) return null;
  const all: InvoiceDraftInput = {
    clientId: f.clientId, object: f.object, interventionAddress: f.interventionAddress.trim() || null, lines,
    serviceDate: f.serviceDate || null, dueDate: f.dueDate || null, notes: f.notes,
  };
  return Object.fromEntries(allowed.map((k) => [k, all[k]])) as InvoiceDraftInput;
}
