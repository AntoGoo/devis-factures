import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/worker/app';

describe('GET /api/health', () => {
  it('répond ok sans être connecté', async () => {
    const app = createApp({ getSessionUser: async () => null, now: () => new Date() });
    const res = await app.request('/api/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
