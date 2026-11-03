import { describe, expect, it } from 'vitest';
import { ALL_TEMPLATE_METAS, DEFAULT_TEMPLATE_REF, isKnownTemplateRef, latestTemplateMetas } from './catalog';
import { templateRef } from './types';

const metaFiles = import.meta.glob('./*/v*/meta.ts', { eager: true });

describe('catalogue des modèles', () => {
  it('propose les 3 modèles V1 dans l’ordre', () => {
    expect(latestTemplateMetas().map(templateRef)).toEqual(['modele-01@1', 'modele-02@1', 'modele-03@1']);
    expect(latestTemplateMetas().map((m) => m.name)).toEqual(['Intemporel', 'Discret', 'Raffiné']);
  });

  it('reconnaît les références existantes seulement', () => {
    expect(isKnownTemplateRef(DEFAULT_TEMPLATE_REF)).toBe(true);
    expect(isKnownTemplateRef('modele-02@1')).toBe(true);
    expect(isKnownTemplateRef('modele-02@9')).toBe(false);
    expect(isKnownTemplateRef('n’importe quoi')).toBe(false);
  });

  it('fait concorder chaque dossier avec sa méta (modele-XX/vN ↔ id et version)', () => {
    for (const [path, mod] of Object.entries(metaFiles) as [string, { meta: { id: string; version: number } }][]) {
      const [, id, v] = /^\.\/([^/]+)\/v(\d+)\/meta\.ts$/.exec(path)!;
      expect(mod.meta.id).toBe(id);
      expect(mod.meta.version).toBe(Number(v));
    }
    expect(ALL_TEMPLATE_METAS).toHaveLength(Object.keys(metaFiles).length);
  });
});
