import type { Series } from './numbering';

export type MeResponse = {
  user: { id: string; email: string; name: string };
  isSuperadmin: boolean;
  onboarding: { templateRef: string | null; profileComplete: boolean };
  profileSummary: { ownerName: string; tradeName: string } | null;
};

export type NumberingInfo = {
  year: number;
  series: { series: Series; prefix: string; next: string; startEditable: boolean }[];
};

export type AdminEmailItem = {
  email: string;
  isSuperadmin: boolean;
  tradeName: string | null;
  lastLoginAt: string | null;
  addedAt: string | null;
};
