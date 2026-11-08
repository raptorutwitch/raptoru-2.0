# Roadmap Raptoru 2.0

**Mise à jour le 08/11/2026** (consolidation générale). Elle remplace celle du 24–29/10, archivée dans
[archive/ROADMAP_2026-10-24_2026-10-29.md](archive/ROADMAP_2026-10-24_2026-10-29.md) : tableau d'origine, sources et
historique des arbitrages.

- Versions et environnements : [PROJECT_STATUS.md](PROJECT_STATUS.md) § 3.
- Reprise : [REPRISE.md](REPRISE.md).

**Objectif** : tout le stream piloté depuis Raptoru Studio, avec le Core comme seule vérité, et des viewers qui
interagissent par l'extension.

**Phase qui commence** : les fondations sont refaites. Côté Studio, Coulisses est en Production ; côté extension, Extension Next est prête en local. La suite porte sur l'**expérience viewer et les modules**.

## Les quatre catégories

| Catégorie        | Signification                                                                           |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Livré**        | en Production : déployé, installé ou servi                                              |
| **Développé**    | codé et testé automatiquement, pas livré                                                |
| **À valider**    | demande encore une recette d'Antoni ou une vérification réelle (live, Twitch, appareil) |
| **À développer** | pas implémenté                                                                          |

Une ligne peut cumuler plusieurs catégories, par exemple « Livré · à valider en live ».

**« Validé » = testé à la main par Antoni**, avec la date quand un document la donne. Un test automatique ne valide jamais rien.

## 1. Modules et fonctions

