import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';
import type { AppEnv } from './types';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409;

export class HttpError extends Error {
  constructor(public status: ErrorStatus, public code: string, message: string) {
    super(message);
  }
}

export const notFound = (message = 'Élément introuvable.') => new HttpError(404, 'not_found', message);

export function onError(err: Error, c: Context<AppEnv>) {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'internal', message: 'Erreur interne. Réessayez dans un instant.' }, 500);
}

export const validate = <T extends ZodType>(target: 'json' | 'query' | 'param', schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'validation', message: 'Certaines données sont invalides.', issues: result.error.issues }, 400);
    }
  });
