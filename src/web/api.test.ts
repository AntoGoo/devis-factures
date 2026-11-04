import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

const respond = (response: Response) => vi.stubGlobal('fetch', vi.fn(async () => response));

describe('api', () => {
  it('renvoie le JSON d’une réponse réussie', async () => {
    respond(Response.json({ ok: true }));
    await expect(api('GET', '/api/health')).resolves.toEqual({ ok: true });
  });

  it('renvoie undefined pour une réponse 204', async () => {
    respond(new Response(null, { status: 204 }));
    await expect(api('DELETE', '/api/clients/c1')).resolves.toBeUndefined();
  });

  it('rejette une réponse réussie qui n’est pas du JSON (ex. page HTML servie à la place de l’API)', async () => {
    respond(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const err = await api('GET', '/api/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 200, code: 'invalid_response', message: 'Réponse inattendue du serveur.' });
  });

  it('garde le code et le message d’une erreur JSON', async () => {
    respond(Response.json({ error: 'not_invited', message: 'Accès sur invitation.' }, { status: 403 }));
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ status: 403, code: 'not_invited', message: 'Accès sur invitation.' });
  });
});
