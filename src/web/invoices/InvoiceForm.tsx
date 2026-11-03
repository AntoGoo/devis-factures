import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { InvoiceResponse } from '../../shared/api-types';
import { computeBalance } from '../../shared/balance';
import { CLIENT_TYPE_LABEL, type ClientData } from '../../shared/client';
import { EDITABLE_FIELDS } from '../../shared/invoice';
import type { Totals } from '../../shared/lines';
import { api } from '../api';
import { ClientFormDialog } from '../components/ClientFormDialog';
import { liveTotals } from '../lines/lineDrafts';
import { LinesEditor } from '../lines/LinesEditor';
import { useAutosave } from '../lines/useAutosave';
import { useLeaveGuard } from '../navigation/useLeaveGuard';
import { initialInvoiceForm, invoicePayload, type InvoiceFormState } from './invoiceForm';

export function InvoiceForm({ initial, units, children }: {
  initial: InvoiceResponse; units: string[];
  children: (ctx: { flush: () => Promise<void>; saveState: string; payloadValid: boolean; totals: Totals }) => ReactNode;
}) {
  const inv = initial.invoice;
  const kind = inv.kind as Exclude<typeof inv.kind, 'credit'>;
  const allowed = EDITABLE_FIELDS[kind];
  const [form, setForm] = useState<InvoiceFormState>(() => initialInvoiceForm(inv));
  const [creatingClient, setCreatingClient] = useState(false);
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<{ items: ClientData[] }>('GET', '/api/clients'), enabled: allowed.includes('clientId') });
  const payload = invoicePayload(kind, form);
  const autosave = useAutosave(payload, async (p) => {
    if (!p) return;
    qc.setQueryData(['invoice', inv.id], await api<InvoiceResponse>('PUT', `/api/invoices/${inv.id}`, p));
  }, { enabled: payload !== null });
  // Quitter la page : une modification valide est enregistrée d’abord ; confirmation si invalide ou en échec.
  const { prompt } = useLeaveGuard({
    dirty: autosave.unsaved || autosave.state === 'pending' || autosave.state === 'saving' || autosave.state === 'error',
    trySave: async () => {
      if (payload === null) return false;
      try { await autosave.flush(); return true; } catch { return false; }
    },
  });
  const set = <K extends keyof InvoiceFormState>(k: K, v: InvoiceFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const saveState = { idle: '', pending: 'Modifications en attente…', saving: 'Enregistrement…', saved: 'Enregistré', error: `Échec de l’enregistrement : ${autosave.error?.message ?? ''}` }[autosave.state];

  // Les lignes ne sont éditées qu'aux types qui l'autorisent (voir EDITABLE_FIELDS) : sinon on garde le total du serveur, qui ne bouge pas dans ce formulaire.
  const totalHtCents = allowed.includes('lines') ? liveTotals(form.drafts).totalHtCents : inv.totalHtCents;
  const deposits = initial.view.deductions?.deposits ?? [];
  const totalDueCents = deposits.length > 0 ? computeBalance(totalHtCents, deposits).remainingCents : totalHtCents;
  const totals: Totals = { totalHtCents, vatCents: 0, totalDueCents };

  return (
    <>
      {children({ flush: autosave.flush, saveState, payloadValid: payload !== null, totals })}
      {(allowed.includes('clientId') || allowed.includes('object')) && (
        <section className="card form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <h2 className="card-title span-all">Client</h2>
          {allowed.includes('clientId') && (
            <label className="field">Client
              <select className="input" value={form.clientId ?? ''} onChange={(e) => (e.target.value === '__new__' ? setCreatingClient(true) : set('clientId', e.target.value || null))}>
                <option value="">Choisir un client…</option>
                {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({CLIENT_TYPE_LABEL[c.type]})</option>)}
                <option value="__new__">+ Nouveau client…</option>
              </select>
            </label>
          )}
          <label className="field">Adresse d’intervention<input className="input" value={form.interventionAddress} onChange={(e) => set('interventionAddress', e.target.value)} /></label>
          <label className="field span-all">Objet<input className="input" value={form.object} onChange={(e) => set('object', e.target.value)} /></label>
        </section>
      )}
      {allowed.includes('lines') && <LinesEditor drafts={form.drafts} onChange={(ds) => set('drafts', ds)} units={units} />}
      <section className="card form-grid">
        <h2 className="card-title span-all">Dates et mentions</h2>
        <label className="field">Date de la prestation<input className="input" type="date" value={form.serviceDate} onChange={(e) => set('serviceDate', e.target.value)} /></label>
        <label className="field"><span>Échéance <span className="field-hint">vide : délai du profil à partir de l’émission</span></span>
          <input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </label>
        <label className="field span-all">Mentions complémentaires<textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </section>
      {prompt}
      <ClientFormDialog open={creatingClient} onClose={() => setCreatingClient(false)} onSaved={(c) => { set('clientId', c.id); setCreatingClient(false); }} />
    </>
  );
}
