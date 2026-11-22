# État du projet Raptoru 2.0

**Checkpoint du 22/11/2026** (fin du Casino V1, transition Chatbox) : § 1, § 3, § 5, § 6, § 7, § 9, § 12 et § 13
actualisés (Core et bot relevés en lecture seule le 22/11 ; Studio, extension publique et drapeaux le 20/11 ; le reste
du § 3 date du 10/11). Photographie précédente (16/11) :
[archive/PROJECT_STATUS_2026-11-16.md](archive/PROJECT_STATUS_2026-11-16.md).

- Production relevée en lecture seule : `coolify-deploy.mjs status`, `/health`, `/ready`, `build-info.json` du Studio
  installé, `raptoru.fr/api/status`.
- Extension : empreintes recalculées.
- OBS : journaux du jour.

Ce qui vient d'un retour d'Antoni est marqué « (Antoni) ». Version précédente :
[archive/PROJECT_STATUS_2026-11-08.md](archive/PROJECT_STATUS_2026-11-08.md). Avant de vous fier à une version écrite
ici, revérifiez-la ([REPRISE.md](REPRISE.md) § 4).

Documents liés :

- reprise : [REPRISE.md](REPRISE.md) ;
- roadmap : [ROADMAP.md](ROADMAP.md) ;
- architecture : [ARCHITECTURE.md](ARCHITECTURE.md) ;
- modules : [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md) ;
- versions et archives : [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) ;
- décisions : [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md) ;
- index : [README.md](README.md).

## 1. En une minute

Raptoru 2.0 est la plateforme de stream auto-hébergée du streamer Twitch `raptoru_` (identifiant 83603689), gérée par Antoni.

| Composant                        | Rôle                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| **Core**                         | décide de tout : données, économie des Jetons, règles des modules, files des effets        |
| **Bot** `LeCroupier_`            | seul lien avec Twitch (EventSub, chat) ; exécute ce que le Core décide                     |
| **Raptoru Studio « Coulisses »** | application Electron du PC du streamer : console, pilotage d'OBS, lecteurs d'overlays, Lab |
| **Extension Twitch**             | interface des viewers pendant le live                                                      |
| **raptoru.fr**                   | site communautaire, dans un dépôt séparé                                                   |

SAMMI est abandonné depuis le 20/10. Le dépôt est **public** depuis le 28/10 ([../SECURITY.md](../SECURITY.md)).

**Où on en est (22/11)** — détail et preuves : [REPRISE.md](REPRISE.md) § 5 :

- Production : Core **`a94d1081`** (déployé le 22/11 00:39 UTC), bot **`2c04a5db`** (sains, un seul bot actif),
  Studio **0.1.42** publié et installé, extension publique **`be1744e75f63`** (prouvée par Antoni le 20/11 : Level Up
  V2, mini-profil, Commandes V2.1, Mini-jeux V5, Music Hub).
- **Casino V1** (4 jeux) : développement terminé et fusionné ; Core déployé, ouvert par réglage
  (`CASINO_EXTENSION=on`, `casino.open=1`), refusé hors live ; **pas dans l'extension publique** : ZIP
  `d09fd03aa844` construit et vérifié le 22/11, **non téléversé** ; Hosted Test, revue Twitch et essai réel à faire
  ([ROADMAP.md](ROADMAP.md) § 0.4).
- **Chatbox** : fusionnée le 23/11 (PR #118, `main` `df3adb5e`), non déployée ; mise en service sur GO d'Antoni
  ([CHATBOX.md](CHATBOX.md) § 12).
- **Niveaux** : restauration WizeBot exécutée le 20/11 (432 comptes, définitive), badges tous les 25 niveaux,
  anciennes annulations bloquées, rattachements futurs non compressés ([LEVEL_UP_V2.md](LEVEL_UP_V2.md) § 15).
- Roue du Sub V3 active depuis le 16/11 ; Music Hub ouvert à tous (`MUSIC_HUB_EXTENSION=on`).
- OBS **33.0.1** (plugins réparés, SE.Live désactivé, [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md)).
- **Prochaine priorité** : les Chatbox (développement) ; en parallèle, le Casino jusqu'au public (gestes d'Antoni) ;
  ensuite Chaos V2 lot 0 ([ROADMAP.md](ROADMAP.md) § 0).

