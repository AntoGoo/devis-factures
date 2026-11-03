import { DEFAULT_TEMPLATE_REF, latestTemplateMetas } from './catalog';
import { templateRef, type TemplateModule } from './types';

const found = import.meta.glob<{ default: TemplateModule }>('./*/v*/index.tsx', { eager: true });
const byRef = new Map(Object.values(found).map((m) => [templateRef(m.default.meta), m.default]));

export function getTemplate(ref: string): TemplateModule {
  return byRef.get(ref) ?? byRef.get(DEFAULT_TEMPLATE_REF)!;
}

export function selectableTemplates(): TemplateModule[] {
  return latestTemplateMetas()
    .map((m) => byRef.get(templateRef(m)))
    .filter((t): t is TemplateModule => t !== undefined);
}
