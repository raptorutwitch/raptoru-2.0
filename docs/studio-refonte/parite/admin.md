# Parité fonctionnelle admin : ancien Studio `5d63087` contre `feat/studio-ux` `bdb6d12`

Audit en lecture seule, le 07/11/2026. Rien n'a été exécuté : ni Studio, ni Electron, ni Core. Toutes les preuves viennent de la lecture du code.

Conventions des chemins :

- `old:` = `apps/studio/web/src/` au commit `5d63087`.
- `new:` = `apps/studio/web/src/` sur `feat/studio-ux`.
- `ext:` = `apps/twitch-extension/extension/shared/`.
- `core:` = `apps/core-api/src/`.
- `srv:` = `apps/studio/server/src/`.

Statuts : PRÉSERVÉE, DÉPLACÉE, REMPLACÉE, OBSOLÈTE, MANQUANTE, BLOQUÉE.

## Écarts à corriger, par gravité

Chaque écart a été lu des deux côtés, sauf mention « supposition ». Aucun écart n'est trouvé sur les remboursements, les prix enregistrés, l'idempotence des commandes d'argent ou les droits : ils sont identiques ou renforcés. Les écarts portent sur des **confirmations perdues** et sur une dépendance de déploiement.

### 1. Grave : l'interrupteur Mini-jeux agit en Production sans confirmation

- **Ancien.** L'interrupteur n'existait que dans la Simulation (`old:shell/registry.ts:235`, « interrupteur et essais dans la simulation »). Il passait par `confirmFor` (`old:simulation.ts:55-56`, `:112-113`).
- **Ce que disait l'ancienne confirmation.** En Production : « Profil Production : activer Roulette / Slot / Duel pour les vrais viewers (vrais Jetons, pendant les lives) ? ». Sortie réelle ON : « !roulette et !slots répondront dans le VRAI chat » (`old:simulation-view.ts:211-214`, `:220-221`).
- **Nouveau.** La page Mini-jeux a son propre interrupteur. `setOpen` poste directement `/api/mini-games/settings` (`new:pages/mini-games.ts:241-252`, `:285-286`). Seul filet : un toast « Annuler » après coup. L'étiquette « Vrais Jetons » est un simple tag (`:162`).
- **Effet.** Un clic ouvre ou ferme de vrais jeux d'argent pour les viewers. Le chemin par la Simulation garde sa confirmation (`new:simulation.ts:114-123`), donc les deux portes se contredisent.
- **Correction.** Dans `setOpen`, si `production`, ou si la sortie réelle est active : passer par `confirmFor` ou une `confirmBox` avec le même texte, avant le POST. Environ 6 lignes.

### 2. Moyen : les mises et délais des mini-jeux n'ont plus de confirmation « X → Y »

- **Ancien.** Le panneau générique demandait `confirm` à chaque réglage : « label : ancien → nouveau, appliqué aux prochains achats, sur le Core de ce profil » (`old:module-settings.ts:110-115`).
- **Nouveau.** `apply` envoie sans confirmation, avec toast Annuler (`new:pages/mini-games.ts:257-279`).
- **Comparaison.** Les autres prix gardent leur confirmation (`new:pages/setting-rows.ts` confirmBox, `new:module-settings.ts:126`).
- **Effet secondaire.** `send` poste les réglages un par un (`:253-256`) : si le second est refusé, le premier reste appliqué. Pas de rollback, seulement une relecture.
- **Correction.** Une `confirmBox` listant les changements dans `apply`. Pour le refus partiel, dire ce qui est passé.

### 3. Moyen : les interrupteurs de modules du socle n'ont plus de confirmation

- **Ancien.** Un `confirm` « label : activer/couper ? Sur le Core de ce profil » (`old:module-settings.ts:136-141`).
- **Nouveau, panneau.** `new:module-settings.ts:142-155` : application immédiate, toast Annuler.
- **Nouveau, Modération.** La tranche « Autres » de la table (`new:pages/moderation-desk.ts:306`, `:417-433`) bascule `<id>.enabled` sans confirmation ni Annuler. Ce geste n'existait pas dans l'ancien Studio.
- **Portée.** Modules avec `has_switch` (`core:modules/host.ts:257-259`). _Supposition non vérifiée : ces modules sont limités au Lab, leur présence en Production reste à contrôler._
- **Correction.** Une confirmation sur le geste de la Régie, au minimum en Production.

