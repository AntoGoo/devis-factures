import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import type { QuoteResponse } from '../../shared/api-types';
import { DEFAULT_UNITS } from '../../shared/profile';
import { QUOTE_STATUS } from '../../shared/status';
import { getTemplate } from '../../templates/registry';
import { api } from '../api';
import { DocumentToolbar } from '../components/DocumentToolbar';
import { StatusBadge } from '../components/StatusBadge';
import { DocumentRenderer } from '../document/DocumentRenderer';
import { useTemplateFonts } from '../document/useTemplateFonts';
import { useProfile } from '../profile/useProfile';
import { QuoteForm } from '../quotes/QuoteForm';
import { quoteActions, type QuoteAction } from '../quotes/quoteActions';

const STEP_INDEX = { draft: 0, sent: 1, accepted: 2, refused: 2 } as const;

export function QuoteEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const quote = useQuery({ queryKey: ['quote', id], queryFn: () => api<QuoteResponse>('GET', `/api/quotes/${id}`) });
  const profile = useProfile().data?.profile;
  const units = profile?.units ?? DEFAULT_UNITS;
  useTemplateFonts(quote.data ? getTemplate(quote.data.view.templateRef).fontsHref : '');

  const act = useMutation({
    mutationFn: async ({ action, flush }: { action: QuoteAction; flush?: () => Promise<void> }) => {
      if (flush) await flush();
      if (action === 'delete') return api<void>('DELETE', `/api/quotes/${id}`);
      return api<QuoteResponse>('POST', `/api/quotes/${id}/${action}`);
    },
    onSuccess: (r, { action }) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      if (action === 'delete') return navigate('/devis');
      if (action === 'duplicate' && r) return navigate(`/devis/${(r as QuoteResponse).quote.id}`);
      if (r) qc.setQueryData(['quote', id], r);
    },
  });

  if (quote.isPending) return <p className="page-intro">Chargement…</p>;
  if (quote.error) return <p className="notice notice-error" role="alert">{quote.error.message}</p>;
  const { quote: q, view } = quote.data;
  const status = QUOTE_STATUS[q.status];
  const editable = q.status === 'draft' || q.status === 'sent';
  const templateName = getTemplate(view.templateRef).meta.name;

  const header = (flush?: () => Promise<void>, saveState = '', payloadValid = true) => {
    const actions = quoteActions(q.status);
    const statusChangeBlocked = !payloadValid && actions.some((a) => a === 'send' || a === 'accept' || a === 'refuse');
    return (
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="actions" style={{ alignItems: 'center' }}>
          <h1 className="page-title" style={{ fontSize: 32 }}>{q.number ?? 'Nouveau devis'}</h1>
          <StatusBadge tone={status.tone} label={q.status === 'draft' ? 'Brouillon · numéro attribué à l’envoi' : status.label} />
          {saveState && <span className="field-hint" role="status">{saveState}</span>}
        </div>
        <div className="actions" style={{ alignItems: 'center' }}>
          <DocumentToolbar printPath={`/imprimer/devis/${q.id}`} beforeOpen={flush} />
          {actions.map((a) => {
            const labels: Record<QuoteAction, string> = { send: 'Marquer comme envoyé', accept: 'Marquer comme accepté', refuse: 'Marquer comme refusé', duplicate: 'Dupliquer', delete: 'Supprimer le brouillon' };
            const confirmText: Partial<Record<QuoteAction, string>> = { accept: 'Le contenu du devis sera figé. Continuer ?', refuse: 'Le devis sera figé comme refusé. Continuer ?', delete: 'Supprimer ce brouillon ?' };
            const primary = a === 'send' || a === 'accept';
            const blockedByInvalidForm = (a === 'send' || a === 'accept' || a === 'refuse') && !payloadValid;
            return (
              <button key={a} type="button" className={primary ? 'btn btn-primary' : a === 'delete' ? 'btn btn-danger' : 'btn btn-secondary'} disabled={act.isPending || blockedByInvalidForm}
                onClick={() => (!confirmText[a] || window.confirm(confirmText[a])) && act.mutate({ action: a, flush })}>
                {labels[a]}
              </button>
            );
          })}
          {statusChangeBlocked && <span className="field-hint" role="status">Corrigez les champs en rouge avant de continuer.</span>}
        </div>
      </div>
    );
  };

  const steps = (
    <ol aria-label="Étapes du devis" className="steps-list">
      {['Brouillon', 'Envoyé', q.status === 'refused' ? 'Refusé' : 'Accepté → acomptes et facture'].map((label, i) => (
        <li key={label} className={i < STEP_INDEX[q.status] ? 'done' : i === STEP_INDEX[q.status] ? 'current' : ''}>
          <span className="step-dot">{i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      {act.error && <p className="notice notice-error" role="alert">{act.error.message}</p>}
      {editable ? (
        <QuoteForm key={q.id} initial={quote.data} units={units} templateName={templateName} onSaved={() => qc.invalidateQueries({ queryKey: ['quotes'] })}>
          {({ flush, saveState, payloadValid }) => header(flush, saveState, payloadValid)}
        </QuoteForm>
      ) : (
        <>
          {header()}
          <p className="notice">Le contenu de ce devis est figé depuis son {q.status === 'accepted' ? 'acceptation' : 'refus'}.</p>
          <div className="doc-sheet"><DocumentRenderer view={view} template={getTemplate(view.templateRef)} /></div>
        </>
      )}
      {steps}
    </div>
  );
}
