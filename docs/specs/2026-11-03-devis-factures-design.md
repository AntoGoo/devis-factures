# Plateforme devis et factures pour micro-entrepreneurs : conception

Date : 3 novembre 2026
Statut : en attente de validation

## 1. Intention

Un outil web où des micro-entrepreneurs de tous métiers rédigent leurs devis, puis les transforment en factures (acomptes compris) sans rien ressaisir, et les impriment en PDF dans l'apparence de leur choix.

Point de départ : un classeur Excel/Google Sheets (`devis_electricite_corrige_sans_placeholders.xlsx`) avec trois variantes visuelles d'un même devis d'électricien, un script Apps Script pour ajouter des lignes, et des totaux calculés par formule. L'outil remplace ce bricolage par une application où les données de l'entreprise sont saisies une fois, où les lignes s'ajoutent d'un bouton, et où le passage du devis à la facture est automatique.

L'accès est fermé : le superadmin (Anto) décide qui peut l'utiliser. Le trafic attendu est faible et l'hébergement doit rester gratuit.

## 2. Utilisateurs et rôles

- **Utilisateur** : un micro-entrepreneur. Il se connecte avec son compte Google, ne voit que ses propres données (profil, clients, devis, factures).
- **Superadmin** : Anto. Il gère la liste des adresses Gmail autorisées. Il peut aussi être utilisateur.

Plusieurs utilisateurs coexistent ; chacun a ses propres données, cloisonnées par `user_id` à chaque requête.

## 3. Objectifs, non-objectifs, anti-objectifs

Objectifs :
- Connexion Google, accès réservé aux adresses autorisées.
- Choix d'un modèle visuel au premier démarrage, modifiable ensuite : 3 modèles en V1, 10 à terme.
- Profil entreprise saisi une fois et reporté automatiquement dans chaque document.
- Devis avec 5 lignes par défaut et un bouton pour en ajouter.
- Transformation d'un devis accepté en factures d'acompte puis en facture de solde.
- Impression en PDF de tout document, fidèle au modèle choisi.
- Numérotation continue et conforme des factures et avoirs.

