# Préparation de la future livraison de `feat/studio-ux` (rien n'est exécuté)

Mis à jour le 06/11/2026. Référence Production présumée : `origin/main` = `8a897a5`, déployé le 04/11 d'après la mémoire de
session. **À reconfirmer sur Coolify avant tout GO** : `docs/REPRISE.md` sur `origin/main` date du 28/10.

Ce document ne vaut pas autorisation. Chaque étape ci-dessous demande le GO explicite d'Antoni.

## 1. Ce que la branche ajoute par rapport à `8a897a5`

- Refonte de Studio : shell, six destinations, Centre de contrôle, « Prêt pour le live », Régie.
- Décisions H1-H16 (CONTEXTE § 18).
- Le socle de modules et ses adaptateurs (`architecture/`).
- Côté extension : socle, D4 › « Autres modules », modules de session.
- **H1 change le comportement de Production** : aucun achat lié au stream en dehors du live canonique. À annoncer aux
  viewers.

## 2. Migrations (8 fichiers, toutes additives, aucune donnée réécrite)

| Fichier                                          | Base                                              | Contenu                                                              | Nécessaire à                                                          |
| ------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `20261121130000_sub_wheel_enabled_at.sql`        | Production                                        | `sw_settings.enabled_at` (frontière de la roue, P0-3)                | Roue du Sub du nouveau Core                                           |
| `20261121140000_word_game_settings_lab.sql`      | Core principal (liste `MAIN_CORE_LAB_MIGRATIONS`) | `enabled`, intervalle du Jeu des mots (H8)                           | Jeu des mots du nouveau Core                                          |
| `20261121160000_module_settings.sql`             | Production                                        | table `module_settings` (H10, H12, H14)                              | réglages modifiables ; **sans elle, le Core applique les défauts**    |
| `20261121180000_module_activity.sql`             | Production                                        | journal et état des modules du socle, colonnes de réservation, index | premier module du socle **non Lab** avec journal ; aucun aujourd'hui  |
| `20261121190000_cmd_steps_module_origin_lab.sql` | Core principal                                    | contrainte d'origine élargie à `module:<id>`                         | réponses chat des modules du socle ; aucune en Production aujourd'hui |
| `…120000`, `…150000`, `…170000` (`_lab`)         | base Lab locale de Studio                         | jumeaux Lab                                                          | Lab seulement                                                         |

Règles :

- **Ordre** : l'ordre des noms. L'outil `selectMigrations` refuse un fichier non classé.
- **Avant** : sauvegarde de la base (`docs/BACKUPS.md`).
- **Retour arrière** : chaque fichier porte ses lignes de rollback en tête. Toutes sont additives : l'ancien Core
  (`8a897a5`) fonctionne avec elles, puisqu'il ignore les tables et colonnes nouvelles.
- **Point de vigilance.** La contrainte élargie accepte `module:<id>`. Si l'ancien Core lit ces lignes : aucun code n'aiguille
  sur l'origine (vérifié), seul Studio l'affiche.

**Tests déjà en place** :

- `migration-scopes.test.ts` : bases de Production du 22/10 au 25/10, chaque fichier une fois, contraintes jamais
  rétrécies ;
- `migration-main-core.integration.test.ts` (67 fichiers) ;
- `sub-wheel-v2.integration.test.ts`.

## 3. Coexistence des versions (vérifiée dans le code)

