import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { formatCentsForInput, formatEuros, parseEuros } from '../../shared/money';
import type { PresetData } from '../../shared/preset';
import { DEFAULT_UNITS } from '../../shared/profile';
import { api } from '../api';
import { useProfile } from '../profile/useProfile';

export function LinePresetsPage() {
  const qc = useQueryClient();
  const units = useProfile().data?.profile?.units ?? DEFAULT_UNITS;
  const list = useQuery({ queryKey: ['presets'], queryFn: () => api<{ items: PresetData[] }>('GET', '/api/presets') });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [designation, setDesignation] = useState('');
  const [unit, setUnit] = useState(units[0] ?? 'u');
  const [price, setPrice] = useState('');
  const cents = parseEuros(price === '' ? '0' : price);
  const reset = () => { setEditingId(null); setDesignation(''); setPrice(''); };
  const save = useMutation({
    mutationFn: () => {
      const body = { designation, unit, unitPriceCents: cents!, vatRate: null };
      return editingId ? api('PUT', `/api/presets/${editingId}`, body) : api('POST', '/api/presets', body);
    },
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ['presets'] }); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api('DELETE', `/api/presets/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }) });
  const submit = (e: FormEvent) => { e.preventDefault(); if (cents !== null) save.mutate(); };

  return (
    <div className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="page-title">Lignes types</h1>
        <p className="page-intro">Enregistrez ici les prestations que vous facturez souvent ; insérez-les ensuite dans un devis en un clic.</p>
      </div>
      <form className="card" onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '3 1 280px' }}>Désignation<input className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} /></label>
        <label className="field" style={{ flex: '1 1 110px' }}>Unité
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        </label>
        <label className="field" style={{ flex: '1 1 130px' }}>P.U. HT<input className="input" inputMode="decimal" aria-invalid={cents === null ? true : undefined} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={cents === null || designation.trim() === ''}>{editingId ? 'Enregistrer' : 'Ajouter'}</button>
        {editingId && <button type="button" className="btn btn-secondary" onClick={reset}>Annuler</button>}
        {cents === null && <span className="field-error" style={{ flexBasis: '100%' }}>Prix invalide : 2 décimales au maximum (ex. 1 234,50).</span>}
      </form>
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Désignation</th><th scope="col">Unité</th><th scope="col" className="num">P.U. HT</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {list.data?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.designation}</td><td>{p.unit}</td><td className="num">{formatEuros(p.unitPriceCents)}</td>
                <td className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" style={{ height: 36 }} onClick={() => { setEditingId(p.id); setDesignation(p.designation); setUnit(p.unit); setPrice(formatCentsForInput(p.unitPriceCents)); }}>Modifier</button>
                  <button type="button" className="btn btn-danger" onClick={() => remove.mutate(p.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
