import { Link } from 'react-router';
import { PRINT_HELP } from '../pages/PrintPage';

export function DocumentToolbar({ printPath, beforeOpen }: { printPath: string; beforeOpen?: () => Promise<void> }) {
  return (
    <span className="actions" style={{ alignItems: 'center' }}>
      <Link className="btn btn-secondary" to={`${printPath}?auto=1`} title={PRINT_HELP} onClick={() => { void beforeOpen?.(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>
        Aperçu et PDF
      </Link>
    </span>
  );
}
