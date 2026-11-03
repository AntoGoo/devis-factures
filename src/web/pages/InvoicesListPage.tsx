import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { InvoiceListItem, InvoiceResponse } from '../../shared/api-types';
import { formatDateShort } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL, type InvoiceKind } from '../../shared/status';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

const FILTERS: { key: InvoiceKind | 'all'; label: string }[] = [
  { key: 'all', label: 'Toutes' }, { key: 'deposit', label: 'Acomptes' }, { key: 'final', label: 'Soldes' },
  { key: 'standalone', label: 'Factures' }, { key: 'credit', label: 'Avoirs' },
];

export function InvoicesListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InvoiceKind | 'all'>('all');
  const list = useQuery({
    queryKey: ['invoices', filter],
    queryFn: () => api<{ items: InvoiceListItem[] }>('GET', filter === 'all' ? '/api/invoices' : `/api/invoices?kind=${filter}`),
  });
  const create = useMutation({
    mutationFn: () => api<InvoiceResponse>('POST', '/api/invoices/standalone', {}),
    onSuccess: (r) => navigate(`/factures/${r.invoice.id}`),
  });
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Factures</h1>
        <button type="button" className="btn btn-secondary" onClick={() => create.mutate()} disabled={create.isPending}>Facture sans devis</button>
      </div>
      {create.error && <p className="notice notice-error" role="alert">{create.error.message}</p>}
      <div role="group" aria-label="Filtrer" className="filters">
        {FILTERS.map((f) => <button key={f.key} type="button" className={f.key === filter ? 'chip chip--on' : 'chip'} aria-pressed={f.key === filter} onClick={() => setFilter(f.key)}>{f.label}</button>)}
      </div>
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Numéro</th><th scope="col">Client</th><th scope="col">Émission</th><th scope="col">Échéance</th><th scope="col" className="num">Montant</th><th scope="col">Statut</th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--c-text-muted)' }}>Aucune facture.</td></tr>}
            {list.data?.items.map((i) => (
              <tr key={i.id} className="row-link" onClick={() => navigate(`/factures/${i.id}`)}>
                <td><strong>{i.number ?? '—'}</strong><div className="field-hint" style={{ fontSize: 13 }}>{INVOICE_KIND_LABEL[i.kind]}{i.status === 'draft' ? ' (brouillon)' : ''}</div></td>
                <td>{i.clientName ?? '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{i.issueDate ? formatDateShort(i.issueDate) : '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{i.dueDate ? formatDateShort(i.dueDate) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{formatEuros(i.amountDueCents)}</td>
                <td><StatusBadge {...INVOICE_DISPLAY[i.display]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
