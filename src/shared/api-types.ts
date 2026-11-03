export type MeResponse = {
  user: { id: string; email: string; name: string };
  isSuperadmin: boolean;
  onboarding?: { templateRef: string | null; profileComplete: boolean };
  profileSummary?: { ownerName: string; tradeName: string } | null;
};

export type AdminEmailItem = {
  email: string;
  isSuperadmin: boolean;
  tradeName: string | null;
  lastLoginAt: string | null;
  addedAt: string | null;
};
