# Publication du chantier raptoru.fr (lots 1 à 5 + navigation, live, Daily) — plan, rien n'est fait

État au 04/11/2026. **Chaque étape attend le GO explicite d'Antoni.** Aucune n'a été lancée.

## 1. Ce qui part, et d'où

| Composant | Branche (worktree) | Écart | Contenu |
|---|---|---|---|
| Core + Studio (dépôt Raptoru 2.0) | `feat/site-hub-core` (`Raptoru 2.0 - Worktrees/site-hub-core`) | 14 commits (dont ce plan) sur `origin/main` `8b2189e` (= la Production), 0 de retard, fusion sans conflit | badges équipés dans les classements, cadres et bannières, statistiques des modules, moteur de défis, Daily avec sa table de paliers ; atelier Cadres / Bannières et onglet Défis dans Studio |
| Site (dépôt raptoru.fr) | `feat/site-hub-chantier` (`Raptoru 2.0 - Worktrees/raptoru-fr-refonte`) | 15 commits sur `origin/main` `542b1f2` (la Production), 0 de retard, fusion sans conflit | lots 1 à 5, Twitch / Portfolio, panneau « EN LIVE », indicateur Daily, banc d'intégration |
| Bot, extension | — | aucun changement | — |

**Versions vérifiées le 04/11** (`node scripts/coolify-deploy.mjs status core`, lecture seule) :
- Le Core en Production est sur `8b2189e` (déployé le 31/10 13:02 UTC), soit exactement `origin/main`. Les PR #50 à #53 y sont déjà.
- Le déploiement n'apportera donc **que** les commits de `feat/site-hub-core` : des ajouts dans `apps/core-api`, `apps/studio`, `packages/schemas`, les deux migrations et la documentation.
- Bot `4ba9243`, inchangé. Santé `/health` et `/ready` OK. Dernière sauvegarde Coolify réussie : 03/11 04:00 UTC.

## 2. Migrations (base du Core), dans cet ordre

1. `20261119130000_cosmetic_frames_banners.sql` :
   - types d'objets `frame` et `banner` ;
   - colonnes nullables `frame_id` et `banner_id` sur `progression_equipped` ;
   - bornes des images.
2. `20261120130000_challenges.sql` : cinq tables neuves (`challenge_defs`, `challenge_progress`, `challenge_awards`, `challenge_runs`, `challenge_log`).

Ce qu'il faut savoir :
- **Additives**, sans aucune donnée : aucun objet, aucune offre, aucun défi n'est créé. Vérifié : une base neuve migrée a des catalogues vides.
- Contraintes sur de petites tables (catalogue, images), sans verrou long.
- Le Core actuel les ignore : on peut migrer avant de déployer.
- Elles sont appliquées par le déploiement du Core (`MIGRATION_SCOPE=staging`, `--migrations-approved`).
- **Répétées** sur une base locale jetable avec exactement cette sélection (62 migrations sans erreur), puis **sur une copie restaurée de la Production** (§ 5 bis) : 0,55 s, aucune donnée existante modifiée.
- Retour arrière : jamais de suppression. Le SQL d'annulation est en commentaire dans chaque fichier, à n'utiliser que sur décision.
- Le site n'a aucune migration Supabase (celle du 03/11 sur les préférences de profil est déjà appliquée).

## 3. Ordre de publication recommandé

| # | Étape | Qui | Vérification avant de continuer |
|---|---|---|---|
| 0 | **Sauvegarde** | Antoni | Coolify › `raptoru-prod-postgres` › Backups › Download ; ranger hors du dépôt ; `pg_restore --list` sans erreur, taille identique à Coolify (`docs/BACKUPS.md`). |
| 0 bis | ~~Répétition sur une copie~~ **faite le 04/11** (§ 5 bis) | — | Facultatif : la refaire sur la sauvegarde de l'étape 0, avec les mêmes scripts, si plusieurs jours ont passé. |
| 1 | PR Core `feat/site-hub-core` → `main`, CI verte, fusion | Antoni | CI : tests, typage, build. |
| 2 | Déploiement du Core avec migrations | agent sur GO | `plan core <sha> --migrations-approved`, puis `deploy … --go`. **`CHALLENGES_ENGINE` reste absent ou à `false`.** Contrôles § 4.1. |
| 3 | Release Studio (`npm run studio:release`) | agent sur GO | Antoni installe. Contrôles § 4.2. |
| 4 | PR site `feat/site-hub-chantier` → `main`, fusion (déploie) | Antoni | Contrôles § 4.3. Retour arrière prêt : redéployer `542b1f2`. |
| 5 | Contenu : objets (cadres, bannières), puis défis, créés et validés par Antoni dans Studio | Antoni | Les catalogues restent vides jusque-là. Un défi n'est compté qu'une fois activé par Antoni. |
| 6 | Plus tard : `CHALLENGES_ENGINE=true` (recomptage toutes les 60 s) | agent sur GO | Seulement après la mesure du premier recomptage et quelques défis validés. |