| Module                                                                | Catégorie                                                                         | Validé par Antoni                                                                                                            | Reste                                                                                          | Document                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet, Jetons, crédits TTS et Soundboard                             | Livré (20/10)                                                                     | —                                                                                                                            | 50 000 Jetons du bot non régularisés ; compte technique `lecroupier_` (lot 10)                 | [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)                                                                                                 |
| Daily                                                                 | Livré (paliers legacy)                                                            | —                                                                                                                            | —                                                                                              | —                                                                                                                                            |
| Fidélité (sub, bits, follow), présence                                | Livré                                                                             | —                                                                                                                            | effet réel d'un re-sub manuel non vérifié ; trou de présence après changement de bot (lot 13)  | —                                                                                                                                            |
| Commands V2                                                           | Livré (file `cmd_steps`, commandes publiques)                                     | A0→F validés en local                                                                                                        | commandes configurables dans Studio « plus tard »                                              | [COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md)                                                                                               |
| Modération D4 (extension et Studio natif)                             | Livré                                                                             | —                                                                                                                            | badges VIP et Sub, synchronisation des bans Twitch absents                                     | [moderation-v2-d4-parity.md](moderation-v2-d4-parity.md), [studio-refonte/INVENTAIRE_MODERATION.md](studio-refonte/INVENTAIRE_MODERATION.md) |
| Tombola V2 et annonce groupée                                         | Livré                                                                             | annonce groupée (23/10)                                                                                                      | Tombola V1 inaccessible (`raffle_v2` forcé) ; délai de résultat réglable reporté               | [tombola-v2-parity.md](tombola-v2-parity.md)                                                                                                 |
| Jeu des mots                                                          | Livré · à valider en live (annonce unique)                                        | —                                                                                                                            | —                                                                                              | [WORD_GAME_PARITY.md](WORD_GAME_PARITY.md)                                                                                                   |
| Roulette, Slot, Duel (chat)                                           | Livré, en live seulement                                                          | —                                                                                                                            | Duel : annonce et soldes réels non revérifiés                                                  | [ROULETTE_SLOT_PARITY.md](ROULETTE_SLOT_PARITY.md), [DUEL_PARITY.md](DUEL_PARITY.md)                                                         |
| Soundboard                                                            | Livré                                                                             | —                                                                                                                            | ajout ou remplacement d'un son bloqué dans Studio ; compactage `0bf7907` jamais vu dans Twitch | [studio-refonte/FINALISATION.md](studio-refonte/FINALISATION.md)                                                                             |
| TTS et `!tts`                                                         | Livré                                                                             | —                                                                                                                            | lecture avant la fin du reveal (dette)                                                         | —                                                                                                                                            |
| Bonk VNext                                                            | Livré                                                                             | —                                                                                                                            | lot 4 « FX rares » reporté                                                                     | [BONK_VNEXT_AUDIT_2026-10.md](BONK_VNEXT_AUDIT_2026-10.md)                                                                                   |
| Alertes Twitch V2                                                     | Livré (`ALERTS_MODE`) ; éditeur Coulisses (frise, variantes, poids)               | —                                                                                                                            | vrai don et sous-types réels non vérifiés                                                      | [TWITCH_ALERTS_PARITY_2026-10.md](TWITCH_ALERTS_PARITY_2026-10.md)                                                                           |
| Points de chaîne et effets                                            | Livré ; Récompenses refaites dans Coulisses                                       | FX Cam et Couleur Cam (18/10)                                                                                                | BRB refusé sur « Just Chatting » ; remboursements D7 ; lot 11 « unfulfilled »                  | [CHANNEL_POINTS_V1.md](CHANNEL_POINTS_V1.md), [EFFECTS_PLAYER.md](EFFECTS_PLAYER.md)                                                         |
| Random Ban V3                                                         | Livré (27/10)                                                                     | V2 (18/10)                                                                                                                   | 6 anciennes rédemptions non régularisées                                                       | [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md)                                                                                                         |
| Roue du Sub V2                                                        | Livré (26/10), invitations ON                                                     | à valider au premier live                                                                                                    | module Roue de l'extension non publié (facultatif)                                             | [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md)                                                                                         |
| Votekick V2                                                           | Livré                                                                             | partiel : votes du 23–24/10, son de lancement                                                                                | durée réglable à valider sur un vrai vote ; pas d'annulation d'un vote en cours                | [VOTEKICK_V2.md](VOTEKICK_V2.md)                                                                                                             |
| Caution                                                               | Livré                                                                             | 23/10                                                                                                                        | —                                                                                              | [CAUTION.md](CAUTION.md)                                                                                                                     |
| Spotify V2                                                            | Livré, **clos**                                                                   | 25/10                                                                                                                        | —                                                                                              | [SPOTIFY_V2.md](SPOTIFY_V2.md)                                                                                                               |
| Dock OBS                                                              | Livré (V1.2, 28/10) ; tests de Studio masqués par défaut (0.1.27)                 | V1.2 (28/10)                                                                                                                 | —                                                                                              | [OBS_DOCK.md](OBS_DOCK.md)                                                                                                                   |
| Progression (XP, niveaux, titres, badges, classements)                | Livré (29/10)                                                                     | —                                                                                                                            | état de l'interrupteur à relever dans Studio ; titres équipés depuis Studio : PR #54           | [PROGRESSION.md](PROGRESSION.md)                                                                                                             |
| Boutique cosmétique, cadres, bannières                                | Livré (30/10 et 04/11)                                                            | —                                                                                                                            | **aucun contenu définitif** : catalogue à créer par Antoni                                     | [COSMETIC_SHOP.md](COSMETIC_SHOP.md)                                                                                                         |
| Défis                                                                 | Livré, **éteint** (`CHALLENGES_ENGINE` absent, aucun défi)                        | —                                                                                                                            | catalogue et activation décidés par Antoni                                                     | [CHALLENGES.md](CHALLENGES.md)                                                                                                               |
| Statistiques de modules (privées)                                     | Livré (04/11)                                                                     | —                                                                                                                            | les rendre publiques : décision d'Antoni                                                       | [MODULE_STATS.md](MODULE_STATS.md)                                                                                                           |
| Événement Halloween et boutique d'événement                           | Livré (30/10), **fermé** le 02/11                                                 | screamers à l'écran (28/10)                                                                                                  | profil `halloween_alerts` encore actif le 02/11 ; Bonbons : voir § 3                           | [HALLOWEEN.md](HALLOWEEN.md)                                                                                                                 |
| **Studio Coulisses** (refonte, socle modulaire, Lab sur le vrai Core) | Livré (07/11, Studio 0.1.27 installé)                                             | direction D (06/11) ; recette Lab positive (07/11) ; recette d'usage en Production non écrite                                | § 2.2                                                                                          | [studio-refonte/](studio-refonte/CONTEXTE.md)                                                                                                |
| Centre de contrôle, supervision                                       | Livré (dans Coulisses)                                                            | —                                                                                                                            | lots 3–4 de la supervision (refus comptés en base, étiquettes)                                 | [CONTROL_CENTER.md](CONTROL_CENTER.md)                                                                                                       |
| **Extension Twitch, shell legacy**                                    | Livré, version servie **non prouvée** (présumée `0bf7907`)                        | —                                                                                                                            | 44 commits de `main` non publiés                                                               | [extension/PLAN_REFONTE_EXTENSION_2026-11-08.md](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md) § 12                                        |
| **Extension Next, shell v2**                                          | Développé (`feat/extension-next`, sur GitHub `2f45ac1`, non fusionné) · à valider | recette visuelle en Lab **approuvée sur le principe et le ressenti général** (Antoni, 08/11) ; pas une validation exhaustive | § 2.1                                                                                          | journal de la branche                                                                                                                        |
| Coffre mystère, Objectif de soirée                                    | Développé, **Lab seulement** (`labOnly`)                                          | —                                                                                                                            | décider s'ils deviennent de vrais modules                                                      | [studio-refonte/architecture/GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)                                                   |
| Level Up V2                                                           | Développé, PR #43 brouillon, inactif                                              | —                                                                                                                            | à activer seulement sur décision                                                               | `feat/level-up-v2`                                                                                                                           |
| Chaudron des subs                                                     | Développé, PR #47 brouillon, Lab, éteint                                          | —                                                                                                                            | —                                                                                              | `feat/halloween-cauldron`                                                                                                                    |
| viewer-web                                                            | Abandonné en pratique : le site public est raptoru.fr, dépôt séparé               | —                                                                                                                            | retirer le squelette (nettoyage)                                                               | —                                                                                                                                            |

