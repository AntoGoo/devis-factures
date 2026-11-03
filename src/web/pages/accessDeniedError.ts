// Classe le paramètre ?error= renvoyé par Better Auth (ou RequireAuth) vers /acces-refuse,
// pour distinguer un refus d'invitation d'un échec technique de connexion.

export type AccessDeniedKind = 'invitation' | 'cancelled' | 'technical';

export interface AccessDeniedClassification {
  kind: AccessDeniedKind;
  /** Code assaini ([a-z_]{1,64}), "inconnu" si le paramètre brut ne respecte pas ce format, ou null si absent. */
  code: string | null;
}

const CODE_PATTERN = /^[a-z_]{1,64}$/;

function sanitizeCode(raw: string | null): string | null {
  if (!raw) return null;
  return CODE_PATTERN.test(raw) ? raw : 'inconnu';
}

export function classifyAccessDeniedError(raw: string | null): AccessDeniedClassification {
  const code = sanitizeCode(raw);
  if (code === null || code === 'not_invited') return { kind: 'invitation', code };
  if (code === 'access_denied') return { kind: 'cancelled', code };
  return { kind: 'technical', code };
}
