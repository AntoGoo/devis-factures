import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { APIError } from 'better-auth/api';
import { NotInvitedError, accessHooks } from '../../src/worker/access';
import { createAuth, getAuth } from '../../src/worker/auth';
import { allow, createAllowedUser, createUser } from './helpers';

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

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (err) {
    return err;
  }
}

describe('databaseHooks branchés par createAuth', () => {
  const dbHooks = () => createAuth(env).options.databaseHooks!;

  it('refuse la création d’un compte non invité avec une APIError portant le code not_invited', async () => {
    const before = dbHooks().user!.create!.before!;
    const err = await captureRejection(before({ email: 'intrus@example.test' } as any));
    expect(err).toBeInstanceOf(APIError);
    expect(err).toMatchObject({ status: 'FORBIDDEN', body: { code: 'not_invited' } });
  });

  it('laisse passer la création de compte pour une adresse invitée', async () => {
    await allow('lea@example.test');
    const before = dbHooks().user!.create!.before!;
    await expect(before({ email: 'lea@example.test' } as any)).resolves.toBeUndefined();
  });

  it('refuse la création de session pour une adresse retirée de la liste avec une APIError portant le code not_invited', async () => {
    const user = await createUser('ancien@example.test');
    const before = dbHooks().session!.create!.before!;
    const err = await captureRejection(before({ userId: user.id } as any));
    expect(err).toBeInstanceOf(APIError);
    expect(err).toMatchObject({ status: 'FORBIDDEN', body: { code: 'not_invited' } });
  });

  it('laisse passer la création de session pour un utilisateur invité', async () => {
    const user = await createAllowedUser('lea2@example.test');
    const before = dbHooks().session!.create!.before!;
    await expect(before({ userId: user.id } as any)).resolves.toBeUndefined();
  });
});

describe('getAuth', () => {
  it('réutilise la même instance Better Auth pour un même env (une par isolat)', () => {
    expect(getAuth(env)).toBe(getAuth(env));
    expect(getAuth({ ...env })).not.toBe(getAuth(env));
  });
});
