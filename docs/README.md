# Index de la documentation

Mis à jour le 22/11/2026 (checkpoint : fin du Casino V1, transition Chatbox). **Un seul point d'entrée : [REPRISE.md](REPRISE.md)** (§ 0 : résumé ; § 5 : état exact ; § 6 : comment reprendre). Pour ChatGPT : [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md). Chaque sujet a une seule source de vérité :

| Sujet                         | Source unique                                      |
| ----------------------------- | -------------------------------------------------- |
| état et versions              | [PROJECT_STATUS.md](PROJECT_STATUS.md)             |
| état des modules et priorités | [ROADMAP.md](ROADMAP.md)                           |
| règles des agents             | [../CLAUDE.md](../CLAUDE.md)                       |
| où est le code d'un module    | [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md)     |
| versions, ZIP et empreintes   | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md)   |
| décisions et leurs raisons    | [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md) |
| OBS (version, plugins)        | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md)       |
| un module                     | son document (ci-dessous)                          |

Statut de chaque document :

| Statut         | Signification                                                         |
| -------------- | --------------------------------------------------------------------- |
| **Référence**  | à jour, fait foi sur son sujet                                        |
| **Actif**      | à jour pour l'essentiel, dates internes à vérifier                    |
| **Exécuté**    | plan ou runbook réalisé, gardé pour ses preuves et son retour arrière |
| **Historique** | état d'une époque, à ne pas suivre tel quel                           |

Les documents dont l'en-tête est antérieur à la Production portent une note de consolidation : leur en-tête est d'époque
et l'état courant est dans la roadmap. Les documents de module sont cités par des commentaires du code : **ne pas les
déplacer**.

## 1. Commencer ici

| Document                                           | Rôle                                                                                                            | Statut    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| [REPRISE.md](REPRISE.md)                           | reprise pour un agent : limites, espaces de travail, commandes, prochain travail, « si on change de modèle »    | Référence |
| [REPRISE_CHATGPT.md](REPRISE_CHATGPT.md)           | message court à coller dans une conversation ChatGPT (contexte, versions, Casino, niveaux, priorités)           | Référence |
| [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)             | méthode de travail d'un agent : classes A/B/C/D, tests et CI, attentes, livraison, outils, pièges connus        | Référence |
| [PROJECT_STATUS.md](PROJECT_STATUS.md)             | photographie du projet : versions, environnements, fonctionnalités, tests, bugs, décisions, actions d'Antoni    | Référence |
| [ROADMAP.md](ROADMAP.md)                           | état de chaque module (livré, développé, à valider, à développer), chantiers, prochaines fonctionnalités        | Référence |
| [../CLAUDE.md](../CLAUDE.md)                       | règles de travail des agents                                                                                    | Référence |
| [../SECURITY.md](../SECURITY.md)                   | dépôt public : secrets, signalement                                                                             | Référence |
| [WORKSPACES.md](WORKSPACES.md)                     | carte des worktrees, branches et dossiers du projet                                                             | Référence |
| [CLEANUP_LATER.md](CLEANUP_LATER.md)               | nettoyage proposé, rien de supprimé                                                                             | Référence |
| [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md)     | code, commandes, interrupteurs et tests de chaque module ; lecteurs OBS                                         | Référence |
| [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md)   | déploiements Core et bot, versions Studio, archives de l'extension (empreintes recalculées), référence actuelle | Référence |
| [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md) | décisions structurantes et leurs raisons                                                                        | Référence |

## 2. Architecture et exploitation

| Document                                                                                         | Rôle                                                                        | Statut                                                     |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)                                                               | composants, flux, frontières de confiance, ports, document de chaque module | Référence                                                  |
| [OPERATIONS.md](OPERATIONS.md)                                                                   | tests, déploiement Coolify, retour arrière, builds                          | Actif (§ 5 historique)                                     |
| [CICD.md](CICD.md)                                                                               | workflows GitHub (CI, Déployer, État, Studio)                               | Actif                                                      |
| [BACKUPS.md](BACKUPS.md)                                                                         | inventaire des sauvegardes, restauration                                    | Référence (§ 0 vérifié le 10/11 ; § 1–9 : relevé du 24/10) |
| [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md)                                                     | OBS 33.0.1, plugins, SE.Live, sauvegardes, observations ouvertes            | Référence                                                  |
| [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md)                                                   | livraison du 10/11 (Music Hub, audit, socle v2), retours arrière            | Exécuté                                                    |
| [TWITCH_OAUTH.md](TWITCH_OAUTH.md)                                                               | comptes Twitch, profils OAuth                                               | Référence                                                  |
| [../Raptoru Studio — Infrastructure Spec.md](../Raptoru%20Studio%20—%20Infrastructure%20Spec.md) | vision d'origine (24/09)                                                    | Historique (vision)                                        |

