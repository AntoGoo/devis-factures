import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import assetHeadersFile from '../../public/_headers?raw';
import { createApp } from '../../src/worker/app';
import { SECURITY_HEADERS } from '../../src/worker/security-headers';

const EXPECTED: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'strict-transport-security': 'max-age=15552000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

const app = createApp({ getSessionUser: async () => null, now: () => new Date() });

function expectSecurityHeaders(res: Response) {
  for (const [name, value] of Object.entries(EXPECTED)) expect(res.headers.get(name), name).toBe(value);
}

/** En-têtes de la règle `/*` du fichier `_headers` des assets statiques. */
function assetHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  let inGlobalRule = false;
  for (const line of assetHeadersFile.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inGlobalRule = line.trim() === '/*';
      continue;
    }
    if (!inGlobalRule) continue;
    const sep = line.indexOf(':');
    headers[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
  }
  return headers;
}

describe('en-têtes de sécurité', () => {
  it('sont posés sur une réponse API publique', async () => {
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });

  it('sont posés sur une réponse d’erreur 401', async () => {
    const res = await app.request('/api/me', {}, env);
    expect(res.status).toBe(401);
    expectSecurityHeaders(res);
  });

  it('sont posés sur une adresse inconnue (404)', async () => {
    const res = await app.request('/inexistant', {}, env);
    expect(res.status).toBe(404);
    expectSecurityHeaders(res);
  });

  it('sont posés sur les réponses de Better Auth', async () => {
    const res = await app.request('/api/auth/get-session', {}, env);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });

  it('sont posés sur une redirection de Better Auth', async () => {
    const res = await app.request('/api/auth/callback/google?error=access_denied', { redirect: 'manual' }, env);
    expect(res.status).toBe(302);
    expectSecurityHeaders(res);
  });

  it('sont les mêmes dans public/_headers (pages et fichiers statiques)', () => {
    expect(Object.fromEntries(Object.entries(SECURITY_HEADERS).map(([k, v]) => [k.toLowerCase(), v]))).toEqual(EXPECTED);
    expect(assetHeaders()).toEqual(EXPECTED);
  });
});
