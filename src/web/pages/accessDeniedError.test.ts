import { describe, expect, it } from 'vitest';
import { classifyAccessDeniedError } from './accessDeniedError';

describe('classifyAccessDeniedError', () => {
  it('classe l’absence de paramètre comme invitation', () => {
    expect(classifyAccessDeniedError(null)).toEqual({ kind: 'invitation', code: null });
  });

  it('classe not_invited comme invitation', () => {
    expect(classifyAccessDeniedError('not_invited')).toEqual({ kind: 'invitation', code: 'not_invited' });
  });

  it('classe access_denied comme annulation', () => {
    expect(classifyAccessDeniedError('access_denied')).toEqual({ kind: 'cancelled', code: 'access_denied' });
  });

  it('classe un autre code connu comme erreur technique', () => {
    expect(classifyAccessDeniedError('invalid_code')).toEqual({ kind: 'technical', code: 'invalid_code' });
    expect(classifyAccessDeniedError('state_mismatch')).toEqual({ kind: 'technical', code: 'state_mismatch' });
    expect(classifyAccessDeniedError('please_restart_the_process')).toEqual({ kind: 'technical', code: 'please_restart_the_process' });
    expect(classifyAccessDeniedError('internal_server_error')).toEqual({ kind: 'technical', code: 'internal_server_error' });
  });

  it('assainit un code hors format en "inconnu" et le classe technique', () => {
    expect(classifyAccessDeniedError('<script>')).toEqual({ kind: 'technical', code: 'inconnu' });
    expect(classifyAccessDeniedError('A-1')).toEqual({ kind: 'technical', code: 'inconnu' });
    expect(classifyAccessDeniedError('a'.repeat(65))).toEqual({ kind: 'technical', code: 'inconnu' });
  });

  it('accepte un code de 64 caractères', () => {
    const code = 'a'.repeat(64);
    expect(classifyAccessDeniedError(code)).toEqual({ kind: 'technical', code });
  });
});
