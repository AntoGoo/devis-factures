import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Lien clavier vers le document d’une ligne de liste ; la ligne entière reste cliquable à la souris. */
export function RowLink({ to, label, children }: { to: string; label?: string; children: ReactNode }) {
  return <Link to={to} className="row-link-anchor" aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</Link>;
}

/** Nom accessible d’un document sans numéro (brouillon) : son type et son client. */
export const draftLinkLabel = (kindLabel: string, clientName: string | null) => (clientName ? `${kindLabel}, ${clientName}` : kindLabel);
