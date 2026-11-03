import { describe, expect, it } from 'vitest';
import { blankDraft } from '../lines/lineDrafts';
import { invoiceActions, invoicePayload, type InvoiceFormState } from './invoiceForm';

const form: InvoiceFormState = {
  clientId: 'c1', object: 'Dépannage', interventionAddress: '', drafts: [{ ...blankDraft(), designation: 'A', unitPrice: '120' }],
  serviceDate: '2026-11-02', dueDate: '', notes: '',
};

describe('invoiceActions', () => {
  it('suit le statut et le paiement', () => {
    expect(invoiceActions({ kind: 'standalone', status: 'draft', paidAt: null })).toEqual(['issue', 'delete']);
    expect(invoiceActions({ kind: 'deposit', status: 'issued', paidAt: null })).toEqual(['pay', 'credit']);
    expect(invoiceActions({ kind: 'deposit', status: 'issued', paidAt: '2026-11-03' })).toEqual(['unpay', 'credit']);
    expect(invoiceActions({ kind: 'final', status: 'cancelled', paidAt: null })).toEqual([]);
    expect(invoiceActions({ kind: 'credit', status: 'issued', paidAt: null })).toEqual([]);
  });
});

describe('invoicePayload', () => {
  it('n’envoie que les champs modifiables du type', () => {
    expect(invoicePayload('deposit', form)).toEqual({ serviceDate: '2026-11-02', dueDate: null, notes: '' });
    expect(Object.keys(invoicePayload('final', form)!).sort()).toEqual(['dueDate', 'interventionAddress', 'lines', 'notes', 'object', 'serviceDate']);
    expect(invoicePayload('standalone', form)).toMatchObject({ clientId: 'c1', lines: [expect.objectContaining({ unitPriceCents: 12000 })] });
  });

  it('bloque l’envoi tant qu’une ligne est invalide', () => {
    expect(invoicePayload('standalone', { ...form, drafts: [{ ...blankDraft(), unitPrice: '1,234' }] })).toBeNull();
    expect(invoicePayload('deposit', { ...form, drafts: [{ ...blankDraft(), unitPrice: '1,234' }] })).not.toBeNull();
  });
});
