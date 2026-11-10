# État du projet Raptoru 2.0

**Photographie du 10/11/2026, ~16:00**.

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

**Où on en est (10/11)** :

- Production : Core `bbce104`, bot `900637f`, Studio **0.1.29** installé.
- **Music Hub** est livré dans le code et ouvert **aux seuls testeurs** ; son extension (shell v2) est en **Hosted Test**
  (Antoni).
- L'extension **publique** reste la version présumée `0bf7907` (shell legacy), jamais prouvée.
- Extension Next (socle v2) est **fusionnée dans `main`** depuis la PR #59.
- OBS est passé en **33.0.1** : plugins réparés, SE.Live désactivé ([OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md)).
- **Prochain chantier : Chaos V2**, en phase de conception ([chaos/](chaos/ARCHITECTURE_CHAOS_V2.md)). Rien n'est
  construit.

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

## 3. Environnements et versions (relevé du 10/11/2026)

| Élément                            | Version                                                                                                                                                                    | Source du relevé                                         | Retour arrière                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `origin/main`                      | **`afe98cf`** (PR #62, documents) ; dernier code : `bbce104` (PR #61)                                                                                                      | `git fetch` le 10/11                                     | —                                                                                 |
| Core `raptoru-core` (Coolify, VPS) | **`bbce104`**, déployé le 10/11 05:08 UTC, sain (`/health`, `/ready`) ; migration `20261122130000_music_hub.sql` appliquée le 10/11 avec `900637f`                         | `coolify-deploy.mjs status core` le 10/11                | `900637f`, puis `1b25f30` ([RELEASE_2026-11-10.md](RELEASE_2026-11-10.md) § 5)    |
| Bot `raptoru-bot` (Coolify, VPS)   | **`900637f`**, déployé le 10/11 02:35 UTC ; bail actif vu par le Core                                                                                                      | `status bot`                                             | `1b25f30`                                                                         |
| Variable Core                      | `MUSIC_HUB_EXTENSION=testers:1239040922` (LeCroupier_ ; le diffuseur est toujours inclus)                                                                                  | livraison du 10/11                                       | `off`, puis redémarrage du Core                                                   |
| Base PostgreSQL 17                 | sauvegarde Coolify quotidienne ; dernière réussie le **10/11 à 04:00 UTC** ; sauvegarde manuelle le 10/11 à 02:30:59 avant la migration Music Hub                          | `status core`                                            | [BACKUPS.md](BACKUPS.md)                                                          |
| Studio installé (PC)               | **0.1.29**, construit depuis `bbce104` le 10/11 05:14 UTC                                                                                                                  | `build-info.json` lu le 10/11                            | réinstaller 0.1.28 (release publique) ; installateurs 0.1.25 / 0.1.26 sauvegardés |
| Site raptoru.fr                    | `74f7542`                                                                                                                                                                  | `https://raptoru.fr/api/status` le 10/11                 | redéployer `542b1f2`                                                              |
| Extension **publique**             | **non prouvée**, présumée `0bf7907` (shell legacy, 22/10) ; ZIP de `0bf7907` introuvable sur le disque                                                                     | `apps/twitch-extension/PUBLISHED`                        | console Twitch                                                                    |
| Extension **Hosted Test**          | ZIP `bbce1048a078` shell v2, SHA-256 `80bdab00…f9f5b` (vérifié), téléversé à la place de `5ee8623` (Antoni)                                                                | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 3     | ancien ZIP `5ee8623` conservé                                                     |
| OBS                                | **33.0.1** ; obs-shaderfilter 2.6.1, Composite Blur 1.6.1, Advanced Masks 1.6.1, Image Reaction 1.4, Downstream Keyer 0.4.1, Move Transition 3.2.1 ; **SE.Live désactivé** | journal OBS du 10/11                                     | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) § 4                                  |
| Coolify                            | API sur `https://dashboard.raptoru.fr` (l'ancien `coolify.raptoru.fr` renvoie 502)                                                                                         | 10/11                                                    | —                                                                                 |
| Staging `raptoru-core-staging`     | `core-staging.raptoru.fr` ; version non revérifiée                                                                                                                         | —                                                        | —                                                                                 |
| Lab                                | Core local réel, base Docker, `%APPDATA%\Raptoru Studio Lab` ; jamais la Production                                                                                        | [GUIDE_LAB.md](studio-refonte/architecture/GUIDE_LAB.md) | —                                                                                 |

**Checkout principal** `C:\Users\Antoni\Documents\Raptoru 2.0` :

- c'est le dossier de données du Studio installé ;
- il est sur `main` local `11ffe3f`, **523 commits derrière** `origin/main`, avec 79 modifications non commitées ;
- conduite à tenir : [REPRISE.md](REPRISE.md) § 3.

## 4. Composants et communication

[ARCHITECTURE.md](ARCHITECTURE.md) : composants, flux, frontières de confiance, ports. Cartographie du code par module :
[INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).

## 5. Fonctionnalités

L'état de chaque module (livré / développé / à valider / à développer) se lit dans **[ROADMAP.md](ROADMAP.md) § 1**,
seule source de ces états.

| Catégorie                                     | Contenu                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **En Production et utilisées**                | économie canonique (Wallet, Jetons, crédits TTS et Soundboard, Daily, fidélité, présence) · Commands V2 · modération D4 · Tombola · Jeu des mots · Roulette, Slot, Duel (chat) · Soundboard · TTS · Bonk · alertes Twitch V2 · points de chaîne et effets · Random Ban V3 · Roue du Sub V2 · Caution · Votekick V2 · Spotify V2 · Dock OBS · progression et classements (site) · boutique cosmétique · statistiques de modules (privées) · Studio Coulisses |
| **En Production pour les testeurs seulement** | **Music Hub** : demandes payantes, skip payant progressif, contrôles du lecteur pour les supermods, historique de la soirée, Open Bar, nouveau `!song`. Fermé à tous les autres viewers par `MUSIC_HUB_EXTENSION` ; son module d'extension n'existe que dans le Hosted Test                                                                                                                                                                                 |
| **Déployées mais éteintes ou vides**          | moteur de défis (`CHALLENGES_ENGINE` off, aucun défi) · catalogue cosmétique sans contenu définitif · boutique et profil d'alertes Halloween (événement fermé le 02/11)                                                                                                                                                                                                                                                                                     |
| **Lab uniquement**                            | Coffre mystère et Objectif de soirée (`labOnly`) · simulateurs du Lab                                                                                                                                                                                                                                                                                                                                                                                       |
| **Branches non fusionnées**                   | Level Up V2 (PR #43, brouillon) · Chaudron des subs (PR #47) · titres équipés depuis Studio (PR #54) · détails : [ROADMAP.md](ROADMAP.md) § 2.3 (branches)                                                                                                                                                                                                                                                                                                  |
| **En conception**                             | **Chaos V2** : recherche du 10/11, aucune implémentation ([chaos/](chaos/ARCHITECTURE_CHAOS_V2.md))                                                                                                                                                                                                                                                                                                                                                         |

## 6. Travaux récents (08/11 → 10/11)

| Date         | Événement                                                                                                                                                                                                                                                 | Preuve                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 08–09/11     | **Music Hub** en Lab : module de l'extension (shell v2), page Studio, overlays OBS, historique par Daily, Windows SMTC, skip payant, Open Bar, `!song` v2                                                                                                 | [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 0–14                                      |
| 09/11 nuit   | **Audit de fiabilité** : 15 correctifs testés (3 P1 : double débit après réponse perdue, session effacée, crédits TTS)                                                                                                                                    | [AUDIT_FIABILITE_2026-11-09.md](AUDIT_FIABILITE_2026-11-09.md)                                   |
| 10/11 02–05h | **Livraison officielle** : PR #59 (`900637f` : audit, Music Hub, socle Extension Next), #60 (`0871ce1`), #61 (`bbce104` : passe après le test réel) ; Core et bot déployés ; Studio 0.1.28 puis 0.1.29 publiés ; ZIP Hosted Test `5ee8623` puis `bbce104` | [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md), [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) |
| 10/11        | PR #62 (`afe98cf`, documents) : inventaire du ZIP validé, remplacement du Hosted Test                                                                                                                                                                     | [extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 7       |
| 10/11        | **OBS 33.0.1** : 4 plugins réparés, SE.Live désactivé                                                                                                                                                                                                     | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md)                                                     |
| 10/11        | **Chaos V2 : recherche** (audit de V1, capture et curseur, performances, architecture, catalogue, roadmap)                                                                                                                                                | [chaos/](chaos/ARCHITECTURE_CHAOS_V2.md)                                                         |
| 10/11        | Consolidation documentaire (ce document)                                                                                                                                                                                                                  | branche `docs/consolidation-2026-11-10`                                                          |

Avant le 08/11 : [archive/PROJECT_STATUS_2026-11-08.md](archive/PROJECT_STATUS_2026-11-08.md) § 6.

## 7. Tests et validations

### Derniers tests automatiques (10/11)

| Sur                | Résultat                                                                                                                                                                   | Source                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PR #59 (`900637f`) | Core 1 480 ; intégration PostgreSQL 191/191 en séquentiel ; Studio 1 057 ; bot 290 ; extension 132 ; E2E CI 121/121                                                        | [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md) § 2                    |
| PR #61 (`bbce104`) | typecheck 8/8, lint 0 ; Core 1 489 ; Studio 1 061 ; desktop 36 ; extension 132 ; `test:requests` identique ; E2E musique et achats 28/28 ; CI de la PR et de `main` vertes | [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 15 ; CI GitHub |
| Plantage connu     | sous Windows, la suite E2E locale complète s'arrête après environ 10 min : lancer les specs par lots, la CI fait foi                                                       | —                                                                     |

### Validations d'Antoni (écrites)

| Quoi                                                                                                                                                      | Date     | Portée                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Music Hub : commandes du lecteur depuis Studio 0.1.28 et le Hosted Test `5ee8623`, sur son vrai Spotify Desktop (pause, reprise, skip, volume, affichage) | 10/11    | **avant** la passe de finition ([MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md) § 15) |
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

| Domaine        | Problème                                                                                                                                                                                                                                              | Référence                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| OBS            | **15 sources navigateur gardent des paramètres `selive-notify-*` dans leur URL** (TTS, Alertes, Effets, Tombola, Jeu des mots, Votekick…). Nos lecteurs lisent toute la partie après `#` comme clé : risque de « clé refusée ». À vérifier par Antoni | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) O1        |
| Studio         | **Deux fenêtres plein écran au premier plan** (overlay Halloween et Chaos) restent ouvertes en permanence quand Studio tourne, réglage « Overlay actif » allumé depuis Halloween ; impact probable sur la fluidité du jeu                             | [chaos/AUDIT_CHAOS_V1.md](chaos/AUDIT_CHAOS_V1.md) D1  |
| Poste          | écran principal à 59 Hz alors qu'il accepte 165 Hz ; OBS en priorité GPU temps réel (administrateur)                                                                                                                                                  | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) O7–O8     |
| Extension      | version publique non prouvée ; 72 commits non publiés ; le Hosted Test doit rester hors de la chaîne en live                                                                                                                                          | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 3   |
| Extension Next | vrais appareils et soumission à faire ; restes non bloquants : Hub à 377×251, TTS en mobile paysage, bande « Vider » du Bonk                                                                                                                          | [ROADMAP.md](ROADMAP.md) § 2.1                         |
| Studio         | densité et responsive en fenêtre réduite, textes qui se chevauchent dans les notifications, notifications répétitives, états normaux présentés comme des incidents (retours d'Antoni, non chiffrés) ; code mort ; ancien Lab ; lots F3–F7             | [ROADMAP.md](ROADMAP.md) § 2.2                         |
| Tests          | E2E instables connus : `tombola-bonbons`, `effects-player`, `alerts`, `progression-studio`, `raffle-lab` sous charge ; arrêt de la pile E2E locale ; `alerts-se` pendant les releases Windows (nettoyage corrigé le 10/11)                            | [studio-refonte/ROADMAP.md](studio-refonte/ROADMAP.md) |
| Exploitation   | secret GitHub `COOLIFY_URL` peut-être encore sur l'ancienne adresse ; exporter `COOLIFY_URL=https://dashboard.raptoru.fr`                                                                                                                             | [CICD.md](CICD.md)                                     |
| Données        | copies de la base hors VPS seulement manuelles (la plus récente en local : 07/11) ; données de Studio sauvegardées seulement avant une opération                                                                                                      | [BACKUPS.md](BACKUPS.md)                               |
| Héritage       | lots 5, 7, 8, 10, 11, 13 et A7 du plan post-live ; fonctions SAMMI jamais reprises                                                                                                                                                                    | [ROADMAP.md](ROADMAP.md) § 3                           |

## 10. Décisions durables

Registre consolidé, avec les raisons : **[DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md)**. Décisions de module :
[ROADMAP.md](ROADMAP.md) § 5.

## 11. Sauvegardes et retour arrière

Inventaire vérifié le 10/11 : **[BACKUPS.md](BACKUPS.md)**. OBS : [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) § 4.
Retours arrière Core, bot, Studio et extension : [RELEASE_2026-11-10.md](RELEASE_2026-11-10.md) § 5,
[INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md).

## 12. Ce qui demande encore Antoni

1. **Music Hub** :
   - tester Studio 0.1.29 et le Hosted Test `bbce104` ;
   - suivre le parcours réel de [TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 6 ;
   - puis décider : fermer le chantier ou ouvrir plus largement. L'ouverture publique passe par une **soumission**
     Twitch.
2. **OBS** :
   - vérifier les 15 URL de sources navigateur (O1) ;
   - déclencher une fois les effets FX Cam, Votekick et Chaos ;
   - écouter les transitions stinger.
3. **Poste** :
   - couper Studio › Halloween « Overlay actif » (fenêtres permanentes) ;
   - choisir la fréquence de l'écran (59 / 165 Hz).
4. **Chaos V2** : GO pour le lot 0 (mesures PresentMon), puis arbitrages Q1–Q10 de
   [chaos/QUESTIONS_OUVERTES_CHAOS_V2.md](chaos/QUESTIONS_OUVERTES_CHAOS_V2.md).
5. **Extension** :
   - prouver la version publique ;
   - décider de la soumission du shell v2 (review de 8 à 14 jours).
6. **Git** :
   - trier les PR ouvertes ([CLEANUP_LATER.md](CLEANUP_LATER.md) § 2) ;
   - fusionner la branche de consolidation ;
   - mettre à jour le checkout principal en préservant les données de Studio.
7. **Contenu métier** : défis, cosmétiques, récompenses ; décision Level Up V2.

## 13. Prochaine priorité

**Chaos V2, lot 0** : mesurer avant de construire, sans code.

- Couper les fenêtres permanentes.
- Fixer la fréquence de l'écran.
- Suivre le protocole PresentMon sur Overwatch.

Puis lot 1 : le lecteur natif, limité au flip, avec un bouton de test ([chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md)).
En parallèle, sur le temps d'Antoni : les derniers tests réels de Music Hub.
