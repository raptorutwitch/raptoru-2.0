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

| Module                                                                | Catégorie                                                           | Validé par Antoni                                                                             | Reste                                                                                          | Document                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet, Jetons, crédits TTS et Soundboard                             | Livré (20/10)                                                       | —                                                                                             | 50 000 Jetons du bot non régularisés ; compte technique `lecroupier_` (lot 10)                 | [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)                                                                                                 |
| Daily                                                                 | Livré (paliers legacy)                                              | —                                                                                             | —                                                                                              | —                                                                                                                                            |
| Fidélité (sub, bits, follow), présence                                | Livré                                                               | —                                                                                             | effet réel d'un re-sub manuel non vérifié ; trou de présence après changement de bot (lot 13)  | —                                                                                                                                            |
| Commands V2                                                           | Livré (file `cmd_steps`, commandes publiques)                       | A0→F validés en local                                                                         | commandes configurables dans Studio « plus tard »                                              | [COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md)                                                                                               |
| Modération D4 (extension et Studio natif)                             | Livré                                                               | —                                                                                             | badges VIP et Sub, synchronisation des bans Twitch absents                                     | [moderation-v2-d4-parity.md](moderation-v2-d4-parity.md), [studio-refonte/INVENTAIRE_MODERATION.md](studio-refonte/INVENTAIRE_MODERATION.md) |
| Tombola V2 et annonce groupée                                         | Livré                                                               | annonce groupée (23/10)                                                                       | Tombola V1 inaccessible (`raffle_v2` forcé) ; délai de résultat réglable reporté               | [tombola-v2-parity.md](tombola-v2-parity.md)                                                                                                 |
| Jeu des mots                                                          | Livré · à valider en live (annonce unique)                          | —                                                                                             | —                                                                                              | [WORD_GAME_PARITY.md](WORD_GAME_PARITY.md)                                                                                                   |
| Roulette, Slot, Duel (chat)                                           | Livré, en live seulement                                            | —                                                                                             | Duel : annonce et soldes réels non revérifiés                                                  | [ROULETTE_SLOT_PARITY.md](ROULETTE_SLOT_PARITY.md), [DUEL_PARITY.md](DUEL_PARITY.md)                                                         |
| Soundboard                                                            | Livré                                                               | —                                                                                             | ajout ou remplacement d'un son bloqué dans Studio ; compactage `0bf7907` jamais vu dans Twitch | [studio-refonte/FINALISATION.md](studio-refonte/FINALISATION.md)                                                                             |
| TTS et `!tts`                                                         | Livré                                                               | —                                                                                             | lecture avant la fin du reveal (dette)                                                         | —                                                                                                                                            |
| Bonk VNext                                                            | Livré                                                               | —                                                                                             | lot 4 « FX rares » reporté                                                                     | [BONK_VNEXT_AUDIT_2026-10.md](BONK_VNEXT_AUDIT_2026-10.md)                                                                                   |
| Alertes Twitch V2                                                     | Livré (`ALERTS_MODE`) ; éditeur Coulisses (frise, variantes, poids) | —                                                                                             | vrai don et sous-types réels non vérifiés                                                      | [TWITCH_ALERTS_PARITY_2026-10.md](TWITCH_ALERTS_PARITY_2026-10.md)                                                                           |
| Points de chaîne et effets                                            | Livré ; Récompenses refaites dans Coulisses                         | FX Cam et Couleur Cam (18/10)                                                                 | BRB refusé sur « Just Chatting » ; remboursements D7 ; lot 11 « unfulfilled »                  | [CHANNEL_POINTS_V1.md](CHANNEL_POINTS_V1.md), [EFFECTS_PLAYER.md](EFFECTS_PLAYER.md)                                                         |
| Random Ban V3                                                         | Livré (27/10)                                                       | V2 (18/10)                                                                                    | 6 anciennes rédemptions non régularisées                                                       | [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md)                                                                                                         |
| Roue du Sub V2                                                        | Livré (26/10), invitations ON                                       | à valider au premier live                                                                     | module Roue de l'extension non publié (facultatif)                                             | [SUB_WHEEL_V2_DELIVERY.md](SUB_WHEEL_V2_DELIVERY.md)                                                                                         |
| Votekick V2                                                           | Livré                                                               | partiel : votes du 23–24/10, son de lancement                                                 | durée réglable à valider sur un vrai vote ; pas d'annulation d'un vote en cours                | [VOTEKICK_V2.md](VOTEKICK_V2.md)                                                                                                             |
| Caution                                                               | Livré                                                               | 23/10                                                                                         | —                                                                                              | [CAUTION.md](CAUTION.md)                                                                                                                     |
| Spotify V2                                                            | Livré, **clos**                                                     | 25/10                                                                                         | —                                                                                              | [SPOTIFY_V2.md](SPOTIFY_V2.md)                                                                                                               |
| Dock OBS                                                              | Livré (V1.2, 28/10) ; tests de Studio masqués par défaut (0.1.27)   | V1.2 (28/10)                                                                                  | —                                                                                              | [OBS_DOCK.md](OBS_DOCK.md)                                                                                                                   |
| Progression (XP, niveaux, titres, badges, classements)                | Livré (29/10)                                                       | —                                                                                             | état de l'interrupteur à relever dans Studio ; titres équipés depuis Studio : PR #54           | [PROGRESSION.md](PROGRESSION.md)                                                                                                             |
| Boutique cosmétique, cadres, bannières                                | Livré (30/10 et 04/11)                                              | —                                                                                             | **aucun contenu définitif** : catalogue à créer par Antoni                                     | [COSMETIC_SHOP.md](COSMETIC_SHOP.md)                                                                                                         |
| Défis                                                                 | Livré, **éteint** (`CHALLENGES_ENGINE` absent, aucun défi)          | —                                                                                             | catalogue et activation décidés par Antoni                                                     | [CHALLENGES.md](CHALLENGES.md)                                                                                                               |
| Statistiques de modules (privées)                                     | Livré (04/11)                                                       | —                                                                                             | les rendre publiques : décision d'Antoni                                                       | [MODULE_STATS.md](MODULE_STATS.md)                                                                                                           |
| Événement Halloween et boutique d'événement                           | Livré (30/10), **fermé** le 02/11                                   | screamers à l'écran (28/10)                                                                   | profil `halloween_alerts` encore actif le 02/11 ; Bonbons : voir § 3                           | [HALLOWEEN.md](HALLOWEEN.md)                                                                                                                 |
| **Studio Coulisses** (refonte, socle modulaire, Lab sur le vrai Core) | Livré (07/11, Studio 0.1.27 installé)                               | direction D (06/11) ; recette Lab positive (07/11) ; recette d'usage en Production non écrite | § 2.2                                                                                          | [studio-refonte/](studio-refonte/CONTEXTE.md)                                                                                                |
| Centre de contrôle, supervision                                       | Livré (dans Coulisses)                                              | —                                                                                             | lots 3–4 de la supervision (refus comptés en base, étiquettes)                                 | [CONTROL_CENTER.md](CONTROL_CENTER.md)                                                                                                       |
| **Extension Twitch, shell legacy**                                    | Livré, version servie **non prouvée** (présumée `0bf7907`)          | —                                                                                             | 44 commits de `main` non publiés                                                               | [extension/PLAN_REFONTE_EXTENSION_2026-11-08.md](extension/PLAN_REFONTE_EXTENSION_2026-11-08.md) § 12                                        |
| **Extension Next, shell v2**                                          | Développé (`feat/extension-next`, 08/11) · à valider                | recette visuelle Lab : retour très positif (08/11)                                            | § 2.1                                                                                          | journal de la branche                                                                                                                        |
| Coffre mystère, Objectif de soirée                                    | Développé, **Lab seulement** (`labOnly`)                            | —                                                                                             | décider s'ils deviennent de vrais modules                                                      | [studio-refonte/architecture/GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)                                                   |
| Level Up V2                                                           | Développé, PR #43 brouillon, inactif                                | —                                                                                             | à activer seulement sur décision                                                               | `feat/level-up-v2`                                                                                                                           |
| Chaudron des subs                                                     | Développé, PR #47 brouillon, Lab, éteint                            | —                                                                                             | —                                                                                              | `feat/halloween-cauldron`                                                                                                                    |
| viewer-web                                                            | Abandonné en pratique : le site public est raptoru.fr, dépôt séparé | —                                                                                             | retirer le squelette (nettoyage)                                                               | —                                                                                                                                            |