Le Core passe avant Studio et avant le site. Pourquoi :
- un nouveau Studio face à un ancien Core afficherait l'onglet Défis et l'atelier sans leurs routes ;
- le site, lui, supporte un ancien Core : Défis « momentanément indisponibles », points du Daily seulement si la récompense du Core confirme la table, pas de cadres.

## 4. Contrôles après chaque déploiement (lecture seule, rien n'est créé)

### 4.1 Core
- `status core` sur le SHA attendu ; journal de migration avec les deux fichiers.
- `GET /v1/daily/viewers/<id d'Antoni>` contient `rewardSteps` (500 → 2000).
- `GET /v1/site/challenges` avec le jeton du site répond `{ challenges: [] }`.
- `GET /v1/cosmetics/catalog` est inchangé : seuls les objets existants.
- Supervision Studio verte ; les modules en direct (Daily, Bonk, Boutique) répondent comme avant.

### 4.2 Studio
- L'onglet Défis s'ouvre, les métriques sont « disponibles » (Wallet, Daily), la liste est vide.
- Atelier : ouvrir un cadre en **brouillon** sans le publier, puis le supprimer.
- La Boutique et la Progression sont inchangées.

### 4.3 Site
- Accueil, classements, profils, Boutique, Défis (« Aucun défi pour l'instant »), Guide.
- Connecté : Daily à 10 points avec les bons montants ; « Mes défis » ; équipement d'un titre existant.
- Pendant un live : panneau « EN LIVE » avec la photo de la chaîne, pastille dans la navigation. Hors live : rien.
- iPhone / Safari : jamais vérifiés jusqu'ici.
- Portfolio et Twitch s'ouvrent dans un nouvel onglet.

## 5. Ce qui a été vérifié avant ce plan (04/11)

- **Intégration réelle** (`lb-app/dev/integration/run.mjs`) : 45 étapes réussies.
  - Montage : le vrai Core de la branche, lancé comme en Production (économie canonique, Daily payé par le Wallet, moteur de défis coupé, ni bot ni identifiants Twitch), sur une base PostgreSQL locale jetable migrée avec la sélection de Production. Wallet ouvert avec des soldes fictifs, installation Studio appairée, site branché dessus ; Supabase et Helix sont simulés.
  - Permissions, Daily et paliers, chat → progression, atelier (images vérifiées par le Core), achat unique, équipement, classements, profil, carte de joueur, statistiques des modules.
  - Défis : rétroactif, à partir de l'activation, Jetons versés une seule fois malgré des recomptages parallèles, suspension, archivage, condition figée.
  - Wallet : chaque solde égale la somme de son journal.
  - Navigateur : 7 pages × 2 largeurs.
- **Site** : 254/254 ; contrôle visuel automatique sans problème.
- **Core** : tests ciblés 109/109 ; typage correct ; suite complète du 03/11 : 1 324 réussis, 0 échec.
- **Studio** : e2e Défis, Boutique, cadres, Progression 5/5 (sur le Core du Lab).
- **Non vérifié** :
  - aucun test manuel d'Antoni sur ces fonctions ;
  - le volume réel d'un premier recomptage (étape 0 bis) ;
  - Studio installé face au Core réel (les routes qu'il appelle, elles, sont testées avec une vraie installation) ;
  - le vrai Helix avec le jeton du site ;
  - Safari et vrais téléphones.

## 5 bis. Répétition sur une copie de la Production (04/11, autorisée par Antoni)

- **Copie utilisée** : la sauvegarde Coolify du Core du **30/10 18:30 UTC** (`prod-db-2026-10-30`, base `raptoru_prod`). C'est la plus récente du Core présente sur le poste.
  - Le dump du 03/11 de `Downloads` est celui de la **base Supabase de l'ancien site** (`auth`, `vault`, `players`…) et non celui du Core. Il n'a pas été restauré.
  - Aucune autre donnée n'a été récupérée.
- **Intégrité** : SHA-256 et taille identiques à `LISEZMOI.txt` (3 355 552 octets) ; `pg_restore --list` sans erreur (132 tables avec données).
- **Restauration** : dans un conteneur PostgreSQL 17 dédié, accessible uniquement depuis `127.0.0.1`, en 3 s, sans erreur : 132 tables, 58 migrations. **Le conteneur et la copie ont été supprimés à la fin.**
- **Migrations** : le vrai script du Core (`MIGRATION_SCOPE=staging`) a appliqué, en **0,55 s** au total :
  - `halloween_economy` et `cosmetic_shop`, déjà en Production depuis le 30 et le 31/10, mais postérieures à la copie ;
  - les deux nouvelles, `cosmetic_frames_banners` puis `challenges`.
- **Préservation** : avant et après les migrations, puis après le passage du Core, le nombre de lignes et une empreinte du contenu ont été comparés sur les colonnes d'origine des 131 tables :
  - **aucune table modifiée** (sauf `studio_installations`, qui contient l'installation de test) ;
  - totaux métier identiques : 736 comptes en Jetons pour 42 203 487 Jetons, crédits TTS et Soundboard, 13 242 lignes de journal, soldes égaux au journal (0 écart), 1 026 viewers, 1 622 comptes de progression, Daily (129 joueurs, 5 198 réclamés, record 266).
- **Premier recomptage**, par le vrai Core lancé sur la copie (économie canonique acceptée, moteur coupé, Daily en paiement différé, sans bot ni Twitch) :
  - 18 défis « Exemple fictif » **sans récompense**, rétroactifs : les 14 métriques en défi unique, plus « chaque semaine » et « chaque mois » pour la présence et les messages ;
  - prévisualisation : 6 à 32 ms ;
  - activation (premier recomptage complet) : **27 à 112 ms par défi**. Le plus lourd, la présence à vie, écrit 1 499 progressions en 110 ms ;
  - au total : 3 080 progressions, 6 178 lignes de journal, **0 récompense**, aucun verrou restant.
- **Recomptage périodique** (ce que ferait `CHALLENGES_ENGINE` toutes les 60 s) : avec les 18 défis actifs, **170 à 280 ms par passe** (5 mesures), soit moins de 0,5 % du temps.
- **Requêtes** (`EXPLAIN ANALYZE` de chaque métrique sur les volumes réels) : **0,1 à 2,3 ms**.
  - Parcours séquentiels, que le planificateur choisit sur ces petites tables : `wallet_transactions` 13 255 lignes, `daily_claims` 1 483, `progression_accounts` 1 622.
  - Ces requêtes croissent linéairement : à 100 fois le volume du Wallet, une métrique « payée » resterait de l'ordre de la centaine de millisecondes. Un index dédié aux clés `interaction:%:debit` ne serait utile qu'à ce moment-là : non bloquant.
  - Les tables `challenge_*` ont leurs index (viewer, récompenses en attente, passes récentes, journal par défi).
- **Statistiques par semaine et par mois** : vides dans cette copie (elles n'existent que depuis le 29/10). Leur coût suit celui des statistiques à vie, qui ont été mesurées.
- **Lectures publiques** sur données réelles : statut Daily 14 ms (`rewardSteps` présent, série 9 → prochaine récompense 2 000), classement de progression (500 lignes) 24 ms.
- **Risques de blocage** :
  - la migration des cadres modifie deux petites tables (`progression_rewards` : contrainte ; `progression_equipped` : deux colonnes nullables, sans réécriture) par des verrous brefs. **La lancer hors live** ;
  - chaque recomptage ne verrouille que la ligne de son défi (`for update`) et lit les tables des modules sans verrou ;
  - deux passes simultanées sont sérialisées (testé sur PostgreSQL : un seul versement).

## 6. Risques et dépendances

| Risque | Mesure |
|---|---|
| Premier recomptage rétroactif lourd sur tout l'historique (Wallet, Daily) | **mesuré sur la copie : 112 ms au plus par défi** ; moteur coupé en Production ; un défi n'est compté qu'à son activation par Antoni |
| Récompense versée par erreur | aucune récompense sans défi activé ; une seule par (défi, période, viewer) ; un objet se retire dans Studio ; les Jetons se corrigent par un ajustement du Wallet |
| Index du Wallet à long terme (requêtes « payé ») | 2 ms aujourd'hui, croissance linéaire ; ajouter un index seulement si le Wallet atteint des centaines de milliers de lignes |
| Studio publié avant le Core | ne pas inverser les étapes 2 et 3 |
| « EN LIVE » sans jeton Twitch sur le site | le lien Twitch reste, sans statut ; `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` existent déjà pour la connexion. L'identifiant de chaîne est le premier de `ADMIN_TWITCH_IDS`, ou `TWITCH_BROADCASTER_ID` s'il est défini : à vérifier dans Coolify, en lecture. |
| Cache | progression d'un viewer : 15 s ; statut live : 60 s ; Daily : 15 s côté site, 30 s dans la page |

## 7. Retour arrière

| Quoi | Comment |
|---|---|
| Site | Coolify › redéployer `542b1f2` (l'ancien site reste aussi sur `/classic/`) |
| Core | `node scripts/coolify-deploy.mjs deploy core <sha précédent> --rollback --go` ; les tables restent, l'ancien code les ignore |
| Studio | réinstaller l'installateur précédent (`docs/BACKUPS.md` § 5) |
| Un défi | Studio › Défis › Suspendre (plus de comptage ni de versement), ou Archiver ; `CHALLENGES_ENGINE=false` |
| Un objet ou une offre | Studio › Boutique : Masquer, ou désactiver l'offre ; une récompense de défi se retire avec une raison |
| Base | restaurer la sauvegarde de l'étape 0 dans une base, jamais sur la Production sans décision |

## 8. Activation des défis, plus tard

1. Antoni crée ses défis en brouillon ; « Vérifier et prévisualiser » montre qui compterait et qui terminerait tout de suite.
2. Il active un défi : le Core le recompte une fois (le journal de la passe est visible dans Studio).
3. Il contrôle les récompenses versées (Studio › détail du défi).
4. Après quelques défis validés : GO pour `CHALLENGES_ENGINE=true` (recomptage toutes les 60 s), redémarrage du Core.