### 4. Faible : recliquer l'état courant d'un module renvoie la commande

- **Extension.** `if (cur === st) return` (`ext:moderation-v2.js:1213`).
- **Nouveau.** Le segment garde le bouton courant cliquable (`new:ds/ds.ts:64-69`). Ni `new:pages/moderation-desk.ts:437-440` ni `setModuleState` (`new:mod/mod.ts:1428`) ne filtrent.
- **Effets.** Une ligne d'audit parasite à chaque clic (`core:tts-lab/tts-lab-service.ts:1099-1113`). Sur Pause ou Fermé déjà actifs avec une file : le dialogue s'ouvre et propose « Annuler et rembourser », ce qui vide la file.
- **Correction.** Une ligne au début de `setModuleState`, ou dans le gestionnaire : ignorer si l'état demandé est l'état courant.

### 5. Ordre de déploiement (pas un écart de code)

- La liste de Progression lit `/api/progression/leaderboard`, relayée vers une route Core **ajoutée sur cette branche** (`core:http/progression-routes.ts:115`, `git diff 5d63087`). Avant déploiement de ce Core, le classement est absent en Production (`new:pages/progression.ts:386`, état `boardMissing`). La recherche de viewer reste disponible.
- Le Core doit donc partir avant ou avec Studio.

### 6. Non-régressions à arbitrer

- **Catalogue.** Il n'affiche pas la Pause par module, et l'état de TTS, Sons et Bonk ne vient pas de `module_state` (`new:readiness.ts:368-379`, recherche `paused` vide). Comportement identique dans l'ancien Studio. Le vocabulaire « Ouvert / Pause / Fermé » n'existe qu'en Régie (`new:pages/moderation-desk.ts` `STATES`). _Lecture ciblée, pas intégrale._
- **Core sans page**, ni ancienne ni nouvelle : voir la section dédiée à la fin.

## Droits et rôles réellement présents dans le Core

| Élément                   | Contenu                                                                                                                                                                                          | Preuve                                                                         | Exposé dans Studio                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rôles                     | `broadcaster`, `supermod`, `moderator`, `viewer`                                                                                                                                                 | `packages/schemas/src/lab-moderation.ts`, `core:lab-moderation/store.ts:42-99` | Oui. Studio agit toujours en `broadcaster`, identité forcée (`srv:lab-moderation/proxy.ts:124`, `srv:modules/relay.ts`, `core:http/studio-cockpit-routes.ts`) |
| Grants par modérateur (9) | `wallet`, `modules`, `globalPause`, `perms`, `sensitive`, `words`, `raffle`, `subWheelDraw`, `subWheelGrant`                                                                                     | `core:lab-moderation/store.ts:47-57`                                           | Les 9, tableau croisé `new:pages/moderation-team.ts`, `new:mod/mod.ts:149`                                                                                    |
| Permissions sans grant    | Tout modérateur : pause, stop, retrait, purge, refund avec retrait, allow, bloquer, cooldown, notes, audit. Supermod : `raffle.config`. Broadcaster : `config.tts`, `staff.manage`, `wallet.lab` | `core:lab-moderation/store.ts:64-97`                                           | Sans objet pour Studio (broadcaster) ; le Core reste seul juge                                                                                                |
| Sanction sensible         | Tout Raptoru, sans fin, ou plus d'une heure : `sanction.sensitive`                                                                                                                               | `core:lab-moderation/service.ts:170-200`                                       | Formulaire identique, `new:mod/mod.ts:553`                                                                                                                    |
| Règles de grants          | Soi-même interdit, un mod n'accorde que ce qu'il détient, seuls les `moderator` sont éditables                                                                                                   | `core:lab-moderation/service.ts` `setPermission`                               | Verrou repris (`can = mod && granted('perms') && granted(p)`)                                                                                                 |
| Droits Commandes par rôle | `toggle`, `reply`, `rename`, `aliases`, `audience`, `exclusions`, `cooldown.min_seconds`, `quota`, `listed`, `volume.min/max`, `create`, `remove`                                                | `packages/schemas/src/commands.ts:227-255`                                     | Tout, `new:pages/commands-team.ts` `rightsGrp`                                                                                                                |
| Par commande              | `audience.groups/allow/deny`, `team_lock`, `locked_fields`                                                                                                                                       | `packages/schemas/src/commands.ts`                                             | Tout, `new:pages/commands-editor.ts:254-261`, `:417-423`                                                                                                      |
| Second registre staff     | `/v1/admin/staff` (`wallet/staff.ts`)                                                                                                                                                            | `core:http/wallet-routes.ts:204-226`                                           | Non, jamais exposé (voir fin)                                                                                                                                 |