## 2. Chantiers

### 2.1 Extension Next : jusqu'à la publication

État au 08/11 : branche locale `feat/extension-next` (worktree `Raptoru 2.0 - Worktrees\extension-next`), **non poussée,
non fusionnée, non publiée**. Le shell legacy reste le défaut ; le shell v2 se sert sur demande.

| Étape                                                                                                                                                                                     | Catégorie                                        | Qui                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Socle v2 : une entrée, une mesure, composition 651 à l'échelle, chargement à la demande, emballage verrouillé, garde « écran gris », correctifs du lot 1                                  | Développé                                        | fait                                                                                   |
| Recette visuelle en Lab : apparence, responsive, défilement, ergonomie                                                                                                                    | à valider · retour très positif d'Antoni (08/11) | Antoni                                                                                 |
| Pousser la branche (sauvegarde) et la fusionner dans `main`                                                                                                                               | à faire                                          | GO d'Antoni                                                                            |
| Prouver la version servie par Twitch, corriger `PUBLISHED`                                                                                                                                | à faire                                          | Antoni (console ou F12)                                                                |
| Inventaire des commits non publiés avec la ligne « Validé par Antoni : oui »                                                                                                              | à faire                                          | Antoni                                                                                 |
| Décisions du plan § 13 : publication du lot 1, interrupteur de retour arrière sans review, retraits du lot 6                                                                              | à décider                                        | Antoni                                                                                 |
| Hosted Test : zip **staging** v2 ; PC à 65 % avec les zooms 100–150 %, théâtre, plein écran ; iPhone et Android ; bloqueurs ; moderateur et viewer                                        | à valider                                        | Antoni (procédure sur la branche : `docs/extension/EXTENSION_NEXT_PUBLICATION.md` § 3) |
| Soumission à Twitch du zip de Production (`--shell v2`, legacy en repli) ; review de 8 à 14 jours, une seule soumission                                                                   | à faire                                          | GO et action d'Antoni                                                                  |
| Après au moins 2 semaines stables : lot 6, nettoyage du legacy                                                                                                                            | à développer                                     | sur accord                                                                             |
| Restes non bloquants : Hub à 377×251 qui défile d'environ 15 px, TTS en mobile paysage en deux colonnes, bande « Vider » du Bonk (15 px), Coffre sur `createPoller`, vues dans `modules/` | à développer                                     | agent                                                                                  |

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