| Combinaison                                    | Comportement                                                                                                                                                 | Preuve                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Nouveau Studio, ancien Core                    | « Modules du socle » affiche « Catalogue illisible » ; réglages « indisponibles » ; D4 › Autres modules « indisponibles (serveur) » ; aucune fausse capacité | `module-host.ts`, `module-settings.ts`, `module-moderation.js` |
| Ancien Studio, nouveau Core                    | les écrans existants marchent ; **« Créditer / Débiter » exige la clé P0-2, qu'un ancien Studio n'envoie pas** : livrer Core et Studio ensemble              | CHECKPOINT, P0-2                                               |
| Ancienne extension, nouveau Core               | elle n'appelle pas `/modules/v3` ; les anciennes routes sont inchangées                                                                                      | `ext-facade.ts` (porte ajoutée avant le 404 final)             |
| Nouvelle extension, ancien Core                | `/modules/v3` répond 404 : aucun module du socle affiché ; modules de session selon la session, inchangée                                                    | `module-registry.js` (`loadHostModules`)                       |
| Bot                                            | modifié par la mission H (P0-5, H9) : à livrer avec le Core                                                                                                  | CHECKPOINT                                                     |
| Modules `labOnly` (Objectif de soirée, Coffre) | jamais montés en Production, réglages compris                                                                                                                | `modules-host.test.ts`                                         |

## 4. Ordre de livraison proposé

1. Gel : pas de live, Studio fermé.
2. Sauvegarde de la base, vérifiée lisible.
3. Migrations de Production, dans l'ordre des noms, selon la procédure de `docs/OPERATIONS.md` (à relire ce jour-là ;
   ce document ne la redéfinit pas).
4. Core, puis contrôle de `/health` et `/ready`.
5. Bot, puis contrôle du bail d'instance unique.
6. Studio (`npm run studio:release`), installation par Antoni.
7. Extension : envoi à Twitch par Antoni.
8. Contrôles après livraison (§ 5), puis annonce H1 aux viewers.

## 5. Contrôles après livraison

- Le catalogue cockpit (`/v1/studio/cockpit/modules/<ch>`) liste `mini_games`, `votekick`, `caution`, `random_ban`,
  `word_game` et `event_shop` ; jamais `objectif_soiree` ni `coffre_mystere`.
- Réglages : les valeurs par défaut sont celles d'avant (mini-jeux 20 / 10 s…, Votekick 60 min / 5-30, Caution 1 000 / 300).
- Votekick, Caution et Random Ban affichent « prêt » seulement si le bot s'est signalé.
- « Prêt pour le live » et Centre de contrôle sans incohérence.
- Un achat de test **en Lab seulement** : aucun achat réel n'est fait pour vérifier.

## 6. Signaux de retour arrière et procédure

- **Signaux** :
  - `/ready` en échec ;
  - erreurs 5xx sur `/v1/ext` ;
  - achats refusés hors des règles H1 ;
  - bot sans bail ;
  - écart de solde.
- **Procédure** :
  - redéployer l'image du Core `8a897a5` et le bot précédent ;
  - les migrations restent en place (additives, compatibles) ;
  - Studio : réinstaller la version précédente.

## 7. Extension — mission d'exécution (05/11)

Les commits `50e8601`, `602401a` et `2d9f7b2` ne changent que l'extension : aucune route du Core, aucune migration, aucun
contrat d'API.

- **Ordre.** Livrable avec le Core ou après lui ; jamais publiée par Claude. Antoni l'envoie à Twitch.
- **Avant l'envoi**, vérification manuelle dans le vrai Lab, en viewer et en modérateur :
  - TTS V2 : achat, retour, mise à jour en direct ;
  - Tombola V2 : `!join` du chat ;
  - D4 › Commandes ;
  - la liste « Voir tous les modules » ouverte pendant un changement de solde.
- **Retour arrière** : republier la version précédente de l'extension. L'état est côté Core, rien n'est à migrer.

## 8. Mission Foundation (06/11) : ce qui change au jour du GO

Aucune nouvelle migration. Rien de ceci n'est publié.

