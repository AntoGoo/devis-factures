import { templateRef, type TemplateMeta } from './types';

const found = import.meta.glob<{ meta: TemplateMeta }>('./*/v*/meta.ts', { eager: true });

export const ALL_TEMPLATE_METAS: TemplateMeta[] = Object.values(found).map((m) => m.meta);
export const DEFAULT_TEMPLATE_REF = 'modele-01@1';

export function isKnownTemplateRef(ref: string): boolean {
  return ALL_TEMPLATE_METAS.some((m) => templateRef(m) === ref);
}

/** Dernière version de chaque modèle, dans l'ordre d'affichage. */
export function latestTemplateMetas(): TemplateMeta[] {
  const latest = new Map<string, TemplateMeta>();
  for (const m of ALL_TEMPLATE_METAS) {
    const current = latest.get(m.id);
    if (!current || m.version > current.version) latest.set(m.id, m);
  }
  return [...latest.values()].sort((a, b) => a.order - b.order);
}
