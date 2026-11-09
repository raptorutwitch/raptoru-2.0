# Audit de fiabilité avant live — 09/11/2026

Branche `audit/fiabilite-2026-11-09` (worktree `Raptoru 2.0 - Worktrees\audit-fiabilite`), partie de `origin/main`
`589d078` = le code de la Production (Core et bot `1b25f30`, Studio 0.1.27 construit depuis `13ed6e8`). Les corrections
Music Hub sont sur `feat/music-hub` (worktree `music-hub`), à part. **Rien n'est poussé, fusionné, déployé ni publié.**
Aucune donnée réelle, aucun solde réel, aucune scène OBS, aucune permission Twitch n'a été touché.

## 1. Résumé exécutif

- **Aucun P0 confirmé.** Les garanties économiques de fond tiennent. Le Wallet canonique ne fait ni double débit, ni
  double remboursement, ni remboursement sans débit ; chaque débit est dans la transaction de l'action qu'il paie.
- **4 P1 trouvés et corrigés localement**, chacun reproduit avant correction :
  - **Double paiement après une réponse perdue** : Soundboard, Bonk à l'unité, boutique d'événements. Le second clic du
    viewer payait une seconde fois. Prouvé de bout en bout dans le Lab : 2 clés et 2 débits avant, 1 après.
  - **Session vidée par un renouvellement du jeton Twitch** pendant un poll de l'extension. La session restait sans
    identité, sans rôle et sans chaîne jusqu'au rechargement : actions désactivées, modérateurs renvoyés sur la
    console V1.
  - **Crédits TTS lus à 0** par la frontière de Production (`/v1/ext/tts/state`), toutes les 2 s, ce qui refusait la
    confirmation.
  - **Music Hub (Lab)** : un skip de modération mis en file derrière un skip payé passait aussi le titre suivant.
- **14 P2 et 3 P3 traités** sur les deux branches : bot, Studio, Core, extension et Music Hub. Liste au § 5.
- **Le reste est documenté, non appliqué** : corrections qui touchent la reprise des données, l'exploitation du bot ou
  une décision métier (§ 7).
- **Music Hub n'est pas publiable pour le prochain stream.** Rien n'a été testé en réel : ni Spotify en écriture, ni
  Twitch, ni OBS. Plusieurs choix restent à arbitrer. Voir la checklist GO / NO-GO (§ 12).

## 2. Périmètre réellement contrôlé

- **Cartographie.**
  - 30 worktrees.
  - Le checkout principal est sur `main` local (en retard sur `origin/main`), avec 87 fichiers modifiés non commités qui
    ne sont pas à moi : **non touché**.
  - L'audit s'est fait dans un worktree neuf ; `npm ci`, build, typecheck et lint y sont propres.
- **Six audits en lecture seule**, menés en parallèle puis vérifiés un par un :
  - économie des Jetons ;
  - bot et Twitch (EventSub, jetons, bail, file de chat) ;
  - Studio et pages OBS (effets, alertes, points de chaîne, Votekick, OBS) ;
  - extension (permissions, idempotence, polling, fuites) ;
  - files des modules du Core ;
  - Music Hub, revue contradictoire de `cafbf80`.

  Chaque constat retenu a été relu dans le code, puis reproduit par un test qui échoue sans la correction et passe avec.

- **Non contrôlé en profondeur** :
  - la page Votekick overlay (HTML interne) ;
  - le lecteur TTS (Lab seulement) ;
  - `lab-ebs.ts` (ancienne pile Lab) ;
  - Bonk `scene.play()` sur une source masquée ;
  - le site raptoru.fr ;
  - la version de l'extension **réellement servie par Twitch**, toujours non prouvée (`PROJECT_STATUS.md` § 3).

## 3. Risques classés (état final)

