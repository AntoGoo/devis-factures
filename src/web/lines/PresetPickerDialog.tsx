import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatEuros } from '../../shared/money';
import type { PresetData } from '../../shared/preset';
import { api } from '../api';
import { Dialog } from '../components/Dialog';

export function PresetPickerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: PresetData) => void }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['presets'], queryFn: () => api<{ items: PresetData[] }>('GET', '/api/presets'), enabled: open });
  const items = (list.data?.items ?? []).filter((p) => p.designation.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open={open} title="Insérer une ligne type" onClose={onClose}>
      <input className="input" aria-label="Rechercher une ligne type" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.data && list.data.items.length === 0 && <p className="page-intro">Aucune ligne type. Enregistrez-en depuis un devis (☆) ou la page Lignes types.</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick(p)}>
              <span>{p.designation}</span><span>{p.unit} · {formatEuros(p.unitPriceCents)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
