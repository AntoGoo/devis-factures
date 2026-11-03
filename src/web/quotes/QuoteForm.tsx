import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { QuoteResponse } from '../../shared/api-types';
import { CLIENT_TYPE_LABEL, type ClientData } from '../../shared/client';
import { depositAmountCents } from '../../shared/deposits';
import { formatEuros, formatPercent, parsePercent } from '../../shared/money';
import type { QuoteDraftInput } from '../../shared/quote';
import { api } from '../api';
import { ClientFormDialog } from '../components/ClientFormDialog';
import { DocumentToolbar } from '../components/DocumentToolbar';
import { draftFromLine, draftsToLines, liveTotals, type DraftLine } from '../lines/lineDrafts';
import { LinesEditor } from '../lines/LinesEditor';
import { useAutosave } from '../lines/useAutosave';

type FormState = {
  clientId: string | null; object: string; interventionAddress: string; drafts: DraftLine[];
  validityDays: string; plannedStart: string; estimatedDuration: string; paymentTerms: string; plannedDeposit: string;
};

export function initialForm(r: QuoteResponse): FormState {
  const q = r.quote;
  return {
    clientId: q.clientId, object: q.object, interventionAddress: q.interventionAddress ?? '',
    drafts: q.lines.map(draftFromLine), validityDays: String(q.validityDays), plannedStart: q.plannedStart,
    estimatedDuration: q.estimatedDuration, paymentTerms: q.paymentTerms,
    plannedDeposit: q.plannedDepositBp ? formatPercent(q.plannedDepositBp).replace(/\s?%$/, '').replace(/[  ]/g, '') : '',
  };
}

export function toPayload(f: FormState): QuoteDraftInput | null {
  const { lines, valid } = draftsToLines(f.drafts);
  const validityDays = Number.parseInt(f.validityDays, 10);
  const plannedDepositBp = f.plannedDeposit.trim() === '' ? null : parsePercent(f.plannedDeposit);
  if (!valid || !Number.isInteger(validityDays) || validityDays < 1 || (f.plannedDeposit.trim() !== '' && plannedDepositBp === null)) return null;
  return {
    clientId: f.clientId, object: f.object, interventionAddress: f.interventionAddress.trim() || null, lines, validityDays,
    plannedStart: f.plannedStart, estimatedDuration: f.estimatedDuration, paymentTerms: f.paymentTerms, plannedDepositBp,
  };
}

export function QuoteForm({ initial, units, templateName, onSaved, children }: {
  initial: QuoteResponse; units: string[]; templateName: string;
  onSaved: (r: QuoteResponse) => void;
  children: (ctx: { flush: () => Promise<void>; saveState: string; payloadValid: boolean }) => ReactNode;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [creatingClient, setCreatingClient] = useState(false);
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<{ items: ClientData[] }>('GET', '/api/clients') });
  const payload = toPayload(form);
  const autosave = useAutosave(payload, async (p) => {
    if (!p) return;
    const r = await api<QuoteResponse>('PUT', `/api/quotes/${initial.quote.id}`, p);
    qc.setQueryData(['quote', initial.quote.id], r);
    onSaved(r);
  }, { enabled: payload !== null });
  const totals = liveTotals(form.drafts);
  const depositBp = parsePercent(form.plannedDeposit);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const saveLabel = { idle: '', pending: 'Modifications en attente…', saving: 'Enregistrement…', saved: 'Enregistré', error: `Échec de l’enregistrement : ${autosave.error?.message ?? ''}` }[autosave.state];

  return (
    <>
      {children({ flush: autosave.flush, saveState: saveLabel, payloadValid: payload !== null })}
      <div className="editor editor--lines">
        <div className="editor-main">
          <section className="card form-grid" aria-labelledby="h-client" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <h2 id="h-client" className="card-title span-all">Client</h2>
            <label className="field">Client
              <select className="input" value={form.clientId ?? ''} onChange={(e) => (e.target.value === '__new__' ? setCreatingClient(true) : set('clientId', e.target.value || null))}>
                <option value="">Choisir un client…</option>
                {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({CLIENT_TYPE_LABEL[c.type]})</option>)}
                <option value="__new__">+ Nouveau client…</option>
              </select>
            </label>
            <label className="field"><span>Adresse d’intervention <span className="field-hint">si différente de l’adresse de facturation</span></span>
              <input className="input" value={form.interventionAddress} onChange={(e) => set('interventionAddress', e.target.value)} />
            </label>
            <label className="field span-all">Objet
              <input className="input" value={form.object} onChange={(e) => set('object', e.target.value)} />
            </label>
          </section>

          <LinesEditor drafts={form.drafts} onChange={(ds) => set('drafts', ds)} units={units} />

          <section className="card form-grid" aria-labelledby="h-mod" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <h2 id="h-mod" className="card-title span-all">Modalités</h2>
            <label className="field">Validité (jours)<input className="input" inputMode="numeric" value={form.validityDays} onChange={(e) => set('validityDays', e.target.value)} /></label>
            <label className="field">Début prévisionnel<input className="input" value={form.plannedStart} onChange={(e) => set('plannedStart', e.target.value)} /></label>
            <label className="field">Durée estimée<input className="input" value={form.estimatedDuration} onChange={(e) => set('estimatedDuration', e.target.value)} /></label>
            <label className="field">Acompte prévu (%)<input className="input" inputMode="decimal" aria-invalid={form.plannedDeposit !== '' && depositBp === null ? true : undefined} value={form.plannedDeposit} onChange={(e) => set('plannedDeposit', e.target.value)} /></label>
            <label className="field span-all">Conditions de paiement
              <textarea className="input" rows={2} value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} />
            </label>
          </section>
        </div>

        <aside aria-label="Récapitulatif" className="editor-aside">
          <div className="summary">
            <div className="summary-row"><span>Total HT</span><span>{formatEuros(totals.totalHtCents)}</span></div>
            <div className="summary-vat">TVA non applicable, art. 293 B du CGI</div>
            <div className="summary-rule" />
            <div className="summary-due"><span>Total à payer</span><strong>{formatEuros(totals.totalDueCents)}</strong></div>
            {depositBp !== null && (
              <div className="summary-deposit">Acompte prévu ({formatPercent(depositBp)}) : <strong>{formatEuros(depositAmountCents(totals.totalDueCents, { mode: 'percent', basisPoints: depositBp }))}</strong></div>
            )}
          </div>
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Modèle du document</span>
            <span>{templateName}</span>
            <DocumentToolbar printPath={`/imprimer/devis/${initial.quote.id}`} beforeOpen={autosave.flush} label="Voir l’aperçu" className="link-button" />
          </div>
        </aside>
      </div>
      <ClientFormDialog open={creatingClient} onClose={() => setCreatingClient(false)} onSaved={(c) => { set('clientId', c.id); setCreatingClient(false); }} />
    </>
  );
}
