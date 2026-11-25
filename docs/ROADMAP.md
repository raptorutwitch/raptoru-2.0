# Roadmap Raptoru 2.0

**Mise à jour le 22/11/2026** (checkpoint : fin du Casino V1, Core `a94d1081` déployé, ZIP prêt ; priorité aux
Chatbox). Version du 20/11 : historique Git de ce fichier. Versions précédentes :
[archive/ROADMAP_2026-11-15.md](archive/ROADMAP_2026-11-15.md),
[archive/ROADMAP_2026-11-08.md](archive/ROADMAP_2026-11-08.md),
[archive/ROADMAP_2026-10-24_2026-10-29.md](archive/ROADMAP_2026-10-24_2026-10-29.md).

Point d'entrée : [REPRISE.md](REPRISE.md). Versions en service : [PROJECT_STATUS.md](PROJECT_STATUS.md) § 3. Code de
chaque module : [INVENTAIRE_MODULES.md](INVENTAIRE_MODULES.md).

**Objectif** : tout le stream piloté depuis Raptoru Studio, avec le Core comme seule vérité, et des viewers qui
interagissent par l'extension.

**Les états ne se confondent pas** : développé (code sur `main`) → testé (tests automatiques) → déployé (Core / bot) →
publié (Studio en release, extension approuvée par Twitch) → **validé** (testé à la main par Antoni) → **testé en
live**. Un Hosted Test n'est pas une publication ; une CI verte ne valide rien.

## 0. Vue d'ensemble (22/11)

### 0.1 À faire maintenant (ordre réel)

1. **Chatbox Raptoru : en service masquée le 22/11** (§ 2.4, [CHATBOX.md](CHATBOX.md) § 12) : Core et bot `df3adb5e`
   (`CHATBOX_RELAY=true`), Studio 0.1.43 publiée, cinq sources OBS masquées ; reste : Antoni installe 0.1.43, essai en
   live et bascule scène par scène sur son GO ; les sources StreamElements restent jusqu'à sa décision.
2. **Casino V1 jusqu'au public** (gestes d'Antoni, en parallèle ; détail : [REPRISE.md](REPRISE.md) § 5.4 B) :
   téléverser le ZIP `d09fd03aa844` en Hosted Test hors live → choix de l'accès (`CASINO_EXTENSION=testers:<ids>`
   recommandé, ou `on`) → revue Twitch → publication, `PUBLISHED` mis à jour → essai réel en live → corrections des
   seuls problèmes observés.

### 0.2 Ensuite (déjà décidé ou demandé)

1. **Chaos V2 (« Chaos Overlay », que tu appelles « KO Overlay »)** : moteur, curseur retourné et **catalogue d'effets** de Studio construits les 22
   et 23/11 en local (`apps/chaos-engine`, branche `feat/chaos-studio`, `npm run chaos:lab`). Retournement essayé par
   Antoni dans Studio installé (`0.1.44-chaos.1`). **24/11 : 12 effets de plus** (miroir, tremblement, zoom, ivre,
   tunnel, clignement, flash, brouillard, flou, pixelisation, couleur, VHS), fiches Studio, études OBS Wasted et Replay ;
   version de test commune `0.1.44-chaos.2`, essayée par Antoni (retours positifs). 24/11 : mode C (écran + OBS)
   construit, version de test `0.1.44-chaos.4` non installée.
   **Polissage du 24/11** :
   - effets sur tout l'écran (mode E) ;
   - clignement fermé à 100 %, brouillard occultant, tunnel en dégradé, flash, ivre ;
   - intensités Léger / Marqué / Extrême ;
   - Chaos Performance Lab ;
   - version de test `0.1.44-chaos.3` non installée ([chaos/ETUDE_EFFETS_V2.md](chaos/ETUDE_EFFETS_V2.md) § 0 bis).

   **Essais d'Antoni attendus**, puis lot 2 (achat par les viewers).
   Le lot 0 (mesures PresentMon) reste à faire : § 2.0.