## 2. Statuts : ne jamais les confondre

| Statut                  | Ce qu'il signifie                                                               | Comment le vérifier                                                    |
| ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Commité                 | sur une branche, éventuellement locale                                          | `git log <branche>`                                                    |
| Sur `main`              | fusionné dans `origin/main`                                                     | `git branch -r --contains <sha>`                                       |
| Construit               | un artefact existe (ZIP, installateur)                                          | fichier + SHA-256 ([INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md))   |
| Publié                  | Studio : release publique ; extension : version approuvée et publiée par Twitch | releases `raptoru-studio-releases` ; console Twitch                    |
| Déployé                 | le Core ou le bot tourne sur ce commit                                          | `coolify-deploy.mjs status core\|bot`                                  |
| Installé                | Studio du PC sur cette version                                                  | `%LOCALAPPDATA%\Programs\Raptoru Studio\resources\app\build-info.json` |
| Activé                  | déployé **et** interrupteur, variable ou drapeau allumé                         | état du module dans Studio, variables Coolify (noms seulement)         |
| Hosted Test             | extension visible des seuls testeurs déclarés                                   | console Twitch (Antoni)                                                |
| Test automatique réussi | vitest, Playwright, CI                                                          | ne vaut **jamais** validation                                          |
| **Validé**              | **testé à la main par Antoni**                                                  | une trace écrite (document, message)                                   |
| Testé en live           | utilisé pendant un vrai live                                                    | trace écrite datée                                                     |

## 3. Environnements et versions (relevé du 22/11/2026 pour `main`, Core et bot ; 20/11 pour Studio, extension publique et drapeaux ; 10/11 pour le reste)

