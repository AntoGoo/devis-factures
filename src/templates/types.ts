import type { ComponentType } from 'react';

export type TemplateMeta = { id: string; version: number; name: string; description: string; order: number };

export type DocumentLabels = {
  company: string;
  client: string;
  object: string;
  terms: string;
  approval: string;
  thanks: string | null;
};

export type TemplateModule = {
  meta: TemplateMeta;
  className: string;
  labels: DocumentLabels;
  fontsHref: string;
  Thumbnail: ComponentType;
};

export const templateRef = (m: { id: string; version: number }) => `${m.id}@${m.version}`;
