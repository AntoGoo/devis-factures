// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getTemplate, selectableTemplates } from './registry';

const files = (pattern: Record<string, unknown>) => Object.keys(pattern).map((p) => p.replace(/\/[^/]+$/, '')).sort();

describe('registre des modèles', () => {
  it('chaque version de modèle fournit meta.ts, index.tsx et style.css', () => {
    const metas = files(import.meta.glob('./*/v*/meta.ts'));
    expect(files(import.meta.glob('./*/v*/index.tsx'))).toEqual(metas);
    expect(files(import.meta.glob('./*/v*/style.css'))).toEqual(metas);
  });

  it('sert les modèles sélectionnables avec leurs libellés', () => {
    expect(selectableTemplates().map((t) => t.className)).toEqual(['tpl-modele-01-v1', 'tpl-modele-02-v1', 'tpl-modele-03-v1']);
    expect(getTemplate('modele-02@1').labels.company).toBe('De');
    expect(getTemplate('modele-03@1').labels.thanks).toBe('Merci de votre confiance');
  });

  it('se replie sur le modèle par défaut pour une référence inconnue', () => {
    expect(getTemplate('modele-99@1').meta.name).toBe('Intemporel');
  });

  it('rend une vignette pour chaque modèle', () => {
    for (const t of selectableTemplates()) {
      const { container } = render(<t.Thumbnail />);
      expect(container.querySelector('.tpl-thumb')).not.toBeNull();
    }
  });
});
