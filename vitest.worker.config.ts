import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-10-01',
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
      // Les 16 fichiers tournent en parallèle, chacun dans son runtime workerd avec sa D1. Le test le plus long
      // (tableau de bord : une trentaine de requêtes) prend ~1,8 s, mais certaines exécutions sont, d'un bout à
      // l'autre, 3 à 4 fois plus lentes : les tests les plus longs dépassaient alors les 5 s par défaut de Vitest
      // (« Test timed out in 5000ms »). 30 s ne laisse échouer qu'un vrai blocage.
      testTimeout: 30_000,
    },
  };
});
