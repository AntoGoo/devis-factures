import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClientData, ClientInput } from '../../shared/client';
import { ApiError, api } from '../api';
import { Dialog } from './Dialog';

const EMPTY: ClientInput = { type: 'individual', name: '', street: '', postalCode: '', city: '', country: 'FR', siren: '', email: '', phone: '' };

export function ClientFormDialog({ open, initial, onClose, onSaved }: { open: boolean; initial?: ClientData; onClose: () => void; onSaved: (c: ClientData) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ClientInput>(initial ?? EMPTY);
  useEffect(() => { if (open) setForm(initial ?? EMPTY); }, [open, initial]);
  const save = useMutation({
    mutationFn: () => (initial ? api<ClientData>('PUT', `/api/clients/${initial.id}`, form) : api<ClientData>('POST', '/api/clients', form)),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['clients'] }); onSaved(c); },
  });
  const issues = save.error instanceof ApiError && Array.isArray(save.error.issues) ? (save.error.issues as { path: string[]; message: string }[]) : [];
  const err = (k: string) => issues.find((i) => i.path[0] === k)?.message;
  const input = (k: keyof ClientInput, label: string, span = false) => (
    <label className={span ? 'field span-all' : 'field'}>{label}
      <input className="input" aria-label={label} aria-invalid={err(k) ? true : undefined} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      {err(k) && <span className="field-error">{err(k)}</span>}
    </label>
  );
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Dialog open={open} title={initial ? 'Modifier le client' : 'Nouveau client'} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <fieldset className="span-all" style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 16 }}>
          <legend className="field" style={{ marginBottom: 6 }}>Type de client</legend>
          <label><input type="radio" name="type" checked={form.type === 'individual'} onChange={() => setForm({ ...form, type: 'individual', siren: '' })} /> Particulier</label>
          <label><input type="radio" name="type" checked={form.type === 'business'} onChange={() => setForm({ ...form, type: 'business' })} /> Professionnel</label>
        </fieldset>
        {input('name', 'Nom ou raison sociale', true)}
        {input('street', 'Adresse de facturation', true)}
        {input('postalCode', 'Code postal')}
        {input('city', 'Ville')}
        {form.type === 'business' && input('siren', 'SIREN ou SIRET')}
        {input('email', 'E-mail')}
        {input('phone', 'Téléphone')}
        {save.error && issues.length === 0 && <p className="field-error span-all" role="alert">{save.error.message}</p>}
        <div className="actions span-all" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>Enregistrer le client</button>
        </div>
      </form>
    </Dialog>
  );
}