## 3. Chantiers récents

| Dossier                                                      | Contenu                                                                                                                                                                                                                                        | Point d'entrée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [studio-refonte/](studio-refonte/CONTEXTE.md)                | Studio Coulisses : contexte et règles, design system, socle modulaire (`architecture/`), parité, recettes, bascule du 07/11                                                                                                                    | [CONTEXTE.md](studio-refonte/CONTEXTE.md), [DESIGN_SYSTEM.md](studio-refonte/DESIGN_SYSTEM.md), [OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) (Exécuté)                                                                                                                                                                                                                                                                                                                              |
| [extension/](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md) | Extension Next (sur `main` depuis le 10/11) : audit, plan, socle, publication, dossier Twitch du 10/11                                                                                                                                         | [SOCLE.md](extension/SOCLE.md), [TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) (Hosted Test, parcours réel Music Hub)                                                                                                                                                                                                                                                                                                                                                    |
| [music/](music/MUSIC_HUB_STATE.md)                           | Music Hub et Spotify : état de clôture (§ 16), overlays, SMTC, quotas, Lab sur le vrai compte                                                                                                                                                  | [MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 16                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [chaos/](chaos/ARCHITECTURE_MOTEUR.md)                       | Chaos V2 (« Chaos / KO Overlay ») : recherche du 10/11 (audit V1, capture, curseur, catalogue, roadmap, questions) ; moteur du 22/11 (architecture, contrats, couche Entrées, guides effets / shaders / configuration, tests, arrêt d'urgence) | [ARCHITECTURE_MOTEUR.md](chaos/ARCHITECTURE_MOTEUR.md) (moteur construit en local, retournement seul) ; [GUIDE_STUDIO_CHAOS.md](chaos/GUIDE_STUDIO_CHAOS.md) (catalogue d'effets) ; [ETUDE_CURSEUR.md](chaos/ETUDE_CURSEUR.md) (curseur retourné) ; [PERFORMANCES_MOTEUR.md](chaos/PERFORMANCES_MOTEUR.md) ; [COUCHE_ENTREES.md](chaos/COUCHE_ENTREES.md) (expérimental) ; [ETUDE_PERFORMANCES_RETOURNEMENT.md](chaos/ETUDE_PERFORMANCES_RETOURNEMENT.md) ; [ARRET_URGENCE.md](chaos/ARRET_URGENCE.md) |

`studio-refonte/` en détail :

| Statut               | Documents                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Référence            | `CONTEXTE.md` (§ 6 dépassé : remplacé par `DESIGN_SYSTEM.md`) · `DESIGN_SYSTEM.md` · `BRIEF_PAGES.md` · `PARITE.md` et `parite/` · `INVENTAIRE_MODERATION.md` · `architecture/*` (guides du socle) |
| Exécuté              | `OPERATION_COULISSES.md` · `LIVRAISON.md` · `MIGRATION_DONNEES.md` · `REDESIGN.md` · `CONSOLIDATION.md` · `FINALISATION.md` · `PARITE_RECOMPENSES.md` · les `RECETTE_*.md`                         |
| Historique           | `CHECKPOINT.md` · `ROADMAP.md` · `JOURNAL.md` · `AUDIT_FONCTIONNEL.md` (sa § H est remplacée par `CONTEXTE.md` § 18) · `FOUNDATION_COMPLETE.md`                                                    |
| Préparé, non exécuté | `RETRAIT_ANCIEN_LAB.md`                                                                                                                                                                            |

## 4. Documents de module

| Module                                       | Document                                                                                                                                                                                                                                                            | Statut                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Économie, Wallet, migration StreamElements   | [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)                                                                                                                                                                                                                        | Exécuté                                  |
| Commands V2                                  | [COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md), [CHAT_COMMANDS.md](CHAT_COMMANDS.md)                                                                                                                                                                                | Référence                                |
| Modération D4                                | [moderation-v2-d4-parity.md](moderation-v2-d4-parity.md)                                                                                                                                                                                                            | Référence                                |
| Tombola                                      | [tombola-v2-parity.md](tombola-v2-parity.md)                                                                                                                                                                                                                        | Référence                                |
| Jeu des mots, Roulette et Slot, Duel         | [WORD_GAME_PARITY.md](WORD_GAME_PARITY.md), [ROULETTE_SLOT_PARITY.md](ROULETTE_SLOT_PARITY.md), [DUEL_PARITY.md](DUEL_PARITY.md)                                                                                                                                    | Référence, en-tête d'époque              |
| Bonk                                         | [BONK_VNEXT_AUDIT_2026-10.md](BONK_VNEXT_AUDIT_2026-10.md) ; [bonk-lab.md](bonk-lab.md)                                                                                                                                                                             | Référence, en-tête d'époque ; Historique |
| Alertes Twitch                               | [TWITCH_ALERTS_PARITY_2026-10.md](TWITCH_ALERTS_PARITY_2026-10.md)                                                                                                                                                                                                  | Référence, en-tête d'époque              |
| Points de chaîne, lecteur d'effets           | [CHANNEL_POINTS_V1.md](CHANNEL_POINTS_V1.md), [EFFECTS_PLAYER.md](EFFECTS_PLAYER.md)                                                                                                                                                                                | Référence                                |
| Chatbox OBS (remplacement de StreamElements) | [CHATBOX.md](CHATBOX.md) (chantier prioritaire : spécification complète du 22/11, jalon 1 en cours ; rapport et présentation privés hors Git)                                                                                                                       | Référence (en cours)                     |
| Casino V1 (4 jeux, blackjack multijoueur)    | [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md) (livraisons du 20 et du 22/11, état), [CASINO.md](CASINO.md) (règles, § 12 blackjack, § 13 émotes), [CASINO_SYMBOLES.md](CASINO_SYMBOLES.md) ; [CASINO_HANDOFF_2026-11-18.md](CASINO_HANDOFF_2026-11-18.md)    | Référence ; Historique (passation)       |
| Soundboard (ajouter un son depuis Studio)    | [SOUNDBOARD.md](SOUNDBOARD.md) (qui fait quoi, découpe, stockage, catalogue dynamique, mise en service)                                                                                                                                                             | Référence                                |
| Level Up V2, restauration des niveaux        | [LEVEL_UP_V2.md](LEVEL_UP_V2.md) (§ 14–15 : restauration du 20/11, annulations bloquées)                                                                                                                                                                            | Référence                                |
| Mini-profil, Mini-jeux, récompenses          | [MINI_PROFIL.md](MINI_PROFIL.md), [mini-jeux/LIVRAISON_V5.md](mini-jeux/LIVRAISON_V5.md), [RECOMPENSES_TWITCH.md](RECOMPENSES_TWITCH.md)                                                                                                                            | Référence                                |
| Random Ban                                   | [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md)                                                                                                                                                                                                                                | Référence                                |
| Roue du Sub                                  | [SUB_WHEEL_V3.md](SUB_WHEEL_V3.md) § 13 (V3 : barème, ancienneté, rendu, livraison), [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md) (Exécuté, retour arrière), [SUB_WHEEL_V2_PLAN.md](SUB_WHEEL_V2_PLAN.md), [SUB_WHEEL.md](SUB_WHEEL.md) (V1, mode de repli) | Référence                                |
| Votekick, Caution                            | [VOTEKICK_V2.md](VOTEKICK_V2.md), [CAUTION.md](CAUTION.md)                                                                                                                                                                                                          | Référence                                |
| Spotify                                      | [SPOTIFY_V2.md](SPOTIFY_V2.md)                                                                                                                                                                                                                                      | Référence (clos)                         |
| Dock OBS                                     | [OBS_DOCK.md](OBS_DOCK.md)                                                                                                                                                                                                                                          | Référence                                |
| Centre de contrôle, supervision              | [CONTROL_CENTER.md](CONTROL_CENTER.md), [SUPERVISION_LOTS_1_2.md](SUPERVISION_LOTS_1_2.md)                                                                                                                                                                          | Historique (repris dans Coulisses)       |
| Progression                                  | [PROGRESSION.md](PROGRESSION.md) ; [PROGRESSION_GO.md](PROGRESSION_GO.md)                                                                                                                                                                                           | Référence ; Exécuté                      |
| Boutique cosmétique, défis, statistiques     | [COSMETIC_SHOP.md](COSMETIC_SHOP.md), [CHALLENGES.md](CHALLENGES.md), [MODULE_STATS.md](MODULE_STATS.md)                                                                                                                                                            | Référence                                |
| Halloween                                    | [HALLOWEEN.md](HALLOWEEN.md), [HALLOWEEN_GO.md](HALLOWEEN_GO.md)                                                                                                                                                                                                    | Historique (fermé le 02/11) ; Exécuté    |
| Extension (calibration du composant vidéo)   | [TWITCH_GEOMETRY_CALIBRATION_2026-10.md](TWITCH_GEOMETRY_CALIBRATION_2026-10.md), [../apps/twitch-extension/README.md](../apps/twitch-extension/README.md)                                                                                                          | Historique ; Actif                       |

## 5. Plans exécutés, audits et historique

| Document                                                                                                                                                                                                                                        | Statut                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [CUTOVER_PLAN_2026-10.md](CUTOVER_PLAN_2026-10.md), [BOT_VPS_CUTOVER.md](BOT_VPS_CUTOVER.md) (son § 10 sert encore au retour arrière), [TEST_REEL_STAGING_2026-10.md](TEST_REEL_STAGING_2026-10.md), [RELEASE_SITE_HUB.md](RELEASE_SITE_HUB.md) | Exécuté                                                                             |
| [PLAN_POST_LIVE_2026-10-21.md](PLAN_POST_LIVE_2026-10-21.md)                                                                                                                                                                                    | Historique ; décisions A1–A9 toujours en vigueur, lots restants dans ROADMAP § 3    |
| [ASTRA_GLOBAL_AUDIT_2026-10.md](ASTRA_GLOBAL_AUDIT_2026-10.md)                                                                                                                                                                                  | registre d'audit (cité par `CLAUDE.md`)                                             |
| [RAPTORU_STUDIO_UX_UI_2026-11-04.md](RAPTORU_STUDIO_UX_UI_2026-11-04.md)                                                                                                                                                                        | Historique : sa navigation a été adoptée, sa palette remplacée par la direction D   |
| [../Raptoru-2.0-HANDOFF.md](../Raptoru-2.0-HANDOFF.md) (figé au 21/10), [../Raptoru-2.0-ETAT-PROJET.md](../Raptoru-2.0-ETAT-PROJET.md) (figé au 19/10 ; § 0.5b : inventaire des fonctions legacy)                                               | Historique                                                                          |
| [archive/](archive/README.md)                                                                                                                                                                                                                   | anciens points d'entrée, journaux, roadmaps et états (jusqu'au checkpoint du 20/11) |