| Surface   | Changement visible en Production                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio    | Nouveau Centre, catalogue avec états, Activité, Système en onglets, incidents sur une ligne                                                                   |
| Studio    | **OBS se connecte depuis la page Bonk**, la source TTS depuis la page TTS, le lecteur Soundboard est en haut de la page Soundboard (ils étaient dans Système) |
| Studio    | Configuration TTS sur la page TTS (elle était dans Modération) ; mêmes routes                                                                                 |
| Core      | `twitch_connected` de la session reflète enfin la liaison Twitch du viewer (l'extension croyait tout viewer non lié)                                          |
| Core      | Route `/v1/studio/cosmetics/style` ajoutée à côté de `style.json` ; sans effet pour un ancien Studio                                                          |
| Extension | Aucun changement dans cette mission                                                                                                                           |

**Contrôles ajoutés après livraison** : lecteur Soundboard chargé dès le lancement, sans ouvrir sa page ; connexion OBS mémorisée
restaurée au démarrage ; `Prêt pour le live` cohérent avec la réalité en Production.

**Retour arrière** : celui du § 6. L'ancien Lab reste dans la branche tant que [RETRAIT_ANCIEN_LAB.md](RETRAIT_ANCIEN_LAB.md)
n'est pas exécuté ; il ne concerne que le développement.

**Non vérifié ici** : aucun écran n'a tourné contre le vrai Core de Production ; la recette se fait dans le Lab.

## 9. Plan de livraison exécutable

> **07/11 (soir)** : remplacé par [OPERATION_COULISSES.md](OPERATION_COULISSES.md) (faits vérifiés sur la vraie Production en
> lecture seule et sur une copie restaurée de la base). Les sections ci-dessous restent pour l'historique.
> (07/11, mission finale) — remplace les §§ 4 et 6 là où ils diffèrent

Préparé, **rien n'est exécuté**. Chaque étape attend le GO d'Antoni. Matrice des données : [MIGRATION_DONNEES.md](MIGRATION_DONNEES.md).
Faits de compatibilité vérifiés dans le code le 07/11 (rien contre la vraie Production) :

- Depuis le 06/11 : aucune migration nouvelle, aucun fichier de l'extension modifié. Studio 0.1.25 = tag `studio-v0.1.25` = `8a897a5`.
- **Deux migrations sont obligatoires avant le nouveau Core**, pas seulement utiles : sans `…130000_sub_wheel_enabled_at`, la Roue du Sub
  échoue en SQL (`sub-wheel/draws.ts:62`) ; sans `…140000_word_game_settings_lab`, le Jeu des mots échoue (`word-game/service.ts:410`).
  Le Core ne migre pas au démarrage : `npm run db:migrate`. 5 fichiers en Production : `…130000`, `…140000`, `…160000`, `…180000`, `…190000`.
- **Le correctif Lead Moderator est du code de Production** : `lab-chat-ingest.ts` est réutilisé par `core-chat-bridge.ts` vers
  `/v1/bot/chat` quand `CHAT_GAMES=true`. Il ne prend effet qu'avec le déploiement du bot. Le nouveau bot marche avec l'ancien Core et inversement.
- **L'extension n'a pas à être republiée.** La version publiée envoie déjà sa clé d'idempotence aux actions de modération.
- Ancien Studio 0.1.25 + nouveau Core : seul « Créditer / Débiter » est refusé (clé P0-2). Installer le nouveau Studio juste après le Core.
- Nouveau Studio + ancien Core : classement absent, tableau des droits remplacé par un message, poids d'alerte refusés (400, rien
  d'écrit), « Vider la file » en erreur, modules du socle « illisibles ». Rien n'est écrit de travers.
- Aucune route Lab n'est servie en Production (`labRoutes: false`, catalogue fictif sous `!production`, achat simulé sous `mainLab`).

### 9.1 Avant (la veille, sans live)

1. **Gel** : pas de live, Studio installé fermé.
2. **Sauvegarde de la base** de Production selon `docs/BACKUPS.md`, relue (pas seulement listée).
3. **Sauvegarde locale** : la base ne couvre ni `apps/studio/server/.runtime`, ni `%APPDATA%\Raptoru Studio`, ni les `.env` et jetons
   Twitch. La dernière copie date du 24/10. Relancer `studio_backup.py` (nouvelle date), puis `python studio_backup.py verify`.
   Points sensibles qu'elle doit contenir : `.runtime\alerts\placement.json` (looks), `.runtime\alerts\media` (dont **`Raid Titan.webm`,
   seul exemplaire existant**), les jetons des sources OBS (`player-token`, `overlay-token`), `production\alerts\se-mode.json`.
