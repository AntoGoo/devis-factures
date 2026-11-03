# Devis & Factures : plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE : utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** construire une application web, sur accès fermé, où un micro-entrepreneur en franchise de TVA rédige ses devis, les transforme en factures d'acompte puis de solde (ou en factures directes), corrige par avoir, et imprime chaque document en PDF dans l'un des 3 modèles visuels.

**Architecture :** un seul Worker Cloudflare sert l'interface React (assets statiques construits par Vite) et l'API Hono sous `/api/*`. Les données vivent dans D1. Les calculs (totaux, acomptes, solde) sont des fonctions pures partagées par le front et le Worker. Un document figé est un instantané JSON (`DocumentView`) affiché par un composant de rendu unique, habillé par des modèles versionnés que le registre découvre tout seul (`import.meta.glob`). La numérotation est attribuée par un batch D1 gardé : soit le compteur et le document changent ensemble, soit rien ne change.

**Pile :** Cloudflare Workers (offre gratuite) + `@cloudflare/vite-plugin`, React 19 + Vite + TypeScript, React Router, TanStack Query, Hono + Zod (`@hono/zod-validator`), D1 (migrations Wrangler), Better Auth (Google seul) avec Kysely + `kysely-d1`, Vitest (+ `@cloudflare/vitest-pool-workers` pour les tests contre une vraie D1 Miniflare), Testing Library.

**Spec :** `docs/specs/2026-11-03-devis-factures-design.md`. Maquettes de référence visuelle (couleurs, typographies, disposition, libellés, pas du code à copier) : `docs/maquettes/*.dc.html`. Chaque exécutant lit la spec, et les maquettes citées par sa tâche.

## Contraintes globales

Chaque tâche les respecte implicitement.

- Un seul Worker, offre gratuite : **10 ms de CPU par requête**. Aucun traitement lourd côté serveur, aucun PDF côté serveur. Les listes ne sélectionnent jamais `snapshot_json` ni `logo_data_url`.
- Connexion **Google uniquement** via Better Auth (adaptateur D1 via Kysely). Google sert seulement à la connexion (portées par défaut `openid email profile`).
- Accès fermé : table `allowed_emails` ; superadmin = variable `SUPERADMIN_EMAIL`, toujours autorisé. Comparaison d'adresses en minuscules, sans espaces.
- Retirer une adresse bloque les connexions suivantes **et** supprime les sessions en cours ; les données sont conservées.
- **Cloisonnement :** chaque requête SQL métier filtre par `user_id` issu de la session. Un identifiant (client, devis, facture) appartenant à un autre utilisateur répond `404`, y compris quand il est passé dans un corps de requête.
- Montants en **centimes entiers** (`*_cents`). Quantités en **millièmes entiers** (`quantity_milli`, 3 décimales). Pourcentages en **points de base** (`*_bp`, 2000 = 20 %).
- Acompte en pourcentage = **arrondi au centime inférieur** du total à payer du devis ; la facture de solde absorbe l'écart.
- Total de ligne = quantité × prix unitaire, arrondi au centime le plus proche (demi-centime éloigné de zéro) ; le total du document = somme des totaux de ligne arrondis.
- **V1 en franchise de TVA uniquement** : mention exacte `TVA non applicable, art. 293 B du CGI` ; total à payer = total HT. Le schéma prévoit `profiles.vat_regime` (valeur `franchise`, **sans contrainte CHECK** pour accueillir d'autres régimes sans reconstruire la table) et `vat_rate` (toujours `null` en V1) sur chaque ligne.
- Numérotation **par utilisateur, par série et par année civile (heure de Paris)** : `D-2026-001` (devis), `F-2026-001` (acomptes, soldes, factures directes : une seule suite), `A-2026-001` (avoirs). Format `printf('%s-%d-%03d')`. Attribuée à l'émission dans **un seul `db.batch`** gardé, sans trou. Un brouillon supprimé ne consomme pas de numéro. Préfixes modifiables (1 à 6 caractères `A-Z0-9`, tous différents). Numéro de départ réglable une seule fois par série.
- Date d'émission d'une facture ou d'un avoir = **date du jour à Paris**, non modifiable (garantit l'ordre chronologique).
- Une facture émise est **inaltérable et non supprimable** ; correction uniquement par **avoir total**.
- **Instantané JSON figé** à l'acceptation d'un devis et à l'émission d'une facture ou d'un avoir ; l'affichage et l'impression d'un document figé se font uniquement depuis cet instantané.
- **3 modèles en V1**, versionnés `modele-01@1` (Intemporel), `modele-02@1` (Discret), `modele-03@1` (Raffiné). Ajouter un modèle ou une version = ajouter un dossier `src/templates/<id>/v<n>/`, **sans toucher à aucun autre fichier**. Un modèle publié n'est jamais modifié en place.
- PDF = impression du navigateur : `@media print`, `@page { size: A4 }`, `thead { display: table-header-group }`, lignes jamais coupées, totaux et bon pour accord groupés. Cible Chrome/Edge ; Safari/Firefox lisibles.
- Interface et documents **en français** ; montants `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })` (ex. `1 234,50 €`, avec espaces insécables).
- Les libellés des lignes et textes libres restent neutres et modifiables : aucun vocabulaire de métier figé.
- Identité visuelle de l'application (maquettes) : polices `Bricolage Grotesque` (titres) et `Manrope` (texte), primaire `#3448E0`, fond `#F6F7FB` ; jetons complets en tâche 1.

## Points de vigilance (Review Focus)

Les cinq cas d'entrée que la spec implique sans les nommer, et qui risquent le plus de gêner un utilisateur réel. Chacun a son test dans la tâche qui possède le code.

1. **Saisie des montants « à la française »** (`1 234,56`, espace insécable collé depuis un tableur, `1.234,56`, `45 €`, `12,345`) : accepter les formes françaises, refuser explicitement plus de 2 décimales au lieu d'arrondir en silence. → tests en tâche 3.
2. **Les lignes vides restantes parmi les 5 par défaut** : ignorées dans les totaux, le rendu et l'instantané ; un devis ou une facture sans aucune ligne remplie ne peut pas être envoyé ou émis ; une ligne chiffrée sans désignation bloque l'envoi. → tests en tâches 12, 14 et 15.
3. **Double clic ou deux onglets sur « Marquer comme envoyé », « Émettre » ou « Créer un avoir »** : un seul numéro consommé, la seconde requête reçoit `409`, aucun trou. → tests en tâches 13, 19 et 20.
4. **Émission autour de minuit le 1er janvier, heure de Paris** (31/12 à 23 h 30 UTC = 1er janvier à Paris) : date et année de Paris, donc première facture de la nouvelle suite. → tests en tâches 3 et 19.
5. **Identifiant d'un autre utilisateur passé dans un corps de requête** (`clientId` à l'enregistrement d'un devis ou d'une facture, `quoteId` en URL de facturation) : `404`, rien n'est enregistré, aucune donnée étrangère ne peut apparaître dans un document. → tests en tâches 15 et 18.

## Décisions de conception prises par ce plan

La spec (§ 11) laisse ces points au constructeur. Les voici, pour que tu les valides avec le plan.

- **Lignes stockées en JSON** (`lines_json`) sur `quotes` et `invoices`, validées par Zod : une seule écriture atomique, ordre naturel, aucune jointure. Chaque ligne garde ses champs séparés (désignation, quantité, unité, prix, `vatRate`) pour un futur export Factur-X.
- **Numéro de devis attribué au passage à « envoyé »** (la maquette indique « numéro attribué à l'envoi »). L'aperçu d'un brouillon affiche « Brouillon » à la place du numéro.
- **Brouillons créés immédiatement** au clic sur « Nouveau devis » ou « Facture sans devis », puis enregistrés automatiquement (attente de 800 ms après la dernière frappe). Un brouillon peut être supprimé.
- **Les lignes vides sont conservées dans un brouillon** (ce que l'utilisateur voit est ce qui est enregistré) et retirées partout ailleurs (totaux, rendu, instantané).
- **Statuts en base en anglais** (`draft`, `sent`, `accepted`, `refused` ; `draft`, `issued`, `cancelled`), libellés en français dans l'interface. Le paiement est une colonne `paid_at` à part : une facture payée puis annulée reste comptée comme encaissée.
- **Adresses structurées** (rue, code postal, ville) dans le profil et les fiches clients au lieu d'un seul champ « Adresse » comme dans la maquette Profil : la spec § 7 demande des données champ par champ pour Factur-X.
- **Avoir créé et émis en une seule action** (avec confirmation) : un avoir total n'a rien à modifier. Son bloc entreprise et son client viennent du profil et de la fiche au moment de l'avoir ; ses lignes (négatives) et ses déductions d'acomptes viennent de l'instantané de la facture annulée, de sorte que l'avoir annule exactement le montant de cette facture.
- **Règles d'enchaînement des factures d'un devis :** pas de nouvel acompte quand une facture de solde active (brouillon ou émise) existe ; pas de facture de solde tant qu'un acompte est en brouillon ; une seule facture de solde active par devis (index unique partiel en base).
- **Champ « Acompte prévu (%) »** sur le devis (affiché dans le récapitulatif de la maquette Devis et proposé par défaut à l'écran Facturation).
- **Polices des modèles :** chaque modèle déclare son URL Google Fonts (`fontsHref`), chargée à l'affichage. Un nouveau modèle n'oblige donc pas à modifier `index.html`.
- **Ordre :** les calculs purs d'acompte et de solde sont écrits avec ceux des lignes en tâche 12 (début de la phase 3), parce que le rendu commun des documents (tâche 14) en dépend. Les fonctionnalités de facturation restent en phase 4, comme demandé.
- **Protection CSRF :** toute requête API non-GET dont l'en-tête `Origin` n'est pas celle de l'application est refusée (`403`).

## Structure des fichiers

```
wrangler.jsonc                  configuration du Worker (assets SPA, D1, run_worker_first /api/*)
vite.config.ts                  React + plugin Cloudflare
vitest.config.ts                tests unitaires et composants (node / jsdom)
vitest.worker.config.ts         tests d'intégration du Worker (pool Workers, D1 Miniflare)
tsconfig*.json                  app (DOM), worker (types Workers), node (configs)
index.html                      polices de l'interface, point d'entrée
.dev.vars.example               secrets locaux à recopier en .dev.vars (ignoré par git)
migrations/
  0001_auth.sql                 tables Better Auth
  0002_core.sql                 tables métier
src/shared/                     code pur, partagé front + Worker, testé en node
  money.ts                      centimes, millièmes, points de base : saisie et format fr-FR
  dates.ts                      date du jour à Paris, ajout de jours, formats français
  lines.ts                      schéma de ligne, total de ligne, totaux, lignes vides
  deposits.ts                   montant d'acompte (arrondi inférieur), plafond
  balance.ts                    solde : total − acomptes déduits
  numbering.ts                  formatDocumentNumber (miroir du printf SQL)
  legal.ts                      textes des mentions obligatoires
  document.ts                   DocumentView, buildDocumentView, buildCreditView, parseSnapshot
  status.ts                     statuts, libellés et tons
  profile.ts                    schéma du profil, isProfileComplete
  client.ts                     schéma de fiche client
  preset.ts                     schéma de ligne type
  api-types.ts                  types des réponses de l'API, partagés avec le front
src/worker/
  index.ts                      export du Worker (Better Auth branché)
  app.ts                        createApp(deps) : montage des routes, ordre des middlewares
  types.ts                      AppEnv, AppDeps, SessionUser
  errors.ts                     HttpError, onError, validate()
  access.ts                     liste d'accès, superadmin, dernière connexion
  auth.ts                       createAuth(env), crochets Better Auth, betterAuthSessionUser
  middleware.ts                 sameOrigin, requireUser, requireSuperadmin
  numbering.ts                  issueStatements / runIssue : batch D1 gardé
  views.ts                      quoteView / invoiceView : vue vivante ou instantané
  db/profiles.ts db/clients.ts db/presets.ts db/quotes.ts db/invoices.ts   accès aux tables
  routes/me.ts admin.ts profile.ts clients.ts presets.ts quotes.ts invoices.ts billing.ts dashboard.ts
src/templates/                  modèles visuels, découverts automatiquement
  types.ts catalog.ts (sans React, utilisé par le Worker) registry.ts (front)
  modele-01/v1/{meta.ts,index.tsx,style.css}   Intemporel
  modele-02/v1/{meta.ts,index.tsx,style.css}   Discret
  modele-03/v1/{meta.ts,index.tsx,style.css}   Raffiné
  README.md                     comment ajouter un modèle ou une version
src/web/
  main.tsx App.tsx api.ts auth-client.ts query.ts test-setup.ts
  styles/tokens.css base.css
  session/useMe.ts RequireAuth.tsx onboarding.ts
  layout/AppShell.tsx
  pages/LoginPage.tsx AccessDeniedPage.tsx AdminPage.tsx TemplatePickerPage.tsx ProfilePage.tsx
        ClientsPage.tsx LinePresetsPage.tsx QuotesListPage.tsx QuoteEditorPage.tsx QuoteBillingPage.tsx
        InvoicesListPage.tsx InvoicePage.tsx DashboardPage.tsx PrintPage.tsx
  components/StatusBadge.tsx Dialog.tsx ClientFormDialog.tsx DocumentToolbar.tsx
  lines/lineDrafts.ts LinesEditor.tsx PresetPickerDialog.tsx useAutosave.ts
  document/DocumentRenderer.tsx document.css useTemplateFonts.ts printTitle.ts
  billing/DepositPanel.tsx
  profile/logo.ts
test/worker/                    tests d'intégration (une vraie D1 par fichier)
  env.d.ts apply-migrations.ts helpers.ts *.test.ts
```

## Conventions

- `npm run test:unit` : Vitest en node ; les fichiers de test React commencent par `// @vitest-environment jsdom`.
- `npm run test:worker` : Vitest dans le pool Workers, migrations appliquées sur une D1 Miniflare isolée par fichier. Les tests appellent `createApp(testDeps)` directement ; l'utilisateur de test est transmis par l'en-tête `x-test-user`, qui n'existe que dans `test/worker/helpers.ts` (le Worker de production n'utilise que Better Auth).
- `npm test` lance les deux. `npm run typecheck` lance `tsc -b`.
- Erreurs API : `{ "error": "<code>", "message": "<phrase en français affichable>" }`. Codes HTTP : 400 validation, 401 non connecté, 403 non invité ou interdit, 404 introuvable (y compris « appartient à un autre utilisateur »), 409 conflit de règle métier.
- Dates sans heure en `YYYY-MM-DD` (TEXT) ; horodatages en ISO 8601 UTC (TEXT).
- Commits fréquents, un par étape « Commit », messages au format `type: description` en français.
- Quand une étape dit « Ajouter à » un fichier existant, fusionner les imports en tête de ce fichier et retirer ceux qui deviennent inutiles (`noUnusedLocals` est actif).

---

# Phase 1 : socle

### Tâche 1 : squelette du projet (Worker + Vite + React + Hono + tests)

**Fichiers :**
- Créer : `package.json`, `vite.config.ts`, `wrangler.jsonc`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.worker.json`, `tsconfig.node.json`, `vitest.config.ts`, `vitest.worker.config.ts`, `index.html`, `.gitignore`, `.dev.vars.example`, `.dev.vars`, `migrations/.gitkeep`
- Créer : `src/worker/index.ts`, `src/worker/app.ts`, `src/worker/types.ts`
- Créer : `src/web/main.tsx`, `src/web/App.tsx`, `src/web/test-setup.ts`, `src/web/styles/tokens.css`, `src/web/styles/base.css`
- Créer : `test/worker/env.d.ts`, `test/worker/apply-migrations.ts`
- Tests : `test/worker/health.test.ts`, `src/web/App.test.tsx`

**Interfaces :**
- Produit : `createApp(deps: AppDeps): Hono<AppEnv>` ; `type SessionUser = { id: string; email: string; name: string }` ; `type AppDeps = { getSessionUser(req: Request, env: Env): Promise<SessionUser | null>; now(): Date }` ; `type AppEnv = { Bindings: Env; Variables: { deps: AppDeps; user: SessionUser } }` ; route `GET /api/health → { ok: true }`.

- [ ] **Étape 1 : initialiser le dépôt et installer les dépendances**

```bash
cd /home/anto/projects/Commerce
git init
npm init -y
npm install react react-dom react-router @tanstack/react-query hono @hono/zod-validator zod better-auth kysely kysely-d1
npm install -D vite @vitejs/plugin-react @cloudflare/vite-plugin wrangler typescript @types/react @types/react-dom @types/node vitest @cloudflare/vitest-pool-workers jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Si npm signale un conflit de dépendance entre `vitest` et `@cloudflare/vitest-pool-workers`, installer la version de Vitest exigée : `npm info @cloudflare/vitest-pool-workers peerDependencies`, puis `npm install -D vitest@<version>`.

- [ ] **Étape 2 : écrire `package.json` (scripts)**

Remplacer le bloc `scripts` et ajouter `"type": "module"` et `"private": true` :

```json
{
  "name": "devis-factures",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "typecheck": "tsc -b",
    "cf-typegen": "wrangler types",
    "db:migrate:local": "wrangler d1 migrations apply DB --local",
    "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
    "test": "npm run test:unit && npm run test:worker",
    "test:unit": "vitest run",
    "test:worker": "vitest run -c vitest.worker.config.ts"
  }
}
```

- [ ] **Étape 3 : configuration Vite, Wrangler et secrets locaux**

`vite.config.ts` :

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
});
```

`wrangler.jsonc` (l'identifiant D1 réel est renseigné en tâche 26 ; en local, Wrangler accepte celui-ci) :

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "devis-factures",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "devis-factures",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "observability": { "enabled": true }
}
```

Si `wrangler` refuse la `compatibility_date` (plus récente que son runtime), prendre la date qu'il propose.

`.dev.vars.example` (versionné) et `.dev.vars` (même contenu, rempli, ignoré par git ; générer le secret avec `openssl rand -base64 32`) :

```
BETTER_AUTH_SECRET=remplacer-par-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SUPERADMIN_EMAIL=antogouvrillon@gmail.com
```

`.gitignore` :

```
node_modules
dist
.wrangler
.dev.vars
*.tsbuildinfo
```

Puis générer les types de l'environnement : `npm run cf-typegen` (crée `worker-configuration.d.ts` avec `Env { DB: D1Database; BETTER_AUTH_SECRET: string; … }`).

- [ ] **Étape 4 : configurations TypeScript**

`tsconfig.json` :

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.worker.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json` :

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vite/client", "@testing-library/jest-dom"]
  },
  "include": ["src/web", "src/shared", "src/templates"]
}
```

`tsconfig.worker.json` :

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.worker.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["./worker-configuration.d.ts", "vite/client", "@cloudflare/vitest-pool-workers"]
  },
  "include": [
    "src/worker",
    "src/shared",
    "src/templates/types.ts",
    "src/templates/catalog.ts",
    "src/templates/*/v*/meta.ts",
    "test/worker"
  ]
}
```

`tsconfig.node.json` :

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts", "vitest.worker.config.ts"]
}
```

- [ ] **Étape 5 : configurations de test**

`vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./src/web/test-setup.ts'],
  },
});
```

`vitest.worker.config.ts` (D1 déclarée directement pour Miniflare, sans lire `wrangler.jsonc`, afin de ne pas dépendre de la configuration des assets) :

```ts
import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    test: {
      include: ['test/worker/**/*.test.ts'],
      setupFiles: ['./test/worker/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          miniflare: {
            compatibilityDate: '2026-10-01',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: ['DB'],
            bindings: {
              TEST_MIGRATIONS: migrations,
              SUPERADMIN_EMAIL: 'boss@example.test',
              BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
              BETTER_AUTH_URL: 'http://localhost:5173',
              GOOGLE_CLIENT_ID: 'test',
              GOOGLE_CLIENT_SECRET: 'test',
            },
          },
        },
      },
    },
  };
});
```

Si la version installée de `@cloudflare/vitest-pool-workers` n'expose plus `defineWorkersConfig`, reprendre la configuration de l'exemple officiel D1 (`workers-sdk/fixtures/vitest-pool-workers-examples/d1`) en gardant les mêmes liaisons.

`test/worker/env.d.ts` :

```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

`test/worker/apply-migrations.ts` :

```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`src/web/test-setup.ts` :

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
```

Créer `migrations/.gitkeep` (vide).

- [ ] **Étape 6 : écrire les tests qui échouent**

`test/worker/health.test.ts` :

```ts
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
```

`src/web/App.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('affiche le nom de l’application', () => {
  render(<App />);
  expect(screen.getByText('Devis & Factures')).toBeInTheDocument();
});
```

- [ ] **Étape 7 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL, `Cannot find module '../../src/worker/app'` et `Cannot find module './App'`.

- [ ] **Étape 8 : écrire le code minimal**

`src/worker/types.ts` :

```ts
import type { Context } from 'hono';

export type SessionUser = { id: string; email: string; name: string };

export type AppDeps = {
  getSessionUser: (req: Request, env: Env) => Promise<SessionUser | null>;
  now: () => Date;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: AppDeps; user: SessionUser };
};

export type AppContext = Context<AppEnv>;
```

`src/worker/app.ts` :

```ts
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from './types';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.get('/api/health', (c) => c.json({ ok: true }));
  return app;
}
```

`src/worker/index.ts` (la session est branchée sur Better Auth en tâche 5) :

```ts
import { createApp } from './app';

const app = createApp({ getSessionUser: async () => null, now: () => new Date() });

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
```

`index.html` (polices de l'interface seulement ; celles des modèles sont chargées par les modèles) :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Devis &amp; Factures</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Manrope:wght@400;500;600;700&display=swap" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

`src/web/main.tsx` :

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/web/App.tsx` (remplacé en tâche 5 par le routeur) :

```tsx
export function App() {
  return <h1 className="page-title">Devis &amp; Factures</h1>;
}
```

`src/web/styles/tokens.css` (valeurs relevées dans les maquettes) :

```css
:root {
  --c-bg: #F6F7FB;
  --c-surface: #FFFFFF;
  --c-border: #E3E6EE;
  --c-border-input: #D5D9E3;
  --c-border-soft: #EEF0F5;
  --c-text: #14161F;
  --c-text-muted: #5B6273;
  --c-text-soft: #4A5163;
  --c-text-ink: #3A4170;
  --c-primary: #3448E0;
  --c-primary-strong: #2233B8;
  --c-primary-soft: #EBEEFF;
  --c-primary-softer: #F3F5FF;
  --c-primary-line: #C9D0F5;
  --c-primary-panel: #D9DEFA;
  --c-login-panel: #E9ECFB;
  --c-login-card-border: #D5DBF5;
  --c-danger: #A12A1E;
  --c-danger-soft: #FBE5E2;
  --c-danger-border: #E5B9B4;
  --c-warn: #8A5300;
  --c-warn-soft: #FFF1DC;
  --c-success: #1F6B43;
  --c-success-soft: #E2F3E9;
  --c-neutral-soft: #E6E9F0;
  --c-placeholder: #B7BDCC;
  --c-avatar: #F2B544;
  --font-display: 'Bricolage Grotesque', sans-serif;
  --font-body: Manrope, system-ui, sans-serif;
  --radius-sm: 10px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 18px;
}
```

`src/web/styles/base.css` (classes réutilisées par toutes les pages ; dimensions des maquettes) :

```css
* { box-sizing: border-box; }
body { margin: 0; background: var(--c-bg); color: var(--c-text); font-family: var(--font-body); }
a { color: var(--c-text-soft); }
a:hover { color: var(--c-text); }
input, select, textarea { font-family: var(--font-body); color: var(--c-text); }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--c-primary); outline-offset: 1px; }

.page-title { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 34px; letter-spacing: -0.02em; }
.page-intro { margin: 0; font-size: 16px; line-height: 1.6; color: var(--c-text-muted); max-width: 660px; }
.eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-primary); }

.card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-xl); padding: 22px; }
.card-title { margin: 0; font-family: var(--font-display); font-size: 19px; font-weight: 700; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
.span-all { grid-column: 1 / -1; }

.field { display: flex; flex-direction: column; gap: 6px; font-size: 14px; font-weight: 600; }
.field-hint { font-weight: 500; color: var(--c-text-muted); }
.field-error { font-weight: 600; color: var(--c-danger); font-size: 13px; }
.input { height: 46px; border-radius: var(--radius-md); border: 1px solid var(--c-border-input); padding: 0 14px; font-size: 15px; background: var(--c-surface); }
.input[aria-invalid='true'] { border-color: var(--c-danger); }
textarea.input { height: auto; padding: 12px 14px; resize: vertical; }

.btn { height: 46px; padding: 0 18px; border-radius: var(--radius-md); font-family: inherit; font-weight: 700; font-size: 15px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
.btn-primary { border: none; background: var(--c-primary); color: #FFFFFF; }
.btn-primary:hover { background: var(--c-primary-strong); }
.btn-secondary { border: 1px solid var(--c-border-input); background: var(--c-surface); color: var(--c-text); }
.btn-danger { border: 1px solid var(--c-danger-border); background: var(--c-surface); color: var(--c-danger); height: 36px; padding: 0 14px; border-radius: var(--radius-sm); font-size: 14px; }
.btn-dashed { border: 1.5px dashed var(--c-primary); background: var(--c-primary-softer); color: var(--c-primary-strong); height: 44px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.badge { display: inline-block; padding: 5px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; }
.tone-paid { color: var(--c-success); background: var(--c-success-soft); }
.tone-late { color: var(--c-danger); background: var(--c-danger-soft); }
.tone-wait { color: var(--c-warn); background: var(--c-warn-soft); }
.tone-ok { color: var(--c-primary-strong); background: var(--c-primary-soft); }
.tone-draft, .tone-neutral { color: var(--c-text-soft); background: var(--c-border-soft); }

.notice { display: flex; gap: 12px; align-items: flex-start; background: var(--c-primary-soft); color: var(--c-primary-strong); border-radius: var(--radius-md); padding: 14px 16px; font-size: 14px; line-height: 1.55; }
.notice-error { background: var(--c-danger-soft); color: var(--c-danger); }

.table-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-xl); overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 15px; min-width: 640px; }
.table th { text-align: left; color: var(--c-text-muted); font-size: 13px; font-weight: 700; padding: 14px 20px; border-bottom: 1px solid var(--c-border); }
.table td { padding: 15px 20px; border-bottom: 1px solid var(--c-border-soft); }
.table tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.visually-hidden { position: absolute; left: -9999px; }
```

- [ ] **Étape 9 : relancer les tests et la vérification de types**

Run: `npm test && npm run typecheck`
Expected: PASS (2 tests), aucune erreur de type.

- [ ] **Étape 10 : vérifier le serveur de développement**

Run: `npm run dev`, ouvrir `http://localhost:5173` puis `http://localhost:5173/api/health`.
Expected: la page affiche « Devis & Factures » ; l'API répond `{"ok":true}`.

- [ ] **Étape 11 : commit**

```bash
git add -A
git commit -m "chore: squelette Worker + Vite + React + Hono et outillage de tests"
```

**Critère de fin :** `npm test` et `npm run typecheck` passent ; `npm run dev` sert la page et `/api/health`.

---

### Tâche 2 : schéma D1 (migrations)

**Fichiers :**
- Créer : `migrations/0001_auth.sql`, `migrations/0002_core.sql`
- Test : `test/worker/schema.test.ts`

**Interfaces :**
- Produit : les tables `user`, `session`, `account`, `verification` (Better Auth) ; `allowed_emails`, `login_activity`, `profiles`, `clients`, `line_presets`, `quotes`, `invoices`, `counters`, avec les index uniques `quotes_number`, `invoices_number`, `invoices_one_active_final`.

- [ ] **Étape 1 : écrire le test qui échoue**

`test/worker/schema.test.ts` :

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const now = '2026-11-03T10:00:00.000Z';

async function insertUser(id: string, email: string) {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  ).bind(id, 'Test', email, now, now).run();
}

async function insertInvoice(id: string, userId: string, extra: Record<string, string | number | null> = {}) {
  const row = { id, user_id: userId, kind: 'standalone', status: 'draft', created_at: now, updated_at: now, ...extra };
  const cols = Object.keys(row);
  await env.DB.prepare(
    `INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).bind(...Object.values(row)).run();
}

describe('schéma D1', () => {
  it('crée toutes les tables', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const t of ['user', 'session', 'account', 'verification', 'allowed_emails', 'login_activity', 'profiles', 'clients', 'line_presets', 'quotes', 'invoices', 'counters']) {
      expect(names).toContain(t);
    }
  });

  it('refuse deux compteurs pour le même utilisateur, la même série et la même année', async () => {
    await insertUser('u1', 'a@example.test');
    await env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES ('u1', 'F', 2026, 1)").run();
    await expect(
      env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES ('u1', 'F', 2026, 2)").run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it('autorise le même numéro pour deux utilisateurs différents, pas pour le même', async () => {
    await insertUser('u1', 'a@example.test');
    await insertUser('u2', 'b@example.test');
    await insertInvoice('i1', 'u1', { number: 'F-2026-001', status: 'issued' });
    await insertInvoice('i2', 'u2', { number: 'F-2026-001', status: 'issued' });
    await expect(insertInvoice('i3', 'u1', { number: 'F-2026-001', status: 'issued' })).rejects.toThrow(/UNIQUE/);
  });

  it('autorise une seule facture de solde non annulée par devis', async () => {
    await insertUser('u1', 'a@example.test');
    await env.DB.prepare(
      "INSERT INTO quotes (id, user_id, status, validity_days, created_at, updated_at) VALUES ('q1', 'u1', 'accepted', 30, ?, ?)",
    ).bind(now, now).run();
    await insertInvoice('f1', 'u1', { kind: 'final', quote_id: 'q1', status: 'cancelled' });
    await insertInvoice('f2', 'u1', { kind: 'final', quote_id: 'q1', status: 'draft' });
    await expect(insertInvoice('f3', 'u1', { kind: 'final', quote_id: 'q1', status: 'draft' })).rejects.toThrow(/UNIQUE/);
  });

  it('prévoit vat_regime sans contrainte CHECK et la franchise par défaut', async () => {
    await insertUser('u1', 'a@example.test');
    await env.DB.prepare("INSERT INTO profiles (user_id, template_ref, created_at, updated_at) VALUES ('u1', 'modele-01@1', ?, ?)").bind(now, now).run();
    const row = await env.DB.prepare("SELECT vat_regime FROM profiles WHERE user_id = 'u1'").first<{ vat_regime: string }>();
    expect(row?.vat_regime).toBe('franchise');
    await env.DB.prepare("UPDATE profiles SET vat_regime = 'reel' WHERE user_id = 'u1'").run();
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:worker -- schema`
Expected: FAIL, tables absentes (`no such table: user`).

- [ ] **Étape 3 : écrire `migrations/0001_auth.sql`**

Schéma de base de Better Auth pour SQLite. Après l'installation, comparer avec la page « Database / Core Schema » de la documentation Better Auth pour la version installée et aligner si une colonne a changé.

```sql
CREATE TABLE "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId" ON "session" ("userId");

CREATE TABLE "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE,
  "updatedAt" DATE
);
```

- [ ] **Étape 4 : écrire `migrations/0002_core.sql`**

```sql
-- Liste d'accès (adresses en minuscules)
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL
);

-- Dernière connexion, y compris celle du superadmin (absent de allowed_emails)
CREATE TABLE login_activity (
  email TEXT PRIMARY KEY,
  last_login_at TEXT NOT NULL
);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user" (id),
  template_ref TEXT NOT NULL,
  trade_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  activity_line TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  siret TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT,
  vat_regime TEXT NOT NULL DEFAULT 'franchise',          -- pas de CHECK : d'autres régimes viendront
  insurer TEXT NOT NULL DEFAULT '',
  insurance_policy TEXT NOT NULL DEFAULT '',
  insurance_area TEXT NOT NULL DEFAULT '',
  default_quote_validity_days INTEGER NOT NULL DEFAULT 30,
  default_payment_delay_days INTEGER NOT NULL DEFAULT 30,
  late_penalty_text TEXT NOT NULL DEFAULT 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.',
  payment_details TEXT NOT NULL DEFAULT '',
  prefix_quote TEXT NOT NULL DEFAULT 'D',
  prefix_invoice TEXT NOT NULL DEFAULT 'F',
  prefix_credit TEXT NOT NULL DEFAULT 'A',
  units_json TEXT NOT NULL DEFAULT '["u","h","jour","forfait","lot","m²","ml"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  type TEXT NOT NULL,                       -- 'individual' | 'business'
  name TEXT NOT NULL,
  street TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'FR',
  siren TEXT NOT NULL DEFAULT '',           -- 9 chiffres (SIREN) ou 14 (SIRET)
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX clients_user_name ON clients (user_id, name);

CREATE TABLE line_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  designation TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  vat_rate REAL,                            -- toujours NULL en V1
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX line_presets_user ON line_presets (user_id, designation);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  client_id TEXT REFERENCES clients (id),
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | sent | accepted | refused
  object TEXT NOT NULL DEFAULT '',
  intervention_address TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL,
  planned_start TEXT NOT NULL DEFAULT '',
  estimated_duration TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  planned_deposit_bp INTEGER,
  quote_date TEXT,                          -- date du devis, fixée à l'envoi
  sent_at TEXT,
  accepted_at TEXT,
  refused_at TEXT,
  snapshot_json TEXT,                       -- instantané figé à l'acceptation
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX quotes_number ON quotes (user_id, number) WHERE number IS NOT NULL;
CREATE INDEX quotes_user_status ON quotes (user_id, status, updated_at);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id),
  kind TEXT NOT NULL,                       -- deposit | final | standalone | credit
  quote_id TEXT REFERENCES quotes (id),
  credited_invoice_id TEXT REFERENCES invoices (id),  -- sur un avoir : la facture annulée
  credited_by_id TEXT,                      -- sur une facture annulée : son avoir
  client_id TEXT REFERENCES clients (id),
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | issued | cancelled
  object TEXT NOT NULL DEFAULT '',
  intervention_address TEXT,
  lines_json TEXT NOT NULL DEFAULT '[]',
  deposit_bp INTEGER,                       -- acompte en pourcentage, sinon NULL
  total_ht_cents INTEGER NOT NULL DEFAULT 0,
  amount_due_cents INTEGER NOT NULL DEFAULT 0,  -- montant à payer de CE document (négatif pour un avoir)
  service_date TEXT,
  due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  issue_date TEXT,
  paid_at TEXT,
  cancelled_at TEXT,
  snapshot_json TEXT,                       -- instantané figé à l'émission
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX invoices_number ON invoices (user_id, number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX invoices_one_active_final ON invoices (quote_id) WHERE kind = 'final' AND status != 'cancelled';
CREATE INDEX invoices_user_status ON invoices (user_id, status, updated_at);
CREATE INDEX invoices_quote ON invoices (quote_id, kind, status);

CREATE TABLE counters (
  user_id TEXT NOT NULL REFERENCES "user" (id),
  series TEXT NOT NULL,                     -- 'D' | 'F' | 'A'
  year INTEGER NOT NULL,
  last_value INTEGER NOT NULL,
  PRIMARY KEY (user_id, series, year)
);
```

- [ ] **Étape 5 : relancer le test**

Run: `npm run test:worker -- schema`
Expected: PASS (5 tests).

- [ ] **Étape 6 : appliquer en local**

Run: `npm run db:migrate:local`
Expected: « 2 migrations applied ».

- [ ] **Étape 7 : commit**

```bash
git add migrations test/worker/schema.test.ts
git commit -m "feat: schéma D1 (Better Auth, profils, clients, devis, factures, compteurs)"
```

**Critère de fin :** les migrations s'appliquent en local et en test ; l'unicité des compteurs, des numéros par utilisateur et du solde actif est garantie par la base.

---

### Tâche 3 : utilitaires partagés (montants, quantités, pourcentages, dates de Paris)

**Fichiers :**
- Créer : `src/shared/money.ts`, `src/shared/dates.ts`
- Tests : `src/shared/money.test.ts`, `src/shared/dates.test.ts`

**Interfaces :**
- Produit (`money.ts`) : `formatEuros(cents: number): string` ; `formatCentsForInput(cents: number): string` (`'1234,50'`, sans symbole ni séparateur de milliers) ; `parseEuros(input: string): number | null` ; `parseQuantity(input: string): number | null` (millièmes) ; `formatQuantity(milli: number): string` ; `parsePercent(input: string): number | null` (points de base, 0 < p ≤ 100 %) ; `formatPercent(bp: number): string` ; `MAX_ABS_CENTS = 100_000_000_000`.
- Produit (`dates.ts`) : `todayInParis(now: Date): string` ; `yearOf(iso: string): number` ; `addDays(iso: string, days: number): string` ; `monthRange(iso: string): { start: string; end: string }` ; `formatDateLong(iso: string): string` (`31 octobre 2026`) ; `formatDateShort(iso: string): string` (`28 oct. 2026`) ; `isIsoDate(s: string): boolean`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/shared/money.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { formatCentsForInput, formatEuros, formatPercent, formatQuantity, parseEuros, parsePercent, parseQuantity } from './money';

// Intl utilise des espaces insécables (U+202F, U+00A0) : on les normalise pour comparer.
const plain = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ').replace(/\u2212/g, '-');

describe('formatEuros', () => {
  it('formate au format français', () => {
    expect(plain(formatEuros(123450))).toBe('1 234,50 €');
    expect(plain(formatEuros(0))).toBe('0,00 €');
    expect(plain(formatEuros(-280000))).toBe('-2 800,00 €');
  });
});

describe('formatCentsForInput', () => {
  it('écrit une valeur modifiable sans séparateur de milliers', () => {
    expect(formatCentsForInput(123450)).toBe('1234,50');
    expect(formatCentsForInput(5)).toBe('0,05');
    expect(formatCentsForInput(-5000)).toBe('-50,00');
  });
});

describe('parseEuros (vigilance n° 1 : saisie à la française)', () => {
  it.each([
    ['380', 38000],
    ['380,5', 38050],
    ['1150.00', 115000],
    ['1 234,56', 123456],
    ['1\u202F234,56', 123456],
    ['1\u00A0234,56', 123456],
    ['1.234,56', 123456],
    [' 45 € ', 4500],
    ['45€', 4500],
    ['-50', -5000],
    ['0', 0],
  ])('lit %j comme %i centimes', (input, cents) => {
    expect(parseEuros(input)).toBe(cents);
  });

  it.each(['', '  ', 'abc', '12,345', '1,2,3', '--5', '1e5', '12.'])('refuse %j', (input) => {
    expect(parseEuros(input)).toBeNull();
  });

  it('refuse les montants au-delà d’un milliard d’euros', () => {
    expect(parseEuros('1000000001')).toBeNull();
  });
});

describe('quantités', () => {
  it.each([
    ['1', 1000],
    ['2,5', 2500],
    ['0,125', 125],
    ['8', 8000],
    ['1 000', 1000000],
  ])('lit %j comme %i millièmes', (input, milli) => {
    expect(parseQuantity(input)).toBe(milli);
  });

  it.each(['', '-1', '0,1234', 'x'])('refuse %j', (input) => {
    expect(parseQuantity(input)).toBeNull();
  });

  it('formate sans zéros inutiles', () => {
    expect(formatQuantity(1000)).toBe('1');
    expect(formatQuantity(2500)).toBe('2,5');
    expect(plain(formatQuantity(1250000))).toBe('1 250');
  });
});

describe('pourcentages', () => {
  it.each([
    ['20', 2000],
    ['20 %', 2000],
    ['12,5%', 1250],
    ['100', 10000],
  ])('lit %j comme %i points de base', (input, bp) => {
    expect(parsePercent(input)).toBe(bp);
  });

  it.each(['0', '100,01', '-5', '', '12,345'])('refuse %j', (input) => {
    expect(parsePercent(input)).toBeNull();
  });

  it('formate', () => {
    expect(plain(formatPercent(2000))).toBe('20 %');
    expect(plain(formatPercent(1250))).toBe('12,5 %');
  });
});
```

`src/shared/dates.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { addDays, formatDateLong, formatDateShort, isIsoDate, monthRange, todayInParis, yearOf } from './dates';

describe('todayInParis (vigilance n° 4 : minuit du 1er janvier)', () => {
  it('donne la date de Paris, pas celle de UTC', () => {
    expect(todayInParis(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayInParis(new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
    expect(todayInParis(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
    expect(todayInParis(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });
});

describe('calculs de dates', () => {
  it('ajoute des jours en franchissant les mois et années', () => {
    expect(addDays('2026-11-03', 30)).toBe('2026-12-03');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('extrait l’année', () => {
    expect(yearOf('2027-01-01')).toBe(2027);
  });

  it('donne les bornes du mois', () => {
    expect(monthRange('2026-11-03')).toEqual({ start: '2026-11-01', end: '2026-12-01' });
    expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });

  it('valide le format', () => {
    expect(isIsoDate('2026-11-03')).toBe(true);
    expect(isIsoDate('2026-13-03')).toBe(false);
    expect(isIsoDate('03/11/2026')).toBe(false);
  });
});

describe('formats français', () => {
  it('écrit les dates longues et courtes', () => {
    expect(formatDateLong('2026-10-31')).toBe('31 octobre 2026');
    expect(formatDateShort('2026-10-28')).toBe('28 oct. 2026');
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/shared`
Expected: FAIL, `Cannot find module './money'` et `'./dates'`.

- [ ] **Étape 3 : écrire `src/shared/money.ts`**

```ts
export const MAX_ABS_CENTS = 100_000_000_000; // 1 milliard d'euros

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const QTY = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const PCT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatEuros(cents: number): string {
  return EUR.format(cents / 100);
}

export function formatCentsForInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Normalise une saisie décimale française ; renvoie [signe, partie entière, décimales] ou null. */
function splitDecimal(input: string, maxDecimals: number, allowNegative: boolean): [number, string, string] | null {
  let s = input.replace(/[\s\u00A0\u202F]/g, '').replace(/€$/, '').replace(/%$/, '');
  if (s === '') return null;
  let sign = 1;
  if (s.startsWith('-')) {
    if (!allowNegative) return null;
    sign = -1;
    s = s.slice(1);
  }
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, ''); // « 1.234,56 »
  s = s.replace(',', '.');
  const re = new RegExp(`^(\\d+)(?:\\.(\\d{1,${maxDecimals}}))?$`);
  const m = re.exec(s);
  if (!m) return null;
  return [sign, m[1], m[2] ?? ''];
}

function toScaled(intPart: string, frac: string, decimals: number): number {
  return Number(intPart) * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
}

export function parseEuros(input: string): number | null {
  const parts = splitDecimal(input, 2, true);
  if (!parts) return null;
  const [sign, i, f] = parts;
  const cents = sign * toScaled(i, f, 2);
  if (Math.abs(cents) > MAX_ABS_CENTS) return null;
  return cents === 0 ? 0 : cents;
}

export function parseQuantity(input: string): number | null {
  const parts = splitDecimal(input, 3, false);
  if (!parts) return null;
  const milli = toScaled(parts[1], parts[2], 3);
  return milli > 1_000_000_000 ? null : milli;
}

export function formatQuantity(milli: number): string {
  return QTY.format(milli / 1000);
}

export function parsePercent(input: string): number | null {
  const parts = splitDecimal(input, 2, false);
  if (!parts) return null;
  const bp = toScaled(parts[1], parts[2], 2);
  return bp > 0 && bp <= 10_000 ? bp : null;
}

export function formatPercent(bp: number): string {
  return `${PCT.format(bp / 100)}\u00A0%`;
}
```

- [ ] **Étape 4 : écrire `src/shared/dates.ts`**

```ts
const PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function todayInParis(now: Date): string {
  const parts = Object.fromEntries(PARIS.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start, end };
}

export function formatDateLong(iso: string): string {
  return LONG.format(new Date(`${iso}T00:00:00Z`));
}

export function formatDateShort(iso: string): string {
  return SHORT.format(new Date(`${iso}T00:00:00Z`));
}
```

- [ ] **Étape 5 : relancer les tests**

Run: `npm run test:unit -- src/shared`
Expected: PASS.

- [ ] **Étape 6 : commit**

```bash
git add src/shared
git commit -m "feat: saisie et format des montants, quantités, pourcentages et dates de Paris"
```

**Critère de fin :** toutes les formes de saisie françaises listées sont lues ou refusées comme prévu ; la date du jour est celle de Paris.

---

### Tâche 4 : API protégée (erreurs, liste d'accès, middlewares)

**Fichiers :**
- Créer : `src/worker/errors.ts`, `src/worker/access.ts`, `src/worker/middleware.ts`, `src/worker/routes/me.ts`, `test/worker/helpers.ts`
- Modifier : `src/worker/app.ts`
- Tests : `test/worker/access.test.ts`

**Interfaces :**
- Consomme : `createApp`, `AppDeps`, `SessionUser` (tâche 1).
- Produit (`errors.ts`) : `class HttpError(status: 400 | 401 | 403 | 404 | 409, code: string, message: string)` ; `notFound(message?: string): HttpError` ; `onError(err, c)` ; `validate(target: 'json' | 'query' | 'param', schema)` (middleware Zod qui répond `400 { error: 'validation', message, issues }`).
- Produit (`access.ts`) : `normalizeEmail(email: string): string` ; `isSuperadmin(env: { SUPERADMIN_EMAIL: string }, email: string): boolean` ; `isEmailAllowed(db: D1Database, superadminEmail: string, email: string): Promise<boolean>` ; `emailOfUser(db, userId): Promise<string | null>` ; `recordLogin(db, email: string, at: Date): Promise<void>`.
- Produit (`middleware.ts`) : `sameOrigin`, `requireUser`, `requireSuperadmin`.
- Produit : `GET /api/me → { user: SessionUser; isSuperadmin: boolean }` (enrichi en tâche 8).
- Produit (`test/worker/helpers.ts`) : `TODAY`, `createUser(email, name?)`, `allow(email)`, `createAllowedUser(email, name?)`, `testApp(now?)`, `call(app, user, method, path, body?)`, `json<T>(res)`.

- [ ] **Étape 1 : écrire les aides de test**

`test/worker/helpers.ts` :

```ts
import { env } from 'cloudflare:test';
import { createApp } from '../../src/worker/app';
import type { AppDeps, SessionUser } from '../../src/worker/types';

export const TODAY = new Date('2026-11-03T10:00:00Z');
type App = ReturnType<typeof createApp>;

export async function createUser(email: string, name = 'Karim Benali'): Promise<SessionUser> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  ).bind(id, name, email, now, now).run();
  return { id, email, name };
}

export async function allow(email: string): Promise<void> {
  await env.DB.prepare('INSERT INTO allowed_emails (email, added_at, added_by) VALUES (?, ?, ?)')
    .bind(email.trim().toLowerCase(), new Date().toISOString(), 'boss@example.test')
    .run();
}

export async function createAllowedUser(email: string, name?: string): Promise<SessionUser> {
  await allow(email);
  return createUser(email, name);
}

/**
 * Application de test : l'utilisateur connecté est lu dans l'en-tête x-test-user.
 * L'horloge avance d'une milliseconde à chaque lecture, pour que les tris par date de mise à jour soient stables.
 */
export function testApp(now: Date = TODAY): App {
  let tick = 0;
  const deps: AppDeps = {
    now: () => new Date(now.getTime() + tick++),
    getSessionUser: async (req) => {
      const id = req.headers.get('x-test-user');
      if (!id) return null;
      return env.DB.prepare('SELECT id, email, name FROM "user" WHERE id = ?').bind(id).first<SessionUser>();
    },
  };
  return createApp(deps);
}

export function call(
  app: App,
  user: SessionUser | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (user) headers['x-test-user'] = user.id;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env),
  );
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
```

- [ ] **Étape 2 : écrire le test qui échoue**

`test/worker/access.test.ts` :

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isEmailAllowed, normalizeEmail, recordLogin } from '../../src/worker/access';
import { allow, call, createAllowedUser, createUser, json, testApp } from './helpers';

describe('liste d’accès', () => {
  it('normalise les adresses', () => {
    expect(normalizeEmail('  Karim.Elec@Gmail.com ')).toBe('karim.elec@gmail.com');
  });

  it('autorise toujours le superadmin, quelle que soit la casse', async () => {
    expect(await isEmailAllowed(env.DB, 'boss@example.test', 'BOSS@example.test')).toBe(true);
  });

  it('autorise une adresse de la liste, refuse les autres', async () => {
    await allow('lea@example.test');
    expect(await isEmailAllowed(env.DB, 'boss@example.test', 'Lea@Example.test')).toBe(true);
    expect(await isEmailAllowed(env.DB, 'boss@example.test', 'intrus@example.test')).toBe(false);
  });

  it('enregistre la dernière connexion', async () => {
    await recordLogin(env.DB, 'lea@example.test', new Date('2026-11-02T17:42:00Z'));
    await recordLogin(env.DB, 'lea@example.test', new Date('2026-11-03T08:00:00Z'));
    const row = await env.DB.prepare("SELECT last_login_at FROM login_activity WHERE email = 'lea@example.test'").first<{ last_login_at: string }>();
    expect(row?.last_login_at).toBe('2026-11-03T08:00:00.000Z');
  });
});

describe('GET /api/me', () => {
  const app = testApp();

  it('répond 401 sans session', async () => {
    const res = await call(app, null, 'GET', '/api/me');
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: 'unauthenticated' });
  });

  it('répond 403 not_invited si l’adresse a été retirée de la liste', async () => {
    const user = await createUser('ancien@example.test');
    const res = await call(app, user, 'GET', '/api/me');
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: 'not_invited' });
  });

  it('renvoie l’utilisateur et son rôle', async () => {
    const user = await createAllowedUser('lea@example.test', 'Léa Morel');
    const boss = await createUser('boss@example.test', 'Anto');
    expect(await json(await call(app, user, 'GET', '/api/me'))).toMatchObject({ user: { email: 'lea@example.test' }, isSuperadmin: false });
    expect(await json(await call(app, boss, 'GET', '/api/me'))).toMatchObject({ isSuperadmin: true });
  });

  it('laisse /api/health public', async () => {
    expect((await call(app, null, 'GET', '/api/health')).status).toBe(200);
  });

  it('refuse une écriture venant d’une autre origine', async () => {
    const user = await createAllowedUser('lea@example.test');
    const res = await call(app, user, 'POST', '/api/me', {}, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Étape 3 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:worker -- access`
Expected: FAIL, `Cannot find module '../../src/worker/access'`.

- [ ] **Étape 4 : écrire `src/worker/errors.ts`**

```ts
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
```

- [ ] **Étape 5 : écrire `src/worker/access.ts`**

```ts
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isSuperadmin(env: { SUPERADMIN_EMAIL: string }, email: string): boolean {
  return normalizeEmail(email) === normalizeEmail(env.SUPERADMIN_EMAIL);
}

export async function isEmailAllowed(db: D1Database, superadminEmail: string, email: string): Promise<boolean> {
  const e = normalizeEmail(email);
  if (e === normalizeEmail(superadminEmail)) return true;
  const row = await db.prepare('SELECT 1 AS ok FROM allowed_emails WHERE email = ?').bind(e).first();
  return row !== null;
}

export async function emailOfUser(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first<{ email: string }>();
  return row?.email ?? null;
}

export async function recordLogin(db: D1Database, email: string, at: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_activity (email, last_login_at) VALUES (?, ?)
       ON CONFLICT (email) DO UPDATE SET last_login_at = excluded.last_login_at`,
    )
    .bind(normalizeEmail(email), at.toISOString())
    .run();
}
```

- [ ] **Étape 6 : écrire `src/worker/middleware.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import { isEmailAllowed, isSuperadmin } from './access';
import { HttpError } from './errors';
import type { AppEnv } from './types';

/** Refuse toute écriture dont l'en-tête Origin n'est pas celle de l'application. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('origin');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && origin !== new URL(c.env.BETTER_AUTH_URL).origin) {
    throw new HttpError(403, 'forbidden', 'Origine refusée.');
  }
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await c.var.deps.getSessionUser(c.req.raw, c.env);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Connexion requise.');
  if (!(await isEmailAllowed(c.env.DB, c.env.SUPERADMIN_EMAIL, user.email))) {
    throw new HttpError(403, 'not_invited', 'Accès sur invitation. Votre adresse n’est pas autorisée.');
  }
  c.set('user', user);
  await next();
};

export const requireSuperadmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isSuperadmin(c.env, c.var.user.email)) throw new HttpError(403, 'forbidden', 'Réservé au superadmin.');
  await next();
};
```

- [ ] **Étape 7 : écrire `src/worker/routes/me.ts` et brancher l'API protégée**

`src/worker/routes/me.ts` :

```ts
import { Hono } from 'hono';
import { isSuperadmin } from '../access';
import type { AppEnv } from '../types';

export const meRoutes = new Hono<AppEnv>().get('/me', (c) => {
  const user = c.var.user;
  return c.json({ user, isSuperadmin: isSuperadmin(c.env, user.email) });
});
```

`src/worker/app.ts` :

```ts
import { Hono } from 'hono';
import { onError } from './errors';
import { requireUser, sameOrigin } from './middleware';
import { meRoutes } from './routes/me';
import type { AppDeps, AppEnv } from './types';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  // Routes publiques : déclarées AVANT l'API protégée, elles répondent sans passer par requireUser.
  app.get('/api/health', (c) => c.json({ ok: true }));

  const api = new Hono<AppEnv>();
  api.use('*', sameOrigin, requireUser);
  api.route('/', meRoutes);

  app.route('/api', api);
  app.notFound((c) => c.json({ error: 'not_found', message: 'Adresse inconnue.' }, 404));
  return app;
}
```

- [ ] **Étape 8 : relancer les tests**

Run: `npm run test:worker`
Expected: PASS (dont les 5 tests de `/api/me`). Le test d'origine reçoit 403 avant d'atteindre la route (il n'existe pas de `POST /api/me`).

- [ ] **Étape 9 : commit**

```bash
git add src/worker test/worker
git commit -m "feat: API protégée par liste d'accès, superadmin et contrôle d'origine"
```

**Critère de fin :** sans session → 401 ; adresse hors liste → 403 `not_invited` ; superadmin toujours admis ; `/api/health` public ; écriture d'une autre origine → 403.

---

### Tâche 5 : connexion Google (Better Auth), écrans Connexion et Accès refusé, coquille de l'application

**Fichiers :**
- Créer : `src/worker/auth.ts`, `src/web/auth-client.ts`, `src/web/api.ts`, `src/web/query.ts`, `src/web/session/useMe.ts`, `src/web/session/RequireAuth.tsx`, `src/web/layout/AppShell.tsx`, `src/web/layout/AppShell.css`, `src/web/pages/LoginPage.tsx`, `src/web/pages/LoginPage.css`, `src/web/pages/AccessDeniedPage.tsx`, `src/shared/api-types.ts`
- Modifier : `src/worker/app.ts`, `src/worker/index.ts`, `src/worker/access.ts`, `src/web/App.tsx`
- Tests : `test/worker/auth-hooks.test.ts`, `src/web/pages/LoginPage.test.tsx`, `src/web/session/RequireAuth.test.tsx`

**Maquette :** `docs/maquettes/Main.dc.html` (écran de connexion), barre latérale de `docs/maquettes/Dashboard.dc.html`.

**Interfaces :**
- Consomme : `isEmailAllowed`, `emailOfUser`, `recordLogin`, `requireUser` (tâche 4).
- Produit (`access.ts`) : `accessHooks(env: Env, now: () => Date)` → `{ beforeUserCreate(email: string): Promise<void>; beforeSessionCreate(userId: string): Promise<void>; afterSessionCreate(userId: string): Promise<void> }` (lèvent `NotInvitedError`).
- Produit (`auth.ts`) : `createAuth(env: Env)` ; `betterAuthSessionUser(req: Request, env: Env): Promise<SessionUser | null>`.
- Produit (front) : `api<T>(method: string, path: string, body?: unknown): Promise<T>` ; `class ApiError extends Error { status: number; code: string }` ; `useMe()` (TanStack Query, clé `['me']`) ; `<RequireAuth>` ; `<AppShell>` ; `authClient`.
- Produit (`api-types.ts`) : `type MeResponse = { user: { id: string; email: string; name: string }; isSuperadmin: boolean; onboarding: { templateRef: string | null; profileComplete: boolean }; profileSummary: { ownerName: string; tradeName: string } | null }` (les champs `onboarding` et `profileSummary` sont servis à partir de la tâche 8 ; le front les traite comme optionnels jusque-là).

- [ ] **Étape 1 : écrire les tests qui échouent (crochets d'accès)**

`test/worker/auth-hooks.test.ts` :

```ts
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
```

`src/web/pages/LoginPage.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const social = vi.fn();
vi.mock('../auth-client', () => ({ authClient: { signIn: { social } } }));

import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('affiche l’accroche, le bouton Google et l’avertissement d’invitation', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Du devis signé à la facture payée, sans ressaisir une ligne.' })).toBeInTheDocument();
    expect(screen.getByText(/Accès sur invitation/)).toBeInTheDocument();
  });

  it('lance la connexion Google avec les bonnes redirections', async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /Continuer avec Google/ }));
    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/', errorCallbackURL: '/acces-refuse' });
  });
});
```

`src/web/session/RequireAuth.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';

function renderAt(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<p>Contenu protégé</p>} />
          </Route>
          <Route path="/connexion" element={<p>Page de connexion</p>} />
          <Route path="/acces-refuse" element={<p>Page accès refusé</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('RequireAuth', () => {
  it('renvoie vers la connexion sans session', async () => {
    renderAt(401, { error: 'unauthenticated', message: '' });
    expect(await screen.findByText('Page de connexion')).toBeInTheDocument();
  });

  it('renvoie vers Accès refusé si l’adresse n’est pas invitée', async () => {
    renderAt(403, { error: 'not_invited', message: '' });
    expect(await screen.findByText('Page accès refusé')).toBeInTheDocument();
  });

  it('affiche le contenu pour un utilisateur autorisé', async () => {
    renderAt(200, { user: { id: 'u', email: 'a@b.c', name: 'A' }, isSuperadmin: false, onboarding: { templateRef: 'modele-01@1', profileComplete: true }, profileSummary: null });
    expect(await screen.findByText('Contenu protégé')).toBeInTheDocument();
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL, `accessHooks` non exporté, `./LoginPage` et `./RequireAuth` introuvables.

- [ ] **Étape 3 : ajouter les crochets à `src/worker/access.ts`**

```ts
export class NotInvitedError extends Error {
  constructor() {
    super('not_invited');
  }
}

export function accessHooks(env: Env, now: () => Date) {
  const assertInvited = async (email: string | null) => {
    if (!email || !(await isEmailAllowed(env.DB, env.SUPERADMIN_EMAIL, email))) throw new NotInvitedError();
  };
  return {
    beforeUserCreate: (email: string) => assertInvited(email),
    beforeSessionCreate: async (userId: string) => assertInvited(await emailOfUser(env.DB, userId)),
    afterSessionCreate: async (userId: string) => {
      const email = await emailOfUser(env.DB, userId);
      if (email) await recordLogin(env.DB, email, now());
    },
  };
}
```

- [ ] **Étape 4 : écrire `src/worker/auth.ts`**

```ts
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { D1Dialect } from 'kysely-d1';
import { NotInvitedError, accessHooks } from './access';
import type { SessionUser } from './types';

function asForbidden(err: unknown): never {
  if (err instanceof NotInvitedError) throw new APIError('FORBIDDEN', { message: 'not_invited' });
  throw err;
}

export function createAuth(env: Env) {
  const hooks = accessHooks(env, () => new Date());
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: { dialect: new D1Dialect({ database: env.DB }), type: 'sqlite' },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: { create: { before: async (user) => { await hooks.beforeUserCreate(user.email).catch(asForbidden); } } },
      session: {
        create: {
          before: async (session) => { await hooks.beforeSessionCreate(session.userId).catch(asForbidden); },
          after: async (session) => { await hooks.afterSessionCreate(session.userId); },
        },
      },
    },
  });
}

export async function betterAuthSessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const result = await createAuth(env).api.getSession({ headers: req.headers });
  if (!result) return null;
  return { id: result.user.id, email: result.user.email, name: result.user.name };
}
```

Monter le gestionnaire dans `src/worker/app.ts`, juste après `/api/health` et avant l'API protégée :

```ts
import { createAuth } from './auth';
// …
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));
```

`src/worker/index.ts` :

```ts
import { createApp } from './app';
import { betterAuthSessionUser } from './auth';

const app = createApp({ getSessionUser: betterAuthSessionUser, now: () => new Date() });

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
```

- [ ] **Étape 5 : écrire le client API et la session côté front**

`src/shared/api-types.ts` :

```ts
export type MeResponse = {
  user: { id: string; email: string; name: string };
  isSuperadmin: boolean;
  onboarding?: { templateRef: string | null; profileComplete: boolean };
  profileSummary?: { ownerName: string; tradeName: string } | null;
};
```

`src/web/api.ts` :

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: unknown) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'internal', data.message ?? 'Erreur inattendue.', data.issues);
  return data as T;
}
```

`src/web/query.ts` :

```ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});
```

`src/web/auth-client.ts` :

```ts
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ basePath: '/api/auth' });
```

`src/web/session/useMe.ts` :

```ts
import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '../../shared/api-types';
import { api } from '../api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('GET', '/api/me') });
}
```

`src/web/session/RequireAuth.tsx` (le contrôle du premier démarrage s'y ajoute en tâche 9) :

```tsx
import { Navigate, Outlet } from 'react-router';
import { ApiError } from '../api';
import { useMe } from './useMe';

export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <p className="page-intro" style={{ padding: 32 }}>Chargement…</p>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/connexion" replace />;
  if (me.error instanceof ApiError && me.error.code === 'not_invited') return <Navigate to="/acces-refuse" replace />;
  if (me.error) return <p className="notice notice-error" role="alert">{me.error.message}</p>;
  return <Outlet />;
}
```

- [ ] **Étape 6 : écrire les écrans Connexion et Accès refusé**

`src/web/pages/LoginPage.tsx` (reprend la maquette `Main.dc.html` : panneau gauche `#E9ECFB` avec logo « D », titre 56 px, sous-titre, enchaînement de trois cartes D-2026-014 → Acompte 30 % F-2026-021 → Solde F-2026-027 ; panneau droit avec « Connexion », bouton Google 56 px, encart cadenas) :

```tsx
import { authClient } from '../auth-client';
import './LoginPage.css';

export function LoginPage() {
  const signIn = () => authClient.signIn.social({ provider: 'google', callbackURL: '/', errorCallbackURL: '/acces-refuse' });
  return (
    <main className="login">
      <section className="login-hero">
        <div className="brand"><span className="brand-mark" aria-hidden="true">D</span><span className="brand-name">Devis &amp; Factures</span></div>
        <div className="login-pitch">
          <h1>Du devis signé à la facture payée, sans ressaisir une ligne.</h1>
          <p>Vos coordonnées sont saisies une fois. Chaque devis accepté devient acompte, puis facture de solde, prête à imprimer.</p>
        </div>
        <div className="login-flow" aria-hidden="true">
          <div className="flow-card"><span>Devis</span><strong>D-2026-014</strong></div>
          <span className="flow-arrow">→</span>
          <div className="flow-card"><span>Acompte 30 %</span><strong>F-2026-021</strong></div>
          <span className="flow-arrow">→</span>
          <div className="flow-card flow-card--strong"><span>Solde</span><strong>F-2026-027</strong></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-box">
          <div>
            <h2>Connexion</h2>
            <p>Utilisez le compte Google associé à votre activité.</p>
          </div>
          <button type="button" className="google-button" onClick={signIn}>
            <GoogleIcon />
            Continuer avec Google
          </button>
          <div className="notice">
            <LockIcon />
            <p>Accès sur invitation. Si votre adresse n’a pas encore été autorisée, contactez l’administrateur.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.2-13.6-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
```

`src/web/pages/LoginPage.css` :

```css
.login { min-height: 100vh; display: flex; flex-wrap: wrap; }
.login-hero { flex: 1 1 480px; background: var(--c-login-panel); padding: 56px; display: flex; flex-direction: column; justify-content: space-between; gap: 48px; }
.brand { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 36px; height: 36px; border-radius: 10px; background: var(--c-primary); color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 700; font-size: 18px; }
.brand-name { font-family: var(--font-display); font-weight: 700; font-size: 20px; }
.login-pitch { display: flex; flex-direction: column; gap: 24px; max-width: 520px; }
.login-pitch h1 { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 56px; line-height: 1.02; letter-spacing: -0.02em; }
.login-pitch p { margin: 0; font-size: 18px; line-height: 1.6; color: var(--c-text-ink); }
.login-flow { display: flex; gap: 12px; flex-wrap: wrap; }
.flow-card { background: #FFFFFF; border: 1px solid var(--c-login-card-border); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
.flow-card span { font-size: 13px; color: var(--c-text-muted); }
.flow-card strong { font-family: var(--font-display); font-size: 20px; }
.flow-card--strong { background: var(--c-primary); border-color: var(--c-primary); color: #FFFFFF; }
.flow-card--strong span { color: #DDE1FF; }
.flow-arrow { display: flex; align-items: center; color: var(--c-primary); font-size: 22px; }
.login-panel { flex: 1 1 480px; padding: 56px 24px; display: flex; align-items: center; justify-content: center; }
.login-box { width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 28px; }
.login-box h2 { margin: 0 0 10px; font-family: var(--font-display); font-weight: 700; font-size: 34px; letter-spacing: -0.01em; }
.login-box p { margin: 0; font-size: 16px; line-height: 1.55; color: var(--c-text-muted); }
.login-box .notice p { color: var(--c-primary-strong); font-size: 14px; }
.google-button { height: 56px; border-radius: 14px; border: 1px solid var(--c-border-input); background: #FFFFFF; display: flex; align-items: center; justify-content: center; gap: 12px; font-family: inherit; font-weight: 700; font-size: 16px; color: var(--c-text); cursor: pointer; box-shadow: 0 1px 2px rgba(20, 22, 31, 0.06); }
```

`src/web/pages/AccessDeniedPage.tsx` (même panneau droit que la connexion, message adapté) :

```tsx
import { Link } from 'react-router';
import { authClient } from '../auth-client';
import './LoginPage.css';

export function AccessDeniedPage() {
  return (
    <main className="login">
      <section className="login-panel">
        <div className="login-box">
          <div>
            <h2>Accès sur invitation</h2>
            <p>Ce compte Google n’est pas autorisé à utiliser l’application. Demandez à l’administrateur d’ajouter votre adresse, puis reconnectez-vous.</p>
          </div>
          <Link className="btn btn-secondary" to="/connexion" onClick={() => authClient.signOut()}>Revenir à la connexion</Link>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Étape 7 : écrire la coquille et le routeur**

`src/web/layout/AppShell.tsx` (barre latérale de la maquette `Dashboard.dc.html` : logo, liens, lien superadmin en bas, carte utilisateur avec initiales sur fond `#F2B544`) :

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router';
import { authClient } from '../auth-client';
import { queryClient } from '../query';
import { useMe } from '../session/useMe';
import './AppShell.css';

const LINKS = [
  { to: '/', label: 'Tableau de bord', end: true },
  { to: '/devis', label: 'Devis' },
  { to: '/factures', label: 'Factures' },
  { to: '/clients', label: 'Clients' },
  { to: '/lignes-types', label: 'Lignes types' },
  { to: '/profil', label: 'Profil entreprise' },
];

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function AppShell() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const displayName = me?.profileSummary?.ownerName || me?.user.name || '';
  const logout = async () => {
    await authClient.signOut();
    queryClient.clear();
    navigate('/connexion');
  };
  return (
    <div className="shell">
      <nav aria-label="Navigation principale" className="shell-nav">
        <div className="shell-brand"><span className="brand-mark" aria-hidden="true">D</span><span>Devis &amp; Factures</span></div>
        <div className="shell-links">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="shell-link">{l.label}</NavLink>
          ))}
        </div>
        <div className="shell-bottom">
          {me?.isSuperadmin && <NavLink to="/admin" className="shell-link">Accès (superadmin)</NavLink>}
          <div className="shell-user">
            <span className="shell-avatar" aria-hidden="true">{initials(displayName)}</span>
            <div><span className="shell-user-name">{displayName}</span><span className="shell-user-company">{me?.profileSummary?.tradeName}</span></div>
          </div>
          <button type="button" className="shell-logout" onClick={logout}>Se déconnecter</button>
        </div>
      </nav>
      <main className="shell-main"><Outlet /></main>
    </div>
  );
}
```

`src/web/layout/AppShell.css` :

```css
.shell { min-height: 100vh; display: flex; flex-wrap: wrap; }
.shell-nav { flex: 1 1 232px; max-width: 100%; background: var(--c-surface); border-right: 1px solid var(--c-border); padding: 28px 16px; display: flex; flex-direction: column; gap: 28px; }
.shell-brand { display: flex; align-items: center; gap: 10px; padding: 0 8px; font-family: var(--font-display); font-weight: 700; font-size: 17px; }
.shell-brand .brand-mark { width: 32px; height: 32px; border-radius: 9px; background: var(--c-primary); color: #FFFFFF; display: flex; align-items: center; justify-content: center; }
.shell-links, .shell-bottom { display: flex; flex-direction: column; gap: 4px; font-size: 15px; font-weight: 600; }
.shell-bottom { margin-top: auto; }
.shell-link { padding: 11px 12px; border-radius: 10px; text-decoration: none; }
.shell-link.active { background: var(--c-primary-soft); color: var(--c-primary-strong); }
.shell-user { display: flex; align-items: center; gap: 10px; padding: 12px 8px 0; border-top: 1px solid var(--c-border); font-size: 13px; }
.shell-user > div { display: flex; flex-direction: column; }
.shell-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--c-avatar); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
.shell-user-name { font-weight: 700; }
.shell-user-company { color: var(--c-text-muted); }
.shell-logout { margin: 8px; background: none; border: none; color: var(--c-text-muted); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.shell-main { flex: 999 1 560px; min-width: 0; padding: 32px 32px 64px; }
.page { max-width: 1080px; display: flex; flex-direction: column; gap: 24px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
```

`src/web/App.tsx` (les pages suivantes s'ajoutent dans leurs tâches ; `/` affiche provisoirement un titre) :

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './layout/AppShell';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { LoginPage } from './pages/LoginPage';
import { queryClient } from './query';
import { RequireAuth } from './session/RequireAuth';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/acces-refuse" element={<AccessDeniedPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<h1 className="page-title">Devis &amp; Factures</h1>} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

Mettre à jour `src/web/App.test.tsx` : la page racine n'est plus visible sans session. Remplacer son contenu par un test qui vérifie qu'en l'absence de session (`fetch` simulé → 401) l'écran de connexion s'affiche :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => vi.unstubAllGlobals());

it('affiche la connexion quand personne n’est connecté', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthenticated', message: '' }), { status: 401 })));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
});
```

- [ ] **Étape 8 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 9 : créer les identifiants Google et vérifier à la main**

Dans Google Cloud Console (projet dédié) : écran de consentement « Externe », application « Devis & Factures », portées par défaut ; identifiant OAuth de type « Application Web » avec l'origine `http://localhost:5173` et l'URI de redirection `http://localhost:5173/api/auth/callback/google`. Copier l'identifiant et le secret dans `.dev.vars`.

Run: `npm run dev`, ouvrir `http://localhost:5173`.
Expected :
1. Redirection vers `/connexion`, rendu fidèle à `Main.dc.html`.
2. Connexion avec le compte de `SUPERADMIN_EMAIL` → arrivée sur `/` dans la coquille, avec le lien « Accès (superadmin) ».
3. Connexion avec un autre compte Google → arrivée sur `/acces-refuse` ; aucune ligne `session` créée pour lui (`npx wrangler d1 execute DB --local --command "SELECT count(*) FROM session"`).

Si Better Auth ne redirige pas vers `errorCallbackURL` quand le crochet refuse, le refus reste garanti par `requireUser` (403 `not_invited` → `/acces-refuse`) ; noter le comportement observé dans le message de commit.

- [ ] **Étape 10 : commit**

```bash
git add -A
git commit -m "feat: connexion Google via Better Auth, liste d'accès appliquée, écrans de connexion"
```

**Critère de fin :** une adresse invitée ou le superadmin se connecte et voit la coquille ; une autre adresse arrive sur « Accès sur invitation » sans session créée ; tous les tests passent.

---

### Tâche 6 : superadmin (API et écran « Accès autorisés »)

**Fichiers :**
- Créer : `src/worker/routes/admin.ts`, `src/web/pages/AdminPage.tsx`, `src/web/pages/lastLogin.ts`
- Modifier : `src/worker/app.ts`, `src/web/App.tsx`, `src/shared/api-types.ts`
- Tests : `test/worker/admin.test.ts`, `src/web/pages/lastLogin.test.ts`

**Maquette :** `docs/maquettes/Admin.dc.html`.

**Interfaces :**
- Consomme : `requireSuperadmin`, `normalizeEmail`, `validate`, `HttpError`.
- Produit : `GET /api/admin/emails → { items: AdminEmailItem[] }` ; `POST /api/admin/emails { email } → 201 AdminEmailItem` ; `DELETE /api/admin/emails/:email → 204`.
- Produit (`api-types.ts`) : `type AdminEmailItem = { email: string; isSuperadmin: boolean; tradeName: string | null; lastLoginAt: string | null; addedAt: string | null }`.
- Produit (`lastLogin.ts`) : `formatLastLogin(iso: string | null, now: Date): string | null` (`aujourd’hui`, `hier, 18 h 42`, `28 oct. 2026`, `null` si jamais connecté).

- [ ] **Étape 1 : écrire les tests qui échouent**

`test/worker/admin.test.ts` :

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, createAllowedUser, createUser, json, testApp } from './helpers';

const app = testApp();

async function boss() {
  return createUser('boss@example.test', 'Anto');
}

describe('API superadmin', () => {
  it('est interdite aux utilisateurs ordinaires', async () => {
    const lea = await createAllowedUser('lea@example.test');
    expect((await call(app, lea, 'GET', '/api/admin/emails')).status).toBe(403);
    expect((await call(app, lea, 'POST', '/api/admin/emails', { email: 'x@example.test' })).status).toBe(403);
  });

  it('ajoute une adresse normalisée et refuse les doublons', async () => {
    const admin = await boss();
    const res = await call(app, admin, 'POST', '/api/admin/emails', { email: '  Karim.Elec@Example.test ' });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ email: 'karim.elec@example.test', isSuperadmin: false });
    expect((await call(app, admin, 'POST', '/api/admin/emails', { email: 'karim.elec@example.test' })).status).toBe(409);
    expect((await call(app, admin, 'POST', '/api/admin/emails', { email: 'pas-une-adresse' })).status).toBe(400);
    expect((await call(app, admin, 'POST', '/api/admin/emails', { email: 'boss@example.test' })).status).toBe(409);
  });

  it('liste le superadmin en premier, avec entreprise et dernière connexion', async () => {
    const admin = await boss();
    const lea = await createAllowedUser('lea@example.test');
    await env.DB.prepare("INSERT INTO profiles (user_id, template_ref, trade_name, created_at, updated_at) VALUES (?, 'modele-01@1', 'Léa Morel – Studio', '', '')").bind(lea.id).run();
    await env.DB.prepare("INSERT INTO login_activity (email, last_login_at) VALUES ('lea@example.test', '2026-10-28T09:00:00.000Z')").run();
    await call(app, admin, 'POST', '/api/admin/emails', { email: 'jamais@example.test' });
    const { items } = await json(await call(app, admin, 'GET', '/api/admin/emails'));
    expect(items[0]).toMatchObject({ email: 'boss@example.test', isSuperadmin: true });
    expect(items).toContainEqual(expect.objectContaining({ email: 'lea@example.test', tradeName: 'Léa Morel – Studio', lastLoginAt: '2026-10-28T09:00:00.000Z' }));
    expect(items).toContainEqual(expect.objectContaining({ email: 'jamais@example.test', tradeName: null, lastLoginAt: null }));
  });

  it('retirer une adresse coupe l’accès et supprime les sessions, sans toucher aux données', async () => {
    const admin = await boss();
    const lea = await createAllowedUser('lea@example.test');
    await env.DB.prepare("INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('s1', '2030-01-01', 'tok', '', '', ?)").bind(lea.id).run();
    await env.DB.prepare("INSERT INTO profiles (user_id, template_ref, created_at, updated_at) VALUES (?, 'modele-01@1', '', '')").bind(lea.id).run();
    expect((await call(app, admin, 'DELETE', '/api/admin/emails/LEA@example.test')).status).toBe(204);
    expect((await call(app, lea, 'GET', '/api/me')).status).toBe(403);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').bind(lea.id).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM profiles WHERE user_id = ?').bind(lea.id).first()).toEqual({ n: 1 });
  });

  it('ne retire pas le superadmin et répond 404 pour une adresse absente', async () => {
    const admin = await boss();
    expect((await call(app, admin, 'DELETE', '/api/admin/emails/boss@example.test')).status).toBe(400);
    expect((await call(app, admin, 'DELETE', '/api/admin/emails/inconnu@example.test')).status).toBe(404);
  });
});
```

`src/web/pages/lastLogin.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { formatLastLogin } from './lastLogin';

const now = new Date('2026-11-03T10:00:00Z'); // 11 h à Paris

describe('formatLastLogin', () => {
  it('écrit les dates relatives comme la maquette', () => {
    expect(formatLastLogin('2026-11-03T07:00:00Z', now)).toBe('aujourd’hui');
    expect(formatLastLogin('2026-11-02T17:42:00Z', now)).toBe('hier, 18 h 42');
    expect(formatLastLogin('2026-10-28T09:00:00Z', now)).toBe('28 oct. 2026');
    expect(formatLastLogin(null, now)).toBeNull();
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:worker -- admin && npm run test:unit -- lastLogin`
Expected: FAIL (404 sur les routes, module `./lastLogin` introuvable).

- [ ] **Étape 3 : écrire `src/worker/routes/admin.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminEmailItem } from '../../shared/api-types';
import { isSuperadmin, normalizeEmail } from '../access';
import { HttpError, notFound, validate } from '../errors';
import { requireSuperadmin } from '../middleware';
import type { AppEnv } from '../types';

type Row = { email: string; added_at: string | null; last_login_at: string | null; trade_name: string | null };

const SELECT = `
  SELECT ? AS email, a.added_at, l.last_login_at, p.trade_name
  FROM (SELECT 1) AS one
  LEFT JOIN allowed_emails a ON a.email = ?
  LEFT JOIN login_activity l ON l.email = ?
  LEFT JOIN "user" u ON lower(u.email) = ?
  LEFT JOIN profiles p ON p.user_id = u.id`;

const toItem = (env: Env, r: Row): AdminEmailItem => ({
  email: r.email,
  isSuperadmin: isSuperadmin(env, r.email),
  tradeName: r.trade_name || null,
  lastLoginAt: r.last_login_at,
  addedAt: r.added_at,
});

async function itemFor(db: D1Database, env: Env, email: string): Promise<AdminEmailItem> {
  const row = await db.prepare(SELECT).bind(email, email, email, email).first<Row>();
  return toItem(env, row!);
}

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireSuperadmin)
  .get('/emails', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT a.email, a.added_at, l.last_login_at, p.trade_name
       FROM allowed_emails a
       LEFT JOIN login_activity l ON l.email = a.email
       LEFT JOIN "user" u ON lower(u.email) = a.email
       LEFT JOIN profiles p ON p.user_id = u.id
       ORDER BY a.added_at DESC`,
    ).all<Row>();
    const boss = await itemFor(c.env.DB, c.env, normalizeEmail(c.env.SUPERADMIN_EMAIL));
    return c.json({ items: [boss, ...results.filter((r) => !isSuperadmin(c.env, r.email)).map((r) => toItem(c.env, r))] });
  })
  .post('/emails', validate('json', z.object({ email: z.email() })), async (c) => {
    const email = normalizeEmail(c.req.valid('json').email);
    if (isSuperadmin(c.env, email)) throw new HttpError(409, 'already_allowed', 'Cette adresse est celle du superadmin.');
    const res = await c.env.DB.prepare(
      'INSERT INTO allowed_emails (email, added_at, added_by) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING',
    ).bind(email, c.var.deps.now().toISOString(), normalizeEmail(c.var.user.email)).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'already_allowed', 'Cette adresse est déjà autorisée.');
    return c.json(await itemFor(c.env.DB, c.env, email), 201);
  })
  .delete('/emails/:email', async (c) => {
    const email = normalizeEmail(decodeURIComponent(c.req.param('email')));
    if (isSuperadmin(c.env, email)) throw new HttpError(400, 'cannot_remove_superadmin', 'Le superadmin ne peut pas être retiré.');
    const [removed] = await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(email),
      c.env.DB.prepare('DELETE FROM session WHERE userId IN (SELECT id FROM "user" WHERE lower(email) = ?)').bind(email),
    ]);
    if (removed.meta.changes === 0) throw notFound('Adresse absente de la liste.');
    return c.body(null, 204);
  });
```

Ajouter à `src/shared/api-types.ts` :

```ts
export type AdminEmailItem = {
  email: string;
  isSuperadmin: boolean;
  tradeName: string | null;
  lastLoginAt: string | null;
  addedAt: string | null;
};
```

Brancher dans `src/worker/app.ts` : `api.route('/admin', adminRoutes);`

- [ ] **Étape 4 : écrire `src/web/pages/lastLogin.ts`**

```ts
import { addDays, formatDateShort, todayInParis } from '../../shared/dates';

const TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

export function formatLastLogin(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  const day = todayInParis(at);
  const today = todayInParis(now);
  if (day === today) return 'aujourd’hui';
  if (day === addDays(today, -1)) return `hier, ${TIME.format(at).replace(':', ' h ')}`;
  return formatDateShort(day);
}
```

- [ ] **Étape 5 : écrire `src/web/pages/AdminPage.tsx`**

Mise en page de `Admin.dc.html` : surtitre « Superadmin », titre « Accès autorisés », phrase d'introduction, formulaire « Adresse Gmail à autoriser » + bouton « Autoriser », tableau (Adresse, Entreprise, Dernière connexion, actions) ; pastille « superadmin » ; pastille orange « jamais connecté » dans la colonne Entreprise quand `lastLoginAt` est nul ; bouton « Retirer » (style `btn-danger`) avec confirmation `window.confirm`.

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { AdminEmailItem } from '../../shared/api-types';
import { ApiError, api } from '../api';
import { formatLastLogin } from './lastLogin';

export function AdminPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-emails'], queryFn: () => api<{ items: AdminEmailItem[] }>('GET', '/api/admin/emails') });
  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: (value: string) => api<AdminEmailItem>('POST', '/api/admin/emails', { email: value }),
    onSuccess: () => { setEmail(''); qc.invalidateQueries({ queryKey: ['admin-emails'] }); },
  });
  const remove = useMutation({
    mutationFn: (value: string) => api<void>('DELETE', `/api/admin/emails/${encodeURIComponent(value)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-emails'] }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(email); };
  const now = new Date();

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="eyebrow">Superadmin</span>
        <h1 className="page-title" style={{ fontSize: 38 }}>Accès autorisés</h1>
        <p className="page-intro">Seules ces adresses Google peuvent se connecter. Retirer une adresse coupe l’accès immédiatement ; les devis et factures de la personne sont conservés.</p>
      </div>
      <form className="card" onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: 20 }}>
        <label className="field" style={{ flex: '1 1 320px' }}>
          Adresse Gmail à autoriser
          <input className="input" type="email" required placeholder="prenom.nom@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={add.isPending}>Autoriser</button>
        {add.error instanceof ApiError && <p className="field-error span-all" role="alert">{add.error.message}</p>}
      </form>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr><th scope="col">Adresse</th><th scope="col">Entreprise</th><th scope="col">Dernière connexion</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.data?.items.map((it) => (
              <tr key={it.email}>
                <td style={{ fontWeight: 600 }}>
                  {it.email}
                  {it.isSuperadmin && <span className="badge tone-ok" style={{ marginLeft: 8, fontSize: 12 }}>superadmin</span>}
                </td>
                <td>{it.lastLoginAt === null ? <span className="badge tone-wait">jamais connecté</span> : it.tradeName ?? '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{formatLastLogin(it.lastLoginAt, now) ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {!it.isSuperadmin && (
                    <button type="button" className="btn btn-danger" onClick={() => window.confirm(`Retirer l’accès de ${it.email} ?`) && remove.mutate(it.email)}>Retirer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Ajouter la route dans `src/web/App.tsx`, à l'intérieur de `<AppShell>` : `<Route path="admin" element={<AdminPage />} />`. Un utilisateur ordinaire qui tape `/admin` reçoit 403 de l'API : la page affiche alors « Réservé au superadmin. » (afficher `list.error.message` dans un `.notice-error` quand `list.error` est défini).

- [ ] **Étape 6 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 7 : vérifier à la main**

`npm run dev`, connecté en superadmin : ajouter une adresse, la voir avec « jamais connecté », la retirer. Comparer visuellement à `Admin.dc.html`.

- [ ] **Étape 8 : commit**

```bash
git add -A
git commit -m "feat: écran superadmin de gestion des accès"
```

**Critère de fin :** le superadmin ajoute et retire des adresses ; un retrait coupe l'accès immédiatement (sessions supprimées) sans effacer de données ; un utilisateur ordinaire reçoit 403.

---

# Phase 2 : profil, modèle, clients, lignes types

### Tâche 7 : registre des modèles visuels (méta, vignettes, découverte automatique)

**Fichiers :**
- Créer : `src/templates/types.ts`, `src/templates/catalog.ts`, `src/templates/registry.ts`, `src/templates/README.md`
- Créer : `src/templates/modele-01/v1/meta.ts`, `index.tsx`, `style.css` ; idem pour `modele-02/v1` et `modele-03/v1`
- Créer : `src/web/document/useTemplateFonts.ts`
- Tests : `src/templates/catalog.test.ts`, `src/templates/registry.test.tsx`, `src/web/document/useTemplateFonts.test.tsx`

**Maquettes :** `docs/maquettes/Modele.dc.html` (vignettes, noms, descriptions), `Modele1/2/3.dc.html` (polices).

**Interfaces :**
- Produit (`types.ts`) : `type TemplateMeta = { id: string; version: number; name: string; description: string; order: number }` ; `type DocumentLabels = { company: string; client: string; object: string; terms: string; approval: string; thanks: string | null }` ; `type TemplateModule = { meta: TemplateMeta; className: string; labels: DocumentLabels; fontsHref: string; Thumbnail: ComponentType }` ; `templateRef(m: { id: string; version: number }): string`.
- Produit (`catalog.ts`, sans React, utilisable par le Worker) : `ALL_TEMPLATE_METAS`, `DEFAULT_TEMPLATE_REF = 'modele-01@1'`, `isKnownTemplateRef(ref: string): boolean`, `latestTemplateMetas(): TemplateMeta[]`.
- Produit (`registry.ts`, front) : `getTemplate(ref: string): TemplateModule` (repli sur le modèle par défaut), `selectableTemplates(): TemplateModule[]`.
- Produit : `useTemplateFonts(href: string): void`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/templates/catalog.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ALL_TEMPLATE_METAS, DEFAULT_TEMPLATE_REF, isKnownTemplateRef, latestTemplateMetas } from './catalog';
import { templateRef } from './types';

const metaFiles = import.meta.glob('./*/v*/meta.ts', { eager: true });

describe('catalogue des modèles', () => {
  it('propose les 3 modèles V1 dans l’ordre', () => {
    expect(latestTemplateMetas().map(templateRef)).toEqual(['modele-01@1', 'modele-02@1', 'modele-03@1']);
    expect(latestTemplateMetas().map((m) => m.name)).toEqual(['Intemporel', 'Discret', 'Raffiné']);
  });

  it('reconnaît les références existantes seulement', () => {
    expect(isKnownTemplateRef(DEFAULT_TEMPLATE_REF)).toBe(true);
    expect(isKnownTemplateRef('modele-02@1')).toBe(true);
    expect(isKnownTemplateRef('modele-02@9')).toBe(false);
    expect(isKnownTemplateRef('n’importe quoi')).toBe(false);
  });

  it('fait concorder chaque dossier avec sa méta (modele-XX/vN ↔ id et version)', () => {
    for (const [path, mod] of Object.entries(metaFiles) as [string, { meta: { id: string; version: number } }][]) {
      const [, id, v] = /^\.\/([^/]+)\/v(\d+)\/meta\.ts$/.exec(path)!;
      expect(mod.meta.id).toBe(id);
      expect(mod.meta.version).toBe(Number(v));
    }
    expect(ALL_TEMPLATE_METAS).toHaveLength(Object.keys(metaFiles).length);
  });
});
```

`src/templates/registry.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getTemplate, selectableTemplates } from './registry';

const files = (pattern: Record<string, unknown>) => Object.keys(pattern).map((p) => p.replace(/\/[^/]+$/, '')).sort();

describe('registre des modèles', () => {
  it('chaque version de modèle fournit meta.ts, index.tsx et style.css', () => {
    const metas = files(import.meta.glob('./*/v*/meta.ts'));
    expect(files(import.meta.glob('./*/v*/index.tsx'))).toEqual(metas);
    expect(files(import.meta.glob('./*/v*/style.css'))).toEqual(metas);
  });

  it('sert les modèles sélectionnables avec leurs libellés', () => {
    expect(selectableTemplates().map((t) => t.className)).toEqual(['tpl-modele-01-v1', 'tpl-modele-02-v1', 'tpl-modele-03-v1']);
    expect(getTemplate('modele-02@1').labels.company).toBe('De');
    expect(getTemplate('modele-03@1').labels.thanks).toBe('Merci de votre confiance');
  });

  it('se replie sur le modèle par défaut pour une référence inconnue', () => {
    expect(getTemplate('modele-99@1').meta.name).toBe('Intemporel');
  });

  it('rend une vignette pour chaque modèle', () => {
    for (const t of selectableTemplates()) {
      const { container } = render(<t.Thumbnail />);
      expect(container.querySelector('.tpl-thumb')).not.toBeNull();
    }
  });
});
```

`src/web/document/useTemplateFonts.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTemplateFonts } from './useTemplateFonts';

function Probe({ href }: { href: string }) {
  useTemplateFonts(href);
  return null;
}

it('ajoute la feuille de polices une seule fois', () => {
  render(<><Probe href="https://fonts.example/a.css" /><Probe href="https://fonts.example/a.css" /></>);
  expect(document.head.querySelectorAll('link[data-template-fonts="https://fonts.example/a.css"]')).toHaveLength(1);
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/templates src/web/document`
Expected: FAIL, modules introuvables.

- [ ] **Étape 3 : écrire les types, le catalogue et le registre**

`src/templates/types.ts` :

```ts
import type { ComponentType } from 'react';

export type TemplateMeta = { id: string; version: number; name: string; description: string; order: number };

export type DocumentLabels = {
  company: string;
  client: string;
  object: string;
  terms: string;
  approval: string;
  thanks: string | null;
};

export type TemplateModule = {
  meta: TemplateMeta;
  className: string;
  labels: DocumentLabels;
  fontsHref: string;
  Thumbnail: ComponentType;
};

export const templateRef = (m: { id: string; version: number }) => `${m.id}@${m.version}`;
```

`src/templates/catalog.ts` :

```ts
import { templateRef, type TemplateMeta } from './types';

const found = import.meta.glob<{ meta: TemplateMeta }>('./*/v*/meta.ts', { eager: true });

export const ALL_TEMPLATE_METAS: TemplateMeta[] = Object.values(found).map((m) => m.meta);
export const DEFAULT_TEMPLATE_REF = 'modele-01@1';

export function isKnownTemplateRef(ref: string): boolean {
  return ALL_TEMPLATE_METAS.some((m) => templateRef(m) === ref);
}

/** Dernière version de chaque modèle, dans l'ordre d'affichage. */
export function latestTemplateMetas(): TemplateMeta[] {
  const latest = new Map<string, TemplateMeta>();
  for (const m of ALL_TEMPLATE_METAS) {
    const current = latest.get(m.id);
    if (!current || m.version > current.version) latest.set(m.id, m);
  }
  return [...latest.values()].sort((a, b) => a.order - b.order);
}
```

`src/templates/registry.ts` :

```ts
import { DEFAULT_TEMPLATE_REF, latestTemplateMetas } from './catalog';
import { templateRef, type TemplateModule } from './types';

const found = import.meta.glob<{ default: TemplateModule }>('./*/v*/index.tsx', { eager: true });
const byRef = new Map(Object.values(found).map((m) => [templateRef(m.default.meta), m.default]));

export function getTemplate(ref: string): TemplateModule {
  return byRef.get(ref) ?? byRef.get(DEFAULT_TEMPLATE_REF)!;
}

export function selectableTemplates(): TemplateModule[] {
  return latestTemplateMetas()
    .map((m) => byRef.get(templateRef(m)))
    .filter((t): t is TemplateModule => t !== undefined);
}
```

`src/web/document/useTemplateFonts.ts` :

```ts
import { useEffect } from 'react';

export function useTemplateFonts(href: string): void {
  useEffect(() => {
    if (document.head.querySelector(`link[data-template-fonts="${CSS.escape(href)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.templateFonts = href;
    document.head.appendChild(link);
  }, [href]);
}
```

(jsdom ne fournit pas `CSS.escape` : si le test échoue pour cette raison, remplacer par une recherche `Array.from(document.head.querySelectorAll('link[data-template-fonts]')).some((l) => (l as HTMLLinkElement).dataset.templateFonts === href)`.)

- [ ] **Étape 4 : écrire les trois modèles (méta, module, vignette)**

`src/templates/modele-01/v1/meta.ts` :

```ts
import type { TemplateMeta } from '../../types';

export const meta: TemplateMeta = {
  id: 'modele-01',
  version: 1,
  name: 'Intemporel',
  description: 'Typographie nette, filets fins, beaucoup d’air. Lisible en toutes circonstances.',
  order: 1,
};
```

`src/templates/modele-01/v1/index.tsx` :

```tsx
import type { TemplateModule } from '../../types';
import { meta } from './meta';
import './style.css';

function Thumbnail() {
  return (
    <div className="tpl-thumb tpl-modele-01-v1-thumb" aria-hidden="true">
      <div className="t-bar" />
      <div className="t-title">DEVIS</div>
      <div className="t-rule" />
      <div className="t-parties"><div /><div /></div>
      <div className="t-head" />
      <div className="t-row" /><div className="t-row" /><div className="t-row" /><div className="t-row" />
      <div className="t-total" />
    </div>
  );
}

const template: TemplateModule = {
  meta,
  className: 'tpl-modele-01-v1',
  labels: { company: 'Entreprise', client: 'Client', object: 'Objet', terms: 'Modalités', approval: 'Bon pour accord', thanks: null },
  fontsHref: 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Manrope:wght@400;500;600;700&display=swap',
  Thumbnail,
};

export default template;
```

`src/templates/modele-01/v1/style.css` (vignette ; le style du document s'ajoute en tâche 17) :

```css
.tpl-modele-01-v1-thumb .t-bar { height: 8px; width: 60%; background: #111111; }
.tpl-modele-01-v1-thumb .t-title { font-family: Archivo, sans-serif; font-weight: 800; font-size: 26px; color: #111111; line-height: 1; }
.tpl-modele-01-v1-thumb .t-rule { height: 1px; background: #111111; }
.tpl-modele-01-v1-thumb .t-parties { display: flex; gap: 8px; }
.tpl-modele-01-v1-thumb .t-parties div { flex: 1; height: 26px; background: #F1F1F1; }
.tpl-modele-01-v1-thumb .t-head { height: 10px; background: #ECEDEF; border-bottom: 1px solid #111111; margin-top: 6px; }
.tpl-modele-01-v1-thumb .t-row { height: 6px; background: #E4E4E4; }
.tpl-modele-01-v1-thumb .t-total { align-self: flex-end; width: 45%; height: 10px; border-top: 2px solid #111111; border-bottom: 2px solid #111111; margin-top: auto; }
```

`src/templates/modele-02/v1/meta.ts` :

```ts
import type { TemplateMeta } from '../../types';

export const meta: TemplateMeta = {
  id: 'modele-02',
  version: 1,
  name: 'Discret',
  description: 'Tons sauge, blocs arrondis, hiérarchie douce. Pour une relation client apaisée.',
  order: 2,
};
```

`src/templates/modele-02/v1/index.tsx` :

```tsx
import type { TemplateModule } from '../../types';
import { meta } from './meta';
import './style.css';

function Thumbnail() {
  return (
    <div className="tpl-thumb tpl-modele-02-v1-thumb" aria-hidden="true">
      <div className="t-top"><div className="t-bar" /><div className="t-title">Devis</div></div>
      <div className="t-parties"><div /><div /></div>
      <div className="t-head" />
      <div className="t-row" /><div className="t-row t-row--plain" /><div className="t-row" /><div className="t-row t-row--plain" />
      <div className="t-total" />
    </div>
  );
}

const template: TemplateModule = {
  meta,
  className: 'tpl-modele-02-v1',
  labels: { company: 'De', client: 'Pour', object: 'Objet', terms: 'Modalités', approval: 'Bon pour accord', thanks: null },
  fontsHref: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap',
  Thumbnail,
};

export default template;
```

`src/templates/modele-02/v1/style.css` :

```css
.tpl-modele-02-v1-thumb .t-top { display: flex; justify-content: space-between; align-items: center; }
.tpl-modele-02-v1-thumb .t-bar { height: 8px; width: 45%; background: #4F6B5E; border-radius: 4px; }
.tpl-modele-02-v1-thumb .t-title { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 700; color: #4F6B5E; }
.tpl-modele-02-v1-thumb .t-parties { display: flex; gap: 8px; margin-top: 6px; }
.tpl-modele-02-v1-thumb .t-parties div { flex: 1; height: 30px; background: #EEF3F0; border-radius: 6px; }
.tpl-modele-02-v1-thumb .t-head { height: 10px; background: #DCE7E1; border-radius: 4px; margin-top: 6px; }
.tpl-modele-02-v1-thumb .t-row { height: 6px; background: #F3F6F4; }
.tpl-modele-02-v1-thumb .t-row--plain { background: #FFFFFF; border-bottom: 1px solid #EEF3F0; }
.tpl-modele-02-v1-thumb .t-total { align-self: flex-end; width: 50%; height: 22px; background: #EEF3F0; border-radius: 6px; margin-top: auto; }
```

`src/templates/modele-03/v1/meta.ts` :

```ts
import type { TemplateMeta } from '../../types';

export const meta: TemplateMeta = {
  id: 'modele-03',
  version: 1,
  name: 'Raffiné',
  description: 'Titres à empattements, bordeaux et laiton. Pour les prestations haut de gamme.',
  order: 3,
};
```

`src/templates/modele-03/v1/index.tsx` :

```tsx
import type { TemplateModule } from '../../types';
import { meta } from './meta';
import './style.css';

function Thumbnail() {
  return (
    <div className="tpl-thumb tpl-modele-03-v1-thumb" aria-hidden="true">
      <div className="t-title">Devis</div>
      <div className="t-double-rule" />
      <div className="t-parties"><div /><div /></div>
      <div className="t-head" />
      <div className="t-row" /><div className="t-row" /><div className="t-row" /><div className="t-row" />
      <div className="t-total" />
    </div>
  );
}

const template: TemplateModule = {
  meta,
  className: 'tpl-modele-03-v1',
  labels: { company: 'Prestataire', client: 'Client', object: 'Objet :', terms: 'Modalités', approval: 'Bon pour accord', thanks: 'Merci de votre confiance' },
  fontsHref: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&family=Source+Sans+3:wght@400;600;700&display=swap',
  Thumbnail,
};

export default template;
```

`src/templates/modele-03/v1/style.css` :

```css
.tpl-modele-03-v1-thumb { background: #FFFDF9; }
.tpl-modele-03-v1-thumb .t-title { align-self: center; font-family: Fraunces, serif; font-weight: 600; font-size: 22px; color: #6B2333; letter-spacing: 0.08em; }
.tpl-modele-03-v1-thumb .t-double-rule { border-top: 1px solid #B08D57; border-bottom: 1px solid #B08D57; height: 3px; }
.tpl-modele-03-v1-thumb .t-parties { display: flex; gap: 8px; }
.tpl-modele-03-v1-thumb .t-parties div { flex: 1; height: 26px; border: 1px solid #E8DCC8; }
.tpl-modele-03-v1-thumb .t-head { height: 1px; background: #6B2333; margin-top: 8px; }
.tpl-modele-03-v1-thumb .t-row { height: 6px; background: #F4EEE4; }
.tpl-modele-03-v1-thumb .t-total { align-self: flex-end; width: 50%; height: 16px; border-top: 2px solid #6B2333; margin-top: auto; }
```

`src/templates/README.md` :

```markdown
# Modèles visuels

Chaque modèle vit dans `src/templates/<id>/v<version>/` et fournit trois fichiers :

- `meta.ts` : `export const meta: TemplateMeta` (id, version, nom, description, ordre d'affichage) ;
- `index.tsx` : `export default` un `TemplateModule` (classe CSS racine, libellés, URL Google Fonts, vignette) ;
- `style.css` : styles du document, tous préfixés par la classe racine (`.tpl-<id>-v<version>`).

Le registre et le catalogue les découvrent avec `import.meta.glob` : **ajouter un modèle ne demande de modifier aucun autre fichier**.

Règle de versionnage : un modèle publié n'est jamais modifié. Pour le faire évoluer, copier `v1/` en `v2/`, changer `version` dans `meta.ts` et la classe racine, puis retoucher `v2/`. Les documents figés gardent la référence `modele-XX@1` de leur instantané et s'affichent toujours avec `v1/`. Seule la dernière version de chaque modèle est proposée au choix.
```

- [ ] **Étape 5 : relancer les tests**

Run: `npm run test:unit -- src/templates src/web/document && npm run typecheck`
Expected: PASS.

- [ ] **Étape 6 : commit**

```bash
git add src/templates src/web/document
git commit -m "feat: registre des modèles visuels versionnés, découvert automatiquement"
```

**Critère de fin :** les 3 modèles sont découverts sans liste écrite à la main ; une référence inconnue retombe sur Intemporel ; le test de structure échoue si un dossier de modèle est incomplet.

---

### Tâche 8 : API du profil entreprise et de la numérotation

**Fichiers :**
- Créer : `src/shared/profile.ts`, `src/shared/numbering.ts`, `src/worker/db/profiles.ts`, `src/worker/routes/profile.ts`, `test/worker/fixtures.ts`
- Modifier : `src/worker/routes/me.ts`, `src/worker/app.ts`, `src/shared/api-types.ts`
- Tests : `test/worker/profile.test.ts`, `src/shared/profile.test.ts`

**Interfaces :**
- Consomme : `isKnownTemplateRef`, `DEFAULT_TEMPLATE_REF` (tâche 7) ; `todayInParis`, `yearOf` (tâche 3).
- Produit (`shared/profile.ts`) : `ProfileInput` (schéma Zod), `type ProfileInput`, `type ProfileData = ProfileInput & { templateRef: string; vatRegime: 'franchise' }`, `DEFAULT_UNITS`, `isProfileComplete(p: ProfileData): boolean`.
- Produit (`shared/numbering.ts`) : `type Series = 'D' | 'F' | 'A'` ; `formatDocumentNumber(prefix: string, year: number, value: number): string`.
- Produit (`db/profiles.ts`) : `getProfile(db, userId): Promise<ProfileData | null>` ; `requireCompleteProfile(db, userId): Promise<ProfileData>` (409 `profile_incomplete`) ; `setTemplate(db, userId, ref, nowIso)` ; `saveProfile(db, userId, input, nowIso)`.
- Produit (API) : `GET /api/profile → { profile: ProfileData | null }` ; `PUT /api/profile (ProfileInput) → { profile }` ; `PUT /api/profile/template { templateRef } → { profile }` ; `GET /api/numbering → NumberingInfo` ; `PUT /api/numbering/start { series, startNumber } → NumberingInfo` ; `GET /api/me` enrichi de `onboarding` et `profileSummary`.
- Produit (`api-types.ts`) : `type NumberingInfo = { year: number; series: { series: Series; prefix: string; next: string; startEditable: boolean }[] }`.
- Produit (`test/worker/fixtures.ts`) : `PROFILE`, `seedProfile(app, user, overrides?)`, `twoUsers()`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/shared/profile.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ProfileInput, isProfileComplete } from './profile';
import { formatDocumentNumber } from './numbering';

const base = {
  tradeName: 'Benali Électricité', ownerName: 'Karim Benali', activityLine: '', street: '8 rue de la Fosse', postalCode: '44000', city: 'Nantes',
  siret: '912 345 678 00019', phone: '', email: '', logoDataUrl: null, insurer: '', insurancePolicy: '', insuranceArea: '',
  defaultQuoteValidityDays: 30, defaultPaymentDelayDays: 30, latePenaltyText: 'Pénalités…', paymentDetails: '',
  prefixQuote: 'd', prefixInvoice: 'F', prefixCredit: 'A', units: ['u', 'h'],
};

describe('ProfileInput', () => {
  it('nettoie le SIRET et met les préfixes en majuscules', () => {
    const p = ProfileInput.parse(base);
    expect(p.siret).toBe('91234567800019');
    expect(p.prefixQuote).toBe('D');
  });

  it('refuse un SIRET incomplet, des préfixes identiques, un délai de paiement > 60 jours', () => {
    expect(ProfileInput.safeParse({ ...base, siret: '123' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, prefixCredit: 'F' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, defaultPaymentDelayDays: 61 }).success).toBe(false);
  });

  it('refuse un logo qui n’est pas une image PNG/JPEG en data URL ou trop lourd', () => {
    expect(ProfileInput.safeParse({ ...base, logoDataUrl: 'https://exemple.fr/logo.png' }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, logoDataUrl: 'data:image/png;base64,' + 'A'.repeat(280_001) }).success).toBe(false);
    expect(ProfileInput.safeParse({ ...base, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }).success).toBe(true);
  });
});

describe('isProfileComplete', () => {
  it('exige nom, adresse et SIRET', () => {
    const full = { ...ProfileInput.parse(base), templateRef: 'modele-01@1', vatRegime: 'franchise' as const };
    expect(isProfileComplete(full)).toBe(true);
    expect(isProfileComplete({ ...full, siret: '' })).toBe(false);
    expect(isProfileComplete({ ...full, city: '' })).toBe(false);
  });
});

describe('formatDocumentNumber', () => {
  it('complète sur 3 chiffres au minimum', () => {
    expect(formatDocumentNumber('F', 2026, 1)).toBe('F-2026-001');
    expect(formatDocumentNumber('FA', 2027, 1234)).toBe('FA-2027-1234');
  });
});
```

`test/worker/fixtures.ts` :

```ts
import { call, createAllowedUser, testApp } from './helpers';
import type { SessionUser } from '../../src/worker/types';

type App = ReturnType<typeof testApp>;

export const PROFILE = {
  tradeName: 'Benali Électricité',
  ownerName: 'Karim Benali',
  activityLine: 'Électricité générale • Installation • Rénovation',
  street: '8 rue de la Fosse',
  postalCode: '44000',
  city: 'Nantes',
  siret: '912 345 678 00019',
  phone: '06 12 34 56 78',
  email: 'contact@benali-elec.fr',
  logoDataUrl: null,
  insurer: 'MAAF Pro',
  insurancePolicy: 'DEC-4471209',
  insuranceArea: 'France métropolitaine',
  defaultQuoteValidityDays: 30,
  defaultPaymentDelayDays: 30,
  latePenaltyText: 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.',
  paymentDetails: 'FR76 3000 6000 0112 3456 7890 189',
  prefixQuote: 'D',
  prefixInvoice: 'F',
  prefixCredit: 'A',
  units: ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'],
};

export async function seedProfile(app: App, user: SessionUser, overrides: Partial<typeof PROFILE> = {}): Promise<void> {
  const t = await call(app, user, 'PUT', '/api/profile/template', { templateRef: 'modele-01@1' });
  if (t.status !== 200) throw new Error(`template: ${t.status} ${await t.text()}`);
  const p = await call(app, user, 'PUT', '/api/profile', { ...PROFILE, ...overrides });
  if (p.status !== 200) throw new Error(`profile: ${p.status} ${await p.text()}`);
}

export async function twoUsers(app: App): Promise<{ a: SessionUser; b: SessionUser }> {
  const a = await createAllowedUser('karim@example.test', 'Karim Benali');
  const b = await createAllowedUser('lea@example.test', 'Léa Morel');
  await seedProfile(app, a);
  await seedProfile(app, b, { tradeName: 'Léa Morel – Studio', ownerName: 'Léa Morel', siret: '80122233300015' });
  return { a, b };
}
```

`test/worker/profile.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { PROFILE, seedProfile } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

describe('profil', () => {
  it('n’existe pas au premier démarrage', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect(await json(await call(app, u, 'GET', '/api/profile'))).toEqual({ profile: null });
    expect(await json(await call(app, u, 'GET', '/api/me'))).toMatchObject({ onboarding: { templateRef: null, profileComplete: false }, profileSummary: null });
  });

  it('enregistre le modèle choisi, refuse un modèle inconnu', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect((await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-99@1' })).status).toBe(400);
    expect((await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-03@1' })).status).toBe(200);
    expect(await json(await call(app, u, 'GET', '/api/me'))).toMatchObject({ onboarding: { templateRef: 'modele-03@1', profileComplete: false } });
  });

  it('marque le profil complet après enregistrement et garde le modèle', async () => {
    const u = await createAllowedUser('karim@example.test');
    await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-02@1' });
    const res = await call(app, u, 'PUT', '/api/profile', PROFILE);
    expect(res.status).toBe(200);
    expect((await json(res)).profile).toMatchObject({ siret: '91234567800019', templateRef: 'modele-02@1', vatRegime: 'franchise' });
    expect(await json(await call(app, u, 'GET', '/api/me'))).toMatchObject({ onboarding: { profileComplete: true }, profileSummary: { ownerName: 'Karim Benali', tradeName: 'Benali Électricité' } });
  });

  it('répond 400 avec les champs fautifs', async () => {
    const u = await createAllowedUser('karim@example.test');
    const res = await call(app, u, 'PUT', '/api/profile', { ...PROFILE, siret: '12', prefixCredit: 'F' });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.issues.map((i: { path: string[] }) => i.path[0])).toEqual(expect.arrayContaining(['siret', 'prefixCredit']));
  });

  it('ne montre à chacun que son propre profil', async () => {
    const a = await createAllowedUser('karim@example.test');
    const b = await createAllowedUser('lea@example.test');
    await seedProfile(app, a);
    expect(await json(await call(app, b, 'GET', '/api/profile'))).toEqual({ profile: null });
  });
});

describe('numérotation (réglages)', () => {
  it('annonce les prochains numéros de l’année en cours', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const info = await json(await call(app, u, 'GET', '/api/numbering'));
    expect(info).toEqual({
      year: 2026,
      series: [
        { series: 'D', prefix: 'D', next: 'D-2026-001', startEditable: true },
        { series: 'F', prefix: 'F', next: 'F-2026-001', startEditable: true },
        { series: 'A', prefix: 'A', next: 'A-2026-001', startEditable: true },
      ],
    });
  });

  it('accepte un numéro de départ une seule fois par série', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const res = await call(app, u, 'PUT', '/api/numbering/start', { series: 'F', startNumber: 42 });
    expect(res.status).toBe(200);
    expect((await json(res)).series[1]).toEqual({ series: 'F', prefix: 'F', next: 'F-2026-042', startEditable: false });
    expect((await call(app, u, 'PUT', '/api/numbering/start', { series: 'F', startNumber: 50 })).status).toBe(409);
    expect((await call(app, u, 'PUT', '/api/numbering/start', { series: 'F', startNumber: 0 })).status).toBe(400);
  });

  it('suit les préfixes du profil', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u, { prefixInvoice: 'FA' });
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('FA-2026-001');
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/shared/profile && npm run test:worker -- profile`
Expected: FAIL (modules et routes absents).

- [ ] **Étape 3 : écrire `src/shared/profile.ts` et `src/shared/numbering.ts`**

```ts
// src/shared/profile.ts
import { z } from 'zod';

export const DEFAULT_UNITS = ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'];
const text = (max: number) => z.string().trim().max(max);
const prefix = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, '1 à 6 lettres ou chiffres');

export const ProfileInput = z
  .object({
    tradeName: text(120),
    ownerName: text(120).min(1, 'Prénom et nom obligatoires'),
    activityLine: text(200),
    street: text(200).min(1, 'Adresse obligatoire'),
    postalCode: text(10).min(1, 'Code postal obligatoire'),
    city: text(100).min(1, 'Ville obligatoire'),
    siret: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^\d{14}$/, 'Le SIRET compte 14 chiffres')),
    phone: text(30),
    email: z.union([z.literal(''), z.email('Adresse e-mail invalide')]),
    logoDataUrl: z.string().max(280_000, 'Logo trop lourd (200 Ko maximum)').regex(/^data:image\/(png|jpeg);base64,/, 'Logo PNG ou JPEG attendu').nullable(),
    insurer: text(120),
    insurancePolicy: text(120),
    insuranceArea: text(120),
    defaultQuoteValidityDays: z.number().int().min(1).max(365),
    defaultPaymentDelayDays: z.number().int().min(0).max(60, '60 jours au maximum (article L441-10 du Code de commerce)'),
    latePenaltyText: text(500).min(1),
    paymentDetails: text(300),
    prefixQuote: prefix,
    prefixInvoice: prefix,
    prefixCredit: prefix,
    units: z.array(text(20).min(1)).min(1).max(30),
  })
  .refine((p) => new Set([p.prefixQuote, p.prefixInvoice, p.prefixCredit]).size === 3, {
    message: 'Les trois préfixes doivent être différents',
    path: ['prefixCredit'],
  });

export type ProfileInput = z.infer<typeof ProfileInput>;
export type ProfileData = ProfileInput & { templateRef: string; vatRegime: 'franchise' };

export function isProfileComplete(p: ProfileData): boolean {
  return p.ownerName !== '' && p.street !== '' && p.postalCode !== '' && p.city !== '' && /^\d{14}$/.test(p.siret);
}
```

```ts
// src/shared/numbering.ts
export type Series = 'D' | 'F' | 'A';

/** Doit rester identique au printf('%s-%d-%03d') de src/worker/numbering.ts. */
export function formatDocumentNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(3, '0')}`;
}
```

- [ ] **Étape 4 : écrire `src/worker/db/profiles.ts`**

```ts
import { DEFAULT_TEMPLATE_REF } from '../../templates/catalog';
import { isProfileComplete, type ProfileData, type ProfileInput } from '../../shared/profile';
import { HttpError } from '../errors';

const FIELDS = [
  ['tradeName', 'trade_name'], ['ownerName', 'owner_name'], ['activityLine', 'activity_line'],
  ['street', 'street'], ['postalCode', 'postal_code'], ['city', 'city'], ['siret', 'siret'],
  ['phone', 'phone'], ['email', 'email'], ['logoDataUrl', 'logo_data_url'],
  ['insurer', 'insurer'], ['insurancePolicy', 'insurance_policy'], ['insuranceArea', 'insurance_area'],
  ['defaultQuoteValidityDays', 'default_quote_validity_days'], ['defaultPaymentDelayDays', 'default_payment_delay_days'],
  ['latePenaltyText', 'late_penalty_text'], ['paymentDetails', 'payment_details'],
  ['prefixQuote', 'prefix_quote'], ['prefixInvoice', 'prefix_invoice'], ['prefixCredit', 'prefix_credit'],
] as const;

type Row = Record<string, unknown> & { template_ref: string; vat_regime: string; units_json: string };

function rowToProfile(r: Row): ProfileData {
  const p = Object.fromEntries(FIELDS.map(([k, col]) => [k, r[col]])) as Omit<ProfileInput, 'units'>;
  return { ...p, units: JSON.parse(r.units_json), templateRef: r.template_ref, vatRegime: 'franchise' };
}

export async function getProfile(db: D1Database, userId: string): Promise<ProfileData | null> {
  const row = await db.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first<Row>();
  return row ? rowToProfile(row) : null;
}

export async function requireCompleteProfile(db: D1Database, userId: string): Promise<ProfileData> {
  const p = await getProfile(db, userId);
  if (!p || !isProfileComplete(p)) {
    throw new HttpError(409, 'profile_incomplete', 'Complétez votre profil entreprise (nom, adresse, SIRET) avant de continuer.');
  }
  return p;
}

export async function setTemplate(db: D1Database, userId: string, ref: string, nowIso: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profiles (user_id, template_ref, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET template_ref = excluded.template_ref, updated_at = excluded.updated_at`,
    )
    .bind(userId, ref, nowIso, nowIso)
    .run();
}

export async function saveProfile(db: D1Database, userId: string, input: ProfileInput, nowIso: string): Promise<void> {
  const cols = FIELDS.map(([, col]) => col);
  const values = FIELDS.map(([k]) => input[k]);
  await db
    .prepare(
      `INSERT INTO profiles (user_id, template_ref, ${cols.join(', ')}, units_json, created_at, updated_at)
       VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
         units_json = excluded.units_json, updated_at = excluded.updated_at`,
    )
    .bind(userId, DEFAULT_TEMPLATE_REF, ...values, JSON.stringify(input.units), nowIso, nowIso)
    .run();
}
```

- [ ] **Étape 5 : écrire `src/worker/routes/profile.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { NumberingInfo } from '../../shared/api-types';
import { todayInParis, yearOf } from '../../shared/dates';
import { formatDocumentNumber, type Series } from '../../shared/numbering';
import { ProfileInput } from '../../shared/profile';
import { isKnownTemplateRef } from '../../templates/catalog';
import { getProfile, saveProfile, setTemplate } from '../db/profiles';
import { HttpError, validate } from '../errors';
import type { AppContext, AppEnv } from '../types';

const SERIES: Series[] = ['D', 'F', 'A'];

async function numberingInfo(c: AppContext): Promise<NumberingInfo> {
  const userId = c.var.user.id;
  const profile = await getProfile(c.env.DB, userId);
  const prefixes: Record<Series, string> = {
    D: profile?.prefixQuote ?? 'D',
    F: profile?.prefixInvoice ?? 'F',
    A: profile?.prefixCredit ?? 'A',
  };
  const year = yearOf(todayInParis(c.var.deps.now()));
  const { results } = await c.env.DB.prepare('SELECT series, year, last_value FROM counters WHERE user_id = ?')
    .bind(userId)
    .all<{ series: Series; year: number; last_value: number }>();
  return {
    year,
    series: SERIES.map((s) => {
      const current = results.find((r) => r.series === s && r.year === year);
      return {
        series: s,
        prefix: prefixes[s],
        next: formatDocumentNumber(prefixes[s], year, (current?.last_value ?? 0) + 1),
        startEditable: !results.some((r) => r.series === s),
      };
    }),
  };
}

export const profileRoutes = new Hono<AppEnv>()
  .get('/profile', async (c) => c.json({ profile: await getProfile(c.env.DB, c.var.user.id) }))
  .put('/profile', validate('json', ProfileInput), async (c) => {
    await saveProfile(c.env.DB, c.var.user.id, c.req.valid('json'), c.var.deps.now().toISOString());
    return c.json({ profile: await getProfile(c.env.DB, c.var.user.id) });
  })
  .put('/profile/template', validate('json', z.object({ templateRef: z.string().refine(isKnownTemplateRef, 'Modèle inconnu') })), async (c) => {
    await setTemplate(c.env.DB, c.var.user.id, c.req.valid('json').templateRef, c.var.deps.now().toISOString());
    return c.json({ profile: await getProfile(c.env.DB, c.var.user.id) });
  })
  .get('/numbering', async (c) => c.json(await numberingInfo(c)))
  .put(
    '/numbering/start',
    validate('json', z.object({ series: z.enum(['D', 'F', 'A']), startNumber: z.number().int().min(1).max(999_999) })),
    async (c) => {
      const { series, startNumber } = c.req.valid('json');
      const userId = c.var.user.id;
      const year = yearOf(todayInParis(c.var.deps.now()));
      const res = await c.env.DB.prepare(
        `INSERT INTO counters (user_id, series, year, last_value)
         SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM counters WHERE user_id = ? AND series = ?)`,
      ).bind(userId, series, year, startNumber - 1, userId, series).run();
      if (res.meta.changes === 0) {
        throw new HttpError(409, 'numbering_locked', 'Le numéro de départ ne peut plus être modifié pour cette série.');
      }
      return c.json(await numberingInfo(c));
    },
  );
```

Ajouter à `src/shared/api-types.ts` :

```ts
import type { Series } from './numbering';

export type NumberingInfo = {
  year: number;
  series: { series: Series; prefix: string; next: string; startEditable: boolean }[];
};
```

Et rendre `onboarding` / `profileSummary` obligatoires dans `MeResponse` :

```ts
export type MeResponse = {
  user: { id: string; email: string; name: string };
  isSuperadmin: boolean;
  onboarding: { templateRef: string | null; profileComplete: boolean };
  profileSummary: { ownerName: string; tradeName: string } | null;
};
```

`src/worker/routes/me.ts` :

```ts
import { Hono } from 'hono';
import type { MeResponse } from '../../shared/api-types';
import { isProfileComplete } from '../../shared/profile';
import { isSuperadmin } from '../access';
import { getProfile } from '../db/profiles';
import type { AppEnv } from '../types';

export const meRoutes = new Hono<AppEnv>().get('/me', async (c) => {
  const user = c.var.user;
  const profile = await getProfile(c.env.DB, user.id);
  const body: MeResponse = {
    user,
    isSuperadmin: isSuperadmin(c.env, user.email),
    onboarding: { templateRef: profile?.templateRef ?? null, profileComplete: profile ? isProfileComplete(profile) : false },
    profileSummary: profile && profile.ownerName ? { ownerName: profile.ownerName, tradeName: profile.tradeName } : null,
  };
  return c.json(body);
});
```

Brancher dans `src/worker/app.ts` : `api.route('/', profileRoutes);`

- [ ] **Étape 6 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS (dont le test de `/api/me` de la tâche 4, qui ne vérifie que `user` et `isSuperadmin`).

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat: API du profil entreprise, choix du modèle et réglages de numérotation"
```

**Critère de fin :** le profil se crée au choix du modèle, se complète, se valide (SIRET, préfixes distincts, logo) ; le numéro de départ ne se règle qu'une fois par série ; chaque utilisateur ne voit que son profil.

---

### Tâche 9 : premier démarrage, page Profil, changement de modèle (interface)

**Fichiers :**
- Créer : `src/web/session/onboarding.ts`, `src/web/pages/TemplatePickerPage.tsx`, `src/web/pages/TemplatePickerPage.css`, `src/web/pages/ProfilePage.tsx`, `src/web/profile/logo.ts`, `src/web/profile/useProfile.ts`, `src/web/layout/OnboardingLayout.tsx`
- Modifier : `src/web/session/RequireAuth.tsx`, `src/web/App.tsx`
- Tests : `src/web/session/onboarding.test.ts`, `src/web/profile/logo.test.ts`, `src/web/pages/ProfilePage.test.tsx`

**Maquettes :** `docs/maquettes/Modele.dc.html`, `docs/maquettes/Profil.dc.html`.

**Interfaces :**
- Consomme : `MeResponse`, `NumberingInfo`, `ProfileData`, `selectableTemplates`, `getTemplate`.
- Produit : `onboardingRedirect(me: MeResponse, pathname: string): string | null` ; `fitWithin(width: number, height: number, max: number): { width: number; height: number }` ; `fileToLogoDataUrl(file: File): Promise<string>` ; `useProfile()` (clé `['profile']`) ; `<TemplatePickerPage mode="onboarding" | "settings" />` ; `<ProfilePage mode="onboarding" | "settings" />`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/web/session/onboarding.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../../shared/api-types';
import { onboardingRedirect } from './onboarding';

const me = (templateRef: string | null, profileComplete: boolean): MeResponse => ({
  user: { id: 'u', email: 'a@b.c', name: 'A' },
  isSuperadmin: false,
  onboarding: { templateRef, profileComplete },
  profileSummary: null,
});

describe('onboardingRedirect', () => {
  it('commence par le choix du modèle', () => {
    expect(onboardingRedirect(me(null, false), '/')).toBe('/bienvenue/modele');
    expect(onboardingRedirect(me(null, false), '/bienvenue/modele')).toBeNull();
  });

  it('enchaîne sur le profil une fois le modèle choisi', () => {
    expect(onboardingRedirect(me('modele-01@1', false), '/devis')).toBe('/bienvenue/entreprise');
    expect(onboardingRedirect(me('modele-01@1', false), '/bienvenue/entreprise')).toBeNull();
    expect(onboardingRedirect(me('modele-01@1', false), '/bienvenue/modele')).toBeNull();
  });

  it('laisse passer un profil complet et le sort du parcours d’accueil', () => {
    expect(onboardingRedirect(me('modele-01@1', true), '/devis')).toBeNull();
    expect(onboardingRedirect(me('modele-01@1', true), '/bienvenue/modele')).toBe('/');
  });

  it('laisse le superadmin gérer les accès avant d’avoir rempli son profil', () => {
    expect(onboardingRedirect({ ...me(null, false), isSuperadmin: true }, '/admin')).toBeNull();
  });
});
```

`src/web/profile/logo.test.ts` :

```ts
import { expect, it } from 'vitest';
import { fitWithin } from './logo';

it('réduit en gardant les proportions, sans agrandir', () => {
  expect(fitWithin(1200, 600, 400)).toEqual({ width: 400, height: 200 });
  expect(fitWithin(300, 900, 400)).toEqual({ width: 133, height: 400 });
  expect(fitWithin(200, 100, 400)).toEqual({ width: 200, height: 100 });
});
```

`src/web/pages/ProfilePage.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

afterEach(() => vi.unstubAllGlobals());

it('affiche la mention de franchise et envoie un profil complet', async () => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/numbering') return Response.json({ year: 2026, series: [
      { series: 'D', prefix: 'D', next: 'D-2026-001', startEditable: true },
      { series: 'F', prefix: 'F', next: 'F-2026-001', startEditable: true },
      { series: 'A', prefix: 'A', next: 'A-2026-001', startEditable: true },
    ] });
    if (url === '/api/profile' && (init?.method ?? 'GET') === 'GET') return Response.json({ profile: null });
    return Response.json({ profile: {} });
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><ProfilePage mode="onboarding" /></MemoryRouter></QueryClientProvider>);

  expect(await screen.findByText(/TVA non applicable, art\. 293 B du CGI/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Prénom et nom'), 'Karim Benali');
  await userEvent.type(screen.getByLabelText('Adresse'), '8 rue de la Fosse');
  await userEvent.type(screen.getByLabelText('Code postal'), '44000');
  await userEvent.type(screen.getByLabelText('Ville'), 'Nantes');
  await userEvent.type(screen.getByLabelText('SIRET'), '912 345 678 00019');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/profile')).toBe(true));
  const put = calls.find((c) => c.method === 'PUT' && c.url === '/api/profile')!;
  expect(put.body).toMatchObject({ ownerName: 'Karim Benali', siret: '912 345 678 00019', defaultPaymentDelayDays: 30, units: ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'] });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/web`
Expected: FAIL, modules introuvables.

- [ ] **Étape 3 : écrire la logique de redirection et le logo**

`src/web/session/onboarding.ts` :

```ts
import type { MeResponse } from '../../shared/api-types';

export function onboardingRedirect(me: MeResponse, pathname: string): string | null {
  if (pathname.startsWith('/admin')) return null;
  const { templateRef, profileComplete } = me.onboarding;
  if (!templateRef) return pathname === '/bienvenue/modele' ? null : '/bienvenue/modele';
  if (!profileComplete) return pathname.startsWith('/bienvenue/') ? null : '/bienvenue/entreprise';
  return pathname.startsWith('/bienvenue/') ? '/' : null;
}
```

Dans `src/web/session/RequireAuth.tsx`, après les cas d'erreur :

```tsx
import { Navigate, Outlet, useLocation } from 'react-router';
import { onboardingRedirect } from './onboarding';
// …
const location = useLocation();
// … (après les tests d'erreur)
const redirect = me.data ? onboardingRedirect(me.data, location.pathname) : null;
if (redirect) return <Navigate to={redirect} replace />;
return <Outlet />;
```

(Le test « contenu protégé » de la tâche 5 fournit un profil complet : il reste vert.)

`src/web/profile/logo.ts` :

```ts
export const LOGO_MAX_SIDE = 400;
export const LOGO_MAX_CHARS = 280_000;

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Redimensionne dans le navigateur ; refuse au-delà de ~200 Ko. */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height, LOGO_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height);
  const attempts = file.type === 'image/png' ? [canvas.toDataURL('image/png'), canvas.toDataURL('image/jpeg', 0.85)] : [canvas.toDataURL('image/jpeg', 0.85), canvas.toDataURL('image/jpeg', 0.7)];
  const ok = attempts.find((d) => d.length <= LOGO_MAX_CHARS);
  if (!ok) throw new Error('Ce logo reste trop lourd après réduction. Essayez une image plus simple.');
  return ok;
}
```

`src/web/profile/useProfile.ts` :

```ts
import { useQuery } from '@tanstack/react-query';
import type { NumberingInfo } from '../../shared/api-types';
import type { ProfileData } from '../../shared/profile';
import { api } from '../api';

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => api<{ profile: ProfileData | null }>('GET', '/api/profile') });
export const useNumbering = () => useQuery({ queryKey: ['numbering'], queryFn: () => api<NumberingInfo>('GET', '/api/numbering') });
```

- [ ] **Étape 4 : écrire la page de choix du modèle**

`src/web/layout/OnboardingLayout.tsx` (en-tête de `Modele.dc.html` : logo + pastilles « 1. Modèle », « 2. Votre entreprise ») :

```tsx
import type { ReactNode } from 'react';

export function OnboardingLayout({ step, children }: { step: 1 | 2; children: ReactNode }) {
  const pill = (n: 1 | 2, label: string) => (
    <li className={n === step ? 'step step--current' : 'step'} aria-current={n === step ? 'step' : undefined}>{n}. {label}</li>
  );
  return (
    <main className="onboarding">
      <div className="onboarding-inner">
        <header className="onboarding-head">
          <div className="shell-brand"><span className="brand-mark" aria-hidden="true">D</span><span>Devis &amp; Factures</span></div>
          <ol aria-label="Étapes" className="steps">{pill(1, 'Modèle')}{pill(2, 'Votre entreprise')}</ol>
        </header>
        {children}
      </div>
    </main>
  );
}
```

`src/web/pages/TemplatePickerPage.tsx` (cartes de `Modele.dc.html` : vignette sur fond `#EEF0F5`, nom, description, bouton radio ; carte choisie bordée `#3448E0` avec ombre) :

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DEFAULT_TEMPLATE_REF } from '../../templates/catalog';
import { selectableTemplates } from '../../templates/registry';
import { templateRef } from '../../templates/types';
import { api } from '../api';
import { OnboardingLayout } from '../layout/OnboardingLayout';
import { useMe } from '../session/useMe';
import './TemplatePickerPage.css';

export function TemplatePickerPage({ mode }: { mode: 'onboarding' | 'settings' }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const templates = selectableTemplates();
  const [picked, setPicked] = useState(me?.onboarding.templateRef ?? DEFAULT_TEMPLATE_REF);
  const pickedName = templates.find((t) => templateRef(t.meta) === picked)?.meta.name ?? templates[0]!.meta.name;
  const save = useMutation({
    mutationFn: () => api('PUT', '/api/profile/template', { templateRef: picked }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['profile'] });
      navigate(mode === 'onboarding' ? '/bienvenue/entreprise' : '/profil');
    },
  });

  const content = (
    <div className="picker">
      <div className="picker-intro">
        <h1 className="page-title" style={{ fontSize: 44, lineHeight: 1.05 }}>Choisissez l’apparence de vos documents</h1>
        <p className="page-intro" style={{ fontSize: 17 }}>Devis, factures d’acompte, factures de solde et avoirs prendront ce style. Vous pourrez en changer à tout moment dans votre profil ; les documents déjà émis gardent le leur.</p>
      </div>
      <div className="picker-grid">
        {templates.map((t) => {
          const ref = templateRef(t.meta);
          const on = ref === picked;
          return (
            <button key={ref} type="button" className={on ? 'picker-card picker-card--on' : 'picker-card'} aria-pressed={on} onClick={() => setPicked(ref)}>
              <div className="picker-preview"><t.Thumbnail /></div>
              <div className="picker-caption">
                <div><span className="picker-name">{t.meta.name}</span><span className="picker-desc">{t.meta.description}</span></div>
                <span className="picker-radio" aria-hidden="true"><span /></span>
              </div>
            </button>
          );
        })}
      </div>
      <p className="page-intro" style={{ fontSize: 14 }}>Sept autres modèles arriveront après le lancement.</p>
      <div className="picker-footer">
        <button type="button" className="btn btn-primary" style={{ height: 52, borderRadius: 14 }} onClick={() => save.mutate()} disabled={save.isPending}>
          {mode === 'onboarding' ? `Continuer avec « ${pickedName} »` : `Utiliser « ${pickedName} »`}
        </button>
      </div>
    </div>
  );
  return mode === 'onboarding' ? <OnboardingLayout step={1}>{content}</OnboardingLayout> : content;
}
```

`src/web/pages/TemplatePickerPage.css` (inclut la base `.tpl-thumb` partagée par toutes les vignettes) :

```css
.onboarding { min-height: 100vh; padding: 40px 24px 64px; }
.onboarding-inner { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px; }
.onboarding-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; font-size: 14px; font-weight: 600; }
.step { padding: 8px 14px; border-radius: 999px; background: var(--c-surface); border: 1px solid var(--c-border-input); color: var(--c-text-muted); }
.step--current { background: var(--c-primary-soft); border-color: var(--c-primary-soft); color: var(--c-primary-strong); }
.picker { display: flex; flex-direction: column; gap: 40px; }
.picker-intro { display: flex; flex-direction: column; gap: 12px; max-width: 680px; }
.picker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; }
.picker-card { display: flex; flex-direction: column; gap: 18px; padding: 16px; border-radius: 18px; background: var(--c-surface); cursor: pointer; font-family: inherit; text-align: left; border: 2px solid var(--c-border); }
.picker-card--on { border-color: var(--c-primary); box-shadow: 0 10px 30px rgba(52, 72, 224, 0.18); }
.picker-preview { background: #EEF0F5; border-radius: 12px; padding: 22px; display: flex; justify-content: center; }
.picker-caption { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.picker-caption > div { display: flex; flex-direction: column; gap: 4px; }
.picker-name { font-family: var(--font-display); font-weight: 700; font-size: 20px; color: var(--c-text); }
.picker-desc { font-size: 14px; line-height: 1.5; color: var(--c-text-muted); }
.picker-radio { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--c-placeholder); display: flex; align-items: center; justify-content: center; margin-top: 3px; }
.picker-radio span { width: 10px; height: 10px; border-radius: 50%; }
.picker-card--on .picker-radio { border-color: var(--c-primary); }
.picker-card--on .picker-radio span { background: var(--c-primary); }
.picker-footer { display: flex; justify-content: flex-end; border-top: 1px solid var(--c-border); padding-top: 24px; }
.tpl-thumb { width: 200px; height: 270px; background: #FFFFFF; box-shadow: 0 6px 18px rgba(20, 22, 31, 0.12); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
```

- [ ] **Étape 5 : écrire la page Profil**

`src/web/pages/ProfilePage.tsx`. Sections et libellés de `Profil.dc.html`, avec l'adresse structurée (Adresse, Code postal, Ville) et les réglages par défaut. Formulaire à états texte ; conversion des nombres à l'envoi ; erreurs de validation affichées sous chaque champ à partir de `ApiError.issues` (`issue.path[0]`).

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DEFAULT_UNITS, type ProfileData } from '../../shared/profile';
import { ApiError, api } from '../api';
import { OnboardingLayout } from '../layout/OnboardingLayout';
import { fileToLogoDataUrl } from '../profile/logo';
import { useNumbering, useProfile } from '../profile/useProfile';

type Form = Record<
  'tradeName' | 'ownerName' | 'activityLine' | 'street' | 'postalCode' | 'city' | 'siret' | 'phone' | 'email' | 'insurer' | 'insurancePolicy' | 'insuranceArea' |
  'defaultQuoteValidityDays' | 'defaultPaymentDelayDays' | 'latePenaltyText' | 'paymentDetails' | 'prefixQuote' | 'prefixInvoice' | 'prefixCredit' | 'units',
  string
> & { logoDataUrl: string | null };

const DEFAULT_PENALTY = 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.';

function toForm(p: ProfileData | null): Form {
  return {
    tradeName: p?.tradeName ?? '', ownerName: p?.ownerName ?? '', activityLine: p?.activityLine ?? '',
    street: p?.street ?? '', postalCode: p?.postalCode ?? '', city: p?.city ?? '', siret: p?.siret ?? '',
    phone: p?.phone ?? '', email: p?.email ?? '', logoDataUrl: p?.logoDataUrl ?? null,
    insurer: p?.insurer ?? '', insurancePolicy: p?.insurancePolicy ?? '', insuranceArea: p?.insuranceArea ?? '',
    defaultQuoteValidityDays: String(p?.defaultQuoteValidityDays ?? 30), defaultPaymentDelayDays: String(p?.defaultPaymentDelayDays ?? 30),
    latePenaltyText: p?.latePenaltyText || DEFAULT_PENALTY, paymentDetails: p?.paymentDetails ?? '',
    prefixQuote: p?.prefixQuote ?? 'D', prefixInvoice: p?.prefixInvoice ?? 'F', prefixCredit: p?.prefixCredit ?? 'A',
    units: (p?.units ?? DEFAULT_UNITS).join(', '),
  };
}

function toPayload(f: Form) {
  return {
    ...f,
    defaultQuoteValidityDays: Number.parseInt(f.defaultQuoteValidityDays, 10),
    defaultPaymentDelayDays: Number.parseInt(f.defaultPaymentDelayDays, 10),
    units: f.units.split(',').map((u) => u.trim()).filter(Boolean),
  };
}

export function ProfilePage({ mode }: { mode: 'onboarding' | 'settings' }) {
  const profile = useProfile();
  const numbering = useNumbering();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(toForm(null));
  const [logoError, setLogoError] = useState<string | null>(null);
  const [starts, setStarts] = useState<Record<string, string>>({});

  useEffect(() => { if (profile.data) setForm(toForm(profile.data.profile)); }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api('PUT', '/api/profile', toPayload(form)),
    onSuccess: async () => {
      await Promise.all(['me', 'profile', 'numbering'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      if (mode === 'onboarding') navigate('/');
    },
  });
  const setStart = useMutation({
    mutationFn: (s: { series: string; startNumber: number }) => api('PUT', '/api/numbering/start', s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['numbering'] }),
  });

  const issues = save.error instanceof ApiError && Array.isArray(save.error.issues) ? (save.error.issues as { path: string[]; message: string }[]) : [];
  const errorOf = (k: string) => issues.find((i) => i.path[0] === k)?.message;
  const field = (k: keyof Form, label: string, opts: { hint?: string; span?: boolean; type?: string } = {}) => (
    <label className={opts.span ? 'field span-all' : 'field'}>
      <span>{label}{opts.hint && <span className="field-hint"> {opts.hint}</span>}</span>
      <input className="input" type={opts.type ?? 'text'} aria-label={label} aria-invalid={errorOf(k) ? true : undefined}
        value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      {errorOf(k) && <span className="field-error">{errorOf(k)}</span>}
    </label>
  );
  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    try { setLogoError(null); setForm({ ...form, logoDataUrl: await fileToLogoDataUrl(file) }); }
    catch (e) { setLogoError((e as Error).message); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  const content = (
    <form className="page" style={{ maxWidth: 980, gap: 22 }} onSubmit={submit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="page-title">Votre entreprise</h1>
        <p className="page-intro">Ces informations s’ajoutent à chaque nouveau devis et à chaque facture. Une modification ne touche pas les documents déjà émis.</p>
      </div>

      <section className="card form-grid" aria-labelledby="h-id">
        <h2 id="h-id" className="card-title span-all">Identité</h2>
        <div className="span-all" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="logo-slot">{form.logoDataUrl ? <img src={form.logoDataUrl} alt="Logo" /> : 'Logo'}</div>
          <label className="btn btn-secondary" style={{ height: 42 }}>
            Importer un logo
            <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
          </label>
          {form.logoDataUrl && <button type="button" className="btn btn-secondary" style={{ height: 42 }} onClick={() => setForm({ ...form, logoDataUrl: null })}>Retirer</button>}
          <span className="field-hint" style={{ fontSize: 13 }}>PNG ou JPG, facultatif</span>
          {logoError && <span className="field-error">{logoError}</span>}
        </div>
        {field('tradeName', 'Nom commercial')}
        {field('ownerName', 'Prénom et nom')}
        {field('activityLine', 'Ligne d’activité', { hint: 'affichée sous votre nom sur les documents', span: true })}
        {field('siret', 'SIRET')}
        <div className="field">Statut<div className="input" style={{ background: 'var(--c-bg)', border: 'none', display: 'flex', alignItems: 'center', fontWeight: 500 }}>Entrepreneur individuel (EI)</div></div>
      </section>

      <section className="card form-grid" aria-labelledby="h-coord">
        <h2 id="h-coord" className="card-title span-all">Coordonnées</h2>
        {field('street', 'Adresse', { span: true })}
        {field('postalCode', 'Code postal')}
        {field('city', 'Ville')}
        {field('phone', 'Téléphone', { type: 'tel' })}
        {field('email', 'E-mail', { type: 'email' })}
      </section>

      <section className="card form-grid" aria-labelledby="h-reg">
        <h2 id="h-reg" className="card-title span-all">Mentions et assurance</h2>
        <div className="notice span-all">Franchise en base de TVA : vos documents portent « TVA non applicable, art. 293 B du CGI ».</div>
        {field('insurer', 'Assureur', { hint: 'obligatoire pour la décennale' })}
        {field('insurancePolicy', 'N° de contrat')}
        {field('insuranceArea', 'Zone couverte')}
        {field('defaultPaymentDelayDays', 'Délai de paiement par défaut (jours)', { type: 'number' })}
        {field('defaultQuoteValidityDays', 'Validité des devis (jours)', { type: 'number' })}
        {field('paymentDetails', 'IBAN ou coordonnées de paiement', { hint: 'facultatif' })}
        <label className="field span-all">Pénalités de retard
          <textarea className="input" rows={2} value={form.latePenaltyText} onChange={(e) => setForm({ ...form, latePenaltyText: e.target.value })} />
        </label>
        {field('units', 'Unités proposées dans les lignes', { hint: 'séparées par des virgules', span: true })}
      </section>

      <section className="card form-grid" aria-labelledby="h-num" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <h2 id="h-num" className="card-title span-all">Numérotation</h2>
        {numbering.data?.series.map((s) => {
          const key = s.series === 'D' ? 'prefixQuote' : s.series === 'F' ? 'prefixInvoice' : 'prefixCredit';
          const title = s.series === 'D' ? 'Devis' : s.series === 'F' ? 'Factures' : 'Avoirs';
          return (
            <div key={s.series} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{s.next}</span>
              <span className="field-hint" style={{ fontSize: 13 }}>prochain numéro{s.series === 'F' ? ' (acomptes et soldes)' : ''}</span>
              {field(key, 'Préfixe')}
              {s.startEditable && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <label className="field" style={{ flex: 1 }}>Reprendre à partir du n°
                    <input className="input" type="number" min={1} value={starts[s.series] ?? ''} onChange={(e) => setStarts({ ...starts, [s.series]: e.target.value })} />
                  </label>
                  <button type="button" className="btn btn-secondary" disabled={!starts[s.series]}
                    onClick={() => window.confirm('Ce numéro de départ ne pourra plus être modifié. Confirmer ?') && setStart.mutate({ series: s.series, startNumber: Number(starts[s.series]) })}>
                    Fixer
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {setStart.error && <p className="field-error span-all">{setStart.error.message}</p>}
      </section>

      {save.error && issues.length === 0 && <p className="notice notice-error" role="alert">{save.error.message}</p>}
      {save.isSuccess && mode === 'settings' && <p className="notice" role="status">Profil enregistré.</p>}
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        {mode === 'settings' && <Link className="btn btn-secondary" to="/profil/modele">Changer de modèle</Link>}
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>Enregistrer</button>
      </div>
    </form>
  );
  return mode === 'onboarding' ? <OnboardingLayout step={2}>{content}</OnboardingLayout> : content;
}
```

Ajouter dans `base.css` : `.logo-slot { width: 76px; height: 76px; border-radius: 16px; border: 1.5px dashed var(--c-placeholder); background: var(--c-bg); display: flex; align-items: center; justify-content: center; color: var(--c-text-muted); font-size: 12px; font-weight: 700; overflow: hidden; } .logo-slot img { max-width: 100%; max-height: 100%; }`

- [ ] **Étape 6 : brancher les routes**

Dans `src/web/App.tsx`, sous `<RequireAuth>` : hors coquille, `<Route path="/bienvenue/modele" element={<TemplatePickerPage mode="onboarding" />} />` et `<Route path="/bienvenue/entreprise" element={<ProfilePage mode="onboarding" />} />` ; dans la coquille, `<Route path="profil" element={<ProfilePage mode="settings" />} />` et `<Route path="profil/modele" element={<TemplatePickerPage mode="settings" />} />`.

- [ ] **Étape 7 : relancer les tests, puis vérifier à la main**

Run: `npm test && npm run typecheck`
Expected: PASS.

`npm run dev` avec un compte sans profil : `/` → choix du modèle → profil → tableau de bord. Importer un logo de plusieurs Mo : il est réduit et enregistré. Comparer à `Modele.dc.html` et `Profil.dc.html`.

- [ ] **Étape 8 : commit**

```bash
git add -A
git commit -m "feat: premier démarrage (modèle puis entreprise), page Profil et changement de modèle"
```

**Critère de fin :** un nouvel utilisateur passe forcément par le choix du modèle puis par un profil complet ; le profil et le modèle restent modifiables ; le logo est réduit dans le navigateur.

---

### Tâche 10 : carnet de clients (API et interface)

**Fichiers :**
- Créer : `src/shared/client.ts`, `src/worker/db/clients.ts`, `src/worker/routes/clients.ts`, `src/web/components/Dialog.tsx`, `src/web/components/ClientFormDialog.tsx`, `src/web/pages/ClientsPage.tsx`
- Modifier : `src/worker/app.ts`, `src/web/App.tsx`, `test/worker/fixtures.ts`, `src/web/styles/base.css`
- Tests : `test/worker/clients.test.ts`, `test/worker/isolation.test.ts`, `src/web/components/ClientFormDialog.test.tsx`

**Interfaces :**
- Produit (`shared/client.ts`) : `ClientInput` (Zod), `type ClientInput`, `type ClientData = ClientInput & { id: string }`, `CLIENT_TYPE_LABEL`.
- Produit (`db/clients.ts`) : `getClient(db, userId, id): Promise<ClientData | null>` ; `requireClient(db, userId, id): Promise<ClientData>` (404 « Client introuvable. ») ; `listClients(db, userId)`.
- Produit (API) : `GET /api/clients → { items: ClientData[] }` ; `POST /api/clients → 201 ClientData` ; `GET|PUT /api/clients/:id → ClientData` ; `DELETE /api/clients/:id → 204` (409 `client_in_use` si référencé).
- Produit (front) : `<Dialog open title onClose>` ; `<ClientFormDialog open initial? onClose onSaved(client)>`.
- Produit (`fixtures.ts`) : `CLIENT_BUSINESS`, `CLIENT_INDIVIDUAL`, `seedClient(app, user, overrides?): Promise<ClientData>`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à `test/worker/fixtures.ts` :

```ts
import type { ClientData } from '../../src/shared/client';
import { json } from './helpers';

export const CLIENT_BUSINESS = {
  type: 'business' as const, name: 'SCI Les Tilleuls', street: '3 place Royale', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '801 222 333', email: 'gestion@tilleuls.example', phone: '',
};
export const CLIENT_INDIVIDUAL = {
  type: 'individual' as const, name: 'M. et Mme Lefèvre', street: '5 rue Kervégan', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '', email: '', phone: '06 00 00 00 00',
};

export async function seedClient(app: App, user: SessionUser, overrides: Partial<typeof CLIENT_BUSINESS> = {}): Promise<ClientData> {
  const res = await call(app, user, 'POST', '/api/clients', { ...CLIENT_BUSINESS, ...overrides });
  if (res.status !== 201) throw new Error(`client: ${res.status} ${await res.text()}`);
  return json<ClientData>(res);
}
```

`test/worker/clients.test.ts` :

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, CLIENT_INDIVIDUAL, seedClient } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

describe('clients', () => {
  it('crée, liste par nom, lit, modifie et supprime', async () => {
    const u = await createAllowedUser('karim@example.test');
    const tilleuls = await seedClient(app, u);
    expect(tilleuls).toMatchObject({ name: 'SCI Les Tilleuls', siren: '801222333', type: 'business' });
    await seedClient(app, u, { ...CLIENT_INDIVIDUAL });
    expect((await json(await call(app, u, 'GET', '/api/clients'))).items.map((c: { name: string }) => c.name)).toEqual(['M. et Mme Lefèvre', 'SCI Les Tilleuls']);
    const updated = await json(await call(app, u, 'PUT', `/api/clients/${tilleuls.id}`, { ...CLIENT_BUSINESS, city: 'Rezé' }));
    expect(updated.city).toBe('Rezé');
    expect((await call(app, u, 'DELETE', `/api/clients/${tilleuls.id}`)).status).toBe(204);
    expect((await call(app, u, 'GET', `/api/clients/${tilleuls.id}`)).status).toBe(404);
  });

  it('valide le nom et le SIREN', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect((await call(app, u, 'POST', '/api/clients', { ...CLIENT_BUSINESS, name: ' ' })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/clients', { ...CLIENT_BUSINESS, siren: '1234' })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/clients', { ...CLIENT_BUSINESS, siren: '801 222 333 00015' })).status).toBe(201);
  });

  it('refuse de supprimer un client utilisé par un document', async () => {
    const u = await createAllowedUser('karim@example.test');
    const c = await seedClient(app, u);
    await env.DB.prepare("INSERT INTO quotes (id, user_id, client_id, validity_days, created_at, updated_at) VALUES ('q1', ?, ?, 30, '', '')").bind(u.id, c.id).run();
    const res = await call(app, u, 'DELETE', `/api/clients/${c.id}`);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'client_in_use' });
  });
});
```

`test/worker/isolation.test.ts` (complété par les tâches 11, 15, 18, 19, 20 et 23) :

```ts
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, seedClient, twoUsers } from './fixtures';
import { call, json, testApp } from './helpers';

const app = testApp();

describe('cloisonnement par utilisateur', () => {
  it('rend les clients d’un autre utilisateur invisibles et intouchables', async () => {
    const { a, b } = await twoUsers(app);
    const c = await seedClient(app, a);
    expect((await call(app, b, 'GET', `/api/clients/${c.id}`)).status).toBe(404);
    expect((await call(app, b, 'PUT', `/api/clients/${c.id}`, CLIENT_BUSINESS)).status).toBe(404);
    expect((await call(app, b, 'DELETE', `/api/clients/${c.id}`)).status).toBe(404);
    expect((await json(await call(app, b, 'GET', '/api/clients'))).items).toEqual([]);
    expect((await call(app, a, 'GET', `/api/clients/${c.id}`)).status).toBe(200);
  });
});
```

`src/web/components/ClientFormDialog.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientFormDialog } from './ClientFormDialog';

afterEach(() => vi.unstubAllGlobals());

function setup(onSaved = vi.fn()) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><ClientFormDialog open onClose={() => {}} onSaved={onSaved} /></QueryClientProvider>);
  return onSaved;
}

it('ne demande le SIREN que pour un professionnel', async () => {
  setup();
  expect(screen.queryByLabelText('SIREN ou SIRET')).toBeNull();
  await userEvent.click(screen.getByLabelText('Professionnel'));
  expect(screen.getByLabelText('SIREN ou SIRET')).toBeInTheDocument();
});

it('crée le client et le renvoie', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'c1', type: 'individual', name: 'Mme Garnier' }, { status: 201 })));
  const onSaved = setup();
  await userEvent.type(screen.getByLabelText('Nom ou raison sociale'), 'Mme Garnier');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le client' }));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:worker -- clients isolation && npm run test:unit -- ClientFormDialog`
Expected: FAIL.

- [ ] **Étape 3 : écrire le schéma, l'accès aux données et les routes**

`src/shared/client.ts` :

```ts
import { z } from 'zod';

export const ClientInput = z.object({
  type: z.enum(['individual', 'business']),
  name: z.string().trim().min(1, 'Nom obligatoire').max(200),
  street: z.string().trim().max(200),
  postalCode: z.string().trim().max(10),
  city: z.string().trim().max(100),
  country: z.string().trim().length(2),
  siren: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^(\d{9}|\d{14})?$/, 'SIREN (9 chiffres) ou SIRET (14 chiffres)')),
  email: z.union([z.literal(''), z.email('Adresse e-mail invalide')]),
  phone: z.string().trim().max(30),
});

export type ClientInput = z.infer<typeof ClientInput>;
export type ClientData = ClientInput & { id: string };

export const CLIENT_TYPE_LABEL: Record<ClientInput['type'], string> = { individual: 'particulier', business: 'professionnel' };
```

`src/worker/db/clients.ts` :

```ts
import type { ClientData, ClientInput } from '../../shared/client';
import { notFound } from '../errors';

type Row = { id: string; type: ClientInput['type']; name: string; street: string; postal_code: string; city: string; country: string; siren: string; email: string; phone: string };

const COLS = 'id, type, name, street, postal_code, city, country, siren, email, phone';

const toClient = (r: Row): ClientData => ({
  id: r.id, type: r.type, name: r.name, street: r.street, postalCode: r.postal_code, city: r.city,
  country: r.country, siren: r.siren, email: r.email, phone: r.phone,
});

export async function getClient(db: D1Database, userId: string, id: string): Promise<ClientData | null> {
  const r = await db.prepare(`SELECT ${COLS} FROM clients WHERE id = ? AND user_id = ?`).bind(id, userId).first<Row>();
  return r ? toClient(r) : null;
}

export async function requireClient(db: D1Database, userId: string, id: string): Promise<ClientData> {
  const c = await getClient(db, userId, id);
  if (!c) throw notFound('Client introuvable.');
  return c;
}

export async function listClients(db: D1Database, userId: string): Promise<ClientData[]> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM clients WHERE user_id = ? ORDER BY name COLLATE NOCASE`).bind(userId).all<Row>();
  return results.map(toClient);
}

export async function insertClient(db: D1Database, userId: string, input: ClientInput, nowIso: string): Promise<ClientData> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO clients (id, user_id, type, name, street, postal_code, city, country, siren, email, phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, input.type, input.name, input.street, input.postalCode, input.city, input.country, input.siren, input.email, input.phone, nowIso, nowIso).run();
  return { id, ...input };
}

export async function updateClient(db: D1Database, userId: string, id: string, input: ClientInput, nowIso: string): Promise<ClientData> {
  const res = await db.prepare(
    `UPDATE clients SET type = ?, name = ?, street = ?, postal_code = ?, city = ?, country = ?, siren = ?, email = ?, phone = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(input.type, input.name, input.street, input.postalCode, input.city, input.country, input.siren, input.email, input.phone, nowIso, id, userId).run();
  if (res.meta.changes === 0) throw notFound('Client introuvable.');
  return { id, ...input };
}
```

`src/worker/routes/clients.ts` :

```ts
import { Hono } from 'hono';
import { ClientInput } from '../../shared/client';
import { insertClient, listClients, requireClient, updateClient } from '../db/clients';
import { HttpError, notFound, validate } from '../errors';
import type { AppEnv } from '../types';

export const clientRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await listClients(c.env.DB, c.var.user.id) }))
  .post('/', validate('json', ClientInput), async (c) =>
    c.json(await insertClient(c.env.DB, c.var.user.id, c.req.valid('json'), c.var.deps.now().toISOString()), 201))
  .get('/:id', async (c) => c.json(await requireClient(c.env.DB, c.var.user.id, c.req.param('id'))))
  .put('/:id', validate('json', ClientInput), async (c) =>
    c.json(await updateClient(c.env.DB, c.var.user.id, c.req.param('id'), c.req.valid('json'), c.var.deps.now().toISOString())))
  .delete('/:id', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const id = c.req.param('id');
    await requireClient(DB, userId, id);
    const used = await DB.prepare(
      'SELECT EXISTS (SELECT 1 FROM quotes WHERE client_id = ?1 AND user_id = ?2) OR EXISTS (SELECT 1 FROM invoices WHERE client_id = ?1 AND user_id = ?2) AS used',
    ).bind(id, userId).first<{ used: number }>();
    if (used?.used) throw new HttpError(409, 'client_in_use', 'Ce client figure sur des devis ou des factures : il ne peut pas être supprimé.');
    const res = await DB.prepare('DELETE FROM clients WHERE id = ? AND user_id = ?').bind(id, userId).run();
    if (res.meta.changes === 0) throw notFound('Client introuvable.');
    return c.body(null, 204);
  });
```

Brancher : `api.route('/clients', clientRoutes);`

- [ ] **Étape 4 : écrire la boîte de dialogue et le formulaire client**

`src/web/components/Dialog.tsx` (fenêtre modale simple, compatible jsdom) :

```tsx
import { useEffect, type ReactNode } from 'react';

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="dialog">
        <div className="dialog-head">
          <h2 className="card-title">{title}</h2>
          <button type="button" className="dialog-close" aria-label="Fermer" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

Ajouter dans `base.css` :

```css
.dialog-backdrop { position: fixed; inset: 0; background: rgba(20, 22, 31, 0.35); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 10; }
.dialog { background: var(--c-surface); border-radius: var(--radius-xl); padding: 24px; width: min(640px, 100%); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
.dialog-head { display: flex; justify-content: space-between; align-items: center; }
.dialog-close { border: none; background: none; font-size: 24px; cursor: pointer; color: var(--c-text-muted); }
```

`src/web/components/ClientFormDialog.tsx` :

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClientData, ClientInput } from '../../shared/client';
import { ApiError, api } from '../api';
import { Dialog } from './Dialog';

const EMPTY: ClientInput = { type: 'individual', name: '', street: '', postalCode: '', city: '', country: 'FR', siren: '', email: '', phone: '' };

export function ClientFormDialog({ open, initial, onClose, onSaved }: { open: boolean; initial?: ClientData; onClose: () => void; onSaved: (c: ClientData) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ClientInput>(initial ?? EMPTY);
  useEffect(() => { if (open) setForm(initial ?? EMPTY); }, [open, initial]);
  const save = useMutation({
    mutationFn: () => (initial ? api<ClientData>('PUT', `/api/clients/${initial.id}`, form) : api<ClientData>('POST', '/api/clients', form)),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['clients'] }); onSaved(c); },
  });
  const issues = save.error instanceof ApiError && Array.isArray(save.error.issues) ? (save.error.issues as { path: string[]; message: string }[]) : [];
  const err = (k: string) => issues.find((i) => i.path[0] === k)?.message;
  const input = (k: keyof ClientInput, label: string, span = false) => (
    <label className={span ? 'field span-all' : 'field'}>{label}
      <input className="input" aria-label={label} aria-invalid={err(k) ? true : undefined} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      {err(k) && <span className="field-error">{err(k)}</span>}
    </label>
  );
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Dialog open={open} title={initial ? 'Modifier le client' : 'Nouveau client'} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <fieldset className="span-all" style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 16 }}>
          <legend className="field" style={{ marginBottom: 6 }}>Type de client</legend>
          <label><input type="radio" name="type" checked={form.type === 'individual'} onChange={() => setForm({ ...form, type: 'individual', siren: '' })} /> Particulier</label>
          <label><input type="radio" name="type" checked={form.type === 'business'} onChange={() => setForm({ ...form, type: 'business' })} /> Professionnel</label>
        </fieldset>
        {input('name', 'Nom ou raison sociale', true)}
        {input('street', 'Adresse de facturation', true)}
        {input('postalCode', 'Code postal')}
        {input('city', 'Ville')}
        {form.type === 'business' && input('siren', 'SIREN ou SIRET')}
        {input('email', 'E-mail')}
        {input('phone', 'Téléphone')}
        {save.error && issues.length === 0 && <p className="field-error span-all" role="alert">{save.error.message}</p>}
        <div className="actions span-all" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>Enregistrer le client</button>
        </div>
      </form>
    </Dialog>
  );
}
```

- [ ] **Étape 5 : écrire la page Clients**

`src/web/pages/ClientsPage.tsx` : titre « Clients », bouton « Nouveau client », tableau (Nom, Type, Ville, SIREN, actions « Modifier » / « Supprimer »). Un refus `client_in_use` s'affiche dans un `.notice-error`.

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CLIENT_TYPE_LABEL, type ClientData } from '../../shared/client';
import { api } from '../api';
import { ClientFormDialog } from '../components/ClientFormDialog';

export function ClientsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['clients'], queryFn: () => api<{ items: ClientData[] }>('GET', '/api/clients') });
  const [editing, setEditing] = useState<ClientData | undefined>();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/api/clients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Clients</h1>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(undefined); setOpen(true); }}>Nouveau client</button>
      </div>
      {remove.error && <p className="notice notice-error" role="alert">{remove.error.message}</p>}
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Nom</th><th scope="col">Type</th><th scope="col">Ville</th><th scope="col">SIREN</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--c-text-muted)' }}>Aucun client pour l’instant.</td></tr>}
            {list.data?.items.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{CLIENT_TYPE_LABEL[c.type]}</td>
                <td>{c.city}</td>
                <td>{c.siren || '—'}</td>
                <td className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" style={{ height: 36 }} onClick={() => { setEditing(c); setOpen(true); }}>Modifier</button>
                  <button type="button" className="btn btn-danger" onClick={() => window.confirm(`Supprimer ${c.name} ?`) && remove.mutate(c.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ClientFormDialog open={open} initial={editing} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />
    </div>
  );
}
```

Route : `<Route path="clients" element={<ClientsPage />} />`.

- [ ] **Étape 6 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat: carnet de clients et premier test de cloisonnement"
```

**Critère de fin :** fiches clients complètes (particulier / professionnel) ; un client référencé ne peut pas être supprimé ; un autre utilisateur reçoit 404 sur toutes les opérations.

---

### Tâche 11 : lignes types (API et interface)

**Fichiers :**
- Créer : `src/shared/preset.ts`, `src/worker/db/presets.ts`, `src/worker/routes/presets.ts`, `src/web/pages/LinePresetsPage.tsx`
- Modifier : `src/worker/app.ts`, `src/web/App.tsx`, `test/worker/isolation.test.ts`
- Tests : `test/worker/presets.test.ts`

**Interfaces :**
- Consomme : `parseEuros`, `formatEuros`, `formatCentsForInput` (tâche 3) ; `useProfile` (tâche 9).
- Produit (`shared/preset.ts`) : `PresetInput` (Zod : `designation`, `unit`, `unitPriceCents`, `vatRate: null`), `type PresetData = PresetInput & { id: string }`.
- Produit (API) : `GET /api/presets → { items: PresetData[] }` ; `POST /api/presets → 201 PresetData` ; `PUT /api/presets/:id → PresetData` ; `DELETE /api/presets/:id → 204`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`test/worker/presets.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const PRESET = { designation: 'Création de prise de courant 16 A', unit: 'u', unitPriceCents: 6500, vatRate: null };

describe('lignes types', () => {
  it('crée, liste, modifie et supprime', async () => {
    const u = await createAllowedUser('karim@example.test');
    const p = await json(await call(app, u, 'POST', '/api/presets', PRESET));
    expect(p).toMatchObject(PRESET);
    expect((await json(await call(app, u, 'GET', '/api/presets'))).items).toHaveLength(1);
    expect(await json(await call(app, u, 'PUT', `/api/presets/${p.id}`, { ...PRESET, unitPriceCents: 7000 }))).toMatchObject({ unitPriceCents: 7000 });
    expect((await call(app, u, 'DELETE', `/api/presets/${p.id}`)).status).toBe(204);
  });

  it('refuse une désignation vide, un prix décimal et un taux de TVA en V1', async () => {
    const u = await createAllowedUser('karim@example.test');
    expect((await call(app, u, 'POST', '/api/presets', { ...PRESET, designation: '' })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/presets', { ...PRESET, unitPriceCents: 65.5 })).status).toBe(400);
    expect((await call(app, u, 'POST', '/api/presets', { ...PRESET, vatRate: 20 })).status).toBe(400);
  });
});
```

Ajouter à `test/worker/isolation.test.ts` :

```ts
it('rend les lignes types d’un autre utilisateur invisibles et intouchables', async () => {
  const { a, b } = await twoUsers(app);
  const p = await json(await call(app, a, 'POST', '/api/presets', { designation: 'Forfait', unit: 'forfait', unitPriceCents: 100, vatRate: null }));
  expect((await call(app, b, 'PUT', `/api/presets/${p.id}`, { designation: 'X', unit: 'u', unitPriceCents: 1, vatRate: null })).status).toBe(404);
  expect((await call(app, b, 'DELETE', `/api/presets/${p.id}`)).status).toBe(404);
  expect((await json(await call(app, b, 'GET', '/api/presets'))).items).toEqual([]);
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:worker -- presets isolation`
Expected: FAIL.

- [ ] **Étape 3 : écrire le schéma, l'accès aux données et les routes**

`src/shared/preset.ts` :

```ts
import { z } from 'zod';

export const PresetInput = z.object({
  designation: z.string().trim().min(1, 'Désignation obligatoire').max(500),
  unit: z.string().trim().min(1).max(20),
  unitPriceCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  vatRate: z.null(), // V1 : franchise de TVA
});

export type PresetInput = z.infer<typeof PresetInput>;
export type PresetData = PresetInput & { id: string };
```

`src/worker/db/presets.ts` :

```ts
import type { PresetData, PresetInput } from '../../shared/preset';
import { notFound } from '../errors';

type Row = { id: string; designation: string; unit: string; unit_price_cents: number };
const toPreset = (r: Row): PresetData => ({ id: r.id, designation: r.designation, unit: r.unit, unitPriceCents: r.unit_price_cents, vatRate: null });

export async function listPresets(db: D1Database, userId: string): Promise<PresetData[]> {
  const { results } = await db.prepare('SELECT id, designation, unit, unit_price_cents FROM line_presets WHERE user_id = ? ORDER BY designation COLLATE NOCASE').bind(userId).all<Row>();
  return results.map(toPreset);
}

export async function insertPreset(db: D1Database, userId: string, input: PresetInput, nowIso: string): Promise<PresetData> {
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO line_presets (id, user_id, designation, unit, unit_price_cents, vat_rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
    .bind(id, userId, input.designation, input.unit, input.unitPriceCents, nowIso, nowIso).run();
  return { id, ...input };
}

export async function updatePreset(db: D1Database, userId: string, id: string, input: PresetInput, nowIso: string): Promise<PresetData> {
  const res = await db.prepare('UPDATE line_presets SET designation = ?, unit = ?, unit_price_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(input.designation, input.unit, input.unitPriceCents, nowIso, id, userId).run();
  if (res.meta.changes === 0) throw notFound('Ligne type introuvable.');
  return { id, ...input };
}

export async function deletePreset(db: D1Database, userId: string, id: string): Promise<void> {
  const res = await db.prepare('DELETE FROM line_presets WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (res.meta.changes === 0) throw notFound('Ligne type introuvable.');
}
```

`src/worker/routes/presets.ts` :

```ts
import { Hono } from 'hono';
import { PresetInput } from '../../shared/preset';
import { deletePreset, insertPreset, listPresets, updatePreset } from '../db/presets';
import { validate } from '../errors';
import type { AppEnv } from '../types';

export const presetRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ items: await listPresets(c.env.DB, c.var.user.id) }))
  .post('/', validate('json', PresetInput), async (c) =>
    c.json(await insertPreset(c.env.DB, c.var.user.id, c.req.valid('json'), c.var.deps.now().toISOString()), 201))
  .put('/:id', validate('json', PresetInput), async (c) =>
    c.json(await updatePreset(c.env.DB, c.var.user.id, c.req.param('id'), c.req.valid('json'), c.var.deps.now().toISOString())))
  .delete('/:id', async (c) => {
    await deletePreset(c.env.DB, c.var.user.id, c.req.param('id'));
    return c.body(null, 204);
  });
```

Brancher : `api.route('/presets', presetRoutes);`

- [ ] **Étape 4 : écrire la page Lignes types**

`src/web/pages/LinePresetsPage.tsx` : titre « Lignes types », phrase « Enregistrez ici les prestations que vous facturez souvent ; insérez-les ensuite dans un devis en un clic. », formulaire en ligne (Désignation, Unité en liste issue de `profile.units`, P.U. HT saisi en texte et lu par `parseEuros`, bouton « Ajouter » ou « Enregistrer » en modification), tableau (Désignation, Unité, P.U. HT `formatEuros`, Modifier / Supprimer).

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { formatCentsForInput, formatEuros, parseEuros } from '../../shared/money';
import type { PresetData } from '../../shared/preset';
import { DEFAULT_UNITS } from '../../shared/profile';
import { api } from '../api';
import { useProfile } from '../profile/useProfile';

export function LinePresetsPage() {
  const qc = useQueryClient();
  const units = useProfile().data?.profile?.units ?? DEFAULT_UNITS;
  const list = useQuery({ queryKey: ['presets'], queryFn: () => api<{ items: PresetData[] }>('GET', '/api/presets') });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [designation, setDesignation] = useState('');
  const [unit, setUnit] = useState(units[0] ?? 'u');
  const [price, setPrice] = useState('');
  const cents = parseEuros(price === '' ? '0' : price);
  const reset = () => { setEditingId(null); setDesignation(''); setPrice(''); };
  const save = useMutation({
    mutationFn: () => {
      const body = { designation, unit, unitPriceCents: cents!, vatRate: null };
      return editingId ? api('PUT', `/api/presets/${editingId}`, body) : api('POST', '/api/presets', body);
    },
    onSuccess: () => { reset(); qc.invalidateQueries({ queryKey: ['presets'] }); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api('DELETE', `/api/presets/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }) });
  const submit = (e: FormEvent) => { e.preventDefault(); if (cents !== null) save.mutate(); };

  return (
    <div className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="page-title">Lignes types</h1>
        <p className="page-intro">Enregistrez ici les prestations que vous facturez souvent ; insérez-les ensuite dans un devis en un clic.</p>
      </div>
      <form className="card" onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '3 1 280px' }}>Désignation<input className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} /></label>
        <label className="field" style={{ flex: '1 1 110px' }}>Unité
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        </label>
        <label className="field" style={{ flex: '1 1 130px' }}>P.U. HT<input className="input" inputMode="decimal" aria-invalid={cents === null ? true : undefined} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={cents === null || designation.trim() === ''}>{editingId ? 'Enregistrer' : 'Ajouter'}</button>
        {editingId && <button type="button" className="btn btn-secondary" onClick={reset}>Annuler</button>}
        {cents === null && <span className="field-error" style={{ flexBasis: '100%' }}>Prix invalide : 2 décimales au maximum (ex. 1 234,50).</span>}
      </form>
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Désignation</th><th scope="col">Unité</th><th scope="col" className="num">P.U. HT</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {list.data?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.designation}</td><td>{p.unit}</td><td className="num">{formatEuros(p.unitPriceCents)}</td>
                <td className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" style={{ height: 36 }} onClick={() => { setEditingId(p.id); setDesignation(p.designation); setUnit(p.unit); setPrice(formatCentsForInput(p.unitPriceCents)); }}>Modifier</button>
                  <button type="button" className="btn btn-danger" onClick={() => remove.mutate(p.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Route : `<Route path="lignes-types" element={<LinePresetsPage />} />`.

- [ ] **Étape 5 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 6 : commit**

```bash
git add -A
git commit -m "feat: bibliothèque de lignes types"
```

**Critère de fin :** l'utilisateur gère sa bibliothèque de lignes types ; prix saisis au format français ; cloisonnement vérifié.

---

# Phase 3 : devis

### Tâche 12 : calculs purs (lignes, totaux, acomptes, solde)

**Fichiers :**
- Créer : `src/shared/lines.ts`, `src/shared/deposits.ts`, `src/shared/balance.ts`
- Tests : `src/shared/lines.test.ts`, `src/shared/deposits.test.ts`, `src/shared/balance.test.ts`

**Interfaces :**
- Produit (`lines.ts`) : `type Line = { id: string; designation: string; quantityMilli: number; unit: string; unitPriceCents: number; vatRate: null }` ; `lineTotalCents(l: Pick<Line, 'quantityMilli' | 'unitPriceCents'>): number` ; `LineSchema`, `LinesSchema` (Zod, 200 lignes au plus) ; `isBlankLine(l): boolean` ; `filledLines(lines): Line[]` ; `blankLine(unit?): Line` ; `blankLines(n, unit?): Line[]` ; `lineProblems(lines): { filledCount: number; missingDesignation: number[] }` (positions à partir de 1) ; `type Totals = { totalHtCents: number; vatCents: number; totalDueCents: number }` ; `computeTotals(lines): Totals`.
- Produit (`deposits.ts`) : `type DepositInput = { mode: 'percent'; basisPoints: number } | { mode: 'amount'; cents: number }` ; `DepositInputSchema` ; `depositAmountCents(quoteTotalCents: number, input: DepositInput): number` ; `checkDeposit(quoteTotalCents: number, existingCents: number[], newCents: number): { ok: true; remainingAfterCents: number } | { ok: false; reason: 'non_positive' | 'exceeds_quote_total'; remainingCents: number }`.
- Produit (`balance.ts`) : `type DeductedDeposit = { invoiceId: string; number: string; issueDate: string; amountCents: number }` ; `computeBalance(totalHtCents: number, deposits: { amountCents: number }[]): { totalHtCents: number; depositsTotalCents: number; remainingCents: number }`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/shared/lines.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { LineSchema, blankLines, computeTotals, filledLines, isBlankLine, lineProblems, lineTotalCents, type Line } from './lines';

const line = (q: number, p: number, designation = 'Prestation'): Line => ({ id: crypto.randomUUID(), designation, quantityMilli: q, unit: 'u', unitPriceCents: p, vatRate: null });

// Lignes de la maquette Devis : 380 + 1 150 + 8 × 65 + 6 × 95 + 300 = 2 920 €
const MOCKUP = [line(1000, 38000), line(1000, 115000), line(8000, 6500), line(6000, 9500), line(1000, 30000)];

describe('lineTotalCents', () => {
  it('multiplie quantité et prix unitaire', () => {
    expect(lineTotalCents({ quantityMilli: 1000, unitPriceCents: 38000 })).toBe(38000);
    expect(lineTotalCents({ quantityMilli: 2500, unitPriceCents: 4500 })).toBe(11250);
    expect(lineTotalCents({ quantityMilli: 8000, unitPriceCents: 6500 })).toBe(52000);
  });

  it('arrondit au centime le plus proche, le demi-centime s’éloignant de zéro', () => {
    expect(lineTotalCents({ quantityMilli: 125, unitPriceCents: 100 })).toBe(13);   // 12,5 c → 13 c
    expect(lineTotalCents({ quantityMilli: 124, unitPriceCents: 100 })).toBe(12);   // 12,4 c → 12 c
    expect(lineTotalCents({ quantityMilli: 125, unitPriceCents: -100 })).toBe(-13); // remise
    expect(lineTotalCents({ quantityMilli: 333, unitPriceCents: 1000 })).toBe(333);
  });

  it('reste exact sur de grands nombres', () => {
    expect(lineTotalCents({ quantityMilli: 1_000_000_000, unitPriceCents: 99_999 })).toBe(99_999_000_000);
  });
});

describe('computeTotals', () => {
  it('donne 2 920,00 € pour le devis de la maquette, TVA nulle, total à payer = total HT', () => {
    expect(computeTotals(MOCKUP)).toEqual({ totalHtCents: 292000, vatCents: 0, totalDueCents: 292000 });
  });

  it('additionne les totaux de ligne déjà arrondis (ce qui est imprimé)', () => {
    const lines = [line(333, 100), line(333, 100), line(333, 100)]; // 0,333 × 1,00 € = 0,33 € chacune
    expect(computeTotals(lines).totalHtCents).toBe(99);
  });

  it('ignore les lignes vides (vigilance n° 2)', () => {
    expect(computeTotals([...MOCKUP, ...blankLines(3)]).totalHtCents).toBe(292000);
    expect(computeTotals(blankLines(5))).toEqual({ totalHtCents: 0, vatCents: 0, totalDueCents: 0 });
  });

  it('accepte une ligne de remise négative', () => {
    expect(computeTotals([line(1000, 10000), line(1000, -1500, 'Remise fidélité')]).totalHtCents).toBe(8500);
  });
});

describe('lignes vides et problèmes de saisie (vigilance n° 2)', () => {
  it('reconnaît une ligne vide : ni désignation ni prix', () => {
    expect(isBlankLine(blankLines(1)[0]!)).toBe(true);
    expect(isBlankLine({ ...blankLines(1)[0]!, designation: '  ' })).toBe(true);
    expect(isBlankLine(line(1000, 0, 'Déplacement offert'))).toBe(false);
    expect(isBlankLine(line(1000, 500, ''))).toBe(false);
  });

  it('crée 5 lignes vides distinctes, quantité 1', () => {
    const lines = blankLines(5, 'forfait');
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((l) => l.id)).size).toBe(5);
    expect(lines[0]).toMatchObject({ designation: '', quantityMilli: 1000, unit: 'forfait', unitPriceCents: 0, vatRate: null });
  });

  it('compte les lignes remplies et signale une ligne chiffrée sans désignation', () => {
    const lines = [line(1000, 38000), blankLines(1)[0]!, line(1000, 500, '')];
    expect(filledLines(lines)).toHaveLength(2);
    expect(lineProblems(lines)).toEqual({ filledCount: 2, missingDesignation: [3] });
    expect(lineProblems(blankLines(5))).toEqual({ filledCount: 0, missingDesignation: [] });
  });
});

describe('LineSchema', () => {
  it('refuse un taux de TVA en V1, une quantité négative, un prix décimal', () => {
    const ok = line(1000, 100);
    expect(LineSchema.safeParse(ok).success).toBe(true);
    expect(LineSchema.safeParse({ ...ok, vatRate: 20 }).success).toBe(false);
    expect(LineSchema.safeParse({ ...ok, quantityMilli: -1 }).success).toBe(false);
    expect(LineSchema.safeParse({ ...ok, unitPriceCents: 10.5 }).success).toBe(false);
  });
});
```

`src/shared/deposits.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { checkDeposit, depositAmountCents } from './deposits';

describe('depositAmountCents', () => {
  it('calcule un pourcentage du total à payer', () => {
    expect(depositAmountCents(400000, { mode: 'percent', basisPoints: 3000 })).toBe(120000); // 30 % de 4 000 €
    expect(depositAmountCents(400000, { mode: 'percent', basisPoints: 2000 })).toBe(80000);
  });

  it('arrondit toujours au centime inférieur', () => {
    expect(depositAmountCents(100001, { mode: 'percent', basisPoints: 3300 })).toBe(33000);  // 330,0033 € → 330,00 €
    expect(depositAmountCents(10000, { mode: 'percent', basisPoints: 3333 })).toBe(3333);    // 33,33 €
    expect(depositAmountCents(99999, { mode: 'percent', basisPoints: 5000 })).toBe(49999);   // 499,995 € → 499,99 €
    expect(depositAmountCents(292000, { mode: 'percent', basisPoints: 1250 })).toBe(36500);  // 12,5 %
  });

  it('reprend tel quel un montant fixe', () => {
    expect(depositAmountCents(400000, { mode: 'amount', cents: 50000 })).toBe(50000);
  });
});

describe('checkDeposit', () => {
  it('accepte tant que la somme des acomptes ne dépasse pas le total du devis', () => {
    expect(checkDeposit(400000, [120000], 280000)).toEqual({ ok: true, remainingAfterCents: 0 });
    expect(checkDeposit(400000, [120000], 80000)).toEqual({ ok: true, remainingAfterCents: 200000 });
  });

  it('refuse un dépassement et indique ce qui reste facturable', () => {
    expect(checkDeposit(400000, [120000, 200000], 80001)).toEqual({ ok: false, reason: 'exceeds_quote_total', remainingCents: 80000 });
  });

  it('refuse un acompte nul ou négatif', () => {
    expect(checkDeposit(400000, [], 0)).toEqual({ ok: false, reason: 'non_positive', remainingCents: 400000 });
  });
});
```

`src/shared/balance.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { depositAmountCents } from './deposits';
import { computeBalance } from './balance';

describe('computeBalance', () => {
  it('déduit les acomptes du total', () => {
    expect(computeBalance(400000, [{ amountCents: 120000 }])).toEqual({ totalHtCents: 400000, depositsTotalCents: 120000, remainingCents: 280000 });
  });

  it('donne le total entier sans acompte (facture directe)', () => {
    expect(computeBalance(292000, [])).toEqual({ totalHtCents: 292000, depositsTotalCents: 0, remainingCents: 292000 });
  });

  it('absorbe les centimes perdus par l’arrondi des acomptes', () => {
    const total = 10000; // 100,00 €
    const deposits = [1, 2, 3].map(() => ({ amountCents: depositAmountCents(total, { mode: 'percent', basisPoints: 3333 }) }));
    const b = computeBalance(total, deposits);
    expect(b.depositsTotalCents).toBe(9999);
    expect(b.remainingCents).toBe(1);
    expect(b.depositsTotalCents + b.remainingCents).toBe(total);
  });

  it('signale un reste négatif quand le total a baissé sous les acomptes', () => {
    expect(computeBalance(100000, [{ amountCents: 120000 }]).remainingCents).toBe(-20000);
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/shared`
Expected: FAIL, modules `./lines`, `./deposits`, `./balance` introuvables.

- [ ] **Étape 3 : écrire `src/shared/lines.ts`**

```ts
import { z } from 'zod';

export const MAX_LINE_ABS_CENTS = 100_000_000_000;

export type Line = {
  id: string;
  designation: string;
  quantityMilli: number;
  unit: string;
  unitPriceCents: number;
  vatRate: null; // prévu pour la TVA, toujours null en V1
};

export type Totals = { totalHtCents: number; vatCents: number; totalDueCents: number };

/** quantité (millièmes) × prix (centimes) / 1000, arrondi au plus proche, demi-centime éloigné de zéro. */
export function lineTotalCents(l: Pick<Line, 'quantityMilli' | 'unitPriceCents'>): number {
  const product = BigInt(l.quantityMilli) * BigInt(l.unitPriceCents);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = abs / 1000n + (abs % 1000n >= 500n ? 1n : 0n);
  return Number(negative ? -rounded : rounded);
}

export const LineSchema = z
  .object({
    id: z.string().min(1).max(64),
    designation: z.string().max(500),
    quantityMilli: z.number().int().min(0).max(1_000_000_000),
    unit: z.string().max(20),
    unitPriceCents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    vatRate: z.null(),
  })
  .refine((l) => Math.abs(lineTotalCents(l)) <= MAX_LINE_ABS_CENTS, 'Montant de ligne trop élevé');

export const LinesSchema = z.array(LineSchema).max(200, '200 lignes au maximum');

export function isBlankLine(l: Pick<Line, 'designation' | 'unitPriceCents'>): boolean {
  return l.designation.trim() === '' && l.unitPriceCents === 0;
}

export function filledLines(lines: Line[]): Line[] {
  return lines.filter((l) => !isBlankLine(l));
}

export function blankLine(unit = 'u'): Line {
  return { id: crypto.randomUUID(), designation: '', quantityMilli: 1000, unit, unitPriceCents: 0, vatRate: null };
}

export function blankLines(n: number, unit = 'u'): Line[] {
  return Array.from({ length: n }, () => blankLine(unit));
}

export function lineProblems(lines: Line[]): { filledCount: number; missingDesignation: number[] } {
  const missingDesignation: number[] = [];
  let filledCount = 0;
  lines.forEach((l, i) => {
    if (isBlankLine(l)) return;
    filledCount += 1;
    if (l.designation.trim() === '') missingDesignation.push(i + 1);
  });
  return { filledCount, missingDesignation };
}

export function computeTotals(lines: Line[]): Totals {
  const totalHtCents = filledLines(lines).reduce((sum, l) => sum + lineTotalCents(l), 0);
  return { totalHtCents, vatCents: 0, totalDueCents: totalHtCents }; // franchise en base : pas de TVA
}
```

- [ ] **Étape 4 : écrire `src/shared/deposits.ts` et `src/shared/balance.ts`**

```ts
// src/shared/deposits.ts
import { z } from 'zod';
import { MAX_LINE_ABS_CENTS } from './lines';

export type DepositInput = { mode: 'percent'; basisPoints: number } | { mode: 'amount'; cents: number };

export const DepositInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('percent'), basisPoints: z.number().int().min(1).max(10_000) }),
  z.object({ mode: z.literal('amount'), cents: z.number().int().min(1).max(MAX_LINE_ABS_CENTS) }),
]);

/** Acompte en pourcentage : arrondi au centime inférieur ; la facture de solde absorbe l'écart. */
export function depositAmountCents(quoteTotalCents: number, input: DepositInput): number {
  if (input.mode === 'amount') return input.cents;
  return Number((BigInt(quoteTotalCents) * BigInt(input.basisPoints)) / 10_000n);
}

export function checkDeposit(
  quoteTotalCents: number,
  existingCents: number[],
  newCents: number,
): { ok: true; remainingAfterCents: number } | { ok: false; reason: 'non_positive' | 'exceeds_quote_total'; remainingCents: number } {
  const remainingCents = quoteTotalCents - existingCents.reduce((s, c) => s + c, 0);
  if (newCents <= 0) return { ok: false, reason: 'non_positive', remainingCents };
  if (newCents > remainingCents) return { ok: false, reason: 'exceeds_quote_total', remainingCents };
  return { ok: true, remainingAfterCents: remainingCents - newCents };
}
```

```ts
// src/shared/balance.ts
export type DeductedDeposit = { invoiceId: string; number: string; issueDate: string; amountCents: number };

export function computeBalance(totalHtCents: number, deposits: { amountCents: number }[]) {
  const depositsTotalCents = deposits.reduce((s, d) => s + d.amountCents, 0);
  return { totalHtCents, depositsTotalCents, remainingCents: totalHtCents - depositsTotalCents };
}
```

- [ ] **Étape 5 : relancer les tests**

Run: `npm run test:unit -- src/shared`
Expected: PASS.

- [ ] **Étape 6 : commit**

```bash
git add src/shared
git commit -m "feat: calculs des lignes, totaux, acomptes arrondis au centime inférieur et solde"
```

**Critère de fin :** tous les cas chiffrés ci-dessus passent, dont les 2 920,00 € de la maquette, l'arrondi inférieur des acomptes et l'absorption de l'écart par le solde.

---

### Tâche 13 : moteur de numérotation atomique

**Fichiers :**
- Créer : `src/worker/numbering.ts`
- Tests : `test/worker/numbering.test.ts`

**Interfaces :**
- Consomme : `type Series`, `formatDocumentNumber` (tâche 8).
- Produit : `type IssueTarget = { table: 'quotes' | 'invoices'; docId: string; userId: string; series: Series; year: number; prefix: string; set: Record<string, string | number | null>; snapshotJson?: string; guard?: { sql: string; params: (string | number | null)[] } }` ; `issueStatements(db, t): [D1PreparedStatement, D1PreparedStatement]` ; `runIssue(db, t, opts?: { before?: D1PreparedStatement[] }): Promise<{ issued: boolean; number: string | null }>`.
- Contrat : le document doit être en `draft`, appartenir à `userId` et satisfaire `guard` (SQL évalué sur la ligne du document, aliasée `d`). Si l'une de ces conditions est fausse, **ni le compteur ni le document ne changent**. Toutes les instructions (`before`, compteur, mise à jour, relecture) partent dans un seul `db.batch`, donc dans une seule transaction.

- [ ] **Étape 1 : écrire le test qui échoue**

`test/worker/numbering.test.ts` :

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { formatDocumentNumber } from '../../src/shared/numbering';
import { runIssue, type IssueTarget } from '../../src/worker/numbering';
import { createUser } from './helpers';

const now = '2026-11-03T10:00:00.000Z';

async function draft(userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO invoices (id, user_id, kind, status, created_at, updated_at) VALUES (?, ?, 'standalone', 'draft', ?, ?)")
    .bind(id, userId, now, now).run();
  return id;
}

const target = (userId: string, docId: string, extra: Partial<IssueTarget> = {}): IssueTarget => ({
  table: 'invoices', docId, userId, series: 'F', year: 2026, prefix: 'F', set: { status: 'issued', issue_date: '2026-11-03' }, ...extra,
});

async function counter(userId: string, series = 'F', year = 2026): Promise<number | null> {
  const row = await env.DB.prepare('SELECT last_value FROM counters WHERE user_id = ? AND series = ? AND year = ?').bind(userId, series, year).first<{ last_value: number }>();
  return row?.last_value ?? null;
}

describe('numérotation', () => {
  it('attribue F-2026-001 puis des numéros continus', async () => {
    const u = await createUser('a@example.test');
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await runIssue(env.DB, target(u.id, await draft(u.id)))).number);
    expect(numbers).toEqual(['F-2026-001', 'F-2026-002', 'F-2026-003']);
    expect(await counter(u.id)).toBe(3);
  });

  it('ne consomme aucun numéro pour un document déjà émis (vigilance n° 3)', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    expect(await runIssue(env.DB, target(u.id, id))).toEqual({ issued: true, number: 'F-2026-001' });
    expect(await runIssue(env.DB, target(u.id, id))).toEqual({ issued: false, number: 'F-2026-001' });
    expect(await counter(u.id)).toBe(1);
    expect((await runIssue(env.DB, target(u.id, await draft(u.id)))).number).toBe('F-2026-002');
  });

  it('résiste à deux émissions simultanées du même brouillon', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    const results = await Promise.all([runIssue(env.DB, target(u.id, id)), runIssue(env.DB, target(u.id, id))]);
    expect(results.filter((r) => r.issued)).toHaveLength(1);
    expect(await counter(u.id)).toBe(1);
  });

  it('donne des numéros distincts et sans trou à des émissions simultanées', async () => {
    const u = await createUser('a@example.test');
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => draft(u.id)));
    const results = await Promise.all(ids.map((id) => runIssue(env.DB, target(u.id, id))));
    expect(results.map((r) => r.number).sort()).toEqual(['F-2026-001', 'F-2026-002', 'F-2026-003', 'F-2026-004', 'F-2026-005']);
  });

  it('repart à 001 chaque année civile sans toucher l’année précédente', async () => {
    const u = await createUser('a@example.test');
    await runIssue(env.DB, target(u.id, await draft(u.id)));
    await runIssue(env.DB, target(u.id, await draft(u.id)));
    expect((await runIssue(env.DB, target(u.id, await draft(u.id), { year: 2027 }))).number).toBe('F-2027-001');
    expect(await counter(u.id, 'F', 2026)).toBe(2);
  });

  it('tient une suite par utilisateur et par série', async () => {
    const a = await createUser('a@example.test');
    const b = await createUser('b@example.test');
    expect((await runIssue(env.DB, target(a.id, await draft(a.id)))).number).toBe('F-2026-001');
    expect((await runIssue(env.DB, target(b.id, await draft(b.id)))).number).toBe('F-2026-001');
    expect((await runIssue(env.DB, target(a.id, await draft(a.id), { series: 'A', prefix: 'A' }))).number).toBe('A-2026-001');
  });

  it('reprend après un numéro de départ et suit un changement de préfixe', async () => {
    const u = await createUser('a@example.test');
    await env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES (?, 'F', 2026, 41)").bind(u.id).run();
    expect((await runIssue(env.DB, target(u.id, await draft(u.id)))).number).toBe('F-2026-042');
    expect((await runIssue(env.DB, target(u.id, await draft(u.id), { prefix: 'FA' }))).number).toBe('FA-2026-043');
  });

  it('refuse un document d’un autre utilisateur sans toucher aux compteurs', async () => {
    const a = await createUser('a@example.test');
    const b = await createUser('b@example.test');
    const id = await draft(a.id);
    expect((await runIssue(env.DB, target(b.id, id))).issued).toBe(false);
    expect(await counter(b.id)).toBeNull();
    expect(await counter(a.id)).toBeNull();
  });

  it('n’incrémente rien si la condition supplémentaire est fausse', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    expect((await runIssue(env.DB, target(u.id, id, { guard: { sql: 'AND d.total_ht_cents > ?', params: [0] } }))).issued).toBe(false);
    expect(await counter(u.id)).toBeNull();
  });

  it('annule tout si une instruction du batch échoue (atomicité)', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    await expect(runIssue(env.DB, target(u.id, id, { snapshotJson: '{ pas du json' }))).rejects.toThrow();
    expect(await counter(u.id)).toBeNull();
    const row = await env.DB.prepare('SELECT status, number FROM invoices WHERE id = ?').bind(id).first();
    expect(row).toEqual({ status: 'draft', number: null });
  });

  it('écrit le numéro dans l’instantané et applique les colonnes demandées', async () => {
    const u = await createUser('a@example.test');
    const id = await draft(u.id);
    await runIssue(env.DB, target(u.id, id, { snapshotJson: JSON.stringify({ schemaVersion: 1, number: null }) }));
    const row = await env.DB.prepare("SELECT number, status, issue_date, json_extract(snapshot_json, '$.number') AS snap FROM invoices WHERE id = ?").bind(id).first();
    expect(row).toEqual({ number: 'F-2026-001', status: 'issued', issue_date: '2026-11-03', snap: 'F-2026-001' });
  });

  it('produit le même format que formatDocumentNumber', async () => {
    const u = await createUser('a@example.test');
    await env.DB.prepare("INSERT INTO counters (user_id, series, year, last_value) VALUES (?, 'F', 2026, 1233)").bind(u.id).run();
    expect((await runIssue(env.DB, target(u.id, await draft(u.id)))).number).toBe(formatDocumentNumber('F', 2026, 1234));
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:worker -- numbering`
Expected: FAIL, module `../../src/worker/numbering` introuvable.

- [ ] **Étape 3 : écrire `src/worker/numbering.ts`**

```ts
import type { Series } from '../shared/numbering';

export type IssueTarget = {
  table: 'quotes' | 'invoices';
  docId: string;
  userId: string;
  series: Series;
  year: number;
  prefix: string;
  /** Colonnes modifiées dans la même instruction que l'attribution du numéro. */
  set: Record<string, string | number | null>;
  /** Instantané JSON : son champ $.number reçoit le numéro attribué. */
  snapshotJson?: string;
  /** Condition SQL supplémentaire sur la ligne du document (alias d), commençant par AND. */
  guard?: { sql: string; params: (string | number | null)[] };
};

const COLUMN = /^[a-z_]+$/;

export function issueStatements(db: D1Database, t: IssueTarget): [D1PreparedStatement, D1PreparedStatement] {
  const guardSql = t.guard?.sql ?? '';
  const guardParams = t.guard?.params ?? [];

  // 1. Incrémente le compteur seulement si le document est un brouillon de cet utilisateur.
  const counter = db
    .prepare(
      `INSERT INTO counters (user_id, series, year, last_value)
       SELECT ?, ?, ?, 1
       WHERE EXISTS (SELECT 1 FROM ${t.table} AS d WHERE d.id = ? AND d.user_id = ? AND d.status = 'draft' ${guardSql})
       ON CONFLICT (user_id, series, year) DO UPDATE SET last_value = counters.last_value + 1`,
    )
    .bind(t.userId, t.series, t.year, t.docId, t.userId, ...guardParams);

  // 2. Pose le numéro (lu dans le compteur) et les autres colonnes, sous la même condition.
  const numberSql = `(SELECT printf('%s-%d-%03d', ?, c.year, c.last_value) FROM counters AS c WHERE c.user_id = ? AND c.series = ? AND c.year = ?)`;
  const numberParams = [t.prefix, t.userId, t.series, t.year];
  const assignments = [`number = ${numberSql}`];
  const params: (string | number | null)[] = [...numberParams];
  for (const [col, value] of Object.entries(t.set)) {
    if (!COLUMN.test(col)) throw new Error(`Colonne refusée : ${col}`);
    assignments.push(`${col} = ?`);
    params.push(value);
  }
  if (t.snapshotJson !== undefined) {
    assignments.push(`snapshot_json = json_set(?, '$.number', ${numberSql})`);
    params.push(t.snapshotJson, ...numberParams);
  }
  const update = db
    .prepare(`UPDATE ${t.table} AS d SET ${assignments.join(', ')} WHERE d.id = ? AND d.user_id = ? AND d.status = 'draft' ${guardSql}`)
    .bind(...params, t.docId, t.userId, ...guardParams);

  return [counter, update];
}

export async function runIssue(
  db: D1Database,
  t: IssueTarget,
  opts: { before?: D1PreparedStatement[] } = {},
): Promise<{ issued: boolean; number: string | null }> {
  const before = opts.before ?? [];
  const [counter, update] = issueStatements(db, t);
  const read = db.prepare(`SELECT number FROM ${t.table} WHERE id = ? AND user_id = ?`).bind(t.docId, t.userId);
  const results = await db.batch([...before, counter, update, read]);
  const updated = results[before.length + 1]!;
  const row = results[before.length + 2]!.results[0] as { number: string | null } | undefined;
  return { issued: updated.meta.changes === 1, number: row?.number ?? null };
}
```

- [ ] **Étape 4 : relancer le test**

Run: `npm run test:worker -- numbering`
Expected: PASS (12 tests).

- [ ] **Étape 5 : commit**

```bash
git add src/worker/numbering.ts test/worker/numbering.test.ts
git commit -m "feat: numérotation continue attribuée dans un batch D1 gardé"
```

**Critère de fin :** continuité, absence de trou en cas de double émission ou d'échec, remise à zéro annuelle, séries et utilisateurs indépendants, numéro de départ et changement de préfixe : tous vérifiés contre une vraie D1.

---

### Tâche 14 : vue de document et instantané (mentions obligatoires)

**Fichiers :**
- Créer : `src/shared/legal.ts`, `src/shared/document.ts`, `src/shared/test-fixtures.ts`
- Tests : `src/shared/document.test.ts`

**Interfaces :**
- Consomme : `Line`, `Totals`, `computeTotals`, `filledLines` (tâche 12) ; `DeductedDeposit`, `computeBalance` (tâche 12) ; `ProfileData` (tâche 8) ; `ClientData` (tâche 10).
- Produit (`legal.ts`) : `VAT_FRANCHISE_MENTION`, `NO_DISCOUNT_MENTION`, `RECOVERY_INDEMNITY_MENTION`, `EI_SUFFIX`.
- Produit (`document.ts`) : `type DocumentKind = 'quote' | 'deposit' | 'final' | 'standalone' | 'credit'` ; `type DocRef = { number: string; date: string }` ; `type DocumentView` (ci-dessous) ; `buildDocumentView(input: BuildViewInput): DocumentView` ; `buildCreditView(original: DocumentView, ctx: CreditContext): DocumentView` ; `parseSnapshot(json: string): DocumentView` ; `KIND_TITLE`.
- Produit (`test-fixtures.ts`) : `PROFILE_DATA: ProfileData`, `CLIENT_BUSINESS_DATA`, `CLIENT_INDIVIDUAL_DATA: ClientData`, `MOCKUP_LINES: Line[]` (total 292 000 c).

- [ ] **Étape 1 : vérifier les mentions sur les sources officielles**

Avant d'écrire `legal.ts` (spec § 8), relire : article 293 B du CGI ; article 242 nonies A de l'annexe II au CGI ; articles L441-9, L441-10 et D441-5 du Code de commerce (Légifrance) ; fiches « Facture : mentions obligatoires » et « Devis » d'entreprendre.service-public.fr ; date d'entrée en vigueur des nouvelles mentions de la facturation électronique pour les micro-entrepreneurs. Si une formulation diffère de celles ci-dessous, retenir la formulation officielle et adapter les tests en conséquence. Noter les adresses consultées et la date dans l'en-tête de `legal.ts`.

- [ ] **Étape 2 : écrire les fixtures partagées et le test qui échoue**

`src/shared/test-fixtures.ts` :

```ts
import type { ClientData } from './client';
import type { Line } from './lines';
import type { ProfileData } from './profile';

export const PROFILE_DATA: ProfileData = {
  templateRef: 'modele-01@1', vatRegime: 'franchise',
  tradeName: 'Benali Électricité', ownerName: 'Karim Benali', activityLine: 'Électricité générale • Installation • Rénovation',
  street: '8 rue de la Fosse', postalCode: '44000', city: 'Nantes', siret: '91234567800019',
  phone: '06 12 34 56 78', email: 'contact@benali-elec.fr', logoDataUrl: null,
  insurer: 'MAAF Pro', insurancePolicy: 'DEC-4471209', insuranceArea: 'France métropolitaine',
  defaultQuoteValidityDays: 30, defaultPaymentDelayDays: 30,
  latePenaltyText: 'En cas de retard de paiement, pénalités au taux d’intérêt appliqué par la BCE à son opération de refinancement la plus récente, majoré de 10 points de pourcentage.',
  paymentDetails: 'FR76 3000 6000 0112 3456 7890 189',
  prefixQuote: 'D', prefixInvoice: 'F', prefixCredit: 'A', units: ['u', 'h', 'jour', 'forfait', 'lot', 'm²', 'ml'],
};

export const CLIENT_BUSINESS_DATA: ClientData = {
  id: 'c-pro', type: 'business', name: 'SCI Les Tilleuls', street: '3 place Royale', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '801222333', email: '', phone: '',
};

export const CLIENT_INDIVIDUAL_DATA: ClientData = {
  id: 'c-part', type: 'individual', name: 'M. et Mme Lefèvre', street: '5 rue Kervégan', postalCode: '44000', city: 'Nantes',
  country: 'FR', siren: '', email: '', phone: '',
};

const l = (id: string, designation: string, q: number, unit: string, p: number): Line => ({ id, designation, quantityMilli: q, unit, unitPriceCents: p, vatRate: null });

export const MOCKUP_LINES: Line[] = [
  l('l1', 'Mise en sécurité et dépose de l’ancien tableau', 1000, 'forfait', 38000),
  l('l2', 'Fourniture et pose d’un tableau électrique 3 rangées', 1000, 'u', 115000),
  l('l3', 'Création de prises de courant 16 A', 8000, 'u', 6500),
  l('l4', 'Points lumineux avec interrupteur', 6000, 'u', 9500),
  l('l5', 'Raccordement, essais et vérifications', 1000, 'forfait', 30000),
];
```

`src/shared/document.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { blankLines } from './lines';
import { buildCreditView, buildDocumentView, parseSnapshot, type BuildViewInput } from './document';
import { NO_DISCOUNT_MENTION, RECOVERY_INDEMNITY_MENTION, VAT_FRANCHISE_MENTION } from './legal';
import { CLIENT_BUSINESS_DATA, CLIENT_INDIVIDUAL_DATA, MOCKUP_LINES, PROFILE_DATA } from './test-fixtures';

const quoteInput: BuildViewInput = {
  kind: 'quote', number: 'D-2026-016', date: '2026-10-31', templateRef: 'modele-02@1',
  profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, object: 'Rénovation électrique du rez-de-chaussée',
  interventionAddress: '12 rue des Tilleuls, 44000 Nantes', lines: [...MOCKUP_LINES, ...blankLines(2)],
  quoteTerms: { validityDays: 30, plannedStart: 'Semaine du 23 novembre', estimatedDuration: '4 jours', paymentTerms: 'Acompte de 30 % à la signature', plannedDepositBp: 3000 },
};

const invoiceInput = (overrides: Partial<BuildViewInput> = {}): BuildViewInput => ({
  kind: 'standalone', number: null, date: '2026-11-03', templateRef: 'modele-01@1', profile: PROFILE_DATA,
  client: CLIENT_BUSINESS_DATA, object: 'Dépannage', interventionAddress: null, lines: MOCKUP_LINES,
  invoiceDates: { serviceDate: '2026-11-02', dueDate: '2026-12-03', notes: '' }, ...overrides,
});

describe('buildDocumentView : devis', () => {
  const view = buildDocumentView(quoteInput);

  it('reprend l’entreprise avec la mention EI et le modèle demandé', () => {
    expect(view.title).toBe('Devis');
    expect(view.templateRef).toBe('modele-02@1');
    expect(view.company).toMatchObject({ tradeName: 'Benali Électricité', legalName: 'Karim Benali EI', siret: '91234567800019' });
    expect(view.company.insurance).toEqual({ insurer: 'MAAF Pro', policy: 'DEC-4471209', area: 'France métropolitaine' });
  });

  it('retire les lignes vides et calcule les totaux (vigilance n° 2)', () => {
    expect(view.lines).toHaveLength(5);
    expect(view.totals).toEqual({ totalHtCents: 292000, vatCents: 0, totalDueCents: 292000 });
    expect(view.vatMention).toBe(VAT_FRANCHISE_MENTION);
    expect(view.dueLabel).toBe('Total à payer');
  });

  it('porte les modalités du devis et pas celles d’une facture', () => {
    expect(view.quoteTerms?.validityDays).toBe(30);
    expect(view.invoiceTerms).toBeNull();
    expect(view.deductions).toBeNull();
  });

  it('omet l’assurance quand aucun assureur n’est renseigné', () => {
    expect(buildDocumentView({ ...quoteInput, profile: { ...PROFILE_DATA, insurer: '' } }).company.insurance).toBeNull();
  });
});

describe('buildDocumentView : factures', () => {
  it('ajoute l’indemnité de 40 € pour un client professionnel seulement', () => {
    expect(buildDocumentView(invoiceInput()).invoiceTerms?.recoveryIndemnity).toBe(RECOVERY_INDEMNITY_MENTION);
    expect(buildDocumentView(invoiceInput({ client: CLIENT_INDIVIDUAL_DATA })).invoiceTerms?.recoveryIndemnity).toBeNull();
  });

  it('porte échéance, pénalités, escompte et coordonnées de paiement', () => {
    expect(buildDocumentView(invoiceInput()).invoiceTerms).toMatchObject({
      serviceDate: '2026-11-02', dueDate: '2026-12-03', latePenaltyText: PROFILE_DATA.latePenaltyText,
      discount: NO_DISCOUNT_MENTION, paymentDetails: PROFILE_DATA.paymentDetails,
    });
  });

  it('titre selon la nature de la facture', () => {
    expect(buildDocumentView(invoiceInput()).title).toBe('Facture');
    expect(buildDocumentView(invoiceInput({ kind: 'deposit', quoteRef: { number: 'D-2026-015', date: '2026-10-20' } })).title).toBe('Facture d’acompte');
    expect(buildDocumentView(invoiceInput({ kind: 'final', deductedDeposits: [] })).title).toBe('Facture');
  });

  it('déduit les acomptes sur une facture de solde', () => {
    const view = buildDocumentView(invoiceInput({
      kind: 'final', quoteRef: { number: 'D-2026-015', date: '2026-10-20' },
      deductedDeposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }],
    }));
    expect(view.title).toBe('Facture de solde');
    expect(view.totals).toEqual({ totalHtCents: 292000, vatCents: 0, totalDueCents: 204400 });
    expect(view.deductions).toEqual({ deposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }], remainingCents: 204400 });
    expect(view.dueLabel).toBe('Reste à payer');
    expect(view.references.quote).toEqual({ number: 'D-2026-015', date: '2026-10-20' });
  });
});

describe('buildCreditView', () => {
  it('annule exactement une facture de solde : lignes et reste dû en négatif', () => {
    const original = { ...buildDocumentView(invoiceInput({
      kind: 'final', deductedDeposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }],
    })), number: 'F-2026-027' };
    const credit = buildCreditView(original, {
      date: '2026-11-10', templateRef: 'modele-03@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
      creditedRef: { number: 'F-2026-027', date: '2026-11-03' },
    });
    expect(credit.kind).toBe('credit');
    expect(credit.title).toBe('Avoir');
    expect(credit.number).toBeNull();
    expect(credit.lines[0]!.unitPriceCents).toBe(-38000);
    expect(credit.totals).toEqual({ totalHtCents: -292000, vatCents: 0, totalDueCents: -204400 });
    expect(credit.dueLabel).toBe('Montant de l’avoir');
    expect(credit.references.creditedInvoice).toEqual({ number: 'F-2026-027', date: '2026-11-03' });
    expect(credit.invoiceTerms).toBeNull();
  });
});

describe('parseSnapshot', () => {
  it('relit un instantané et refuse une version inconnue', () => {
    const view = buildDocumentView(quoteInput);
    expect(parseSnapshot(JSON.stringify(view))).toEqual(view);
    expect(() => parseSnapshot(JSON.stringify({ ...view, schemaVersion: 2 }))).toThrow();
  });
});
```

- [ ] **Étape 3 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:unit -- src/shared/document`
Expected: FAIL, modules introuvables.

- [ ] **Étape 4 : écrire `src/shared/legal.ts`**

```ts
// Mentions obligatoires, vérifiées le <date> sur :
// - <adresse Légifrance, art. 293 B du CGI>
// - <adresse Légifrance, art. 242 nonies A de l'annexe II au CGI>
// - <adresse Légifrance, art. L441-9, L441-10 et D441-5 du Code de commerce>
// - <adresse entreprendre.service-public.fr, mentions obligatoires des factures et des devis>
// (remplacer ces quatre lignes par les adresses réellement consultées à l'étape 1)

export const VAT_FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI';
export const NO_DISCOUNT_MENTION = 'Pas d’escompte pour paiement anticipé.';
export const RECOVERY_INDEMNITY_MENTION = 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.';
export const EI_SUFFIX = 'EI';
```

- [ ] **Étape 5 : écrire `src/shared/document.ts`**

```ts
import { computeBalance, type DeductedDeposit } from './balance';
import type { ClientData } from './client';
import { EI_SUFFIX, NO_DISCOUNT_MENTION, RECOVERY_INDEMNITY_MENTION, VAT_FRANCHISE_MENTION } from './legal';
import { computeTotals, filledLines, type Line, type Totals } from './lines';
import type { ProfileData } from './profile';

export type DocumentKind = 'quote' | 'deposit' | 'final' | 'standalone' | 'credit';
export type DocRef = { number: string; date: string };

export type CompanyBlock = {
  tradeName: string;
  legalName: string; // « Prénom Nom EI »
  activityLine: string;
  street: string;
  postalCode: string;
  city: string;
  siret: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  insurance: { insurer: string; policy: string; area: string } | null;
};

export type ClientBlock = { type: 'individual' | 'business'; name: string; street: string; postalCode: string; city: string; siren: string };

export type QuoteTerms = { validityDays: number; plannedStart: string; estimatedDuration: string; paymentTerms: string; plannedDepositBp: number | null };

export type InvoiceTerms = {
  serviceDate: string | null; // null tant que la facture est en brouillon sans date choisie
  dueDate: string | null;
  latePenaltyText: string;
  recoveryIndemnity: string | null;
  discount: string;
  paymentDetails: string;
  notes: string;
};

export type DocumentView = {
  schemaVersion: 1;
  kind: DocumentKind;
  title: string;
  number: string | null;
  date: string | null;
  templateRef: string;
  vatMention: string;
  company: CompanyBlock;
  client: ClientBlock | null;
  object: string;
  interventionAddress: string | null;
  lines: Line[];
  totals: Totals;
  dueLabel: string;
  deductions: { deposits: DeductedDeposit[]; remainingCents: number } | null;
  quoteTerms: QuoteTerms | null;
  invoiceTerms: InvoiceTerms | null;
  references: { quote: DocRef | null; creditedInvoice: DocRef | null };
};

export type BuildViewInput = {
  kind: Exclude<DocumentKind, 'credit'>;
  number: string | null;
  date: string | null;
  templateRef: string;
  profile: ProfileData;
  client: ClientData | null;
  object: string;
  interventionAddress: string | null;
  lines: Line[];
  quoteTerms?: QuoteTerms;
  invoiceDates?: { serviceDate: string | null; dueDate: string | null; notes: string };
  deductedDeposits?: DeductedDeposit[];
  quoteRef?: DocRef | null;
};

export type CreditContext = { date: string; templateRef: string; profile: ProfileData; client: ClientData | null; creditedRef: DocRef };

export const KIND_TITLE: Record<DocumentKind, string> = {
  quote: 'Devis',
  deposit: 'Facture d’acompte',
  final: 'Facture de solde',
  standalone: 'Facture',
  credit: 'Avoir',
};

function companyBlock(p: ProfileData): CompanyBlock {
  return {
    tradeName: p.tradeName,
    legalName: `${p.ownerName} ${EI_SUFFIX}`,
    activityLine: p.activityLine,
    street: p.street,
    postalCode: p.postalCode,
    city: p.city,
    siret: p.siret,
    phone: p.phone,
    email: p.email,
    logoDataUrl: p.logoDataUrl,
    insurance: p.insurer ? { insurer: p.insurer, policy: p.insurancePolicy, area: p.insuranceArea } : null,
  };
}

function clientBlock(c: ClientData | null): ClientBlock | null {
  return c ? { type: c.type, name: c.name, street: c.street, postalCode: c.postalCode, city: c.city, siren: c.siren } : null;
}

export function buildDocumentView(input: BuildViewInput): DocumentView {
  const lines = filledLines(input.lines);
  const totals = computeTotals(lines);
  const isInvoice = input.kind !== 'quote';
  const deposits = input.kind === 'final' ? input.deductedDeposits ?? [] : [];
  const hasDeductions = deposits.length > 0;
  const balance = computeBalance(totals.totalHtCents, deposits);

  return {
    schemaVersion: 1,
    kind: input.kind,
    title: input.kind === 'final' && !hasDeductions ? 'Facture' : KIND_TITLE[input.kind],
    number: input.number,
    date: input.date,
    templateRef: input.templateRef,
    vatMention: VAT_FRANCHISE_MENTION,
    company: companyBlock(input.profile),
    client: clientBlock(input.client),
    object: input.object,
    interventionAddress: input.interventionAddress,
    lines,
    totals: hasDeductions ? { ...totals, totalDueCents: balance.remainingCents } : totals,
    dueLabel: hasDeductions ? 'Reste à payer' : 'Total à payer',
    deductions: hasDeductions ? { deposits, remainingCents: balance.remainingCents } : null,
    quoteTerms: input.kind === 'quote' ? input.quoteTerms ?? null : null,
    invoiceTerms: isInvoice
      ? {
          serviceDate: input.invoiceDates?.serviceDate ?? null,
          dueDate: input.invoiceDates?.dueDate ?? null,
          latePenaltyText: input.profile.latePenaltyText,
          recoveryIndemnity: input.client?.type === 'business' ? RECOVERY_INDEMNITY_MENTION : null,
          discount: NO_DISCOUNT_MENTION,
          paymentDetails: input.profile.paymentDetails,
          notes: input.invoiceDates?.notes ?? '',
        }
      : null,
    references: { quote: input.quoteRef ?? null, creditedInvoice: null },
  };
}

/** Avoir total : reprend les lignes et déductions de la facture annulée, en négatif. */
export function buildCreditView(original: DocumentView, ctx: CreditContext): DocumentView {
  const lines = original.lines.map((l) => ({ ...l, unitPriceCents: -l.unitPriceCents }));
  const totals = computeTotals(lines);
  const deductions = original.deductions
    ? { deposits: original.deductions.deposits, remainingCents: -original.deductions.remainingCents }
    : null;
  return {
    ...original,
    kind: 'credit',
    title: KIND_TITLE.credit,
    number: null,
    date: ctx.date,
    templateRef: ctx.templateRef,
    company: companyBlock(ctx.profile),
    client: clientBlock(ctx.client),
    lines,
    totals: deductions ? { ...totals, totalDueCents: deductions.remainingCents } : totals,
    dueLabel: 'Montant de l’avoir',
    deductions,
    quoteTerms: null,
    invoiceTerms: null,
    references: { quote: original.references.quote, creditedInvoice: ctx.creditedRef },
  };
}

export function parseSnapshot(json: string): DocumentView {
  const view = JSON.parse(json) as DocumentView;
  if (view.schemaVersion !== 1) throw new Error(`Version d’instantané inconnue : ${String(view.schemaVersion)}`);
  return view;
}
```

- [ ] **Étape 6 : relancer les tests**

Run: `npm run test:unit -- src/shared && npm run typecheck`
Expected: PASS.

- [ ] **Étape 7 : commit**

```bash
git add src/shared
git commit -m "feat: vue de document commune, mentions obligatoires et avoir total"
```

**Critère de fin :** une seule fonction construit la vue de tous les types de documents ; les mentions dépendent du type de client et du type de document ; l'avoir annule exactement la facture d'origine.

---

### Tâche 15 : API des devis (brouillon, envoi numéroté, acceptation figée, refus, duplication)

**Fichiers :**
- Créer : `src/shared/quote.ts`, `src/shared/status.ts`, `src/worker/db/quotes.ts`, `src/worker/views.ts`, `src/worker/routes/quotes.ts`
- Modifier : `src/worker/app.ts`, `src/shared/api-types.ts`, `test/worker/fixtures.ts`, `test/worker/isolation.test.ts`
- Tests : `test/worker/quotes.test.ts`, `src/shared/status.test.ts`

**Interfaces :**
- Consomme : `runIssue` (tâche 13) ; `buildDocumentView`, `parseSnapshot` (tâche 14) ; `LinesSchema`, `blankLines`, `computeTotals`, `lineProblems` (tâche 12) ; `requireCompleteProfile`, `getProfile` (tâche 8) ; `requireClient`, `getClient` (tâche 10).
- Produit (`shared/quote.ts`) : `QuoteDraftInput` (Zod) et son type.
- Produit (`shared/status.ts`) : `type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused'` ; `type Tone = 'draft' | 'wait' | 'late' | 'paid' | 'ok' | 'neutral'` ; `QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: Tone }>`.
- Produit (`db/quotes.ts`) : `type QuoteRow` ; `getQuoteRow(db, userId, id)` ; `requireQuoteRow(db, userId, id)` ; `toQuoteDto(row): QuoteDto` ; `listQuotes(db, userId, status?)`.
- Produit (`views.ts`) : `quoteView(db, userId, row: QuoteRow): Promise<DocumentView>` (instantané s'il existe, sinon vue vivante).
- Produit (API) : `GET /api/quotes?status=` → `{ items: QuoteListItem[] }` ; `POST /api/quotes { clientId? }` → `201 QuoteResponse` ; `GET /api/quotes/:id` → `QuoteResponse` ; `PUT /api/quotes/:id (QuoteDraftInput)` → `QuoteResponse` ; `DELETE /api/quotes/:id` → `204` ; `POST /api/quotes/:id/send|accept|refuse` → `QuoteResponse` ; `POST /api/quotes/:id/duplicate` → `201 QuoteResponse`.
- Produit (`api-types.ts`) : `QuoteDto`, `QuoteListItem`, `QuoteResponse = { quote: QuoteDto; view: DocumentView }`.
- Produit (`fixtures.ts`) : `MOCKUP_LINES` (réexport de `src/shared/test-fixtures`), `quoteBody(clientId, lines?)`, `seedQuote(app, user, { clientId, lines?, status? })`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/shared/status.test.ts` :

```ts
import { expect, it } from 'vitest';
import { QUOTE_STATUS } from './status';

it('libelle les statuts de devis en français', () => {
  expect(Object.values(QUOTE_STATUS).map((s) => s.label)).toEqual(['Brouillon', 'Envoyé', 'Accepté', 'Refusé']);
});
```

Ajouter à `test/worker/fixtures.ts` (et fusionner les imports en tête de fichier) :

```ts
import type { QuoteResponse } from '../../src/shared/api-types';
import type { Line } from '../../src/shared/lines';
import { MOCKUP_LINES } from '../../src/shared/test-fixtures';
export { MOCKUP_LINES };

export function quoteBody(clientId: string | null, lines: Line[] = MOCKUP_LINES) {
  return {
    clientId,
    object: 'Rénovation électrique du rez-de-chaussée',
    interventionAddress: '12 rue des Tilleuls, 44000 Nantes',
    lines,
    validityDays: 30,
    plannedStart: 'Semaine du 23 novembre',
    estimatedDuration: '4 jours',
    paymentTerms: 'Acompte de 30 % à la signature, solde à réception de facture.',
    plannedDepositBp: 3000,
  };
}

export async function seedQuote(
  app: App,
  user: SessionUser,
  opts: { clientId: string; lines?: Line[]; status?: 'draft' | 'sent' | 'accepted' },
): Promise<QuoteResponse> {
  const created = await json<QuoteResponse>(await call(app, user, 'POST', '/api/quotes', {}));
  const id = created.quote.id;
  let res = await call(app, user, 'PUT', `/api/quotes/${id}`, quoteBody(opts.clientId, opts.lines));
  if (opts.status === 'sent' || opts.status === 'accepted') res = await call(app, user, 'POST', `/api/quotes/${id}/send`);
  if (opts.status === 'accepted') res = await call(app, user, 'POST', `/api/quotes/${id}/accept`);
  if (res.status !== 200) throw new Error(`quote: ${res.status} ${await res.text()}`);
  return json<QuoteResponse>(res);
}
```

`test/worker/quotes.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, PROFILE, quoteBody, seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

async function ready() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  return { u, client };
}

describe('création et modification', () => {
  it('crée un brouillon avec 5 lignes vides et les réglages du profil', async () => {
    const { u } = await ready();
    const res = await call(app, u, 'POST', '/api/quotes', {});
    expect(res.status).toBe(201);
    const { quote, view } = await json(res);
    expect(quote).toMatchObject({ status: 'draft', number: null, validityDays: 30, totalHtCents: 0 });
    expect(quote.lines).toHaveLength(5);
    expect(quote.lines.every((l: { designation: string }) => l.designation === '')).toBe(true);
    expect(view).toMatchObject({ title: 'Devis', number: null, lines: [] });
  });

  it('exige un profil complet', async () => {
    const u = await createAllowedUser('karim@example.test');
    const res = await call(app, u, 'POST', '/api/quotes', {});
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'profile_incomplete' });
  });

  it('enregistre et recalcule le total côté serveur, lignes vides comprises en brouillon', async () => {
    const { u, client } = await ready();
    const { quote } = await json(await call(app, u, 'POST', '/api/quotes', {}));
    const body = quoteBody(client.id, [...quoteBody(client.id).lines, { id: 'vide', designation: '', quantityMilli: 1000, unit: 'u', unitPriceCents: 0, vatRate: null }]);
    const saved = await json(await call(app, u, 'PUT', `/api/quotes/${quote.id}`, body));
    expect(saved.quote.totalHtCents).toBe(292000);
    expect(saved.quote.lines).toHaveLength(6);
    expect(saved.view.lines).toHaveLength(5);
    expect(saved.view.client).toMatchObject({ name: 'SCI Les Tilleuls' });
  });
});

describe('envoi et numérotation', () => {
  it('refuse l’envoi sans client, sans ligne remplie, ou avec une ligne chiffrée sans désignation', async () => {
    const { u, client } = await ready();
    const { quote } = await json(await call(app, u, 'POST', '/api/quotes', {}));
    expect(await json(await call(app, u, 'POST', `/api/quotes/${quote.id}/send`))).toMatchObject({ error: 'client_missing' });
    await call(app, u, 'PUT', `/api/quotes/${quote.id}`, quoteBody(client.id, []));
    expect(await json(await call(app, u, 'POST', `/api/quotes/${quote.id}/send`))).toMatchObject({ error: 'no_lines' });
    await call(app, u, 'PUT', `/api/quotes/${quote.id}`, quoteBody(client.id, [{ id: 'x', designation: '', quantityMilli: 1000, unit: 'u', unitPriceCents: 500, vatRate: null }]));
    expect(await json(await call(app, u, 'POST', `/api/quotes/${quote.id}/send`))).toMatchObject({ error: 'missing_designation' });
  });

  it('attribue D-2026-001 à l’envoi, puis des numéros continus ; un brouillon supprimé ne consomme rien', async () => {
    const { u, client } = await ready();
    const first = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(first.quote).toMatchObject({ number: 'D-2026-001', status: 'sent', quoteDate: '2026-11-03' });
    expect(first.view).toMatchObject({ number: 'D-2026-001', date: '2026-11-03' });
    const throwaway = await json(await call(app, u, 'POST', '/api/quotes', {}));
    expect((await call(app, u, 'DELETE', `/api/quotes/${throwaway.quote.id}`)).status).toBe(204);
    const second = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(second.quote.number).toBe('D-2026-002');
  });

  it('répond 409 à un second envoi (double clic, vigilance n° 3)', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    const again = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/send`);
    expect(again.status).toBe(409);
    const next = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(next.quote.number).toBe('D-2026-002');
  });

  it('laisse un devis envoyé modifiable', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    const res = await call(app, u, 'PUT', `/api/quotes/${q.quote.id}`, { ...quoteBody(client.id), object: 'Objet corrigé' });
    expect(res.status).toBe(200);
    expect((await json(res)).quote).toMatchObject({ object: 'Objet corrigé', number: 'D-2026-001', status: 'sent' });
  });
});

describe('acceptation, refus, duplication', () => {
  it('fige le devis accepté : instantané, plus de modification ni de suppression', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'accepted' });
    expect(q.quote).toMatchObject({ status: 'accepted', acceptedAt: expect.any(String) });
    expect((await call(app, u, 'PUT', `/api/quotes/${q.quote.id}`, quoteBody(client.id))).status).toBe(409);
    expect((await call(app, u, 'DELETE', `/api/quotes/${q.quote.id}`)).status).toBe(409);
  });

  it('affiche le devis accepté depuis son instantané, même après changement du profil et du client', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'accepted' });
    await call(app, u, 'PUT', '/api/profile', { ...PROFILE, tradeName: 'Nouveau nom', street: '1 rue Neuve' });
    await call(app, u, 'PUT', `/api/clients/${client.id}`, { ...CLIENT_BUSINESS, name: 'Autre raison sociale' });
    await call(app, u, 'PUT', '/api/profile/template', { templateRef: 'modele-03@1' });
    const { view } = await json(await call(app, u, 'GET', `/api/quotes/${q.quote.id}`));
    expect(view.company).toMatchObject({ tradeName: 'Benali Électricité', street: '8 rue de la Fosse' });
    expect(view.client).toMatchObject({ name: 'SCI Les Tilleuls' });
    expect(view.templateRef).toBe('modele-01@1');
  });

  it('n’accepte ou ne refuse qu’un devis envoyé', async () => {
    const { u, client } = await ready();
    const draft = await seedQuote(app, u, { clientId: client.id });
    expect((await call(app, u, 'POST', `/api/quotes/${draft.quote.id}/accept`)).status).toBe(409);
    const sent = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    const refused = await json(await call(app, u, 'POST', `/api/quotes/${sent.quote.id}/refuse`));
    expect(refused.quote.status).toBe('refused');
    expect((await call(app, u, 'POST', `/api/quotes/${sent.quote.id}/accept`)).status).toBe(409);
    expect((await call(app, u, 'PUT', `/api/quotes/${sent.quote.id}`, quoteBody(client.id))).status).toBe(409);
  });

  it('duplique en un nouveau brouillon sans numéro', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'accepted' });
    const res = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/duplicate`);
    expect(res.status).toBe(201);
    const copy = (await json(res)).quote;
    expect(copy).toMatchObject({ status: 'draft', number: null, clientId: client.id, object: q.quote.object, totalHtCents: 292000 });
    expect(copy.id).not.toBe(q.quote.id);
    expect(copy.lines[0].id).not.toBe(q.quote.lines[0].id);
  });

  it('liste les devis, filtrables par statut', async () => {
    const { u, client } = await ready();
    await seedQuote(app, u, { clientId: client.id });
    await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect((await json(await call(app, u, 'GET', '/api/quotes'))).items).toHaveLength(2);
    const sent = (await json(await call(app, u, 'GET', '/api/quotes?status=sent'))).items;
    expect(sent).toEqual([expect.objectContaining({ number: 'D-2026-001', clientName: 'SCI Les Tilleuls', totalHtCents: 292000 })]);
  });
});
```

Ajouter à `test/worker/isolation.test.ts` (fusionner les imports) :

```ts
it('rend les devis d’un autre utilisateur invisibles et intouchables', async () => {
  const { a, b } = await twoUsers(app);
  const client = await seedClient(app, a);
  const q = await seedQuote(app, a, { clientId: client.id, status: 'sent' });
  for (const [method, path] of [
    ['GET', `/api/quotes/${q.quote.id}`], ['DELETE', `/api/quotes/${q.quote.id}`], ['POST', `/api/quotes/${q.quote.id}/send`],
    ['POST', `/api/quotes/${q.quote.id}/accept`], ['POST', `/api/quotes/${q.quote.id}/refuse`], ['POST', `/api/quotes/${q.quote.id}/duplicate`],
  ] as const) {
    expect((await call(app, b, method, path)).status).toBe(404);
  }
  expect((await call(app, b, 'PUT', `/api/quotes/${q.quote.id}`, quoteBody(null))).status).toBe(404);
  expect((await json(await call(app, b, 'GET', '/api/quotes'))).items).toEqual([]);
});

it('refuse le client d’un autre utilisateur sur un devis (vigilance n° 5)', async () => {
  const { a, b } = await twoUsers(app);
  const clientOfA = await seedClient(app, a);
  const { quote } = await json(await call(app, b, 'POST', '/api/quotes', {}));
  const res = await call(app, b, 'PUT', `/api/quotes/${quote.id}`, quoteBody(clientOfA.id));
  expect(res.status).toBe(404);
  const after = await json(await call(app, b, 'GET', `/api/quotes/${quote.id}`));
  expect(after.quote.clientId).toBeNull();
  expect(after.view.client).toBeNull();
  expect((await call(app, b, 'POST', '/api/quotes', { clientId: clientOfA.id })).status).toBe(404);
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- status && npm run test:worker -- quotes isolation`
Expected: FAIL.

- [ ] **Étape 3 : écrire les schémas, statuts et types d'API**

`src/shared/quote.ts` :

```ts
import { z } from 'zod';
import { LinesSchema } from './lines';

export const QuoteDraftInput = z.object({
  clientId: z.string().min(1).nullable(),
  object: z.string().trim().max(300),
  interventionAddress: z.string().trim().max(300).nullable(),
  lines: LinesSchema,
  validityDays: z.number().int().min(1).max(365),
  plannedStart: z.string().trim().max(120),
  estimatedDuration: z.string().trim().max(120),
  paymentTerms: z.string().trim().max(500),
  plannedDepositBp: z.number().int().min(1).max(10_000).nullable(),
});

export type QuoteDraftInput = z.infer<typeof QuoteDraftInput>;
```

`src/shared/status.ts` :

```ts
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused';
export type Tone = 'draft' | 'wait' | 'late' | 'paid' | 'ok' | 'neutral';

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'draft' },
  sent: { label: 'Envoyé', tone: 'draft' },
  accepted: { label: 'Accepté', tone: 'ok' },
  refused: { label: 'Refusé', tone: 'late' },
};
```

Ajouter à `src/shared/api-types.ts` :

```ts
import type { DocumentView } from './document';
import type { QuoteDraftInput } from './quote';
import type { QuoteStatus } from './status';

export type QuoteDto = QuoteDraftInput & {
  id: string;
  number: string | null;
  status: QuoteStatus;
  quoteDate: string | null;
  acceptedAt: string | null;
  refusedAt: string | null;
  totalHtCents: number;
  updatedAt: string;
};

export type QuoteListItem = {
  id: string;
  number: string | null;
  status: QuoteStatus;
  clientName: string | null;
  object: string;
  totalHtCents: number;
  quoteDate: string | null;
  updatedAt: string;
};

export type QuoteResponse = { quote: QuoteDto; view: DocumentView };
```

- [ ] **Étape 4 : écrire `src/worker/db/quotes.ts` et `src/worker/views.ts`**

```ts
// src/worker/db/quotes.ts
import type { QuoteDto, QuoteListItem } from '../../shared/api-types';
import type { Line } from '../../shared/lines';
import type { QuoteStatus } from '../../shared/status';
import { notFound } from '../errors';

export type QuoteRow = {
  id: string; user_id: string; client_id: string | null; number: string | null; status: QuoteStatus;
  object: string; intervention_address: string | null; lines_json: string; total_ht_cents: number;
  validity_days: number; planned_start: string; estimated_duration: string; payment_terms: string;
  planned_deposit_bp: number | null; quote_date: string | null; sent_at: string | null;
  accepted_at: string | null; refused_at: string | null; snapshot_json: string | null;
  created_at: string; updated_at: string;
};

export async function getQuoteRow(db: D1Database, userId: string, id: string): Promise<QuoteRow | null> {
  return db.prepare('SELECT * FROM quotes WHERE id = ? AND user_id = ?').bind(id, userId).first<QuoteRow>();
}

export async function requireQuoteRow(db: D1Database, userId: string, id: string): Promise<QuoteRow> {
  const row = await getQuoteRow(db, userId, id);
  if (!row) throw notFound('Devis introuvable.');
  return row;
}

export function toQuoteDto(r: QuoteRow): QuoteDto {
  return {
    id: r.id, number: r.number, status: r.status, clientId: r.client_id, object: r.object,
    interventionAddress: r.intervention_address, lines: JSON.parse(r.lines_json) as Line[],
    validityDays: r.validity_days, plannedStart: r.planned_start, estimatedDuration: r.estimated_duration,
    paymentTerms: r.payment_terms, plannedDepositBp: r.planned_deposit_bp, quoteDate: r.quote_date,
    acceptedAt: r.accepted_at, refusedAt: r.refused_at, totalHtCents: r.total_ht_cents, updatedAt: r.updated_at,
  };
}

export async function listQuotes(db: D1Database, userId: string, status?: QuoteStatus): Promise<QuoteListItem[]> {
  const { results } = await db.prepare(
    `SELECT q.id, q.number, q.status, c.name AS client_name, q.object, q.total_ht_cents, q.quote_date, q.updated_at
     FROM quotes q LEFT JOIN clients c ON c.id = q.client_id AND c.user_id = q.user_id
     WHERE q.user_id = ?1 AND (?2 IS NULL OR q.status = ?2)
     ORDER BY q.updated_at DESC LIMIT 200`,
  ).bind(userId, status ?? null).all<{ id: string; number: string | null; status: QuoteStatus; client_name: string | null; object: string; total_ht_cents: number; quote_date: string | null; updated_at: string }>();
  return results.map((r) => ({
    id: r.id, number: r.number, status: r.status, clientName: r.client_name, object: r.object,
    totalHtCents: r.total_ht_cents, quoteDate: r.quote_date, updatedAt: r.updated_at,
  }));
}
```

```ts
// src/worker/views.ts
import { buildDocumentView, parseSnapshot, type DocumentView } from '../shared/document';
import type { Line } from '../shared/lines';
import { getClient } from './db/clients';
import { getProfile } from './db/profiles';
import type { QuoteRow } from './db/quotes';
import { HttpError } from './errors';

export async function quoteView(db: D1Database, userId: string, q: QuoteRow): Promise<DocumentView> {
  if (q.snapshot_json) return parseSnapshot(q.snapshot_json);
  const profile = await getProfile(db, userId);
  if (!profile) throw new HttpError(409, 'profile_incomplete', 'Complétez votre profil entreprise avant de continuer.');
  const client = q.client_id ? await getClient(db, userId, q.client_id) : null;
  return buildDocumentView({
    kind: 'quote', number: q.number, date: q.quote_date, templateRef: profile.templateRef, profile, client,
    object: q.object, interventionAddress: q.intervention_address, lines: JSON.parse(q.lines_json) as Line[],
    quoteTerms: {
      validityDays: q.validity_days, plannedStart: q.planned_start, estimatedDuration: q.estimated_duration,
      paymentTerms: q.payment_terms, plannedDepositBp: q.planned_deposit_bp,
    },
  });
}
```

- [ ] **Étape 5 : écrire `src/worker/routes/quotes.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { QuoteResponse } from '../../shared/api-types';
import { todayInParis, yearOf } from '../../shared/dates';
import { blankLines, computeTotals, lineProblems, type Line } from '../../shared/lines';
import { QuoteDraftInput } from '../../shared/quote';
import { requireClient } from '../db/clients';
import { requireCompleteProfile } from '../db/profiles';
import { listQuotes, requireQuoteRow, toQuoteDto, type QuoteRow } from '../db/quotes';
import { HttpError, validate } from '../errors';
import { runIssue } from '../numbering';
import type { AppContext, AppEnv } from '../types';
import { quoteView } from '../views';

async function respond(c: AppContext, id: string, status: 200 | 201 = 200) {
  const row = await requireQuoteRow(c.env.DB, c.var.user.id, id);
  const body: QuoteResponse = { quote: toQuoteDto(row), view: await quoteView(c.env.DB, c.var.user.id, row) };
  return c.json(body, status);
}

const nowIso = (c: AppContext) => c.var.deps.now().toISOString();
const notSent = () => new HttpError(409, 'not_sent', 'Seul un devis envoyé peut être accepté ou refusé.');

async function insertQuote(c: AppContext, values: Omit<QuoteRow, 'id' | 'user_id' | 'number' | 'status' | 'quote_date' | 'sent_at' | 'accepted_at' | 'refused_at' | 'snapshot_json' | 'created_at' | 'updated_at'>) {
  const id = crypto.randomUUID();
  const now = nowIso(c);
  await c.env.DB.prepare(
    `INSERT INTO quotes (id, user_id, client_id, status, object, intervention_address, lines_json, total_ht_cents, validity_days,
       planned_start, estimated_duration, payment_terms, planned_deposit_bp, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.user.id, values.client_id, values.object, values.intervention_address, values.lines_json, values.total_ht_cents,
    values.validity_days, values.planned_start, values.estimated_duration, values.payment_terms, values.planned_deposit_bp, now, now).run();
  return id;
}

export const quoteRoutes = new Hono<AppEnv>()
  .get('/', validate('query', z.object({ status: z.enum(['draft', 'sent', 'accepted', 'refused']).optional() })), async (c) =>
    c.json({ items: await listQuotes(c.env.DB, c.var.user.id, c.req.valid('query').status) }))

  .post('/', validate('json', z.object({ clientId: z.string().min(1).optional() })), async (c) => {
    const { DB } = c.env;
    const profile = await requireCompleteProfile(DB, c.var.user.id);
    const { clientId } = c.req.valid('json');
    if (clientId) await requireClient(DB, c.var.user.id, clientId);
    const id = await insertQuote(c, {
      client_id: clientId ?? null, object: '', intervention_address: null,
      lines_json: JSON.stringify(blankLines(5, profile.units[0] ?? 'u')), total_ht_cents: 0,
      validity_days: profile.defaultQuoteValidityDays, planned_start: '', estimated_duration: '', payment_terms: '', planned_deposit_bp: null,
    });
    return respond(c, id, 201);
  })

  .get('/:id', (c) => respond(c, c.req.param('id')))

  .put('/:id', validate('json', QuoteDraftInput), async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireQuoteRow(DB, userId, c.req.param('id'));
    if (row.status !== 'draft' && row.status !== 'sent') throw new HttpError(409, 'frozen', 'Ce devis est figé : il ne peut plus être modifié.');
    const input = c.req.valid('json');
    if (input.clientId) await requireClient(DB, userId, input.clientId);
    const res = await DB.prepare(
      `UPDATE quotes SET client_id = ?, object = ?, intervention_address = ?, lines_json = ?, total_ht_cents = ?, validity_days = ?,
         planned_start = ?, estimated_duration = ?, payment_terms = ?, planned_deposit_bp = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status IN ('draft', 'sent')`,
    ).bind(input.clientId, input.object, input.interventionAddress || null, JSON.stringify(input.lines), computeTotals(input.lines).totalHtCents,
      input.validityDays, input.plannedStart, input.estimatedDuration, input.paymentTerms, input.plannedDepositBp, nowIso(c), row.id, userId).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'frozen', 'Ce devis est figé : il ne peut plus être modifié.');
    return respond(c, row.id);
  })

  .delete('/:id', async (c) => {
    const row = await requireQuoteRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare("DELETE FROM quotes WHERE id = ? AND user_id = ? AND status = 'draft'").bind(row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'not_draft', 'Seul un brouillon peut être supprimé.');
    return c.body(null, 204);
  })

  .post('/:id/send', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireQuoteRow(DB, userId, c.req.param('id'));
    if (row.status !== 'draft') throw new HttpError(409, 'not_draft', 'Ce devis a déjà été envoyé.');
    const profile = await requireCompleteProfile(DB, userId);
    if (!row.client_id) throw new HttpError(409, 'client_missing', 'Choisissez un client avant d’envoyer le devis.');
    const problems = lineProblems(JSON.parse(row.lines_json) as Line[]);
    if (problems.filledCount === 0) throw new HttpError(409, 'no_lines', 'Ajoutez au moins une ligne remplie.');
    if (problems.missingDesignation.length > 0) {
      throw new HttpError(409, 'missing_designation', `Chaque ligne chiffrée doit avoir une désignation (ligne ${problems.missingDesignation.join(', ')}).`);
    }
    const today = todayInParis(c.var.deps.now());
    const result = await runIssue(DB, {
      table: 'quotes', docId: row.id, userId, series: 'D', year: yearOf(today), prefix: profile.prefixQuote,
      set: { status: 'sent', quote_date: today, sent_at: nowIso(c), updated_at: nowIso(c) },
    });
    if (!result.issued) throw new HttpError(409, 'not_draft', 'Ce devis a déjà été envoyé.');
    return respond(c, row.id);
  })

  .post('/:id/accept', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireQuoteRow(DB, userId, c.req.param('id'));
    if (row.status !== 'sent') throw notSent();
    const view = await quoteView(DB, userId, row);
    const res = await DB.prepare(
      "UPDATE quotes SET status = 'accepted', accepted_at = ?, snapshot_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'sent'",
    ).bind(nowIso(c), JSON.stringify(view), nowIso(c), row.id, userId).run();
    if (res.meta.changes === 0) throw notSent();
    return respond(c, row.id);
  })

  .post('/:id/refuse', async (c) => {
    const row = await requireQuoteRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare(
      "UPDATE quotes SET status = 'refused', refused_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'sent'",
    ).bind(nowIso(c), nowIso(c), row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notSent();
    return respond(c, row.id);
  })

  .post('/:id/duplicate', async (c) => {
    const row = await requireQuoteRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const lines = (JSON.parse(row.lines_json) as Line[]).map((l) => ({ ...l, id: crypto.randomUUID() }));
    const id = await insertQuote(c, {
      client_id: row.client_id, object: row.object, intervention_address: row.intervention_address,
      lines_json: JSON.stringify(lines), total_ht_cents: row.total_ht_cents, validity_days: row.validity_days,
      planned_start: row.planned_start, estimated_duration: row.estimated_duration, payment_terms: row.payment_terms,
      planned_deposit_bp: row.planned_deposit_bp,
    });
    return respond(c, id, 201);
  });
```

Brancher : `api.route('/quotes', quoteRoutes);`

- [ ] **Étape 6 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat: API des devis (brouillon, envoi numéroté, acceptation figée, refus, duplication)"
```

**Critère de fin :** cycle complet d'un devis par l'API ; numéros D continus ; devis accepté figé et affiché depuis son instantané ; client d'un autre utilisateur refusé.

---

### Tâche 16 : éditeur de devis et liste des devis (interface)

**Fichiers :**
- Créer : `src/web/lines/lineDrafts.ts`, `src/web/lines/LinesEditor.tsx`, `src/web/lines/LinesEditor.css`, `src/web/lines/PresetPickerDialog.tsx`, `src/web/lines/useAutosave.ts`
- Créer : `src/web/quotes/quoteActions.ts`, `src/web/quotes/QuoteForm.tsx`, `src/web/pages/QuoteEditorPage.tsx`, `src/web/pages/QuotesListPage.tsx`, `src/web/components/StatusBadge.tsx`
- Modifier : `src/web/App.tsx`
- Tests : `src/web/lines/lineDrafts.test.ts`, `src/web/lines/LinesEditor.test.tsx`, `src/web/lines/useAutosave.test.tsx`, `src/web/quotes/quoteActions.test.ts`

**Maquette :** `docs/maquettes/Devis.dc.html`.

**Interfaces :**
- Consomme : `Line`, `lineTotalCents`, `computeTotals`, `isBlankLine` ; `parseEuros`, `parseQuantity`, `parsePercent`, `formatEuros`, `formatCentsForInput`, `formatQuantity`, `formatPercent` ; `depositAmountCents` ; `PresetData` ; `QuoteResponse`, `QuoteListItem` ; `QUOTE_STATUS` ; `ClientFormDialog`.
- Produit (`lineDrafts.ts`) : `type DraftLine = { id: string; designation: string; quantity: string; unit: string; unitPrice: string }` ; `draftFromLine(l: Line): DraftLine` ; `blankDraft(unit?): DraftLine` ; `parseDraft(d): { line: Line | null; errors: { quantity?: string; unitPrice?: string } }` ; `draftsToLines(ds): { lines: Line[]; valid: boolean }` ; `liveTotals(ds): Totals` ; `moveDraft(ds, index, delta): DraftLine[]` ; `insertPreset(ds, preset: PresetData): DraftLine[]` ; `presetFromDraft(d): PresetInput | null`.
- Produit : `<LinesEditor drafts onChange units readOnly? onSavePreset? />` ; `useAutosave(value, save, { enabled, delay? }): { state: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; error: Error | null; flush(): Promise<void> }` ; `quoteActions(status): QuoteAction[]` avec `type QuoteAction = 'send' | 'accept' | 'refuse' | 'duplicate' | 'delete'` ; `<StatusBadge tone label />`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/web/lines/lineDrafts.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { blankDraft, draftFromLine, draftsToLines, insertPreset, liveTotals, moveDraft, parseDraft, presetFromDraft } from './lineDrafts';

const d = (designation: string, quantity: string, unitPrice: string) => ({ ...blankDraft(), designation, quantity, unitPrice });

describe('lignes en cours de saisie', () => {
  it('lit les saisies françaises', () => {
    expect(parseDraft(d('Prises', '8', '65')).line).toMatchObject({ quantityMilli: 8000, unitPriceCents: 6500 });
    expect(parseDraft(d('Main-d’œuvre', '2,5', '1 234,50')).line).toMatchObject({ quantityMilli: 2500, unitPriceCents: 123450 });
    expect(parseDraft(d('', '1', '')).line).toMatchObject({ unitPriceCents: 0 });
  });

  it('signale les champs invalides sans perdre la saisie', () => {
    const r = parseDraft(d('X', '1,2345', '12,345'));
    expect(r.line).toBeNull();
    expect(r.errors).toEqual({ quantity: expect.any(String), unitPrice: expect.any(String) });
    expect(draftsToLines([d('A', '1', '10'), d('B', 'x', '1')]).valid).toBe(false);
  });

  it('calcule les totaux en direct en ignorant les lignes vides et invalides', () => {
    expect(liveTotals([d('A', '1', '380'), d('B', '8', '65'), blankDraft(), d('C', 'x', '5')]).totalHtCents).toBe(90000);
  });

  it('reconstruit une saisie depuis une ligne enregistrée', () => {
    expect(draftFromLine({ id: 'l', designation: 'A', quantityMilli: 2500, unit: 'h', unitPriceCents: 4500, vatRate: null }))
      .toEqual({ id: 'l', designation: 'A', quantity: '2,5', unit: 'h', unitPrice: '45,00' });
    expect(draftFromLine({ id: 'v', designation: '', quantityMilli: 1000, unit: 'u', unitPriceCents: 0, vatRate: null }).unitPrice).toBe('');
  });

  it('déplace une ligne vers le haut ou le bas, sans sortir du tableau', () => {
    const ds = [d('A', '1', '1'), d('B', '1', '1'), d('C', '1', '1')];
    expect(moveDraft(ds, 2, -1).map((x) => x.designation)).toEqual(['A', 'C', 'B']);
    expect(moveDraft(ds, 0, -1)).toBe(ds);
  });

  it('insère une ligne type dans la première ligne vide, sinon à la fin', () => {
    const preset = { id: 'p', designation: 'Prise 16 A', unit: 'u', unitPriceCents: 6500, vatRate: null };
    const filled = insertPreset([d('A', '1', '1'), blankDraft(), blankDraft()], preset);
    expect(filled.map((x) => x.designation)).toEqual(['A', 'Prise 16 A', '']);
    expect(filled[1]!.unitPrice).toBe('65,00');
    expect(insertPreset([d('A', '1', '1')], preset)).toHaveLength(2);
  });

  it('prépare une ligne type depuis une ligne remplie', () => {
    expect(presetFromDraft(d('Forfait déplacement', '1', '35'))).toEqual({ designation: 'Forfait déplacement', unit: 'u', unitPriceCents: 3500, vatRate: null });
    expect(presetFromDraft(blankDraft())).toBeNull();
  });
});
```

`src/web/lines/LinesEditor.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { blankDraft, type DraftLine } from './lineDrafts';
import { LinesEditor } from './LinesEditor';

const plain = (s: string | null) => (s ?? '').replace(/[\u202F\u00A0]/g, ' ').replace(/\u2212/g, '-');

function Editor({ initial }: { initial: DraftLine[] }) {
  const [drafts, setDrafts] = useState(initial);
  return <LinesEditor drafts={drafts} onChange={setDrafts} units={['u', 'h', 'forfait']} />;
}

// LinesEditor utilise TanStack Query (lignes types) : il lui faut un QueryClient.
const Harness = ({ initial }: { initial: DraftLine[] }) => (
  <QueryClientProvider client={new QueryClient()}><Editor initial={initial} /></QueryClientProvider>
);

const rows = () => screen.getAllByRole('row').slice(1); // sans l'en-tête

describe('LinesEditor', () => {
  it('affiche 5 lignes vides par défaut et le compteur', () => {
    render(<Harness initial={[1, 2, 3, 4, 5].map(() => blankDraft())} />);
    expect(rows()).toHaveLength(5);
    expect(screen.getByText('5 lignes')).toBeInTheDocument();
  });

  it('calcule le total de la ligne pendant la saisie', async () => {
    render(<Harness initial={[blankDraft()]} />);
    const row = rows()[0]!;
    await userEvent.type(within(row).getByLabelText('Désignation'), 'Prises 16 A');
    await userEvent.clear(within(row).getByLabelText('Quantité'));
    await userEvent.type(within(row).getByLabelText('Quantité'), '8');
    await userEvent.type(within(row).getByLabelText('Prix unitaire HT en euros'), '65');
    expect(plain(within(row).getByTestId('line-total').textContent)).toBe('520,00 €');
  });

  it('ajoute, supprime et réordonne des lignes', async () => {
    render(<Harness initial={[{ ...blankDraft(), designation: 'A' }, { ...blankDraft(), designation: 'B' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
    expect(rows()).toHaveLength(3);
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Descendre la ligne' }));
    expect((within(rows()[0]!).getByLabelText('Désignation') as HTMLInputElement).value).toBe('B');
    await userEvent.click(within(rows()[2]!).getByRole('button', { name: 'Supprimer la ligne' }));
    expect(rows()).toHaveLength(2);
  });

  it('signale un prix invalide', async () => {
    render(<Harness initial={[blankDraft()]} />);
    const price = within(rows()[0]!).getByLabelText('Prix unitaire HT en euros');
    await userEvent.type(price, '12,345');
    expect(price).toHaveAttribute('aria-invalid', 'true');
  });
});
```

`src/web/lines/useAutosave.test.tsx` :

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAutosave', () => {
  it('n’enregistre pas au montage', () => {
    const save = vi.fn(async () => {});
    renderHook(({ v }) => useAutosave(v, save, { enabled: true }), { initialProps: { v: { a: 1 } } });
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it('regroupe les frappes rapprochées en un seul enregistrement de la dernière valeur', async () => {
    const save = vi.fn(async () => {});
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, { enabled: true, delay: 800 }), { initialProps: { v: { a: 1 } } });
    rerender({ v: { a: 2 } });
    vi.advanceTimersByTime(400);
    rerender({ v: { a: 3 } });
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: 3 });
    expect(result.current.state).toBe('saved');
  });

  it('enregistre immédiatement sur flush et passe en erreur si l’envoi échoue', async () => {
    const save = vi.fn(async () => { throw new Error('Réseau'); });
    const { rerender, result } = renderHook(({ v }) => useAutosave(v, save, { enabled: true }), { initialProps: { v: { a: 1 } } });
    rerender({ v: { a: 2 } });
    await act(async () => { await result.current.flush(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('error');
    expect(result.current.error?.message).toBe('Réseau');
  });

  it('n’enregistre pas tant que la saisie est invalide', () => {
    const save = vi.fn(async () => {});
    const { rerender } = renderHook(({ v, ok }) => useAutosave(v, save, { enabled: ok }), { initialProps: { v: { a: 1 }, ok: true } });
    rerender({ v: { a: 2 }, ok: false });
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
  });
});
```

`src/web/quotes/quoteActions.test.ts` :

```ts
import { expect, it } from 'vitest';
import { quoteActions } from './quoteActions';

it('propose les actions permises par le statut', () => {
  expect(quoteActions('draft')).toEqual(['send', 'delete']);
  expect(quoteActions('sent')).toEqual(['accept', 'refuse']);
  expect(quoteActions('accepted')).toEqual(['duplicate']);
  expect(quoteActions('refused')).toEqual(['duplicate']);
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/web/lines src/web/quotes`
Expected: FAIL, modules introuvables.

- [ ] **Étape 3 : écrire `src/web/lines/lineDrafts.ts`**

```ts
import { computeTotals, isBlankLine, type Line, type Totals } from '../../shared/lines';
import { formatCentsForInput, formatQuantity, parseEuros, parseQuantity } from '../../shared/money';
import type { PresetData, PresetInput } from '../../shared/preset';

export type DraftLine = { id: string; designation: string; quantity: string; unit: string; unitPrice: string };
export type DraftErrors = { quantity?: string; unitPrice?: string };

const plain = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ').replace(/\u2212/g, '-');

export function blankDraft(unit = 'u'): DraftLine {
  return { id: crypto.randomUUID(), designation: '', quantity: '1', unit, unitPrice: '' };
}

export function draftFromLine(l: Line): DraftLine {
  return {
    id: l.id,
    designation: l.designation,
    quantity: plain(formatQuantity(l.quantityMilli)),
    unit: l.unit,
    unitPrice: isBlankLine(l) ? '' : formatCentsForInput(l.unitPriceCents),
  };
}

export function parseDraft(d: DraftLine): { line: Line | null; errors: DraftErrors } {
  const quantityMilli = parseQuantity(d.quantity);
  const unitPriceCents = d.unitPrice.trim() === '' ? 0 : parseEuros(d.unitPrice);
  const errors: DraftErrors = {};
  if (quantityMilli === null) errors.quantity = 'Quantité invalide (3 décimales au plus).';
  if (unitPriceCents === null) errors.unitPrice = 'Prix invalide (2 décimales au plus).';
  if (quantityMilli === null || unitPriceCents === null) return { line: null, errors };
  return { line: { id: d.id, designation: d.designation, quantityMilli, unit: d.unit, unitPriceCents, vatRate: null }, errors };
}

export function draftsToLines(ds: DraftLine[]): { lines: Line[]; valid: boolean } {
  const parsed = ds.map(parseDraft);
  return { lines: parsed.flatMap((p) => (p.line ? [p.line] : [])), valid: parsed.every((p) => p.line !== null) };
}

export function liveTotals(ds: DraftLine[]): Totals {
  return computeTotals(draftsToLines(ds).lines);
}

export function moveDraft(ds: DraftLine[], index: number, delta: -1 | 1): DraftLine[] {
  const target = index + delta;
  if (target < 0 || target >= ds.length) return ds;
  const next = [...ds];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function insertPreset(ds: DraftLine[], p: PresetData): DraftLine[] {
  const filled: DraftLine = { id: crypto.randomUUID(), designation: p.designation, quantity: '1', unit: p.unit, unitPrice: formatCentsForInput(p.unitPriceCents) };
  const blank = ds.findIndex((d) => d.designation.trim() === '' && d.unitPrice.trim() === '');
  if (blank === -1) return [...ds, filled];
  return ds.map((d, i) => (i === blank ? filled : d));
}

export function presetFromDraft(d: DraftLine): PresetInput | null {
  const { line } = parseDraft(d);
  if (!line || line.designation.trim() === '') return null;
  return { designation: line.designation.trim(), unit: line.unit, unitPriceCents: line.unitPriceCents, vatRate: null };
}
```

- [ ] **Étape 4 : écrire `src/web/lines/useAutosave.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Enregistre `value` 800 ms après la dernière modification ; `flush` force l'enregistrement. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, { enabled, delay = 800 }: { enabled: boolean; delay?: number }) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const serialized = JSON.stringify(value);
  const lastSaved = useRef(serialized);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, save, enabled });
  latest.current = { value, save, enabled };

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { value: v, save: s, enabled: ok } = latest.current;
    const current = JSON.stringify(v);
    if (!ok || current === lastSaved.current) return;
    setState('saving');
    try {
      await s(v);
      lastSaved.current = current;
      setError(null);
      setState('saved');
    } catch (e) {
      setError(e as Error);
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!enabled || serialized === lastSaved.current) return;
    setState('pending');
    timer.current = setTimeout(() => void flush(), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [serialized, enabled, delay, flush]);

  // Enregistre ce qui reste en attente quand l'utilisateur quitte la page.
  useEffect(() => () => void flush(), [flush]);

  return { state, error, flush };
}
```

- [ ] **Étape 5 : écrire l'éditeur de lignes et la sélection de ligne type**

`src/web/lines/LinesEditor.tsx` (tableau de `Devis.dc.html` : colonnes Désignation, Qté 84 px, Unité 116 px, P.U. HT 130 px, Total HT 120 px, puis boutons ; champs de 44 px ; bouton « Ajouter une ligne » en pointillés ; bouton « Insérer une ligne type ») :

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { lineTotalCents } from '../../shared/lines';
import { formatEuros } from '../../shared/money';
import { api } from '../api';
import { blankDraft, insertPreset, moveDraft, parseDraft, presetFromDraft, type DraftLine } from './lineDrafts';
import { PresetPickerDialog } from './PresetPickerDialog';
import './LinesEditor.css';

type Props = { drafts: DraftLine[]; onChange: (ds: DraftLine[]) => void; units: string[]; readOnly?: boolean };

export function LinesEditor({ drafts, onChange, units, readOnly = false }: Props) {
  const [picking, setPicking] = useState(false);
  const qc = useQueryClient();
  const savePreset = useMutation({
    mutationFn: (d: DraftLine) => api('POST', '/api/presets', presetFromDraft(d)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
  const patch = (i: number, p: Partial<DraftLine>) => onChange(drafts.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const n = drafts.length;

  return (
    <section className="card lines" aria-labelledby="h-lignes">
      <div className="lines-head">
        <h2 id="h-lignes" className="card-title">Prestations</h2>
        <span className="lines-count">{n} {n > 1 ? 'lignes' : 'ligne'}</span>
      </div>
      <div className="lines-scroll">
        <table className="lines-table">
          <thead>
            <tr>
              <th scope="col">Désignation</th><th scope="col" className="w-qty">Qté</th><th scope="col" className="w-unit">Unité</th>
              <th scope="col" className="w-price">P.U. HT</th><th scope="col" className="w-total">Total HT</th>
              <th scope="col" className="w-actions"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => {
              const { line, errors } = parseDraft(d);
              const unitOptions = units.includes(d.unit) ? units : [...units, d.unit];
              return (
                <tr key={d.id}>
                  <td><input className="line-input" aria-label="Désignation" placeholder="Décrivez la prestation" value={d.designation} readOnly={readOnly} onChange={(e) => patch(i, { designation: e.target.value })} /></td>
                  <td><input className="line-input" aria-label="Quantité" inputMode="decimal" aria-invalid={errors.quantity ? true : undefined} title={errors.quantity} value={d.quantity} readOnly={readOnly} onChange={(e) => patch(i, { quantity: e.target.value })} /></td>
                  <td>
                    <select className="line-input" aria-label="Unité" value={d.unit} disabled={readOnly} onChange={(e) => patch(i, { unit: e.target.value })}>
                      {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><input className="line-input" aria-label="Prix unitaire HT en euros" inputMode="decimal" aria-invalid={errors.unitPrice ? true : undefined} title={errors.unitPrice} value={d.unitPrice} readOnly={readOnly} onChange={(e) => patch(i, { unitPrice: e.target.value })} /></td>
                  <td className="line-total" data-testid="line-total">{line ? formatEuros(lineTotalCents(line)) : '—'}</td>
                  <td className="line-actions">
                    {!readOnly && (
                      <>
                        <button type="button" className="icon-btn" aria-label="Monter la ligne" disabled={i === 0} onClick={() => onChange(moveDraft(drafts, i, -1))}>↑</button>
                        <button type="button" className="icon-btn" aria-label="Descendre la ligne" disabled={i === n - 1} onClick={() => onChange(moveDraft(drafts, i, 1))}>↓</button>
                        <button type="button" className="icon-btn" aria-label="Enregistrer comme ligne type" disabled={!presetFromDraft(d)} onClick={() => savePreset.mutate(d)}>☆</button>
                        <button type="button" className="icon-btn" aria-label="Supprimer la ligne" onClick={() => onChange(drafts.filter((_, j) => j !== i))}>×</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="actions">
          <button type="button" className="btn btn-dashed" onClick={() => onChange([...drafts, blankDraft(units[0])])}><span aria-hidden="true">+</span> Ajouter une ligne</button>
          <button type="button" className="btn btn-secondary" style={{ height: 44 }} onClick={() => setPicking(true)}>Insérer une ligne type</button>
          {savePreset.isSuccess && <span className="field-hint" role="status">Ligne type enregistrée.</span>}
        </div>
      )}
      <PresetPickerDialog open={picking} onClose={() => setPicking(false)} onPick={(p) => { onChange(insertPreset(drafts, p)); setPicking(false); }} />
    </section>
  );
}
```

`src/web/lines/LinesEditor.css` :

```css
.lines { display: flex; flex-direction: column; gap: 16px; }
.lines-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.lines-count { font-size: 14px; color: var(--c-text-muted); }
.lines-scroll { overflow-x: auto; }
.lines-table { width: 100%; border-collapse: separate; border-spacing: 0 8px; min-width: 820px; font-size: 15px; }
.lines-table th { text-align: left; font-size: 13px; color: var(--c-text-muted); font-weight: 700; padding: 0 6px; }
.lines-table td { padding: 0 6px; }
.w-qty { width: 84px; } .w-unit { width: 116px; } .w-price { width: 130px; } .w-total { width: 120px; text-align: right; } .w-actions { width: 168px; }
.line-input { width: 100%; height: 44px; border-radius: var(--radius-sm); border: 1px solid var(--c-border-input); padding: 0 10px; font-size: 15px; background: var(--c-surface); }
.line-input[aria-invalid='true'] { border-color: var(--c-danger); background: var(--c-danger-soft); }
.line-total { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.line-actions { display: flex; gap: 2px; }
.icon-btn { width: 40px; height: 44px; border-radius: var(--radius-sm); border: none; background: transparent; color: var(--c-text-muted); cursor: pointer; font-size: 18px; }
.icon-btn:hover:not(:disabled) { background: var(--c-border-soft); }
.icon-btn:disabled { opacity: 0.3; cursor: default; }
```

`src/web/lines/PresetPickerDialog.tsx` :

```tsx
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatEuros } from '../../shared/money';
import type { PresetData } from '../../shared/preset';
import { api } from '../api';
import { Dialog } from '../components/Dialog';

export function PresetPickerDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: PresetData) => void }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['presets'], queryFn: () => api<{ items: PresetData[] }>('GET', '/api/presets'), enabled: open });
  const items = (list.data?.items ?? []).filter((p) => p.designation.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open={open} title="Insérer une ligne type" onClose={onClose}>
      <input className="input" aria-label="Rechercher une ligne type" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.data && list.data.items.length === 0 && <p className="page-intro">Aucune ligne type. Enregistrez-en depuis un devis (☆) ou la page Lignes types.</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => onPick(p)}>
              <span>{p.designation}</span><span>{p.unit} · {formatEuros(p.unitPriceCents)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
```

- [ ] **Étape 6 : écrire les actions, le badge, le formulaire et la page d'édition**

`src/web/quotes/quoteActions.ts` :

```ts
import type { QuoteStatus } from '../../shared/status';

export type QuoteAction = 'send' | 'accept' | 'refuse' | 'duplicate' | 'delete';

export function quoteActions(status: QuoteStatus): QuoteAction[] {
  switch (status) {
    case 'draft': return ['send', 'delete'];
    case 'sent': return ['accept', 'refuse'];
    case 'accepted':
    case 'refused': return ['duplicate'];
  }
}
```

`src/web/components/StatusBadge.tsx` :

```tsx
import type { Tone } from '../../shared/status';

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`badge tone-${tone}`}>{label}</span>;
}
```

`src/web/quotes/QuoteForm.tsx` (formulaire monté une fois les données chargées, pour que l'enregistrement automatique ne parte pas au chargement ; sections « Client », « Prestations », « Modalités » et récapitulatif de `Devis.dc.html`) :

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { QuoteResponse } from '../../shared/api-types';
import type { ClientData } from '../../shared/client';
import { depositAmountCents } from '../../shared/deposits';
import { formatEuros, formatPercent, parsePercent } from '../../shared/money';
import type { QuoteDraftInput } from '../../shared/quote';
import { api } from '../api';
import { ClientFormDialog } from '../components/ClientFormDialog';
import { draftFromLine, draftsToLines, liveTotals, type DraftLine } from '../lines/lineDrafts';
import { LinesEditor } from '../lines/LinesEditor';
import { useAutosave } from '../lines/useAutosave';

type FormState = {
  clientId: string | null; object: string; interventionAddress: string; drafts: DraftLine[];
  validityDays: string; plannedStart: string; estimatedDuration: string; paymentTerms: string; plannedDeposit: string;
};

export function initialForm(r: QuoteResponse): FormState {
  const q = r.quote;
  return {
    clientId: q.clientId, object: q.object, interventionAddress: q.interventionAddress ?? '',
    drafts: q.lines.map(draftFromLine), validityDays: String(q.validityDays), plannedStart: q.plannedStart,
    estimatedDuration: q.estimatedDuration, paymentTerms: q.paymentTerms,
    plannedDeposit: q.plannedDepositBp ? formatPercent(q.plannedDepositBp).replace(/\s?%$/, '').replace(/[\u202F\u00A0]/g, '') : '',
  };
}

export function toPayload(f: FormState): QuoteDraftInput | null {
  const { lines, valid } = draftsToLines(f.drafts);
  const validityDays = Number.parseInt(f.validityDays, 10);
  const plannedDepositBp = f.plannedDeposit.trim() === '' ? null : parsePercent(f.plannedDeposit);
  if (!valid || !Number.isInteger(validityDays) || validityDays < 1 || (f.plannedDeposit.trim() !== '' && plannedDepositBp === null)) return null;
  return {
    clientId: f.clientId, object: f.object, interventionAddress: f.interventionAddress.trim() || null, lines, validityDays,
    plannedStart: f.plannedStart, estimatedDuration: f.estimatedDuration, paymentTerms: f.paymentTerms, plannedDepositBp,
  };
}

export function QuoteForm({ initial, units, templateName, onSaved, children }: {
  initial: QuoteResponse; units: string[]; templateName: string;
  onSaved: (r: QuoteResponse) => void;
  children: (ctx: { flush: () => Promise<void>; saveState: string; payloadValid: boolean }) => ReactNode;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [creatingClient, setCreatingClient] = useState(false);
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<{ items: ClientData[] }>('GET', '/api/clients') });
  const payload = toPayload(form);
  const autosave = useAutosave(payload, async (p) => {
    if (!p) return;
    const r = await api<QuoteResponse>('PUT', `/api/quotes/${initial.quote.id}`, p);
    qc.setQueryData(['quote', initial.quote.id], r);
    onSaved(r);
  }, { enabled: payload !== null });
  const totals = liveTotals(form.drafts);
  const depositBp = parsePercent(form.plannedDeposit);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const saveLabel = { idle: '', pending: 'Modifications en attente…', saving: 'Enregistrement…', saved: 'Enregistré', error: `Échec de l’enregistrement : ${autosave.error?.message ?? ''}` }[autosave.state];

  return (
    <>
      {children({ flush: autosave.flush, saveState: saveLabel, payloadValid: payload !== null })}
      <div className="editor">
        <div className="editor-main">
          <section className="card form-grid" aria-labelledby="h-client" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <h2 id="h-client" className="card-title span-all">Client</h2>
            <label className="field">Client
              <select className="input" value={form.clientId ?? ''} onChange={(e) => e.target.value === '__new__' ? setCreatingClient(true) : set('clientId', e.target.value || null)}>
                <option value="">Choisir un client…</option>
                {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type === 'business' ? 'professionnel' : 'particulier'})</option>)}
                <option value="__new__">+ Nouveau client…</option>
              </select>
            </label>
            <label className="field"><span>Adresse d’intervention <span className="field-hint">si différente de l’adresse de facturation</span></span>
              <input className="input" value={form.interventionAddress} onChange={(e) => set('interventionAddress', e.target.value)} />
            </label>
            <label className="field span-all">Objet
              <input className="input" value={form.object} onChange={(e) => set('object', e.target.value)} />
            </label>
          </section>

          <LinesEditor drafts={form.drafts} onChange={(ds) => set('drafts', ds)} units={units} />

          <section className="card form-grid" aria-labelledby="h-mod" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <h2 id="h-mod" className="card-title span-all">Modalités</h2>
            <label className="field">Validité (jours)<input className="input" inputMode="numeric" value={form.validityDays} onChange={(e) => set('validityDays', e.target.value)} /></label>
            <label className="field">Début prévisionnel<input className="input" value={form.plannedStart} onChange={(e) => set('plannedStart', e.target.value)} /></label>
            <label className="field">Durée estimée<input className="input" value={form.estimatedDuration} onChange={(e) => set('estimatedDuration', e.target.value)} /></label>
            <label className="field">Acompte prévu (%)<input className="input" inputMode="decimal" aria-invalid={form.plannedDeposit !== '' && depositBp === null ? true : undefined} value={form.plannedDeposit} onChange={(e) => set('plannedDeposit', e.target.value)} /></label>
            <label className="field span-all">Conditions de paiement
              <textarea className="input" rows={2} value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} />
            </label>
          </section>
        </div>

        <aside aria-label="Récapitulatif" className="editor-aside">
          <div className="summary">
            <div className="summary-row"><span>Total HT</span><span>{formatEuros(totals.totalHtCents)}</span></div>
            <div className="summary-vat">TVA non applicable, art. 293 B du CGI</div>
            <div className="summary-rule" />
            <div className="summary-due"><span>Total à payer</span><strong>{formatEuros(totals.totalDueCents)}</strong></div>
            {depositBp !== null && (
              <div className="summary-deposit">Acompte prévu ({formatPercent(depositBp)}) : <strong>{formatEuros(depositAmountCents(totals.totalDueCents, { mode: 'percent', basisPoints: depositBp }))}</strong></div>
            )}
          </div>
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Modèle du document</span>
            <span>{templateName}</span>
          </div>
        </aside>
      </div>
      <ClientFormDialog open={creatingClient} onClose={() => setCreatingClient(false)} onSaved={(c) => { set('clientId', c.id); setCreatingClient(false); }} />
    </>
  );
}
```

Ajouter dans `src/web/layout/AppShell.css` (récapitulatif de la maquette : fond `#EBEEFF`, total 38 px) :

```css
.editor { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }
.editor-main { flex: 999 1 600px; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.editor-aside { flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.summary { background: var(--c-primary-soft); border-radius: var(--radius-xl); padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.summary-row { display: flex; justify-content: space-between; font-size: 15px; color: var(--c-text-ink); font-variant-numeric: tabular-nums; }
.summary-vat { font-size: 13px; line-height: 1.5; color: var(--c-text-soft); }
.summary-rule { height: 1px; background: var(--c-primary-line); }
.summary-due { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--c-text-ink); font-weight: 600; }
.summary-due strong { font-family: var(--font-display); font-size: 38px; letter-spacing: -0.02em; color: var(--c-text); font-variant-numeric: tabular-nums; }
.summary-deposit { background: #FFFFFF; border-radius: var(--radius-md); padding: 12px 14px; font-size: 14px; color: var(--c-primary-strong); }
.steps-list { list-style: none; margin: 0; padding: 20px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-xl); display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.steps-list li { display: flex; gap: 10px; align-items: center; color: var(--c-text-muted); }
.steps-list li.done, .steps-list li.current { color: var(--c-text); font-weight: 700; }
.step-dot { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--c-placeholder); display: flex; align-items: center; justify-content: center; font-size: 12px; }
.steps-list li.current .step-dot, .steps-list li.done .step-dot { background: var(--c-primary); border-color: var(--c-primary); color: #FFFFFF; }
```

`src/web/pages/QuoteEditorPage.tsx` (en-tête : titre « Nouveau devis » ou numéro, badge de statut ; pour un brouillon « Brouillon · numéro attribué à l’envoi » ; état de l'enregistrement ; boutons d'action selon `quoteActions` ; erreurs d'API affichées en `.notice-error` ; étapes Brouillon → Envoyé → Accepté) :

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import type { QuoteResponse } from '../../shared/api-types';
import { DEFAULT_UNITS } from '../../shared/profile';
import { QUOTE_STATUS } from '../../shared/status';
import { getTemplate } from '../../templates/registry';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { draftFromLine } from '../lines/lineDrafts';
import { LinesEditor } from '../lines/LinesEditor';
import { useProfile } from '../profile/useProfile';
import { QuoteForm } from '../quotes/QuoteForm';
import { quoteActions, type QuoteAction } from '../quotes/quoteActions';

const STEP_INDEX = { draft: 0, sent: 1, accepted: 2, refused: 2 } as const;

export function QuoteEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const quote = useQuery({ queryKey: ['quote', id], queryFn: () => api<QuoteResponse>('GET', `/api/quotes/${id}`) });
  const profile = useProfile().data?.profile;
  const units = profile?.units ?? DEFAULT_UNITS;

  const act = useMutation({
    mutationFn: async ({ action, flush }: { action: QuoteAction; flush?: () => Promise<void> }) => {
      if (flush) await flush();
      if (action === 'delete') return api<void>('DELETE', `/api/quotes/${id}`);
      return api<QuoteResponse>('POST', `/api/quotes/${id}/${action}`);
    },
    onSuccess: (r, { action }) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      if (action === 'delete') return navigate('/devis');
      if (action === 'duplicate' && r) return navigate(`/devis/${(r as QuoteResponse).quote.id}`);
      if (r) qc.setQueryData(['quote', id], r);
    },
  });

  if (quote.isPending) return <p className="page-intro">Chargement…</p>;
  if (quote.error) return <p className="notice notice-error" role="alert">{quote.error.message}</p>;
  const { quote: q, view } = quote.data;
  const status = QUOTE_STATUS[q.status];
  const editable = q.status === 'draft' || q.status === 'sent';
  const templateName = getTemplate(view.templateRef).meta.name;

  const header = (flush?: () => Promise<void>, saveState = '') => (
    <div className="page-head" style={{ alignItems: 'center' }}>
      <div className="actions" style={{ alignItems: 'center' }}>
        <h1 className="page-title" style={{ fontSize: 32 }}>{q.number ?? 'Nouveau devis'}</h1>
        <StatusBadge tone={status.tone} label={q.status === 'draft' ? 'Brouillon · numéro attribué à l’envoi' : status.label} />
        {saveState && <span className="field-hint" role="status">{saveState}</span>}
      </div>
      <div className="actions">
        {quoteActions(q.status).map((a) => {
          const labels: Record<QuoteAction, string> = { send: 'Marquer comme envoyé', accept: 'Marquer comme accepté', refuse: 'Marquer comme refusé', duplicate: 'Dupliquer', delete: 'Supprimer le brouillon' };
          const confirmText: Partial<Record<QuoteAction, string>> = { accept: 'Le contenu du devis sera figé. Continuer ?', refuse: 'Le devis sera figé comme refusé. Continuer ?', delete: 'Supprimer ce brouillon ?' };
          const primary = a === 'send' || a === 'accept';
          return (
            <button key={a} type="button" className={primary ? 'btn btn-primary' : a === 'delete' ? 'btn btn-danger' : 'btn btn-secondary'} disabled={act.isPending}
              onClick={() => (!confirmText[a] || window.confirm(confirmText[a])) && act.mutate({ action: a, flush })}>
              {labels[a]}
            </button>
          );
        })}
      </div>
    </div>
  );

  const steps = (
    <ol aria-label="Étapes du devis" className="steps-list">
      {['Brouillon', 'Envoyé', q.status === 'refused' ? 'Refusé' : 'Accepté → acomptes et facture'].map((label, i) => (
        <li key={label} className={i < STEP_INDEX[q.status] ? 'done' : i === STEP_INDEX[q.status] ? 'current' : ''}>
          <span className="step-dot">{i + 1}</span>{label}
        </li>
      ))}
    </ol>
  );

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      {act.error && <p className="notice notice-error" role="alert">{act.error.message}</p>}
      {editable ? (
        <QuoteForm key={q.id} initial={quote.data} units={units} templateName={templateName} onSaved={() => qc.invalidateQueries({ queryKey: ['quotes'] })}>
          {({ flush, saveState }) => header(flush, saveState)}
        </QuoteForm>
      ) : (
        <>
          {header()}
          <p className="notice">Le contenu de ce devis est figé depuis son {q.status === 'accepted' ? 'acceptation' : 'refus'}.</p>
          <LinesEditor drafts={view.lines.map(draftFromLine)} onChange={() => {}} units={units} readOnly />
        </>
      )}
      {steps}
    </div>
  );
}
```

- [ ] **Étape 7 : écrire la liste des devis**

`src/web/pages/QuotesListPage.tsx` : titre « Devis », filtres en pastilles (Tous, Brouillons, Envoyés, Acceptés, Refusés) au style des filtres de `Dashboard.dc.html`, bouton « Nouveau devis » (POST puis navigation), tableau (Numéro + « Devis (brouillon) » quand il n'y a pas de numéro, Client, Objet, Date `formatDateShort`, Montant `formatEuros`, Statut `StatusBadge`) ; un clic sur une ligne ouvre `/devis/:id`.

```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { QuoteListItem, QuoteResponse } from '../../shared/api-types';
import { formatDateShort } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { QUOTE_STATUS, type QuoteStatus } from '../../shared/status';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

const FILTERS: { key: QuoteStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' }, { key: 'draft', label: 'Brouillons' }, { key: 'sent', label: 'Envoyés' },
  { key: 'accepted', label: 'Acceptés' }, { key: 'refused', label: 'Refusés' },
];

export function QuotesListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<QuoteStatus | 'all'>('all');
  const list = useQuery({
    queryKey: ['quotes', filter],
    queryFn: () => api<{ items: QuoteListItem[] }>('GET', filter === 'all' ? '/api/quotes' : `/api/quotes?status=${filter}`),
  });
  const create = useMutation({
    mutationFn: () => api<QuoteResponse>('POST', '/api/quotes', {}),
    onSuccess: (r) => navigate(`/devis/${r.quote.id}`),
  });
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Devis</h1>
        <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>+ Nouveau devis</button>
      </div>
      {create.error && <p className="notice notice-error" role="alert">{create.error.message}</p>}
      <div role="group" aria-label="Filtrer" className="filters">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={f.key === filter ? 'chip chip--on' : 'chip'} aria-pressed={f.key === filter} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Numéro</th><th scope="col">Client</th><th scope="col">Objet</th><th scope="col">Date</th><th scope="col" className="num">Montant</th><th scope="col">Statut</th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--c-text-muted)' }}>Aucun devis.</td></tr>}
            {list.data?.items.map((q) => (
              <tr key={q.id} className="row-link" onClick={() => navigate(`/devis/${q.id}`)}>
                <td><strong>{q.number ?? '—'}</strong>{!q.number && <div className="field-hint" style={{ fontSize: 13 }}>Devis (brouillon)</div>}</td>
                <td>{q.clientName ?? '—'}</td>
                <td>{q.object || '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{q.quoteDate ? formatDateShort(q.quoteDate) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{formatEuros(q.totalHtCents)}</td>
                <td><StatusBadge {...QUOTE_STATUS[q.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Ajouter dans `base.css` :

```css
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--c-border-input); background: var(--c-surface); color: var(--c-text); font-family: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
.chip--on { border-color: var(--c-primary-line); background: var(--c-primary-soft); color: var(--c-primary-strong); }
.row-link { cursor: pointer; }
.row-link:hover td { background: var(--c-bg); }
```

Routes dans la coquille : `<Route path="devis" element={<QuotesListPage />} />` et `<Route path="devis/:id" element={<QuoteEditorPage />} />`.

- [ ] **Étape 8 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 9 : vérifier à la main**

`npm run dev` : « Nouveau devis » → 5 lignes vides ; saisir les 5 lignes de la maquette → total 2 920,00 € et acompte prévu 30 % = 876,00 € ; recharger la page : tout est conservé ; créer un client à la volée ; insérer une ligne type ; « Marquer comme envoyé » → numéro D-2026-001 ; « Marquer comme accepté » → contenu figé. Comparer à `Devis.dc.html`.

- [ ] **Étape 10 : commit**

```bash
git add -A
git commit -m "feat: éditeur de devis (lignes, enregistrement automatique, statuts) et liste des devis"
```

**Critère de fin :** un devis se rédige de bout en bout dans l'interface ; 5 lignes vides au départ, ajout, suppression, réordonnancement, insertion et enregistrement de lignes types ; totaux en direct ; actions conformes au statut.

---

### Tâche 17 : rendu des documents, 3 modèles v1 et impression

**Fichiers :**
- Créer : `src/web/document/DocumentRenderer.tsx`, `src/web/document/document.css`, `src/web/document/printTitle.ts`, `src/web/pages/PrintPage.tsx`, `src/web/components/DocumentToolbar.tsx`
- Modifier : `src/templates/modele-01/v1/style.css`, `src/templates/modele-02/v1/style.css`, `src/templates/modele-03/v1/style.css`, `src/web/document/useTemplateFonts.ts`, `src/web/pages/QuoteEditorPage.tsx`, `src/web/quotes/QuoteForm.tsx`, `src/web/App.tsx`
- Tests : `src/web/document/DocumentRenderer.test.tsx`, `src/web/document/printTitle.test.ts`, `src/web/pages/PrintPage.test.tsx`

**Maquettes :** `docs/maquettes/Modele1.dc.html` (Intemporel), `Modele2.dc.html` (Discret), `Modele3.dc.html` (Raffiné).

**Interfaces :**
- Consomme : `DocumentView`, `buildDocumentView`, `buildCreditView` (tâche 14) ; `getTemplate` (tâche 7) ; formats (tâche 3).
- Produit : `<DocumentRenderer view template />` (balisage commun : classes `doc`, `doc-header`, `doc-brand`, `doc-logo`, `doc-initials`, `doc-brand-bar`, `doc-trade-name`, `doc-activity`, `doc-heading`, `doc-title`, `doc-meta`, `doc-number`, `doc-date`, `doc-rule`, `doc-parties`, `doc-party`, `doc-party-name`, `doc-label`, `doc-reference`, `doc-object`, `doc-object-text`, `doc-lines`, `doc-totals`, `doc-total-row`, `doc-deduction`, `doc-vat`, `doc-total-due`, `doc-footer-blocks`, `doc-terms`, `doc-insurance`, `doc-approval`, `doc-signature`, `doc-thanks`) ; `printTitle(view): string` ; route `/imprimer/:type/:id` (`type` = `devis` ou `factures`, `?auto=1` lance l'impression) ; `<DocumentToolbar printPath />`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`src/web/document/printTitle.test.ts` :

```ts
import { expect, it } from 'vitest';
import { buildDocumentView } from '../../shared/document';
import { CLIENT_BUSINESS_DATA, MOCKUP_LINES, PROFILE_DATA } from '../../shared/test-fixtures';
import { printTitle } from './printTitle';

const view = (number: string | null) => buildDocumentView({
  kind: 'standalone', number, date: '2026-11-03', templateRef: 'modele-01@1', profile: PROFILE_DATA,
  client: CLIENT_BUSINESS_DATA, object: '', interventionAddress: null, lines: MOCKUP_LINES,
});

it('nomme le fichier d’après le numéro et le client', () => {
  expect(printTitle(view('F-2026-004'))).toBe('F-2026-004 – SCI Les Tilleuls');
  expect(printTitle(view(null))).toBe('Facture (brouillon) – SCI Les Tilleuls');
});
```

`src/web/document/DocumentRenderer.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildCreditView, buildDocumentView, type BuildViewInput } from '../../shared/document';
import { CLIENT_BUSINESS_DATA, CLIENT_INDIVIDUAL_DATA, MOCKUP_LINES, PROFILE_DATA } from '../../shared/test-fixtures';
import { getTemplate } from '../../templates/registry';
import { DocumentRenderer } from './DocumentRenderer';

const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u202F\u00A0]/g, ' ').replace(/\u2212/g, '-');
const text = () => plain(document.body.textContent);

const quote = (templateRef = 'modele-01@1', number: string | null = 'D-2026-016') => buildDocumentView({
  kind: 'quote', number, date: number ? '2026-10-31' : null, templateRef, profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA,
  object: 'Rénovation électrique du rez-de-chaussée', interventionAddress: '12 rue des Tilleuls, 44000 Nantes', lines: MOCKUP_LINES,
  quoteTerms: { validityDays: 30, plannedStart: 'Semaine du 23 novembre', estimatedDuration: '4 jours', paymentTerms: 'Acompte de 30 % à la signature', plannedDepositBp: 3000 },
});

const invoice = (o: Partial<BuildViewInput> = {}) => buildDocumentView({
  kind: 'standalone', number: 'F-2026-025', date: '2026-10-15', templateRef: 'modele-01@1', profile: PROFILE_DATA,
  client: CLIENT_BUSINESS_DATA, object: 'Dépannage', interventionAddress: null, lines: MOCKUP_LINES,
  invoiceDates: { serviceDate: '2026-10-14', dueDate: '2026-11-14', notes: '' }, ...o,
});

const show = (view: ReturnType<typeof quote>) => render(<DocumentRenderer view={view} template={getTemplate(view.templateRef)} />);

describe('DocumentRenderer', () => {
  it('rend un devis complet', () => {
    show(quote());
    expect(screen.getByRole('heading', { level: 1, name: 'Devis' })).toBeInTheDocument();
    for (const t of ['N° D-2026-016', '31 octobre 2026', 'Karim Benali EI', 'SIRET 912 345 678 00019', 'SIREN 801 222 333',
      'Intervention : 12 rue des Tilleuls, 44000 Nantes', 'TVA non applicable, art. 293 B du CGI', 'Validité du devis : 30 jours',
      'Bon pour accord', 'Nom et signature du client :', 'Assurance professionnelle MAAF Pro n° DEC-4471209, France métropolitaine']) {
      expect(text()).toContain(t);
    }
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect(text().match(/2 920,00 €/g)).toHaveLength(2);
  });

  it('applique la classe et les libellés du modèle', () => {
    const { container } = show(quote('modele-02@1'));
    expect(container.querySelector('.doc.tpl-modele-02-v1')).not.toBeNull();
    const labels = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(labels).toEqual(['De', 'Pour', 'Modalités', 'Bon pour accord']);
    expect(text()).not.toContain('Merci de votre confiance');
  });

  it('remercie seulement dans le modèle Raffiné', () => {
    show(quote('modele-03@1'));
    expect(text()).toContain('Merci de votre confiance');
  });

  it('indique un brouillon sans numéro ni date', () => {
    show(quote('modele-01@1', null));
    expect(text()).toContain('Brouillon');
    expect(text()).not.toContain('N° ');
  });

  it('porte les mentions de facture, dont les 40 € pour un professionnel seulement', () => {
    const { unmount } = show(invoice());
    for (const t of ['Date de la prestation : 14 octobre 2026', 'Échéance : 14 novembre 2026', 'Pas d’escompte pour paiement anticipé.', 'Indemnité forfaitaire pour frais de recouvrement', 'pénalités au taux']) {
      expect(text()).toContain(t);
    }
    expect(text()).not.toContain('Bon pour accord');
    unmount();
    show(invoice({ client: CLIENT_INDIVIDUAL_DATA }));
    expect(text()).not.toContain('Indemnité forfaitaire');
  });

  it('liste les acomptes déduits sur une facture de solde', () => {
    show(invoice({
      kind: 'final', number: 'F-2026-027', quoteRef: { number: 'D-2026-015', date: '2026-10-20' },
      deductedDeposits: [{ invoiceId: 'i1', number: 'F-2026-026', issueDate: '2026-10-28', amountCents: 87600 }],
    }));
    expect(screen.getByRole('heading', { level: 1, name: 'Facture de solde' })).toBeInTheDocument();
    expect(text()).toContain('Devis n° D-2026-015 du 20 octobre 2026');
    expect(text()).toContain('Acompte F-2026-026 du 28 oct. 2026');
    expect(text()).toContain('-876,00 €');
    expect(text()).toContain('Reste à payer');
    expect(text()).toContain('2 044,00 €');
  });

  it('rend un avoir avec la facture annulée et des montants négatifs', () => {
    const original = { ...invoice(), number: 'F-2026-025' };
    show({ ...buildCreditView(original, { date: '2026-11-03', templateRef: 'modele-01@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, creditedRef: { number: 'F-2026-025', date: '2026-10-15' } }), number: 'A-2026-001' });
    expect(screen.getByRole('heading', { level: 1, name: 'Avoir' })).toBeInTheDocument();
    expect(text()).toContain('Annule la facture n° F-2026-025 du 15 octobre 2026');
    expect(text()).toContain('Montant de l’avoir');
    expect(text()).toContain('-2 920,00 €');
  });
});
```

`src/web/pages/PrintPage.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { buildDocumentView } from '../../shared/document';
import { CLIENT_BUSINESS_DATA, MOCKUP_LINES, PROFILE_DATA } from '../../shared/test-fixtures';
import { PrintPage } from './PrintPage';

afterEach(() => vi.unstubAllGlobals());

it('fixe le titre puis lance l’impression une fois les polices prêtes', async () => {
  const view = buildDocumentView({ kind: 'quote', number: 'D-2026-016', date: '2026-10-31', templateRef: 'modele-02@1', profile: PROFILE_DATA, client: CLIENT_BUSINESS_DATA, object: '', interventionAddress: null, lines: MOCKUP_LINES, quoteTerms: { validityDays: 30, plannedStart: '', estimatedDuration: '', paymentTerms: '', plannedDepositBp: null } });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ view })));
  const print = vi.fn();
  vi.stubGlobal('print', print);
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/imprimer/devis/q1?auto=1']}>
        <Routes><Route path="/imprimer/:type/:id" element={<PrintPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Devis' })).toBeInTheDocument();
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(document.title).toBe('D-2026-016 – SCI Les Tilleuls');
  expect(screen.getByText(/Enregistrer au format PDF/)).toBeInTheDocument();
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- src/web/document src/web/pages/PrintPage`
Expected: FAIL.

- [ ] **Étape 3 : écrire `printTitle.ts` et le composant de rendu**

`src/web/document/printTitle.ts` :

```ts
import type { DocumentView } from '../../shared/document';

export function printTitle(view: DocumentView): string {
  return `${view.number ?? `${view.title} (brouillon)`} – ${view.client?.name ?? 'sans client'}`;
}
```

`src/web/document/DocumentRenderer.tsx` :

```tsx
import { formatDateLong, formatDateShort } from '../../shared/dates';
import type { DocumentView } from '../../shared/document';
import { lineTotalCents } from '../../shared/lines';
import { formatEuros, formatQuantity } from '../../shared/money';
import type { TemplateModule } from '../../templates/types';
import './document.css';

const groupSiret = (s: string) => s.replace(/^(\d{3})(\d{3})(\d{3})(\d*)$/, '$1 $2 $3 $4').trim();
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export function DocumentRenderer({ view, template }: { view: DocumentView; template: TemplateModule }) {
  const { company, client, labels } = { ...view, labels: template.labels };
  const qt = view.quoteTerms;
  const it = view.invoiceTerms;
  return (
    <article className={`doc ${template.className} doc--${view.kind}`} lang="fr">
      <header className="doc-header">
        <div className="doc-brand">
          {company.logoDataUrl
            ? <img className="doc-logo" src={company.logoDataUrl} alt="" />
            : <span className="doc-initials" aria-hidden="true">{initialsOf(company.tradeName || company.legalName)}</span>}
          <div className="doc-brand-text">
            <span className="doc-brand-bar" aria-hidden="true" />
            <p className="doc-trade-name">{company.tradeName || company.legalName}</p>
            {company.activityLine && <p className="doc-activity">{company.activityLine}</p>}
          </div>
        </div>
        <div className="doc-heading">
          <h1 className="doc-title">{view.title}</h1>
          <p className="doc-meta">
            <span className="doc-number">{view.number ? `N° ${view.number}` : 'Brouillon'}</span>
            {view.date && <span className="doc-date">{formatDateLong(view.date)}</span>}
          </p>
        </div>
      </header>
      <div className="doc-rule" aria-hidden="true" />

      <section className="doc-parties">
        <div className="doc-party">
          <h2 className="doc-label">{labels.company}</h2>
          <p className="doc-party-name">{company.legalName}</p>
          <p>{company.street}</p>
          <p>{company.postalCode} {company.city}</p>
          <p>SIRET {groupSiret(company.siret)}</p>
          {(company.phone || company.email) && <p>{[company.phone, company.email].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="doc-party">
          <h2 className="doc-label">{labels.client}</h2>
          {client ? (
            <>
              <p className="doc-party-name">{client.name}</p>
              {client.street && <p>{client.street}</p>}
              {(client.postalCode || client.city) && <p>{client.postalCode} {client.city}</p>}
              {client.type === 'business' && client.siren && <p>{client.siren.length === 14 ? 'SIRET' : 'SIREN'} {groupSiret(client.siren)}</p>}
            </>
          ) : <p className="doc-missing">Client à choisir</p>}
          {view.interventionAddress && <p>Intervention : {view.interventionAddress}</p>}
        </div>
      </section>

      {view.references.quote && <p className="doc-reference">Devis n° {view.references.quote.number} du {formatDateLong(view.references.quote.date)}</p>}
      {view.references.creditedInvoice && <p className="doc-reference">Annule la facture n° {view.references.creditedInvoice.number} du {formatDateLong(view.references.creditedInvoice.date)}</p>}

      {view.object && (
        <div className="doc-object"><span className="doc-label">{labels.object}</span><span className="doc-object-text">{view.object}</span></div>
      )}

      <table className="doc-lines">
        <thead>
          <tr>
            <th scope="col" className="col-designation">Désignation</th>
            <th scope="col" className="col-qty">Qté</th>
            <th scope="col" className="col-unit">Unité</th>
            <th scope="col" className="col-price">P.U. HT</th>
            <th scope="col" className="col-total">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.id}>
              <td className="col-designation">{l.designation}</td>
              <td className="col-qty">{formatQuantity(l.quantityMilli)}</td>
              <td className="col-unit">{l.unit}</td>
              <td className="col-price">{formatEuros(l.unitPriceCents)}</td>
              <td className="col-total">{formatEuros(lineTotalCents(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="doc-totals">
        <div className="doc-total-row"><span>Total HT</span><span>{formatEuros(view.totals.totalHtCents)}</span></div>
        <p className="doc-vat">{view.vatMention}</p>
        {view.deductions?.deposits.map((d) => (
          <div key={d.invoiceId} className="doc-total-row doc-deduction">
            <span>Acompte {d.number} du {formatDateShort(d.issueDate)}</span>
            <span>{formatEuros(view.kind === 'credit' ? d.amountCents : -d.amountCents)}</span>
          </div>
        ))}
        <div className="doc-total-due"><span>{view.dueLabel}</span><span>{formatEuros(view.totals.totalDueCents)}</span></div>
      </section>

      <section className="doc-footer-blocks">
        <div className="doc-terms">
          <h2 className="doc-label">{labels.terms}</h2>
          {qt && (
            <>
              <p>Validité du devis : {qt.validityDays} jours</p>
              {qt.plannedStart && <p>Début prévisionnel : {qt.plannedStart}</p>}
              {qt.estimatedDuration && <p>Durée estimée : {qt.estimatedDuration}</p>}
              {qt.paymentTerms && <p>Paiement : {qt.paymentTerms}</p>}
            </>
          )}
          {it && (
            <>
              <p>Date de la prestation : {it.serviceDate ? formatDateLong(it.serviceDate) : 'date d’émission'}</p>
              <p>Échéance : {it.dueDate ? formatDateLong(it.dueDate) : 'fixée à l’émission'}</p>
              {it.paymentDetails && <p>Règlement : {it.paymentDetails}</p>}
              <p>{it.latePenaltyText}</p>
              {it.recoveryIndemnity && <p>{it.recoveryIndemnity}</p>}
              <p>{it.discount}</p>
              {it.notes && <p>{it.notes}</p>}
            </>
          )}
          {company.insurance && (
            <p className="doc-insurance">
              Assurance professionnelle {company.insurance.insurer} n° {company.insurance.policy}{company.insurance.area ? `, ${company.insurance.area}` : ''}
            </p>
          )}
        </div>
        {view.kind === 'quote' && (
          <div className="doc-approval">
            <h2 className="doc-label">{labels.approval}</h2>
            <p>Date :</p>
            <p>Nom et signature du client :</p>
            <div className="doc-signature" />
          </div>
        )}
      </section>
      {labels.thanks && <p className="doc-thanks">{labels.thanks}</p>}
    </article>
  );
}
```

- [ ] **Étape 4 : écrire la feuille commune `document.css` (structure, feuille A4 à l'écran, impression)**

```css
.doc { box-sizing: border-box; display: flex; flex-direction: column; gap: 22px; font-size: 15px; padding: 13mm 14mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc p, .doc h1, .doc h2 { margin: 0; }
.doc h2 { font-size: inherit; }
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.doc-brand { display: flex; align-items: center; gap: 14px; }
.doc-logo { max-height: 64px; max-width: 160px; object-fit: contain; }
.doc-initials, .doc-brand-bar { display: none; }
.doc-brand-text { display: flex; flex-direction: column; gap: 6px; }
.doc-heading { text-align: right; display: flex; flex-direction: column; gap: 4px; }
.doc-meta { display: flex; flex-direction: column; gap: 4px; }
.doc-parties { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; line-height: 1.55; }
.doc-party { display: flex; flex-direction: column; gap: 3px; }
.doc-party-name { font-weight: 700; }
.doc-missing { color: #A12A1E; }
.doc-lines { width: 100%; border-collapse: collapse; }
.doc-lines thead { display: table-header-group; }   /* en-tête répété sur chaque page */
.doc-lines tr { break-inside: avoid; page-break-inside: avoid; }  /* une ligne n'est jamais coupée */
.doc-lines th, .doc-lines td { padding: 11px 8px; vertical-align: top; }
.doc-lines tbody { font-variant-numeric: tabular-nums; }
.doc-lines .col-designation { text-align: left; }
.doc-lines .col-qty { text-align: right; width: 48px; }
.doc-lines .col-unit { text-align: left; width: 70px; }
.doc-lines .col-price { text-align: right; width: 92px; white-space: nowrap; }
.doc-lines .col-total { text-align: right; width: 104px; white-space: nowrap; }
.doc-totals { align-self: flex-end; width: 330px; display: flex; flex-direction: column; gap: 8px; font-variant-numeric: tabular-nums; break-inside: avoid; page-break-inside: avoid; }
.doc-total-row, .doc-total-due { display: flex; justify-content: space-between; gap: 12px; }
.doc-vat { font-size: 12px; }
.doc-reference { font-size: 13px; }
.doc-footer-blocks { margin-top: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; line-height: 1.6; font-size: 13px; break-inside: avoid; page-break-inside: avoid; }
.doc-terms, .doc-approval { display: flex; flex-direction: column; gap: 3px; }
.doc-signature { height: 70px; margin-top: 6px; }
.doc-thanks { text-align: center; }

/* Feuille A4 à l'écran */
.doc-sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #FFFFFF; box-shadow: 0 6px 24px rgba(20, 22, 31, 0.12); display: flex; }
.doc-sheet > .doc { flex: 1; }
.print-page { min-height: 100vh; background: var(--c-bg); padding: 24px 16px 48px; }
.print-toolbar { max-width: 210mm; margin: 0 auto 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.print-help { margin: 0; font-size: 13px; color: var(--c-text-muted); max-width: 420px; }

@page { size: A4; margin: 12mm 14mm; }
@media print {
  body, .print-page { background: #FFFFFF; padding: 0; }
  .no-print { display: none !important; }
  .doc-sheet { width: auto; min-height: 0; box-shadow: none; display: block; }
  .doc { padding: 0; }
  .doc-footer-blocks { margin-top: 28px; }
}
```

- [ ] **Étape 5 : écrire le style des trois modèles (à la suite des styles de vignette existants)**

Ajouter à `src/templates/modele-01/v1/style.css` (Intemporel, d'après `Modele1.dc.html`) :

```css
.tpl-modele-01-v1 { font-family: Manrope, sans-serif; color: #111111; background: #FFFFFF; }
.tpl-modele-01-v1 .doc-brand-bar { display: block; width: 56px; height: 8px; background: #111111; }
.tpl-modele-01-v1 .doc-trade-name { font-family: Archivo, sans-serif; font-weight: 800; font-size: 24px; letter-spacing: -0.01em; text-transform: uppercase; }
.tpl-modele-01-v1 .doc-activity { font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #555555; }
.tpl-modele-01-v1 .doc-title { font-family: Archivo, sans-serif; font-weight: 800; font-size: 46px; line-height: 0.9; letter-spacing: -0.02em; text-transform: uppercase; }
.tpl-modele-01-v1 .doc-number { font-weight: 700; }
.tpl-modele-01-v1 .doc-date { color: #555555; }
.tpl-modele-01-v1 .doc-rule { height: 2px; background: #111111; }
.tpl-modele-01-v1 .doc-label { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #555555; }
.tpl-modele-01-v1 .doc-object { background: #F2F2F2; padding: 12px 16px; display: flex; gap: 12px; }
.tpl-modele-01-v1 .doc-object .doc-label { padding-top: 3px; }
.tpl-modele-01-v1 .doc-object-text { font-weight: 600; }
.tpl-modele-01-v1 .doc-lines thead tr { background: #F1F2F4; border-bottom: 1.5px solid #111111; }
.tpl-modele-01-v1 .doc-lines th { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 8px; }
.tpl-modele-01-v1 .doc-lines tbody tr { border-bottom: 1px solid #DDDDDD; }
.tpl-modele-01-v1 .doc-vat, .tpl-modele-01-v1 .doc-reference, .tpl-modele-01-v1 .doc-insurance { color: #555555; }
.tpl-modele-01-v1 .doc-total-row span:last-child { font-weight: 700; }
.tpl-modele-01-v1 .doc-total-due { align-items: center; border-top: 1.5px solid #111111; border-bottom: 1.5px solid #111111; padding: 12px 4px; font-family: Archivo, sans-serif; font-weight: 800; }
.tpl-modele-01-v1 .doc-total-due span:first-child { letter-spacing: 0.06em; text-transform: uppercase; }
.tpl-modele-01-v1 .doc-total-due span:last-child { font-size: 20px; }
.tpl-modele-01-v1 .doc-terms, .tpl-modele-01-v1 .doc-approval { border-top: 2px solid #111111; padding-top: 10px; }
.tpl-modele-01-v1 .doc-footer-blocks .doc-label { color: #111111; }
.tpl-modele-01-v1 .doc-signature { border: 1px solid #BBBBBB; }
```

Ajouter à `src/templates/modele-02/v1/style.css` (Discret, d'après `Modele2.dc.html`) :

```css
.tpl-modele-02-v1 { font-family: 'DM Sans', sans-serif; color: #26302B; background: #FFFFFF; }
.tpl-modele-02-v1 .doc-header { align-items: center; }
.tpl-modele-02-v1 .doc-initials { display: flex; width: 48px; height: 48px; border-radius: 14px; background: #DCE7E1; color: #3F5A4D; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; }
.tpl-modele-02-v1 .doc-brand-text { gap: 2px; }
.tpl-modele-02-v1 .doc-trade-name { font-weight: 700; font-size: 21px; }
.tpl-modele-02-v1 .doc-activity { font-size: 13px; color: #5E6B64; }
.tpl-modele-02-v1 .doc-heading { gap: 2px; }
.tpl-modele-02-v1 .doc-title { font-weight: 700; font-size: 30px; color: #3F5A4D; }
.tpl-modele-02-v1 .doc-meta { flex-direction: row; justify-content: flex-end; gap: 0; font-size: 14px; color: #5E6B64; }
.tpl-modele-02-v1 .doc-meta .doc-date::before { content: ' · '; white-space: pre; }
.tpl-modele-02-v1 .doc-rule { display: none; }
.tpl-modele-02-v1 .doc-parties { gap: 16px; }
.tpl-modele-02-v1 .doc-party { background: #F3F7F5; border-radius: 14px; padding: 16px 18px; }
.tpl-modele-02-v1 .doc-label { font-size: 12px; font-weight: 700; color: #3F5A4D; }
.tpl-modele-02-v1 .doc-object { display: flex; flex-direction: column; gap: 4px; }
.tpl-modele-02-v1 .doc-object-text { font-size: 17px; font-weight: 500; }
.tpl-modele-02-v1 .doc-lines th { font-size: 12px; font-weight: 700; color: #3F5A4D; background: #DCE7E1; padding: 10px 8px; }
.tpl-modele-02-v1 .doc-lines th:first-child { border-radius: 10px 0 0 10px; }
.tpl-modele-02-v1 .doc-lines th:last-child { border-radius: 0 10px 10px 0; }
.tpl-modele-02-v1 .doc-lines tbody tr:nth-child(even) { background: #F7FAF8; }
.tpl-modele-02-v1 .doc-totals { width: 320px; background: #F3F7F5; border-radius: 14px; padding: 16px 18px; }
.tpl-modele-02-v1 .doc-vat, .tpl-modele-02-v1 .doc-reference, .tpl-modele-02-v1 .doc-insurance { color: #5E6B64; }
.tpl-modele-02-v1 .doc-total-row span:last-child { font-weight: 700; }
.tpl-modele-02-v1 .doc-total-due { align-items: baseline; border-top: 1px solid #DCE7E1; padding-top: 8px; font-weight: 700; color: #3F5A4D; }
.tpl-modele-02-v1 .doc-total-due span:last-child { font-size: 22px; }
.tpl-modele-02-v1 .doc-footer-blocks { gap: 16px; }
.tpl-modele-02-v1 .doc-terms, .tpl-modele-02-v1 .doc-approval { padding: 14px 16px; border: 1px solid #DCE7E1; border-radius: 14px; }
.tpl-modele-02-v1 .doc-signature { flex: 1; min-height: 64px; background: #F7FAF8; border-radius: 10px; }
```

Ajouter à `src/templates/modele-03/v1/style.css` (Raffiné, d'après `Modele3.dc.html` : bandeau centré, double filet laiton, puis titre et numéro sur une ligne ; `display: contents` sur l'en-tête pour réordonner sans changer le balisage commun) :

```css
.tpl-modele-03-v1 { font-family: 'Source Sans 3', sans-serif; color: #2A2224; background: #FFFDF9; gap: 20px; }
.tpl-modele-03-v1 > * { order: 10; }
.tpl-modele-03-v1 .doc-header { display: contents; }
.tpl-modele-03-v1 .doc-brand { order: 1; align-self: center; flex-direction: column; gap: 6px; text-align: center; }
.tpl-modele-03-v1 .doc-brand-text { align-items: center; }
.tpl-modele-03-v1 .doc-trade-name { font-family: Fraunces, serif; font-weight: 600; font-size: 26px; color: #6B2333; }
.tpl-modele-03-v1 .doc-activity { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: #8A6A3E; }
.tpl-modele-03-v1 .doc-rule { order: 2; border-top: 1px solid #B08D57; border-bottom: 1px solid #B08D57; height: 3px; }
.tpl-modele-03-v1 .doc-heading { order: 3; flex-direction: row; justify-content: space-between; align-items: baseline; text-align: left; }
.tpl-modele-03-v1 .doc-title { font-family: Fraunces, serif; font-weight: 500; font-size: 34px; letter-spacing: 0.06em; }
.tpl-modele-03-v1 .doc-meta { flex-direction: row; gap: 0; font-size: 14px; color: #6B5E60; }
.tpl-modele-03-v1 .doc-meta .doc-date::before { content: ' · le '; white-space: pre; }
.tpl-modele-03-v1 .doc-parties { gap: 20px; }
.tpl-modele-03-v1 .doc-party { border: 1px solid #E8DCC8; padding: 14px 16px; }
.tpl-modele-03-v1 .doc-label { font-family: Fraunces, serif; font-size: 14px; font-style: italic; font-weight: 500; color: #8A6A3E; }
.tpl-modele-03-v1 .doc-object { display: flex; gap: 10px; align-items: baseline; }
.tpl-modele-03-v1 .doc-object .doc-label { font-size: 15px; }
.tpl-modele-03-v1 .doc-object-text { font-weight: 600; }
.tpl-modele-03-v1 .doc-lines thead tr { border-bottom: 1px solid #6B2333; }
.tpl-modele-03-v1 .doc-lines th { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #6B2333; font-weight: 700; padding: 8px 6px; }
.tpl-modele-03-v1 .doc-lines tbody tr { border-bottom: 1px solid #EFE6D8; }
.tpl-modele-03-v1 .doc-totals { width: 320px; }
.tpl-modele-03-v1 .doc-vat, .tpl-modele-03-v1 .doc-reference { color: #6B5E60; font-style: italic; }
.tpl-modele-03-v1 .doc-insurance { color: #6B5E60; }
.tpl-modele-03-v1 .doc-total-row span:last-child { font-weight: 700; }
.tpl-modele-03-v1 .doc-total-due { align-items: baseline; border-top: 2px solid #6B2333; padding-top: 10px; font-family: Fraunces, serif; font-weight: 600; color: #6B2333; }
.tpl-modele-03-v1 .doc-total-due span:first-child { font-size: 17px; }
.tpl-modele-03-v1 .doc-total-due span:last-child { font-size: 22px; }
.tpl-modele-03-v1 .doc-footer-blocks { gap: 24px; }
.tpl-modele-03-v1 .doc-footer-blocks .doc-label { font-style: normal; font-weight: 600; font-size: 15px; color: #6B2333; border-bottom: 1px solid #B08D57; padding-bottom: 4px; margin-bottom: 4px; }
.tpl-modele-03-v1 .doc-signature { border: 1px solid #E8DCC8; }
.tpl-modele-03-v1 .doc-thanks { font-family: Fraunces, serif; font-style: italic; font-size: 13px; color: #8A6A3E; }
```

- [ ] **Étape 6 : écrire la vue d'impression et la barre d'outils**

Dans `src/web/document/useTemplateFonts.ts`, ajouter en tête de l'effet : `if (!href) return;`.

`src/web/pages/PrintPage.tsx` :

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { DocumentView } from '../../shared/document';
import { getTemplate } from '../../templates/registry';
import { api } from '../api';
import { DocumentRenderer } from '../document/DocumentRenderer';
import { printTitle } from '../document/printTitle';
import { useTemplateFonts } from '../document/useTemplateFonts';

export const PRINT_HELP = 'Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF » et décochez « En-têtes et pieds de page ».';

export function PrintPage() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const endpoint = type === 'factures' ? `/api/invoices/${id}` : `/api/quotes/${id}`;
  const doc = useQuery({ queryKey: ['print', type, id], queryFn: () => api<{ view: DocumentView }>('GET', endpoint) });
  const view = doc.data?.view;
  const template = view ? getTemplate(view.templateRef) : null;
  useTemplateFonts(template?.fontsHref ?? '');

  useEffect(() => {
    if (!view) return;
    const previous = document.title;
    document.title = printTitle(view);
    return () => { document.title = previous; };
  }, [view]);

  useEffect(() => {
    if (!view || params.get('auto') !== '1') return;
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled) window.print(); });
    return () => { cancelled = true; };
  }, [view, params]);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Retour</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Imprimer / PDF</button>
        <p className="print-help">{PRINT_HELP}</p>
      </div>
      {doc.error && <p className="notice notice-error" role="alert">{doc.error.message}</p>}
      {view && template && <div className="doc-sheet"><DocumentRenderer view={view} template={template} /></div>}
    </div>
  );
}
```

`src/web/components/DocumentToolbar.tsx` (bouton « Aperçu et PDF » de la maquette Devis, avec l'aide à côté) :

```tsx
import { Link } from 'react-router';
import { PRINT_HELP } from '../pages/PrintPage';

export function DocumentToolbar({ printPath, beforeOpen }: { printPath: string; beforeOpen?: () => Promise<void> }) {
  return (
    <span className="actions" style={{ alignItems: 'center' }}>
      <Link className="btn btn-secondary" to={`${printPath}?auto=1`} title={PRINT_HELP} onClick={() => { void beforeOpen?.(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>
        Aperçu et PDF
      </Link>
    </span>
  );
}
```

Route, sous `<RequireAuth>` mais hors de la coquille : `<Route path="/imprimer/:type/:id" element={<PrintPage />} />`.

- [ ] **Étape 7 : brancher l'aperçu dans l'éditeur de devis**

Dans `QuoteEditorPage.tsx` : ajouter `<DocumentToolbar printPath={`/imprimer/devis/${q.id}`} beforeOpen={flush} />` en tête des boutons d'action (la sauvegarde en attente part avant l'ouverture de l'aperçu) ; pour un devis figé, remplacer le `LinesEditor` en lecture seule par `<div className="doc-sheet"><DocumentRenderer view={view} template={getTemplate(view.templateRef)} /></div>`. Charger les polices du modèle en haut du composant, avant les retours anticipés (règle des hooks) : `useTemplateFonts(quote.data ? getTemplate(quote.data.view.templateRef).fontsHref : '');`. Dans `QuoteForm.tsx`, sous le nom du modèle, ajouter `<Link to={`/imprimer/devis/${initial.quote.id}`} style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-primary)' }}>Voir l’aperçu</Link>`.

- [ ] **Étape 8 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 9 : vérifier l'impression à la main (Chrome ou Edge d'abord)**

Avec `npm run dev`, pour chacun des 3 modèles (changer de modèle dans le profil ; un brouillon suit le modèle courant) :
1. Ouvrir l'aperçu d'un devis de 5 lignes : comparer côte à côte avec `Modele1/2/3.dc.html`.
2. Imprimer en PDF (A4, en-têtes et pieds décochés) : une page, couleurs de fond présentes (Discret, Raffiné).
3. Devis de 40 lignes : l'en-tête du tableau se répète en page 2, aucune ligne coupée, totaux et bloc « Bon pour accord » non séparés.
4. Le nom de fichier proposé est `D-2026-00X – Client`.
5. Ouvrir le même aperçu dans Firefox et Safari (si disponible) : document lisible.

Noter les écarts constatés dans le message de commit.

- [ ] **Étape 10 : commit**

```bash
git add -A
git commit -m "feat: rendu commun des documents, 3 modèles v1 et impression A4"
```

**Critère de fin :** un même composant rend devis, factures et avoirs dans les 3 modèles ; l'impression A4 respecte les règles de pagination ; les tests de rendu couvrent les mentions de chaque type de document.

---

# Phase 4 : factures

### Tâche 18 : API des brouillons de facture (acompte, solde, facture sans devis)

**Fichiers :**
- Créer : `src/shared/invoice.ts`, `src/worker/db/invoices.ts`, `src/worker/routes/invoices.ts`
- Modifier : `src/shared/status.ts`, `src/shared/api-types.ts`, `src/worker/views.ts`, `src/worker/app.ts`, `test/worker/fixtures.ts`, `test/worker/isolation.test.ts`, `src/shared/status.test.ts`
- Tests : `test/worker/invoices-drafts.test.ts`

**Interfaces :**
- Consomme : `DepositInputSchema`, `depositAmountCents`, `checkDeposit` (tâche 12) ; `parseSnapshot`, `buildDocumentView` (tâche 14) ; `requireQuoteRow`, `getQuoteRow` (tâche 15) ; `requireClient`, `getClient` ; `requireCompleteProfile`, `getProfile`.
- Produit (`status.ts`) : `type InvoiceKind = 'deposit' | 'final' | 'standalone' | 'credit'` ; `type InvoiceStatus = 'draft' | 'issued' | 'cancelled'` ; `type InvoiceDisplay = 'draft' | 'to_pay' | 'late' | 'paid' | 'cancelled' | 'credit'` ; `INVOICE_DISPLAY` ; `INVOICE_KIND_LABEL` ; `invoiceDisplay(i: { kind; status; paidAt; dueDate }, today: string): InvoiceDisplay`.
- Produit (`shared/invoice.ts`) : `InvoiceDraftInput` (Zod, champs facultatifs) ; `EDITABLE_FIELDS: Record<Exclude<InvoiceKind, 'credit'>, (keyof InvoiceDraftInput)[]>`.
- Produit (`db/invoices.ts`) : `type InvoiceRow` ; `getInvoiceRow`, `requireInvoiceRow` ; `toInvoiceDto(row, today)` ; `invoiceLinks(db, userId, row): Promise<InvoiceLinks>` ; `listInvoices(db, userId, filters, today)` ; `listIssuedDeposits(db, userId, quoteId): Promise<DeductedDeposit[]>` ; `quoteBillingState(db, userId, quoteId): Promise<{ depositAmounts: number[]; draftDepositCount: number; issuedDepositsCents: number; activeFinal: { id: string; status: InvoiceStatus } | null }>`.
- Produit (`views.ts`) : `invoiceView(db, userId, row: InvoiceRow): Promise<DocumentView>`.
- Produit (API) : `POST /api/quotes/:id/deposits (DepositInput)` → `201 InvoiceResponse` ; `POST /api/quotes/:id/final` → `201 InvoiceResponse` ; `POST /api/invoices/standalone { clientId? }` → `201 InvoiceResponse` ; `GET /api/invoices?kind=&quoteId=` → `{ items: InvoiceListItem[] }` ; `GET /api/invoices/:id` → `InvoiceResponse` ; `PUT /api/invoices/:id (InvoiceDraftInput)` → `InvoiceResponse` ; `DELETE /api/invoices/:id` → `204`.
- Produit (`api-types.ts`) : `InvoiceDto`, `InvoiceListItem`, `InvoiceLinks = { quote: { id: string; number: string | null } | null; creditNote: { id: string; number: string | null } | null; creditedInvoice: { id: string; number: string | null } | null }`, `InvoiceResponse = { invoice: InvoiceDto; view: DocumentView; links: InvoiceLinks }`.
- Produit (`fixtures.ts`) : `seedAcceptedQuote(app, user, clientId, lines?)`, `createDeposit(app, user, quoteId, body)`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à `src/shared/status.test.ts` :

```ts
import { invoiceDisplay } from './status';

it('déduit l’état affiché d’une facture', () => {
  const base = { kind: 'deposit' as const, status: 'issued' as const, paidAt: null, dueDate: '2026-11-12' };
  expect(invoiceDisplay({ ...base, status: 'draft' }, '2026-11-03')).toBe('draft');
  expect(invoiceDisplay(base, '2026-11-03')).toBe('to_pay');
  expect(invoiceDisplay(base, '2026-11-13')).toBe('late');
  expect(invoiceDisplay({ ...base, paidAt: '2026-11-10' }, '2026-11-13')).toBe('paid');
  expect(invoiceDisplay({ ...base, status: 'cancelled', paidAt: '2026-11-10' }, '2026-11-13')).toBe('cancelled');
  expect(invoiceDisplay({ ...base, kind: 'credit' }, '2026-11-13')).toBe('credit');
});
```

Ajouter à `test/worker/fixtures.ts` :

```ts
import type { InvoiceResponse } from '../../src/shared/api-types';

export const seedAcceptedQuote = (app: App, user: SessionUser, clientId: string, lines?: Line[]) =>
  seedQuote(app, user, { clientId, lines, status: 'accepted' });

export async function createDeposit(app: App, user: SessionUser, quoteId: string, body: unknown): Promise<InvoiceResponse> {
  const res = await call(app, user, 'POST', `/api/quotes/${quoteId}/deposits`, body);
  if (res.status !== 201) throw new Error(`deposit: ${res.status} ${await res.text()}`);
  return json<InvoiceResponse>(res);
}
```

`test/worker/invoices-drafts.test.ts` :

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, createDeposit, seedAcceptedQuote, seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const line = (cents: number) => ({ id: crypto.randomUUID(), designation: 'Travaux', quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function ready() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  return { u, client };
}

describe('factures d’acompte', () => {
  it('crée un acompte de 30 % sur un devis accepté de 2 920,00 €', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const r = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect(r.invoice).toMatchObject({ kind: 'deposit', status: 'draft', number: null, depositBp: 3000, totalHtCents: 87600, amountDueCents: 87600, clientId: client.id, quoteId: q.quote.id });
    expect(r.invoice.lines).toHaveLength(1);
    expect(r.invoice.lines[0].designation.replace(/\s/g, ' ')).toContain('Acompte de 30 % sur le devis D-2026-001');
    expect(r.view).toMatchObject({ title: 'Facture d’acompte', references: { quote: { number: 'D-2026-001', date: '2026-11-03' } } });
    expect(r.links.quote).toEqual({ id: q.quote.id, number: 'D-2026-001' });
  });

  it('arrondit au centime inférieur et accepte un montant fixe', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id, [line(100001)]); // 1 000,01 €
    expect((await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3300 })).invoice.amountDueCents).toBe(33000);
    expect((await createDeposit(app, u, q.quote.id, { mode: 'amount', cents: 50000 })).invoice.amountDueCents).toBe(50000);
  });

  it('refuse un acompte qui ferait dépasser le total ; un acompte annulé ne compte plus', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const first = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 7000 });
    const res = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 4000 });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'deposit_exceeds_total' });
    await env.DB.prepare("UPDATE invoices SET status = 'cancelled' WHERE id = ?").bind(first.invoice.id).run();
    expect((await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 4000 })).status).toBe(201);
  });

  it('refuse un acompte sur un devis non accepté', async () => {
    const { u, client } = await ready();
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 3000 }))).toMatchObject({ error: 'quote_not_accepted' });
  });

  it('libère le plafond quand on supprime un brouillon d’acompte', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 10000 });
    expect((await call(app, u, 'DELETE', `/api/invoices/${d.invoice.id}`)).status).toBe(204);
    expect((await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 10000 })).status).toBe(201);
  });
});

describe('facture de solde et facture sans devis', () => {
  it('prépare le solde avec les lignes de l’instantané du devis', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const res = await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`);
    expect(res.status).toBe(201);
    const r = await json(res);
    expect(r.invoice).toMatchObject({ kind: 'final', status: 'draft', totalHtCents: 292000, amountDueCents: 292000, object: 'Rénovation électrique du rez-de-chaussée' });
    expect(r.invoice.lines).toHaveLength(5);
    expect(r.view.title).toBe('Facture');
  });

  it('n’autorise qu’un solde actif, et plus d’acompte ensuite', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`);
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`))).toMatchObject({ error: 'final_exists' });
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 1000 }))).toMatchObject({ error: 'final_exists' });
  });

  it('refuse de préparer le solde tant qu’un acompte est en brouillon', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect(await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`))).toMatchObject({ error: 'pending_deposit_draft' });
  });

  it('crée une facture sans devis avec 5 lignes vides, modifiable', async () => {
    const { u, client } = await ready();
    const created = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
    expect(created.invoice).toMatchObject({ kind: 'standalone', clientId: null });
    expect(created.invoice.lines).toHaveLength(5);
    const saved = await json(await call(app, u, 'PUT', `/api/invoices/${created.invoice.id}`, {
      clientId: client.id, object: 'Dépannage', lines: [line(12000)], serviceDate: '2026-11-02', dueDate: null, notes: '',
    }));
    expect(saved.invoice).toMatchObject({ totalHtCents: 12000, amountDueCents: 12000, serviceDate: '2026-11-02' });
    expect(saved.view).toMatchObject({ title: 'Facture', client: { name: 'SCI Les Tilleuls' } });
  });

  it('limite les champs modifiables selon le type de facture', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect(await json(await call(app, u, 'PUT', `/api/invoices/${d.invoice.id}`, { lines: [line(1)], serviceDate: null, dueDate: null, notes: '' }))).toMatchObject({ error: 'field_not_editable' });
    expect((await call(app, u, 'PUT', `/api/invoices/${d.invoice.id}`, { serviceDate: '2026-11-04', dueDate: '2026-11-20', notes: 'Merci' })).status).toBe(200);
    await call(app, u, 'DELETE', `/api/invoices/${d.invoice.id}`);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const other = await seedClient(app, u, { ...CLIENT_BUSINESS, name: 'Autre' });
    expect((await call(app, u, 'PUT', `/api/invoices/${f.invoice.id}`, { clientId: other.id, serviceDate: null, dueDate: null, notes: '' })).status).toBe(400);
  });

  it('liste les factures d’un devis', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    await call(app, u, 'POST', '/api/invoices/standalone', {});
    expect((await json(await call(app, u, 'GET', `/api/invoices?quoteId=${q.quote.id}`))).items).toHaveLength(1);
    expect((await json(await call(app, u, 'GET', '/api/invoices'))).items).toHaveLength(2);
  });
});
```

Ajouter à `test/worker/isolation.test.ts` :

```ts
it('protège les devis et factures d’un autre utilisateur côté facturation (vigilance n° 5)', async () => {
  const { a, b } = await twoUsers(app);
  const clientOfA = await seedClient(app, a);
  const q = await seedAcceptedQuote(app, a, clientOfA.id);
  expect((await call(app, b, 'POST', `/api/quotes/${q.quote.id}/deposits`, { mode: 'percent', basisPoints: 3000 })).status).toBe(404);
  expect((await call(app, b, 'POST', `/api/quotes/${q.quote.id}/final`)).status).toBe(404);
  const d = await createDeposit(app, a, q.quote.id, { mode: 'percent', basisPoints: 3000 });
  expect((await call(app, b, 'GET', `/api/invoices/${d.invoice.id}`)).status).toBe(404);
  expect((await call(app, b, 'PUT', `/api/invoices/${d.invoice.id}`, { serviceDate: null, dueDate: null, notes: '' })).status).toBe(404);
  expect((await call(app, b, 'DELETE', `/api/invoices/${d.invoice.id}`)).status).toBe(404);
  expect((await json(await call(app, b, 'GET', '/api/invoices'))).items).toEqual([]);
  expect((await call(app, b, 'POST', '/api/invoices/standalone', { clientId: clientOfA.id })).status).toBe(404);
  const own = await json(await call(app, b, 'POST', '/api/invoices/standalone', {}));
  expect((await call(app, b, 'PUT', `/api/invoices/${own.invoice.id}`, { clientId: clientOfA.id, serviceDate: null, dueDate: null, notes: '' })).status).toBe(404);
  expect((await json(await call(app, b, 'GET', `/api/invoices/${own.invoice.id}`))).view.client).toBeNull();
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:unit -- status && npm run test:worker -- invoices-drafts isolation`
Expected: FAIL.

- [ ] **Étape 3 : statuts, schéma et types d'API**

Ajouter à `src/shared/status.ts` :

```ts
export type InvoiceKind = 'deposit' | 'final' | 'standalone' | 'credit';
export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';
export type InvoiceDisplay = 'draft' | 'to_pay' | 'late' | 'paid' | 'cancelled' | 'credit';

export const INVOICE_DISPLAY: Record<InvoiceDisplay, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'draft' },
  to_pay: { label: 'À payer', tone: 'wait' },
  late: { label: 'En retard', tone: 'late' },
  paid: { label: 'Payée', tone: 'paid' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
  credit: { label: 'Avoir émis', tone: 'neutral' },
};

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  deposit: 'Facture d’acompte',
  final: 'Facture de solde',
  standalone: 'Facture',
  credit: 'Avoir',
};

export function invoiceDisplay(
  i: { kind: InvoiceKind; status: InvoiceStatus; paidAt: string | null; dueDate: string | null },
  today: string,
): InvoiceDisplay {
  if (i.status === 'draft') return 'draft';
  if (i.kind === 'credit') return 'credit';
  if (i.status === 'cancelled') return 'cancelled';
  if (i.paidAt) return 'paid';
  if (i.dueDate && i.dueDate < today) return 'late';
  return 'to_pay';
}
```

`src/shared/invoice.ts` :

```ts
import { z } from 'zod';
import { isIsoDate } from './dates';
import { LinesSchema } from './lines';
import type { InvoiceKind } from './status';

const isoDate = z.string().refine(isIsoDate, 'Date attendue au format AAAA-MM-JJ');

export const InvoiceDraftInput = z.object({
  clientId: z.string().min(1).nullable().optional(),
  object: z.string().trim().max(300).optional(),
  interventionAddress: z.string().trim().max(300).nullable().optional(),
  lines: LinesSchema.optional(),
  serviceDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  notes: z.string().trim().max(1000),
});

export type InvoiceDraftInput = z.infer<typeof InvoiceDraftInput>;

/** Champs modifiables d'un brouillon, selon son type (les dates et les notes le sont toujours). */
export const EDITABLE_FIELDS: Record<Exclude<InvoiceKind, 'credit'>, (keyof InvoiceDraftInput)[]> = {
  deposit: ['serviceDate', 'dueDate', 'notes'],
  final: ['object', 'interventionAddress', 'lines', 'serviceDate', 'dueDate', 'notes'],
  standalone: ['clientId', 'object', 'interventionAddress', 'lines', 'serviceDate', 'dueDate', 'notes'],
};
```

Ajouter à `src/shared/api-types.ts` :

```ts
import type { InvoiceDisplay, InvoiceKind, InvoiceStatus } from './status';
import type { Line } from './lines';

export type InvoiceDto = {
  id: string; kind: InvoiceKind; status: InvoiceStatus; number: string | null;
  quoteId: string | null; clientId: string | null; object: string; interventionAddress: string | null;
  lines: Line[]; depositBp: number | null; totalHtCents: number; amountDueCents: number;
  serviceDate: string | null; dueDate: string | null; notes: string;
  issueDate: string | null; paidAt: string | null; cancelledAt: string | null; updatedAt: string;
  display: InvoiceDisplay;
};

export type InvoiceListItem = {
  id: string; kind: InvoiceKind; status: InvoiceStatus; number: string | null; clientName: string | null;
  issueDate: string | null; dueDate: string | null; amountDueCents: number; paidAt: string | null;
  depositBp: number | null; quoteId: string | null; display: InvoiceDisplay;
};

type Link = { id: string; number: string | null } | null;
export type InvoiceLinks = { quote: Link; creditNote: Link; creditedInvoice: Link };
export type InvoiceResponse = { invoice: InvoiceDto; view: DocumentView; links: InvoiceLinks };
```

- [ ] **Étape 4 : écrire `src/worker/db/invoices.ts`**

```ts
import type { InvoiceDto, InvoiceLinks, InvoiceListItem } from '../../shared/api-types';
import type { DeductedDeposit } from '../../shared/balance';
import type { Line } from '../../shared/lines';
import { invoiceDisplay, type InvoiceKind, type InvoiceStatus } from '../../shared/status';
import { notFound } from '../errors';

export type InvoiceRow = {
  id: string; user_id: string; kind: InvoiceKind; quote_id: string | null; credited_invoice_id: string | null;
  credited_by_id: string | null; client_id: string | null; number: string | null; status: InvoiceStatus;
  object: string; intervention_address: string | null; lines_json: string; deposit_bp: number | null;
  total_ht_cents: number; amount_due_cents: number; service_date: string | null; due_date: string | null;
  notes: string; issue_date: string | null; paid_at: string | null; cancelled_at: string | null;
  snapshot_json: string | null; created_at: string; updated_at: string;
};

export async function getInvoiceRow(db: D1Database, userId: string, id: string): Promise<InvoiceRow | null> {
  return db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').bind(id, userId).first<InvoiceRow>();
}

export async function requireInvoiceRow(db: D1Database, userId: string, id: string): Promise<InvoiceRow> {
  const row = await getInvoiceRow(db, userId, id);
  if (!row) throw notFound('Facture introuvable.');
  return row;
}

export function toInvoiceDto(r: InvoiceRow, today: string): InvoiceDto {
  return {
    id: r.id, kind: r.kind, status: r.status, number: r.number, quoteId: r.quote_id, clientId: r.client_id,
    object: r.object, interventionAddress: r.intervention_address, lines: JSON.parse(r.lines_json) as Line[],
    depositBp: r.deposit_bp, totalHtCents: r.total_ht_cents, amountDueCents: r.amount_due_cents,
    serviceDate: r.service_date, dueDate: r.due_date, notes: r.notes, issueDate: r.issue_date, paidAt: r.paid_at,
    cancelledAt: r.cancelled_at, updatedAt: r.updated_at,
    display: invoiceDisplay({ kind: r.kind, status: r.status, paidAt: r.paid_at, dueDate: r.due_date }, today),
  };
}

export async function invoiceLinks(db: D1Database, userId: string, r: InvoiceRow): Promise<InvoiceLinks> {
  const one = async (table: 'quotes' | 'invoices', id: string | null) =>
    id ? db.prepare(`SELECT id, number FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, userId).first<{ id: string; number: string | null }>() : null;
  return {
    quote: await one('quotes', r.quote_id),
    creditNote: await one('invoices', r.credited_by_id),
    creditedInvoice: await one('invoices', r.credited_invoice_id),
  };
}

type ListRow = { id: string; kind: InvoiceKind; status: InvoiceStatus; number: string | null; client_name: string | null; issue_date: string | null; due_date: string | null; amount_due_cents: number; paid_at: string | null; deposit_bp: number | null; quote_id: string | null };

export async function listInvoices(db: D1Database, userId: string, f: { kind?: InvoiceKind; quoteId?: string }, today: string): Promise<InvoiceListItem[]> {
  const { results } = await db.prepare(
    `SELECT i.id, i.kind, i.status, i.number, c.name AS client_name, i.issue_date, i.due_date, i.amount_due_cents, i.paid_at, i.deposit_bp, i.quote_id
     FROM invoices i LEFT JOIN clients c ON c.id = i.client_id AND c.user_id = i.user_id
     WHERE i.user_id = ?1 AND (?2 IS NULL OR i.kind = ?2) AND (?3 IS NULL OR i.quote_id = ?3)
     ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.number DESC LIMIT 200`,
  ).bind(userId, f.kind ?? null, f.quoteId ?? null).all<ListRow>();
  return results.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, number: r.number, clientName: r.client_name, issueDate: r.issue_date,
    dueDate: r.due_date, amountDueCents: r.amount_due_cents, paidAt: r.paid_at, depositBp: r.deposit_bp, quoteId: r.quote_id,
    display: invoiceDisplay({ kind: r.kind, status: r.status, paidAt: r.paid_at, dueDate: r.due_date }, today),
  }));
}

export async function listIssuedDeposits(db: D1Database, userId: string, quoteId: string): Promise<DeductedDeposit[]> {
  const { results } = await db.prepare(
    `SELECT id, number, issue_date, amount_due_cents FROM invoices
     WHERE user_id = ? AND quote_id = ? AND kind = 'deposit' AND status = 'issued' ORDER BY issue_date, number`,
  ).bind(userId, quoteId).all<{ id: string; number: string; issue_date: string; amount_due_cents: number }>();
  return results.map((r) => ({ invoiceId: r.id, number: r.number, issueDate: r.issue_date, amountCents: r.amount_due_cents }));
}

export async function quoteBillingState(db: D1Database, userId: string, quoteId: string) {
  const { results } = await db.prepare(
    "SELECT id, kind, status, amount_due_cents FROM invoices WHERE user_id = ? AND quote_id = ? AND kind IN ('deposit', 'final') AND status != 'cancelled'",
  ).bind(userId, quoteId).all<{ id: string; kind: InvoiceKind; status: InvoiceStatus; amount_due_cents: number }>();
  const deposits = results.filter((r) => r.kind === 'deposit');
  const final = results.find((r) => r.kind === 'final');
  return {
    depositAmounts: deposits.map((d) => d.amount_due_cents),
    draftDepositCount: deposits.filter((d) => d.status === 'draft').length,
    issuedDepositsCents: deposits.filter((d) => d.status === 'issued').reduce((s, d) => s + d.amount_due_cents, 0),
    activeFinal: final ? { id: final.id, status: final.status } : null,
  };
}
```

Ajouter à `src/worker/views.ts` :

```ts
import { getQuoteRow } from './db/quotes';
import { listIssuedDeposits, type InvoiceRow } from './db/invoices';

export async function invoiceView(db: D1Database, userId: string, inv: InvoiceRow): Promise<DocumentView> {
  if (inv.snapshot_json) return parseSnapshot(inv.snapshot_json);
  if (inv.kind === 'credit') throw new Error('Un avoir est toujours figé.');
  const profile = await getProfile(db, userId);
  if (!profile) throw new HttpError(409, 'profile_incomplete', 'Complétez votre profil entreprise avant de continuer.');
  const client = inv.client_id ? await getClient(db, userId, inv.client_id) : null;
  const quote = inv.quote_id ? await getQuoteRow(db, userId, inv.quote_id) : null;
  return buildDocumentView({
    kind: inv.kind, number: inv.number, date: inv.issue_date, templateRef: profile.templateRef, profile, client,
    object: inv.object, interventionAddress: inv.intervention_address, lines: JSON.parse(inv.lines_json) as Line[],
    invoiceDates: { serviceDate: inv.service_date, dueDate: inv.due_date, notes: inv.notes },
    deductedDeposits: inv.kind === 'final' && quote ? await listIssuedDeposits(db, userId, quote.id) : undefined,
    quoteRef: quote?.number && quote.quote_date ? { number: quote.number, date: quote.quote_date } : null,
  });
}
```

- [ ] **Étape 5 : écrire `src/worker/routes/invoices.ts` (brouillons)**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { InvoiceResponse } from '../../shared/api-types';
import { todayInParis } from '../../shared/dates';
import { DepositInputSchema, checkDeposit, depositAmountCents } from '../../shared/deposits';
import { parseSnapshot } from '../../shared/document';
import { EDITABLE_FIELDS, InvoiceDraftInput } from '../../shared/invoice';
import { blankLines, computeTotals, type Line } from '../../shared/lines';
import { formatEuros, formatPercent } from '../../shared/money';
import { requireClient } from '../db/clients';
import { invoiceLinks, listInvoices, quoteBillingState, requireInvoiceRow, toInvoiceDto, type InvoiceRow } from '../db/invoices';
import { requireCompleteProfile } from '../db/profiles';
import { requireQuoteRow, type QuoteRow } from '../db/quotes';
import { HttpError, validate } from '../errors';
import type { AppContext, AppEnv } from '../types';
import { invoiceView } from '../views';

export const today = (c: AppContext) => todayInParis(c.var.deps.now());
const nowIso = (c: AppContext) => c.var.deps.now().toISOString();
const notDraft = () => new HttpError(409, 'not_draft', 'Une facture émise ne peut plus être modifiée ni supprimée. Corrigez-la par un avoir.');

export async function respondInvoice(c: AppContext, id: string, status: 200 | 201 = 200) {
  const row = await requireInvoiceRow(c.env.DB, c.var.user.id, id);
  const body: InvoiceResponse = {
    invoice: toInvoiceDto(row, today(c)),
    view: await invoiceView(c.env.DB, c.var.user.id, row),
    links: await invoiceLinks(c.env.DB, c.var.user.id, row),
  };
  return c.json(body, status);
}

function requireAccepted(q: QuoteRow): QuoteRow & { snapshot_json: string; number: string } {
  if (q.status !== 'accepted' || !q.snapshot_json || !q.number) throw new HttpError(409, 'quote_not_accepted', 'Seul un devis accepté peut être facturé.');
  return q as QuoteRow & { snapshot_json: string; number: string };
}

async function insertDraft(c: AppContext, v: { kind: InvoiceRow['kind']; quoteId: string | null; clientId: string | null; object: string; interventionAddress: string | null; lines: Line[]; depositBp?: number | null; amountDueCents?: number }) {
  const id = crypto.randomUUID();
  const total = computeTotals(v.lines).totalHtCents;
  await c.env.DB.prepare(
    `INSERT INTO invoices (id, user_id, kind, quote_id, client_id, status, object, intervention_address, lines_json, deposit_bp, total_ht_cents, amount_due_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.user.id, v.kind, v.quoteId, v.clientId, v.object, v.interventionAddress, JSON.stringify(v.lines), v.depositBp ?? null, total, v.amountDueCents ?? total, nowIso(c), nowIso(c)).run();
  return id;
}

export const invoiceRoutes = new Hono<AppEnv>()
  .post('/quotes/:id/deposits', validate('json', DepositInputSchema), async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const quote = requireAccepted(await requireQuoteRow(DB, userId, c.req.param('id')));
    const snap = parseSnapshot(quote.snapshot_json);
    const totalCents = snap.totals.totalDueCents;
    const input = c.req.valid('json');
    const amount = depositAmountCents(totalCents, input);
    const state = await quoteBillingState(DB, userId, quote.id);
    if (state.activeFinal) throw new HttpError(409, 'final_exists', 'Une facture de solde existe déjà pour ce devis : plus d’acompte possible.');
    const check = checkDeposit(totalCents, state.depositAmounts, amount);
    if (!check.ok) {
      throw check.reason === 'non_positive'
        ? new HttpError(409, 'deposit_non_positive', 'Le montant de l’acompte doit être positif.')
        : new HttpError(409, 'deposit_exceeds_total', `La somme des acomptes dépasserait le total du devis. Reste facturable : ${formatEuros(check.remainingCents)}.`);
    }
    const label = input.mode === 'percent' ? `Acompte de ${formatPercent(input.basisPoints)} sur le devis ${quote.number}` : `Acompte sur le devis ${quote.number}`;
    const line: Line = { id: crypto.randomUUID(), designation: snap.object ? `${label} – ${snap.object}` : label, quantityMilli: 1000, unit: 'forfait', unitPriceCents: amount, vatRate: null };
    const id = crypto.randomUUID();
    // Le plafond et l'absence de solde sont revérifiés dans l'INSERT lui-même (deux onglets, double clic).
    const res = await DB.prepare(
      `INSERT INTO invoices (id, user_id, kind, quote_id, client_id, status, object, intervention_address, lines_json, deposit_bp, total_ht_cents, amount_due_cents, created_at, updated_at)
       SELECT ?, ?, 'deposit', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COALESCE(SUM(amount_due_cents), 0) FROM invoices WHERE quote_id = ? AND kind = 'deposit' AND status != 'cancelled') + ? <= ?
         AND NOT EXISTS (SELECT 1 FROM invoices WHERE quote_id = ? AND kind = 'final' AND status != 'cancelled')`,
    ).bind(id, userId, quote.id, quote.client_id, snap.object, snap.interventionAddress, JSON.stringify([line]),
      input.mode === 'percent' ? input.basisPoints : null, amount, amount, nowIso(c), nowIso(c), quote.id, amount, totalCents, quote.id).run();
    if (res.meta.changes === 0) throw new HttpError(409, 'deposit_exceeds_total', 'La facturation de ce devis a changé entre-temps. Rechargez la page.');
    return respondInvoice(c, id, 201);
  })

  .post('/quotes/:id/final', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const quote = requireAccepted(await requireQuoteRow(DB, userId, c.req.param('id')));
    const state = await quoteBillingState(DB, userId, quote.id);
    if (state.activeFinal) throw new HttpError(409, 'final_exists', 'Une facture de solde existe déjà pour ce devis.');
    if (state.draftDepositCount > 0) throw new HttpError(409, 'pending_deposit_draft', 'Émettez ou supprimez d’abord la facture d’acompte en brouillon.');
    const snap = parseSnapshot(quote.snapshot_json);
    const lines = snap.lines.map((l) => ({ ...l, id: crypto.randomUUID() }));
    try {
      const id = await insertDraft(c, {
        kind: 'final', quoteId: quote.id, clientId: quote.client_id, object: snap.object, interventionAddress: snap.interventionAddress,
        lines, amountDueCents: computeTotals(lines).totalHtCents - state.issuedDepositsCents,
      });
      return respondInvoice(c, id, 201);
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'final_exists', 'Une facture de solde existe déjà pour ce devis.');
      throw e;
    }
  })

  .post('/invoices/standalone', validate('json', z.object({ clientId: z.string().min(1).optional() })), async (c) => {
    const profile = await requireCompleteProfile(c.env.DB, c.var.user.id);
    const { clientId } = c.req.valid('json');
    if (clientId) await requireClient(c.env.DB, c.var.user.id, clientId);
    const id = await insertDraft(c, { kind: 'standalone', quoteId: null, clientId: clientId ?? null, object: '', interventionAddress: null, lines: blankLines(5, profile.units[0] ?? 'u') });
    return respondInvoice(c, id, 201);
  })

  .get('/invoices', validate('query', z.object({ kind: z.enum(['deposit', 'final', 'standalone', 'credit']).optional(), quoteId: z.string().optional() })), async (c) =>
    c.json({ items: await listInvoices(c.env.DB, c.var.user.id, c.req.valid('query'), today(c)) }))

  .get('/invoices/:id', (c) => respondInvoice(c, c.req.param('id')))

  .put('/invoices/:id', validate('json', InvoiceDraftInput), async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const row = await requireInvoiceRow(DB, userId, c.req.param('id'));
    if (row.status !== 'draft' || row.kind === 'credit') throw notDraft();
    const input = c.req.valid('json');
    const allowed = EDITABLE_FIELDS[row.kind];
    const refused = (Object.keys(input) as (keyof InvoiceDraftInput)[]).filter((k) => input[k] !== undefined && !allowed.includes(k));
    if (refused.length > 0) throw new HttpError(400, 'field_not_editable', `Champ non modifiable pour ce type de facture : ${refused.join(', ')}.`);
    if (input.clientId) await requireClient(DB, userId, input.clientId);

    const lines = input.lines ?? (JSON.parse(row.lines_json) as Line[]);
    const total = computeTotals(lines).totalHtCents;
    const issuedDeposits = row.kind === 'final' && row.quote_id ? (await quoteBillingState(DB, userId, row.quote_id)).issuedDepositsCents : 0;
    const res = await DB.prepare(
      `UPDATE invoices SET client_id = ?, object = ?, intervention_address = ?, lines_json = ?, total_ht_cents = ?, amount_due_cents = ?,
         service_date = ?, due_date = ?, notes = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'draft'`,
    ).bind(
      input.clientId !== undefined ? input.clientId : row.client_id,
      input.object ?? row.object,
      input.interventionAddress !== undefined ? input.interventionAddress || null : row.intervention_address,
      JSON.stringify(lines), total, total - issuedDeposits,
      input.serviceDate, input.dueDate, input.notes, nowIso(c), row.id, userId,
    ).run();
    if (res.meta.changes === 0) throw notDraft();
    return respondInvoice(c, row.id);
  })

  .delete('/invoices/:id', async (c) => {
    const row = await requireInvoiceRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const res = await c.env.DB.prepare("DELETE FROM invoices WHERE id = ? AND user_id = ? AND status = 'draft' AND kind != 'credit'").bind(row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notDraft();
    return c.body(null, 204);
  });
```

Pour un acompte, `PUT` ne touche ni aux lignes ni au montant : `lines` vaut celles de la ligne existante et `issuedDeposits` vaut 0, donc `total_ht_cents` et `amount_due_cents` restent égaux au montant de l'acompte.

Brancher dans `src/worker/app.ts` : `api.route('/', invoiceRoutes);` (après `api.route('/quotes', quoteRoutes)` ; les chemins `/quotes/:id/deposits` et `/quotes/:id/final` n'existent pas dans `quoteRoutes`).

- [ ] **Étape 6 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat: brouillons de factures d'acompte, de solde et sans devis"
```

**Critère de fin :** depuis un devis accepté, acomptes (pourcentage arrondi inférieur ou montant) plafonnés au total, solde unique reprenant l'instantané, facture sans devis ; champs modifiables selon le type ; cloisonnement vérifié.

---

### Tâche 19 : émission figée des factures

**Fichiers :**
- Modifier : `src/worker/routes/invoices.ts`
- Tests : `test/worker/invoices-issue.test.ts`

**Interfaces :**
- Consomme : `runIssue` (tâche 13) ; `buildDocumentView` ; `computeBalance`, `lineProblems` ; `listIssuedDeposits`, `quoteBillingState` (tâche 18) ; `requireCompleteProfile`, `getClient`.
- Produit (API) : `POST /api/invoices/:id/issue` → `InvoiceResponse` ; erreurs 409 : `not_draft`, `profile_incomplete`, `client_missing`, `client_siren_required`, `no_lines`, `missing_designation`, `non_positive_total`, `due_before_issue`, `pending_deposit_draft`, `negative_remaining`.
- Règles : date d'émission = aujourd'hui à Paris ; échéance par défaut = émission + délai du profil ; date de prestation par défaut = date d'émission ; entreprise et client pris **au moment de l'émission** ; lignes d'un solde = celles du brouillon (issues de l'instantané du devis) ; acomptes déduits = acomptes émis non annulés du devis, figés dans l'instantané.

- [ ] **Étape 1 : écrire le test qui échoue**

`test/worker/invoices-issue.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { CLIENT_BUSINESS, PROFILE, createDeposit, seedAcceptedQuote, seedClient, seedProfile } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const line = (cents: number, designation = 'Travaux') => ({ id: crypto.randomUUID(), designation, quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function ready() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  return { u, client };
}

async function standalone(a: typeof app, u: Awaited<ReturnType<typeof ready>>['u'], clientId: string | null, lines = [line(12000)], extra = {}) {
  const created = await json(await call(a, u, 'POST', '/api/invoices/standalone', {}));
  await call(a, u, 'PUT', `/api/invoices/${created.invoice.id}`, { clientId, object: 'Dépannage', lines, serviceDate: null, dueDate: null, notes: '', ...extra });
  return created.invoice.id as string;
}

const issue = (a: typeof app, u: Awaited<ReturnType<typeof ready>>['u'], id: string) => call(a, u, 'POST', `/api/invoices/${id}/issue`);

describe('émission', () => {
  it('numérote, date, fixe l’échéance et fige l’instantané', async () => {
    const { u, client } = await ready();
    const id = await standalone(app, u, client.id);
    const res = await issue(app, u, id);
    expect(res.status).toBe(200);
    const r = await json(res);
    expect(r.invoice).toMatchObject({ status: 'issued', number: 'F-2026-001', issueDate: '2026-11-03', dueDate: '2026-12-03', serviceDate: '2026-11-03', display: 'to_pay' });
    expect(r.view).toMatchObject({ number: 'F-2026-001', date: '2026-11-03', invoiceTerms: { dueDate: '2026-12-03' } });
  });

  it('rend la facture émise inaltérable, insupprimable et indépendante du profil', async () => {
    const { u, client } = await ready();
    const id = await standalone(app, u, client.id);
    await issue(app, u, id);
    expect((await call(app, u, 'PUT', `/api/invoices/${id}`, { serviceDate: null, dueDate: null, notes: 'x' })).status).toBe(409);
    expect((await call(app, u, 'DELETE', `/api/invoices/${id}`)).status).toBe(409);
    await call(app, u, 'PUT', '/api/profile', { ...PROFILE, street: '1 rue Neuve' });
    await call(app, u, 'PUT', `/api/clients/${client.id}`, { ...CLIENT_BUSINESS, name: 'Nouveau nom' });
    const { view } = await json(await call(app, u, 'GET', `/api/invoices/${id}`));
    expect(view.company.street).toBe('8 rue de la Fosse');
    expect(view.client.name).toBe('SCI Les Tilleuls');
  });

  it('ne consomme qu’un numéro en cas de double clic (vigilance n° 3)', async () => {
    const { u, client } = await ready();
    const id = await standalone(app, u, client.id);
    const [a, b] = await Promise.all([issue(app, u, id), issue(app, u, id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const next = await json(await issue(app, u, await standalone(app, u, client.id)));
    expect(next.invoice.number).toBe('F-2026-002');
  });

  it('change de suite au 1er janvier à minuit, heure de Paris (vigilance n° 4)', async () => {
    const { u, client } = await ready();
    await issue(app, u, await standalone(app, u, client.id));
    const newYear = testApp(new Date('2026-12-31T23:30:00Z'));
    const r = await json(await issue(newYear, u, await standalone(newYear, u, client.id)));
    expect(r.invoice).toMatchObject({ number: 'F-2027-001', issueDate: '2027-01-01' });
  });

  it('refuse l’émission sans client, sans SIREN pour un professionnel, sans ligne, ou avec une échéance passée', async () => {
    const { u, client } = await ready();
    expect(await json(await issue(app, u, await standalone(app, u, null)))).toMatchObject({ error: 'client_missing' });
    const noSiren = await seedClient(app, u, { ...CLIENT_BUSINESS, siren: '' });
    expect(await json(await issue(app, u, await standalone(app, u, noSiren.id)))).toMatchObject({ error: 'client_siren_required' });
    expect(await json(await issue(app, u, await standalone(app, u, client.id, [])))).toMatchObject({ error: 'no_lines' });
    expect(await json(await issue(app, u, await standalone(app, u, client.id, [line(500, '')])))).toMatchObject({ error: 'missing_designation' });
    expect(await json(await issue(app, u, await standalone(app, u, client.id, [line(12000)], { dueDate: '2026-11-01' })))).toMatchObject({ error: 'due_before_issue' });
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('F-2026-001');
  });
});

describe('acomptes et solde', () => {
  it('déduit les acomptes émis du solde et les fige dans l’instantané', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d1 = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    expect((await json(await issue(app, u, d1.invoice.id))).invoice.number).toBe('F-2026-001');
    const d2 = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 2000 });
    expect((await json(await issue(app, u, d2.invoice.id))).invoice.number).toBe('F-2026-002');
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const r = await json(await issue(app, u, f.invoice.id));
    expect(r.invoice).toMatchObject({ number: 'F-2026-003', totalHtCents: 292000, amountDueCents: 146000 });
    expect(r.view.title).toBe('Facture de solde');
    expect(r.view.deductions.deposits.map((x: { number: string }) => x.number)).toEqual(['F-2026-001', 'F-2026-002']);
    expect(r.view.deductions.remainingCents).toBe(146000);
  });

  it('émet une facture directe (solde sans acompte) titrée « Facture »', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const r = await json(await issue(app, u, f.invoice.id));
    expect(r.view).toMatchObject({ title: 'Facture', deductions: null, totals: { totalDueCents: 292000 } });
  });

  it('bloque un solde inférieur aux acomptes, sans consommer de numéro', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 10000 });
    await issue(app, u, d.invoice.id);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    await call(app, u, 'PUT', `/api/invoices/${f.invoice.id}`, { lines: [line(100000)], serviceDate: null, dueDate: null, notes: '' });
    expect(await json(await issue(app, u, f.invoice.id))).toMatchObject({ error: 'negative_remaining' });
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[1].next).toBe('F-2026-002');
  });

  it('prend l’entreprise et le client au moment de l’émission, les lignes dans l’instantané du devis', async () => {
    const { u, client } = await ready();
    const q = await seedAcceptedQuote(app, u, client.id);
    await call(app, u, 'PUT', `/api/clients/${client.id}`, { ...CLIENT_BUSINESS, city: 'Rezé' });
    await call(app, u, 'PUT', '/api/profile', { ...PROFILE, phone: '07 00 00 00 00' });
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    const r = await json(await issue(app, u, f.invoice.id));
    expect(r.view.client.city).toBe('Rezé');
    expect(r.view.company.phone).toBe('07 00 00 00 00');
    expect(r.view.lines.map((l: { designation: string }) => l.designation)).toEqual(q.view.lines.map((l: { designation: string }) => l.designation));
    expect(r.view.references.quote).toEqual({ number: 'D-2026-001', date: '2026-11-03' });
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:worker -- invoices-issue`
Expected: FAIL (404 sur `/issue`).

- [ ] **Étape 3 : ajouter la route d'émission à `src/worker/routes/invoices.ts`**

Ajouter les imports `addDays`, `yearOf` (dates), `buildDocumentView` (document), `computeBalance` (balance), `lineProblems` (lines), `getClient` (db/clients), `getQuoteRow` (db/quotes), `listIssuedDeposits` (db/invoices), `runIssue` (numbering), puis chaîner :

```ts
  .post('/invoices/:id/issue', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const inv = await requireInvoiceRow(DB, userId, c.req.param('id'));
    if (inv.status !== 'draft' || inv.kind === 'credit') throw new HttpError(409, 'not_draft', 'Cette facture est déjà émise.');
    const profile = await requireCompleteProfile(DB, userId);
    const client = inv.client_id ? await getClient(DB, userId, inv.client_id) : null;
    if (!client) throw new HttpError(409, 'client_missing', 'Choisissez un client avant d’émettre la facture.');
    if (client.type === 'business' && !client.siren) {
      throw new HttpError(409, 'client_siren_required', 'Ajoutez le SIREN de ce client professionnel avant d’émettre la facture.');
    }
    const lines = JSON.parse(inv.lines_json) as Line[];
    const problems = lineProblems(lines);
    if (problems.filledCount === 0) throw new HttpError(409, 'no_lines', 'Ajoutez au moins une ligne remplie.');
    if (problems.missingDesignation.length > 0) {
      throw new HttpError(409, 'missing_designation', `Chaque ligne chiffrée doit avoir une désignation (ligne ${problems.missingDesignation.join(', ')}).`);
    }
    if (computeTotals(lines).totalHtCents <= 0) throw new HttpError(409, 'non_positive_total', 'Le total de la facture doit être positif.');

    const issueDate = today(c);
    const serviceDate = inv.service_date ?? issueDate;
    const dueDate = inv.due_date ?? addDays(issueDate, profile.defaultPaymentDelayDays);
    if (dueDate < issueDate) throw new HttpError(409, 'due_before_issue', 'L’échéance ne peut pas précéder la date d’émission.');

    const quote = inv.quote_id ? await getQuoteRow(DB, userId, inv.quote_id) : null;
    let deducted: Awaited<ReturnType<typeof listIssuedDeposits>> = [];
    let guard: { sql: string; params: (string | number | null)[] } | undefined;
    if (inv.kind === 'final' && quote) {
      if ((await quoteBillingState(DB, userId, quote.id)).draftDepositCount > 0) {
        throw new HttpError(409, 'pending_deposit_draft', 'Émettez ou supprimez d’abord la facture d’acompte en brouillon.');
      }
      deducted = await listIssuedDeposits(DB, userId, quote.id);
      if (computeBalance(computeTotals(lines).totalHtCents, deducted).remainingCents < 0) {
        throw new HttpError(409, 'negative_remaining', 'Le total du solde est inférieur aux acomptes déjà facturés. Ajustez les lignes.');
      }
      // Rien n'a changé dans les acomptes entre la lecture et l'émission.
      guard = {
        sql: `AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.quote_id = d.quote_id AND x.kind = 'deposit' AND x.status = 'draft')
              AND (SELECT COUNT(*) FROM invoices x WHERE x.quote_id = d.quote_id AND x.kind = 'deposit' AND x.status = 'issued') = ?`,
        params: [deducted.length],
      };
    }
    if (inv.kind === 'deposit') {
      guard = { sql: `AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.quote_id = d.quote_id AND x.kind = 'final' AND x.status = 'issued')`, params: [] };
    }

    const view = buildDocumentView({
      kind: inv.kind, number: null, date: issueDate, templateRef: profile.templateRef, profile, client,
      object: inv.object, interventionAddress: inv.intervention_address, lines,
      invoiceDates: { serviceDate, dueDate, notes: inv.notes },
      deductedDeposits: inv.kind === 'final' ? deducted : undefined,
      quoteRef: quote?.number && quote.quote_date ? { number: quote.number, date: quote.quote_date } : null,
    });
    const result = await runIssue(DB, {
      table: 'invoices', docId: inv.id, userId, series: 'F', year: yearOf(issueDate), prefix: profile.prefixInvoice,
      set: {
        status: 'issued', issue_date: issueDate, service_date: serviceDate, due_date: dueDate,
        total_ht_cents: view.totals.totalHtCents, amount_due_cents: view.totals.totalDueCents, updated_at: nowIso(c),
      },
      snapshotJson: JSON.stringify(view),
      guard,
    });
    if (!result.issued) throw new HttpError(409, 'not_draft', 'Cette facture a changé entre-temps (déjà émise, ou acomptes modifiés). Rechargez la page.');
    return respondInvoice(c, inv.id);
  })
```

- [ ] **Étape 4 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "feat: émission figée et numérotée des factures, déduction des acomptes"
```

**Critère de fin :** l'émission attribue un numéro F continu, fige un instantané complet, applique toutes les règles de cohérence et ne consomme aucun numéro en cas de refus ou de double clic.

---

### Tâche 20 : paiement et avoirs

**Fichiers :**
- Modifier : `src/worker/routes/invoices.ts`, `test/worker/isolation.test.ts`
- Tests : `test/worker/credit-notes.test.ts`

**Interfaces :**
- Consomme : `buildCreditView`, `parseSnapshot` (tâche 14) ; `runIssue` (tâche 13) ; `quoteBillingState` (tâche 18).
- Produit (API) : `PUT /api/invoices/:id/payment { paidAt: 'AAAA-MM-JJ' | null }` → `InvoiceResponse` (409 `not_payable`, 409 `paid_before_issue`) ; `POST /api/invoices/:id/credit-note` → `201 InvoiceResponse` de l'avoir (409 `not_creditable`, 409 `deposit_deducted`).
- Atomicité de l'avoir : un seul batch = annulation gardée de la facture (`status = 'issued'`, et pour un acompte : aucun solde émis), insertion de l'avoir **seulement si** l'annulation a eu lieu (`credited_by_id` = id de l'avoir), puis numérotation A gardée. Si la facture n'est plus annulable, rien ne change et aucun numéro A n'est consommé.

- [ ] **Étape 1 : écrire le test qui échoue**

`test/worker/credit-notes.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createDeposit, seedAcceptedQuote, seedClient, seedProfile } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();
const line = (cents: number) => ({ id: crypto.randomUUID(), designation: 'Travaux', quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function issuedStandalone() {
  const u = await createAllowedUser('karim@example.test');
  await seedProfile(app, u);
  const client = await seedClient(app, u);
  const created = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
  await call(app, u, 'PUT', `/api/invoices/${created.invoice.id}`, { clientId: client.id, object: 'Dépannage', lines: [line(72000)], serviceDate: null, dueDate: null, notes: '' });
  await call(app, u, 'POST', `/api/invoices/${created.invoice.id}/issue`);
  return { u, client, id: created.invoice.id as string };
}

describe('paiement', () => {
  it('marque une facture émise payée, puis annule le paiement', async () => {
    const { u, id } = await issuedStandalone();
    const paid = await json(await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-11-03' }));
    expect(paid.invoice).toMatchObject({ paidAt: '2026-11-03', display: 'paid' });
    expect((await json(await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: null }))).invoice.display).toBe('to_pay');
  });

  it('refuse un paiement sur un brouillon ou antérieur à l’émission', async () => {
    const { u, id } = await issuedStandalone();
    expect(await json(await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-10-01' }))).toMatchObject({ error: 'paid_before_issue' });
    const draft = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
    expect(await json(await call(app, u, 'PUT', `/api/invoices/${draft.invoice.id}/payment`, { paidAt: '2026-11-03' }))).toMatchObject({ error: 'not_payable' });
  });
});

describe('avoirs', () => {
  it('annule entièrement une facture : numéro A, montant négatif, référence à la facture', async () => {
    const { u, id } = await issuedStandalone();
    const res = await call(app, u, 'POST', `/api/invoices/${id}/credit-note`);
    expect(res.status).toBe(201);
    const credit = await json(res);
    expect(credit.invoice).toMatchObject({ kind: 'credit', status: 'issued', number: 'A-2026-001', totalHtCents: -72000, amountDueCents: -72000, display: 'credit' });
    expect(credit.view).toMatchObject({ title: 'Avoir', number: 'A-2026-001', references: { creditedInvoice: { number: 'F-2026-001', date: '2026-11-03' } } });
    expect(credit.links.creditedInvoice).toEqual({ id, number: 'F-2026-001' });
    const original = await json(await call(app, u, 'GET', `/api/invoices/${id}`));
    expect(original.invoice).toMatchObject({ status: 'cancelled', display: 'cancelled' });
    expect(original.links.creditNote).toEqual({ id: credit.invoice.id, number: 'A-2026-001' });
  });

  it('ne crée qu’un avoir par facture, même en cas de double clic (vigilance n° 3)', async () => {
    const { u, id } = await issuedStandalone();
    const [a, b] = await Promise.all([call(app, u, 'POST', `/api/invoices/${id}/credit-note`), call(app, u, 'POST', `/api/invoices/${id}/credit-note`)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await json(await call(app, u, 'GET', '/api/numbering'))).series[2].next).toBe('A-2026-002');
  });

  it('refuse un avoir sur un brouillon ou sur un avoir, et un avoir ne se supprime pas', async () => {
    const { u, id } = await issuedStandalone();
    const draft = await json(await call(app, u, 'POST', '/api/invoices/standalone', {}));
    expect(await json(await call(app, u, 'POST', `/api/invoices/${draft.invoice.id}/credit-note`))).toMatchObject({ error: 'not_creditable' });
    const credit = await json(await call(app, u, 'POST', `/api/invoices/${id}/credit-note`));
    expect((await call(app, u, 'POST', `/api/invoices/${credit.invoice.id}/credit-note`)).status).toBe(409);
    expect((await call(app, u, 'DELETE', `/api/invoices/${credit.invoice.id}`)).status).toBe(409);
  });

  it('annule une facture payée en gardant la date de paiement', async () => {
    const { u, id } = await issuedStandalone();
    await call(app, u, 'PUT', `/api/invoices/${id}/payment`, { paidAt: '2026-11-03' });
    await call(app, u, 'POST', `/api/invoices/${id}/credit-note`);
    expect((await json(await call(app, u, 'GET', `/api/invoices/${id}`))).invoice).toMatchObject({ status: 'cancelled', paidAt: '2026-11-03' });
  });

  it('protège un acompte déduit par un solde émis, puis permet un nouveau solde après annulation', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedAcceptedQuote(app, u, client.id);
    const d = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    await call(app, u, 'POST', `/api/invoices/${d.invoice.id}/issue`);
    const f = await json(await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`));
    await call(app, u, 'POST', `/api/invoices/${f.invoice.id}/issue`);

    expect(await json(await call(app, u, 'POST', `/api/invoices/${d.invoice.id}/credit-note`))).toMatchObject({ error: 'deposit_deducted' });

    const creditFinal = await json(await call(app, u, 'POST', `/api/invoices/${f.invoice.id}/credit-note`));
    expect(creditFinal.view.totals).toEqual({ totalHtCents: -292000, vatCents: 0, totalDueCents: -204400 });
    expect((await call(app, u, 'POST', `/api/invoices/${d.invoice.id}/credit-note`)).status).toBe(201);
    expect((await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`)).status).toBe(201);
  });
});
```

Ajouter à `test/worker/isolation.test.ts` :

```ts
it('interdit de payer ou d’annuler la facture d’un autre utilisateur', async () => {
  const { a, b } = await twoUsers(app);
  const client = await seedClient(app, a);
  const created = await json(await call(app, a, 'POST', '/api/invoices/standalone', { clientId: client.id }));
  await call(app, a, 'PUT', `/api/invoices/${created.invoice.id}`, { lines: [{ id: 'l', designation: 'X', quantityMilli: 1000, unit: 'u', unitPriceCents: 100, vatRate: null }], serviceDate: null, dueDate: null, notes: '' });
  expect((await call(app, b, 'POST', `/api/invoices/${created.invoice.id}/issue`)).status).toBe(404);
  await call(app, a, 'POST', `/api/invoices/${created.invoice.id}/issue`);
  expect((await call(app, b, 'PUT', `/api/invoices/${created.invoice.id}/payment`, { paidAt: '2026-11-03' })).status).toBe(404);
  expect((await call(app, b, 'POST', `/api/invoices/${created.invoice.id}/credit-note`)).status).toBe(404);
  expect((await json(await call(app, b, 'GET', '/api/numbering'))).series[2].next).toBe('A-2026-001');
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:worker -- credit-notes isolation`
Expected: FAIL.

- [ ] **Étape 3 : ajouter les routes de paiement et d'avoir**

Ajouter les imports `isIsoDate` (dates) et `buildCreditView` (document), puis chaîner dans `invoiceRoutes` :

```ts
  .put('/invoices/:id/payment', validate('json', z.object({ paidAt: z.string().refine(isIsoDate).nullable() })), async (c) => {
    const row = await requireInvoiceRow(c.env.DB, c.var.user.id, c.req.param('id'));
    const notPayable = new HttpError(409, 'not_payable', 'Seule une facture émise et non annulée peut être marquée payée.');
    if (row.status !== 'issued' || row.kind === 'credit') throw notPayable;
    const { paidAt } = c.req.valid('json');
    if (paidAt && row.issue_date && paidAt < row.issue_date) throw new HttpError(409, 'paid_before_issue', 'La date de paiement précède la date d’émission.');
    const res = await c.env.DB.prepare(
      "UPDATE invoices SET paid_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'issued' AND kind != 'credit'",
    ).bind(paidAt, nowIso(c), row.id, c.var.user.id).run();
    if (res.meta.changes === 0) throw notPayable;
    return respondInvoice(c, row.id);
  })

  .post('/invoices/:id/credit-note', async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const orig = await requireInvoiceRow(DB, userId, c.req.param('id'));
    const notCreditable = new HttpError(409, 'not_creditable', 'Seule une facture émise et non annulée peut recevoir un avoir.');
    if (orig.kind === 'credit' || orig.status !== 'issued' || !orig.snapshot_json || !orig.number || !orig.issue_date) throw notCreditable;
    if (orig.kind === 'deposit' && orig.quote_id) {
      const state = await quoteBillingState(DB, userId, orig.quote_id);
      if (state.activeFinal?.status === 'issued') {
        throw new HttpError(409, 'deposit_deducted', 'Cet acompte est déduit par la facture de solde : annulez d’abord le solde par un avoir.');
      }
    }
    const profile = await requireCompleteProfile(DB, userId);
    const client = orig.client_id ? await getClient(DB, userId, orig.client_id) : null;
    const issueDate = today(c);
    const view = buildCreditView(parseSnapshot(orig.snapshot_json), {
      date: issueDate, templateRef: profile.templateRef, profile, client, creditedRef: { number: orig.number, date: orig.issue_date },
    });
    const creditId = crypto.randomUUID();
    const now = nowIso(c);
    const before = [
      // 1. Annule la facture d'origine si elle est encore annulable, en la reliant à l'avoir.
      DB.prepare(
        `UPDATE invoices SET status = 'cancelled', cancelled_at = ?, credited_by_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'issued' AND kind != 'credit'
           AND NOT (kind = 'deposit' AND EXISTS (SELECT 1 FROM invoices f WHERE f.quote_id = invoices.quote_id AND f.kind = 'final' AND f.status = 'issued'))`,
      ).bind(now, creditId, now, orig.id, userId),
      // 2. Crée l'avoir en brouillon seulement si l'annulation ci-dessus a eu lieu.
      DB.prepare(
        `INSERT INTO invoices (id, user_id, kind, quote_id, credited_invoice_id, client_id, status, object, intervention_address, lines_json, total_ht_cents, amount_due_cents, created_at, updated_at)
         SELECT ?, ?, 'credit', ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM invoices WHERE id = ? AND user_id = ? AND credited_by_id = ?)`,
      ).bind(creditId, userId, orig.quote_id, orig.id, orig.client_id, view.object, view.interventionAddress, JSON.stringify(view.lines),
        view.totals.totalHtCents, view.totals.totalDueCents, now, now, orig.id, userId, creditId),
    ];
    // 3. Numérote l'avoir (série A) dans le même batch.
    const result = await runIssue(DB, {
      table: 'invoices', docId: creditId, userId, series: 'A', year: yearOf(issueDate), prefix: profile.prefixCredit,
      set: { status: 'issued', issue_date: issueDate, updated_at: now }, snapshotJson: JSON.stringify(view),
    }, { before });
    if (!result.issued) throw notCreditable;
    return respondInvoice(c, creditId, 201);
  })
```

- [ ] **Étape 4 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "feat: paiement des factures et avoirs totaux atomiques"
```

**Critère de fin :** paiement réversible ; avoir total numéroté A, négatif, relié à sa facture ; un seul avoir par facture ; acompte protégé tant qu'un solde émis le déduit ; nouvelle facture de solde possible après annulation.

---

### Tâche 21 : écran « Facturation » d'un devis accepté

**Fichiers :**
- Créer : `src/worker/routes/billing.ts`, `src/web/billing/depositPreview.ts`, `src/web/billing/DepositPanel.tsx`, `src/web/pages/QuoteBillingPage.tsx`, `src/web/pages/QuoteBillingPage.css`
- Modifier : `src/worker/app.ts`, `src/shared/api-types.ts`, `src/web/pages/QuoteEditorPage.tsx`, `src/web/App.tsx`, `test/worker/isolation.test.ts`
- Tests : `test/worker/billing.test.ts`, `src/web/billing/depositPreview.test.ts`, `src/web/billing/DepositPanel.test.tsx`

**Maquette :** `docs/maquettes/Facturation.dc.html`.

**Interfaces :**
- Consomme : `quoteBillingState`, `listInvoices` (tâche 18) ; `depositAmountCents`, `DepositInput` (tâche 12) ; `INVOICE_DISPLAY`, `INVOICE_KIND_LABEL`.
- Produit (API) : `GET /api/quotes/:id/billing` → `BillingSummary` (409 `quote_not_accepted`).
- Produit (`api-types.ts`) : `type BillingSummary = { quote: { id: string; number: string; acceptedAt: string; clientName: string; object: string; totalCents: number; plannedDepositBp: number | null; lineCount: number }; invoices: InvoiceListItem[]; invoicedDepositsCents: number; issuedDepositsCents: number; remainingToInvoiceCents: number; activeFinal: { id: string; status: InvoiceStatus } | null; draftDepositCount: number; canCreateDeposit: boolean; canPrepareFinal: boolean }`.
- Produit (front) : `depositPreview(totalCents, alreadyCents, mode: 'percent' | 'amount', raw: string): { input: DepositInput | null; amountCents: number | null; remainingAfterCents: number | null; error: string | null }` ; `percentInput(bp: number): string` ; `<DepositPanel totalCents alreadyInvoicedCents defaultBp disabledReason pending onCreate />`.

- [ ] **Étape 1 : écrire les tests qui échouent**

`test/worker/billing.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { createDeposit, seedAcceptedQuote, seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp();

describe('GET /api/quotes/:id/billing', () => {
  it('résume la facturation d’un devis accepté', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedAcceptedQuote(app, u, client.id);
    const d1 = await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 3000 });
    await call(app, u, 'POST', `/api/invoices/${d1.invoice.id}/issue`);
    await createDeposit(app, u, q.quote.id, { mode: 'percent', basisPoints: 2000 });
    const b = await json(await call(app, u, 'GET', `/api/quotes/${q.quote.id}/billing`));
    expect(b).toMatchObject({
      quote: { number: 'D-2026-001', clientName: 'SCI Les Tilleuls', totalCents: 292000, plannedDepositBp: 3000, lineCount: 5 },
      invoicedDepositsCents: 146000, issuedDepositsCents: 87600, remainingToInvoiceCents: 146000,
      activeFinal: null, draftDepositCount: 1, canCreateDeposit: true, canPrepareFinal: false,
    });
    expect(b.invoices).toHaveLength(2);
  });

  it('ferme les acomptes une fois le solde préparé', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedAcceptedQuote(app, u, client.id);
    await call(app, u, 'POST', `/api/quotes/${q.quote.id}/final`);
    expect(await json(await call(app, u, 'GET', `/api/quotes/${q.quote.id}/billing`))).toMatchObject({ canCreateDeposit: false, canPrepareFinal: false, activeFinal: { status: 'draft' } });
  });

  it('répond 409 pour un devis non accepté', async () => {
    const u = await createAllowedUser('karim@example.test');
    await seedProfile(app, u);
    const client = await seedClient(app, u);
    const q = await seedQuote(app, u, { clientId: client.id, status: 'sent' });
    expect((await call(app, u, 'GET', `/api/quotes/${q.quote.id}/billing`)).status).toBe(409);
  });
});
```

Ajouter à `test/worker/isolation.test.ts` :

```ts
it('cache la facturation d’un devis d’un autre utilisateur', async () => {
  const { a, b } = await twoUsers(app);
  const client = await seedClient(app, a);
  const q = await seedAcceptedQuote(app, a, client.id);
  expect((await call(app, b, 'GET', `/api/quotes/${q.quote.id}/billing`)).status).toBe(404);
});
```

`src/web/billing/depositPreview.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { depositPreview, percentInput } from './depositPreview';

describe('depositPreview (maquette : devis de 4 000 €, 1 200 € déjà facturés)', () => {
  it('calcule le montant et le reste à facturer', () => {
    expect(depositPreview(400000, 120000, 'percent', '20')).toMatchObject({ input: { mode: 'percent', basisPoints: 2000 }, amountCents: 80000, remainingAfterCents: 200000, error: null });
    expect(depositPreview(400000, 120000, 'percent', '12,5 %').amountCents).toBe(50000);
    expect(depositPreview(400000, 120000, 'amount', '1 000').input).toEqual({ mode: 'amount', cents: 100000 });
  });

  it('refuse un dépassement et les saisies invalides', () => {
    expect(depositPreview(400000, 120000, 'amount', '3000')).toMatchObject({ input: null, error: expect.stringContaining('Dépasse') });
    expect(depositPreview(400000, 120000, 'percent', '0').error).not.toBeNull();
    expect(depositPreview(400000, 120000, 'amount', '12,345').error).not.toBeNull();
    expect(depositPreview(400000, 120000, 'percent', '')).toEqual({ input: null, amountCents: null, remainingAfterCents: null, error: null });
  });

  it('écrit un pourcentage modifiable', () => {
    expect(percentInput(2000)).toBe('20');
    expect(percentInput(1250)).toBe('12,5');
  });
});
```

`src/web/billing/DepositPanel.test.tsx` :

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DepositPanel } from './DepositPanel';

const plain = (s: string | null) => (s ?? '').replace(/[\u202F\u00A0]/g, ' ').replace(/\u2212/g, '-');

it('reprend la maquette et crée un acompte en montant fixe', async () => {
  const onCreate = vi.fn();
  render(<DepositPanel totalCents={400000} alreadyInvoicedCents={120000} defaultBp={2000} onCreate={onCreate} />);
  expect(plain(screen.getByTestId('deposit-amount').textContent)).toBe('800,00 €');
  expect(plain(screen.getByTestId('deposit-remaining').textContent)).toBe('2 000,00 €');
  await userEvent.click(screen.getByRole('radio', { name: 'Montant' }));
  const input = screen.getByLabelText('Montant HT');
  await userEvent.type(input, '3000');
  expect(screen.getByRole('alert')).toHaveTextContent('Dépasse');
  expect(screen.getByRole('button', { name: 'Créer la facture d’acompte' })).toBeDisabled();
  await userEvent.clear(input);
  await userEvent.type(input, '500');
  await userEvent.click(screen.getByRole('button', { name: 'Créer la facture d’acompte' }));
  expect(onCreate).toHaveBeenCalledWith({ mode: 'amount', cents: 50000 });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run: `npm run test:worker -- billing isolation && npm run test:unit -- src/web/billing`
Expected: FAIL.

- [ ] **Étape 3 : écrire la route de synthèse**

Ajouter `BillingSummary` (voir Interfaces) à `src/shared/api-types.ts`.

`src/worker/routes/billing.ts` :

```ts
import { Hono } from 'hono';
import type { BillingSummary } from '../../shared/api-types';
import { todayInParis } from '../../shared/dates';
import { parseSnapshot } from '../../shared/document';
import { listInvoices, quoteBillingState } from '../db/invoices';
import { requireQuoteRow } from '../db/quotes';
import { HttpError } from '../errors';
import type { AppEnv } from '../types';

export const billingRoutes = new Hono<AppEnv>().get('/quotes/:id/billing', async (c) => {
  const { DB } = c.env;
  const userId = c.var.user.id;
  const row = await requireQuoteRow(DB, userId, c.req.param('id'));
  if (row.status !== 'accepted' || !row.snapshot_json || !row.number || !row.accepted_at) {
    throw new HttpError(409, 'quote_not_accepted', 'Seul un devis accepté peut être facturé.');
  }
  const snap = parseSnapshot(row.snapshot_json);
  const total = snap.totals.totalDueCents;
  const state = await quoteBillingState(DB, userId, row.id);
  const invoiced = state.depositAmounts.reduce((s, x) => s + x, 0);
  const body: BillingSummary = {
    quote: {
      id: row.id, number: row.number, acceptedAt: row.accepted_at, clientName: snap.client?.name ?? '', object: snap.object,
      totalCents: total, plannedDepositBp: row.planned_deposit_bp, lineCount: snap.lines.length,
    },
    invoices: await listInvoices(DB, userId, { quoteId: row.id }, todayInParis(c.var.deps.now())),
    invoicedDepositsCents: invoiced,
    issuedDepositsCents: state.issuedDepositsCents,
    remainingToInvoiceCents: total - invoiced,
    activeFinal: state.activeFinal,
    draftDepositCount: state.draftDepositCount,
    canCreateDeposit: !state.activeFinal && invoiced < total,
    canPrepareFinal: !state.activeFinal && state.draftDepositCount === 0,
  };
  return c.json(body);
});
```

Brancher : `api.route('/', billingRoutes);`

- [ ] **Étape 4 : écrire l'aperçu et le panneau d'acompte**

`src/web/billing/depositPreview.ts` :

```ts
import { depositAmountCents, type DepositInput } from '../../shared/deposits';
import { formatEuros, parseEuros, parsePercent } from '../../shared/money';

export type DepositMode = 'percent' | 'amount';
type Preview = { input: DepositInput | null; amountCents: number | null; remainingAfterCents: number | null; error: string | null };

export const percentInput = (bp: number) => String(bp / 100).replace('.', ',');

export function depositPreview(totalCents: number, alreadyCents: number, mode: DepositMode, raw: string): Preview {
  const empty: Preview = { input: null, amountCents: null, remainingAfterCents: null, error: null };
  if (raw.trim() === '') return empty;
  let input: DepositInput;
  if (mode === 'percent') {
    const bp = parsePercent(raw);
    if (bp === null) return { ...empty, error: 'Pourcentage invalide : entre 0 et 100, 2 décimales au plus.' };
    input = { mode, basisPoints: bp };
  } else {
    const cents = parseEuros(raw);
    if (cents === null || cents <= 0) return { ...empty, error: 'Montant invalide : positif, 2 décimales au plus.' };
    input = { mode, cents };
  }
  const amountCents = depositAmountCents(totalCents, input);
  const remaining = totalCents - alreadyCents;
  if (amountCents <= 0) return { ...empty, amountCents, error: 'Le montant de l’acompte doit être positif.' };
  if (amountCents > remaining) {
    return { input: null, amountCents, remainingAfterCents: remaining - amountCents, error: `Dépasse le reste à facturer (${formatEuros(remaining)}).` };
  }
  return { input, amountCents, remainingAfterCents: remaining - amountCents, error: null };
}
```

`src/web/billing/DepositPanel.tsx` (panneau « Nouvel acompte » de la maquette : fond `#EBEEFF`, sélecteur Pourcentage / Montant sur fond `#D9DEFA`) :

```tsx
import { useState } from 'react';
import type { DepositInput } from '../../shared/deposits';
import { formatEuros } from '../../shared/money';
import { depositPreview, percentInput, type DepositMode } from './depositPreview';

type Props = {
  totalCents: number;
  alreadyInvoicedCents: number;
  defaultBp: number | null;
  disabledReason?: string | null;
  pending?: boolean;
  onCreate: (input: DepositInput) => void;
};

export function DepositPanel({ totalCents, alreadyInvoicedCents, defaultBp, disabledReason, pending, onCreate }: Props) {
  const [mode, setMode] = useState<DepositMode>('percent');
  const [raw, setRaw] = useState(defaultBp ? percentInput(defaultBp) : '');
  const p = depositPreview(totalCents, alreadyInvoicedCents, mode, raw);
  const label = mode === 'percent' ? 'Pourcentage du total' : 'Montant HT';
  const pick = (m: DepositMode) => { setMode(m); setRaw(''); };
  return (
    <aside aria-labelledby="h-acompte" className="deposit-panel">
      <h2 id="h-acompte" className="card-title">Nouvel acompte</h2>
      <div role="radiogroup" aria-label="Type de montant" className="segmented">
        <button type="button" role="radio" aria-checked={mode === 'percent'} onClick={() => pick('percent')}>Pourcentage</button>
        <button type="button" role="radio" aria-checked={mode === 'amount'} onClick={() => pick('amount')}>Montant</button>
      </div>
      <label className="field">{label}
        <input className="input" aria-label={label} inputMode="decimal" value={raw} aria-invalid={p.error ? true : undefined} onChange={(e) => setRaw(e.target.value)} />
      </label>
      <div className="deposit-row"><span>Montant facturé</span><strong data-testid="deposit-amount">{p.amountCents === null ? '—' : formatEuros(p.amountCents)}</strong></div>
      <div className="deposit-row"><span>Restera à facturer</span><strong data-testid="deposit-remaining">{p.remainingAfterCents === null ? formatEuros(totalCents - alreadyInvoicedCents) : formatEuros(p.remainingAfterCents)}</strong></div>
      {p.error && <p className="field-error" role="alert">{p.error}</p>}
      {disabledReason && <p className="field-hint">{disabledReason}</p>}
      <button type="button" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={!p.input || !!disabledReason || pending} onClick={() => p.input && onCreate(p.input)}>
        Créer la facture d’acompte
      </button>
      <p className="deposit-note">Elle est créée en brouillon. Le numéro est attribué à l’émission, ensuite elle ne se modifie plus.</p>
    </aside>
  );
}
```

- [ ] **Étape 5 : écrire la page Facturation**

`src/web/pages/QuoteBillingPage.tsx` (structure de `Facturation.dc.html` : en-tête numéro + badge « Accepté le … » + « client · objet » + bouton « Voir le devis figé » ; section « Où en est la facturation » avec barre de progression et trois chiffres ; colonne « Factures liées » avec une carte par facture et une carte en pointillés « Facture de solde » tant qu'il n'y a pas de solde actif ; panneau « Nouvel acompte ») :

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { BillingSummary, InvoiceListItem, InvoiceResponse } from '../../shared/api-types';
import { formatDateShort, todayInParis } from '../../shared/dates';
import type { DepositInput } from '../../shared/deposits';
import { formatEuros, formatPercent } from '../../shared/money';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL } from '../../shared/status';
import { api } from '../api';
import { DepositPanel } from '../billing/DepositPanel';
import { StatusBadge } from '../components/StatusBadge';
import './QuoteBillingPage.css';

function subtitle(i: InvoiceListItem): string {
  if (i.status === 'draft') return 'Brouillon : numéro attribué à l’émission';
  if (i.kind === 'credit') return `Émis le ${formatDateShort(i.issueDate!)}`;
  if (i.status === 'cancelled') return 'Annulée par avoir';
  return `Émise le ${formatDateShort(i.issueDate!)} · échéance ${formatDateShort(i.dueDate!)}`;
}

export function QuoteBillingPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: ['billing', id], queryFn: () => api<BillingSummary>('GET', `/api/quotes/${id}/billing`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['billing', id] });
  const createDeposit = useMutation({
    mutationFn: (input: DepositInput) => api<InvoiceResponse>('POST', `/api/quotes/${id}/deposits`, input),
    onSuccess: (r) => navigate(`/factures/${r.invoice.id}`),
  });
  const prepareFinal = useMutation({
    mutationFn: () => api<InvoiceResponse>('POST', `/api/quotes/${id}/final`),
    onSuccess: (r) => navigate(`/factures/${r.invoice.id}`),
  });
  const markPaid = useMutation({
    mutationFn: (invoiceId: string) => api('PUT', `/api/invoices/${invoiceId}/payment`, { paidAt: todayInParis(new Date()) }),
    onSuccess: refresh,
  });

  if (billing.isPending) return <p className="page-intro">Chargement…</p>;
  if (billing.error) return <p className="notice notice-error" role="alert">{billing.error.message}</p>;
  const b = billing.data;
  const pct = b.quote.totalCents > 0 ? Math.min(100, Math.round((b.invoicedDepositsCents / b.quote.totalCents) * 100)) : 0;
  const issuedDeposits = b.invoices.filter((i) => i.kind === 'deposit' && i.status === 'issued').map((i) => i.number);
  const error = createDeposit.error ?? prepareFinal.error ?? markPaid.error;

  return (
    <div className="page">
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="actions" style={{ alignItems: 'center' }}>
            <h1 className="page-title" style={{ fontSize: 32 }}>{b.quote.number}</h1>
            <span className="badge tone-ok">Accepté le {formatDateShort(todayInParis(new Date(b.quote.acceptedAt)))}</span>
          </div>
          <p className="page-intro">{b.quote.clientName} · {b.quote.object}</p>
        </div>
        <Link className="btn btn-secondary" to={`/imprimer/devis/${id}`}>Voir le devis figé</Link>
      </div>
      {error && <p className="notice notice-error" role="alert">{error.message}</p>}

      <section className="card" aria-labelledby="h-prog" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
        <h2 id="h-prog" className="card-title">Où en est la facturation</h2>
        <div role="img" aria-label={`${formatEuros(b.invoicedDepositsCents)} facturés en acomptes sur ${formatEuros(b.quote.totalCents)}, soit ${pct} %`} className="progress"><div style={{ width: `${pct}%` }} /></div>
        <div className="figures">
          <div><span>Total du devis</span><strong>{formatEuros(b.quote.totalCents)}</strong></div>
          <div><span>Déjà facturé en acomptes</span><strong className="figure-accent">{formatEuros(b.invoicedDepositsCents)}</strong></div>
          <div><span>Reste à facturer</span><strong>{formatEuros(b.remainingToInvoiceCents)}</strong></div>
        </div>
      </section>

      <div className="editor">
        <section aria-labelledby="h-docs" className="editor-main" style={{ gap: 12 }}>
          <h2 id="h-docs" className="card-title">Factures liées</h2>
          {b.invoices.map((i) => (
            <article key={i.id} className={i.status === 'draft' ? 'bill-card bill-card--draft' : 'bill-card'}>
              <div className="bill-icon" aria-hidden="true">{i.kind === 'deposit' && i.depositBp ? formatPercent(i.depositBp) : '▤'}</div>
              <div className="bill-main">
                <span className="bill-title">{i.number ? `${i.number} · ` : ''}{INVOICE_KIND_LABEL[i.kind]}</span>
                <span className="bill-sub">{subtitle(i)}</span>
              </div>
              <span className="bill-amount">{formatEuros(i.amountDueCents)}</span>
              <StatusBadge {...INVOICE_DISPLAY[i.display]} />
              {(i.display === 'to_pay' || i.display === 'late') && (
                <button type="button" className="btn btn-secondary" style={{ height: 40 }} onClick={() => markPaid.mutate(i.id)}>Marquer payée</button>
              )}
              <Link className="btn btn-secondary" style={{ height: 40 }} to={`/factures/${i.id}`}>Ouvrir</Link>
            </article>
          ))}
          {!b.activeFinal && (
            <article className="bill-card bill-card--draft">
              <div className="bill-icon" aria-hidden="true">▤</div>
              <div className="bill-main">
                <span className="bill-title">Facture de solde</span>
                <span className="bill-sub">
                  Reprend les {b.quote.lineCount} lignes du devis{issuedDeposits.length > 0 ? ` et déduit ${issuedDeposits.length > 1 ? 'les acomptes' : 'l’acompte'} ${issuedDeposits.join(', ')}` : ''}.
                </span>
              </div>
              <span className="bill-amount">{formatEuros(b.quote.totalCents - b.issuedDepositsCents)}</span>
              <button type="button" className="btn btn-primary" style={{ height: 40 }} disabled={!b.canPrepareFinal || prepareFinal.isPending}
                title={b.draftDepositCount > 0 ? 'Émettez ou supprimez d’abord l’acompte en brouillon.' : undefined} onClick={() => prepareFinal.mutate()}>
                Préparer le solde
              </button>
            </article>
          )}
        </section>
        <div className="editor-aside">
          <DepositPanel
            totalCents={b.quote.totalCents}
            alreadyInvoicedCents={b.invoicedDepositsCents}
            defaultBp={b.quote.plannedDepositBp}
            disabledReason={b.activeFinal ? 'Une facture de solde existe : plus d’acompte possible.' : null}
            pending={createDeposit.isPending}
            onCreate={(input) => createDeposit.mutate(input)}
          />
        </div>
      </div>
    </div>
  );
}
```

`src/web/pages/QuoteBillingPage.css` :

```css
.progress { height: 14px; border-radius: 999px; background: var(--c-border-soft); overflow: hidden; display: flex; }
.progress > div { background: var(--c-primary); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
.figures > div { display: flex; flex-direction: column; gap: 4px; }
.figures span { font-size: 14px; color: var(--c-text-muted); font-weight: 600; }
.figures strong { font-family: var(--font-display); font-size: 26px; }
.figure-accent { color: var(--c-primary-strong); }
.bill-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: 18px 20px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.bill-card--draft { border: 1.5px dashed var(--c-placeholder); }
.bill-icon { width: 40px; height: 40px; border-radius: var(--radius-md); background: var(--c-primary-soft); color: var(--c-primary-strong); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
.bill-card--draft .bill-icon { background: var(--c-border-soft); color: var(--c-text-soft); }
.bill-main { flex: 1 1 220px; display: flex; flex-direction: column; gap: 3px; }
.bill-title { font-weight: 700; }
.bill-sub { font-size: 14px; color: var(--c-text-muted); }
.bill-amount { font-weight: 700; font-variant-numeric: tabular-nums; }
.deposit-panel { background: var(--c-primary-soft); border-radius: var(--radius-xl); padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.segmented { display: flex; background: var(--c-primary-panel); border-radius: var(--radius-md); padding: 4px; }
.segmented button { flex: 1; height: 40px; border-radius: 9px; border: none; background: transparent; color: var(--c-text-ink); font-family: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
.segmented button[aria-checked='true'] { background: #FFFFFF; color: var(--c-text); }
.deposit-row { display: flex; justify-content: space-between; font-size: 15px; }
.deposit-row span { color: var(--c-text-ink); }
.deposit-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--c-text-soft); }
```

Dans `QuoteEditorPage.tsx`, pour un devis `accepted`, ajouter avant « Dupliquer » le lien principal `<Link className="btn btn-primary" to={`/devis/${q.id}/facturation`}>Facturer</Link>`. Route dans la coquille : `<Route path="devis/:id/facturation" element={<QuoteBillingPage />} />`.

- [ ] **Étape 6 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 7 : vérifier à la main**

Devis accepté de 4 000 € : acompte 30 % → brouillon ouvert, émettre (tâche 22) puis revenir : barre à 30 %, « Déjà facturé en acomptes 1 200,00 € », « Reste à facturer 2 800,00 € » ; panneau à 20 % → 800,00 € / 2 000,00 €. Comparer à `Facturation.dc.html`.

- [ ] **Étape 8 : commit**

```bash
git add -A
git commit -m "feat: écran de facturation d'un devis accepté (acomptes, solde, suivi)"
```

**Critère de fin :** depuis un devis accepté, l'utilisateur voit où en est la facturation, crée un acompte en pourcentage ou en montant avec aperçu exact, prépare le solde, marque un acompte payé.

---

### Tâche 22 : écrans des factures (édition, émission, paiement, avoir, liste)

**Fichiers :**
- Créer : `src/web/invoices/invoiceForm.ts`, `src/web/invoices/InvoiceForm.tsx`, `src/web/pages/InvoicePage.tsx`, `src/web/pages/InvoicesListPage.tsx`
- Modifier : `src/web/App.tsx`
- Tests : `src/web/invoices/invoiceForm.test.ts`

**Interfaces :**
- Consomme : `InvoiceResponse`, `InvoiceListItem`, `InvoiceDraftInput`, `EDITABLE_FIELDS` ; `LinesEditor`, `useAutosave`, `draftFromLine`, `draftsToLines`, `liveTotals` ; `DocumentRenderer`, `DocumentToolbar`, `getTemplate`, `useTemplateFonts` ; `Dialog`, `StatusBadge`.
- Produit (`invoiceForm.ts`) : `type InvoiceAction = 'issue' | 'delete' | 'pay' | 'unpay' | 'credit'` ; `invoiceActions(i: { kind; status; paidAt }): InvoiceAction[]` ; `type InvoiceFormState` ; `initialInvoiceForm(inv: InvoiceDto): InvoiceFormState` ; `invoicePayload(kind, form): InvoiceDraftInput | null` (seulement les champs autorisés pour ce type).

- [ ] **Étape 1 : écrire le test qui échoue**

`src/web/invoices/invoiceForm.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { blankDraft } from '../lines/lineDrafts';
import { invoiceActions, invoicePayload, type InvoiceFormState } from './invoiceForm';

const form: InvoiceFormState = {
  clientId: 'c1', object: 'Dépannage', interventionAddress: '', drafts: [{ ...blankDraft(), designation: 'A', unitPrice: '120' }],
  serviceDate: '2026-11-02', dueDate: '', notes: '',
};

describe('invoiceActions', () => {
  it('suit le statut et le paiement', () => {
    expect(invoiceActions({ kind: 'standalone', status: 'draft', paidAt: null })).toEqual(['issue', 'delete']);
    expect(invoiceActions({ kind: 'deposit', status: 'issued', paidAt: null })).toEqual(['pay', 'credit']);
    expect(invoiceActions({ kind: 'deposit', status: 'issued', paidAt: '2026-11-03' })).toEqual(['unpay', 'credit']);
    expect(invoiceActions({ kind: 'final', status: 'cancelled', paidAt: null })).toEqual([]);
    expect(invoiceActions({ kind: 'credit', status: 'issued', paidAt: null })).toEqual([]);
  });
});

describe('invoicePayload', () => {
  it('n’envoie que les champs modifiables du type', () => {
    expect(invoicePayload('deposit', form)).toEqual({ serviceDate: '2026-11-02', dueDate: null, notes: '' });
    expect(Object.keys(invoicePayload('final', form)!).sort()).toEqual(['dueDate', 'interventionAddress', 'lines', 'notes', 'object', 'serviceDate']);
    expect(invoicePayload('standalone', form)).toMatchObject({ clientId: 'c1', lines: [expect.objectContaining({ unitPriceCents: 12000 })] });
  });

  it('bloque l’envoi tant qu’une ligne est invalide', () => {
    expect(invoicePayload('standalone', { ...form, drafts: [{ ...blankDraft(), unitPrice: '1,234' }] })).toBeNull();
    expect(invoicePayload('deposit', { ...form, drafts: [{ ...blankDraft(), unitPrice: '1,234' }] })).not.toBeNull();
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:unit -- src/web/invoices`
Expected: FAIL.

- [ ] **Étape 3 : écrire `src/web/invoices/invoiceForm.ts`**

```ts
import type { InvoiceDto } from '../../shared/api-types';
import { EDITABLE_FIELDS, type InvoiceDraftInput } from '../../shared/invoice';
import type { InvoiceKind, InvoiceStatus } from '../../shared/status';
import { draftFromLine, draftsToLines, type DraftLine } from '../lines/lineDrafts';

export type InvoiceAction = 'issue' | 'delete' | 'pay' | 'unpay' | 'credit';

export function invoiceActions(i: { kind: InvoiceKind; status: InvoiceStatus; paidAt: string | null }): InvoiceAction[] {
  if (i.status === 'draft') return ['issue', 'delete'];
  if (i.kind === 'credit' || i.status === 'cancelled') return [];
  return [i.paidAt ? 'unpay' : 'pay', 'credit'];
}

export type InvoiceFormState = {
  clientId: string | null; object: string; interventionAddress: string; drafts: DraftLine[];
  serviceDate: string; dueDate: string; notes: string;
};

export function initialInvoiceForm(inv: InvoiceDto): InvoiceFormState {
  return {
    clientId: inv.clientId, object: inv.object, interventionAddress: inv.interventionAddress ?? '',
    drafts: inv.lines.map(draftFromLine), serviceDate: inv.serviceDate ?? '', dueDate: inv.dueDate ?? '', notes: inv.notes,
  };
}

export function invoicePayload(kind: Exclude<InvoiceKind, 'credit'>, f: InvoiceFormState): InvoiceDraftInput | null {
  const allowed = EDITABLE_FIELDS[kind];
  const { lines, valid } = draftsToLines(f.drafts);
  if (allowed.includes('lines') && !valid) return null;
  const all: InvoiceDraftInput = {
    clientId: f.clientId, object: f.object, interventionAddress: f.interventionAddress.trim() || null, lines,
    serviceDate: f.serviceDate || null, dueDate: f.dueDate || null, notes: f.notes,
  };
  return Object.fromEntries(allowed.map((k) => [k, all[k]])) as InvoiceDraftInput;
}
```

- [ ] **Étape 4 : écrire le formulaire de brouillon**

`src/web/invoices/InvoiceForm.tsx` (mêmes cartes que l'éditeur de devis ; sections selon `EDITABLE_FIELDS` ; dates en `<input type="date">` ; enregistrement automatique) :

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { InvoiceResponse } from '../../shared/api-types';
import type { ClientData } from '../../shared/client';
import { EDITABLE_FIELDS } from '../../shared/invoice';
import { api } from '../api';
import { ClientFormDialog } from '../components/ClientFormDialog';
import { LinesEditor } from '../lines/LinesEditor';
import { useAutosave } from '../lines/useAutosave';
import { initialInvoiceForm, invoicePayload, type InvoiceFormState } from './invoiceForm';

export function InvoiceForm({ initial, units, children }: {
  initial: InvoiceResponse; units: string[];
  children: (ctx: { flush: () => Promise<void>; saveState: string }) => ReactNode;
}) {
  const inv = initial.invoice;
  const kind = inv.kind as Exclude<typeof inv.kind, 'credit'>;
  const allowed = EDITABLE_FIELDS[kind];
  const [form, setForm] = useState<InvoiceFormState>(() => initialInvoiceForm(inv));
  const [creatingClient, setCreatingClient] = useState(false);
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => api<{ items: ClientData[] }>('GET', '/api/clients'), enabled: allowed.includes('clientId') });
  const payload = invoicePayload(kind, form);
  const autosave = useAutosave(payload, async (p) => {
    if (!p) return;
    qc.setQueryData(['invoice', inv.id], await api<InvoiceResponse>('PUT', `/api/invoices/${inv.id}`, p));
  }, { enabled: payload !== null });
  const set = <K extends keyof InvoiceFormState>(k: K, v: InvoiceFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const saveState = { idle: '', pending: 'Modifications en attente…', saving: 'Enregistrement…', saved: 'Enregistré', error: `Échec de l’enregistrement : ${autosave.error?.message ?? ''}` }[autosave.state];

  return (
    <>
      {children({ flush: autosave.flush, saveState })}
      {(allowed.includes('clientId') || allowed.includes('object')) && (
        <section className="card form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <h2 className="card-title span-all">Client</h2>
          {allowed.includes('clientId') && (
            <label className="field">Client
              <select className="input" value={form.clientId ?? ''} onChange={(e) => e.target.value === '__new__' ? setCreatingClient(true) : set('clientId', e.target.value || null)}>
                <option value="">Choisir un client…</option>
                {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">+ Nouveau client…</option>
              </select>
            </label>
          )}
          <label className="field">Adresse d’intervention<input className="input" value={form.interventionAddress} onChange={(e) => set('interventionAddress', e.target.value)} /></label>
          <label className="field span-all">Objet<input className="input" value={form.object} onChange={(e) => set('object', e.target.value)} /></label>
        </section>
      )}
      {allowed.includes('lines') && <LinesEditor drafts={form.drafts} onChange={(ds) => set('drafts', ds)} units={units} />}
      <section className="card form-grid">
        <h2 className="card-title span-all">Dates et mentions</h2>
        <label className="field">Date de la prestation<input className="input" type="date" value={form.serviceDate} onChange={(e) => set('serviceDate', e.target.value)} /></label>
        <label className="field"><span>Échéance <span className="field-hint">vide : délai du profil à partir de l’émission</span></span>
          <input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </label>
        <label className="field span-all">Mentions complémentaires<textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </section>
      <ClientFormDialog open={creatingClient} onClose={() => setCreatingClient(false)} onSaved={(c) => { set('clientId', c.id); setCreatingClient(false); }} />
    </>
  );
}
```

- [ ] **Étape 5 : écrire la page d'une facture**

`src/web/pages/InvoicePage.tsx` :

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { InvoiceResponse } from '../../shared/api-types';
import { formatDateShort, todayInParis } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { DEFAULT_UNITS } from '../../shared/profile';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL } from '../../shared/status';
import { getTemplate } from '../../templates/registry';
import { api } from '../api';
import { Dialog } from '../components/Dialog';
import { DocumentToolbar } from '../components/DocumentToolbar';
import { StatusBadge } from '../components/StatusBadge';
import { DocumentRenderer } from '../document/DocumentRenderer';
import { useTemplateFonts } from '../document/useTemplateFonts';
import { InvoiceForm } from '../invoices/InvoiceForm';
import { invoiceActions, type InvoiceAction } from '../invoices/invoiceForm';
import { useProfile } from '../profile/useProfile';

export function InvoicePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const res = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceResponse>('GET', `/api/invoices/${id}`) });
  const units = useProfile().data?.profile?.units ?? DEFAULT_UNITS;
  useTemplateFonts(res.data ? getTemplate(res.data.view.templateRef).fontsHref : '');
  const [dialog, setDialog] = useState<null | 'issue' | 'pay' | 'credit'>(null);
  const [paidAt, setPaidAt] = useState(todayInParis(new Date()));

  const act = useMutation({
    mutationFn: async ({ action, flush }: { action: InvoiceAction; flush?: () => Promise<void> }) => {
      if (flush) await flush();
      switch (action) {
        case 'issue': return api<InvoiceResponse>('POST', `/api/invoices/${id}/issue`);
        case 'delete': return api<void>('DELETE', `/api/invoices/${id}`);
        case 'pay': return api<InvoiceResponse>('PUT', `/api/invoices/${id}/payment`, { paidAt });
        case 'unpay': return api<InvoiceResponse>('PUT', `/api/invoices/${id}/payment`, { paidAt: null });
        case 'credit': return api<InvoiceResponse>('POST', `/api/invoices/${id}/credit-note`);
      }
    },
    onSuccess: (r, { action }) => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['billing'] });
      if (action === 'delete') return navigate('/factures');
      if (action === 'credit' && r) return navigate(`/factures/${(r as InvoiceResponse).invoice.id}`);
      if (r) qc.setQueryData(['invoice', id], r);
    },
  });

  if (res.isPending) return <p className="page-intro">Chargement…</p>;
  if (res.error) return <p className="notice notice-error" role="alert">{res.error.message}</p>;
  const { invoice: inv, view, links } = res.data;
  const display = INVOICE_DISPLAY[inv.display];
  const title = inv.number ? `${inv.number} · ${view.title}` : `${INVOICE_KIND_LABEL[inv.kind]} (brouillon)`;

  const header = (flush?: () => Promise<void>, saveState = '') => (
    <div className="page-head" style={{ alignItems: 'center' }}>
      <div className="actions" style={{ alignItems: 'center' }}>
        <h1 className="page-title" style={{ fontSize: 30 }}>{title}</h1>
        <StatusBadge tone={display.tone} label={inv.status === 'draft' ? 'Brouillon · numéro attribué à l’émission' : display.label} />
        {saveState && <span className="field-hint" role="status">{saveState}</span>}
      </div>
      <div className="actions">
        <DocumentToolbar printPath={`/imprimer/factures/${inv.id}`} beforeOpen={flush} />
        {invoiceActions(inv).map((a) => {
          const label = { issue: 'Émettre la facture', delete: 'Supprimer le brouillon', pay: 'Marquer payée', unpay: 'Annuler le paiement', credit: 'Créer un avoir' }[a];
          const onClick = () => {
            if (a === 'issue' || a === 'pay' || a === 'credit') return setDialog(a);
            if (a === 'delete' && !window.confirm('Supprimer ce brouillon ?')) return;
            act.mutate({ action: a, flush });
          };
          return <button key={a} type="button" className={a === 'issue' || a === 'pay' ? 'btn btn-primary' : a === 'delete' ? 'btn btn-danger' : 'btn btn-secondary'} onClick={onClick} disabled={act.isPending}>{label}</button>;
        })}
      </div>
    </div>
  );

  const notices = (
    <>
      {act.error && <p className="notice notice-error" role="alert">{act.error.message}</p>}
      {links.quote && <p className="notice">Issue du devis <Link to={`/devis/${links.quote.id}`}>{links.quote.number}</Link>{inv.kind !== 'standalone' && <> · <Link to={`/devis/${links.quote.id}/facturation`}>suivi de la facturation</Link></>}</p>}
      {links.creditNote && <p className="notice notice-error">Annulée par l’avoir <Link to={`/factures/${links.creditNote.id}`}>{links.creditNote.number}</Link>.</p>}
      {links.creditedInvoice && <p className="notice">Avoir de la facture <Link to={`/factures/${links.creditedInvoice.id}`}>{links.creditedInvoice.number}</Link>.</p>}
      {inv.paidAt && <p className="notice">Payée le {formatDateShort(inv.paidAt)}.</p>}
    </>
  );

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      {inv.status === 'draft' && inv.kind !== 'credit' ? (
        <InvoiceForm key={inv.id} initial={res.data} units={units}>
          {({ flush, saveState }) => (
            <>
              {header(flush, saveState)}
              {notices}
              <div className="summary" style={{ maxWidth: 420 }}>
                <div className="summary-row"><span>Total HT</span><span>{formatEuros(view.totals.totalHtCents)}</span></div>
                <div className="summary-vat">{view.vatMention}</div>
                {view.deductions?.deposits.map((d) => (
                  <div key={d.invoiceId} className="summary-row"><span>Acompte {d.number}</span><span>{formatEuros(-d.amountCents)}</span></div>
                ))}
                <div className="summary-rule" />
                <div className="summary-due"><span>{view.dueLabel}</span><strong>{formatEuros(view.totals.totalDueCents)}</strong></div>
              </div>
              <Dialog open={dialog === 'issue'} title="Émettre la facture" onClose={() => setDialog(null)}>
                <p className="page-intro">Une fois émise, la facture reçoit son numéro définitif et ne peut plus être modifiée ni supprimée. Une erreur se corrige ensuite par un avoir.</p>
                <div className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Annuler</button>
                  <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'issue', flush })}>Émettre la facture</button>
                </div>
              </Dialog>
            </>
          )}
        </InvoiceForm>
      ) : (
        <>
          {header()}
          {notices}
          <div className="doc-sheet"><DocumentRenderer view={view} template={getTemplate(view.templateRef)} /></div>
        </>
      )}
      <Dialog open={dialog === 'pay'} title="Marquer la facture payée" onClose={() => setDialog(null)}>
        <label className="field">Date du paiement<input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></label>
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'pay' })}>Enregistrer le paiement</button>
        </div>
      </Dialog>
      <Dialog open={dialog === 'credit'} title="Créer un avoir" onClose={() => setDialog(null)}>
        <p className="page-intro">L’avoir annule entièrement la facture {inv.number}. Il reçoit son propre numéro et ne peut pas être supprimé. Vous pourrez ensuite émettre une facture corrigée.</p>
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'credit' })}>Créer l’avoir</button>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Étape 6 : écrire la liste des factures**

`src/web/pages/InvoicesListPage.tsx` : titre « Factures », bouton « Facture sans devis » (POST `/api/invoices/standalone` puis navigation), filtres (Toutes, Acomptes, Soldes, Factures, Avoirs → paramètre `kind`), tableau (Numéro avec le type en dessous, Client, Date d'émission, Échéance, Montant, Statut) ; un clic ouvre `/factures/:id`.

```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { InvoiceListItem, InvoiceResponse } from '../../shared/api-types';
import { formatDateShort } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL, type InvoiceKind } from '../../shared/status';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

const FILTERS: { key: InvoiceKind | 'all'; label: string }[] = [
  { key: 'all', label: 'Toutes' }, { key: 'deposit', label: 'Acomptes' }, { key: 'final', label: 'Soldes' },
  { key: 'standalone', label: 'Factures' }, { key: 'credit', label: 'Avoirs' },
];

export function InvoicesListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InvoiceKind | 'all'>('all');
  const list = useQuery({
    queryKey: ['invoices', filter],
    queryFn: () => api<{ items: InvoiceListItem[] }>('GET', filter === 'all' ? '/api/invoices' : `/api/invoices?kind=${filter}`),
  });
  const create = useMutation({
    mutationFn: () => api<InvoiceResponse>('POST', '/api/invoices/standalone', {}),
    onSuccess: (r) => navigate(`/factures/${r.invoice.id}`),
  });
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Factures</h1>
        <button type="button" className="btn btn-secondary" onClick={() => create.mutate()} disabled={create.isPending}>Facture sans devis</button>
      </div>
      {create.error && <p className="notice notice-error" role="alert">{create.error.message}</p>}
      <div role="group" aria-label="Filtrer" className="filters">
        {FILTERS.map((f) => <button key={f.key} type="button" className={f.key === filter ? 'chip chip--on' : 'chip'} aria-pressed={f.key === filter} onClick={() => setFilter(f.key)}>{f.label}</button>)}
      </div>
      <div className="table-card">
        <table className="table">
          <thead><tr><th scope="col">Numéro</th><th scope="col">Client</th><th scope="col">Émission</th><th scope="col">Échéance</th><th scope="col" className="num">Montant</th><th scope="col">Statut</th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--c-text-muted)' }}>Aucune facture.</td></tr>}
            {list.data?.items.map((i) => (
              <tr key={i.id} className="row-link" onClick={() => navigate(`/factures/${i.id}`)}>
                <td><strong>{i.number ?? '—'}</strong><div className="field-hint" style={{ fontSize: 13 }}>{INVOICE_KIND_LABEL[i.kind]}{i.status === 'draft' ? ' (brouillon)' : ''}</div></td>
                <td>{i.clientName ?? '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{i.issueDate ? formatDateShort(i.issueDate) : '—'}</td>
                <td style={{ color: 'var(--c-text-muted)' }}>{i.dueDate ? formatDateShort(i.dueDate) : '—'}</td>
                <td className="num" style={{ fontWeight: 700 }}>{formatEuros(i.amountDueCents)}</td>
                <td><StatusBadge {...INVOICE_DISPLAY[i.display]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

Routes dans la coquille : `<Route path="factures" element={<InvoicesListPage />} />` et `<Route path="factures/:id" element={<InvoicePage />} />`.

- [ ] **Étape 7 : relancer les tests et vérifier le parcours complet à la main**

Run: `npm test && npm run typecheck`
Expected: PASS.

`npm run dev` : devis 4 000 € accepté → acompte 30 % → émettre (F-2026-00X) → imprimer → marquer payée → préparer le solde → émettre (acompte déduit, reste 2 800,00 €) → imprimer dans les 3 modèles → créer un avoir sur le solde (A-2026-001, montants négatifs) → préparer un nouveau solde. Facture sans devis : créer, choisir un client, saisir, émettre.

- [ ] **Étape 8 : commit**

```bash
git add -A
git commit -m "feat: écrans des factures (brouillon, émission, paiement, avoir, liste)"
```

**Critère de fin :** tout le cycle facture se pilote depuis l'interface, avec confirmation avant chaque action irréversible ; les factures émises s'affichent depuis leur instantané.

---

# Phase 5 : tableau de bord et mise en ligne

### Tâche 23 : API du tableau de bord

**Fichiers :**
- Créer : `src/worker/routes/dashboard.ts`
- Modifier : `src/worker/app.ts`, `src/shared/api-types.ts`, `test/worker/isolation.test.ts`
- Tests : `test/worker/dashboard.test.ts`

**Maquette :** `docs/maquettes/Dashboard.dc.html`.

**Interfaces :**
- Consomme : `todayInParis`, `monthRange` ; `QUOTE_STATUS`, `INVOICE_DISPLAY`, `INVOICE_KIND_LABEL`, `invoiceDisplay`.
- Produit (API) : `GET /api/dashboard?filter=all|quotes|invoices` → `DashboardData`.
- Produit (`api-types.ts`) :

```ts
export type RecentDocument = {
  type: 'quote' | 'invoice'; id: string; number: string | null; kindLabel: string; clientName: string | null;
  date: string | null; amountCents: number; status: { label: string; tone: Tone }; updatedAt: string;
};
export type DashboardData = {
  today: string;
  greetingName: string;
  outstanding: { totalCents: number; lateCents: number };
  pendingQuotes: { count: number; totalCents: number };
  collectedThisMonth: { totalCents: number; count: number; monthLabel: string };
  recent: RecentDocument[];
};
```

- Règles : « Reste à encaisser » = somme des `amount_due_cents` des factures émises, non payées, non annulées, hors avoirs ; « dont en retard » = celles dont l'échéance est passée. « Devis en attente » = devis `sent`. « Encaissé ce mois » = factures (hors avoirs) dont `paid_at` tombe dans le mois en cours, même annulées depuis. « Documents récents » = les 10 derniers devis et factures modifiés.

- [ ] **Étape 1 : écrire le test qui échoue**

`test/worker/dashboard.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { seedClient, seedProfile, seedQuote } from './fixtures';
import { call, createAllowedUser, json, testApp } from './helpers';

const app = testApp(); // 3 novembre 2026
const line = (cents: number) => ({ id: crypto.randomUUID(), designation: 'Travaux', quantityMilli: 1000, unit: 'forfait', unitPriceCents: cents, vatRate: null });

async function issuedInvoice(a: ReturnType<typeof testApp>, u: Awaited<ReturnType<typeof createAllowedUser>>, clientId: string, cents: number) {
  const created = await json(await call(a, u, 'POST', '/api/invoices/standalone', {}));
  await call(a, u, 'PUT', `/api/invoices/${created.invoice.id}`, { clientId, object: 'X', lines: [line(cents)], serviceDate: null, dueDate: null, notes: '' });
  await call(a, u, 'POST', `/api/invoices/${created.invoice.id}/issue`);
  return created.invoice.id as string;
}

describe('GET /api/dashboard', () => {
  it('calcule les trois indicateurs et la liste récente', async () => {
    const u = await createAllowedUser('karim@example.test', 'Karim Benali');
    await seedProfile(app, u);
    const client = await seedClient(app, u);

    await seedQuote(app, u, { clientId: client.id });                                  // brouillon : ignoré des indicateurs
    await seedQuote(app, u, { clientId: client.id, status: 'sent' });                  // 2 920,00 €
    await seedQuote(app, u, { clientId: client.id, lines: [line(453000)], status: 'sent' }); // 4 530,00 €

    const september = testApp(new Date('2026-09-01T10:00:00Z'));
    await issuedInvoice(september, u, client.id, 120000);                             // échéance 1er octobre : en retard
    await issuedInvoice(app, u, client.id, 366000);                                   // à payer
    const paidNow = await issuedInvoice(app, u, client.id, 72000);
    await call(app, u, 'PUT', `/api/invoices/${paidNow}/payment`, { paidAt: '2026-11-02' });
    const paidBefore = await issuedInvoice(september, u, client.id, 50000);
    await call(app, u, 'PUT', `/api/invoices/${paidBefore}/payment`, { paidAt: '2026-10-15' });
    const cancelled = await issuedInvoice(app, u, client.id, 99900);
    await call(app, u, 'POST', `/api/invoices/${cancelled}/credit-note`);

    const d = await json(await call(app, u, 'GET', '/api/dashboard'));
    expect(d).toMatchObject({
      today: '2026-11-03',
      greetingName: 'Karim',
      outstanding: { totalCents: 486000, lateCents: 120000 },
      pendingQuotes: { count: 2, totalCents: 745000 },
      collectedThisMonth: { totalCents: 72000, count: 1, monthLabel: 'novembre' },
    });
    expect(d.recent).toHaveLength(9); // 3 devis + 5 factures + 1 avoir
    expect(d.recent).toContainEqual(expect.objectContaining({ type: 'invoice', kindLabel: 'Avoir', status: { label: 'Avoir émis', tone: 'neutral' } }));
    expect(d.recent).toContainEqual(expect.objectContaining({ kindLabel: 'Facture', status: { label: 'En retard', tone: 'late' } }));

    const quotesOnly = await json(await call(app, u, 'GET', '/api/dashboard?filter=quotes'));
    expect(quotesOnly.recent.every((r: { type: string }) => r.type === 'quote')).toBe(true);
    expect(quotesOnly.recent.find((r: { number: string | null }) => r.number === null)).toMatchObject({ kindLabel: 'Devis (brouillon)', status: { label: 'Brouillon' } });
  });
});
```

Ajouter à `test/worker/isolation.test.ts` :

```ts
it('n’agrège que les documents de l’utilisateur connecté', async () => {
  const { a, b } = await twoUsers(app);
  const client = await seedClient(app, a);
  await seedQuote(app, a, { clientId: client.id, status: 'sent' });
  const d = await json(await call(app, b, 'GET', '/api/dashboard'));
  expect(d).toMatchObject({ outstanding: { totalCents: 0, lateCents: 0 }, pendingQuotes: { count: 0, totalCents: 0 }, collectedThisMonth: { totalCents: 0, count: 0 }, recent: [] });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:worker -- dashboard isolation`
Expected: FAIL (404).

- [ ] **Étape 3 : écrire `src/worker/routes/dashboard.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { DashboardData, RecentDocument } from '../../shared/api-types';
import { monthRange, todayInParis } from '../../shared/dates';
import { INVOICE_DISPLAY, INVOICE_KIND_LABEL, QUOTE_STATUS, invoiceDisplay, type InvoiceKind, type InvoiceStatus, type QuoteStatus } from '../../shared/status';
import { getProfile } from '../db/profiles';
import { validate } from '../errors';
import type { AppEnv } from '../types';

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });

export const dashboardRoutes = new Hono<AppEnv>().get(
  '/dashboard',
  validate('query', z.object({ filter: z.enum(['all', 'quotes', 'invoices']).default('all') })),
  async (c) => {
    const { DB } = c.env;
    const userId = c.var.user.id;
    const { filter } = c.req.valid('query');
    const today = todayInParis(c.var.deps.now());
    const month = monthRange(today);

    const [outstanding, pending, collected, quotes, invoices] = await DB.batch([
      DB.prepare(
        `SELECT COALESCE(SUM(amount_due_cents), 0) AS total, COALESCE(SUM(CASE WHEN due_date < ? THEN amount_due_cents ELSE 0 END), 0) AS late
         FROM invoices WHERE user_id = ? AND status = 'issued' AND paid_at IS NULL AND kind != 'credit'`,
      ).bind(today, userId),
      DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_ht_cents), 0) AS total FROM quotes WHERE user_id = ? AND status = 'sent'").bind(userId),
      DB.prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount_due_cents), 0) AS total FROM invoices WHERE user_id = ? AND kind != 'credit' AND paid_at >= ? AND paid_at < ?",
      ).bind(userId, month.start, month.end),
      DB.prepare(
        `SELECT q.id, q.number, q.status, c.name AS client_name, q.quote_date AS date, q.total_ht_cents AS amount, q.updated_at
         FROM quotes q LEFT JOIN clients c ON c.id = q.client_id AND c.user_id = q.user_id
         WHERE q.user_id = ? ORDER BY q.updated_at DESC LIMIT 10`,
      ).bind(userId),
      DB.prepare(
        `SELECT i.id, i.number, i.kind, i.status, i.paid_at, i.due_date, c.name AS client_name, i.issue_date AS date, i.amount_due_cents AS amount, i.updated_at
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id AND c.user_id = i.user_id
         WHERE i.user_id = ? ORDER BY i.updated_at DESC LIMIT 10`,
      ).bind(userId),
    ]);

    type Q = { id: string; number: string | null; status: QuoteStatus; client_name: string | null; date: string | null; amount: number; updated_at: string };
    type I = { id: string; number: string | null; kind: InvoiceKind; status: InvoiceStatus; paid_at: string | null; due_date: string | null; client_name: string | null; date: string | null; amount: number; updated_at: string };

    const recentQuotes: RecentDocument[] = (quotes!.results as Q[]).map((q) => ({
      type: 'quote', id: q.id, number: q.number, kindLabel: q.status === 'draft' ? 'Devis (brouillon)' : 'Devis',
      clientName: q.client_name, date: q.date, amountCents: q.amount, status: QUOTE_STATUS[q.status], updatedAt: q.updated_at,
    }));
    const recentInvoices: RecentDocument[] = (invoices!.results as I[]).map((i) => ({
      type: 'invoice', id: i.id, number: i.number,
      kindLabel: `${INVOICE_KIND_LABEL[i.kind]}${i.status === 'draft' ? ' (brouillon)' : ''}`,
      clientName: i.client_name, date: i.date, amountCents: i.amount,
      status: INVOICE_DISPLAY[invoiceDisplay({ kind: i.kind, status: i.status, paidAt: i.paid_at, dueDate: i.due_date }, today)],
      updatedAt: i.updated_at,
    }));
    const recent = [...(filter === 'invoices' ? [] : recentQuotes), ...(filter === 'quotes' ? [] : recentInvoices)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10);

    const profile = await getProfile(DB, userId);
    const o = outstanding!.results[0] as { total: number; late: number };
    const p = pending!.results[0] as { n: number; total: number };
    const k = collected!.results[0] as { n: number; total: number };
    const body: DashboardData = {
      today,
      greetingName: ((profile?.ownerName || c.var.user.name).split(/\s+/)[0]) ?? '',
      outstanding: { totalCents: o.total, lateCents: o.late },
      pendingQuotes: { count: p.n, totalCents: p.total },
      collectedThisMonth: { totalCents: k.total, count: k.n, monthLabel: MONTH.format(new Date(`${month.start}T00:00:00Z`)) },
      recent,
    };
    return c.json(body);
  },
);
```

Brancher : `api.route('/', dashboardRoutes);`

- [ ] **Étape 4 : relancer les tests**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "feat: API du tableau de bord (à encaisser, devis en attente, encaissé du mois)"
```

**Critère de fin :** les trois indicateurs et la liste récente sont justes sur un jeu de données mêlant retards, paiements, annulations et avoirs ; un autre utilisateur ne voit rien.

---

### Tâche 24 : tableau de bord (interface)

**Fichiers :**
- Créer : `src/web/pages/DashboardPage.tsx`, `src/web/pages/dashboardDate.ts`
- Modifier : `src/web/App.tsx`
- Tests : `src/web/pages/dashboardDate.test.ts`

**Maquette :** `docs/maquettes/Dashboard.dc.html`.

**Interfaces :**
- Consomme : `DashboardData`, `RecentDocument` (tâche 23) ; `StatusBadge`.
- Produit : `formatDashboardDate(iso: string): string` (`Mardi 3 novembre`) ; `<DashboardPage />` sur `/`.

- [ ] **Étape 1 : écrire le test qui échoue**

`src/web/pages/dashboardDate.test.ts` :

```ts
import { expect, it } from 'vitest';
import { formatDashboardDate } from './dashboardDate';

it('écrit la date comme la maquette', () => {
  expect(formatDashboardDate('2026-11-03')).toBe('Mardi 3 novembre');
  expect(formatDashboardDate('2027-01-01')).toBe('Vendredi 1 janvier');
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run: `npm run test:unit -- dashboardDate`
Expected: FAIL.

- [ ] **Étape 3 : écrire `dashboardDate.ts` et la page**

`src/web/pages/dashboardDate.ts` :

```ts
const FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function formatDashboardDate(iso: string): string {
  const s = FMT.format(new Date(`${iso}T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

`src/web/pages/DashboardPage.tsx` (en-tête date + « Bonjour Karim » + boutons « Facture sans devis » et « Nouveau devis » ; trois cartes, la première sur fond `#EBEEFF` avec « dont … en retard » en rouge ; tableau « Documents récents » avec filtres Tous / Devis / Factures) :

```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { DashboardData, InvoiceResponse, QuoteResponse } from '../../shared/api-types';
import { formatDateShort } from '../../shared/dates';
import { formatEuros } from '../../shared/money';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { formatDashboardDate } from './dashboardDate';

type Filter = 'all' | 'quotes' | 'invoices';

export function DashboardPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const data = useQuery({ queryKey: ['dashboard', filter], queryFn: () => api<DashboardData>('GET', `/api/dashboard?filter=${filter}`) });
  const newQuote = useMutation({ mutationFn: () => api<QuoteResponse>('POST', '/api/quotes', {}), onSuccess: (r) => navigate(`/devis/${r.quote.id}`) });
  const newInvoice = useMutation({ mutationFn: () => api<InvoiceResponse>('POST', '/api/invoices/standalone', {}), onSuccess: (r) => navigate(`/factures/${r.invoice.id}`) });
  const d = data.data;
  const error = data.error ?? newQuote.error ?? newInvoice.error;

  return (
    <div className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 15, color: 'var(--c-text-muted)' }}>{d ? formatDashboardDate(d.today) : ''}</span>
          <h1 className="page-title" style={{ fontSize: 38 }}>Bonjour {d?.greetingName}</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => newInvoice.mutate()} disabled={newInvoice.isPending}>Facture sans devis</button>
          <button type="button" className="btn btn-primary" onClick={() => newQuote.mutate()} disabled={newQuote.isPending}>+ Nouveau devis</button>
        </div>
      </div>
      {error && <p className="notice notice-error" role="alert">{error.message}</p>}

      {d && (
        <div className="kpis">
          <div className="kpi kpi--accent">
            <span className="kpi-label">Reste à encaisser</span>
            <span className="kpi-value">{formatEuros(d.outstanding.totalCents)}</span>
            {d.outstanding.lateCents > 0 && <span className="kpi-late">dont {formatEuros(d.outstanding.lateCents)} en retard</span>}
          </div>
          <div className="kpi">
            <span className="kpi-label">Devis en attente de réponse</span>
            <span className="kpi-value">{d.pendingQuotes.count}</span>
            <span className="kpi-sub">pour {formatEuros(d.pendingQuotes.totalCents)} au total</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Encaissé en {d.collectedThisMonth.monthLabel}</span>
            <span className="kpi-value">{formatEuros(d.collectedThisMonth.totalCents)}</span>
            <span className="kpi-sub">{d.collectedThisMonth.count} {d.collectedThisMonth.count > 1 ? 'factures payées' : 'facture payée'}</span>
          </div>
        </div>
      )}

      <section aria-labelledby="recents" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="page-head" style={{ alignItems: 'center' }}>
          <h2 id="recents" className="card-title" style={{ fontSize: 22 }}>Documents récents</h2>
          <div role="group" aria-label="Filtrer" className="filters">
            {(['all', 'quotes', 'invoices'] as const).map((f) => (
              <button key={f} type="button" className={f === filter ? 'chip chip--on' : 'chip'} aria-pressed={f === filter} onClick={() => setFilter(f)}>
                {{ all: 'Tous', quotes: 'Devis', invoices: 'Factures' }[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="table-card">
          <table className="table" style={{ minWidth: 720 }}>
            <thead><tr><th scope="col">Numéro</th><th scope="col">Client</th><th scope="col">Date</th><th scope="col" className="num">Montant</th><th scope="col">Statut</th></tr></thead>
            <tbody>
              {d?.recent.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--c-text-muted)' }}>Aucun document pour l’instant. Commencez par un devis.</td></tr>}
              {d?.recent.map((r) => (
                <tr key={`${r.type}-${r.id}`} className="row-link" onClick={() => navigate(r.type === 'quote' ? `/devis/${r.id}` : `/factures/${r.id}`)}>
                  <td><div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><strong>{r.number ?? '—'}</strong><span className="field-hint" style={{ fontSize: 13 }}>{r.kindLabel}</span></div></td>
                  <td>{r.clientName ?? '—'}</td>
                  <td style={{ color: 'var(--c-text-muted)' }}>{r.date ? formatDateShort(r.date) : '—'}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{formatEuros(r.amountCents)}</td>
                  <td><StatusBadge {...r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

Ajouter dans `src/web/layout/AppShell.css` :

```css
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.kpi { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-xl); padding: 24px; display: flex; flex-direction: column; gap: 10px; }
.kpi--accent { background: var(--c-primary-soft); border-color: var(--c-primary-soft); }
.kpi-label { font-size: 14px; color: var(--c-text-muted); font-weight: 600; }
.kpi--accent .kpi-label { color: var(--c-primary-strong); }
.kpi-value { font-family: var(--font-display); font-weight: 700; font-size: 40px; letter-spacing: -0.02em; }
.kpi-late { font-size: 14px; color: var(--c-danger); font-weight: 600; }
.kpi-sub { font-size: 14px; color: var(--c-text-muted); }
```

Dans `src/web/App.tsx`, remplacer la route index provisoire par `<Route index element={<DashboardPage />} />`.

- [ ] **Étape 4 : relancer les tests et vérifier à la main**

Run: `npm test && npm run typecheck`
Expected: PASS.

`npm run dev` : comparer le tableau de bord à `Dashboard.dc.html` ; chaque ligne récente ouvre le bon document ; « Facture sans devis » et « Nouveau devis » ouvrent un brouillon.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "feat: tableau de bord"
```

**Critère de fin :** l'accueil montre les trois indicateurs et les documents récents filtrables, conformes à la maquette.

---

### Tâche 25 : vérification complète sur localhost (barrière avant déploiement)

Rien n'est déployé tant que cette tâche n'est pas validée par l'utilisateur.

**Fichiers :**
- Créer : `scripts/dev-session.mjs` (outil local uniquement, jamais importé par le Worker)
- Créer : `docs/verification-locale.md` (compte rendu)

**Interfaces :**
- Consomme : l'application complète, `npm run dev`, la D1 locale (`.wrangler/`).
- Produit : `node scripts/dev-session.mjs <email>` crée (si besoin) l'utilisateur et une session dans la D1 **locale**, puis affiche le cookie de session Better Auth signé avec le `BETTER_AUTH_SECRET` de `.dev.vars`. Il permet de piloter l'application dans un navigateur automatisé sans passer par Google. Le script refuse de tourner si `BETTER_AUTH_URL` n'est pas une adresse `localhost`.

- [ ] **Étape 1 : écrire `scripts/dev-session.mjs`**

Lire `.dev.vars` ; insérer `user` et `session` (jeton aléatoire, expiration à 7 jours) par `npx wrangler d1 execute DB --local --command ...` ; signer le jeton comme Better Auth (HMAC-SHA256 du jeton avec le secret, encodé en base64, valeur `jeton.signature` encodée pour un cookie), sous le nom de cookie utilisé par la version installée (`better-auth.session_token` en HTTP). Vérifier : `curl -s -H "cookie: better-auth.session_token=<valeur>" http://localhost:5173/api/me` renvoie l'utilisateur (200), et le même appel sans cookie renvoie 401.

- [ ] **Étape 2 : parcours automatisé dans un navigateur (Playwright), données neuves**

`rm -rf .wrangler/state && npm run db:migrate:local && npm run dev`, puis, connecté comme superadmin via le cookie :
1. Écran de connexion (sans cookie) conforme à `Main.dc.html`.
2. Superadmin : autoriser `karim@example.test`, le retrouver « jamais connecté », puis vérifier qu'une adresse non invitée reçoit « Accès sur invitation ».
3. Connecté comme Karim : choix du modèle → profil (logo compris) → tableau de bord vide.
4. Client professionnel avec SIREN, client particulier, deux lignes types.
5. Devis avec les 5 lignes de la maquette (2 920,00 €), ligne type insérée, rechargement de la page (enregistrement automatique), envoi (D-2026-001), acceptation.
6. Facturation : acompte 30 % (876,00 €), émission (F-2026-001), paiement ; solde (reste 2 044,00 €), émission (F-2026-002) ; avoir sur le solde (A-2026-001) ; nouveau solde.
7. Facture sans devis pour le particulier : pas de mention des 40 €.
8. Aperçu d'impression de chaque document dans les 3 modèles (captures d'écran), plus un devis de 40 lignes : en-tête répété, rien de coupé.
9. Tableau de bord : indicateurs cohérents avec ce qui précède.
10. Deuxième utilisateur : ne voit aucune donnée de Karim, même en tapant les adresses des documents.
11. Console du navigateur sans erreur.

- [ ] **Étape 3 : corriger**

Chaque anomalie trouvée part en correction (avec un test qui la reproduit quand c'est possible), puis le parcours concerné est rejoué.

- [ ] **Étape 4 : compte rendu et validation par l'utilisateur**

Écrire `docs/verification-locale.md` (chaque point : ok, ou anomalie et correction ; captures jointes). Présenter le compte rendu à l'utilisateur, avec la marche à suivre pour qu'il essaie lui-même `npm run dev` et une vraie connexion Google (identifiants OAuth dans `.dev.vars`). **Attendre son accord explicite avant la tâche 26.**

**Critère de fin :** le parcours complet passe sur localhost, le compte rendu est écrit, et l'utilisateur a donné son accord pour déployer.

---

### Tâche 26 : mise en production gratuite et vérifications finales

**Fichiers :**
- Modifier : `wrangler.jsonc` (identifiant D1 réel)
- Créer : `README.md`, `scripts/smoke.sh`

**Interfaces :**
- Consomme : l'application complète.
- Produit : l'application en ligne sur `https://devis-factures.<sous-domaine>.workers.dev`, un `README.md` (installation, développement, tests, déploiement, ajout d'un modèle), un script de vérification rapide.

- [ ] **Étape 1 : écrire le script de vérification**

`scripts/smoke.sh` :

```bash
#!/usr/bin/env bash
# Usage : scripts/smoke.sh https://devis-factures.exemple.workers.dev
set -euo pipefail
BASE="${1:?URL de base attendue}"
test "$(curl -fsS "$BASE/api/health")" = '{"ok":true}' && echo "santé : ok"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/me")
test "$code" = "401" && echo "API protégée : ok (401 sans session)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/devis")
test "$code" = "200" && echo "interface servie : ok"
```

Run: `chmod +x scripts/smoke.sh`

- [ ] **Étape 2 : créer la base distante (l'utilisateur se connecte à Cloudflare)**

Demander à l'utilisateur de lancer `! npx wrangler login` dans la session (ouverture du navigateur). Puis :

Run: `npx wrangler d1 create devis-factures`
Expected: un `database_id` ; le reporter dans `wrangler.jsonc` à la place de `00000000-0000-0000-0000-000000000000`.

Run: `npm run db:migrate:remote`
Expected: « 2 migrations applied ».

- [ ] **Étape 3 : configurer Google et les secrets de production**

Dans Google Cloud Console, sur l'identifiant OAuth : ajouter l'origine `https://devis-factures.<sous-domaine>.workers.dev` et l'URI de redirection `https://devis-factures.<sous-domaine>.workers.dev/api/auth/callback/google` ; passer l'écran de consentement en production (portées de base uniquement : pas de validation Google nécessaire).

```bash
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL        # https://devis-factures.<sous-domaine>.workers.dev
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SUPERADMIN_EMAIL       # adresse Gmail du superadmin
```

- [ ] **Étape 4 : déployer et vérifier**

Run: `npm test && npm run deploy`
Expected: tests verts, puis l'URL du Worker.

Run: `scripts/smoke.sh https://devis-factures.<sous-domaine>.workers.dev`
Expected: trois lignes « ok ».

Parcours manuel en production : connexion du superadmin ; ajout d'une adresse ; connexion refusée pour une adresse non invitée ; premier démarrage complet ; devis → envoi → acceptation → acompte → émission → solde → émission → impression PDF dans les 3 modèles → avoir.

- [ ] **Étape 5 : contrôler la limite de 10 ms de CPU et la gratuité**

Dans le tableau de bord Cloudflare (Workers & Pages → devis-factures → Metrics), après le parcours manuel : relever le temps CPU médian et p99. Les requêtes les plus coûteuses attendues sont `/api/auth/*`, `POST /api/invoices/:id/issue` et `GET /api/dashboard`. Si le p99 dépasse 10 ms, noter la route en cause dans le README (section « Limites connues ») et le signaler : la spec prévoit la bascule Workers Paid (5 $/mois) comme recours, à décider par l'utilisateur. Vérifier que le compte reste sur l'offre gratuite (Workers Free, D1 Free) sans moyen de paiement requis.

- [ ] **Étape 6 : écrire le README**

`README.md` : présentation en trois lignes ; prérequis (Node, compte Cloudflare, identifiants Google) ; `npm install`, copie de `.dev.vars.example` en `.dev.vars`, `npm run db:migrate:local`, `npm run dev` ; `npm test` ; déploiement (`npm run db:migrate:remote`, secrets, `npm run deploy`) ; renvoi vers `src/templates/README.md` pour ajouter un modèle ; section « Limites connues » (impression dépendante du navigateur, en-têtes à décocher ; mesures CPU de l'étape 5).

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "chore: mise en production sur Workers gratuit, script de vérification et README"
```

**Critère de fin :** l'application tourne en production sur l'offre gratuite ; le parcours complet fonctionne avec un vrai compte Google ; la consommation CPU est mesurée et documentée.

---

## Couverture de la spec

| Spec | Tâches |
|---|---|
| § 6.1 connexion Google, liste d'accès, superadmin, retrait = sessions coupées | 4, 5, 6 |
| § 6.2 premier démarrage (modèle puis profil) | 7, 9 |
| § 6.3 profil (EI, activité, logo, franchise en lecture seule, assurance, valeurs par défaut, préfixes, numéro de départ) | 8, 9 |
| § 6.4 carnet de clients, création à la volée, mentions selon le type | 10, 16, 14 |
| § 6.5 devis : 5 lignes vides, ajout, suppression, réordonnancement, lignes types, statuts, numéro à l'envoi, duplication | 11, 12, 15, 16 |
| § 6.6 acomptes (pourcentage arrondi inférieur, montant, plafond), solde unique, facture directe, facture sans devis, règles de cohérence | 12, 18, 19, 21, 22 |
| § 6.7 paiement, avoir total, facture annulée | 20, 22 |
| § 6.8 instantané JSON figé, affichage depuis l'instantané, version du modèle | 14, 15, 19, 20 |
| § 6.9 numérotation D/F/A par utilisateur et par année, batch atomique, sans trou, brouillon supprimé sans numéro, facture émise non supprimable | 13, 15, 19, 20 |
| § 6.10 3 modèles versionnés, ajout sans toucher au reste, rendu commun, pagination | 7, 17 |
| § 6.11 impression : vue nue, `window.print()`, titre = numéro – client, aide | 17 |
| § 6.12 écran superadmin sans accès aux documents | 6 |
| § 7 modèle de données, `vat_regime`, `vat_rate`, centimes, filtre `user_id` | 2, 12, toutes les routes, `isolation.test.ts` |
| § 8 mentions obligatoires (vérifiées sur les sources) | 14, 17 |
| § 10 risques : CPU 10 ms, impression multi-navigateurs | 17, 25, 26 |
| Vérification complète sur localhost avant tout déploiement | 25 |
| Tableau de bord | 23, 24 |
