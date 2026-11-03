import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { DashboardData, InvoiceResponse, QuoteResponse } from '../../shared/api-types';
import { formatDateShort } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { formatDashboardDate } from './dashboardDate';

type Filter = 'all' | 'quotes' | 'invoices';

export function DashboardPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const data = useQuery({ queryKey: ['dashboard', filter], queryFn: () => api<DashboardData>('GET', `/api/dashboard?filter=${filter}`) });
  const newQuote = useMutation({ mutationFn: () => api<QuoteResponse>('POST', '/api/quotes', {}), onSuccess: (r) => navigate(`/devis/${r.quote.id}`) });
  const newInvoice = useMutation({ mutationFn: () => api<InvoiceResponse>('POST', '/api/invoices/standalone', {}), onSuccess: (r) => navigate(`/factures/${r.invoice.id}`) });
  const d = data.data;
  const error = data.error ?? newQuote.error ?? newInvoice.error;

  return (
    <div className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 15, color: 'var(--c-text-muted)' }}>{d ? formatDashboardDate(d.today) : ''}</span>
          <h1 className="page-title" style={{ fontSize: 38 }}>Bonjour {d?.greetingName}</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => newInvoice.mutate()} disabled={newInvoice.isPending}>Facture sans devis</button>
          <button type="button" className="btn btn-primary" onClick={() => newQuote.mutate()} disabled={newQuote.isPending}>+ Nouveau devis</button>
        </div>
      </div>
      {error && <p className="notice notice-error" role="alert">{error.message}</p>}

      {d && (
        <div className="kpis">
          <div className="kpi kpi--accent">
            <span className="kpi-label">Reste à encaisser</span>
            <span className="kpi-value">{formatEuros(d.outstanding.totalCents)}</span>
            {d.outstanding.lateCents > 0 && <span className="kpi-late">dont {formatEuros(d.outstanding.lateCents)} en retard</span>}
          </div>
          <div className="kpi">
            <span className="kpi-label">Devis en attente de réponse</span>
            <span className="kpi-value">{d.pendingQuotes.count}</span>
            <span className="kpi-sub">pour {formatEuros(d.pendingQuotes.totalCents)} au total</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Encaissé en {d.collectedThisMonth.monthLabel}</span>
            <span className="kpi-value">{formatEuros(d.collectedThisMonth.totalCents)}</span>
            <span className="kpi-sub">{d.collectedThisMonth.count} {d.collectedThisMonth.count > 1 ? 'factures payées' : 'facture payée'}</span>
          </div>
        </div>
      )}

      <section aria-labelledby="recents" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2 id="recents" className="card-title" style={{ fontSize: 22 }}>Documents récents</h2>
          <div role="group" aria-label="Filtrer" className="filters">
            {(['all', 'quotes', 'invoices'] as const).map((f) => (
              <button key={f} type="button" className={f === filter ? 'chip chip--on' : 'chip'} aria-pressed={f === filter} onClick={() => setFilter(f)}>
                {{ all: 'Tous', quotes: 'Devis', invoices: 'Factures' }[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="table-card">
          <table className="table" style={{ minWidth: 720 }}>
            <thead><tr><th scope="col">Numéro</th><th scope="col">Client</th><th scope="col">Date</th><th scope="col" className="num">Montant</th><th scope="col">Statut</th></tr></thead>
            <tbody>
              {d?.recent.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--c-text-muted)' }}>Aucun document pour l’instant. Commencez par un devis.</td></tr>}
              {d?.recent.map((r) => (
                <tr key={`${r.type}-${r.id}`} className="row-link" onClick={() => navigate(r.type === 'quote' ? `/devis/${r.id}` : `/factures/${r.id}`)}>
                  <td><div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><strong>{r.number ?? '—'}</strong><span className="field-hint" style={{ fontSize: 13 }}>{r.kindLabel}</span></div></td>
                  <td>{r.clientName ?? '—'}</td>
                  <td style={{ color: 'var(--c-text-muted)' }}>{r.date ? formatDateShort(r.date) : '—'}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{formatEuros(r.amountCents)}</td>
                  <td><StatusBadge {...r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
