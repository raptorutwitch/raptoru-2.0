# Opération Coulisses — dossier GO / NO-GO (07/11/2026)

> **Exécuté le 07/11/2026** (GO d'Antoni) : voir § 12. Les §§ 1–11 décrivent la préparation (« Candidat », « aucune action sur la Production ») et sont d'époque. Après la bascule, PR #57 → Studio 0.1.27, installée (code Studio seulement). Une recette d'usage d'Antoni en Production n'est pas écrite à ce jour.

Point de reprise de la bascule. Préparation faite le 07/11 ; **aucune action sur la Production, le Studio installé, Twitch ou
OBS**. Détails antérieurs : [LIVRAISON.md](LIVRAISON.md) § 9, [MIGRATION_DONNEES.md](MIGRATION_DONNEES.md),
[PARITE_RECOMPENSES.md](PARITE_RECOMPENSES.md). Ce document prime là où il diffère.

## 1. État relevé (sources vivantes, 07/11 ~17:30 UTC)

| Élément       | En service                                                                   | Candidat                                                                       | Source                                             |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Core          | `8a897a5` (Coolify running:healthy, `/health` `/ready` OK, déployé le 04/11) | `feat/studio-ux` (`ffca7be` + ce document), 162 commits au-dessus de `8a897a5` | `coolify-deploy.mjs status core`, `/v1/ops/status` |
| Bot           | `4ba9243` (bail actif, EventSub bot + broadcaster OK)                        | même commit que le Core                                                        | idem                                               |
| `origin/main` | `8a897a5`, CI verte                                                          | —                                                                              | `scripts/delivery/status.mjs`                      |
| Studio        | 0.1.25 installé (`8a897a5`, profil `production`) et publié                   | version suivante produite par `studio:release` (jamais à la main)              | `build-info.json`, releases                        |
| Extension     | version de la console Twitch (non lisible d'ici)                             | **pas de republication**                                                       | —                                                  |
| Schéma        | 62 migrations                                                                | 67 (+5)                                                                        | `/v1/ops/status`                                   |
| Live          | hors live (session Core + Helix)                                             | —                                                                              | live-guard                                         |

La Production n'a pas évolué depuis le début de la refonte : `origin/main` = merge-base de la branche, aucun commit à réconcilier.
Coolify est passé en 4.6.0 : **l'API répond sur `https://dashboard.raptoru.fr`**, `https://coolify.raptoru.fr` renvoie 502.
En local : `COOLIFY_URL=https://dashboard.raptoru.fr`. Le secret GitHub `COOLIFY_URL` est à corriger par Antoni avant d'utiliser
les workflows « Déployer » / « État » (non vérifié : sa valeur n'est pas lisible).

## 2. Sauvegardes

| Sauvegarde                                                                                                                                                                                                                                                      | Emplacement                                                                                                                      | Vérification                                                                                                                          | Confiance                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Base Production, dump Coolify 04/11 00:06 UTC (sha256 `75b497df…`)                                                                                                                                                                                              | `C:\Users\Antoni\Downloads\pg-dump-raptoru_prod-1793750781-….dmp` (à ranger dans `Sauvegarde Raptoru 2.0`)                       | **restauré** dans une base jetable (`postgres:17-alpine`) : 138 tables, 60 migrations, 842 portefeuilles ; migrations rejouées dessus | **A**                                 |
| Base Production, sauvegarde automatique 07/11 04:00 UTC                                                                                                                                                                                                         | Coolify (VPS)                                                                                                                    | statut « success »                                                                                                                    | B                                     |
| Données locales Studio (204 fichiers : `.runtime` entier dont 30 médias d'alertes, `placement.json`, jetons des sources OBS, `se-mode.json`, appairage, `.env`, jetons Twitch, `~/.raptoru`, `%APPDATA%\Raptoru Studio` + Local Storage, scènes et profils OBS) | `Documents\Sauvegarde Raptoru 2.0\studio-data-2026-11-07-avant-coulisses\` (Antoni + SYSTEM) — archive sha256 `d2f8ea87…`, 69 Mo | relue membre à membre 204/204 ; **restauration d'essai** dans un dossier vide 204/204 identiques                                      | **A** (Studio fermé pendant la copie) |
| Installateur de retour 0.1.25                                                                                                                                                                                                                                   | `Documents\Sauvegarde Raptoru 2.0\studio-installer-0.1.25\` (sha256 `cb770290…`)                                                 | sha512 identique au `latest.yml` publié                                                                                               | B                                     |
| Ancien Core / bot                                                                                                                                                                                                                                               | images Coolify `8a897a5` / `4ba9243` (historique des déploiements)                                                               | listés par Coolify                                                                                                                    | B                                     |

**À refaire le jour J (dans l'heure qui précède)** : « Backup now » Coolify (exigé < 60 min par le script) puis
**téléchargement par Antoni** (l'API ne le permet pas), restauration d'essai locale ; `studio_backup.py create|verify|restore-test`
dans un nouveau dossier daté.

## 3. Migrations (5 fichiers, répétées sur la copie du 04/11)

`20261121130000_sub_wheel_enabled_at`, `…140000_word_game_settings_lab`, `…160000_module_settings`, `…180000_module_activity`,
`…190000_cmd_steps_module_origin_lab` : liste calculée par `selectMigrations` contre les 62 noms réels.
Répétition : 7 fichiers appliqués en **2,3 s** au total (dont les 2 de `main` absents de ce dump), rejeu « already up to date »,
Jeu des mots conservé ON 5–15 min, frontière de la Roue reprise de `updated_at`, contrainte `cmd_steps` posée sans rejet
(1 993 lignes existantes). Une transaction par fichier, verrou consultatif, sommes de contrôle : une interruption laisse les
fichiers précédents appliqués et le suivant intact ; relancer reprend au premier manquant. Toutes additives ; l'ancien Core
**démarre** sur le schéma migré (vérifié).

## 4. Compatibilité (preuves)

| Combinaison                                           | Verdict                                                                    | Preuve                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nouveau Core + données réelles migrées                | **compatible**                                                             | démarré sur la copie (économie canonique), routes Studio lues : alertes, récompenses (40, 30 demandes), Votekick, Caution, Roue, catalogue cockpit                                      |
| Ancien Core + schéma migré                            | **compatible sous condition** (`weights` retiré, § 6)                      | démarré sur la copie ; perte des réglages Follow **reproduite** puis évitée par la procédure                                                                                            |
| Nouveau Studio + nouveau Core                         | compatible (Lab, suites, E2E) ; **non vérifié contre la vraie Production** | recette Production § 7                                                                                                                                                                  |
| Ancien Studio 0.1.25 + nouveau Core                   | compatible sauf « Créditer / Débiter » (clé P0-2)                          | code ; fenêtre courte entre Core et Studio                                                                                                                                              |
| Extension publiée + nouveau Core                      | compatible (routes inchangées, `/modules/v3` ajoutée)                      | code + tests ; version publiée non lisible                                                                                                                                              |
| Bot actuel + nouveau Core / nouveau bot + ancien Core | compatibles                                                                | contrats `/v1/bot/*` inchangés ; le nouveau bot ajoute Lead Moderator et la reprise P0-5                                                                                                |
| Lecteurs OBS actuels + nouveau Studio                 | compatibles : mêmes jetons et URL de sources                               | `alerts/runtime.ts`, sauvegarde des jetons                                                                                                                                              |
| Récompenses Twitch réelles                            | **compatible sous réserve de vérification réelle**                         | [PARITE_RECOMPENSES.md](PARITE_RECOMPENSES.md) ; au 04/11 : 40 récompenses, interrupteur ON, 10 règles, 1 seule créée par Raptoru (« Choisi la prochaine musique », seule remboursable) |

## 5. Plan d'exécution (après GO, hors live)

| #   | Étape                                                                                                                                                 | Contrôle                                                                                                              | Arrêt si                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 0   | Revalider : live OFF (2 sources), Studio et OBS fermés, aucune file en cours (`/v1/ops/status`, `status core                                          | bot`)                                                                                                                 | —                                                | live ou inconnu |
| 1   | Sauvegardes du jour (§ 2) : Backup now → téléchargement **Antoni** → restauration d'essai ; `studio_backup.py`                                        | restauration OK                                                                                                       | échec                                            |
| 2   | Relevés avant : `alert_settings`, `sw_settings`, `word_game_channels`, `cp_settings` (depuis le dump restauré)                                        | —                                                                                                                     | —                                                |
| 3   | Pousser `feat/studio-ux`, PR vers `main`, CI verte, merge → SHA `S`                                                                                   | CI                                                                                                                    | CI rouge                                         |
| 4   | `plan core S` puis `deploy core S --migrations-approved --go` (~2 min d'arrêt du Core ; l'outbox du bot et les clients réessaient)                    | `applied:` les 5 fichiers, `running:healthy`, `/ready`, commit `S` rapporté, 67 migrations, catalogue cockpit         | une migration échoue, `/ready` KO, 5xx `/v1/ext` |
| 5   | Studio : workflow « Publier Studio » `none` (artefact vérifié) → `draft` → `public` ; **Antoni** installe depuis le Studio 0.1.25 (ou l'installateur) | profil Production, appairage sans ressaisie, OBS reconnecté, URL des sources inchangées, Créditer/Débiter, Classement | pas d'appairage, URL changées                    |
| 6   | `deploy bot S --go`                                                                                                                                   | bail actif version `S`, EventSub OK                                                                                   | bot sans bail                                    |
| 7   | Recette Production lecture seule (§ 7)                                                                                                                | —                                                                                                                     | écart de solde, erreurs répétées                 |
| 8   | Annonce H1 aux viewers (pas d'achat lié au stream hors live)                                                                                          | —                                                                                                                     | —                                                |

Ne pas régler les poids Follow avant la fin de la recette.

## 6. Retour arrière

| Cas                                            | Signes                                | Action                                                                                                                                                         | Données                                                     |
| ---------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Avant migration                             | —                                     | rien à défaire                                                                                                                                                 | —                                                           |
| 2. Pendant une migration                       | `deploy` en ÉCHEC, `applied:` partiel | ne rien supprimer ; les fichiers appliqués restent (additifs) ; Core `8a897a5` relancé (`--rollback`) ; analyser avant de rejouer                              | aucune perte                                                |
| 3. Nouveau Core KO, Studio pas encore installé | `/ready`, 5xx, ops                    | SQL ci-dessous **puis** `deploy core 8a897a5 --rollback --go`                                                                                                  | voir ci-dessous                                             |
| 4. Nouveau Studio KO                           | appairage, écrans                     | installer 0.1.25 (§ 2) ; restaurer `alerts\placement.json` de la sauvegarde ; `se-mode.json` à TEST/OFF si besoin                                              | looks d'alertes, catégories Soundboard (restent sur disque) |
| 5. Bot KO                                      | pas de bail                           | `deploy bot 4ba9243 --rollback --go`                                                                                                                           | Lead Moderators redeviennent viewers                        |
| 6. Extension                                   | —                                     | rien (non republiée)                                                                                                                                           | —                                                           |
| 7. Lecteurs / médias                           | sources noires                        | restaurer `player-token` / `overlay-token` / médias depuis l'archive                                                                                           | —                                                           |
| 8. Problème économique                         | écart de solde, double débit          | interrupteur du module concerné / Core `8a897a5` ; **jamais** de restauration de dump sur la Production sans décision (elle effacerait les achats postérieurs) | journaux `wallet_*` conservés                               |
| 9. Après réouverture du live                   | —                                     | cas 3 à 8 ; même règle pour la base                                                                                                                            | —                                                           |

**SQL avant un retour au Core `8a897a5`** (vérifié sur la copie : sans lui, l'ancien Core lit `{"families":{}}`) :

```sql
create table if not exists rollback_alert_weights as
  select channel_id, variants->'weights' as weights, now() as saved_at from alert_settings where variants ? 'weights';
update alert_settings set variants = variants - 'weights' where variants ? 'weights';
-- au redéploiement du nouveau Core :
update alert_settings a set variants = a.variants || jsonb_build_object('weights', r.weights)
  from rollback_alert_weights r where r.channel_id = a.channel_id;
update sw_settings set enabled_at = updated_at where enabled and (enabled_at is null or enabled_at < updated_at);
```

Effets connus d'un retour au Core `8a897a5` (audit du code, rien d'écrit de travers) : tarifs et délais réglés dans Studio
→ valeurs par défaut (table `module_settings` conservée, reprise au redéploiement) ; Jeu des mots OFF → ON (pendant un live :
Stop puis Start) ; complément de palier H9 en attente jamais payé par l'ancien Core (liste :
`breakdown->>'complement' = 'awaiting'`) ; devis Caution ouvert au moment du retour refusé (30 s).

## 7. Recette Production (lecture seule d'abord)

Core sain et commit `S` ; bot actif ; Studio en profil Production, appairé ; soldes de 3 viewers connus inchangés ; historique
Tombola / alertes / Bonk présent ; Récompenses = liste Twitch du jour avec règles et interrupteur ; lecteurs OBS (Alertes,
Effets, Soundboard, TTS) chargés sans action ; Spotify connecté ; « Prêt pour le live » cohérent. Tests actifs limités, au choix
d'Antoni : une alerte de test **en mode TEST** dans OBS hors live, un « Tester » de récompense sur une scène de test. Jamais :
vrai ban, achat réel, remboursement, modification de récompense, commande publique.

## 8. Risques restants

- Comportement changé, voulu : H1 (pas d'achat lié au stream hors live), H5 (`se-mode` actuellement **ACTIVE** → les vrais
  dons StreamElements sont animés dès le démarrage du nouveau Studio).
- Rien n'a tourné contre la vraie Production ; la recette du § 7 le couvre.
- Téléchargement du dump du jour : manuel (Antoni).

## 9. Validation technique (07/11, sur `ffca7be`, une seule exécution séquentielle)

Build, typage, lint : OK. Core 1 615/1 615 (159 fichiers, dont PostgreSQL réel), Studio 959/959, bot 287/287, extension 97/97,
desktop 36/36, outils de livraison 53/53, E2E navigateur 111/111 — tous au premier passage (Core et Studio à `--maxWorkers=2`).
Seul écart : `format:check` refusait 42 fichiers de la branche (la CI de `main` l'exige) → `98c8aab`, mise en forme seule ;
rejoués après : format, typage, build, lint et les tests des 5 fichiers de code touchés (OK). Les suites complètes ne sont pas
rejouées sur `98c8aab` : la CI de la PR le fera.

## 10. Installateur (essai local, non publié)

`npm run studio:package` sur `98c8aab` : `Raptoru Studio Setup 0.1.6.exe` (numéro du dépôt : **à ne jamais installer**, seul
`studio:release` produit la vraie version). Contenu : serveur, web, 10 lecteurs / overlays, 97 migrations, aucun `.env`, jeton ni
`.runtime`. Lancé non installé, isolé (`STUDIO_LAB_CORE=legacy` → profil Electron « Raptoru Studio Lab », dossier de données
vide) : serveur prêt en ~1 s sur 4100 et Dock sur 4110, profil Lab, aucune donnée chargée ; fermeture de la fenêtre → serveur
arrêté code 0, ports libérés, aucun processus restant. **Non vérifiable ici** : le profil Production empaqueté (il exige le vrai
Core et l'appairage existant) → recette § 7.

Environnements de répétition gardés jusqu'à la bascule : conteneur `coulisses-rehearsal-pg` (127.0.0.1:55530, copie du 04/11,
jetable) et worktree `Raptoru 2.0 - Worktrees\rollback-8a897a5` (ancien Core). À supprimer après acceptation.

## 11. Décision proposée

**GO recommandé**, aux conditions du § 5 étapes 0–1 (hors live revérifié ; dump du jour téléchargé par Antoni et restauré avec
succès ; nouvelle copie `studio_backup.py`). Sans elles : NO-GO.

## 12. Exécution (07/11/2026, GO d'Antoni)

| Heure (UTC) | Étape                  | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 18:31       | État revérifié         | Core `8a897a5`, bot `4ba9243`, hors live, Studio et OBS fermés                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 18:32       | « Backup now » Coolify | `pg-dump-raptoru_prod-1794076368-…dmp`, 7 926 138 octets, téléchargé par Antoni, sha256 `3506036b…`, copié dans `Sauvegarde Raptoru 2.0\prod-db-2026-11-07-avant-coulisses` ; **restauré** (143 tables, 859 portefeuilles, 30 288 transactions), aucune opération en attente ; relevés `releves-avant.txt` ; 5 migrations et SQL de retour arrière rejoués dessus                                                                                                                                          |
| 18:35       | PR #56                 | CI 11/11 sur `7fabc55` ; merge → `main` = `1b25f30` (même arbre) ; CI de `main` verte (run 42402870772)                                                                                                                                                                                                                                                                                                                                                                                                    |
| 19:00       | Core `1b25f30`         | DÉPLOYÉ en 137 s, `applied:` les 5 migrations (67), `/health` `/ready` OK, routes `/v1/ext` en 401 sans jeton (pas de 5xx)                                                                                                                                                                                                                                                                                                                                                                                 |
| 19:04       | Bot `1b25f30`          | DÉPLOYÉ en 142 s, bail actif, EventSub bot + diffuseur OK, 40 récompenses relues sur Twitch                                                                                                                                                                                                                                                                                                                                                                                                                |
| 19:17       | Studio 0.1.26          | workflow « Studio — construire / publier » (run 42404960279, autorisé par Antoni) : tests Windows, paquet, test de mise à jour depuis 0.1.25, publication publique ; étiquette `studio-v0.1.26`                                                                                                                                                                                                                                                                                                            |
| 19:57       | Installation           | par Antoni ; 0.1.26 / `1b25f30`, profil Production, identité d'appairage existante, connecté                                                                                                                                                                                                                                                                                                                                                                                                               |
| 20:52       | Vérifications          | 199 fichiers locaux identiques à la sauvegarde (jetons des sources OBS, placements, médias, Dock, Spotify, `se-mode`) ; soldes de 4 viewers identiques au dump de 18:32 ; Récompenses 40 / interrupteur ON / 10 règles ; réglages Follow intacts ; aucune action Twitch depuis le 05/11 ; OBS reconnecté seul ; TTS (13 voix), Soundboard, Bonk prêts ; source Alertes vue ; 18/18 médias d'alertes disponibles dont Raid Titan ; StreamElements connecté (ACTIVE) ; catalogue des 6 modules de Production |

État : **déployé et vérifié techniquement** ; validation d'Antoni (recette d'usage) en attente. Ancien Studio : installateur 0.1.25
conservé ; retour arrière § 6 inchangé (cibles `8a897a5` / `4ba9243`).
