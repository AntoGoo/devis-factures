import type { MiddlewareHandler } from 'hono';

/**
 * En-têtes de sécurité de toute l'application. Les mêmes valeurs figurent dans `public/_headers` (pages et fichiers
 * statiques servis par les assets Cloudflare) ; `test/worker/security-headers.test.ts` vérifie qu'ils concordent.
 * - style-src sans 'unsafe-inline' : les styles du front et des modèles sont des fichiers CSS ; les props `style` de
 *   React passent par le CSSOM (element.style), que la CSP ne contrôle pas.
 * - font-src sans 'self' : aucune police locale, seules celles de Google Fonts.
 * - form-action 'self' : la connexion Google ne soumet pas de formulaire (fetch, puis window.location vers Google).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=15552000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

/** Pose les en-têtes de sécurité sur toutes les réponses du Worker, erreurs et réponses de Better Auth comprises. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
};
