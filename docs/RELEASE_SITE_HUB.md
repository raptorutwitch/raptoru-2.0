# Publication du chantier raptoru.fr (lots 1 à 5 + navigation, live, Daily) — plan, rien n'est fait

État au 04/11/2026. **Chaque étape attend le GO explicite d'Antoni.** Aucune n'a été lancée.

## 1. Ce qui part, et d'où

| Composant | Branche (worktree) | Écart | Contenu |
|---|---|---|---|
| Core + Studio (dépôt Raptoru 2.0) | `feat/site-hub-core` (`Raptoru 2.0 - Worktrees/site-hub-core`) | 12 commits (dont ce plan) sur `origin/main` `8b2189e`, 0 de retard, fusion sans conflit | badges équipés dans les classements, cadres et bannières, statistiques des modules, moteur de défis, Daily avec sa table de paliers ; atelier Cadres / Bannières et onglet Défis dans Studio |
| Site (dépôt raptoru.fr) | `feat/site-hub-chantier` (`Raptoru 2.0 - Worktrees/raptoru-fr-refonte`) | 15 commits sur `origin/main` `542b1f2` (la Production), 0 de retard, fusion sans conflit | lots 1 à 5, Twitch / Portfolio, panneau « EN LIVE », indicateur Daily, banc d'intégration |
| Bot, extension | — | aucun changement | — |

**À savoir avant le Core** :
- `origin/main` contient déjà 4 PR fusionnées après `ca57adf` (la dernière version du Core connue en Production) : #50, #51, #53, et #52, qui touche le Core (attente facultative entre deux screamers d'un même viewer).
- Elles partiront avec ce déploiement si la Production est encore sur `ca57adf`. Le vérifier avec `node scripts/coolify-deploy.mjs status core` avant le plan.
- Aucune de ces PR n'ajoute de migration.

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
- **Répétées** sur une base locale jetable avec exactement cette sélection : 62 migrations sans erreur (§ 5).
- Retour arrière : jamais de suppression. Le SQL d'annulation est en commentaire dans chaque fichier, à n'utiliser que sur décision.
- Le site n'a aucune migration Supabase (celle du 03/11 sur les préférences de profil est déjà appliquée).

## 3. Ordre de publication recommandé

| # | Étape | Qui | Vérification avant de continuer |
|---|---|---|---|
| 0 | **Sauvegarde** | Antoni | Coolify › `raptoru-prod-postgres` › Backups › Download ; ranger hors du dépôt ; `pg_restore --list` sans erreur, taille identique à Coolify (`docs/BACKUPS.md`). |
| 0 bis | **Répétition sur cette copie** (recommandée) | agent, sur GO d'Antoni pour utiliser la copie | Restaurer dans une base locale jetable, appliquer les migrations, lancer le Core de la branche dessus. Prévisualiser un défi rétroactif sur chaque métrique visée, pour **mesurer le volume et la durée du premier recomptage sur les vraies données**. Rien ne sort du poste. |
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

## 6. Risques et dépendances

| Risque | Mesure |
|---|---|
| Premier recomptage rétroactif lourd sur tout l'historique (Wallet, Daily) | moteur coupé en Production ; un défi n'est compté qu'à son activation par Antoni ; mesure sur copie à l'étape 0 bis |
| Récompense versée par erreur | aucune récompense sans défi activé ; une seule par (défi, période, viewer) ; un objet se retire dans Studio ; les Jetons se corrigent par un ajustement du Wallet |
| PR #52 (screamers) part avec le Core si elle n'est pas en Production | la vérifier au plan (§ 1) ; elle est fusionnée et testée, et désactivée par défaut |
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