| Élément                            | Version                                                                                                                                                                      | Source du relevé                                         | Retour arrière                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `origin/main`                      | `302db793` (PR #113, inventaire validé) ; dernier code **`a94d1081`** (PR #111)                                                                                              | `git fetch` le 22/11                                     | —                                                                                   |
| Core `raptoru-core` (Coolify, VPS) | **`a94d1081`**, déployé le 22/11 00:39 UTC, sain (`/health`, `/ready`) ; dernières migrations : les 4 du Casino (20/11) ; aucune depuis                                      | `coolify-deploy.mjs status core` le 22/11                | `1f05b97c` (`deploy core 1f05b97c2c0133c1f222ff97d2003e218e9313ab --rollback --go`) |
| Bot `raptoru-bot` (Coolify, VPS)   | **`2c04a5db`** (16/11) ; bail actif vu par le Core                                                                                                                           | `status core` le 22/11                                   | `d2fd5bb7`                                                                          |
| Drapeaux du Core                   | `CASINO_EXTENSION=on`, `MUSIC_HUB_EXTENSION=on`                                                                                                                              | API Coolify (lecture seule) le 20/11                     | `off`, puis redémarrage du Core (GO)                                                |
| Base PostgreSQL 17                 | sauvegarde Coolify quotidienne ; sauvegardes manuelles du 20/11 : 06:28 (Casino), 12:57:26 (restauration des niveaux), 15:28:18 UTC (12 310 947 octets)                      | API Coolify le 20/11                                     | [BACKUPS.md](BACKUPS.md)                                                            |
| Studio installé (PC)               | **0.1.42** (`1f05b97c`), publiée le 20/11 (Latest) et installée                                                                                                              | `build-info.json` lu le 20/11                            | réinstaller 0.1.41 (release publique)                                               |
| Site raptoru.fr                    | `74f7542`                                                                                                                                                                    | `https://raptoru.fr/api/status` le 10/11                 | redéployer `542b1f2`                                                                |
| Extension **publique**             | **`be1744e75f63`** (shell v2, 95 commits depuis `0bf7907`), prouvée par Antoni dans la console Twitch le 20/11                                                               | `apps/twitch-extension/PUBLISHED`                        | console Twitch                                                                      |
| Extension **Hosted Test**          | dernier téléversement tracé : ZIP `raptoru-live-PRODUCTION-2e2eaf3ae34a-depuis-be1744e-8-commits-shell-v2.zip` (Casino, 20/11), inventaire `298e940290ab` validé             | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 0     | version publique inchangée                                                          |
| Extension **prête à publier**      | ZIP `raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip`, SHA-256 `1ec79c2a…66d76039`, inventaire `2411c992b26b` validé (22/11) ; **non téléversé** | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 0     | —                                                                                   |
| OBS                                | **33.0.1** ; obs-shaderfilter 2.6.1, Composite Blur 1.6.1, Advanced Masks 1.6.1, Image Reaction 1.4, Downstream Keyer 0.4.1, Move Transition 3.2.1 ; **SE.Live désactivé**   | journal OBS du 10/11                                     | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) § 4                                    |
| Coolify                            | API sur `https://dashboard.raptoru.fr` (l'ancien `coolify.raptoru.fr` renvoie 502)                                                                                           | 20/11                                                    | —                                                                                   |
| Staging `raptoru-core-staging`     | `core-staging.raptoru.fr` ; version non revérifiée                                                                                                                           | —                                                        | —                                                                                   |
| Lab                                | Core local réel, base Docker, `%APPDATA%\Raptoru Studio Lab` ; jamais la Production                                                                                          | [GUIDE_LAB.md](studio-refonte/architecture/GUIDE_LAB.md) | —                                                                                   |

**Checkout principal** `C:\Users\Antoni\Documents\Raptoru 2.0` :

- c'est le dossier de données du Studio installé ;
- il est sur `main` local `11ffe3f`, **683 commits derrière** `origin/main` (20/11), avec 88 entrées dans `git status` ;
  son `CLAUDE.md` a été resynchronisé sur `origin/main` le 15/11 (seul fichier écrit, avec l'accord d'Antoni) ;
- conduite à tenir : [REPRISE.md](REPRISE.md) § 3.

## 4. Composants et communication

[ARCHITECTURE.md](ARCHITECTURE.md) : composants, flux, frontières de confiance, ports. Cartographie du code par module :
[INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).

## 5. Fonctionnalités

L'état de chaque module (livré / développé / à valider / à développer) se lit dans **[ROADMAP.md](ROADMAP.md) § 1**,
seule source de ces états.

| Catégorie                                | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **En Production et utilisées**           | économie canonique (Wallet, Jetons, crédits TTS et Soundboard, Daily, fidélité, présence) · Commands V2 et Commandes Chat V2.1 · modération D4 · Tombola · Jeu des mots · Roulette, Slot, Duel (chat) · Soundboard · TTS · Bonk · alertes Twitch V2 · points de chaîne, récompenses et effets · Random Ban et Mini-jeux V5 · Roue du Sub V3 · Caution · Votekick V2 · Spotify V2 · Music Hub · Dock OBS · progression, Level Up V2 et classements (site) · mini-profil · boutique cosmétique · statistiques de modules (privées) · Studio Coulisses |
| **Déployé côté Core, pas encore public** | **Casino V1** (machine à fruits + Coffre, roulette, machine à émotes, blackjack multijoueur, nouvelles tables, réactions) : Core `a94d1081`, réglages ouverts, refus hors live ; module d'extension dans le ZIP `d09fd03aa844` prêt à publier (non téléversé) ; fonctions : [ROADMAP.md](ROADMAP.md) § 0.4                                                                                                                                                                                                                                          |
| **Déployées mais éteintes ou vides**     | moteur de défis (`CHALLENGES_ENGINE` off, aucun défi) · catalogue cosmétique sans contenu définitif · boutique et profil d'alertes Halloween (événement fermé le 02/11)                                                                                                                                                                                                                                                                                                                                                                             |
| **Lab uniquement**                       | Coffre mystère et Objectif de soirée (`labOnly`) · simulateurs du Lab                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Branches non fusionnées**              | Chaudron des subs (PR #47) · titres équipés depuis Studio (PR #54) · étude Croupier IA (suspendue) · détails : [ROADMAP.md](ROADMAP.md) § 2.3                                                                                                                                                                                                                                                                                                                                                                                                       |
| **En conception**                        | **Chatbox Raptoru** : fusionnée (PR #118), à mettre en service ([CHATBOX.md](CHATBOX.md) § 12) · **Chaos V2** : recherche du 10/11, aucune implémentation ([chaos/](chaos/ARCHITECTURE_CHAOS_V2.md))                                                                                                                                                                                                                                                                                                                                                |

## 6. Travaux récents (08/11 → 22/11)

| Date         | Événement                                                                                                                                                                                                                                                                                                                                             | Preuve                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 22/11        | **Casino, dernière passe et mise en service** : PR #115 (pastilles retirées, réactions « hélium », bulle ouverte, croupier en émote, ruban BUST) ; PR #111 (tables et réactions, anti-spam 5 / 2 s) ; **Core `a94d1081` déployé** 00:39 UTC sur GO d'Antoni ; inventaire `2411c992b26b` validé, ZIP `d09fd03aa844` construit (PR #113), non téléversé | [CASINO.md](CASINO.md) § 18, [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 0                |
| 22/11        | Checkpoint documentaire ; priorité de développement : les Chatbox                                                                                                                                                                                                                                                                                     | [REPRISE.md](REPRISE.md), [CHATBOX.md](CHATBOX.md)                                               |
| 21/11        | **Casino post-live** : PR #99, #100, #102, #103, #105, #107, #109, #110, #112, #114 (Split en pile, gains sur les rouleaux, téléphone et paysage, 7 réactions, banc interactif en cadre réel)                                                                                                                                                         | [CASINO.md](CASINO.md) § 14–18                                                                   |
| 20/11        | **Chatbox : reconnaissance** des 3 chatbox StreamElements (recherche seule, rapport privé hors Git)                                                                                                                                                                                                                                                   | [CHATBOX.md](CHATBOX.md) § 1                                                                     |
| 20/11        | **Casino V1** : PR #90 (`18a4b048`), 4 migrations, Core déployé, Studio 0.1.41 ; inventaire `298e940290ab` validé (PR #93) ; Casino ouvert par réglage ; ZIP `2e2eaf3ae34a` en Hosted Test                                                                                                                                                            | [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md)                                             |
| 20/11        | **Niveaux** : restauration WizeBot (432 comptes) ; PR #94 (annulations bloquées, rattachements futurs, badges /25), Core `1f05b97c`, Studio 0.1.42 ; PR #95 (reprise)                                                                                                                                                                                 | [LEVEL_UP_V2.md](LEVEL_UP_V2.md) § 14–15                                                         |
| 20/11        | Extension `be1744e75f63` prouvée publique par Antoni (console Twitch)                                                                                                                                                                                                                                                                                 | `apps/twitch-extension/PUBLISHED`                                                                |
| 16/11        | **Roue du Sub V3** : Core et bot `2c04a5db`, barème V3 actif ; Studio 0.1.39 puis 0.1.40                                                                                                                                                                                                                                                              | [SUB_WHEEL_V3.md](SUB_WHEEL_V3.md) § 13                                                          |
| 13–15/11     | Récompenses Twitch, Mini-jeux V5 (PR #67) ; Level Up V2 et mini-profil (PR #70, #71) ; Commandes Chat V2.1 (Core `c1da930a`, Studio 0.1.38)                                                                                                                                                                                                           | [archive/REPRISE_2026-11-11_2026-11-20.md](archive/REPRISE_2026-11-11_2026-11-20.md)             |
| 08–09/11     | **Music Hub** en Lab : module de l'extension (shell v2), page Studio, overlays OBS, historique par Daily, Windows SMTC, skip payant, Open Bar, `!song` v2                                                                                                                                                                                             | [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 0–14                                      |
| 09/11 nuit   | **Audit de fiabilité** : 15 correctifs testés (3 P1 : double débit après réponse perdue, session effacée, crédits TTS)                                                                                                                                                                                                                                | [AUDIT_FIABILITE_2026-11-09.md](AUDIT_FIABILITE_2026-11-09.md)                                   |
| 10/11 02–05h | **Livraison officielle** : PR #59 (`900637f` : audit, Music Hub, socle Extension Next), #60 (`0871ce1`), #61 (`bbce104` : passe après le test réel) ; Core et bot déployés ; Studio 0.1.28 puis 0.1.29 publiés ; ZIP Hosted Test `5ee8623` puis `bbce104`                                                                                             | [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md), [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) |
| 10/11        | PR #62 (`afe98cf`, documents) : inventaire du ZIP validé, remplacement du Hosted Test                                                                                                                                                                                                                                                                 | [extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 7       |
| 10/11        | **OBS 33.0.1** : 4 plugins réparés, SE.Live désactivé                                                                                                                                                                                                                                                                                                 | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md)                                                     |
| 10/11        | **Chaos V2 : recherche** (audit de V1, capture et curseur, performances, architecture, catalogue, roadmap)                                                                                                                                                                                                                                            | [chaos/](chaos/ARCHITECTURE_CHAOS_V2.md)                                                         |
| 11/11 11:24  | **Livraison** : PR #64 fusionnée (`052ab2ec`), Core déployé, Studio 0.1.30 publié (mise à jour 0.1.29 → 0.1.30 testée)                                                                                                                                                                                                                                | [REPRISE_SESSION_POST_LIVE_2026-11-11.md](REPRISE_SESSION_POST_LIVE_2026-11-11.md) § C2          |
| 11/11        | **Passe post-live** (soir + nuit) : commandes Jetons de l'équipe, Portefeuille, Musique dans la modération, Tombola 30 lignes, tutoriel, inventaire des commandes ; PR #64                                                                                                                                                                            | [RAPPORT_POST_LIVE.md](RAPPORT_POST_LIVE.md)                                                     |
| 10/11        | Consolidation documentaire (ce document)                                                                                                                                                                                                                                                                                                              | branche `docs/consolidation-2026-11-10`                                                          |

Avant le 08/11 : [archive/PROJECT_STATUS_2026-11-08.md](archive/PROJECT_STATUS_2026-11-08.md) § 6.

## 7. Tests et validations

### Derniers tests automatiques

| Sur                   | Résultat                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PR #111, #115 (22/11) | extension 206/206 ; `test:casino-compose` 135 états, 0 à regarder ; Core tables et réactions (lobby 14, façade 3, blackjack 14) ; vrai PostgreSQL à deux Cores (créations simultanées, deux onglets, Jetons conservés) ; doubles-clics vérifiés en navigateur réel sur 3 surfaces ; CI de `main` `a94d1081` verte (une relance de `progression-v2-level-up`, instable connu) | [CASINO.md](CASINO.md) § 18 ; CI GitHub                               |
| PR #94 (20/11)        | progression Core 64/64 (dont Level Up V2 34/34) ; Studio serveur 12/12 ; typecheck, lint ; CI de la PR et de `main` `1f05b97c` vertes (quality, core, e2e, studio, images)                                                                                                                                                                                                   | CI GitHub                                                             |
| PR #90 (20/11)        | Casino : blackjack 12 + intégration PostgreSQL à deux Cores 3 ; parité avec les prototypes (20 000 mains, 3 000 tours) ; contrôle Chromium sur un Core local ; CI verte                                                                                                                                                                                                      | [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md)                  |
| PR #59 (`900637f`)    | Core 1 480 ; intégration PostgreSQL 191/191 en séquentiel ; Studio 1 057 ; bot 290 ; extension 132 ; E2E CI 121/121                                                                                                                                                                                                                                                          | [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md) § 2                    |
| PR #61 (`bbce104`)    | typecheck 8/8, lint 0 ; Core 1 489 ; Studio 1 061 ; desktop 36 ; extension 132 ; `test:requests` identique ; E2E musique et achats 28/28 ; CI de la PR et de `main` vertes                                                                                                                                                                                                   | [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 15 ; CI GitHub |
| PR #64 (11/11)        | Core 1 510 ; intégration PostgreSQL 42 fichiers / 209 tests ; extension 132 ; Studio serveur 1 061 (soir) ; E2E Lab Tombola, Portefeuille, Music Hub, cycle de vie 18/18 ; typecheck 8/8, lint, build                                                                                                                                                                        | [RAPPORT_POST_LIVE.md](RAPPORT_POST_LIVE.md) § 3                      |
| Plantage connu        | sous Windows, la suite E2E locale complète s'arrête après environ 10 min : lancer les specs par lots, la CI fait foi                                                                                                                                                                                                                                                         | —                                                                     |

### Validations d'Antoni (écrites)

| Quoi                                                                                                                                                      | Date     | Portée                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Music Hub : commandes du lecteur depuis Studio 0.1.28 et le Hosted Test `5ee8623`, sur son vrai Spotify Desktop (pause, reprise, skip, volume, affichage) | 10/11    | **avant** la passe de finition ([MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 15) |
| Inventaire `2411c992b26b` (Casino final, 20 commits) : « Validé par Antoni : oui » ; GO de déploiement du Core `a94d1081`                                 | 22/11    | inventaire avant emballage et GO d'une étape, pas un test fonctionnel                |
| Inventaires des ZIP `5ee8623` (70 commits) et `bbce104` (72 commits) : « Validé par Antoni : oui »                                                        | 10/11    | inventaire avant emballage, pas un test fonctionnel                                  |
| Extension Next : recette visuelle en Lab « approuvée sur le principe et le ressenti général »                                                             | 08/11    | pas chaque vue, taille ni appareil                                                   |
| Studio Coulisses : direction D, recette Lab                                                                                                               | 06–07/11 | —                                                                                    |

**Non validé à ce jour (aucune trace écrite)** :

- Music Hub après la passe de finition, dans Studio 0.1.29 et le ZIP `bbce104` : clignotement, confirmations,
  réglages du skip, icône du volume ;
- les **parcours viewer complets** : demande payante, skip payant, permissions des rôles, remboursements, overlay
  musique dans un vrai OBS ;
- les effets OBS après la mise à jour 33.0.1 ([OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) O4) ;
- la recette d'usage de Studio 0.1.26 → 0.1.29 en Production.

La procédure de test réel de Music Hub est dans [extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 6 :
vrais Jetons et vrai Spotify, **à la main seulement**.

## 8. Bugs importants corrigés récemment

- **Audit du 09/11** (en Production depuis `900637f`) :
  - double débit après une réponse perdue ;
  - session effacée pendant un poll ;
  - envoi TTS incertain ;
  - EventSub à moitié ouvert ;
  - effets OBS ;
  - remboursements `!rb`…

  Liste : [AUDIT_FIABILITE_2026-11-09.md](AUDIT_FIABILITE_2026-11-09.md).

- **Music Hub après le test réel** (Studio 0.1.29, Core `bbce104`) :
  - clignotement de la carte du lecteur ;
  - fausses alertes « le lecteur n'a pas confirmé » (relectures jusqu'à la preuve, commande jamais renvoyée) ;
  - icône du volume.
- **OBS** : 4 plugins incompatibles avec OBS 33, fermeture bloquée par SE.Live.

## 9. Problèmes ouverts

| Domaine        | Problème                                                                                                                                                                                                                                              | Référence                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| OBS            | URL des sources navigateur : paramètres `selive-notify-*` **retirés le 10/11 à 17:06** (15 sources). Restent : `Navigateur web 2` avec une ancienne clé TTS (O10), une fermeture incomplète à 17:05 (O11)                                             | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) O1, O10, O11 |
| Studio         | **Deux fenêtres plein écran au premier plan** (overlay Halloween et Chaos) restent ouvertes en permanence quand Studio tourne, réglage « Overlay actif » allumé depuis Halloween ; impact probable sur la fluidité du jeu                             | [chaos/AUDIT_CHAOS_V1.md](chaos/AUDIT_CHAOS_V1.md) D1     |
| Poste          | écran principal à 59 Hz alors qu'il accepte 165 Hz ; OBS en priorité GPU temps réel (administrateur)                                                                                                                                                  | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) O7–O8        |
| Extension      | publique `be1744e75f63` ; Casino : ZIP `d09fd03aa844` prêt, non téléversé ; Hosted Test et revue Twitch à faire ; le Hosted Test doit rester hors de la chaîne en live                                                                                | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 3      |
| Extension Next | vrais appareils et soumission à faire ; restes non bloquants : Hub à 377×251, TTS en mobile paysage, bande « Vider » du Bonk                                                                                                                          | [ROADMAP.md](ROADMAP.md) § 2.1                            |
| Studio         | densité et responsive en fenêtre réduite, textes qui se chevauchent dans les notifications, notifications répétitives, états normaux présentés comme des incidents (retours d'Antoni, non chiffrés) ; code mort ; ancien Lab ; lots F3–F7             | [ROADMAP.md](ROADMAP.md) § 2.2                            |
| Tests          | E2E instables connus : `tombola-bonbons`, `effects-player`, `alerts`, `progression-studio`, `raffle-lab`, `progression-v2-level-up` sous charge ; arrêt de la pile E2E locale ; `alerts-se` pendant les releases Windows (nettoyage corrigé le 10/11) | [studio-refonte/ROADMAP.md](studio-refonte/ROADMAP.md)    |
| Exploitation   | secret GitHub `COOLIFY_URL` peut-être encore sur l'ancienne adresse ; exporter `COOLIFY_URL=https://dashboard.raptoru.fr`                                                                                                                             | [CICD.md](CICD.md)                                        |
| Données        | copies de la base hors VPS seulement manuelles (la plus récente en local : 07/11) ; données de Studio sauvegardées seulement avant une opération                                                                                                      | [BACKUPS.md](BACKUPS.md)                                  |
| Héritage       | lots 5, 7, 8, 10, 11, 13 et A7 du plan post-live ; fonctions SAMMI jamais reprises                                                                                                                                                                    | [ROADMAP.md](ROADMAP.md) § 3                              |

## 10. Décisions durables

Registre consolidé, avec les raisons : **[DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md)**. Décisions de module :
[ROADMAP.md](ROADMAP.md) § 5.

## 11. Sauvegardes et retour arrière

Inventaire vérifié le 10/11 : **[BACKUPS.md](BACKUPS.md)**. OBS : [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) § 4.
Retours arrière Core, bot, Studio et extension : [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md) § 5,
[INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md).

## 12. Ce qui demande encore Antoni

1. **Casino** ([REPRISE.md](REPRISE.md) § 5.4 B) : téléverser le ZIP `d09fd03aa844`, Hosted Test hors live (PC et
   application Twitch du téléphone) ; choisir `CASINO_EXTENSION` (`testers:<ids>` ou `on`) avant la publication ;
   soumettre à la revue Twitch ; essai réel en live après publication.
2. **Chatbox** ([CHATBOX.md](CHATBOX.md) § 5) : décider ce qu'on garde, rend réglable ou change dans chaque chatbox ;
   source des messages ; bots masqués ; événements affichés ; fournir au besoin le code collé chez StreamElements et
   des captures des scènes.
3. **Validations réelles en live** : premier tirage V3 de la Roue ; vraie annonce test Level Up ; commande d'Aouh ;
   parcours viewer de Music Hub ([extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 6) ;
   effets FX Cam et Votekick ; transitions stinger.
4. **OBS et poste** : sort de la source `Navigateur web 2` (O10) ; couper Studio › Halloween « Overlay actif » ;
   fréquence de l'écran (59 / 165 Hz).
5. **Chaos V2** : GO pour le lot 0, puis arbitrages Q1–Q10 de
   [chaos/QUESTIONS_OUVERTES_CHAOS_V2.md](chaos/QUESTIONS_OUVERTES_CHAOS_V2.md).
6. **Git** : trier les PR ouvertes ([CLEANUP_LATER.md](CLEANUP_LATER.md) § 2) ; mettre à jour le checkout principal en
   préservant les données de Studio.
7. **Contenu métier** : défis, cosmétiques, récompenses.

## 13. Prochaine priorité

**Chatbox Raptoru** (développement : revue des caractéristiques avec Antoni, puis conception ;
[CHATBOX.md](CHATBOX.md)). En parallèle, **Casino V1 jusqu'au public** (gestes d'Antoni, [REPRISE.md](REPRISE.md)
§ 5.4 B). Ensuite **Chaos V2, lot 0** : mesurer avant de construire, sans code
([chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md)).