Le site raptoru.fr a sa propre documentation, `lb-app/docs/SITE_CONTEXT.md`, dans le dépôt du site.

## 6. Correspondance avec les noms demandés le 10/11

La consolidation du 10/11 demandait des documents sous d'autres noms. Pour ne pas créer de doublons, les fichiers
canoniques existants ont été mis à jour :

| Nom demandé                      | Fichier canonique                                                 |
| -------------------------------- | ----------------------------------------------------------------- |
| `CONTEXTE_RAPTORU_2.0.md`        | [ARCHITECTURE.md](ARCHITECTURE.md) + [REPRISE.md](REPRISE.md) § 1 |
| `ETAT_ACTUEL.md`                 | [PROJECT_STATUS.md](PROJECT_STATUS.md)                            |
| `ROADMAP.md`                     | [ROADMAP.md](ROADMAP.md)                                          |
| `INVENTAIRE_MODULES.md`          | [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md) (nouveau)          |
| `INVENTAIRE_RELEASES.md`         | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) (nouveau)        |
| `INVENTAIRE_WORKTREES.md`        | [WORKSPACES.md](WORKSPACES.md)                                    |
| `SAUVEGARDES_ET_RESTAURATION.md` | [BACKUPS.md](BACKUPS.md)                                          |
| `DECISIONS_TECHNIQUES.md`        | [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md) (nouveau)      |
| `REPRISE_SESSION.md`             | [REPRISE.md](REPRISE.md) (§ 0 : résumé compact)                   |
