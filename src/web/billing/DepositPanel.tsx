import { useState } from 'react';
import type { DepositInput } from '../../shared/deposits';
import { formatEuros } from '../../shared/money';
import { depositPreview, percentInput, type DepositMode } from './depositPreview';

type Props = {
  totalCents: number;
  alreadyInvoicedCents: number;
  defaultBp: number | null;
  disabledReason?: string | null;
  pending?: boolean;
  onCreate: (input: DepositInput) => void;
};

export function DepositPanel({ totalCents, alreadyInvoicedCents, defaultBp, disabledReason, pending, onCreate }: Props) {
  const [mode, setMode] = useState<DepositMode>('percent');
  const [raw, setRaw] = useState(defaultBp ? percentInput(defaultBp) : '');
  const p = depositPreview(totalCents, alreadyInvoicedCents, mode, raw);
  const label = mode === 'percent' ? 'Pourcentage du total' : 'Montant HT';
  const pick = (m: DepositMode) => { setMode(m); setRaw(''); };
  return (
    <aside aria-labelledby="h-acompte" className="deposit-panel">
      <h2 id="h-acompte" className="card-title">Nouvel acompte</h2>
      <div role="radiogroup" aria-label="Type de montant" className="segmented">
        <button type="button" role="radio" aria-checked={mode === 'percent'} onClick={() => pick('percent')}>Pourcentage</button>
        <button type="button" role="radio" aria-checked={mode === 'amount'} onClick={() => pick('amount')}>Montant</button>
      </div>
      <label className="field">{label}
        <input className="input" aria-label={label} inputMode="decimal" value={raw} aria-invalid={p.error ? true : undefined} onChange={(e) => setRaw(e.target.value)} />
      </label>
      <div className="deposit-row"><span>Montant facturé</span><strong data-testid="deposit-amount">{p.amountCents === null ? '—' : formatEuros(p.amountCents)}</strong></div>
      <div className="deposit-row"><span>Restera à facturer</span><strong data-testid="deposit-remaining">{p.remainingAfterCents === null ? formatEuros(totalCents - alreadyInvoicedCents) : formatEuros(p.remainingAfterCents)}</strong></div>
      {p.error && <p className="field-error" role="alert">{p.error}</p>}
      {disabledReason && <p className="field-hint">{disabledReason}</p>}
      <button type="button" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={!p.input || !!disabledReason || pending} onClick={() => p.input && onCreate(p.input)}>
        Créer la facture d’acompte
      </button>
      <p className="deposit-note">Elle est créée en brouillon. Le numéro est attribué à l’émission, ensuite elle ne se modifie plus.</p>
    </aside>
  );
}
