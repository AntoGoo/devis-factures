import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { AdminEmailItem } from '../../shared/api-types';
import { ApiError, api } from '../api';
import { formatLastLogin } from './lastLogin';

export function AdminPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-emails'], queryFn: () => api<{ items: AdminEmailItem[] }>('GET', '/api/admin/emails') });
  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: (value: string) => api<AdminEmailItem>('POST', '/api/admin/emails', { email: value }),
    onSuccess: () => { setEmail(''); qc.invalidateQueries({ queryKey: ['admin-emails'] }); },
  });
  const remove = useMutation({
    mutationFn: (value: string) => api<void>('DELETE', `/api/admin/emails/${encodeURIComponent(value)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-emails'] }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(email); };
  const now = new Date();

  if (list.error instanceof ApiError) {
    return (
      <div className="page" style={{ maxWidth: 980 }}>
        <p className="notice notice-error" role="alert">{list.error.message}</p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="eyebrow">Superadmin</span>
        <h1 className="page-title" style={{ fontSize: 38 }}>Accès autorisés</h1>
        <p className="page-intro">Seules ces adresses Google peuvent se connecter. Retirer une adresse coupe l’accès immédiatement ; les devis et factures de la personne sont conservés.</p>
      </div>
      <form className="card" onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: 20 }}>
        <label className="field" style={{ flex: '1 1 320px' }}>
          Adresse Gmail à autoriser
          <input className="input" type="email" required placeholder="prenom.nom@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={add.isPending}>Autoriser</button>
        {add.error instanceof ApiError && <p className="field-error span-all" role="alert">{add.error.message}</p>}
      </form>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr><th scope="col">Adresse</th><th scope="col">Entreprise</th><th scope="col">Dernière connexion</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.data?.items.map((it) => (
              <tr key={it.email}>
                <td style={{ fontWeight: 600 }}>
                  {it.email}
                  {it.isSuperadmin && <span className="badge tone-ok" style={{ marginLeft: 8, fontSize: 12 }}>superadmin</span>}
                </td>
                <td>{it.lastLoginAt === null ? <span className="badge tone-wait">jamais connecté</span> : it.tradeName ?? '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{formatLastLogin(it.lastLoginAt, now) ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {!it.isSuperadmin && (
                    <button type="button" className="btn btn-danger" onClick={() => window.confirm(`Retirer l’accès de ${it.email} ?`) && remove.mutate(it.email)}>Retirer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
