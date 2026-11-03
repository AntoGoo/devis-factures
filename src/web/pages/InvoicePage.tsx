import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { InvoiceResponse } from '../../shared/api-types';
import { formatDateShort, todayInParis } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { DEFAULT_UNITS } from '../../shared/profile';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL } from '../../shared/status';
import { getTemplate } from '../../templates/registry';
import { api } from '../api';
import { Dialog } from '../components/Dialog';
import { DocumentToolbar } from '../components/DocumentToolbar';
import { StatusBadge } from '../components/StatusBadge';
import { DocumentRenderer } from '../document/DocumentRenderer';
import { useTemplateFonts } from '../document/useTemplateFonts';
import { InvoiceForm } from '../invoices/InvoiceForm';
import { invoiceActions, type InvoiceAction } from '../invoices/invoiceForm';
import { useProfile } from '../profile/useProfile';

export function InvoicePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const res = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceResponse>('GET', `/api/invoices/${id}`) });
  const units = useProfile().data?.profile?.units ?? DEFAULT_UNITS;
  useTemplateFonts(res.data ? getTemplate(res.data.view.templateRef).fontsHref : '');
  const [dialog, setDialog] = useState<null | 'issue' | 'pay' | 'credit'>(null);
  const [paidAt, setPaidAt] = useState(todayInParis(new Date()));

  const act = useMutation({
    mutationFn: async ({ action, flush }: { action: InvoiceAction; flush?: () => Promise<void> }) => {
      if (flush) await flush();
      switch (action) {
        case 'issue': return api<InvoiceResponse>('POST', `/api/invoices/${id}/issue`);
        case 'delete': return api<void>('DELETE', `/api/invoices/${id}`);
        case 'pay': return api<InvoiceResponse>('PUT', `/api/invoices/${id}/payment`, { paidAt });
        case 'unpay': return api<InvoiceResponse>('PUT', `/api/invoices/${id}/payment`, { paidAt: null });
        case 'credit': return api<InvoiceResponse>('POST', `/api/invoices/${id}/credit-note`);
      }
    },
    onSuccess: (r, { action }) => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['billing'] });
      if (action === 'delete') return navigate('/factures');
      if (action === 'credit' && r) return navigate(`/factures/${(r as InvoiceResponse).invoice.id}`);
      if (r) qc.setQueryData(['invoice', id], r);
    },
  });

  const openDialog = (d: 'issue' | 'pay' | 'credit') => { act.reset(); setDialog(d); };
  // Un refus du serveur s’affiche dans la boîte ouverte (sinon il resterait caché derrière elle).
  const dialogError = act.error && <p className="notice notice-error" role="alert">{act.error.message}</p>;

  if (res.isPending) return <p className="page-intro">Chargement…</p>;
  if (res.error) return <p className="notice notice-error" role="alert">{res.error.message}</p>;
  const { invoice: inv, view, links } = res.data;
  const display = INVOICE_DISPLAY[inv.display];
  const title = inv.number ? `${inv.number} · ${view.title}` : `${INVOICE_KIND_LABEL[inv.kind]} (brouillon)`;

  const header = (flush?: () => Promise<void>, saveState = '', payloadValid = true) => {
    const actions = invoiceActions(inv);
    const blocked = !payloadValid && actions.includes('issue');
    return (
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="actions" style={{ alignItems: 'center' }}>
          <h1 className="page-title" style={{ fontSize: 30 }}>{title}</h1>
          <StatusBadge tone={display.tone} label={inv.status === 'draft' ? 'Brouillon · numéro attribué à l’émission' : display.label} />
          {saveState && <span className="field-hint" role="status">{saveState}</span>}
        </div>
        <div className="actions" style={{ alignItems: 'center' }}>
          <DocumentToolbar printPath={`/imprimer/factures/${inv.id}`} beforeOpen={flush} />
          {actions.map((a) => {
            const label = { issue: 'Émettre la facture', delete: 'Supprimer le brouillon', pay: 'Marquer payée', unpay: 'Annuler le paiement', credit: 'Créer un avoir' }[a];
            const disabled = act.isPending || (a === 'issue' && !payloadValid);
            const onClick = () => {
              if (a === 'issue' || a === 'pay' || a === 'credit') return openDialog(a);
              if (a === 'delete' && !window.confirm('Supprimer ce brouillon ?')) return;
              act.mutate({ action: a, flush });
            };
            return (
              <button key={a} type="button" className={a === 'issue' || a === 'pay' ? 'btn btn-primary' : a === 'delete' ? 'btn btn-danger' : 'btn btn-secondary'} onClick={onClick} disabled={disabled}>
                {label}
              </button>
            );
          })}
          {blocked && <span className="field-hint" role="status">Corrigez les champs en rouge avant de continuer.</span>}
        </div>
      </div>
    );
  };

  const notices = (
    <>
      {dialog === null && dialogError}
      {links.quote && <p className="notice">Issue du devis <Link to={`/devis/${links.quote.id}`}>{links.quote.number}</Link>{inv.kind !== 'standalone' && <> · <Link to={`/devis/${links.quote.id}/facturation`}>suivi de la facturation</Link></>}</p>}
      {links.creditNote && <p className="notice notice-error">Annulée par l’avoir <Link to={`/factures/${links.creditNote.id}`}>{links.creditNote.number}</Link>.</p>}
      {links.creditedInvoice && <p className="notice">Avoir de la facture <Link to={`/factures/${links.creditedInvoice.id}`}>{links.creditedInvoice.number}</Link>.</p>}
      {inv.paidAt && <p className="notice">Payée le {formatDateShort(inv.paidAt)}.</p>}
    </>
  );

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      {inv.status === 'draft' && inv.kind !== 'credit' ? (
        <InvoiceForm key={inv.id} initial={res.data} units={units}>
          {({ flush, saveState, payloadValid, totals }) => (
            <>
              {header(flush, saveState, payloadValid)}
              {notices}
              <div className="summary" style={{ maxWidth: 420 }}>
                <div className="summary-row"><span>Total HT</span><span>{formatEuros(totals.totalHtCents)}</span></div>
                <div className="summary-vat">{view.vatMention}</div>
                {view.deductions?.deposits.map((d) => (
                  <div key={d.invoiceId} className="summary-row"><span>Acompte {d.number}</span><span>{formatEuros(-d.amountCents)}</span></div>
                ))}
                <div className="summary-rule" />
                <div className="summary-due"><span>{view.dueLabel}</span><strong>{formatEuros(totals.totalDueCents)}</strong></div>
              </div>
              <Dialog open={dialog === 'issue'} title="Émettre la facture" onClose={() => setDialog(null)}>
                <p className="page-intro">Une fois émise, la facture reçoit son numéro définitif et ne peut plus être modifiée ni supprimée. Une erreur se corrige ensuite par un avoir.</p>
                {!payloadValid && <p className="field-hint" role="status">Corrigez les champs en rouge avant de continuer.</p>}
                {dialogError}
                <div className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Annuler</button>
                  <button type="button" className="btn btn-primary" disabled={act.isPending || !payloadValid} onClick={() => act.mutate({ action: 'issue', flush })}>Émettre la facture</button>
                </div>
              </Dialog>
            </>
          )}
        </InvoiceForm>
      ) : (
        <>
          {header()}
          {notices}
          <div className="doc-sheet"><DocumentRenderer view={view} template={getTemplate(view.templateRef)} /></div>
        </>
      )}
      <Dialog open={dialog === 'pay'} title="Marquer la facture payée" onClose={() => setDialog(null)}>
        <label className="field">Date du paiement<input className="input" type="date" max={todayInParis(new Date())} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></label>
        {dialogError}
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'pay' })}>Enregistrer le paiement</button>
        </div>
      </Dialog>
      <Dialog open={dialog === 'credit'} title="Créer un avoir" onClose={() => setDialog(null)}>
        <p className="page-intro">L’avoir annule entièrement la facture {inv.number}. Il reçoit son propre numéro et ne peut pas être supprimé. Vous pourrez ensuite émettre une facture corrigée.</p>
        {dialogError}
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'credit' })}>Créer l’avoir</button>
        </div>
      </Dialog>
    </div>
  );
}
