# Caution + Votekick V2 — livraison pour le live du 23/10/2026 (20 h)

- **Branche** `feat/votekick-v2` (worktree `vk-wt`), commits **locaux, non poussés** : `7588f9e` (Votekick câblé),
  `04484f2` (compteur de test), `9fd57de` (Node 22.23.4 épinglé), plus le commit de cette doc.
- **Base** : `2d80c2a` = `origin/main` = Production. Poussée = avance rapide, sans conflit.
- **Tout est OFF par défaut**. Rien n'est poussé, déployé, migré ni installé sans le GO d'Antoni.

## 1. Artefacts

| Artefact              | Où                                                                                                  | Contenu                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Core                  | commit `9fd57de` (après push sur `main`)                                                            | Caution + Votekick, flags `CAUTION_CHAT` / `VOTEKICK_CHAT` (false par défaut), Node 22.23.4 épinglé          |
| Migrations Production | `supabase/migrations/20261105130000_caution.sql`, `20261106130000_votekick.sql`                     | additives, ré-exécutables ; sur la base Production (41 fichiers) : **ces deux seulement** (testé)            |
| Bot                   | même commit                                                                                         | exécuteurs Caution / Votekick, flags `CAUTION` / `VOTEKICK` (false par défaut)                               |
| Studio `0.1.7-sup.3`  | `C:\Users\Antoni\Documents\rs-vk\apps\studio\desktop\release\Raptoru Studio Setup 0.1.7-sup.3.exe`  | **tout 0.1.7-sup.2** (supervision, OAuth, Soundboard Ctrl+R) **+** mute OBS Votekick sur « Micro » + overlay |
| Source OBS overlay    | `http://127.0.0.1:4100/votekick/variants/variants.html?v=D&studio` (1920×1080, à ajouter à la main) | variante D provisoire, alimentée par Studio                                                                  |

## 2. Ordre de déploiement (hors live, chaque étape sur GO)

1. **Push** `feat/votekick-v2` → `origin/main` (avance rapide depuis `2d80c2a`).
2. **Sauvegarde PostgreSQL** à la demande (Coolify, comme le 22/10).
3. **Core** : `node scripts/coolify-deploy.mjs plan core <sha>`, puis `deploy core <sha> --migrations-approved --go`
   (sauvegarde de moins de 60 min exigée).
   - Si le script refuse (journal illisible, comme le 22/10) : déploiement par l'interface Coolify, puis **tout de
     suite** dans le Terminal du Core : `node apps/core-api/dist/scripts/migrate.js` → attendu : `applied:
20261105130000_caution.sql, 20261106130000_votekick.sql`.
   - Entre le déploiement et la migration, le minuteur Votekick écrit une erreur « relation does not exist » toutes
     les 500 ms : sans effet (flags OFF, erreur interceptée), elle s'arrête avec la migration.
   - Contrôles : `/health` et `/ready` à 200 ; Studio « Production connecté » ; `node -v` = v22.23.4.
   - Flags toujours OFF : aucun changement visible en chat.
4. **Bot** : via l'interface Coolify, avec le même SHA (le script refuse un déploiement de bot quand la plage contient
   des migrations du Core : limite connue).
   - Contrôles : Centre de contrôle « Actif », version = nouveau SHA, chat et EventSub connectés ; flags `CAUTION`
     et `VOTEKICK` affichés à `false`.
5. **Studio 0.1.7-sup.3** : fermer Studio, lancer l'installateur, rouvrir.
   - Contrôles : « À propos » = 0.1.7-sup.3 ; supervision et Comptes Twitch comme en sup.2 ; Soundboard activée et
     conservée après Ctrl+R.
6. **OBS** :
   - ajouter une source navigateur « Votekick (V2) » avec l'URL ci-dessus, 1920×1080, dans le DSK « Alerte complète »
     (ou la scène voulue) ;
   - vérifier que « Micro », « overlay cam shushu » (filtres « Votekick Zoom », « Votekick Mute ») et « Votekick Zoom
     Drive » sur « Micro » existent.
7. **Activation Caution** : `CAUTION_CHAT=true` (Core) et `CAUTION=true` (bot), puis redémarrage de chacun.
   - Contrôle : log du bot `[caution] exécuteur prêt — lecture : oui, levée : oui`.
   - Test réel contrôlé : un compte de test timeout 2 min par un modo → `!caution compte` → `oui` → levé, 2 000
     Jetons débités une fois (Studio : Caution « libéré »).
