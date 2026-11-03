import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          // @cloudflare/vitest-pool-workers@0.23.0 pins its own Miniflare/workerd
          // build, whose newest supported compatibility date is 2026-08-22 (older
          // than the date wrangler.jsonc uses, 2026-10-01). Keep this one lower so
          // the test runtime can start; see task-1-report.md.
          compatibilityDate: '2026-08-22',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            SUPERADMIN_EMAIL: 'boss@example.test',
            BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
            BETTER_AUTH_URL: 'http://localhost:5173',
            GOOGLE_CLIENT_ID: 'test',
            GOOGLE_CLIENT_SECRET: 'test',
          },
        },
      }),
    ],
    test: {
      include: ['test/worker/**/*.test.ts'],
      setupFiles: ['./test/worker/apply-migrations.ts'],
    },
  };
});