2. **Validations réelles en attente** (temps d'Antoni, en live) : premier vrai tirage de la Roue du Sub V3 ; « Envoyer
   une vraie annonce test » de Level Up ; commande d'Aouh (expressions, latence, édition déléguée) ; parcours viewer de
   Music Hub ; effets OBS après OBS 33.
3. **Studio, finitions** : § 2.2.
4. **Dettes et héritage** : § 3.

### 0.3 Vue par état

| État                                                     | Travaux                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Validé par Antoni** (trace écrite)                     | Spotify V2 (25/10) · Dock OBS V1.2 (28/10) · Caution (23/10) · Random Ban V2 (18/10) · FX Cam et Couleur Cam (18/10) · annonce groupée de la Tombola (23/10) · Commands V2 A0→F (en local) · direction D de Studio (06/11) · les 4 jeux du Casino en prototype (20/11, avant intégration) |
| **En Production, public, validation réelle restante**    | extension `be1744e75f63` (Level Up V2 et son interrupteur de son, mini-profil, Commandes V2.1 « Mes commandes modifiables », Mini-jeux V5, Music Hub) · Roue du Sub V3 · progression restaurée · Studio 0.1.42                                                                            |
| **Déployé côté Core, prêt à publier, pas encore public** | **Casino V1** : Core `a94d1081` ; ZIP `d09fd03aa844` construit et vérifié, **téléversement non prouvé** ; revue Twitch et essai réel à faire (§ 0.4)                                                                                                                                      |
| **Recherche faite, à concevoir**                         | **Chatbox Raptoru** (remplacement des 3 chatbox StreamElements) : § 2.4, [CHATBOX.md](CHATBOX.md)                                                                                                                                                                                         |
| **Étudié, prêt à implémenter**                           | Chaos V2 lot 0 (mesures) et lots 2 à 5 ; **moteur et page Studio livrés en local, test réel d'Antoni attendu** ([chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md))                                                                                                                   |
| **Backlog**                                              | finitions Studio (§ 2.2) · dettes (§ 3) · idées XP et modules (§ 4)                                                                                                                                                                                                                       |
| **Bloqué par du contenu d'Antoni**                       | Défis (catalogue) · cosmétiques (catalogue vide)                                                                                                                                                                                                                                          |
| **En pause ou suspendu** (ne pas relancer sans demande)  | § 6                                                                                                                                                                                                                                                                                       |
| **Abandonné**                                            | SAMMI · `apps/viewer-web` (le site est raptoru.fr) · Chaos V1 comme base de Chaos V2 · variante D de l'overlay Votekick                                                                                                                                                                   |

### 0.4 Casino V1 : chaque étape à sa place (22/11)

| État                           | Casino V1                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Terminé / intégré**          | PR #90 (V1, 20/11) ; post-live #99, #100, #102, #103, #105, #107, #109, #110, #112, #114, #115 ; Core des tables et réactions #111 ; inventaire #113 (`main` `302db793`). Fonctions : § 1 (ligne Casino) ; détail [CASINO.md](CASINO.md) § 12–18 |
| **Déployé**                    | Core `a94d1081` le 22/11 00:39 UTC (aucune migration, bot `2c04a5db` inchangé ; retour arrière `1f05b97c`) ; `CASINO_EXTENSION=on`, `casino.open=1`, 4 jeux ouverts, refus hors live                                                             |
| **Prêt à publier**             | ZIP `raptoru-live-PRODUCTION-d09fd03aa844-depuis-be1744e-20-commits-shell-v2.zip` (SHA-256 `1ec79c2a…66d76039`, 20 commits, inventaire `2411c992b26b` validé par Antoni) : construit et vérifié, **pas dans Twitch** à ce jour (aucune preuve)   |
| **Validation réelle restante** | Hosted Test hors live (PC et application Twitch du téléphone) ; revue Twitch ; après publication, essai en live avec de vrais viewers (mises, gains, remboursements, spectateurs, blackjack à plusieurs, nouvelles tables, réactions)            |
| **En attente**                 | annonces automatiques des gros gains (décision après l'essai réel, § 4) ; interrupteurs des réactions dans Studio (prochaine version de Studio, valeurs par défaut actives d'ici là)                                                             |

Fonctions livrées techniquement (fusionnées ; Core déployé ; extension prête, pas publique) :

- **Blackjack** : multijoueur, spectateurs, jeu en solo ; jusqu'à 4 mains après Split, présentées en pile animée,
  distribution et actions indépendantes par main ; assurance et Gain assuré ; historique « Mes manches » et bilan de
  session ; partage des résultats dans le chat.
- **Tables** : création de nouvelles tables publiques ; plafond dynamique (5 tables, +1 par table d'au moins
  6 joueurs, 8 au plus ; jamais deux tables vides) ; tables vides fermées après 10 min sans manche en attente.
- **Réactions** : 7 (5 visuels Discord via Twemoji, `ICANT.png`, `ptn.gif` animé) ; anti-spam du Core par viewer
  (5 d'affilée puis 1 toutes les 2 s, refus sans effet économique) ; émotes flottantes en mouvement continu ; le
  croupier réagit d'une émote seule, sans phrase ni IA.
- **Machines** : lignes gagnantes explorées directement sur les rouleaux ; plus de pastilles sous les machines.
- **Partout** : responsive PC, portrait et paysage ; simulateur interactif local
  (`npm run casino:bench -w @raptoru/twitch-extension`) ; garde contre les doubles-clics propagés au lecteur Twitch,
  dans les limites de l'iframe ([CASINO.md](CASINO.md) § 18.9).

## 1. Modules

Colonnes : état réel · ce qui reste · document. « Public » = dans l'extension publiée `be1744e75f63` ou dans le chat.
États relevés le 20/11, sauf le Core, l'extension, le Casino et les Chatbox (22/11).

| Module                                                                                                              | État au 20/11                                                                                                                                                                                                                | Reste                                                                                                                                                 | Document                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Core API et infrastructure**                                                                                      | En Production : Core `a94d1081` (22/11) sur Coolify (VPS), PostgreSQL 17, sauvegarde quotidienne + manuelle avant opération, déploiement par `scripts/coolify-deploy.mjs` ou GitHub Actions, CI sur chaque PR                | copies de la base hors VPS seulement manuelles ; secret GitHub `COOLIFY_URL` à vérifier ; staging non revérifié                                       | [ARCHITECTURE.md](ARCHITECTURE.md), [OPERATIONS.md](OPERATIONS.md), [CICD.md](CICD.md), [BACKUPS.md](BACKUPS.md)                         |
| **Bot LeCroupier_** (opérationnel)                                                                                  | En Production `2c04a5db` : EventSub, chat, bail unique (un seul bot actif), exécuteurs Random Ban, messages des modules                                                                                                      | durcissements F3–F9 ; trou de présence après changement de bot (lot 13)                                                                               | [BOT_VPS_CUTOVER.md](BOT_VPS_CUTOVER.md)                                                                                                 |
| **Raptoru Studio « Coulisses »** (configuration, pilotage)                                                          | 0.1.42 publié et installé ; pages de chaque module, Lab isolé, Centre de contrôle et supervision                                                                                                                             | finitions § 2.2 ; recette d'usage en Production non écrite                                                                                            | [studio-refonte/CONTEXTE.md](studio-refonte/CONTEXTE.md), [CONTROL_CENTER.md](CONTROL_CENTER.md)                                         |
| **Pont Studio ↔ outils** (OBS WebSocket, Spotify, Windows SMTC, Dock)                                               | En Production : Studio pilote OBS 33.0.1, lit Spotify et SMTC, Dock OBS V1.2 validé                                                                                                                                          | suivi des plugins OBS à chaque mise à jour ; source `Navigateur web 2` (ancienne clé TTS, O10)                                                        | [OBS_ENVIRONNEMENT.md](OBS_ENVIRONNEMENT.md), [OBS_DOCK.md](OBS_DOCK.md)                                                                 |
| **Extension Twitch** (shell v2 : panneau, overlay, mobile)                                                          | **Public `be1744e75f63`** (prouvé le 20/11) ; Casino : ZIP `d09fd03aa844` prêt (22/11), non téléversé ; dernier Hosted Test tracé `2e2eaf3ae34a`                                                                             | Casino : § 0.1 ; vrais appareils (PC à 65 %, iPhone, Android) ; lot 6 (retrait du legacy) au moins 2 semaines après une publication stable            | [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md), [extension/SOCLE.md](extension/SOCLE.md)                                               |
| **Wallet, Jetons, crédits TTS et Soundboard, Daily**                                                                | En Production depuis le 20/10 (Wallet canonique, paliers Daily legacy)                                                                                                                                                       | 50 000 Jetons du bot non régularisés ; compte technique `lecroupier_` (lot 10) ; monnaies multiples (§ 3)                                             | [ECONOMY_MIGRATION.md](ECONOMY_MIGRATION.md)                                                                                             |
| **Fidélité et présence** (sub, bits, follow)                                                                        | En Production                                                                                                                                                                                                                | re-sub manuel payé une fois (`11ffe3f`), effet réel non revérifié                                                                                     | —                                                                                                                                        |
| **Progression : XP, niveaux, titres, badges, classements**                                                          | **Clos le 20/11** : Level Up V2 (1 000 XP/niveau, annonce Twitch groupée, son au choix), restauration WizeBot exécutée (432 comptes), badges tous les 25 niveaux, annulations bloquées, rattachements futurs non compressés  | « Envoyer une vraie annonce test » ; badges 12+ (niveau 300+) sans visuel ; commandes de consultation de niveau à spécifier                           | [LEVEL_UP_V2.md](LEVEL_UP_V2.md) § 14–15, [PROGRESSION.md](PROGRESSION.md)                                                               |
| **Mini-profil viewer**                                                                                              | **Public** (`be1744e75f63`)                                                                                                                                                                                                  | essai réel par Antoni                                                                                                                                 | [MINI_PROFIL.md](MINI_PROFIL.md)                                                                                                         |
| **Commands V2 / Commandes Chat V2.1** (son, expressions, édition déléguée)                                          | En Production (Core `c1da930a`+) ; « Mes commandes modifiables » **public**                                                                                                                                                  | essai réel de la commande d'Aouh ; latence dans le vrai OBS ; commandes configurables dans Studio « plus tard »                                       | [COMMANDS_V2_STATUS.md](COMMANDS_V2_STATUS.md)                                                                                           |
| **Boutique cosmétique, cadres, bannières**                                                                          | Livré (31/10)                                                                                                                                                                                                                | **aucun contenu définitif** (Antoni)                                                                                                                  | [COSMETIC_SHOP.md](COSMETIC_SHOP.md)                                                                                                     |
| **Récompenses Twitch** (points de chaîne, effets FX Cam, Couleur Cam)                                               | En Production ; administration des récompenses déployée le 13/11                                                                                                                                                             | effets non redéclenchés depuis OBS 33 ; BRB refusé sur « Just Chatting » ; lot 11                                                                     | [RECOMPENSES_TWITCH.md](RECOMPENSES_TWITCH.md), [CHANNEL_POINTS_V1.md](CHANNEL_POINTS_V1.md), [EFFECTS_PLAYER.md](EFFECTS_PLAYER.md)     |
| **Défis**                                                                                                           | Livré, **éteint** (`CHALLENGES_ENGINE` off)                                                                                                                                                                                  | catalogue et activation : Antoni                                                                                                                      | [CHALLENGES.md](CHALLENGES.md)                                                                                                           |
| **Bonk VNext**                                                                                                      | En Production                                                                                                                                                                                                                | lot 4 « FX rares » reporté                                                                                                                            | [BONK_VNEXT_AUDIT_2026-10.md](BONK_VNEXT_AUDIT_2026-10.md)                                                                               |
| **Soundboard**                                                                                                      | En Production                                                                                                                                                                                                                | ajout de sons depuis Studio développé en local (23/11), non déployé                                                                                   | [SOUNDBOARD.md](SOUNDBOARD.md)                                                                                                           |
| **TTS et `!tts`**                                                                                                   | En Production, rétabli après OBS 33 (Antoni)                                                                                                                                                                                 | lecture avant la fin du reveal (dette) ; second lecteur `Navigateur web 2`                                                                            | —                                                                                                                                        |
| **Tombola V2**                                                                                                      | En Production ; annonce groupée validée (23/10)                                                                                                                                                                              | Tombola V1 inaccessible (`raffle_v2` forcé)                                                                                                           | [tombola-v2-parity.md](tombola-v2-parity.md)                                                                                             |
| **Notifications et activité** (Studio, alertes Twitch V2)                                                           | En Production (`ALERTS_MODE`) ; notifications de Studio                                                                                                                                                                      | vrai don et sous-types réels ; Studio : textes qui se chevauchent, notifications répétitives à regrouper, états normaux présentés comme des incidents | [TWITCH_ALERTS_PARITY_2026-10.md](TWITCH_ALERTS_PARITY_2026-10.md)                                                                       |
| **Overlays OBS et Chaos**                                                                                           | Lecteurs d'overlays de Studio en Production ; **Chaos V1** fermé avec Halloween (02/11) ; **Chaos V2** : prototype du lot 1 en local (22/11), hors Studio                                                                    | Chaos V2 lots 0 à 5 (§ 2.0) ; couper les fenêtres plein écran permanentes                                                                             | [chaos/ARCHITECTURE_CHAOS_V2.md](chaos/ARCHITECTURE_CHAOS_V2.md), [chaos/AUDIT_CHAOS_V1.md](chaos/AUDIT_CHAOS_V1.md)                     |
| **Chatbox OBS** (Just Chatting, React, Dessin)                                                                      | En service chez **StreamElements** (3 overlays : `Boîte de chat`, `ChatReact`, `Chatbox Dessin`) ; reconnaissance faite le 20/11 ; **priorité de développement** depuis le 22/11, rien de spécifié                           | revue des caractéristiques avec Antoni, spécification, moteur partagé + 3 profils (§ 2.4)                                                             | [CHATBOX.md](CHATBOX.md) (+ rapport privé hors Git)                                                                                      |
| **Mini-jeux et arcade** (Random Ban V5, Sniper, Jeu des mots, Roulette, Slot, Duel du chat)                         | En Production ; Mini-jeux V5 et anti-spoil (PR #67, 13–14/11) **publics** ; jeux du chat en live seulement                                                                                                                   | Duel : annonce et soldes réels non revérifiés ; 6 anciennes rédemptions Random Ban non régularisées                                                   | [mini-jeux/LIVRAISON_V5.md](mini-jeux/LIVRAISON_V5.md), [RANDOM_BAN_V2.md](RANDOM_BAN_V2.md), [WORD_GAME_PARITY.md](WORD_GAME_PARITY.md) |
| **Casino V1** (machine à fruits + Coffre du Raptor, roulette, machine à émotes, blackjack multijoueur, spectateurs) | **Terminé, Core `a94d1081` déployé, ouvert par réglage** (`CASINO_EXTENSION=on`, `casino.open=1`, 4 jeux), refusé hors live ; **pas dans l'extension publique** ; ZIP `d09fd03aa844` prêt, non téléversé ; fonctions : § 0.4 | § 0.4 ; aucun essai réel avec de vrais viewers                                                                                                        | [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md), [CASINO.md](CASINO.md) § 12–18                                                     |
| **Roue du Sub V3**                                                                                                  | En Production depuis le 16/11, barème V3 actif                                                                                                                                                                               | premier vrai tirage V3 : non tracé ; module Roue de l'extension (facultatif)                                                                          | [SUB_WHEEL_V3.md](SUB_WHEEL_V3.md) § 13                                                                                                  |
| **Votekick V2, Caution**                                                                                            | En Production ; Caution validée (23/10)                                                                                                                                                                                      | Votekick : durée réglable sur un vrai vote ; shaders non redéclenchés                                                                                 | [VOTEKICK_V2.md](VOTEKICK_V2.md), [CAUTION.md](CAUTION.md)                                                                               |
| **Modération D4**                                                                                                   | En Production                                                                                                                                                                                                                | badges VIP et Sub, synchronisation des bans Twitch ; mots réservés                                                                                    | [moderation-v2-d4-parity.md](moderation-v2-d4-parity.md)                                                                                 |
| **Spotify V2 et Music Hub**                                                                                         | Spotify V2 clos (25/10) ; Music Hub **ouvert à tous** (`MUSIC_HUB_EXTENSION=on`, dans l'extension publique)                                                                                                                  | parcours viewer complet (demande et skip payants, permissions, remboursements, overlay dans un vrai OBS) jamais validé par écrit                      | [SPOTIFY_V2.md](SPOTIFY_V2.md), [music/MUSIC_HUB_STATE.md](music/MUSIC_HUB_STATE.md)                                                     |
| **Statistiques de modules** (privées)                                                                               | Livré (04/11)                                                                                                                                                                                                                | les rendre publiques : décision                                                                                                                       | [MODULE_STATS.md](MODULE_STATS.md)                                                                                                       |
| **Site raptoru.fr**                                                                                                 | En Production (dépôt séparé), progression et classements natifs                                                                                                                                                              | parcours connectés et iPhone à essayer (Antoni)                                                                                                       | `lb-app/docs/SITE_CONTEXT.md` (dépôt du site)                                                                                            |
| Halloween, boutique d'événement                                                                                     | Fermé le 02/11                                                                                                                                                                                                               | Bonbons : § 3                                                                                                                                         | [HALLOWEEN.md](HALLOWEEN.md)                                                                                                             |
| Coffre mystère, Objectif de soirée                                                                                  | Lab seulement                                                                                                                                                                                                                | décider s'ils deviennent de vrais modules                                                                                                             | [GUIDE_MODULE.md](studio-refonte/architecture/GUIDE_MODULE.md)                                                                           |
| Chaudron des subs                                                                                                   | PR #47 brouillon, Lab, éteint                                                                                                                                                                                                | décision d'Antoni                                                                                                                                     | `feat/halloween-cauldron`                                                                                                                |

## 2. Chantiers

### 2.0 Chaos V2 : priorité majeure suivante, après les Chatbox (en conception)

**24/11 : bibliothèque d'effets.** 13 effets publics développés et intégrés à Studio, vérifiés hors écran, jamais vus
en vrai (garde de jeu) ; état, techniques et limites : [chaos/ETUDE_EFFETS_V2.md](chaos/ETUDE_EFFETS_V2.md). Restes :

- essais d'Antoni effet par effet (le brouillard ne compte comme réussi qu'après son avis en mouvement) ;
- banc des 13 effets ([chaos/BENCH_EFFETS.md](chaos/BENCH_EFFETS.md)) : phases A et B mesurées le 25/11 (moteur hors
  écran à 1440p, OBS isolé : aucune image perdue). Reste la phase C sur Overwatch réel (procédure et outil prêts, à
  faire par Antoni). Optimisations possibles de Brouillard, Écran ivre et VHS décrites, non faites sans besoin démontré ;
- images/s du jeu dans le Performance Lab : intégration de PresentMon (droits d'administrateur) si la lecture à la
  main ne suffit pas ;
- mode E : barre des tâches figée pendant un effet qui lit l'image (horloge, survol) ; « barre vivante » possible
  plus tard par une seconde surface exclue des captures ([chaos/ECRAN_ENTIER.md](chaos/ECRAN_ENTIER.md) § 4) ;
- flou : sous-échantillonnage à 13 lectures si le flou très fort ondule en mouvement ;
- point visé : miniature capturée du vrai écran, si l'écran miniature ne suffit pas ;
- lot 2 : prix par durée et par palier au Core (le registre porte déjà durées, paliers et aperçu) ;
- **curseur d'OBS et VHS animé** (24/11 soir : [chaos/CURSEUR_OBS.md](chaos/CURSEUR_OBS.md)), construits et testés hors
  écran. Restes :
  - flash noir de la bascule : relais anti-coupure, **validé par Antoni le 25/11** dans son OBS avec `0.1.44-chaos.8`
    (CURSEUR_OBS.md § 5) ;
  - validation d'Antoni avec `0.1.44-chaos.7`, qui inclut le correctif de la fenêtre protégée
    ([chaos/CAPTURE_DIRECTE.md](chaos/CAPTURE_DIRECTE.md) § 6) : VHS au maintien, un seul curseur, coupure visible ou
    non, Miroir et Écran retourné avec Discord ouvert ;
  - si la coupure d'OBS gêne : étudier un curseur transformé sans changer le réglage d'OBS ;
- **capture directe par « Écran »** (24/11 soir, priorité d'Antoni après la sonde DXGI, Miroir validé en chaos.5 : [chaos/CAPTURE_DIRECTE.md](chaos/CAPTURE_DIRECTE.md)) :
  - construite et testée hors écran ; Studio part en « Écran uniquement » ;
  - reste la validation visible d'Antoni (Miroir, Clignement, Brouillard, Zoom ; version de test `0.1.44-chaos.5`) ;
  - reste aussi la mesure à l'écran du coût de composition du mode E ;
- **mode C** (écran + OBS, choisi par Antoni, construit le 24/11, **alternative** depuis la capture directe :
  [chaos/MODE_C.md](chaos/MODE_C.md)). Restes :
  - test d'exclusion visible ;
  - GO puis préparation des filtres dans l'OBS réel et essai contrôlé ;
  - banc 1440p (écran et OBS) ;
  - flash dans OBS (Source Clone + Freeze, sur GO) ;
  - parité en 1440p et sur scène animée ;
  - brouillard à demi-résolution dans OBS si le banc le demande ;
- OBS : prototype isolé « replay » puis « Wasted », sur GO ([chaos/ETUDE_OBS_REPLAY.md](chaos/ETUDE_OBS_REPLAY.md),
  [chaos/ETUDE_OBS_WASTED.md](chaos/ETUDE_OBS_WASTED.md)).

La recherche est terminée ([chaos/](chaos/ARCHITECTURE_CHAOS_V2.md)). Un retournement local propre, avec un seul vrai
curseur, est **possible pour le curseur Windows** grâce à une capture native WGC. Architecture recommandée : un lecteur
natif qui ne vit que pendant un effet, vu par la capture d'écran d'OBS, et un module `chaos` du socle payé en Jetons.

**22/11 : le moteur existe** ([apps/chaos-engine](../apps/chaos-engine/README.md),
[chaos/ARCHITECTURE_MOTEUR.md](chaos/ARCHITECTURE_MOTEUR.md)). Il réutilise le prototype du lot 1, testé par Antoni
(retournement et curseur bons ; ancien écran visible pendant la rotation, corrigé).

- Il contient :
  - le registre partagé et la configuration versionnée ;
  - l'ordonnanceur et les transitions ;
  - la capture partagée, le rendu par passes et les calques ;
  - le runtime isolé des effets ;
  - la télémétrie, le gardien et l'arrêt d'urgence ;
  - la page Studio › Chaos et le banc Chaos Lab.
- Un seul effet réel : le retournement.
  - Par défaut : le calque sur la fenêtre du jeu.
  - L'écran entier retourné par Windows (souris inversée) est **expérimental et coupé** depuis l'incident du 22/11 :
    Overwatch à 17 images/s pendant les bascules
    ([chaos/ETUDE_PERFORMANCES_RETOURNEMENT.md](chaos/ETUDE_PERFORMANCES_RETOURNEMENT.md)).
  - Décision attendue d'Antoni sur le candidat sans bascule (curseur affiché par le calque).
- Tests : 23 unitaires ; 51 d'intégration avant l'incident (17 sans écran depuis) ; 10 côté Studio ; 11 de bout en
  bout. Un banc de comparaison existe, jamais lancé.
- **Pas encore prouvé en jeu**, ni dans un Studio installé (aucune release) : test réel d'Antoni
  ([chaos/PROCEDURE_TESTS.md](chaos/PROCEDURE_TESTS.md) § 2).

| Lot | Contenu                                                                                   | Prérequis                  |
| --- | ----------------------------------------------------------------------------------------- | -------------------------- |
| 0   | mesures PresentMon ; couper les fenêtres V1 permanentes ; choisir la fréquence de l'écran | GO d'Antoni, 45 min        |
| 1   | lecteur natif, flip seul — **moteur et page Studio livrés en local le 22/11 (C#)**        | test réel d'Antoni (R1–R6) |
| 2   | module `chaos` payant dans le Lab (file, remboursements, extension, Studio)               | lot 1 accepté ; prix (Q2)  |
| 3   | catalogue enrichi                                                                         | lot 2                      |
| 4   | Production                                                                                | GO dédiés                  |
| 5   | repère placé par un viewer                                                                | lots 1–4                   |

Critères et risques : [chaos/ROADMAP_CHAOS_V2.md](chaos/ROADMAP_CHAOS_V2.md). Arbitrages :
[chaos/QUESTIONS_OUVERTES_CHAOS_V2.md](chaos/QUESTIONS_OUVERTES_CHAOS_V2.md).

### 2.1 Extension : publication

| Étape                                                                                            | État                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Shell v2 et 95 commits (`be1744e75f63`) : inventaire `a971386f8c8d` validé, revue, publication   | **fait** : public, prouvé par Antoni dans la console le 20/11 |
| Casino : inventaire `298e940290ab` validé (PR #93), ZIP `2e2eaf3ae34a` construit, Hosted Test    | **fait** (20/11)                                              |
| Casino final : inventaire `2411c992b26b` validé (PR #113), ZIP `d09fd03aa844` construit, vérifié | **fait** (22/11)                                              |
| Casino final : téléversement du ZIP `d09fd03aa844`, Hosted Test hors live sur un compte testeur  | à faire (Antoni) ; aucune preuve de téléversement au 22/11    |
| Casino : soumission à la revue Twitch (8 à 14 jours, une soumission à la fois)                   | à faire (Antoni), après le choix de `CASINO_EXTENSION`        |
| Après approbation : publication, `PUBLISHED` corrigé, essai réel en live                         | à faire                                                       |
| Vrais appareils : PC à 65 %, zooms, iPhone, Android                                              | à faire                                                       |
| Lot 6 : nettoyage du legacy, au moins 2 semaines après une publication stable                    | sur accord                                                    |

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
| `feat/soundboard-studio-import` (PR #126, worktree `soundboard`)           | ajouter un son depuis Studio          | GO d'Antoni (SOUNDBOARD.md § 3)    |

### 2.4 Chatbox Raptoru : priorité de développement (direction décidée le 22/11)

Remplacer progressivement les trois chatbox StreamElements d'OBS (`Boîte de chat` : Just Chatting et Waiting screen ;
`ChatReact` : PS5 et Fullscreen ; `Chatbox Dessin` : Dessin) par une chatbox propre à Raptoru 2.0. **Décision
d'Antoni du 22/11 : modernisation maîtrisée + intégration complète dans Studio** (identité et comportements gardés ;
proportions, animations, lisibilité et qualité technique modernisées ; tout se règle dans Studio, avec
prévisualisation et application en direct aux sources OBS). Détail : [CHATBOX.md](CHATBOX.md) § 4.

| Étape                                                                          | État                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Reconnaissance (OBS, CSS, JavaScript, comparatif, préservation)                | **faite** (20/11) : rapport privé, voir [CHATBOX.md](CHATBOX.md) § 1               |
| Présentation des trois chatbox (paramètres exacts, critiques, options)         | **faite** (22/11) : présentation privée, [CHATBOX.md](CHATBOX.md) § 1              |
| Direction de conception                                                        | **décidée** (22/11) : [CHATBOX.md](CHATBOX.md) § 4                                 |
| Architecture (bot → Core → Studio → pages OBS, sans nouvelle connexion Twitch) | **validée** (22/11) ; spécification complète ([CHATBOX.md](CHATBOX.md) § 5 à 9)    |
| Jalon 1 : prototype Lab et démonstration                                       | **livré** (22/11), validé visuellement par Antoni le 22/11                         |
| Jalons 2 et 3 : vrai chat dans le Lab, prêt pour le live                       | **livrés en Lab** (22/11) ([CHATBOX.md](CHATBOX.md) § 10)                          |
| Fusion dans `main`                                                             | **faite** (22/11) : PR #118, `df3adb5e`, CI verte                                  |
| Production                                                                     | **faite** (22/11) : Core et bot `df3adb5e`, Studio 0.1.43, sources OBS masquées    |
| Essai en live et remplacement dans OBS, scène par scène                        | sur GO d'Antoni ([CHATBOX.md](CHATBOX.md) § 12.2) ; StreamElements gardé jusque-là |

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

- SAMMI ne doit jamais être réactivé. StreamElements garde les dons et l'affichage du chat (remplacement par une
  chatbox Raptoru en préparation, § 2.4) ; ses points sont gelés. **SE.Live est désactivé dans OBS** (10/11). Les URL
  d'overlay StreamElements contiennent une clé : jamais dans le dépôt.
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
- **Casino (21–22/11)** : quitter l'affichage d'une table ne confisque jamais une mise engagée (la main reste en jeu et
  se règle normalement) ; « Remettre le bilan à zéro » ne déplace qu'un point de départ dans le navigateur, jamais une
  transaction ni l'historique du Wallet ; une table créée reste publique et rejoignable ; un joueur = une table ; les
  réactions sont des identifiants fixes (`r1`–`r7`), en mémoire, sans IA ni personnalité conversationnelle ; anti-spam
  au Core (5 puis 1 toutes les 2 s) ; aucune annonce de table dans le chat si `casino.bj_announce` n'a jamais été
  activé (0 par défaut depuis `a94d1081`) ; Twemoji sous CC-BY 4.0 (attribution dans l'extension).
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
