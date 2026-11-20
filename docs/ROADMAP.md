# Roadmap Raptoru 2.0

**Mise à jour le 20/11/2026** (checkpoint global : Casino V1, restauration des niveaux, extension `be1744e75f63`
publique). Versions précédentes : [archive/ROADMAP_2026-11-15.md](archive/ROADMAP_2026-11-15.md),
[archive/ROADMAP_2026-11-08.md](archive/ROADMAP_2026-11-08.md),
[archive/ROADMAP_2026-10-24_2026-10-29.md](archive/ROADMAP_2026-10-24_2026-10-29.md).

Point d'entrée : [REPRISE.md](REPRISE.md). Versions en service : [PROJECT_STATUS.md](PROJECT_STATUS.md) § 3. Code de
chaque module : [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).

**Objectif** : tout le stream piloté depuis Raptoru Studio, avec le Core comme seule vérité, et des viewers qui
interagissent par l'extension.

**Les états ne se confondent pas** : développé (code sur `main`) → testé (tests automatiques) → déployé (Core / bot) →
publié (Studio en release, extension approuvée par Twitch) → **validé** (testé à la main par Antoni) → **testé en
live**. Un Hosted Test n'est pas une publication ; une CI verte ne valide rien.

## 0. Vue d'ensemble (20/11)

### 0.1 À faire maintenant (ordre réel)

1. **Casino V1 jusqu'au public** (détail : [REPRISE.md](REPRISE.md) § 5.4) : Hosted Test hors live sur un compte
   testeur (Antoni) → choix de l'accès à la publication (`CASINO_EXTENSION=testers:<ids>` recommandé, ou `on`) →
   soumission à la revue Twitch → publication, `PUBLISHED` mis à jour → essai réel en live (mises, gains,
   remboursements, spectateurs, blackjack à plusieurs) → corrections des seuls problèmes observés.
2. Studio 0.1.42 : **fait** (installé, relevé le 20/11).

### 0.2 Ensuite (déjà décidé ou demandé)

1. **Chaos V2, lot 0** (mesures, sans code), puis lot 1 (lecteur natif, flip seul) : § 2.0. Priorité majeure décidée
   le 10/11, non commencée.
