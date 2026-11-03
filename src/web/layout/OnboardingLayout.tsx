import type { ReactNode } from 'react';
import { Brand } from './Brand';

export function OnboardingLayout({ step, children }: { step: 1 | 2; children: ReactNode }) {
  const pill = (n: 1 | 2, label: string) => (
    <li className={n === step ? 'step step--current' : 'step'} aria-current={n === step ? 'step' : undefined}>{n}. {label}</li>
  );
  return (
    <main className="onboarding">
      <div className="onboarding-inner">
        <header className="onboarding-head">
          <Brand className="shell-brand" />
          <ol aria-label="Étapes" className="steps">{pill(1, 'Modèle')}{pill(2, 'Votre entreprise')}</ol>
        </header>
        {children}
      </div>
    </main>
  );
}