4. **Relevés avant** (pour comparer après) : `select variants from alert_settings` ; mode StreamElements (`se-mode.json`) ; l'URL de
   chaque source navigateur dans OBS ; `schema_migrations` ; versions Coolify (Core `8a897a5`, bot `4ba9243`/`9cc27db` à reconfirmer) ;
   `CHAT_GAMES` en Production ; absence de `STUDIO_LAB_CORE` dans les variables Windows d'Antoni.

### 9.2 Livraison, dans cet ordre

| #   | Étape                                                                                                         | Contrôle immédiat                                                                                                                          | Arrêt si                                          |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1   | Migrations de Production (`db:migrate`, ordre des noms)                                                       | `schema_migrations` contient les 5 fichiers                                                                                                | une migration échoue                              |
| 2   | Core (Coolify, commit validé)                                                                                 | `/health`, `/ready` ; catalogue cockpit (§ 5)                                                                                              | `/ready` en échec, 5xx sur `/v1/ext`              |
| 3   | Studio : `npm run studio:release` (bump et publication par le script), installation par Antoni **sans délai** | profil Production lu, OBS reconnecté sans ressaisie, URL des sources OBS inchangées, Créditer/Débiter, Classement, « Qui peut faire quoi » | Studio ne s'appaire pas, URL des sources changées |
| 4   | Bot (indépendant, peut aussi précéder le Core)                                                                | bail d'instance unique ; une commande d'un Lead Moderator réel acceptée                                                                    | bot sans bail                                     |
| 5   | Extension : **rien à faire** (republier seulement si une nouvelle version est voulue, après le Core)          | —                                                                                                                                          | —                                                 |
| 6   | Contrôles après livraison (§ 5), annonce H1 aux viewers                                                       | un achat de test **en Lab seulement**                                                                                                      | écart de solde                                    |

Pendant toute la fenêtre de retour arrière : **ne pas régler les poids des alertes Follow** (voir 9.3).

### 9.3 Retour arrière

- **Core** : redéployer `8a897a5`. Les migrations restent (additives, ignorées par l'ancien Core). **Avant**, si des poids d'alerte ont été
  enregistrés : `update alert_settings set variants = variants - 'weights';` — sinon l'ancien Core rejette tout l'objet (`strictObject`) et
  perd en silence tous les réglages de variantes (familles, liste Follow). Effets connus : un Jeu des mots OFF redevient ON, des tarifs
  modifiés reviennent aux constantes.
- **Studio** : réinstaller 0.1.25 (release `studio-v0.1.25`). Restaurer `.runtime\alerts\placement.json` depuis la sauvegarde : l'ancien
  Studio ignore les looks et les efface à sa prochaine sauvegarde. Remettre `se-mode.json` à TEST ou OFF si besoin (le nouveau Studio
  reprend un ACTIVE enregistré).
- **Bot** : redéployer l'image précédente ; les Lead Moderators redeviennent des viewers dans le chat.
- **Extension** : rien (pas republiée).
- Non audité : d'autres réglages JSON relus en `strictObject` par l'ancien Core pourraient avoir le même risque que `weights`.

### 9.4 Installateur

Non préparé, volontairement : la version du dépôt est `0.1.6` et seul `npm run studio:release` la monte (règle : jamais à la main). Un
paquet local construit aujourd'hui porterait un numéro plus ancien que la 0.1.25 installée. L'installateur se fabrique au GO, après validation.