## 2. Chantiers

### 2.1 Extension Next : jusqu'à la publication

État au 08/11 : branche `feat/extension-next` (worktree `Raptoru 2.0 - Worktrees\extension-next`), **sauvegardée sur
GitHub (`2f45ac1`), non fusionnée, non publiée**. Le shell legacy reste le défaut ; le shell v2 se sert sur demande.

| Étape                                                                                                                                                                                     | Catégorie                                                                                                                   | Qui                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Socle v2 : une entrée, une mesure, composition 651 à l'échelle, chargement à la demande, emballage verrouillé, garde « écran gris », correctifs du lot 1                                  | Développé                                                                                                                   | fait                                                                                   |
| Recette visuelle en Lab : apparence, responsive, défilement, ergonomie                                                                                                                    | **approuvée sur le principe et le ressenti général** (Antoni, 08/11) ; pas une validation de chaque vue, taille ou appareil | Antoni                                                                                 |
| Pousser la branche sur GitHub (sauvegarde)                                                                                                                                                | **fait** le 08/11 (`2f45ac1`, aucun workflow déclenché)                                                                     | —                                                                                      |
| Passe Prettier sur 17 outils de test et de développement de la branche (le CI de la future PR les vérifiera)                                                                              | à faire                                                                                                                     | agent, dans la mission de publication                                                  |
| Fusionner la branche dans `main` (le shell legacy reste le défaut)                                                                                                                        | à faire                                                                                                                     | GO d'Antoni                                                                            |
| Prouver la version servie par Twitch, corriger `PUBLISHED`                                                                                                                                | à faire                                                                                                                     | Antoni (console ou F12)                                                                |
| Inventaire des commits non publiés avec la ligne « Validé par Antoni : oui »                                                                                                              | à faire                                                                                                                     | Antoni                                                                                 |
| Décisions du plan § 13 : publication du lot 1, interrupteur de retour arrière sans review, retraits du lot 6                                                                              | à décider                                                                                                                   | Antoni                                                                                 |
| Hosted Test : zip **staging** v2 ; PC à 65 % avec les zooms 100–150 %, théâtre, plein écran ; iPhone et Android ; bloqueurs ; moderateur et viewer                                        | à valider                                                                                                                   | Antoni (procédure sur la branche : `docs/extension/EXTENSION_NEXT_PUBLICATION.md` § 3) |
| Soumission à Twitch du zip de Production (`--shell v2`, legacy en repli) ; review de 8 à 14 jours, une seule soumission                                                                   | à faire                                                                                                                     | GO et action d'Antoni                                                                  |
| Après au moins 2 semaines stables : lot 6, nettoyage du legacy                                                                                                                            | à développer                                                                                                                | sur accord                                                                             |
| Restes non bloquants : Hub à 377×251 qui défile d'environ 15 px, TTS en mobile paysage en deux colonnes, bande « Vider » du Bonk (15 px), Coffre sur `createPoller`, vues dans `modules/` | à développer                                                                                                                | agent                                                                                  |