## Modération

| Fonction                                                                                              | Statut                                                                                                                                         | Preuve ancien                                                            | Preuve nouveau                                             | Correction |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------- |
| Retrait ou arrêt avec ou sans remboursement (`cancel`, `stop_current`)                                | PRÉSERVÉE, renforcée (clé d'intention)                                                                                                         | `ext:moderation-v2.js:1650-1658`                                         | `new:mod/mod.ts:439-456`, `:477`                           |            |
| Laisser passer (`allow`)                                                                              | PRÉSERVÉE                                                                                                                                      | `ext:moderation-v2.js:1659-1662`                                         | `new:mod/mod.ts` `allow`, Régie, touche L                  |            |
| Refuser une demande à vérifier                                                                        | PRÉSERVÉE (mêmes `cancel`, dits Refuser)                                                                                                       | `ext:moderation-v2.js:1269-1270`                                         | `new:mod/mod.ts:477` option `refuse`                       |            |
| Remboursement après coup (`refund`), condition `!live`, pas raffle, débit non nul, pas déjà remboursé | PRÉSERVÉE, renforcée (confirmation, clé `refund:<id>`)                                                                                         | `ext:moderation-v2.js:1319-1323`, `:1663`                                | `new:mod/mod.ts:948`, `:1051`                              |            |
| Purge                                                                                                 | REMPLACÉE, équivalente : case à cocher remplacée par un choix sans défaut plus un bouton ; même commande, clé ajoutée                          | `ext:moderation-v2.js:1666-1679`                                         | `new:mod/mod.ts:1376`                                      |            |
| Stop tous les sons (2 sons au moins)                                                                  | PRÉSERVÉE                                                                                                                                      | `ext:moderation-v2.js:1681-1691`                                         | `new:mod/mod.ts:1406`                                      |            |
| Pause et fermeture d'un module avec choix de la file                                                  | PRÉSERVÉE (mêmes `waiting`) sauf garde d'état courant                                                                                          | `ext:moderation-v2.js:1211-1231`                                         | `new:mod/mod.ts:1428`                                      | Écart 4    |
| Pause globale                                                                                         | REMPLACÉE, équivalente (case remplacée par dialogue au même texte)                                                                             | `ext:moderation-v2.js:1530-1543`                                         | `new:mod/mod.ts:1477`                                      |            |
| Blocage et déblocage (portée, 30 s à sans fin, autre, raison)                                         | PRÉSERVÉE, durée 1 h ajoutée                                                                                                                   | `ext:moderation-v2.js:1127-1163`                                         | `new:mod/mod.ts:553`                                       |            |
| Blocage rapide 1 min, 5 min, autre                                                                    | PRÉSERVÉE                                                                                                                                      | `ext:moderation-v2.js:1286-1293`                                         | `new:mod/mod.ts:516`                                       |            |
| Cooldown personnel, levée, effacement du délai TTS                                                    | PRÉSERVÉE                                                                                                                                      | `ext:moderation-v2.js:1164-1187`, `:1697-1701`                           | `new:mod/mod.ts:644`, `:831`                               |            |
| Restrictions : actives, historique, filtres, modifier, lever                                          | PRÉSERVÉE                                                                                                                                      | `ext:moderation-restrictions.js`                                         | `new:pages/moderation-restrictions.ts`                     |            |
| Historique : Interactions, Jetons, Audit, pagination, automatiques masqués                            | PRÉSERVÉE. Périodes 24 h, 7 j, Tout ajoutées et acceptées par le Core (`core:lab-moderation/service.ts:939-942`)                               | `ext:moderation-v2.js:413-445`                                           | `new:pages/moderation-journal.ts`                          |            |
| Équipe, grants                                                                                        | DÉPLACÉE (tiroir vers onglet), mêmes commandes                                                                                                 | `ext:moderation-v2.js:1420-1440`, `:1702-1705`                           | `new:pages/moderation-team.ts`                             |            |
| Supermods (`set_staff`)                                                                               | PRÉSERVÉE, confirmation ajoutée à la nomination                                                                                                | `old:moderation.ts` `data-staff`                                         | `new:pages/moderation-team.ts`                             |            |
| Mots surveillés                                                                                       | PRÉSERVÉE                                                                                                                                      | `ext:moderation-v2.js:1721-1743`                                         | `new:pages/moderation-team.ts` `mountWords`                |            |
| Autres modules : journal, remboursement avec motif                                                    | PRÉSERVÉE, même condition `amount > 0`, pas remboursé                                                                                          | `ext:module-moderation.js:13-23`                                         | `new:pages/moderation-others.ts:90-95`, `:101-122`         |            |
| Interrupteur d'un module socle dans la tranche Autres                                                 | Ajout sans confirmation                                                                                                                        | absent                                                                   | `new:pages/moderation-desk.ts:417-433`                     | Écart 3    |
| Tombola : +30 s, pause, reprise, tirer, annuler, ajouter, forcer, retirer                             | PRÉSERVÉE (mêmes `reason`). Cases à cocher remplacées par dialogues                                                                            | `ext:moderation-v2.js:1544-1567`, `:538-560`                             | `new:pages/moderation-desk.ts:523`, `new:mod/mod.ts:855`   |            |
| Tombola : ouvrir (`raffle_open`)                                                                      | DÉPLACÉE en « Manche rapide » ; bornes non pincées côté client, le Core refuse                                                                 | `old:moderation.ts` `data-raffle="open"`                                 | `new:pages/moderation-desk.ts:498`                         |            |
| « Fermer (sans tirer) »                                                                               | OBSOLÈTE, prouvé : même `case` que le tirage                                                                                                   | `core:raffle-lab/raffle-lab-service.ts:1999-2000`                        | Tirer                                                      |            |
| Wallet de test (`set`, `adjust`, `reset`, délai TTS)                                                  | PRÉSERVÉE, viewers vus ajoutés ; masqué en Production                                                                                          | `old:moderation.ts` `renderWallet`                                       | `new:pages/moderation-others.ts` `mountLabWallet`          |            |
| Pilotage TTS de la Régie (pause, reprise, stop)                                                       | REMPLACÉE, équivalente : `/api/tts-lab/moderation` remplacée par `/api/lab/actions`, le Core traduit l'ancienne route vers les mêmes commandes | `old:shell/regie.ts:350-369` ; `core:tts-lab/tts-lab-service.ts:875-893` | `new:shell/regie.ts` `tts-*`                               |            |
| Tombola, alertes, automatisations de la Régie                                                         | PRÉSERVÉE (mêmes routes, mêmes textes)                                                                                                         | `old:shell/regie.ts:327-348`                                             | `new:shell/regie.ts:445-475`, `new:pages/regie.ts:143-178` |            |
| Clavier, recherche de viewer, notes                                                                   | PRÉSERVÉE ou ajout                                                                                                                             | `ext:moderation-v2.js`                                                   | `new:pages/moderation.ts`                                  |            |
| Console montée dans Studio                                                                            | REMPLACÉE, commandes vérifiées une par une                                                                                                     | `old:moderation.ts` `mountConsole`                                       | Vues `new:pages/moderation-*.ts`                           |            |

**Idempotence.** Studio transmet `idempotency_key` au Core (`srv:lab-moderation/proxy.ts`, `/actions`). Le cockpit Production le laisse passer (seul `actor` est remplacé). Le Core l'applique (`core:lab-moderation/service.ts:599`) et l'exige pour `wallet_adjust` (`:531`). Les commandes `action: 'raffle'` n'ont pas de clé, comme dans l'extension.

## Communauté, Fiche viewer, Wallet

| Fonction                                                                                       | Statut                                                                   | Preuve ancien                           | Preuve nouveau              | Correction |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- | --------------------------- | ---------- |
| Hub Communauté                                                                                 | REMPLACÉE : mêmes quatre portes, recherche de viewer et chiffres ajoutés | `old:shell/shell.ts:413-415`            | `new:pages/communaute.ts`   |            |
| Fiche : solde, restrictions, notes, en ce moment, activité, détails, participation à la manche | PRÉSERVÉE                                                                | `ext:moderation-v2.js:791-830`, tiroirs | `new:mod/mod.ts:1295`       |            |
| Bloquer ou cooldown d'un membre de l'équipe                                                    | PRÉSERVÉE (désactivé, `target_is_staff` côté Core)                       | `ext:moderation-v2.js`                  | `new:mod/mod.ts` `foot`     |            |
| Wallet : créditer, débiter, nouveau solde, raison, clé par dialogue, monnaie et montant        | PRÉSERVÉE, clé identique                                                 | `ext:moderation-v2.js:1374-1403`        | `new:mod/mod.ts:754-806`    |            |
| Liste « Ajustements » du tiroir Wallet                                                         | REMPLACÉE par Mouvements et Historique Jetons, filtre viewer             | `ext:moderation-v2.js:1371`             | `new:mod/mod.ts` `cardHtml` |            |

## Commandes V2

| Fonction                                                                                        | Statut                                                         | Preuve ancien                | Preuve nouveau                                                              | Correction |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- | ---------- |
| Liste, filtres, tri, groupement, favoris, usage 30 j, signalements                              | PRÉSERVÉE (mêmes marqueurs)                                    | `old:commands.ts:518-538`    | `new:pages/commands.ts:333-362`, `:910-955`                                 |            |
| Création, enregistrement `expected_version` + `changes`, conflit 409 réappliqué, bascule rapide | PRÉSERVÉE, payload identique                                   | `old:commands.ts:1300-1345`  | `new:pages/commands.ts:570-653`                                             |            |
| Suppression, remise d'origine, confirmations                                                    | PRÉSERVÉE                                                      | `old:commands.ts:1494-1523`  | `new:pages/commands.ts:658-700`                                             |            |
| Catégories : création, icône, couleur, ordre, suppression                                       | PRÉSERVÉE, déplacée dans le panneau                            | `old:commands.ts:1532-1575`  | `new:pages/commands.ts:700-712`, `:1020-1048`, `new:pages/commands-team.ts` |            |
| Droits par rôle (cooldown min, bornes de volume, 409)                                           | PRÉSERVÉE                                                      | `old:commands.ts:1578-1600`  | `new:pages/commands.ts:713-729`                                             |            |
| Test Core (message, viewer, badges, follower)                                                   | PRÉSERVÉE, payload identique                                   | `old:commands.ts:1609-1632`  | `new:pages/commands.ts:730-758`                                             |            |
| Journal global et par commande, échanges chat                                                   | PRÉSERVÉE                                                      | `old:commands.ts:1255-1258`  | `new:pages/commands-journal.ts:151-176`                                     |            |
| Tous les champs de `CmdConfig`, verrous par champ                                               | PRÉSERVÉE                                                      | `old:commands.ts`            | `new:pages/commands-editor.ts`                                              |            |
| Boutons Précédente et Suivante                                                                  | OBSOLÈTE, déjà tranché dans `PARITE.md`                        | `old:commands.ts` `data-nav` | liste à côté                                                                |            |
| `commands-model.ts`                                                                             | PRÉSERVÉE. Seul ajout : aperçu avec valeurs tapées, côté écran | diff                         | `new:commands-model.ts`                                                     |            |

## Récompenses (points de chaîne)

| Fonction                                                                          | Statut                                                           | Preuve ancien                                   | Preuve nouveau                                                     | Correction |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | ---------- |
| Interrupteur général avec confirmation                                            | PRÉSERVÉE                                                        | `old:channel-points.ts` `switch`                | `new:pages/rewards.ts` `data-master`, `new:pages/regie.ts:163`     |            |
| Règle : `enabled`, actions, `expected_version`, durée vide = permanent, 5 actions | PRÉSERVÉE, payload identique                                     | `old:channel-points.ts` `save`, `toRule`        | `new:pages/rewards.ts` `save`, `toRule`                            |            |
| Les 8 types d'actions, volume d'origine, suggestions OBS                          | PRÉSERVÉE                                                        | `old:channel-points.ts`                         | `new:pages/rewards.ts:136-156`, `fields`                           |            |
| Test réel avec confirmation, `user_input`                                         | PRÉSERVÉE, renforcée (bloqué si modifié non enregistré)          | `old:channel-points.ts` `test`                  | `new:pages/rewards.ts` `test`, `paintFoot`                         |            |
| Déclencheurs sur Effets et Random Ban                                             | PRÉSERVÉE                                                        | `old:channel-points.ts` `renderTriggers`        | `new:pages/effects.ts:207`, `new:pages/sanctions-random-ban.ts:92` |            |
| Brouillon initial : une action vide (ancien) ; aucune (nouveau)                   | REMPLACÉE, sans effet : le bouton Ajouter remplace la ligne vide | `old:channel-points.ts` `blank('effect_sound')` | `new:pages/rewards.ts` `copyRule`                                  |            |

## Boutique

| Fonction                                                   | Statut                                                                                            | Preuve ancien                          | Preuve nouveau                            | Correction |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- | ---------- |
| Objets : création, édition, renommage, duplication, images | PRÉSERVÉE, `prompt` remplacés par dialogues                                                       | `old:cosmetics.ts:649-666`, `:690-706` | `new:pages/shop.ts:1025-1105`, `:699-715` |            |
| Offres : prix, monnaie, dates, `event_key`, activation     | PRÉSERVÉE, payload identique                                                                      | `old:cosmetics.ts:707-727`             | `new:pages/shop.ts:1125-1150`             |            |
| Remboursement avec raison                                  | PRÉSERVÉE, confirmation renforcée                                                                 | `old:cosmetics.ts:669-677`             | `new:pages/shop.ts:1155-1178`             |            |
| Don : clé d'intention, `module: 'studio'`, `reference`     | PRÉSERVÉE, confirmation et contrôle du viewer ajoutés ; clé renouvelée quand le formulaire change | `old:cosmetics.ts:728-750`             | `new:pages/shop.ts:1194-1240`, `:885-897` |            |

## Défis

| Fonction                                         | Statut                              | Preuve ancien               | Preuve nouveau                          | Correction |
| ------------------------------------------------ | ----------------------------------- | --------------------------- | --------------------------------------- | ---------- |
| Création, édition, prévisualisation, recomptage  | PRÉSERVÉE, mêmes routes et payloads | `old:challenges.ts:601-628` | `new:pages/challenges.ts:921-975`       |            |
| Statuts et confirmations                         | PRÉSERVÉE                           | `old:challenges.ts:651-664` | `new:pages/challenges.ts:795-820`       |            |
| Suppression d'un brouillon                       | PRÉSERVÉE                           | `old:challenges.ts:665-680` | `new:pages/challenges.ts:822-848`       |            |
| Retrait d'une récompense, raison de 3 caractères | PRÉSERVÉE                           | `old:challenges.ts:681-696` | `new:pages/challenges.ts:985-1015`      |            |
| État du moteur de comptage                       | PRÉSERVÉE                           | `old:challenges.ts:190-211` | `new:challenges-model.ts` `engineState` |            |
| Historique des recomptages `/runs`               | Jamais exposé (non-régression)      |                             |                                         | Voir fin   |

## Progression et Daily

| Fonction                                                           | Statut                                                                                                                                    | Preuve ancien                            | Preuve nouveau                                     | Correction |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- | ---------- |
| Interrupteur avec confirmation à la coupure                        | PRÉSERVÉE                                                                                                                                 | `old:progression.ts:441-453`             | `new:pages/progression.ts:1109-1128`               |            |
| Règles                                                             | PRÉSERVÉE. Ajouts : `excluded_logins` éditable, confirmation sur la courbe, annulation. Envoie toutes les règles (schéma partiel accepté) | `old:progression.ts:476-485`             | `new:pages/progression.ts:865-893`                 |            |
| Ajustement XP                                                      | PRÉSERVÉE, renforcée : `request_id` stable tant que la saisie ne change pas                                                               | `old:progression.ts:406-424`             | `new:pages/progression.ts:1296-1322`, `:1351`      |            |
| Récompenses                                                        | PRÉSERVÉE. Envoie aussi `description` et `sort`, acceptés par le schéma                                                                   | `old:progression.ts:486-503`             | `new:pages/progression.ts:1171-1190`               |            |
| Attribution et retrait                                             | PRÉSERVÉE. Le choix exclut brouillons et inactifs : _non comparé à `rewardOptions()` de l'ancien_                                         | `old:progression.ts:427-437`, `:518-530` | `new:pages/progression.ts:1070-1100`, `:1270-1290` |            |
| Import WizeBot : simuler, importer, rattacher, résoudre, annuler   | PRÉSERVÉE                                                                                                                                 | `old:progression.ts:364-400`, `:531-587` | `new:pages/progression.ts:905-960`, `:1197-1255`   |            |
| Daily : paliers, ajouter, retirer, valeurs d'origine, confirmation | PRÉSERVÉE, même route                                                                                                                     | `old:progression.ts:455-476`             | `new:pages/progression.ts:1133-1165`               |            |
| Classement                                                         | Ajout, dépend d'une route Core non déployée                                                                                               | absent                                   | `new:pages/progression.ts:382-393`                 | Écart 5    |

## Jeu des mots et Mini-jeux

| Fonction                                                             | Statut                                                                    | Preuve ancien                    | Preuve nouveau                                          | Correction |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------- | ---------- |
| Arrêter, reprendre, nouveau mot, réglages, confirmation de fermeture | PRÉSERVÉE, payloads identiques                                            | `old:word-game.ts` `act`         | `new:pages/word-game.ts` `act`                          |            |
| Voir la réponse, local, effacé en quittant                           | PRÉSERVÉE                                                                 | `old:word-game.ts`               | `new:pages/word-game.ts`                                |            |
| Volume, adresse OBS, série, trouvailles                              | PRÉSERVÉE. Fil « Dans le chat » ajouté (lecture de `/api/commands/steps`) | `old:word-game-view.ts`          | `new:pages/word-game.ts`, `new:pages/word-game-view.ts` |            |
| Interrupteur Roulette, Slot, Duel                                    | REMPLACÉE, **confirmation perdue**                                        | `old:simulation-view.ts:208-221` | `new:pages/mini-games.ts:241-252`                       | Écart 1    |
| Mises et délais (6 réglages, tous présents)                          | REMPLACÉE, **confirmation perdue**                                        | `old:module-settings.ts:110-115` | `new:pages/mini-games.ts:61-80`, `:257-279`             | Écart 2    |
| Derniers tirages                                                     | PRÉSERVÉE, développée                                                     | `core:` `MiniGamesState.recent`  | `new:pages/mini-games.ts`                               |            |

## Centre, Régie, Système, Activité

| Fonction                                 | Statut                                                                           | Preuve ancien                                        | Preuve nouveau                                      | Correction     |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- | -------------- |
| Centre : prêt pour le live               | PRÉSERVÉE (`readiness` à vocabulaire près)                                       | `old:readiness.ts`                                   | `new:pages/centre.ts`, `new:readiness.ts`           |                |
| État du bot et des services              | DÉPLACÉE du Centre vers Système > Services                                       | `old:studio-home.ts` `control`                       | `new:pages/systeme.ts` `slot('control')`            |                |
| Bandeau d'incidents et acquittement      | DÉPLACÉE dans la ligne d'incident du shell                                       | `old:supervision-banner.ts` `mountSupervisionBanner` | `new:shell/shell.ts:366-368`                        |                |
| Services, redémarrages, logs, prototypes | PRÉSERVÉE. Confirmation ajoutée en Production. Journal à 40 lignes au lieu de 14 | `old:studio-home.ts`                                 | `new:pages/systeme.ts`                              |                |
| Connexions OBS, lecteurs, Twitch         | PRÉSERVÉE                                                                        | `old:studio-home.ts`, `old:twitch-connections.ts`    | `new:pages/systeme.ts`, `new:twitch-connections.ts` |                |
| Profils Lab et Production                | PRÉSERVÉE, confirmation native d'Electron inchangée                              | `old:studio-profile.ts`                              | `new:studio-profile.ts`                             |                |
| Mises à jour                             | PRÉSERVÉE (présentation seulement)                                               | `old:update.ts`                                      | `new:update.ts`                                     |                |
| Sauvegardes                              | Absentes des deux versions (recherche vide sur `old:`)                           |                                                      |                                                     | Non-régression |
| Activité : fil, sources muettes dites    | PRÉSERVÉE, libellés d'audit traduits, filtres ajoutés                            | `old:shell/shell.ts:416-430`, `old:activity-feed.ts` | `new:pages/activite.ts`, `new:activity-feed.ts`     |                |

## Laboratoire, Simulation, catalogue

| Fonction                                                              | Statut                                                                               | Preuve ancien                                           | Preuve nouveau                                         | Correction |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| Tests Lab                                                             | PRÉSERVÉE (mêmes routes, `confirm` remplacés par dialogues). _Comparaison mécanique_ | `old:test-lab.ts`                                       | `new:pages/labo-tests.ts`                              |            |
| Extension Lab : surfaces, formats, téléphone                          | PRÉSERVÉE. _Comparaison mécanique_                                                   | `old:extension-lab.ts:266-275`                          | `new:pages/labo-extension.ts:203-219`                  |            |
| Simulation : contrôles, chat simulé, identités, rôle, effacement      | PRÉSERVÉE, même `/api/lab-chat/simulate`. Raccourcis ajoutés                         | `old:simulation-tab.ts`                                 | `new:pages/simulation.ts`                              |            |
| Confirmations `confirmFor`                                            | PRÉSERVÉE sur ce chemin                                                              | `old:simulation.ts:112-113`                             | `new:simulation.ts:114-123`                            |            |
| Catalogue, filtres, recherche, favoris                                | PRÉSERVÉE, `Coupé` devient `Fermé`                                                   | `old:shell/shell.ts:387-405`, `old:module-states.ts:48` | `new:pages/catalog.ts`, `new:module-states.ts:48`      |            |
| Module du socle : état, admin, journal, remboursement, lecteur fictif | PRÉSERVÉE, sauf confirmation d'interrupteur                                          | `old:module-host.ts`, `old:module-settings.ts:136-141`  | `new:module-host.ts`, `new:module-settings.ts:142-155` | Écart 3    |

## Ce que le Core sait faire et qu'aucune page n'expose

Aucune de ces lignes n'est une régression : l'ancien Studio ne les exposait pas non plus.

| Capacité                                                         | Preuve                                                                     | Remarque                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Registre staff du Wallet : liste, attribution, retrait           | `core:http/wallet-routes.ts:204-226`                                       | Distinct de `lab_staff`. Usage par le chat : _supposition, d'après `core:wallet/chat.ts`_ |
| Fidélité : config, exclusions, taux par viewer, boosts, rapports | `core:http/loyalty-routes.ts:73-128`, `core:http/wallet-routes.ts:131-193` | Seul `test-lab` touche aux exclusions                                                     |
| Monnaies, ajustement admin, transactions d'un viewer             | `core:http/wallet-routes.ts:85-118`                                        | L'ajustement passe par Modération                                                         |
| Nommer supermod quelqu'un hors de l'équipe                       | `core:lab-moderation/service.ts:422`                                       | L'interface ne liste que les membres déjà vus                                             |
| Historique des recomptages de Défis                              | `core:http/challenges-routes.ts:59`                                        | Le relais l'autorise (`srv:challenges/relay.ts:9-10`), seul `last_run` est lu             |
| Import générique de Progression                                  | `core:http/progression-routes.ts:198`                                      | Non relayé, seul WizeBot l'est                                                            |
| Pairing et révocation d'installation Studio                      | `core:http/studio-admin-routes.ts:23-47`                                   | Hors Studio, probablement voulu : _supposition_                                           |

## Non vérifié

- Aucun comportement à l'écran, aucune exécution, aucun appel Production réel.
- Lecture mécanique seulement pour `labo-tests`, `labo-extension`, et les écrans d'édition internes de Boutique, Défis et Commandes (champs comparés, rendu non comparé).
- Hors périmètre de cet agent : Tombola (page), TTS, Soundboard, Bonk, Alertes, Spotify, Roue, Halloween, Sanctions.
