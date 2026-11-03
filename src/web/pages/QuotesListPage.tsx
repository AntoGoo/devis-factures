import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { QuoteListItem, QuoteResponse } from '../../shared/api-types';
import { formatDateShort } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { QUOTE_STATUS, type QuoteStatus } from '../../shared/status';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

const FILTERS: { key: QuoteStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' }, { key: 'draft', label: 'Brouillons' }, { key: 'sent', label: 'Envoyés' },
  { key: 'accepted', label: 'Acceptés' }, { key: 'refused', label: 'Refusés' },
];

export function QuotesListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<QuoteStatus | 'all'>('all');
  const list = useQuery({
    queryKey: ['quotes', filter],
    queryFn: () => api<{ items: QuoteListItem[] }>('GET', filter === 'all' ? '/api/quotes' : `/api/quotes?status=${filter}`),
  });
  const create = useMutation({
    mutationFn: () => api<QuoteResponse>('POST', '/api/quotes', {}),
    onSuccess: (r) => navigate(`/devis/${r.quote.id}`),
  });
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Devis</h1>
        <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>+ Nouveau devis</button>
      </div>
      {create.error && <p className="notice notice-error" role="alert">{create.error.message}</p>}
      <div role="group" aria-label="Filtrer" className="filters">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={f.key === filter ? 'chip chip--on' : 'chip'} aria-pressed={f.key === filter} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Numéro</th><th scope="col">Client</th><th scope="col">Objet</th><th scope="col">Date</th><th scope="col" className="num">Montant</th><th scope="col">Statut</th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--c-text-muted)' }}>Aucun devis.</td></tr>}
            {list.data?.items.map((q) => (
              <tr key={q.id} className="row-link" onClick={() => navigate(`/devis/${q.id}`)}>
                <td><strong>{q.number ?? '—'}</strong>{!q.number && <div className="field-hint" style={{ fontSize: 13 }}>Devis (brouillon)</div>}</td>
                <td>{q.clientName ?? '—'}</td>
                <td>{q.object || '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{q.quoteDate ? formatDateShort(q.quoteDate) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{formatEuros(q.totalHtCents)}</td>
                <td><StatusBadge {...QUOTE_STATUS[q.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