| Branche                                                                                        | Contenu                                                                 | État                                                                             |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `feat/extension-next`                                                                          | Extension Next                                                          | voir § 2.1                                                                       |
| `feat/extension-next-packaging`                                                                | emballage verrouillé                                                    | **déjà fusionné** dans `feat/extension-next` (`d021b47`)                         |
| `feat/studio-viewer-titles` (PR #54)                                                           | titres équipés depuis Studio                                            | commit local `5d24614` au-dessus de la PR                                        |
| `feat/level-up-v2` (PR #43), `feat/halloween-cauldron` (PR #47), `feat/cosmetic-shop` (PR #44) | brouillons                                                              | la boutique est livrée par une autre PR ; les deux autres attendent une décision |
| `docs/*` (PR #34, #36, #38, #40, #48)                                                          | anciens documents de livraison                                          | contenu repris ou dépassé par cette consolidation : à fermer ou fusionner        |
| `docs/consolidation-2026-11`                                                                   | cette consolidation (base `3834d6b` : documents d'audit de l'extension) | à fusionner sur GO                                                               |

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

## 4. Prochaines fonctionnalités : recommandation

**Direction (Antoni, 08/11)** : les fondations sont faites ; la suite vise l'**expérience viewer** et des **modules plus
riches**. Le chat reste un complément.

**Contraintes fixes**

- Le **Core décide** des débits, des tirages et des résultats ; une vue ne fait que jouer l'animation d'un résultat reçu.
- Les Jetons n'ont **aucune valeur monétaire**, ne s'achètent pas avec des Bits et ne s'échangent pas contre de l'argent.
- Aucun jeu de hasard réel n'est présumé autorisé : chaque mécanique de mise sera relue par Antoni au regard des règles
  Twitch avant d'être ouverte.
- Partager un résultat dans le chat se fait par un bouton explicite (bot via le Core), **jamais automatiquement**.
- Un nouveau module se construit sur les deux socles : un fichier de module dans le Core
  ([GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)) et un module de session de l'extension v2 (recette
  `docs/extension/SOCLE.md` § 4.1 sur la branche, modèle `extension/lab-modules/demo`).

| Idée                                                                                                                   | Ce qui existe                                                                                             | Dépendances et difficultés                                                                                                                               | Décidé                                                      | Encore ouvert                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| **Améliorer les modules existants** (lisibilité, retours visuels et sonores, historique, personnalisation, modération) | tous les modules ; nouveau socle                                                                          | peu de travail côté Core ; surtout de l'ergonomie, de l'art et des tests                                                                                 | direction générale                                          | quels modules en premier                                            |
| **Commandes de chat dans l'extension**                                                                                 | la page « Commandes » liste les commandes publiques ; le chat achète exactement ce que l'extension achète | chaque commande devient une action de module (socle) ; garder le chat en complément                                                                      | aucune décision écrite                                      | lesquelles, et sous quelle forme                                    |
| **Roulette visuelle** (mise, rouge ou noir, animation, partage facultatif)                                             | Roulette et Slot existent **dans le chat** (Core `mini-games`)                                            | jeu solo à résultat immédiat : le socle le permet sans le toucher ; le gros du travail est l'art et l'animation ; le tirage reste dans le Core           | « jeu solo, résultat Core, partage par bouton » (plan § 14) | règles de mise et limites, gains, cooldowns, conformité Twitch      |
| **Slot visuel**                                                                                                        | idem                                                                                                      | idem ; plusieurs états d'animation                                                                                                                       | idem                                                        | table de gains, récompenses virtuelles                              |
| **Blackjack multijoueur, spectateurs**                                                                                 | rien                                                                                                      | **chantier Core** : sessions, tours, synchronisation et diffusion (pas de poll à 5 s), reconnexion, abandon ; dans l'extension, une source « en direct » | « demandera un chantier Core » (plan § 14)                  | tout le produit : tables, mises, nombre de joueurs, mode spectateur |
| **Expériences sociales** (regarder, rejoindre, interagir)                                                              | rien                                                                                                      | même chantier de sessions que le Blackjack                                                                                                               | —                                                           | tout                                                                |

**Ordre recommandé**, des fonctionnalités verticales utilisables en live à chaque étape plutôt que des micro-lots :

1. **Publier Extension Next** (§ 2.1). C'est le prérequis de tout le reste côté viewers.
2. **Une passe « expérience » sur 2 ou 3 modules existants très utilisés**, au choix d'Antoni : TTS, Soundboard,
   Tombola, Bonk. Cela apporte de la valeur tout de suite et éprouve le socle sur du réel, sans risque économique nouveau.
3. **Roulette visuelle dans l'extension**, premier jeu « vitrine ». Elle réutilise la logique Core existante, ne demande
   pas de multijoueur et oblige à fixer les règles de conformité une fois pour toutes. Le **Slot** suit ensuite,
   avec la même mécanique.
4. **Commandes de chat vers l'extension**, une par une, quand une commande gagne à avoir une interface.
5. **Socle temps réel du Core** (sessions, diffusion, reconnexion), conçu une fois, puis le **Blackjack** et le mode
   spectateur dessus. C'est le plus gros chantier : à lancer quand les étapes 1 à 3 sont stables.

**Décisions produit encore ouvertes pour Antoni**

- choix des premiers modules à enrichir ;
- règles de mise et de gain de la Roulette et du Slot ;
- validation de conformité Twitch des mécaniques de mise ;
- périmètre du multijoueur ;
- quelles commandes passent dans l'extension.

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
- Méthode : un audit sérieux quand c'est nécessaire, puis de larges lots autonomes ([PROJECT_STATUS.md](PROJECT_STATUS.md) § 10).
