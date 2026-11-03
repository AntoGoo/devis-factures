import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PRINT_HELP } from '../pages/PrintPage';

export function DocumentToolbar({ printPath, beforeOpen }: { printPath: string; beforeOpen?: () => Promise<void> }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setPending(true);
    setError(null);
    try {
      await beforeOpen?.();
      navigate(`${printPath}?auto=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inattendue.');
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="actions" style={{ alignItems: 'center' }}>
      <button type="button" className="btn btn-secondary" title={PRINT_HELP} disabled={pending} onClick={() => { void open(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>
        Aperçu et PDF
      </button>
      {error && <span role="alert" className="field-hint">{`Enregistrement impossible : ${error}. L’aperçu n’a pas été ouvert.`}</span>}
    </span>
  );
}
