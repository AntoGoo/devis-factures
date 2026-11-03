import { Link } from 'react-router';

/** Logo de l'application, lien vers l'accueil ; `className` garde l'apparence propre à chaque emplacement. */
export function Brand({ className, nameClassName }: { className: string; nameClassName?: string }) {
  return (
    <Link to="/" className={`brand-link ${className}`} aria-label="Devis & Factures — accueil">
      <span className="brand-mark" aria-hidden="true">D</span><span className={nameClassName}>Devis &amp; Factures</span>
    </Link>
  );
}
