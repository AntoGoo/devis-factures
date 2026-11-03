export type MeResponse = {
  user: { id: string; email: string; name: string };
  isSuperadmin: boolean;
  onboarding?: { templateRef: string | null; profileComplete: boolean };
  profileSummary?: { ownerName: string; tradeName: string } | null;
};
