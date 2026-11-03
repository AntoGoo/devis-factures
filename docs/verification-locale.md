# Vérification complète sur localhost (tâche 25)

Date : 3 novembre 2026. Branche `feat/v1`. Rien n'est déployé.

## Conditions du parcours

- Serveur de développement Vite + Worker lancé sur `http://localhost:5180` avec une D1 locale **neuve** (migrations `0001_auth` et `0002_core` appliquées sur un état vide), `BETTER_AUTH_URL` réglé sur cette adresse. Le serveur et sa configuration temporaire ont été supprimés à la fin.
- Connexion sans Google grâce à `node scripts/dev-session.mjs <email>` : le script crée l'utilisateur et une session de 7 jours dans la D1 **locale**, puis affiche le cookie `better-auth.session_token` signé avec le `BETTER_AUTH_SECRET` de `.dev.vars`. Il refuse de tourner si `BETTER_AUTH_URL` n'est pas une adresse localhost (vérifié : « refus : BETTER_AUTH_URL (https://devis.example.com) n'est pas une adresse localhost », code de sortie 1). Avec le cookie, `GET /api/me` répond 200 ; sans cookie, 401.
- Navigateur Chromium piloté par Playwright, viewport 1280 × 800. Les aperçus d'impression sont produits par le moteur d'impression de Chromium (PDF A4, sans en-têtes ni pieds de page), puis convertis en PNG page par page.
- Comptes : superadmin `antogouvrillon@gmail.com`, utilisateur invité `karim@example.test`, deuxième utilisateur `lea@example.test`, adresse non invitée `intrus@example.test`.

## Résultat point par point

| # | Point vérifié | Résultat |
|---|---|---|
| 1 | Écran de connexion sans cookie | ok, conforme à `Main.dc.html` ([capture](verification/01-connexion.png)) |
| 2 | Superadmin : autoriser `karim@example.test`, « jamais connecté », adresse non invitée | ok ([accès](verification/02-admin-acces.png), [accès sur invitation](verification/03-acces-refuse.png)) |
| 3 | Karim : choix du modèle → profil avec logo → tableau de bord vide | ok après correction n° 2 ([modèle](verification/04-choix-modele.png), [profil](verification/05-profil.png), [tableau de bord](verification/06-tableau-de-bord-vide.png)) |
| 4 | Client professionnel avec SIREN, client particulier, deux lignes types | ok ([clients](verification/07-clients.png)) |
| 5 | Devis de la maquette, ligne type, rechargement, envoi, acceptation | ok ([édition](verification/08-devis-edition.png), [envoyé](verification/09-devis-envoye.png), [accepté](verification/10-devis-accepte.png)) |
| 6 | Acompte, solde, avoir, nouveau solde | ok après correction n° 4 ([facturation](verification/11-facturation.png), [solde en brouillon](verification/12-facture-solde-brouillon.png), [après l'avoir](verification/13-facturation-apres-avoir.png)) |
| 7 | Facture sans devis pour le particulier : pas de mention des 40 € | ok après correction n° 3 ([brouillon](verification/14-facture-directe-brouillon.png)) |
| 8 | Aperçu d'impression dans les 3 modèles, devis de 40 lignes | ok après correction n° 5 ; mise en page sur 2 pages à trancher (voir « Décisions à prendre ») |
| 9 | Tableau de bord cohérent | ok ([capture](verification/15-tableau-de-bord.png)) |
| 10 | Deuxième utilisateur : aucune donnée de Karim, même par l'adresse | ok ([document introuvable](verification/17-autre-utilisateur-facture-introuvable.png)) |
| 11 | Console du navigateur | ok : aucune erreur JavaScript |
| + | Aperçu → Retour → modification → aperçu, dans la même session | ok |
| + | Aperçu d'une facture brouillon → Retour → émission → aperçu | ok |

### 1. Écran de connexion

Sans cookie, `/` redirige vers `/connexion`. Titre, accroche, bouton « Continuer avec Google », encart « Accès sur invitation » et les trois étiquettes D → Acompte → Solde sont conformes à la maquette. À 1280 px, l'étiquette « Solde » passe à la ligne, comme dans la maquette, dont les règles flex sont les mêmes.

### 2. Accès sur invitation

- Le superadmin ajoute `karim@example.test` ; la ligne apparaît avec le badge « jamais connecté » et le bouton « Retirer », comme dans `Admin.dc.html`.
- L'adresse saisie `Lea@Example.test ` (majuscules et espace final) est enregistrée en `lea@example.test` ([capture](verification/16-admin-apres.png)).
- Une session pour `intrus@example.test`, adresse non invitée : `/api/me` répond 403 `not_invited` et l'application affiche « Accès sur invitation » ([capture](verification/03-acces-refuse.png)).
- Vérifications en plus : retirer `lea@example.test` fait passer sa session en 401 (session supprimée) ; une écriture `POST /api/quotes` avec `Origin: http://evil.example` reçoit 403.

### 3. Premier passage de Karim

Choix du modèle « Discret » → « Votre entreprise » : logo PNG importé (aperçu affiché, bouton « Retirer »), identité, coordonnées, assurance, IBAN → « Enregistrer » ouvre le tableau de bord vide (indicateurs à 0, « Aucun document pour l'instant »).

**Anomalie n° 2, corrigée** : dans la section « Numérotation » du profil, les trois colonnes étaient trop étroites. Le bouton « Fixer » débordait sur la colonne voisine et les champs se chevauchaient. Correction : la section reprend la grille commune des formulaires, qui fait 3 colonnes larges, et le champ « Reprendre à partir du n° » peut rétrécir (commit `b66e6a5`). Étape rejouée : la capture du profil montre la correction.

### 4. Clients et lignes types

- « SCI Les Tilleuls », professionnel, SIREN saisi `801 222 333` et enregistré `801222333` ; « M. et Mme Lefèvre », particulier.
- Lignes types : « Raccordement, essais et vérifications », forfait, `300` → 300,00 € ; « Déplacement », forfait, saisi `45 €` → 45,00 €.

### 5. Devis

- « + Nouveau devis » crée un brouillon avec 5 lignes vides. Quatre lignes de la maquette ont été saisies, dont le prix `1 150,00`, puis la ligne type « Raccordement… » a été insérée dans la 5ᵉ ligne vide : total **2 920,00 €**, acompte prévu 30 % = **876,00 €**.
- Rechargement de la page après l'enregistrement automatique : client, objet, les 5 lignes, modalités et acompte prévu sont tous conservés.
- « Marquer comme envoyé » → **D-2026-001**, « Envoyé ». « Marquer comme accepté » → contenu figé (« Le contenu de ce devis est figé depuis son acceptation »), actions « Facturer » et « Dupliquer ».

### 6. Facturation

- Écran Facturation : total 2 920,00 €, acompte proposé 30 % → 876,00 €, reste 2 044,00 €.
- Acompte créé en brouillon, émis → **F-2026-001** (boîte de confirmation), marqué payé (date du jour proposée).
- « Préparer le solde » : 2 920,00 € − acompte F-2026-001 = **2 044,00 €** ; émis → **F-2026-002**.
- Avoir sur le solde → **A-2026-001** : lignes négatives, acompte réintégré, montant de l'avoir −2 044,00 €, « Annule la facture n° F-2026-002 ».
- Nouveau solde → **F-2026-003**, 2 044,00 €.

**Anomalie n° 4, corrigée** : dans la liste des factures et dans « Factures liées », un avoir émis le même jour que la facture qu'il annule apparaissait sous elle, et tous les avoirs du jour étaient regroupés en fin de liste. En cas d'égalité de date, le tri se faisait sur le numéro, et `A-…` passe après `F-…`. Correction : à date égale, le document créé en dernier vient d'abord. Le test `test/worker/credit-notes.test.ts` reproduit le cas (commit `6cccc42`). Étape rejouée ([liste des factures](verification/18-factures.png), [factures liées](verification/13-facturation-apres-avoir.png)).

### 7. Facture sans devis pour un particulier

« Facture sans devis » → client « M. et Mme Lefèvre (particulier) », une ligne à 85 € et la ligne type « Déplacement » : 130,00 €, émise → **F-2026-004**. Les modalités ne contiennent **pas** l'indemnité forfaitaire de 40 €. Sur la facture de solde du client professionnel, elle est bien présente.

**Anomalie n° 3, corrigée** : la liste des clients d'une facture n'indiquait pas le type de client, alors que celle d'un devis affiche « (particulier) » ou « (professionnel) ». Or ce type décide des mentions légales. Correction : même libellé partout. Le test `InvoicePage.test.tsx` reproduit le cas (commit `46edf71`).

### 8. Aperçus d'impression

Les trois modèles, chacun avec un devis, une facture de solde avec déduction d'acompte et un avoir. Pour Intemporel et Raffiné, la même chaîne (D-2026-002/003, F-2026-005 à 008, A-2026-002/003) a été créée par l'API depuis le navigateur.

| Modèle | Devis | Facture de solde | Avoir |
|---|---|---|---|
| Discret (modele-02) | [p. 1](verification/20-discret-devis-1.png) | [p. 1](verification/21-discret-facture-solde-1.png), [p. 2](verification/21-discret-facture-solde-2.png) | [p. 1](verification/22-discret-avoir-1.png), [p. 2](verification/22-discret-avoir-2.png) |
| Intemporel (modele-01) | [p. 1](verification/23-intemporel-devis-1.png) | [p. 1](verification/24-intemporel-facture-solde-1.png), [p. 2](verification/24-intemporel-facture-solde-2.png) | [p. 1](verification/25-intemporel-avoir-1.png), [p. 2](verification/25-intemporel-avoir-2.png) |
| Raffiné (modele-03) | [p. 1](verification/26-raffine-devis-1.png), [p. 2](verification/26-raffine-devis-2.png) | [p. 1](verification/27-raffine-facture-solde-1.png), [p. 2](verification/27-raffine-facture-solde-2.png) | [p. 1](verification/28-raffine-avoir-1.png), [p. 2](verification/28-raffine-avoir-2.png) |

Le titre de l'onglet, qui devient le nom proposé pour le PDF, vaut par exemple « F-2026-003 – SCI Les Tilleuls », ou « Devis (brouillon) – SCI Les Tilleuls » pour un brouillon.

Devis de 40 lignes, dont 6 désignations longues sur 4 lignes : 3 pages en Discret et en Intemporel, 4 en Raffiné. Sur chaque page de lignes, l'en-tête du tableau est répété et aucune ligne n'est coupée : chaque « Ligne n » apparaît sur une seule page, d'après une vérification du texte du PDF page par page. Totaux, modalités et bon pour accord restent groupés. Captures : Discret [p. 1](verification/30-devis-40-lignes-discret-1.png), [p. 2](verification/30-devis-40-lignes-discret-2.png), [p. 3](verification/30-devis-40-lignes-discret-3.png) ; Raffiné [p. 2](verification/31-devis-40-lignes-raffine-2.png), [p. 3](verification/31-devis-40-lignes-raffine-3.png).

**Anomalie n° 5, corrigée** : à l'impression avec « Graphiques d'arrière-plan », la fin de la dernière page était remplie du fond gris de l'application. Selon l'ordre de chargement des feuilles de style, la règle `body` de `base.css` l'emportait sur la règle d'impression. Correction : la règle d'impression est plus spécifique (`html body`) et la page d'aperçu n'impose plus de hauteur minimale à l'impression. Seule l'enveloppe de la page est modifiée, pas les modèles (commit `0e5f245`). Les 9 aperçus ont été régénérés : fond blanc.

### 9. Tableau de bord

Après les étapes 5 à 7 : reste à encaisser **2 174,00 €** (F-2026-003 2 044,00 € + F-2026-004 130,00 € ; F-2026-001 payée, F-2026-002 annulée), devis en attente **0**, encaissé en novembre **876,00 €** (1 facture payée). Les documents récents listent les 6 documents avec le bon statut ([capture](verification/15-tableau-de-bord.png)).

### 10. Deuxième utilisateur

Léa, invitée par le superadmin puis passée par le choix du modèle et le profil, voit un tableau de bord vide, et des listes de devis, factures, clients et lignes types vides. En tapant les adresses des documents de Karim (`/devis/…`, `/devis/…/facturation`, `/factures/…`, `/imprimer/devis/…`, `/imprimer/factures/…`), elle n'obtient que « Devis introuvable. » ou « Facture introuvable. », sans aucune donnée de Karim. Côté API, ces requêtes répondent 404, et `POST /api/quotes/<devis de Karim>/deposits` aussi.

### 11. Console

Aucune erreur JavaScript ni avertissement pendant tout le parcours. Les seules lignes « Failed to load resource » sont les réponses HTTP volontairement provoquées : 401 sans cookie, 403 pour l'adresse non invitée, 404 pour les documents de Karim demandés par Léa. Côté serveur, seul l'avertissement attendu de Better Auth apparaît : « Social provider google is missing clientId or clientSecret », car aucun identifiant Google n'est configuré dans le `.dev.vars` local.

### Parcours supplémentaires dans une seule session (sans rechargement)

- Aperçu d'un devis brouillon (« Brouillon » à la place du numéro, impression lancée une fois) → Retour → quantité de la ligne 4 passée de 6 à 7 → nouvel aperçu, ouvert moins de 800 ms après la frappe : 665,00 € et total 3 015,00 €. Le nouveau contenu est bien affiché.
- Aperçu de la facture d'acompte brouillon → Retour → « Émettre la facture » → aperçu : « N° F-2026-001 », plus de « Brouillon », titre « F-2026-001 – SCI Les Tilleuls ».
- Correction préalable de la revue finale (**anomalie n° 1**, commit `26f9fb1`) : l'impression automatique ne se relance plus quand l'aperçu relit le document au retour sur l'onglet. Vérifié dans le navigateur : après un `visibilitychange`, `window.print` n'est pas rappelé.

## Corrections apportées

| N° | Anomalie | Correction | Test | Commit |
|---|---|---|---|---|
| 1 | L'impression automatique se relançait à chaque relecture du document | une seule impression automatique par ouverture de la page | `PrintPage.test.tsx` | `26f9fb1` |
| 2 | Profil : colonnes de numérotation qui se chevauchent | grille commune, champ rétrécissable | visuel (capture) | `b66e6a5` |
| 3 | Facture : type de client absent de la liste | libellé commun `CLIENT_TYPE_LABEL` | `InvoicePage.test.tsx` | `46edf71` |
| 4 | Liste des factures : avoirs du jour en fin de liste | tri secondaire sur la date de création | `credit-notes.test.ts` | `6cccc42` |
| 5 | Impression : fond gris sous le document | règle d'impression plus spécifique | visuel (PDF) | `0e5f245` |

## Décisions à prendre

1. **Un document de 5 lignes s'imprime sur 2 pages.** C'est le cas dans les trois modèles pour une facture ou un avoir, et en Raffiné pour un devis. Le bloc « Modalités » (mentions légales comprises) part seul en page 2, car il est trop haut pour la place restante et ne doit pas être coupé. Mesures faites dans le navigateur en ajoutant des règles d'impression plus compactes : texte à 13 px au lieu de 15, interlignes et espacements réduits, bloc « Modalités » sur toute la largeur quand il n'y a pas de bon pour accord. La facture tient alors sur 1 page en Discret et en Intemporel, 2 en Raffiné, et le devis Raffiné tient sur 1 page. Changer l'apparence des modèles touche la règle « un modèle publié n'est jamais modifié en place ». Comme rien n'est encore publié, une retouche des `v1` reste possible avant le déploiement ; sinon il faudra des `v2`. Choix à faire : accepter 2 pages, ou compacter l'impression (et dans ce cas, valider la nouvelle apparence).
2. Point mineur, non corrigé : à l'écran, l'espace fin insécable des milliers (`2 044,00 €`, produit par `Intl.NumberFormat`) est presque invisible dans la police Manrope en gras (« 2044,00 € » sur l'écran Facturation). C'est conforme à la contrainte de format, mais on peut préférer un espace insécable normal à l'affichage.

## Essayer vous-même

1. Installer les dépendances si besoin : `npm install`.
2. Créer la base locale : `npm run db:migrate:local`.
3. Créer `.dev.vars` à partir de `.dev.vars.example` (le fichier n'est jamais versionné) :
   - `BETTER_AUTH_SECRET` : une valeur aléatoire, par exemple la sortie de `openssl rand -base64 32` ;
   - `BETTER_AUTH_URL=http://localhost:5173` ;
   - `SUPERADMIN_EMAIL=antogouvrillon@gmail.com` : cette adresse est le superadmin, toujours autorisée, et elle seule voit le menu « Accès (superadmin) » ;
   - `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` : voir l'étape 4.
4. Identifiants Google OAuth, dans la console Google Cloud (console.cloud.google.com) :
   - créer ou choisir un projet ;
   - « API et services » → « Écran de consentement OAuth » : type « Externe », nom de l'application, adresse d'assistance. En mode « Test », ajouter votre adresse Gmail dans « Utilisateurs test ». Les portées par défaut suffisent (`openid`, `email`, `profile`) ;
   - « Identifiants » → « Créer des identifiants » → « ID client OAuth » → type « Application Web » ;
   - « Origines JavaScript autorisées » : `http://localhost:5173` ;
   - « URI de redirection autorisés » : `http://localhost:5173/api/auth/callback/google` ;
   - recopier l'ID client et le code secret dans `.dev.vars`.
5. Lancer `npm run dev`, ouvrir `http://localhost:5173`, puis « Continuer avec Google » avec l'adresse superadmin. Depuis « Accès (superadmin) », autoriser d'autres adresses Gmail.
6. Sans Google, pour un essai rapide : `node scripts/dev-session.mjs <email>` affiche un cookie de session pour la D1 locale. Le serveur doit tourner sur l'adresse de `BETTER_AUTH_URL`, et l'adresse doit être le superadmin ou une adresse autorisée. Ensuite, par exemple : `curl -H "cookie: <valeur affichée>" http://localhost:5173/api/me`.

Le déploiement (tâche 26) attend votre accord explicite.
