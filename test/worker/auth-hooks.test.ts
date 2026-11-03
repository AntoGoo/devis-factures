import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { NotInvitedError, accessHooks } from '../../src/worker/access';
import { allow, createUser } from './helpers';

const hooks = () => accessHooks(env, () => new Date('2026-11-03T08:00:00Z'));

describe('crochets Better Auth', () => {
  it('refuse la création d’un compte non invité', async () => {
    await expect(hooks().beforeUserCreate('intrus@example.test')).rejects.toBeInstanceOf(NotInvitedError);
  });

  it('accepte un invité et le superadmin', async () => {
    await allow('lea@example.test');
    await expect(hooks().beforeUserCreate('Lea@example.test')).resolves.toBeUndefined();
    await expect(hooks().beforeUserCreate('boss@example.test')).resolves.toBeUndefined();
  });

  it('refuse une nouvelle session pour une adresse retirée de la liste', async () => {
    const user = await createUser('ancien@example.test');
    await expect(hooks().beforeSessionCreate(user.id)).rejects.toBeInstanceOf(NotInvitedError);
  });

  it('enregistre la connexion après la création de session', async () => {
    const user = await createUser('boss@example.test');
    await hooks().afterSessionCreate(user.id);
    const row = await env.DB.prepare("SELECT last_login_at FROM login_activity WHERE email = 'boss@example.test'").first();
    expect(row).toEqual({ last_login_at: '2026-11-03T08:00:00.000Z' });
  });
});