| Id     | Prio | Composant             | Risque                                                                                                | État                    |
| ------ | ---- | --------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| EXT-1  | P1   | Extension             | Soundboard / Bonk / boutique : réponse perdue + nouveau clic = second débit                           | **corrigé** `e094740`   |
| EXT-2  | P1   | Extension             | Renouvellement du jeton pendant un poll : session sans identité jusqu'au rechargement                 | **corrigé** `572f97e`   |
| CORE-1 | P1   | Core (frontière)      | `/v1/ext/tts/state` renvoie 0 crédit TTS                                                              | **corrigé** `e1a6b04`   |
| MH-1   | P1   | Music Hub (Lab)       | Skip de modération derrière un skip payé : le titre suivant est passé aussi                           | **corrigé** (music-hub) |
| BOT-1  | P2   | Bot                   | EventSub sur une connexion à moitié ouverte : bot « connecté » mais sourd (événements perdus)         | **corrigé** `d656a1e`   |
| BOT-2  | P2   | Bot                   | Échec transitoire du rafraîchissement anticipé : jeton encore valide refusé, faux 401                 | **corrigé** `91b4c47`   |
| BOT-3  | P2   | Bot                   | Verrou `.lock` du jeton laissé sur `/data` après un arrêt brutal : rafraîchissement bloqué            | proposé (§ 7)           |
| STU-1  | P2   | Studio (effets)       | Source OBS rechargée pendant un effet : Random Ban / Roue figés 120 s                                 | **corrigé** `1c27b1a`   |
| STU-2  | P2   | Studio (OBS)          | Annulation d'un changement temporaire OBS perdue si OBS est occupé à ce moment                        | **corrigé** `af4a611`   |
| STU-3  | P2   | Studio (points)       | Un « completed » perdu bloque les jobs OBS des points de chaîne jusqu'à la fin du bail                | **corrigé** `375ede5`   |
| STU-4  | P2   | Studio (Jeu des mots) | Flux des victoires bloqué pour toujours sur une connexion à moitié ouverte                            | **corrigé** `77d3741`   |
| STU-5  | P2   | Studio (Votekick)     | Fermer Studio pendant un mute laisse le bandeau MUTED et le zoom                                      | **corrigé** `07d3513`   |
| ECO-1  | P2   | Core (Wallet)         | Un article à 0 Jeton ou 0 crédit est refusé en Production seulement                                   | **corrigé** `2cc495b`   |
| ECO-2  | P2   | Core (`!rb`)          | Remboursement `!rb` dû jamais retenté après un redémarrage                                            | **corrigé** `114ca88`   |
| CP-1   | P2   | Core (points)         | Rédemption interrompue après son commit : jamais reprise (points dépensés, rien joué, rien rendu)     | proposé (§ 7)           |
| EXT-3  | P2   | Extension             | Envoi TTS incertain : composeur bloqué jusqu'à la réouverture du module                               | **corrigé** `921fd3d`   |
| EXT-4  | P2   | Extension + Core      | Poll TTS toutes les 2 s qui reconstruit toute la session (~12 lectures), jamais en pause              | proposé (§ 7)           |
| EXT-5  | P2   | Extension             | Ajustement de solde par un modérateur rejoué après une erreur réseau (nouvelle clé)                   | proposé (§ 7)           |
| MH-2   | P2   | Music Hub             | Skip payé dans les dernières secondes : il tombe sur le titre suivant, qui est facturé                | **corrigé** (music-hub) |
| MH-3   | P2   | Music Hub / Core      | Nouveau `!song` (annonce, délai, SMTC) livré en Production au prochain déploiement, sans interrupteur | **corrigé** (music-hub) |
| CP-2   | P3   | Core (points)         | `setResults` hors transaction : résultat écrasé par une lecture périmée                               | **corrigé** `7e5f402`   |
| STU-6  | P3   | Studio (Votekick)     | Une exception arrête la boucle Votekick pour la session                                               | **corrigé** `a02fecc`   |
| MH-4   | P3   | Music Hub             | Cible du skip payé prise sur une lecture Studio périmée ; prix attendu facultatif                     | **corrigé** (music-hub) |
| divers | P3   | divers                | Voir § 9                                                                                              | documenté               |

## 4. Bugs reproduits, avec preuves

Chaque correction a un test qui **échoue sur le code d'avant** et passe après (vérifié par `git stash` de la seule
source corrigée).

- **EXT-1** — `apps/studio/server/e2e/lost-answer.e2e.ts`, vrai Lab, extension de Production. La requête atteint le
  Core, puis sa réponse est coupée (y compris la relance automatique), et le viewer reclique.
  - Avant : `expected 1, received 2` (deux clés, deux débits).
  - Après : une clé, un débit, et le son n'est joué qu'une fois.
- **EXT-2** — `apps/twitch-extension/test/session-reset.test.js` : `/state` en vol, puis reset, puis réponse.
  - Avant : la session fusionnée n'a ni `identity_shared`, ni `role`, ni `channel_id`.
- **CORE-1** — `apps/core-api/test/ext-frontier.test.ts` : `/tts/state` doit rendre les mêmes `pending_actions` que
  `/session`.