Non-objectifs (V1) :
- Envoi des documents par e-mail depuis l'application (l'utilisateur envoie lui-même son PDF).
- Accès à Gmail ou Google Drive : Google sert uniquement à la connexion.
- Facturation électronique via une plateforme agréée (obligation d'émission prévue au 1er septembre 2027 pour les TPE/PME) : traitée plus tard, voir section 12.
- Paiement en ligne, abonnement, Stripe : l'outil est gratuit.
- Utilisateurs assujettis à la TVA : la V1 ne gère que la franchise en base (art. 293 B du CGI). Aucun calcul de TVA.
- Les 7 modèles visuels supplémentaires (ajoutés après la V1).
- Signature électronique du devis.
- Génération de PDF côté serveur.

Anti-objectifs (ce qui serait un échec même si « ça marche ») :
- Une facture émise qui peut être modifiée, ou un trou dans la numérotation.
- Un utilisateur qui voit les données d'un autre.
- Un coût d'hébergement non nul pour un faible trafic.
- Un vocabulaire figé sur un métier (électricité, BTP) qui gêne un graphiste ou un formateur.

## 4. Contraintes

- **Hébergement gratuit Cloudflare** : Workers (offre gratuite : 100 000 requêtes/jour, 10 ms de CPU par requête), D1 (5 Go), éventuellement R2 (10 Go). Les 10 ms de CPU interdisent tout traitement lourd côté serveur (pas de PDF serveur, pas de hachage de mot de passe : la connexion Google seule évite ce dernier point).
- **Micro-entrepreneurs en franchise de TVA** (décision d'Anto pour la V1) : tous les documents portent « TVA non applicable, art. 293 B du CGI », total à payer = total HT. La gestion de la TVA viendra plus tard ; le modèle de données doit pouvoir l'accueillir sans migration douloureuse (section 7).
- **Règles de facturation françaises** : numérotation chronologique continue, sans trou ; facture émise inaltérable, correction par avoir ; mentions obligatoires (section 8).
- **Langue** : interface et documents en français, montants au format français (`1 234,50 €`).

## 5. Approches considérées

| | Approche | Pour | Contre |
|---|---|---|---|
| **A (retenue)** | Un seul Worker Cloudflare : React + Vite pour l'interface, API Hono, base D1, connexion Google via Better Auth | Gratuit sans mise en veille ; Anto connaît React/Vite ; Hono ressemble à Express ; un seul projet, un seul déploiement ; édition des lignes et totaux en direct naturelle en React | Connexion Google et liste d'accès à monter soi-même |
| B | Pages rendues côté serveur (Hono JSX + htmx) | Très léger, impression simple | Recalcul en direct des lignes et acomptes peu confortable ; technologie inconnue d'Anto |
| C | Interface Cloudflare + Supabase (auth + PostgreSQL) | Connexion Google clé en main, RLS | Deux fournisseurs ; projet Supabase gratuit mis en pause après une semaine d'inactivité, rédhibitoire pour un faible trafic |

Anto a choisi **A**.

Génération PDF, deux options considérées :
- **Impression du navigateur (retenue, choix d'Anto : « au plus simple »)** : feuille de style d'impression, bouton qui ouvre la boîte d'impression, l'utilisateur choisit « Enregistrer en PDF ». Gratuit, aucun code serveur.
- react-pdf dans le navigateur : PDF identique partout, archivable, mais modèles à écrire dans un sous-ensemble de CSS. Écarté pour la V1.

Conséquence du choix : pas d'archive du fichier PDF. L'archive est assurée par l'instantané figé du document (section 6.8) et la version du modèle.

## 6. Fonctionnement

### 6.1 Connexion et accès

- Connexion uniquement par Google (OAuth), via Better Auth avec l'adaptateur D1.
- Table `allowed_emails`. À la connexion, si l'adresse Google n'y figure pas, la session est refusée et un écran explique que l'accès est sur invitation.
- Le superadmin est désigné par une variable d'environnement (`SUPERADMIN_EMAIL`), toujours autorisé.
- Retirer une adresse de la liste bloque les connexions suivantes et invalide les sessions en cours de cet utilisateur. Ses données sont conservées.

### 6.2 Premier démarrage

À la première connexion d'un utilisateur autorisé :
1. Choix du modèle visuel parmi les 10 (vignettes d'aperçu sur un devis d'exemple).
2. Saisie du profil entreprise (6.3).
3. Arrivée sur le tableau de bord.

Le modèle et le profil restent modifiables à tout moment dans les réglages.

### 6.3 Profil entreprise

Champs :
- Nom commercial, nom et prénom de l'entrepreneur, mention « EI » (obligatoire pour un entrepreneur individuel, voir section 8).
- Ligne d'activité (ex. « Électricité générale • Installation • Rénovation »), texte libre.
- Adresse, SIRET, téléphone, e-mail.
- Logo (optionnel).
- Régime de TVA : en V1, franchise en base uniquement, affichée en lecture seule (pas de réglage).
- Assurance professionnelle (optionnelle ; obligatoire pour les métiers du bâtiment soumis à la garantie décennale) : assureur, numéro de contrat, zone couverte.
- Valeurs par défaut des modalités : durée de validité du devis, délai de paiement, texte des pénalités de retard, IBAN/coordonnées de paiement (optionnel).
- Préfixes de numérotation et numéro de départ (6.9).

Ces données sont **modifiables** dans le profil mais **recopiées** dans chaque document à son émission (6.8). Un déménagement ne modifie pas les factures passées.

### 6.4 Carnet de clients

- Fiche client : type (particulier / professionnel), nom ou raison sociale, adresse de facturation, SIREN/SIRET (si professionnel), e-mail, téléphone.
- Choisie dans une liste au moment de créer un devis, ou créée à la volée.
- Le type conditionne les mentions (indemnité forfaitaire de 40 € pour les professionnels uniquement).

### 6.5 Devis

Structure d'un devis (reprend le classeur d'origine, intitulés neutres) :
- En-tête : bloc entreprise (depuis le profil), bloc client, numéro, date.
- Adresse d'intervention (optionnelle, si différente de l'adresse de facturation ; libellé « chantier » dans le classeur d'origine).
- Objet : texte libre.
- Lignes : désignation, quantité, unité (u, h, jour, forfait, lot, m², ml… liste modifiable), prix unitaire HT, total HT calculé. **5 lignes vides par défaut**, bouton « Ajouter une ligne », suppression et réordonnancement des lignes.
- Totaux : total HT, mention « TVA non applicable, art. 293 B du CGI », total à payer = total HT.
- Modalités (valeurs par défaut du profil, modifiables par devis) : validité, début prévisionnel, durée estimée, conditions de paiement et acompte prévu.
- Bloc « Bon pour accord » : date, nom et signature du client (zone vide à remplir sur papier).

Tous les libellés des lignes et textes libres sont modifiables : l'outil est multi-métier.

**Lignes types** : l'utilisateur peut enregistrer une ligne (désignation, unité, prix) dans sa bibliothèque et l'insérer dans un devis. C'est ce qui remplace les lignes pré-remplies du classeur.

Statuts du devis :
- `brouillon` : modifiable.
- `envoyé` : l'utilisateur l'a marqué comme envoyé. Toujours modifiable.
- `accepté` : marqué à la main quand le bon pour accord signé est revenu. Contenu figé. Ouvre la facturation.
- `refusé` : figé, pas de facturation.

Le devis reçoit son numéro à la sortie du brouillon (premier passage à `envoyé` ou première impression, au choix du constructeur). Un devis peut être dupliqué pour en créer un nouveau.

### 6.6 Factures d'acompte et de solde

Depuis un devis accepté :
- **Facture d'acompte** : montant en pourcentage du total ou en montant fixe. Elle porte la référence du devis, l'objet, le montant de l'acompte et les mentions obligatoires. Plusieurs acomptes possibles ; leur somme ne peut pas dépasser le total du devis.
- **Facture de solde** : reprend toutes les lignes du devis, affiche le total, liste les factures d'acompte déjà émises (numéro, date, montant) et les déduit, et indique le reste à payer. Une seule facture de solde par devis.
- **Facture directe** : un devis accepté sans acompte donne directement une facture de solde (même document, sans acomptes à déduire).

Origine des données d'une facture issue d'un devis *(choix du rédacteur)* : les lignes, quantités, prix et l'objet viennent de l'instantané du devis accepté ; le bloc entreprise et les coordonnées du client viennent du profil et de la fiche client **au moment de l'émission de la facture**.

Montant d'un acompte en pourcentage : calculé sur le total à payer du devis (total HT, franchise de TVA). Arrondi au centime inférieur ; la facture de solde absorbe l'écart *(choix du rédacteur)*.

Règles de cohérence *(choix du rédacteur)* :
- au plus une facture de solde non annulée par devis ; si elle est annulée par avoir, une nouvelle peut être émise ;
- une facture d'acompte déjà déduite par une facture de solde non annulée ne peut pas recevoir d'avoir : il faut d'abord annuler le solde ;
- le total d'une facture de solde ne peut pas être inférieur à la somme des acomptes déduits (pas de reste à payer négatif ; l'outil bloque l'émission et invite à ajuster).

Une facture naît en `brouillon` (modifiable : date de prestation, échéance, mentions ; les lignes d'une facture de solde peuvent être ajustées si des travaux ont changé), puis passe en `émise` : elle reçoit son numéro et devient inaltérable.

Hors devis, l'utilisateur peut aussi créer une facture directement (prestation sans devis préalable), avec la même structure de lignes.

### 6.7 Paiement et avoirs

- Une facture émise peut être marquée `payée`, avec la date de paiement. Le tableau de bord montre le montant restant à encaisser.
- **Avoir** : seul moyen de corriger une facture émise. En V1, avoir **total** sur une facture (annulation complète) ; la facture annulée passe en `annulée`, et l'utilisateur peut en émettre une nouvelle. L'avoir porte la référence de la facture d'origine et un montant négatif. *(Choix du rédacteur : l'avoir partiel est reporté.)*

### 6.8 Figer un document

À l'émission d'une facture ou d'un avoir (et à l'acceptation d'un devis), on enregistre un **instantané JSON** complet : données entreprise, données client, lignes, totaux, mentions, identifiant et version du modèle visuel. L'affichage et l'impression d'un document figé se font **uniquement** depuis cet instantané, jamais depuis le profil ou la fiche client courants.

Les modèles visuels sont versionnés (`modele-03@1`). Un modèle publié n'est jamais modifié en place : toute évolution crée `modele-03@2`, et les anciens documents continuent d'utiliser leur version d'origine. Le code des anciennes versions reste donc dans l'application.

### 6.9 Numérotation

- Par utilisateur et par année civile : `D-2026-001` (devis), `F-2026-001` (factures d'acompte, de solde et directes, une seule suite commune), `A-2026-001` (avoirs).
- Préfixes modifiables dans le profil. Numéro de départ réglable une seule fois, pour reprendre une numérotation existante.
- Attribution à l'émission, dans la même opération atomique D1 (batch) que le passage au statut `émise` : incrément du compteur + mise à jour du document. Un brouillon supprimé ne consomme pas de numéro.
- Une facture émise ne peut pas être supprimée.

### 6.10 Modèles visuels

- **V1 : 3 modèles**, tirés des trois variantes du classeur d'origine (décision d'Anto). 7 autres viendront ensuite ; l'architecture doit permettre d'en ajouter un sans toucher au reste.
- Les modèles ne diffèrent **que par l'apparence** : mise en page, couleurs, typographie, filets, disposition des blocs. Tous affichent les mêmes champs.
- Implémentation : un composant React de rendu de document commun pour les données, 10 variantes de style (CSS), plus une feuille `@media print` avec `@page { size: A4; margin: … }`.
- Même rendu pour devis, facture d'acompte, facture de solde et avoir ; seuls le titre et les blocs propres à chaque type changent.
- Pagination : l'en-tête du tableau des lignes se répète sur chaque page (`thead` en `display: table-header-group`), une ligne n'est jamais coupée, le bloc des totaux et le bon pour accord restent groupés (`break-inside: avoid`).
- Les 3 modèles V1 reprennent l'esprit des trois onglets du classeur : « clair, structuré et intemporel », « discret, hiérarchie visuelle douce », « finition raffinée ». Leur rendu exact est à proposer en maquettes à Anto (section 11).

### 6.11 Impression

- Bouton « Imprimer / PDF » sur chaque document : ouvre une vue d'impression nue (sans interface) et appelle `window.print()`.
- Le titre de la page est fixé au numéro du document (`F-2026-004 – Client`) pour que le nom de fichier proposé soit utile.
- Message d'aide à côté du bouton : choisir « Enregistrer au format PDF » et décocher « En-têtes et pieds de page ».
- Cible principale : Chrome et Edge sur ordinateur. Safari et Firefox doivent rester lisibles.

### 6.12 Superadmin

Un écran réservé : liste des adresses autorisées (ajout, retrait), date de dernière connexion de chaque utilisateur. Pas d'accès au contenu des devis et factures des utilisateurs.

## 7. Modèle de données (esquisse)

Tables principales (D1 / SQLite), plus les tables propres à Better Auth :

- `allowed_emails` (email, ajouté_le, ajouté_par)
- `profiles` (user_id, données entreprise, régime TVA, modèle visuel par défaut, préfixes, valeurs par défaut)
- `clients` (id, user_id, type, identité, adresse, siren, contacts)
- `line_presets` (id, user_id, désignation, unité, prix)
- `quotes` (id, user_id, client_id, numéro, statut, objet, adresse d'intervention, modalités, lignes JSON ou table `quote_lines`, snapshot JSON à l'acceptation, dates)
- `invoices` (id, user_id, quote_id nullable, type : acompte / solde / directe / avoir, invoice_ref pour un avoir, numéro, statut, montants, date d'émission, échéance, date de paiement, snapshot JSON)
- `counters` (user_id, type de suite, année, dernière valeur)

Prévoir dès maintenant dans `profiles` un champ `vat_regime` (valeur unique `franchise` en V1) et dans les lignes un champ `vat_rate` nullable, pour accueillir la TVA plus tard sans casser les documents existants.

Montants stockés en **centimes** (entiers) pour éviter les erreurs d'arrondi. Chaque requête filtre par `user_id` issu de la session.

Les données sont structurées champ par champ (et pas seulement en texte), pour permettre plus tard un export Factur-X ou l'envoi à une plateforme agréée.

## 8. Mentions obligatoires

À vérifier par le constructeur sur les sources officielles (service-public.fr, entreprendre.service-public.fr, article L441-9 du Code de commerce, article 242 nonies A de l'annexe II au CGI) avant de figer les gabarits.

Devis : identité et coordonnées de l'entreprise, SIRET, date, durée de validité, client, décompte détaillé (désignation, quantité, prix unitaire), total HT, régime de TVA, mention de l'assurance pour les métiers qui l'exigent.

Facture (acompte, solde, directe) et avoir :
- numéro unique et date d'émission ;
- nom de l'entrepreneur précédé ou suivi de « EI » ou « entrepreneur individuel », adresse, SIRET ;
- nom et adresse de facturation du client, SIREN du client s'il est professionnel ;
- date de la prestation ou de la vente ;
- désignation, quantité, prix unitaire HT, total HT ;
- mention « TVA non applicable, art. 293 B du CGI » ;
- date d'échéance du paiement, taux des pénalités de retard ;
- pour un client professionnel : indemnité forfaitaire de 40 € pour frais de recouvrement ;
- conditions d'escompte (ou « Pas d'escompte pour paiement anticipé ») ;
- assurance professionnelle si applicable ;
- pour une facture de solde : références des factures d'acompte déduites ; pour un avoir : référence de la facture corrigée.

La réforme de la facturation électronique ajoute de nouvelles mentions (SIREN du client, nature des opérations, adresse de livraison si différente). Le constructeur vérifie leur date d'entrée en vigueur pour les micro-entrepreneurs ; les champs nécessaires sont prévus dans le modèle de données.

## 9. Pile technique

- Cloudflare Workers (offre gratuite), assets statiques servis par le même Worker.
- Front : React + Vite, TypeScript.
- API : Hono.
- Base : D1, migrations via Wrangler.
- Auth : Better Auth, fournisseur Google, adaptateur D1. Identifiants OAuth à créer dans Google Cloud Console (écran de consentement, URI de redirection prod et local).
- Logo : stocké en D1 en data URL limité à ~200 Ko après redimensionnement côté navigateur *(choix du rédacteur, évite R2 pour la V1)*.
- Déploiement : `wrangler deploy`. Environnement de dev : WSL Ubuntu, Claude Code.

## 10. Risques

- **Limite de 10 ms CPU** du Worker gratuit : à surveiller sur la vérification de session Better Auth et les calculs de totaux. Si elle est dépassée, l'offre Workers Paid (5 $/mois) lève la limite.
- **Impression navigateur** : rendu légèrement variable selon le navigateur, et dépend de l'utilisateur pour décocher les en-têtes. À tester sur Chrome, Edge, Safari, Firefox.
- **Versionnage des modèles** : toute retouche d'un modèle doit créer une nouvelle version, sinon les factures anciennes changent d'apparence.

## 11. Laissé au constructeur

- Arborescence du projet, découpage des composants, bibliothèque UI et gestion d'état.
- Moment exact de l'attribution du numéro de devis.
- Format de stockage des lignes (table ou JSON).
- Ergonomie du tableau de bord et des listes (filtres, recherche).
- **Conception visuelle des 3 modèles V1** : maquettes soumises à Anto avant intégration, en partant des trois onglets du classeur. Les 7 suivants suivront le même circuit après la V1.
- Tests : priorité aux calculs (totaux, acomptes, solde, arrondis en centimes), à la numérotation (continuité, atomicité, remise à zéro annuelle) et au cloisonnement par utilisateur.

## 12. Plus tard

- Facturation électronique (plateformes agréées, Factur-X, e-reporting pour les clients particuliers), avant l'échéance de septembre 2027.
- Avoirs partiels.
- Les 7 modèles visuels restants.
- Gestion de la TVA pour les utilisateurs assujettis (taux unique ou par ligne à décider), avec bascule depuis la franchise.
- Envoi par e-mail, archive PDF (react-pdf ou rendu serveur), signature électronique, relances de paiement.
