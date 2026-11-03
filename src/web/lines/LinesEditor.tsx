import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { lineTotalCents } from '../../shared/lines';
import { formatEuros } from '../../shared/money';
import { api } from '../api';
import { blankDraft, insertPreset, moveDraft, parseDraft, presetFromDraft, type DraftLine } from './lineDrafts';
import { PresetPickerDialog } from './PresetPickerDialog';
import './LinesEditor.css';

type Props = { drafts: DraftLine[]; onChange: (ds: DraftLine[]) => void; units: string[]; readOnly?: boolean };

export function LinesEditor({ drafts, onChange, units, readOnly = false }: Props) {
  const [picking, setPicking] = useState(false);
  const qc = useQueryClient();
  const savePreset = useMutation({
    mutationFn: (d: DraftLine) => api('POST', '/api/presets', presetFromDraft(d)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
  const patch = (i: number, p: Partial<DraftLine>) => onChange(drafts.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const n = drafts.length;

  return (
    <section className="card lines" aria-labelledby="h-lignes">
      <div className="lines-head">
        <h2 id="h-lignes" className="card-title">Prestations</h2>
        <span className="lines-count">{n} {n > 1 ? 'lignes' : 'ligne'}</span>
      </div>
      <div className="lines-scroll">
        <table className="lines-table">
          <thead>
            <tr>
              <th scope="col">Désignation</th><th scope="col" className="w-qty">Qté</th><th scope="col" className="w-unit">Unité</th>
              <th scope="col" className="w-price">P.U. HT</th><th scope="col" className="w-total">Total HT</th>
              <th scope="col" className="w-actions"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => {
              const { line, errors } = parseDraft(d);
              const unitOptions = units.includes(d.unit) ? units : [...units, d.unit];
              return (
                <tr key={d.id}>
                  <td><input className="line-input" aria-label="Désignation" placeholder="Décrivez la prestation" value={d.designation} readOnly={readOnly} onChange={(e) => patch(i, { designation: e.target.value })} /></td>
                  <td><input className="line-input" aria-label="Quantité" inputMode="decimal" aria-invalid={errors.quantity ? true : undefined} title={errors.quantity} value={d.quantity} readOnly={readOnly} onChange={(e) => patch(i, { quantity: e.target.value })} /></td>
                  <td>
                    <select className="line-input" aria-label="Unité" value={d.unit} disabled={readOnly} onChange={(e) => patch(i, { unit: e.target.value })}>
                      {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><input className="line-input" aria-label="Prix unitaire HT en euros" inputMode="decimal" aria-invalid={errors.unitPrice ? true : undefined} title={errors.unitPrice} value={d.unitPrice} readOnly={readOnly} onChange={(e) => patch(i, { unitPrice: e.target.value })} /></td>
                  <td className="line-total" data-testid="line-total">{line ? formatEuros(lineTotalCents(line)) : '—'}</td>
                  <td className="line-actions">
                    {!readOnly && (
                      <>
                        <button type="button" className="icon-btn" aria-label="Monter la ligne" disabled={i === 0} onClick={() => onChange(moveDraft(drafts, i, -1))}>↑</button>
                        <button type="button" className="icon-btn" aria-label="Descendre la ligne" disabled={i === n - 1} onClick={() => onChange(moveDraft(drafts, i, 1))}>↓</button>
                        <button type="button" className="icon-btn" aria-label="Enregistrer comme ligne type" disabled={!presetFromDraft(d)} onClick={() => savePreset.mutate(d)}>☆</button>
                        <button type="button" className="icon-btn" aria-label="Supprimer la ligne" onClick={() => onChange(drafts.filter((_, j) => j !== i))}>×</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="actions">
          <button type="button" className="btn btn-dashed" onClick={() => onChange([...drafts, blankDraft(units[0])])}><span aria-hidden="true">+</span> Ajouter une ligne</button>
          <button type="button" className="btn btn-secondary" style={{ height: 44 }} onClick={() => setPicking(true)}>Insérer une ligne type</button>
          {savePreset.isSuccess && <span className="field-hint" role="status">Ligne type enregistrée.</span>}
        </div>
      )}
      <PresetPickerDialog open={picking} onClose={() => setPicking(false)} onPick={(p) => { onChange(insertPreset(drafts, p)); setPicking(false); }} />
    </section>
  );
}
