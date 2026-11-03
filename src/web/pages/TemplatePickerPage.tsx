import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DEFAULT_TEMPLATE_REF } from '../../templates/catalog';
import { selectableTemplates } from '../../templates/registry';
import { templateRef } from '../../templates/types';
import { api } from '../api';
import { OnboardingLayout } from '../layout/OnboardingLayout';
import { useMe } from '../session/useMe';
import './TemplatePickerPage.css';

export function TemplatePickerPage({ mode }: { mode: 'onboarding' | 'settings' }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = selectableTemplates();
  const [picked, setPicked] = useState(me?.onboarding.templateRef ?? DEFAULT_TEMPLATE_REF);
  const pickedName = templates.find((t) => templateRef(t.meta) === picked)?.meta.name ?? templates[0]!.meta.name;
  const save = useMutation({
    mutationFn: () => api('PUT', '/api/profile/template', { templateRef: picked }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['profile'] });
      navigate(mode === 'onboarding' ? '/bienvenue/entreprise' : '/profil');
    },
  });

  const content = (
    <div className="picker">
      <div className="picker-intro">
        <h1 className="page-title" style={{ fontSize: 44, lineHeight: 1.05 }}>Choisissez l’apparence de vos documents</h1>
        <p className="page-intro" style={{ fontSize: 17 }}>Devis, factures d’acompte, factures de solde et avoirs prendront ce style. Vous pourrez en changer à tout moment dans votre profil ; les documents déjà émis gardent le leur.</p>
      </div>
      <div className="picker-grid">
        {templates.map((t) => {
          const ref = templateRef(t.meta);
          const on = ref === picked;
          return (
            <button key={ref} type="button" className={on ? 'picker-card picker-card--on' : 'picker-card'} aria-pressed={on} onClick={() => setPicked(ref)}>
              <div className="picker-preview"><t.Thumbnail /></div>
              <div className="picker-caption">
                <div><span className="picker-name">{t.meta.name}</span><span className="picker-desc">{t.meta.description}</span></div>
                <span className="picker-radio" aria-hidden="true"><span /></span>
              </div>
            </button>
          );
        })}
      </div>
      <p className="page-intro" style={{ fontSize: 14 }}>Sept autres modèles arriveront après le lancement.</p>
      <div className="picker-footer">
        <button type="button" className="btn btn-primary" style={{ height: 52, borderRadius: 14 }} onClick={() => save.mutate()} disabled={save.isPending}>
          {mode === 'onboarding' ? `Continuer avec « ${pickedName} »` : `Utiliser « ${pickedName} »`}
        </button>
      </div>
    </div>
  );
  return mode === 'onboarding' ? <OnboardingLayout step={1}>{content}</OnboardingLayout> : content;
}