- **EXT-3** — `lost-answer.e2e.ts` (TTS) : après une réponse perdue, le composeur doit se débloquer seul.
  - Avant : bloqué sur « Vérification de ton envoi… ».
- **BOT-1** — `apps/twitch-bot/test/eventsub.test.ts` : une socket dont `close()` n'appelle jamais `onclose`.
  - Avant : `connected()` reste `true` et aucune reconnexion n'a lieu.
- **BOT-2** — `auth.test.ts` : Twitch en panne à 5 min de l'expiration.
  - Avant : `twitch_unavailable`.
  - Après : le jeton valide est utilisé, puis rafraîchi dès que Twitch répond.
- **STU-1** — `effects-player.test.ts` : la page A démarre un effet, puis la page B prend le relais.
  - Avant : l'effet reste « en cours » jusqu'à `endMs`.
  - Garde-fou testé : une page vivante qui joue un long effet n'est jamais coupée.
- **STU-2** — `obs-reverts-retry.test.ts` : `obs_request_timeout`, puis `obs_offline`, au moment de l'annulation.
  - Le cas « introuvable » (code 600) est toujours abandonné.
- **STU-3** — `channel-points-ack-retry.test.ts` : un « completed » perdu est renvoyé tel quel ; une réponse 409 du Core
  n'est pas relancée.
- **STU-4** — `word-game-studio.test.ts` : un flux muet, sans aucun ping.
  - Avant : jamais abandonné.
- **STU-5** — `votekick-mute.test.ts` : `restoreNow()` éteint le zoom, le bandeau et le pilote, rend le micro et
  n'efface rien du disque.
- **ECO-1** — `economy-canonical-interactions.test.ts` : un débit de 0 ne bouge rien ; son remboursement rend 0.
- **ECO-2** — `random-ban-chat.test.ts` : une demande en `refund = 'needed'` sans règlement (redémarrage) est remboursée
  une fois par le balayage, et un second passage ne fait rien.
- **MH-1 à 4** — `apps/core-api/test/music-rules.test.ts`, describe « audit 09/11 », et `spotify-runtime.test.ts`
  (skip dans les 3 dernières secondes : `TRACK_CHANGED`).

## 5. Corrections appliquées (commits locaux)

**Branche `audit/fiabilite-2026-11-09`** — 15 commits, un par correction, chacun avec son test.

| Commit    | Correction                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `af4a611` | Studio : annulation OBS conservée sur erreur transitoire (timeout, OBS hors ligne), relancée au tick suivant |
| `375ede5` | Studio : « completed » d'un job de points de chaîne relancé (5 essais, arrêt sur toute réponse du Core)      |
| `e1a6b04` | Core : `/v1/ext/tts/state` renvoie les crédits TTS (même liste que la session)                               |
| `e094740` | Extension : même clé d'idempotence pour le clic qui suit une réponse perdue (Soundboard, Bonk, boutique)     |
| `572f97e` | Extension : compteur de génération de session (un reset pendant un poll relit `/session`)                    |
| `2cc495b` | Core : débit de 0 sans effet sur le Wallet canonique (comme le Lab)                                          |
| `114ca88` | Core : remboursements `!rb` dus réglés par le balayage de 15 s                                               |
| `d656a1e` | Bot : fin de socket unique (`drop`) ; reconnexion sans attendre `onclose` ; chien de garde dès l'ouverture   |
| `91b4c47` | Bot : rafraîchissement anticipé en échec, le jeton encore valide reste utilisé                               |
| `1c27b1a` | Studio : effets d'une page OBS disparue (une autre page appelle) terminés « unknown » tout de suite          |
| `07d3513` | Studio : `restoreBeforeExit` restaure aussi la scène MUTED                                                   |
| `a02fecc` | Studio : boucle Votekick protégée (une exception est journalisée, la boucle continue)                        |
| `77d3741` | Studio : flux Jeu des mots abandonné après 60 s sans aucun octet, puis reconnecté                            |
| `7e5f402` | Core : `setResults` des points de chaîne toujours sous un vrai verrou de ligne                               |
| `921fd3d` | Extension : achat TTS incertain revérifié par le poll (même clé) ; `invalid_response` traité comme incertain |

Aucune correction ne change une règle métier, un contrat d'API ou une migration.

- Les seuls ajouts d'API sont un paramètre facultatif `key` sur des fonctions du client de l'extension, et un
  `settleAll()` interne.
