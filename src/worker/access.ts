export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSuperadmin(env: { SUPERADMIN_EMAIL: string }, email: string): boolean {
  return normalizeEmail(email) === normalizeEmail(env.SUPERADMIN_EMAIL);
}

export async function isEmailAllowed(db: D1Database, superadminEmail: string, email: string): Promise<boolean> {
  const e = normalizeEmail(email);
  if (e === normalizeEmail(superadminEmail)) return true;
  const row = await db.prepare('SELECT 1 AS ok FROM allowed_emails WHERE email = ?').bind(e).first();
  return row !== null;
}

export async function emailOfUser(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first<{ email: string }>();
  return row?.email ?? null;
}

export async function recordLogin(db: D1Database, email: string, at: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_activity (email, last_login_at) VALUES (?, ?)
       ON CONFLICT (email) DO UPDATE SET last_login_at = excluded.last_login_at`,
    )
    .bind(normalizeEmail(email), at.toISOString())
    .run();
}

export class NotInvitedError extends Error {
  constructor() {
    super('not_invited');
  }
}

/** Crochets Better Auth appliquant la liste d'accès à la création de compte et de session. */
export function accessHooks(env: { DB: D1Database; SUPERADMIN_EMAIL: string }, now: () => Date) {
  const assertInvited = async (email: string | null) => {
    if (!email || !(await isEmailAllowed(env.DB, env.SUPERADMIN_EMAIL, email))) throw new NotInvitedError();
  };
  return {
    beforeUserCreate: (email: string) => assertInvited(email),
    beforeSessionCreate: async (userId: string) => assertInvited(await emailOfUser(env.DB, userId)),
    afterSessionCreate: async (userId: string) => {
      const email = await emailOfUser(env.DB, userId);
      if (email) await recordLogin(env.DB, email, now());
    },
  };
}
