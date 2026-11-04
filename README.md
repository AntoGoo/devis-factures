# Devis & Factures

Application web de devis et de factures pour micro-entrepreneurs (franchise en base de TVA, art. 293 B du CGI).
Du devis accepté aux factures d'acompte et de solde, sans ressaisie ; les documents s'impriment en PDF depuis le navigateur.
Accès fermé : connexion Google uniquement, sur invitation par le superadmin.

En production : https://devis-factures.naoned.workers.dev

## Architecture

- Un seul Cloudflare Worker (offre gratuite) : l'API [Hono](https://hono.dev) sous `/api/*`, l'interface servie en ressources statiques (repli SPA pour toutes les autres adresses).
- Interface React + Vite + TypeScript (`src/web`), API (`src/worker`), code partagé (`src/shared`), modèles de documents (`src/templates`).
- Base Cloudflare D1, schéma versionné dans `migrations/` (migrations Wrangler).
- Authentification [Better Auth](https://www.better-auth.com) avec Google comme seul fournisseur ; accès limité aux adresses de `allowed_emails` et au superadmin.
- Montants en centimes entiers ; numérotation `D-`, `F-`, `A-` par utilisateur et par année, sans trou, attribuée de façon atomique ; contenu figé (instantané JSON) à l'acceptation d'un devis et à l'émission d'une facture.

## Prérequis

- Node.js 22 ou plus récent (développé avec Node 24) et npm.
- Un compte Cloudflare (offre gratuite suffisante) pour déployer.
- Un identifiant OAuth Google (type « Application Web ») pour se connecter, y compris en local.

## Développement local

```bash
npm install
cp .dev.vars.example .dev.vars      # puis compléter les valeurs (voir ci-dessous)
npm run db:migrate:local
npm run dev                         # http://localhost:5173
```

Variables de `.dev.vars` (jamais versionné) :

| Variable | Rôle |
|---|---|
| `BETTER_AUTH_SECRET` | secret de signature des sessions : `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | adresse de l'application : `http://localhost:5173` en local |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | identifiant OAuth Google |
| `SUPERADMIN_EMAIL` | adresse Gmail du superadmin, toujours autorisée |

Pour la connexion Google en local, déclarer dans Google Cloud Console l'origine `http://localhost:5173` et l'URI de redirection `http://localhost:5173/api/auth/callback/google`.

### Session de test sans Google

`scripts/dev-session.mjs` crée dans la base D1 **locale** un utilisateur et une session, puis affiche le cookie à poser dans le navigateur. Il refuse de tourner si `BETTER_AUTH_URL` n'est pas une adresse `localhost`, et il n'est jamais publié.

```bash
node scripts/dev-session.mjs karim@example.test
```

L'adresse doit être autorisée (page « Accès » du superadmin, ou ligne dans `allowed_emails` de la base locale).

## Tests

```bash
npm test              # tout : interface puis Worker
npm run test:unit     # interface et code partagé (Vitest, jsdom)
npm run test:worker   # API dans le runtime Workers (@cloudflare/vitest-plugin, D1 réelle)
npm run typecheck
```

## Déploiement

Première mise en place :

```bash
npx wrangler login
npx wrangler d1 create devis-factures     # reporter database_id dans wrangler.jsonc
npm run db:migrate:remote
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL        # https://devis-factures.<sous-domaine>.workers.dev
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SUPERADMIN_EMAIL
```

Côté Google Cloud Console, sur l'identifiant OAuth : origine `https://devis-factures.<sous-domaine>.workers.dev` et URI de redirection `https://devis-factures.<sous-domaine>.workers.dev/api/auth/callback/google`.

À chaque version :

```bash
npm test
npm run db:migrate:remote      # seulement si une migration a été ajoutée
npm run deploy
scripts/smoke.sh https://devis-factures.naoned.workers.dev
```

`scripts/smoke.sh` vérifie sans session ni écriture : santé de l'API, refus sans session (401) et depuis une autre origine (403), pages servies, absence de l'outil de session de développement, en-têtes de sécurité. Il vise un déploiement : sous `npm run dev`, Vite n'applique pas `public/_headers` aux pages HTML et les en-têtes y sont signalés absents.

**Changer d'adresse** (autre sous-domaine `workers.dev` ou domaine personnalisé) : mettre à jour le secret `BETTER_AUTH_URL`, l'origine et l'URI de redirection Google, puis redéployer. `BETTER_AUTH_URL` sert aussi au contrôle d'origine des écritures de l'API.

## Gérer les accès

Le superadmin (`SUPERADMIN_EMAIL`) ajoute ou retire des adresses depuis la page **Accès (superadmin)** de l'application. Une personne non invitée qui se connecte voit la page « Accès sur invitation » ; aucun compte n'est créé pour elle.

En secours, directement en base de production :

```bash
npx wrangler d1 execute DB --remote --command \
  "INSERT OR IGNORE INTO allowed_emails (email, added_at, added_by) VALUES ('prenom.nom@gmail.com', strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'wrangler')"
```

## Modèles de documents

Trois modèles versionnés : Intemporel (`modele-01@1`), Discret (`modele-02@1`), Raffiné (`modele-03@1`). Pour en ajouter un ou en publier une nouvelle version, voir [`src/templates/README.md`](src/templates/README.md) : ajouter un modèle ne touche aucun autre fichier, et **un modèle publié ne change jamais** (les documents figés gardent leur version).

L'interface utilise une seule police, Inter. Chaque modèle garde ses propres polices (Archivo et Manrope, DM Sans, Fraunces et Source Sans 3), chargées seulement à l'affichage d'un document.

## Sécurité

- En-têtes posés deux fois, avec les mêmes valeurs (un test vérifie qu'ils sont identiques) : par le Worker pour `/api/*` (`src/worker/security-headers.ts`) et par `public/_headers` pour les ressources statiques et les pages.
- CSP sans `unsafe-inline` ni `unsafe-eval` : seuls Google Fonts sont autorisés en dehors de l'origine ; Zod tourne sans compilation dynamique (`src/web/zod-config.ts`).
- Les écritures de l'API exigent la même origine que `BETTER_AUTH_URL` ; chaque requête vérifie la session et l'invitation ; chaque donnée est filtrée par utilisateur.
- Les secrets ne sont que dans `.dev.vars` (local, ignoré par git) et dans les secrets Wrangler (production).

## Limites connues

- **PDF** : l'impression passe par le navigateur. Dans la fenêtre d'impression, choisir « Enregistrer au format PDF » et **décocher « En-têtes et pieds de page »**, sinon le navigateur ajoute l'adresse et la date dans les marges. Le rendu peut varier légèrement d'un navigateur à l'autre.
- **TVA** : V1 limitée à la franchise en base (art. 293 B du CGI) ; les champs de régime et de taux existent déjà en base pour la suite.
- **Avoirs** : uniquement des avoirs totaux.
- **Temps CPU** : l'offre gratuite limite chaque requête à 10 ms de CPU. Mesure à relever dans le tableau de bord Cloudflare (Workers & Pages → devis-factures → Metrics), en particulier pour `/api/auth/*`, `POST /api/invoices/:id/issue` et `GET /api/dashboard`. En cas de dépassement, le recours prévu est l'offre Workers Paid (5 $/mois).
- **Taille de l'interface** : le paquet JavaScript dépasse 500 ko (≈ 170 ko compressé) ; Vite l'indique à la construction, sans conséquence fonctionnelle.