- La correction ECO-1 aligne la Production sur le comportement du Lab, déjà permis par les schémas.

**Branche `feat/music-hub`** — commit d'audit séparé (voir son message) :

- skip de modération refusé (`songskip_busy`) tant qu'un skip payé est en route ; la récompense « Skip la musique »
  n'est pas modifiée ;
- skip payé refusé dans les 10 dernières secondes (`track_ending`), et Studio refuse à moins de 5 s de la fin ;
- cible prise seulement sur une lecture Studio fraîche ;
- prix attendu obligatoire pour un skip payé ;
- nouveau `!song` derrière `songV2`, activé dans le Lab seulement : un Core de Production garde le `!song` historique ;
- le toast de seek affiche la position réellement appliquée.

## 6. Optimisations mesurées

Aucune optimisation de performance n'a été appliquée. Je n'ai mesuré aucun gain réel qui justifie un risque avant le
live.

- **Le seul coût réel repéré** est EXT-4 : le poll TTS à 2 s reconstruit toute la session et ne s'arrête jamais,
  overlay replié compris.
  - Estimation de l'audit : environ 100 constructions de session par seconde pour 200 viewers laissés sur TTS.
  - Pas mesuré en charge réelle ; proposé au § 7.
- **Music Hub** : chaque poll du module Musique lit aussi les règles (3 à 4 requêtes) même quand le skip payé et l'Open
  Bar sont éteints. Mineur, à reprendre avant une ouverture en Production.

## 7. Corrections proposées, non appliquées (risque ou arbitrage)

- **CP-1 — reprise d'une rédemption de points interrompue après son commit.**
  - Correctif : sur une rediffusion `duplicate`, relancer les envois aval encore `pending` sans identifiant lié (son,
    Random Ban, demande Spotify, tous déjà idempotents par clé).
  - Non appliqué : la modification touche le chemin d'admission Production des points de chaîne. Elle mérite un test
    d'intégration dédié et ton avis.
- **BOT-3 — verrou de jeton périmé sur `/data`.**
  - Correctif : après l'obtention du bail, supprimer `${TWITCH_TOKEN_FILE}.lock` s'il a plus de 2 min.
  - Non appliqué : c'est une action d'exploitation sur le volume persistant du bot.
  - D'ici là : si le bot répète `twitch_unavailable` sans raison, vérifier ce fichier (`docs/TWITCH_OAUTH.md`).
- **EXT-4 — poll TTS coûteux.**
  - Correctif : `/tts/state` ne lit que la configuration TTS, l'état du viewer et le portefeuille ; le poll s'arrête
    quand le tiroir est fermé ou la page cachée.
- **EXT-5 — clé d'ajustement de solde des modérateurs** : réutiliser la clé si la même valeur est renvoyée après une
  erreur réseau.
- **Bot, P3** :
  - un 409 `not_lease_holder` est traité comme définitif dans l'outbox des points et les journaux ;
  - un abonnement fidélité refusé empêche l'abonnement des points de chaîne ;
  - toute révocation d'abonnement fait sortir le bot (code 78) ; le repli PC (`run-production.ps1`) s'arrête alors
    pour de bon.
- **Studio, P3** :
  - deux sources « Effets » (doublon non référencé) se partagent les effets ;
  - un faux toast « coupé » dans Alertes quand l'enregistrement échoue ;
  - unmute en attente sur une entrée renommée : fichier réécrit 4 fois par seconde.
