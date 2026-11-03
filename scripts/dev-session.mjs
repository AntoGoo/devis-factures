#!/usr/bin/env node
// Outil local uniquement (jamais importé par le Worker) : crée, dans la D1 LOCALE, l'utilisateur
// <email> s'il n'existe pas et une session de 7 jours, puis affiche le cookie de session Better Auth
// signé avec le BETTER_AUTH_SECRET de .dev.vars. Sert à piloter l'application dans un navigateur
// automatisé sans passer par Google.
//
//   node scripts/dev-session.mjs <email> [--config <wrangler.jsonc>] [--persist-to <dossier>]
//
// .dev.vars est lu à côté du fichier de configuration Wrangler (racine du projet par défaut).
// Le script refuse de tourner si BETTER_AUTH_URL n'est pas une adresse localhost.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const COOKIE_NAME = 'better-auth.session_token'; // nom en HTTP (sans préfixe __Secure-)
const SESSION_DAYS = 7;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function fail(message) {
  console.error(`dev-session : ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { email: null, config: 'wrangler.jsonc', persistTo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') options.config = argv[++i];
    else if (arg === '--persist-to') options.persistTo = argv[++i];
    else if (!arg.startsWith('--') && options.email === null) options.email = arg;
    else fail(`argument inattendu : ${arg}`);
  }
  if (!options.email) fail('usage : node scripts/dev-session.mjs <email> [--config <wrangler.jsonc>] [--persist-to <dossier>]');
  return options;
}

function readDevVars(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail(`fichier introuvable : ${path}`);
  }
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

function assertLocalhost(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fail('BETTER_AUTH_URL absente ou invalide dans .dev.vars.');
  }
  if (!LOCAL_HOSTS.has(host)) fail(`refus : BETTER_AUTH_URL (${url}) n'est pas une adresse localhost.`);
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** Signature identique à Better Auth (better-call) : HMAC-SHA256 en base64, `jeton.signature` encodé pour un cookie. */
function signedCookieValue(token, secret) {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

const options = parseArgs(process.argv.slice(2));
const configPath = resolve(options.config);
const vars = readDevVars(resolve(dirname(configPath), '.dev.vars'));
assertLocalhost(vars.BETTER_AUTH_URL);
if (!vars.BETTER_AUTH_SECRET) fail('BETTER_AUTH_SECRET absent de .dev.vars.');

const email = options.email.trim().toLowerCase();
if (!/^[^\s@']+@[^\s@']+$/.test(email)) fail(`adresse invalide : ${options.email}`);

const now = new Date();
const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
const token = randomBytes(24).toString('base64url');
const name = email.split('@')[0];

// Mêmes écritures que Better Auth (dates en ISO, booléens en 0/1) et que le crochet de dernière connexion.
const statements = [
  `INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
     VALUES (${sql(randomUUID())}, ${sql(name)}, ${sql(email)}, 1, NULL, ${sql(now.toISOString())}, ${sql(now.toISOString())})`,
  `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
     SELECT ${sql(randomUUID())}, ${sql(expires.toISOString())}, ${sql(token)}, ${sql(now.toISOString())}, ${sql(now.toISOString())}, '127.0.0.1', 'dev-session', id
     FROM "user" WHERE email = ${sql(email)}`,
  `INSERT INTO login_activity (email, last_login_at) VALUES (${sql(email)}, ${sql(now.toISOString())})
     ON CONFLICT (email) DO UPDATE SET last_login_at = excluded.last_login_at`,
];

const wranglerArgs = ['wrangler', 'd1', 'execute', 'DB', '--local', '--config', configPath, '--command', statements.join(';\n')];
if (options.persistTo) wranglerArgs.push('--persist-to', resolve(options.persistTo));
try {
  execFileSync('npx', wranglerArgs, { stdio: ['ignore', 'ignore', 'inherit'] });
} catch {
  fail('échec de l’écriture dans la D1 locale (migrations appliquées ? `npm run db:migrate:local`).');
}

console.log(`${COOKIE_NAME}=${signedCookieValue(token, vars.BETTER_AUTH_SECRET)}`);