8. **Activation Votekick** : `VOTEKICK_CHAT=true` (Core) et `VOTEKICK=true` (bot), puis redémarrage.
   - Contrôle : log du bot `[votekick] exécuteur prêt — lecture : oui, timeout : oui`.
   - Test réel : `!votekick compte_de_test` (3 votes `!kick`) → overlay en direct puis verdict → compte de test timeout
     la bonne durée.
   - Test du mute (hors live) : un vote perdu par le streamer → « Micro » coupé, bandeau → fin → « Micro » rétabli
     (voix en dernier). Le payer avec `!caution raptoru_` doit aussi rétablir.

Caution et Votekick s'activent **séparément** (deux paires de flags).

## 3. Retour arrière (rapide)

- **Fonctionnel** : remettre les flags à `false` (Core et/ou bot), puis redémarrer. Rien n'est supprimé.
- **Code** : `deploy core 2d80c2aa548a1999fd1b3bfa5d44ea13104662e5 --rollback --go`, puis le bot sur `2d80c2a`
  (Coolify).
  - Les tables `caution_requests` et `votekick_*` restent (additives, ignorées par `2d80c2a`).
  - Ce retour remet aussi le tag Node flottant : la base du VPS est déjà en 22.23.4 d'après la vérification du 23/10.
- **Studio** : désinstaller, puis réinstaller `0.1.7-sup.2` (`rs-sup\apps\studio\desktop\release\`). Un mute en cours
  est restauré par Studio à son redémarrage (fichier `votekick-mute.json`).
- **Jamais** de retour à SAMMI.

## 4. Tests (automatiques)

| Suite                                                                        | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core, Votekick service (PGlite)                                              | 18/18 : ouverture, refus (inconnu, modo, soi-même, modérateurs illisibles), cooldown, rejeu, bulletins, verdicts (majorité, Perfect, Backfire, pile ou face), sanction sur la bonne personne, 403 / non envoyé / incertain, tentative périmée, exécuteur absent, lecture perdue ×3, redémarrage du Core, simulateur, mute du streamer (démarré, expiré, Studio absent), **Caution sur le vrai mute** (un seul débit, mute terminé « caution ») |
| Core, chaîne Core ↔ bot ↔ Twitch simulé                                      | 5/5 : timeout une fois et pour la bonne durée, modo refusé, 403 / 500 appliqué / 500 non appliqué, bot mort pendant Ban User (journal, jamais renvoyé), Backfire = initiateur                                                                                                                                                                                                                                                                  |
| PostgreSQL réel, deux Cores                                                  | Votekick 3/3 (un vote, un bulletin par votant, un verdict, un job de timeout, un mute, Caution / fin du mute) ; suite d'intégration complète 72/72                                                                                                                                                                                                                                                                                             |
| Core complet                                                                 | 992/993 en parallèle ; le seul échec (`channel-points.test.ts`) passe seul 9/9 (charge)                                                                                                                                                                                                                                                                                                                                                        |
| Bot complet                                                                  | 253/253                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Studio combiné (Votekick + sup.2)                                            | 63 fichiers, 611/611 (dont runtime Votekick 8/8 : mute « Micro » puis restauration, OBS absent, élément absent, refus à mi-chemin → micro rétabli, rapport perdu renvoyé)                                                                                                                                                                                                                                                                      |
| Typecheck (schemas, Core, bot, Studio serveur / page / desktop), lint, build | OK                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Non testé automatiquement** (vrai Twitch, vrai OBS) : les tests réels des étapes 7 et 8.

## 5. Risques résiduels

- **Mute OBS** : les noms viennent de la collection « Twitch Dofus » telle qu'enregistrée sur disque (19/09) ; l'OBS
  actuel peut différer. Un élément absent → mute refusé **avant toute modification** (« Mute du streamer impossible »),
  jamais un micro coupé.
- **Overlay variante D** : jamais affichée dans le vrai OBS ; lisibilité et performance à regarder.
- **Studio fermé** pendant un vote perdu par le streamer → pas de mute (annoncé en chat), aucun autre effet.
- **Caution** : `oui` pendant que le Core redémarre → l'état est en base, repris ; levée incertaine → « à vérifier »,
  jamais remboursée automatiquement (règle documentée).
