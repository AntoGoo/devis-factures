import { beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  // Clear all application and Better Auth tables (child-to-parent order)
  // PRAGMA defer_foreign_keys = ON allows cascading deletes without immediate constraint checking
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = ON'),
    env.DB.prepare('DELETE FROM invoices'),
    env.DB.prepare('DELETE FROM counters'),
    env.DB.prepare('DELETE FROM quotes'),
    env.DB.prepare('DELETE FROM line_presets'),
    env.DB.prepare('DELETE FROM clients'),
    env.DB.prepare('DELETE FROM profiles'),
    env.DB.prepare('DELETE FROM login_activity'),
    env.DB.prepare('DELETE FROM allowed_emails'),
    env.DB.prepare('DELETE FROM session'),
    env.DB.prepare('DELETE FROM account'),
    env.DB.prepare('DELETE FROM verification'),
    env.DB.prepare('DELETE FROM "user"'),
  ]);
});
