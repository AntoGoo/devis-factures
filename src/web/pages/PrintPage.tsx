import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { DocumentView } from '../../shared/document';
import { getTemplate } from '../../templates/registry';
import { api } from '../api';
import { DocumentRenderer } from '../document/DocumentRenderer';
import { printTitle } from '../document/printTitle';
import { useTemplateFonts } from '../document/useTemplateFonts';
import { Brand } from '../layout/Brand';

export const PRINT_HELP = 'Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF » et décochez « En-têtes et pieds de page ».';

export function PrintPage() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const endpoint = type === 'factures' ? `/api/invoices/${id}` : `/api/quotes/${id}`;
  // Toujours relire le document : l’aperçu suit souvent une émission ou une correction.
  const doc = useQuery({ queryKey: ['print', type, id], queryFn: () => api<{ view: DocumentView }>('GET', endpoint), staleTime: 0, gcTime: 0 });
  const view = doc.data?.view;
  const fresh = doc.isFetchedAfterMount && !doc.isFetching;
  const template = view ? getTemplate(view.templateRef) : null;
  useTemplateFonts(template?.fontsHref ?? '');

  useEffect(() => {
    if (!view) return;
    const previous = document.title;
    document.title = printTitle(view);
    return () => { document.title = previous; };
  }, [view]);

  // Impression automatique une seule fois par ouverture de la page : la relecture du document
  // au retour sur l’onglet (après la fenêtre d’impression) ne doit pas la relancer.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!view || !fresh || autoPrinted.current || params.get('auto') !== '1') return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled || autoPrinted.current) return;
      autoPrinted.current = true;
      window.print();
    });
    return () => { cancelled = true; };
  }, [view, fresh, params]);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Brand className="shell-brand" />
        {type === 'factures'
          ? <Link className="btn btn-secondary" to={`/factures/${id}`}>← Retour à la facture</Link>
          : <Link className="btn btn-secondary" to={`/devis/${id}`}>← Retour au devis</Link>}
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Imprimer / PDF</button>
        <p className="print-help">{PRINT_HELP}</p>
      </div>
      {doc.error && <p className="notice notice-error" role="alert">{doc.error.message}</p>}
      {view && template && <div className="doc-sheet"><DocumentRenderer view={view} template={template} /></div>}
    </div>
  );
}
