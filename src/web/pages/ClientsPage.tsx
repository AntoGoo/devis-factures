import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CLIENT_TYPE_LABEL, type ClientData } from '../../shared/client';
import { api } from '../api';
import { ClientFormDialog } from '../components/ClientFormDialog';

export function ClientsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['clients'], queryFn: () => api<{ items: ClientData[] }>('GET', '/api/clients') });
  const [editing, setEditing] = useState<ClientData | undefined>();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/api/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Clients</h1>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(undefined); setOpen(true); }}>Nouveau client</button>
      </div>
      {remove.error && <p className="notice notice-error" role="alert">{remove.error.message}</p>}
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Nom</th><th scope="col">Type</th><th scope="col">Ville</th><th scope="col">SIREN</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--c-text-muted)' }}>Aucun client pour l’instant.</td></tr>}
            {list.data?.items.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{CLIENT_TYPE_LABEL[c.type]}</td>
                <td>{c.city}</td>
                <td>{c.siren || '—'}</td>
                <td className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" style={{ height: 36 }} onClick={() => { setEditing(c); setOpen(true); }}>Modifier</button>
                  <button type="button" className="btn btn-danger" onClick={() => window.confirm(`Supprimer ${c.name} ?`) && remove.mutate(c.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ClientFormDialog open={open} initial={editing} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />
    </div>
  );
}
