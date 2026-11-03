import type { DocumentView } from '../../shared/document';

export function printTitle(view: DocumentView): string {
  return `${view.number ?? `${view.title} (brouillon)`} – ${view.client?.name ?? 'sans client'}`;
}
