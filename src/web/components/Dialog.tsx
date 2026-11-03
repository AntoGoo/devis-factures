import { useEffect, useState, type ReactNode } from 'react';

// Fenêtres ouvertes, de la plus ancienne à la plus récente : Échap ne ferme que la dernière, affichée au-dessus.
const openStack: object[] = [];

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const [token] = useState(() => ({}));
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    if (!open) return;
    openStack.push(token);
    setDepth(openStack.length);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openStack[openStack.length - 1] === token && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = openStack.indexOf(token);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, [open, onClose, token]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" style={{ zIndex: 10 + depth }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="dialog">
        <div className="dialog-head">
          <h2 className="card-title">{title}</h2>
          <button type="button" className="dialog-close" aria-label="Fermer" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
