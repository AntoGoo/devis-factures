import { Hono } from 'hono';
import type { MeResponse } from '../../shared/api-types';
import { isProfileComplete } from '../../shared/profile';
import { isSuperadmin } from '../access';
import { getProfile } from '../db/profiles';
import type { AppEnv } from '../types';

export const meRoutes = new Hono<AppEnv>().get('/me', async (c) => {
  const user = c.var.user;
  const profile = await getProfile(c.env.DB, user.id);
  const body: MeResponse = {
    user,
    isSuperadmin: isSuperadmin(c.env, user.email),
    onboarding: { templateRef: profile?.templateRef ?? null, profileComplete: profile ? isProfileComplete(profile) : false },
    profileSummary: profile && profile.ownerName ? { ownerName: profile.ownerName, tradeName: profile.tradeName } : null,
  };
  return c.json(body);
});
