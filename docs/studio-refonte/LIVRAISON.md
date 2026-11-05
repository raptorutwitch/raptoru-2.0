# Préparation de la future livraison de `feat/studio-ux` (rien n'est exécuté)

Mis à jour le 05/11/2026. Référence Production présumée : `origin/main` = `8a897a5`, déployé le 04/11 d'après la mémoire de
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

| Fichier | Base | Contenu | Nécessaire à |
|---|---|---|---|
| `20261121130000_sub_wheel_enabled_at.sql` | Production | `sw_settings.enabled_at` (frontière de la roue, P0-3) | Roue du Sub du nouveau Core |
| `20261121140000_word_game_settings_lab.sql` | Core principal (liste `MAIN_CORE_LAB_MIGRATIONS`) | `enabled`, intervalle du Jeu des mots (H8) | Jeu des mots du nouveau Core |
| `20261121160000_module_settings.sql` | Production | table `module_settings` (H10, H12, H14) | réglages modifiables ; **sans elle, le Core applique les défauts** |
| `20261121180000_module_activity.sql` | Production | journal et état des modules du socle, colonnes de réservation, index | premier module du socle **non Lab** avec journal ; aucun aujourd'hui |
| `20261121190000_cmd_steps_module_origin_lab.sql` | Core principal | contrainte d'origine élargie à `module:<id>` | réponses chat des modules du socle ; aucune en Production aujourd'hui |
| `…120000`, `…150000`, `…170000` (`_lab`) | base Lab locale de Studio | jumeaux Lab | Lab seulement |

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

| Combinaison | Comportement | Preuve |
|---|---|---|
| Nouveau Studio, ancien Core | « Modules du socle » affiche « Catalogue illisible » ; réglages « indisponibles » ; D4 › Autres modules « indisponibles (serveur) » ; aucune fausse capacité | `module-host.ts`, `module-settings.ts`, `module-moderation.js` |
| Ancien Studio, nouveau Core | les écrans existants marchent ; **« Créditer / Débiter » exige la clé P0-2, qu'un ancien Studio n'envoie pas** : livrer Core et Studio ensemble | CHECKPOINT, P0-2 |
| Ancienne extension, nouveau Core | elle n'appelle pas `/modules/v3` ; les anciennes routes sont inchangées | `ext-facade.ts` (porte ajoutée avant le 404 final) |
| Nouvelle extension, ancien Core | `/modules/v3` répond 404 : aucun module du socle affiché ; modules de session selon la session, inchangée | `module-registry.js` (`loadHostModules`) |
| Bot | modifié par la mission H (P0-5, H9) : à livrer avec le Core | CHECKPOINT |
| Modules `labOnly` (Objectif de soirée, Coffre) | jamais montés en Production, réglages compris | `modules-host.test.ts` |

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