- **Core, P3** :
  - jobs OBS de points sans expiration par le temps (attendent la prochaine réclamation de Studio) ;
  - un remboursement refusé bloque la tête de la boucle `expireQueued` (Lab seulement aujourd'hui) ;
  - l'expiration du module host peut rembourser une action qu'un lecteur vient de réclamer (Lab seulement) ;
  - un article de la boutique d'événements peut être montré et remboursé (en faveur du viewer, rare).
- **Music Hub** :
  - **décalage de versions** : un nouveau Core avec un Studio 0.1.27 transforme un skip payé en skip non ciblé ;
    → le skip payé exige un Studio à jour (éteint par défaut) ;
  - **fin de bail** : un skip réellement fait peut être remboursé si le bail expire (règle « jamais facturé sans
    preuve ») ;
  - **réannonces de l'overlay** après une coupure de Windows ou un redémarrage de Studio sans recharger OBS ;
  - **mode Hybride** : rejoué au rechargement de la source.

## 8. Tests exécutés

- **Base de référence** sur `origin/main`, avant toute correction :
  - Core 1 410 passés, 205 sautés ;
  - Studio 963 ; bot 287 ; extension 97 ;
  - build, typecheck et lint propres.
- **Après les corrections** (branche d'audit) : voir § 8 bis, rempli par la passe finale.
- **E2E Lab** (pile isolée, PGlite, données fictives) :
  - Soundboard, Bonk, boutique d'événements : 15/15 ;
  - TTS et Tombola, et `lost-answer` (2) : verts.
- **Music Hub** :
  - Core 112 (`music-rules`, `spotify-service`, `music-hub`, `music-live`) ;
  - Studio 84 (runtime, overlay, timing, vue) ;
  - E2E : voir § 8 bis.
- **Instabilités constatées, aucune n'est une régression** :
  - `creepy.test.ts` a échoué une fois sous charge (7 fichiers en parallèle), puis passé 3/3 seul : instabilité connue ;
  - `ext-frontier.test.ts` a échoué une fois sur « bad port » (port aléatoire refusé par `fetch`), puis passé 2/2 ;
  - **outillage E2E** : en fin de session, la pile gérée par Playwright est morte sans trace pendant `music-final`, y
    compris sur le code `cafbf80` inchangé. La même spec passe contre une pile lancée à la main.
    - Cause probable : `playwright.config.ts` démarre **toujours** une seconde pile PGlite (`core-lab`), même avec
      `--project lab`, et la machine finit par tuer le processus (plantage natif, comme le 0xC0000409 de vitest).
    - Proposé : ne démarrer la seconde pile que pour le projet `core-lab`.

### 8 bis. Passe finale

**Branche `audit/fiabilite-2026-11-09`**, avec les 15 corrections, suites lancées l'une après l'autre avec 3 workers :

| Suite                       | Résultat                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (8 espaces), lint | propres                                                                                                                                      |
| Core                        | 1 392 passés, 205 sautés, 117 fichiers. Le worker de `ext-frontier.test.ts` a planté (0xC0000409, Windows) ; relancé seul : 29/29, deux fois |
| Studio                      | 972 / 972 (99 fichiers ; base 963 + 9 nouveaux tests)                                                                                        |
| Bot                         | 290 / 290 (base 287 + 3)                                                                                                                     |
| Extension                   | 102 / 102 (base 97 + 5)                                                                                                                      |
| E2E Lab                     | Soundboard, Bonk, boutique d'événements : 15/15 ; TTS et Tombola 4/4 ; `lost-answer` 2/2                                                     |

**Branche `feat/music-hub`** (`831f8de`) :

- Core 112 (`music-rules` 28, `spotify-service`, `music-hub`, `music-live`) ; Studio 84 ;
- E2E `music-final`, `music-hub`, `music-live` et `music-overlay` ×2 : **5/5 sur une pile neuve lancée à la main**.
  Avec la pile gérée par Playwright, elles échouaient aussi sur le code d'avant l'audit (voir § 8).

## 9. Risques encore ouverts

- **La version de l'extension servie par Twitch est inconnue.** Les corrections EXT-1 à 3 ne protègent les viewers
  qu'une fois une nouvelle version **publiée** : cela demande ton GO et la procédure Twitch.
- **Rien n'a été testé contre Twitch, OBS ni Spotify réels.** Reconnexion EventSub, rafraîchissement des jetons, scènes
  OBS : seulement en simulation.
- **Les corrections Core et bot ne protègent la Production qu'après un déploiement**, qui demande ton GO. En
  attendant, la Production garde les comportements décrits au § 3.
- **CP-1, BOT-3 et EXT-4 restent ouverts** (§ 7).

## 10. Recommandations avant le prochain live (sans déploiement)

1. Ne publier **ni** Music Hub **ni** la branche d'audit sans relecture. Le live peut se faire sur la Production
   actuelle : rien d'audité n'est bloquant au point d'imposer un changement en urgence.
2. Si le bot ou une alerte se tait en live :
   - vérifier dans Studio, Centre de contrôle, que la session EventSub est vraiment active (BOT-1) ;
   - redémarrer le bot rétablit la situation.
3. Si une source « Effets » est rechargée pendant un Random Ban ou une Roue : attendre 2 minutes, ou redémarrer Studio
   (STU-1, corrigé seulement localement).
4. Sur mobile, après une coupure réseau pendant un achat Soundboard, vérifier le solde avant de recliquer (EXT-1, dans
   la version servie).

## 11. Recommandations après le live

1. Relire et fusionner `audit/fiabilite-2026-11-09` (PR), puis déployer le Core et le bot (GO), sortir une version
   Studio et soumettre une extension avec EXT-1 à 3.
2. Traiter CP-1, BOT-3 et EXT-4 avec leurs tests.
3. Corriger l'outillage E2E (seconde pile seulement pour `core-lab`) et documenter le nettoyage des 21 700 dossiers
   temporaires laissés par les tests dans `%TEMP%` (à supprimer par toi, pas automatiquement).
4. Music Hub : suivre la checklist ci-dessous avant toute ouverture.

## 12. Checklist GO / NO-GO — publier Music Hub au prochain stream ?

**Réponse : NO-GO.** Rien n'est faux dans le Lab simulé, mais les vérifications réelles indispensables n'ont pas eu lieu,
et deux décisions t'appartiennent.

| Composant                 | Statut                    | Preuves                                                                                                   | Tests manquants                                                               | Risque concret                                                                                    | Action                                                |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Core                      | NO-GO (prêt en Lab)       | 1 473 tests au dernier passage complet ; `music-rules` 28 ; règles du skip payé et de l'Open Bar prouvées | Déploiement de staging ; charge du poll Musique                               | `!song` change en Production (maintenant derrière `songV2`) ; façade Musique montée en Production | Relecture ; décider `songV2` en Production ; staging  |
| Bot                       | GO pour l'existant        | Inchangé par Music Hub ; mode annonce déjà en place                                                       | Annonce `!song` envoyée pour de vrai (scope `moderator:manage:announcements`) | Annonce refusée → repli en message (testé côté Core seulement)                                    | Un essai d'annonce en Lab réel                        |
| Extension Twitch          | NO-GO                     | E2E Lab, matrice responsive 12 tailles ; ni Hosted Test ni vrai appareil                                  | Hosted Test Twitch ; mobile réel ; version servie                             | Module Musique non publié ; conformité de la monétisation (Jetons) d'un jukebox                   | Hosted Test, puis décision de publication             |
| Studio                    | NO-GO (packaging corrigé) | Page overlay incluse dans le paquet (`stage.mjs`) ; tests Studio verts                                    | Installateur construit et installé ; `studio:release` (validation d'Antoni)   | Un Studio ancien face au nouveau Core : skip payé non ciblé                                       | Installer d'abord un Studio à jour, puis activer      |
| Spotify réel              | NO-GO                     | Lab réel prêt, **en lecture seule par défaut** ; jamais essayé avec le compte                             | Lecture réelle, écritures autorisées par session, 429 réels                   | Quotas du compte développeur ; conformité Spotify (pas de diffusion)                              | Essai Lab réel d'Antoni (`SPOTIFY_REEL_LAB.md`)       |
| Overlay OBS               | NO-GO                     | Captures Chromium (cycle de 30 s, changements rapides, languette tardive)                                 | **Vrai OBS** (CEF), source rechargée, scène masquée                           | Réannonces après une coupure ; rendu CEF                                                          | Essai OBS par Antoni (`MUSIC_OVERLAYS.md` § 9)        |
| Économie Jetons           | GO en Lab                 | Débit et job dans une transaction, clé d'intention, remboursement unique, concurrence testée              | Charge réelle                                                                 | Prix du skip payé à confirmer en usage ; un skip fait mais non prouvé est remboursé               | Valider les prix (25 000 / 500)                       |
| Modération                | GO en Lab                 | Permissions côté serveur (`music.player` supermods) ; skip de modération protégé (MH-1)                   | Essai à plusieurs, en direct                                                  | La récompense « Skip la musique » (désactivée) n'a pas la protection de MH-1                      | La garder désactivée                                  |
| Historique                | GO en Lab                 | Historique par Daily (`stream_day` de la session) ; « Skippé » seulement sur une commande                 | Un live réel qui traverse minuit                                              | Faible                                                                                            | —                                                     |
| Permissions et conformité | **NO-GO**                 | `MUSIC_HUB_STATE.md` § 10                                                                                 | —                                                                             | Spotify interdit la diffusion de son audio ; programme DJ de Twitch ; monétisation du jukebox     | **Arbitrage d'Antoni** (§ 12 de `MUSIC_HUB_STATE.md`) |