### 2.2 Studio Coulisses

**Opérationnel en Production** : six destinations et le Laboratoire, pages des modules sur le socle, modération
native, Récompenses refaites, éditeur d'alertes, Dock, simulations du Lab, « Ne plus demander » pour les tests sur le stream.

| Sujet                                                                                                                                                             | Catégorie                       | Détail                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Recette d'usage de 0.1.26 et 0.1.27 en Production                                                                                                                 | à valider                       | aucune trace écrite ([OPERATION_COULISSES.md](studio-refonte/OPERATION_COULISSES.md) § 12)                 |
| Lots F3 (Helix, P2-9), F4 (relance au passage en live), F5 (P1-6, P1-8), F7 (session live unique, variables d'environnement en plafonds)                          | à développer                    | [studio-refonte/ROADMAP.md](studio-refonte/ROADMAP.md)                                                     |
| H10 : Caution, Votekick, mini-jeux, Duel sur le socle                                                                                                             | partiel, documents en désaccord | [CONTEXTE.md](studio-refonte/CONTEXTE.md) § 18                                                             |
| Retrait de l'ancien Lab (`studio:legacy`)                                                                                                                         | à décider (choix A ou B)        | [RETRAIT_ANCIEN_LAB.md](studio-refonte/RETRAIT_ANCIEN_LAB.md)                                              |
| Code mort `moderation.ts`, `moderation.css`, `tts-config.ts`                                                                                                      | à décider                       | [PARITE.md](studio-refonte/PARITE.md)                                                                      |
| Ajout ou remplacement d'un son du Soundboard ; Supermod pour un membre jamais vu ; Modération à 1024 px ; médias Halloween dans le Lab ; badge « Lead Moderator » | à développer ou à décider       | [FINALISATION.md](studio-refonte/FINALISATION.md)                                                          |
| Arbitrages encore ouverts de la parité                                                                                                                            | à décider                       | [parite/admin.md](studio-refonte/parite/admin.md) § 6, [parite/direct.md](studio-refonte/parite/direct.md) |
| Réglages `strictObject` avec le même risque de retour arrière que `weights`                                                                                       | à auditer                       | [LIVRAISON.md](studio-refonte/LIVRAISON.md) § 9                                                            |
| E2E instables (`tombola-bonbons`, `effects-player`, `alerts`, `progression-studio`, arrêt de la pile E2E)                                                         | à corriger                      | chantier dédié                                                                                             |

### 2.3 Branches non fusionnées

Triage détaillé des PR ouvertes, avec recommandations : [CLEANUP_LATER.md](CLEANUP_LATER.md) § 2. Carte des worktrees : [WORKSPACES.md](WORKSPACES.md).

| Branche                                                                                        | Contenu                                                           | État                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `feat/extension-next`                                                                          | Extension Next                                                    | voir § 2.1                                                                                                                      |
| `feat/extension-next-packaging`                                                                | emballage verrouillé                                              | **déjà fusionné** dans `feat/extension-next` (`d021b47`)                                                                        |
| `feat/studio-viewer-titles` (PR #54)                                                           | titres équipés depuis Studio                                      | commit local `5d24614` au-dessus de la PR                                                                                       |
| `feat/level-up-v2` (PR #43), `feat/halloween-cauldron` (PR #47), `feat/cosmetic-shop` (PR #44) | brouillons                                                        | la boutique est livrée par une autre PR ; les deux autres attendent une décision                                                |
| `docs/*` (PR #34, #36, #38, #40, #48)                                                          | anciens documents de livraison                                    | contenu repris ou dépassé par cette consolidation : à fermer ou fusionner                                                       |
| `docs/consolidation-2026-11`                                                                   | consolidation (base `3834d6b` : documents d'audit de l'extension) | **fusionnée dans `main`** par sa PR documentaire (opération « Final Freeze », 08/11) ; la branche peut être supprimée plus tard |

## 3. Héritage et dettes (toujours ouverts)

- **Plan post-live** ([PLAN_POST_LIVE_2026-10-21.md](PLAN_POST_LIVE_2026-10-21.md)) : lots 5, 7, 8, 10, 11, 13 et A7 notés
  « non faits » au 26/10. Coulisses en couvre peut-être une partie, par exemple « Prêt pour le live » pour le lot 5 :
  à revérifier avant de les reprendre.
- **Fonctions SAMMI jamais reprises** : banque, 24H et crédits (`!code`, `!echange`), `!cashin`, `!blacklist` et
  `!whitelist`, commandes viewer avec son (`!sniper`, `!groslot`…), Oracle, Led couleur, Emote only, level up WizeBot.
  Le level up WizeBot est remplacé par la progression native. Aucun ordre décidé ; inventaire dans
  [../Raptoru-2.0-ETAT-PROJET.md](../Raptoru-2.0-ETAT-PROJET.md) § 0.5b.
- **Monnaies du Wallet et gestionnaire d'événements** (décidé le 29/10, pour après Halloween ; aucun avancement écrit depuis) :
  1. interrupteur « Monnaie Bonbons » indépendant de Halloween ;
  2. Bonbons dans le Wallet canonique ;
  3. interactions payables en plusieurs monnaies, puis module Événements générique.

  Détail dans [archive/ROADMAP_2026-10-24_2026-10-29.md](archive/ROADMAP_2026-10-24_2026-10-29.md), « Évolution produit future ».

- **Incident Twitch et extension du 22/10** : phase A faite, cause non établie, phase B non commencée.
- **Bot** : durcissements F3–F9 (INC C7).
- **Staging** : branche et version de Node à décider.
- **Idées P3** de l'audit Studio : profils de stream, saisons réutilisables, catalogue du Soundboard en données,
  historique unifié, aperçu de la courbe d'XP ([studio-refonte/AUDIT_FONCTIONNEL.md](studio-refonte/AUDIT_FONCTIONNEL.md)).

## 4. Prochaine phase : les modules et l'expérience viewer

**« Maintenant que Studio Coulisses et Extension Next sont reconstruits, que développe-t-on ensuite ? »**

Les fondations sont terminées : Core et bot en Production, Studio Coulisses en Production, Extension Next développée,
documentation consolidée, branches sauvegardées. La suite vise l'**expérience viewer** et des **modules plus riches**.
Le chat reste un complément.

**Ce qui reste avant la publication Twitch** forme une mission distincte, sur GO, à ne pas mélanger avec les modules :
preuve de la version servie, comparaison des commits accumulés, zip candidat, Hosted Test, vrais appareils, fonctions
sensibles, décision, retour arrière (§ 2.1).

### 4.1 Contraintes communes

- Le **Core décide** des débits, des tirages et des résultats ; une vue ne fait que jouer l'animation d'un résultat reçu.
- Les Jetons n'ont **aucune valeur monétaire**, ne s'achètent pas avec des Bits et ne s'échangent pas contre de l'argent.
- Aucun jeu de hasard réel n'est présumé autorisé : avant d'être ouverte, chaque mécanique de mise est relue par Antoni
  au regard des règles de Twitch sur les jeux de hasard virtuels.
- Partager un résultat dans le chat se fait par un bouton explicite (le bot, via le Core), **jamais automatiquement**.
- Un nouveau module se construit sur les deux socles :
  - un fichier de module dans le Core ([GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)) ;
  - un module de session de l'extension v2 (recette `docs/extension/SOCLE.md` § 4.1 sur `feat/extension-next`, modèle
    `extension/lab-modules/demo`).
- Ces pistes sont des **intentions**, pas des spécifications : chaque mission commence par fixer le besoin (§ 4.4).

### 4.2 Les pistes, dans l'ordre recommandé

**1. Passe ciblée sur les modules existants**

- **Intention** : rendre plus lisibles, plus vivants et plus agréables les modules déjà utilisés en live.
- **Intérêt pour les viewers** : un bénéfice immédiat, sur ce qu'ils utilisent déjà, sans nouvelle règle économique.
- **Périmètre probable** : 2 ou 3 modules choisis par Antoni parmi Bonk, Soundboard, TTS, Tombola, Roue du Sub,
  l'historique et la modération (côté Studio et côté extension).
  - Retours visuels et sonores, animations, ergonomie, historique, personnalisation.
  - Les limites connues : ajout d'un son du Soundboard bloqué, TTS en mobile paysage, délai de résultat de la Tombola…
- **Dépendances** : socle v2 (la publication d'Extension Next peut avancer en parallèle, mais une amélioration
  d'extension n'atteint les viewers qu'après elle) ; recette d'Antoni.
- **Statut** : à développer.
- **Décisions ouvertes** : quels modules ; quelles attentes précises pour chacun.

**2. Roulette visuelle dans l'extension**

- **Intention** : un premier jeu « vitrine » : mise en Jetons, rouge ou noir, animation, résultat du serveur, partage
  facultatif dans le chat.
- **Intérêt pour les viewers** : une interaction visuelle forte, plus riche qu'une commande de chat.
- **Périmètre probable** :
  - la logique existe dans le Core (Roulette du chat, `mini-games`), le résultat y reste calculé ;
  - un module de session dans l'extension ;
  - une animation ;
  - un journal et une modération.
- **Dépendances** : socle v2 publié ; règles de conformité fixées une fois pour toutes ; art et animation.
- **Statut** : à développer. Décidé : « jeu solo, résultat Core, partage par bouton » (plan de l'extension § 14).
- **Décisions ouvertes** : mises minimale et maximale, gains, cooldowns, limites par viewer, ouverture hors live, conformité.

**3. Slot visuel**

- **Intention** : une machine à sous plus qualitative (rouleaux, animations, retours visuels).
- **Intérêt pour les viewers** : la même famille de plaisir que la Roulette, avec plus de mise en scène.
- **Périmètre probable** : comme la Roulette, avec plusieurs états d'animation ; le Slot du chat existe déjà dans le Core.
- **Dépendances** : la Roulette, dont il réutilise le cadre, les règles et la modération.
- **Statut** : à développer.
- **Décisions ouvertes** : table de gains, récompenses virtuelles, rythme.

**4. Fonctions sociales et multijoueurs : le socle temps réel**

- **Intention** : voir, rejoindre et interagir avec d'autres viewers en direct.
- **Intérêt pour les viewers** : une expérience collective pendant le live.
- **Périmètre probable** : un **chantier Core** de sessions, tours, synchronisation et diffusion. Le poll à 5 s ne
  suffit pas. Il faut aussi gérer la reconnexion et l'abandon, et ajouter une source « en direct » dans l'extension.
- **Dépendances** : socle v2 publié ; modèle de données des sessions ; charge et coût de la diffusion.
- **Statut** : à concevoir. Décidé : « demandera un chantier Core » (plan § 14).
- **Décisions ouvertes** : tout le produit.

**5. Blackjack et mode spectateur**

- **Intention** : un jeu à tables, avec actions, tours, participants et spectateurs.
- **Intérêt pour les viewers** : un rendez-vous social pendant le live.
- **Périmètre probable** : premier jeu sur le socle temps réel (piste 4).
- **Dépendances** : la piste 4.
- **Statut** : idée.
- **Décisions ouvertes** : tables, mises, nombre de joueurs, rôle des spectateurs, conformité.

**Transversal : passer des commandes du chat dans l'extension**

- **Intention** : offrir une interface quand une commande y gagne.
- **Périmètre** : une commande à la fois, dans une mission de module ; le chat reste disponible.
- **Statut** : aucune décision écrite.

### 4.3 Prochaine mission proposée

**« Passe expérience sur 2 ou 3 modules existants »** (piste 1), en un lot vertical, en Lab.

- **Pourquoi elle d'abord** :
  - elle apporte de la valeur visible aux viewers sans nouvelle règle économique ni question de conformité ;
  - elle éprouve les deux socles neufs sur du réel ;
  - elle peut avancer pendant que la publication d'Extension Next suit sa propre mission.
- **Ce qu'Antoni fournit au départ** : les modules choisis, avec, pour chacun, ce qui le gêne aujourd'hui et le résultat
  attendu.
- **Livrable** : les modules améliorés dans Studio et dans l'extension v2, des tests, une recette courte et un journal de
  reprise. Rien en Production.
- **Ensuite** : la mission « Roulette visuelle ». Elle commencera par une courte décision sur les règles de mise et la
  conformité.

### 4.4 Méthode des prochaines missions (décidée par Antoni)

1. Définir clairement le besoin.
2. Examiner les contraintes pertinentes, sans refaire un audit si l'information existe déjà.
3. Choisir la direction.
4. Antoni donne un **GO global de développement local**.
5. L'agent travaille en autonomie : décisions techniques, corrections de bugs, tests, commits locaux, journal. Il ne
   s'interrompt pas pour demander s'il peut corriger un bug ou un détail.
6. Il teste et corrige.
7. Il présente un résultat concret.
8. Antoni fait la recette.
9. La mise en Production se prépare **séparément**, sur un GO dédié. L'autonomie ne donne jamais le droit de toucher la
   Production.

## 5. Décisions enregistrées (toujours en vigueur)

- SAMMI ne doit jamais être réactivé. StreamElements garde les dons et l'affichage du chat ; ses points sont gelés.
- Votekick :
  - design legacy pour l'instant, variante D interdite ;
  - micro du streamer = « Micro » ;
  - Audio Move conservé ;
  - « LeCroupier_ peut voter » laissé.
- Caution : décisions 1 à 3 du 23/10 ([CAUTION.md](CAUTION.md) § 8) ; incident des 10 000 Jetons : pas de remboursement.
- Plan post-live : décisions A1 à A9 du 21/10 ([PLAN_POST_LIVE_2026-10-21.md](PLAN_POST_LIVE_2026-10-21.md) § 2).
- Roue V2 :
  - R7 en détection seule ;
  - R3b et R5 interdits ;
  - invitations ON ;
  - récupération des doubles crédits OFF.
- Tarifs (22/10) : `!rb` 25 000 Jetons, `!fxcam` 1 500 Jetons.
- Studio : décisions H1 à H16 (05/11, [CONTEXTE.md](studio-refonte/CONTEXTE.md) § 18) et D1 à D32
  ([architecture/DECISIONS.md](studio-refonte/architecture/DECISIONS.md)) ; direction D (06/11).
- Extension : 651 × 434 comme référence, réglage à 65 % ; décisions du 08/11
  ([extension/PLAN_REFONTE_EXTENSION_2026-11-08.md](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md)).
- Pas de push, de fusion, de déploiement, de release Studio ni de publication Twitch sans GO explicite d'Antoni.
- Méthode des missions : § 4.4.