2. **Validations réelles en attente** (temps d'Antoni, en live) : premier vrai tirage de la Roue du Sub V3 ; « Envoyer
   une vraie annonce test » de Level Up ; commande d'Aouh (expressions, latence, édition déléguée) ; parcours viewer de
   Music Hub ; effets OBS après OBS 33.
3. **Studio, finitions** : § 2.2.
4. **Dettes et héritage** : § 3.

### 0.3 Vue par état

| État                                                    | Travaux                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Validé par Antoni** (trace écrite)                    | Spotify V2 (25/10) · Dock OBS V1.2 (28/10) · Caution (23/10) · Random Ban V2 (18/10) · FX Cam et Couleur Cam (18/10) · annonce groupée de la Tombola (23/10) · Commands V2 A0→F (en local) · direction D de Studio (06/11) · les 4 jeux du Casino en prototype (20/11, avant intégration) |
| **En Production, public, validation réelle restante**   | extension `be1744e75f63` (Level Up V2 et son interrupteur de son, mini-profil, Commandes V2.1 « Mes commandes modifiables », Mini-jeux V5, Music Hub) · Roue du Sub V3 · progression restaurée · Studio 0.1.42                                                                            |
| **Déployé côté Core, pas encore public**                | **Casino V1** : ZIP `2e2eaf3ae34a` en Hosted Test, revue Twitch à faire                                                                                                                                                                                                                   |
| **Étudié, prêt à implémenter**                          | Chaos V2 lots 0 et 1 ([chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md))                                                                                                                                                                                                             |
| **Backlog**                                             | finitions Studio (§ 2.2) · dettes (§ 3) · idées XP et modules (§ 4)                                                                                                                                                                                                                       |
| **Bloqué par du contenu d'Antoni**                      | Défis (catalogue) · cosmétiques (catalogue vide)                                                                                                                                                                                                                                          |
| **En pause ou suspendu** (ne pas relancer sans demande) | § 6                                                                                                                                                                                                                                                                                       |
| **Abandonné**                                           | SAMMI · `apps/viewer-web` (le site est raptoru.fr) · Chaos V1 comme base de Chaos V2 · variante D de l'overlay Votekick                                                                                                                                                                   |

## 1. Modules

Colonnes : état réel · ce qui reste · document. « Public » = dans l'extension publiée `be1744e75f63` ou dans le chat.

| Module                                                                                                              | État au 20/11                                                                                                                                                                                                               | Reste                                                                                                                                                 | Document                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Core API et infrastructure**                                                                                      | En Production : Core `1f05b97c` sur Coolify (VPS), PostgreSQL 17, sauvegarde quotidienne + manuelle avant opération, déploiement par `scripts/coolify-deploy.mjs` ou GitHub Actions, CI sur chaque PR                       | copies de la base hors VPS seulement manuelles ; secret GitHub `COOLIFY_URL` à vérifier ; staging non revérifié                                       | [ARCHITECTURE.md](ARCHITECTURE.md), [OPERATIONS.md](OPERATIONS.md), [CICD.md](CICD.md), [BACKUPS.md](BACKUPS.md)                         |
| **Bot LeCroupier_** (opérationnel)                                                                                  | En Production `2c04a5db` : EventSub, chat, bail unique (un seul bot actif), exécuteurs Random Ban, messages des modules                                                                                                     | durcissements F3–F9 ; trou de présence après changement de bot (lot 13)                                                                               | [BOT_VPS_CUTOVER.md](BOT_VPS_CUTOVER.md)                                                                                                 |
| **Raptoru Studio « Coulisses »** (configuration, pilotage)                                                          | 0.1.42 publié et installé ; pages de chaque module, Lab isolé, Centre de contrôle et supervision                                                                                                                            | finitions § 2.2 ; recette d'usage en Production non écrite                                                                                            | [studio-refonte/CONTEXTE.md](studio-refonte/CONTEXTE.md), [CONTROL_CENTER.md](CONTROL_CENTER.md)                                         |
| **Pont Studio ↔ outils** (OBS WebSocket, Spotify, Windows SMTC, Dock)                                               | En Production : Studio pilote OBS 33.0.1, lit Spotify et SMTC, Dock OBS V1.2 validé                                                                                                                                         | suivi des plugins OBS à chaque mise à jour ; source `Navigateur web 2` (ancienne clé TTS, O10)                                                        | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md), [OBS_DOCK.md](OBS_DOCK.md)                                                                 |
| **Extension Twitch** (shell v2 : panneau, overlay, mobile)                                                          | **Public `be1744e75f63`** (prouvé le 20/11) ; Casino en Hosted Test (`2e2eaf3ae34a`)                                                                                                                                        | Casino : § 0.1 ; vrais appareils (PC à 65 %, iPhone, Android) ; lot 6 (retrait du legacy) au moins 2 semaines après une publication stable            | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md), [extension/SOCLE.md](extension/SOCLE.md)                                               |
| **Wallet, Jetons, crédits TTS et Soundboard, Daily**                                                                | En Production depuis le 20/10 (Wallet canonique, paliers Daily legacy)                                                                                                                                                      | 50 000 Jetons du bot non régularisés ; compte technique `lecroupier_` (lot 10) ; monnaies multiples (§ 3)                                             | [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)                                                                                             |
| **Fidélité et présence** (sub, bits, follow)                                                                        | En Production                                                                                                                                                                                                               | re-sub manuel payé une fois (`11ffe3f`), effet réel non revérifié                                                                                     | —                                                                                                                                        |
| **Progression : XP, niveaux, titres, badges, classements**                                                          | **Clos le 20/11** : Level Up V2 (1 000 XP/niveau, annonce Twitch groupée, son au choix), restauration WizeBot exécutée (432 comptes), badges tous les 25 niveaux, annulations bloquées, rattachements futurs non compressés | « Envoyer une vraie annonce test » ; badges 12+ (niveau 300+) sans visuel ; commandes de consultation de niveau à spécifier                           | [LEVEL_UP_V2.md](LEVEL_UP_V2.md) § 14–15, [PROGRESSION.md](PROGRESSION.md)                                                               |
| **Mini-profil viewer**                                                                                              | **Public** (`be1744e75f63`)                                                                                                                                                                                                 | essai réel par Antoni                                                                                                                                 | [MINI_PROFIL.md](MINI_PROFIL.md)                                                                                                         |
| **Commands V2 / Commandes Chat V2.1** (son, expressions, édition déléguée)                                          | En Production (Core `c1da930a`+) ; « Mes commandes modifiables » **public**                                                                                                                                                 | essai réel de la commande d'Aouh ; latence dans le vrai OBS ; commandes configurables dans Studio « plus tard »                                       | [COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md)                                                                                           |
| **Boutique cosmétique, cadres, bannières**                                                                          | Livré (31/10)                                                                                                                                                                                                               | **aucun contenu définitif** (Antoni)                                                                                                                  | [COSMETIC_SHOP.md](COSMETIC_SHOP.md)                                                                                                     |
| **Récompenses Twitch** (points de chaîne, effets FX Cam, Couleur Cam)                                               | En Production ; administration des récompenses déployée le 13/11                                                                                                                                                            | effets non redéclenchés depuis OBS 33 ; BRB refusé sur « Just Chatting » ; lot 11                                                                     | [RECOMPENSES_TWITCH.md](RECOMPENSES_TWITCH.md), [CHANNEL_POINTS_V1.md](CHANNEL_POINTS_V1.md), [EFFECTS_PLAYER.md](EFFECTS_PLAYER.md)     |
| **Défis**                                                                                                           | Livré, **éteint** (`CHALLENGES_ENGINE` off)                                                                                                                                                                                 | catalogue et activation : Antoni                                                                                                                      | [CHALLENGES.md](CHALLENGES.md)                                                                                                           |
| **Bonk VNext**                                                                                                      | En Production                                                                                                                                                                                                               | lot 4 « FX rares » reporté                                                                                                                            | [BONK_VNEXT_AUDIT_2026-10.md](BONK_VNEXT_AUDIT_2026-10.md)                                                                               |
| **Soundboard**                                                                                                      | En Production                                                                                                                                                                                                               | ajout ou remplacement d'un son bloqué dans Studio                                                                                                     | [studio-refonte/FINALISATION.md](studio-refonte/FINALISATION.md)                                                                         |
| **TTS et `!tts`**                                                                                                   | En Production, rétabli après OBS 33 (Antoni)                                                                                                                                                                                | lecture avant la fin du reveal (dette) ; second lecteur `Navigateur web 2`                                                                            | —                                                                                                                                        |
| **Tombola V2**                                                                                                      | En Production ; annonce groupée validée (23/10)                                                                                                                                                                             | Tombola V1 inaccessible (`raffle_v2` forcé)                                                                                                           | [tombola-v2-parity.md](tombola-v2-parity.md)                                                                                             |
| **Notifications et activité** (Studio, alertes Twitch V2)                                                           | En Production (`ALERTS_MODE`) ; notifications de Studio                                                                                                                                                                     | vrai don et sous-types réels ; Studio : textes qui se chevauchent, notifications répétitives à regrouper, états normaux présentés comme des incidents | [TWITCH_ALERTS_PARITY_2026-10.md](TWITCH_ALERTS_PARITY_2026-10.md)                                                                       |
| **Overlays OBS et Chaos**                                                                                           | Lecteurs d'overlays de Studio en Production ; **Chaos V1** fermé avec Halloween (02/11) ; **Chaos V2 en conception**, rien construit                                                                                        | Chaos V2 lots 0 à 5 (§ 2.0) ; couper les fenêtres plein écran permanentes                                                                             | [chaos/ARCHITECTURE_CHAOS_V2.md](chaos/ARCHITECTURE_CHAOS_V2.md), [chaos/AUDIT_CHAOS_V1.md](chaos/AUDIT_CHAOS_V1.md)                     |
| **Mini-jeux et arcade** (Random Ban V5, Sniper, Jeu des mots, Roulette, Slot, Duel du chat)                         | En Production ; Mini-jeux V5 et anti-spoil (PR #67, 13–14/11) **publics** ; jeux du chat en live seulement                                                                                                                  | Duel : annonce et soldes réels non revérifiés ; 6 anciennes rédemptions Random Ban non régularisées                                                   | [mini-jeux/LIVRAISON_V5.md](mini-jeux/LIVRAISON_V5.md), [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md), [WORD_GAME_PARITY.md](WORD_GAME_PARITY.md) |
| **Casino V1** (machine à fruits + Coffre du Raptor, roulette, machine à émotes, blackjack multijoueur, spectateurs) | **Déployé côté Core, ouvert par réglage** (`CASINO_EXTENSION=on`, `casino.open=1`, 4 jeux), refusé hors live ; **pas dans l'extension publique** ; ZIP `2e2eaf3ae34a` en Hosted Test                                        | § 0.1 ; aucun essai réel avec de vrais viewers                                                                                                        | [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md), [CASINO.md](CASINO.md)                                                             |
| **Roue du Sub V3**                                                                                                  | En Production depuis le 16/11, barème V3 actif                                                                                                                                                                              | premier vrai tirage V3 : non tracé ; module Roue de l'extension (facultatif)                                                                          | [SUB_WHEEL_V3.md](SUB_WHEEL_V3.md) § 13                                                                                                  |
| **Votekick V2, Caution**                                                                                            | En Production ; Caution validée (23/10)                                                                                                                                                                                     | Votekick : durée réglable sur un vrai vote ; shaders non redéclenchés                                                                                 | [VOTEKICK_V2.md](VOTEKICK_V2.md), [CAUTION.md](CAUTION.md)                                                                               |
| **Modération D4**                                                                                                   | En Production                                                                                                                                                                                                               | badges VIP et Sub, synchronisation des bans Twitch ; mots réservés                                                                                    | [moderation-v2-d4-parity.md](moderation-v2-d4-parity.md)                                                                                 |
| **Spotify V2 et Music Hub**                                                                                         | Spotify V2 clos (25/10) ; Music Hub **ouvert à tous** (`MUSIC_HUB_EXTENSION=on`, dans l'extension publique)                                                                                                                 | parcours viewer complet (demande et skip payants, permissions, remboursements, overlay dans un vrai OBS) jamais validé par écrit                      | [SPOTIFY_V2.md](SPOTIFY_V2.md), [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md)                                                     |
| **Statistiques de modules** (privées)                                                                               | Livré (04/11)                                                                                                                                                                                                               | les rendre publiques : décision                                                                                                                       | [MODULE_STATS.md](MODULE_STATS.md)                                                                                                       |
| **Site raptoru.fr**                                                                                                 | En Production (dépôt séparé), progression et classements natifs                                                                                                                                                             | parcours connectés et iPhone à essayer (Antoni)                                                                                                       | `lb-app/docs/SITE_CONTEXT.md` (dépôt du site)                                                                                            |
| Halloween, boutique d'événement                                                                                     | Fermé le 02/11                                                                                                                                                                                                              | Bonbons : § 3                                                                                                                                         | [HALLOWEEN.md](HALLOWEEN.md)                                                                                                             |
| Coffre mystère, Objectif de soirée                                                                                  | Lab seulement                                                                                                                                                                                                               | décider s'ils deviennent de vrais modules                                                                                                             | [GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)                                                                           |
| Chaudron des subs                                                                                                   | PR #47 brouillon, Lab, éteint                                                                                                                                                                                               | décision d'Antoni                                                                                                                                     | `feat/halloween-cauldron`                                                                                                                |

## 2. Chantiers

### 2.0 Chaos V2 : priorité majeure après le Casino (en conception)

La recherche est terminée, et rien n'est construit ([chaos/](chaos/ARCHITECTURE_CHAOS_V2.md)). Un retournement local
propre, avec un seul vrai curseur, est **possible pour le curseur Windows** grâce à une capture native WGC ; le rendu
de bout en bout n'est pas encore prouvé. Architecture recommandée : un lecteur natif qui ne vit que pendant un effet,
vu par la capture d'écran d'OBS, et un module `chaos` du socle payé en Jetons.

| Lot | Contenu                                                                                   | Prérequis                   |
| --- | ----------------------------------------------------------------------------------------- | --------------------------- |
| 0   | mesures PresentMon ; couper les fenêtres V1 permanentes ; choisir la fréquence de l'écran | GO d'Antoni, 45 min         |
| 1   | lecteur natif, flip seul, bouton de test (Rust, CI)                                       | lot 0 ; GO ; outillage Rust |
| 2   | module `chaos` payant dans le Lab (file, remboursements, extension, Studio)               | lot 1 accepté ; prix (Q2)   |
| 3   | catalogue enrichi                                                                         | lot 2                       |
| 4   | Production                                                                                | GO dédiés                   |
| 5   | repère placé par un viewer                                                                | lots 1–4                    |

Critères et risques : [chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md). Arbitrages :
[chaos/QUESTIONS_OUVERTES_CHAOS_V2.md](chaos/QUESTIONS_OUVERTES_CHAOS_V2.md).

### 2.1 Extension : publication

| Étape                                                                                          | État                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Shell v2 et 95 commits (`be1744e75f63`) : inventaire `a971386f8c8d` validé, revue, publication | **fait** : public, prouvé par Antoni dans la console le 20/11 |
| Casino : inventaire `298e940290ab` validé (PR #93), ZIP `2e2eaf3ae34a` construit               | **fait** (20/11)                                              |
| Casino : Hosted Test hors live sur un compte testeur                                           | en cours (Antoni)                                             |
| Casino : soumission à la revue Twitch (8 à 14 jours, une soumission à la fois)                 | à faire (Antoni), après le choix de `CASINO_EXTENSION`        |
| Après approbation : publication, `PUBLISHED` corrigé, essai réel en live                       | à faire                                                       |
| Vrais appareils : PC à 65 %, zooms, iPhone, Android                                            | à faire                                                       |
| Lot 6 : nettoyage du legacy, au moins 2 semaines après une publication stable                  | sur accord                                                    |

Procédure Hosted Test : [extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 7.

### 2.2 Studio : finitions et maintenance

| Sujet                                                                                                                         | Catégorie    | Détail                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| Responsive en fenêtre réduite, densité des panneaux                                                                           | à développer | retours d'Antoni ; aucune mesure écrite                                                              |
| Notifications : textes qui se chevauchent, notifications répétitives à regrouper, états normaux présentés comme des incidents | à développer | retours d'Antoni                                                                                     |
| Recette d'usage en Production                                                                                                 | à valider    | aucune trace écrite                                                                                  |
| Lots F3, F4, F5, F7 ; H10 partiel                                                                                             | à développer | [studio-refonte/ROADMAP.md](studio-refonte/ROADMAP.md)                                               |
| Retrait de l'ancien Lab (A ou B) ; code mort                                                                                  | à décider    | [RETRAIT_ANCIEN_LAB.md](studio-refonte/RETRAIT_ANCIEN_LAB.md), [PARITE.md](studio-refonte/PARITE.md) |
| E2E instables ; arrêt de la pile E2E locale sous Windows                                                                      | à corriger   | —                                                                                                    |
| Suivi de compatibilité des plugins OBS (à chaque mise à jour d'OBS)                                                           | procédure    | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md) § 5                                                     |

### 2.3 Branches non fusionnées

Triage : [CLEANUP_LATER.md](CLEANUP_LATER.md) § 2. Carte : [WORKSPACES.md](WORKSPACES.md).

| Branche                                                                    | Contenu                               | État                               |
| -------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------- |
| `feat/studio-viewer-titles` (PR #54)                                       | titres équipés depuis Studio          | commit local `5d24614` non poussé  |
| `feat/halloween-cauldron` (PR #47)                                         | Chaudron des subs, brouillon          | décision d'Antoni                  |
| `study/croupier-ia-etude` (`2f64cc24`, locale)                             | étude de la personnalité IA, archivée | **suspendu** (§ 6), ne pas pousser |
| `feat/cosmetic-shop` (PR #44) ; `docs/*` (PR #34, #36, #38, #40, #48)      | dépassés                              | à fermer sur accord                |
| testeurs de l'extension en libre-service (Core `446e945c`, site `96b009f`) | file semi-automatique, locale         | activation sur GO                  |

## 3. Héritage et dettes

- **Plan post-live** ([PLAN_POST_LIVE_2026-10-21.md](PLAN_POST_LIVE_2026-10-21.md)) : lots 5, 7, 8, 10, 11, 13 et A7
  notés « non faits » au 26/10. À revérifier avant de les reprendre.
- **Fonctions SAMMI jamais reprises** : banque, 24H et crédits (`!code`, `!echange`), `!cashin`, `!blacklist` et
  `!whitelist`, commandes viewer avec son (`!sniper`, `!groslot`…), Oracle, Led couleur, Emote only. Inventaire :
  [../Raptoru-2.0-ETAT-PROJET.md](../Raptoru-2.0-ETAT-PROJET.md) § 0.5b.
- **Monnaies du Wallet et événements** (décidé le 29/10, non commencé) :
  1. interrupteur « Monnaie Bonbons » ;
  2. Bonbons dans le Wallet canonique ;
  3. interactions en plusieurs monnaies, puis module Événements générique.
- Incident Twitch et extension du 22/10 : cause non établie. Staging : branche et Node à décider.
- Checkout principal à remettre à jour (GO + sauvegarde des données de Studio).

## 4. Modules et fonctionnalités futures (intentions, pas des spécifications)

| Sujet                                                      | Ce qui existe vraiment                                                                              | Statut                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Commandes de consultation de niveau                        | aucune spécification                                                                                | à spécifier                          |
| Cosmétiques liés aux niveaux                               | la progression sait accorder les récompenses du catalogue par niveau ; **aucun catalogue ni asset** | contenu d'Antoni, rien à inventer    |
| Déclencheurs chat propres à un viewer ; alias de commandes | évoqués par Antoni (10/11) ; Commands V2 a la base des commandes publiques                          | à spécifier                          |
| Passe expérience sur 2–3 modules existants                 | proposé le 08/11                                                                                    | backlog (après Chaos V2)             |
| Annonces automatiques des gros gains du Casino             | réglage existant (`casino.announce`, coupé)                                                         | décision d'Antoni après l'essai réel |

Contraintes communes : le Core décide ; les Jetons sont sans valeur monétaire ; un partage dans le chat se fait par
bouton, jamais automatiquement ; un module = socle Core + module de session de l'extension v2.

### 4.1 Méthode des missions (décidée par Antoni)

1. Besoin.
2. Contraintes, sans refaire un audit existant.
3. Direction.
4. **GO global de développement local**.
5. Autonomie : décisions techniques, corrections, tests, commits locaux, journal.
6. Tests et corrections.
7. Résultat concret.
8. Recette d'Antoni.
9. Mise en Production **séparée**, sur GO dédié (ou mandat de livraison écrit).

## 5. Décisions de module (toujours en vigueur)

Registre transversal avec les raisons : [DECISIONS_TECHNIQUES.md](DECISIONS_TECHNIQUES.md).

- SAMMI ne doit jamais être réactivé. StreamElements garde les dons et l'affichage du chat ; ses points sont gelés.
  **SE.Live est désactivé dans OBS** (10/11).
- Votekick : design legacy, variante D interdite ; micro du streamer = « Micro » ; Audio Move conservé ;
  « LeCroupier_ peut voter » laissé.
- Caution : décisions 1 à 3 du 23/10 ([CAUTION.md](CAUTION.md) § 8) ; incident des 10 000 Jetons : pas de remboursement.
- Plan post-live : A1 à A9 du 21/10.
- Roue V2 : R7 en détection seule ; R3b et R5 interdits ; invitations ON ; récupération des doubles crédits OFF.
  Roue V3 : abonnement offert jamais tiré ; ancienneté inconnue jamais tirée « à 1 mois ».
- Tarifs : `!rb` 20 000 Jetons (réglage du 14/11), `!fxcam` 1 500 Jetons.
- Music Hub : skip payant par défaut à 25 000 Jetons, ×2 par skip réussi dans les 30 min, réglable dans les bornes du
  Core (base 100 à 10 000 000 ; multiplicateur 1 à 10 ; fenêtre 1 à 720 min ; plafond 1 000 000 000). Risques de
  conformité Spotify acceptés par Antoni.
- **Niveaux (20/11)** : 1 000 XP par niveau ; message récompensé au plus toutes les 120 s ; badges sub tous les
  25 niveaux ; restauration du 20/11 définitive ; annulations « normalisation » et « import » retirées pour de bon.
- **Casino (20/11)** : refus hors live conservé ; blackjack au Core, une ligne par table sous verrou ; annonce de table
  sur clic du créateur seulement ; garder `book_max_bet` ≤ `max_win` ÷ 1 000.
- Studio : H1 à H16, D1 à D32, direction D. Extension : 651 × 434, réglage à 65 %.
- Aucun push, fusion, déploiement, release Studio ni publication Twitch sans GO explicite d'Antoni.

## 6. En pause, suspendu ou étude seulement (ne pas relancer sans demande d'Antoni)

| Sujet                                                                  | État                                                                                                                                                                                 | Trace                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Personnalité IA conversationnelle de LeCroupier_** (« Croupier IA ») | **Suspendu depuis le 12/11, sans date de reprise.** Ne proposer ni modèle, ni test, ni fine-tuning, ni budget. Ne pas confondre avec le bot opérationnel (§ 1), qui reste en service | branche locale `study/croupier-ia-etude` (`2f64cc24`), `docs/croupier-ia/README_ARCHIVE.md` sur cette branche |
| Le Panthéon                                                            | concept en pause depuis le 14/11, non validé pour le développement ; les idées d'Antoni et les propositions d'agent ne sont pas des décisions                                        | `docs/pantheon/` non suivi par Git                                                                            |
| Collection / « Archives du stream »                                    | étude seulement (14/11) ; aucun développement demandé ; partir d'un catalogue existant sous licence                                                                                  | document Claude Docs du 14/11                                                                                 |
| Testeurs de l'extension en libre-service                               | construit en local, non poussé ; automatiser la console Twitch est interdit                                                                                                          | § 2.3                                                                                                         |
| Coffre mystère, Objectif de soirée, Chaudron des subs                  | Lab seulement ; décision d'Antoni                                                                                                                                                    | § 1                                                                                                           |
