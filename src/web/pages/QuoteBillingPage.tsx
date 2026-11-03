import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { BillingSummary, InvoiceListItem, InvoiceResponse } from '../../shared/api-types';
import { formatDateShort, todayInParis } from '../../shared/dates';
import type { DepositInput } from '../../shared/deposits';
import { formatEuros, formatPercent } from '../../shared/money';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL } from '../../shared/status';
import { api } from '../api';
import { DepositPanel } from '../billing/DepositPanel';
import { DocumentToolbar } from '../components/DocumentToolbar';
import { StatusBadge } from '../components/StatusBadge';
import './QuoteBillingPage.css';

function subtitle(i: InvoiceListItem): string {
  if (i.status === 'draft') return 'Brouillon : numéro attribué à l’émission';
  if (i.kind === 'credit') return `Émis le ${formatDateShort(i.issueDate!)}`;
  if (i.status === 'cancelled') return 'Annulée par avoir';
  return `Émise le ${formatDateShort(i.issueDate!)} · échéance ${formatDateShort(i.dueDate!)}`;
}

export function QuoteBillingPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: ['billing', id], queryFn: () => api<BillingSummary>('GET', `/api/quotes/${id}/billing`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['billing', id] });
  const createDeposit = useMutation({
    mutationFn: (input: DepositInput) => api<InvoiceResponse>('POST', `/api/quotes/${id}/deposits`, input),
    onSuccess: (r) => navigate(`/factures/${r.invoice.id}`),
  });
  const prepareFinal = useMutation({
    mutationFn: () => api<InvoiceResponse>('POST', `/api/quotes/${id}/final`),
    onSuccess: (r) => navigate(`/factures/${r.invoice.id}`),
  });
  const markPaid = useMutation({
    mutationFn: (invoiceId: string) => api('PUT', `/api/invoices/${invoiceId}/payment`, { paidAt: todayInParis(new Date()) }),
    onSuccess: refresh,
  });

  if (billing.isPending) return <p className="page-intro">Chargement…</p>;
  if (billing.error) return <p className="notice notice-error" role="alert">{billing.error.message}</p>;
  const b = billing.data;
  const pct = b.quote.totalCents > 0 ? Math.min(100, Math.round((b.invoicedDepositsCents / b.quote.totalCents) * 100)) : 0;
  const issuedDeposits = b.invoices.filter((i) => i.kind === 'deposit' && i.status === 'issued').map((i) => i.number);
  const error = createDeposit.error ?? prepareFinal.error ?? markPaid.error;

  return (
    <div className="page">
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="actions" style={{ alignItems: 'center' }}>
            <h1 className="page-title" style={{ fontSize: 32 }}>{b.quote.number}</h1>
            <span className="badge tone-ok">Accepté le {formatDateShort(todayInParis(new Date(b.quote.acceptedAt)))}</span>
          </div>
          <p className="page-intro">{b.quote.clientName} · {b.quote.object}</p>
        </div>
        <DocumentToolbar printPath={`/imprimer/devis/${id}`} label="Voir le devis figé" />
      </div>
      {error && <p className="notice notice-error" role="alert">{error.message}</p>}

      <section className="card" aria-labelledby="h-prog" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
        <h2 id="h-prog" className="card-title">Où en est la facturation</h2>
        <div role="img" aria-label={`${formatEuros(b.invoicedDepositsCents)} facturés en acomptes sur ${formatEuros(b.quote.totalCents)}, soit ${pct} %`} className="progress"><div style={{ width: `${pct}%` }} /></div>
        <div className="figures">
          <div><span>Total du devis</span><strong>{formatEuros(b.quote.totalCents)}</strong></div>
          <div><span>Déjà facturé en acomptes</span><strong className="figure-accent">{formatEuros(b.invoicedDepositsCents)}</strong></div>
          <div><span>Reste à facturer</span><strong>{formatEuros(b.remainingToInvoiceCents)}</strong></div>
        </div>
      </section>

      <div className="editor">
        <section aria-labelledby="h-docs" className="editor-main" style={{ gap: 12 }}>
          <h2 id="h-docs" className="card-title">Factures liées</h2>
          {b.invoices.map((i) => (
            <article key={i.id} className={i.status === 'draft' ? 'bill-card bill-card--draft' : 'bill-card'}>
              <div className="bill-icon" aria-hidden="true">{i.kind === 'deposit' && i.depositBp ? formatPercent(i.depositBp) : '▤'}</div>
              <div className="bill-main">
                <span className="bill-title">{i.number ? `${i.number} · ` : ''}{INVOICE_KIND_LABEL[i.kind]}</span>
                <span className="bill-sub">{subtitle(i)}</span>
              </div>
              <span className="bill-amount">{formatEuros(i.amountDueCents)}</span>
              <StatusBadge {...INVOICE_DISPLAY[i.display]} />
              {(i.display === 'to_pay' || i.display === 'late') && (
                <button type="button" className="btn btn-secondary" style={{ height: 40 }} onClick={() => markPaid.mutate(i.id)}>Marquer payée</button>
              )}
              <Link className="btn btn-secondary" style={{ height: 40 }} to={`/factures/${i.id}`}>Ouvrir</Link>
            </article>
          ))}
          {!b.activeFinal && (
            <article className="bill-card bill-card--draft">
              <div className="bill-icon" aria-hidden="true">▤</div>
              <div className="bill-main">
                <span className="bill-title">Facture de solde</span>
                <span className="bill-sub">
                  Reprend les {b.quote.lineCount} lignes du devis{issuedDeposits.length > 0 ? ` et déduit ${issuedDeposits.length > 1 ? 'les acomptes' : 'l’acompte'} ${issuedDeposits.join(', ')}` : ''}.
                </span>
              </div>
              <span className="bill-amount">{formatEuros(b.quote.totalCents - b.issuedDepositsCents)}</span>
              <button type="button" className="btn btn-primary" style={{ height: 40 }} disabled={!b.canPrepareFinal || prepareFinal.isPending}
                title={b.draftDepositCount > 0 ? 'Émettez ou supprimez d’abord l’acompte en brouillon.' : undefined} onClick={() => prepareFinal.mutate()}>
                Préparer le solde
              </button>
            </article>
          )}
        </section>
        <div className="editor-aside">
          <DepositPanel
            totalCents={b.quote.totalCents}
            alreadyInvoicedCents={b.invoicedDepositsCents}
            defaultBp={b.quote.plannedDepositBp}
            disabledReason={b.activeFinal ? 'Une facture de solde existe : plus d’acompte possible.' : null}
            pending={createDeposit.isPending}
            onCreate={(input) => createDeposit.mutate(input)}
          />
        </div>
      </div>
    </div>
  );
}
