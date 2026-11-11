# Reprise de session : passe post-live du 11/11/2026

Complément daté de [REPRISE.md](REPRISE.md) (le point d'entrée canonique reste REPRISE.md). Écrit à la fin de la
mission de nuit du 11/11. **Revérifier chaque état avant d'agir** (§ B, commandes en lecture seule).

## A. Résumé immédiat

Raptoru 2.0 est la plateforme de stream auto-hébergée du streamer Twitch `raptoru_` : un Core (décide de tout,
économie des Jetons), un bot `LeCroupier_` (Twitch), Raptoru Studio « Coulisses » (Electron, pilote OBS), l'extension
Twitch « Raptoru Live » et raptoru.fr. Antoni décide seul.

Après le live test du 10/11 (extension shell v2 + Music Hub très appréciés), la passe post-live a corrigé ce qu'Aouh
avait remonté : les modérateurs ne pouvaient plus créditer/retirer des Jetons en chat, la Tombola montrait 5
participants sur 6, les achats Spotify n'étaient ni visibles ni remboursables depuis la modération. Elle ajoute le
Portefeuille (ex « Wallet admin ») avec recherche `@pseudo`, unifie toutes les portes économiques sur une seule
décision, corrige le tutoriel de l'extension et documente toutes les commandes du chat.

**Livré le 11/11** (§ C) : Core `052ab2ec` déployé, Studio 0.1.30 publié. Ce qui attend Antoni : installer
Studio 0.1.30, la recette, la ligne de validation de l'inventaire puis le ZIP en Hosted Test. Prochain grand chantier : Chaos V2 (lot 0).

## B. État exact du code

| Élément             | Valeur                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dépôt               | `raptorutwitch/raptoru-2.0` (public)                                                                                                 |
| Branche             | `feat/post-live-moderation`, poussée                                                                                                 |
| PR                  | **#64** ouverte, **non fusionnée** ; le commit à fusionner = la tête de la PR **si** sa CI est entièrement verte (`gh pr checks 64`) |
| Worktree            | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live`                                                                        |
| Base                | `origin/main` `b4e65c6` (PR #63 fusionnée le 10/11)                                                                                  |
| Dernier commit code | `bb870081` (correctif Tombola, extension + E2E) ; Core `c4ed1198` ; documents ensuite                                                |
| Non fusionné        | toute la passe (16 commits sur `b4e65c6`)                                                                                            |
| Base de test        | PostgreSQL Docker `vk-test-pg` (port 55432), base `raptoru_postlive_test` (effaçable)                                                |
| Checkout principal  | `Documents\Raptoru 2.0` : **ne pas toucher** (données du Studio installé, très en retard sur `main`)                                 |

Vérifier :

```sh
git -C "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live" fetch origin
git -C "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live" log --oneline -15
gh pr view 64 --json state,mergedAt,mergeCommit,statusCheckRollup
```

## C. Production (relevé du 11/11 ~11:40 UTC, après la livraison)

| Composant       | Version                                               | Preuve                                                                                                                                                                             |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core            | **`052ab2ec`** (fusion de la PR #64), sain            | `coolify-deploy.mjs deploy` : DÉPLOYÉ, déploiement `xtugwkjyb0f9mnrpy5bfz98e`, 125 s, `/health` `/ready` 200, le Core rapporte `052ab2ec`                                          |
| Bot             | `900637f`, bail actif sur le nouveau Core             | `status bot` ; non redéployé (aucun fichier utile au bot modifié)                                                                                                                  |
| Studio publié   | **0.1.30** (`052ab2ec`), public                       | workflow « Studio — construire / publier » run 43011771406 : « UPGRADE OK — 0.1.29 → 0.1.30 : 8 fichiers identiques à l'octet », publication + re-téléchargement anonyme identique |
| Studio installé | 0.1.29 (`bbce104`)                                    | `build-info.json` ; **installation de 0.1.30 = Antoni**                                                                                                                            |
| Extension       | Hosted Test : ZIP `bbce1048a078` (shell v2), inchangé | nouveau ZIP **non construit** (ligne de validation absente, § C2)                                                                                                                  |
| Site            | `74f7542`                                             | `raptoru.fr/api/status`                                                                                                                                                            |
| Base            | aucune migration ; sauvegarde Coolify 11/11 04:00 UTC | `status core`                                                                                                                                                                      |

Retour arrière Core : `node scripts/coolify-deploy.mjs deploy core bbce1048a0783cc1bdbb9a2ca86fb1769ce01872 --rollback
--go` (aucune migration à annuler). Studio : réinstaller 0.1.29 depuis les releases publiques.

### C2. Livraison du 11/11 (GO d'Antoni) : fait et restant

| Étape         | État                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PR #64        | fusionnée par Antoni (11:04 UTC), commit de fusion `052ab2ec` = tête de la PR `6c4d922` ; CI de `main` verte (run 43008949938)   |
| Core          | **déployé** `052ab2ec` (plan PRÊT, aucune migration, hors live, vérifications OK, journal de démarrage sans erreur)              |
| Bot           | rien à faire                                                                                                                     |
| Studio        | **0.1.30 publiée** (mise à jour testée par le workflow) ; **à installer par Antoni** (« Rechercher une mise à jour »)            |
| ZIP extension | **non construit** : la ligne « Validé par Antoni : oui » manque à `INVENTAIRE-bb8700814939.md` (elle atteste ta recette)         |
| Hosted Test   | inchangé ; même domaine API (`https://core.raptoru.fr/v1/ext`) que l'archive actuelle : aucun réglage Twitch à changer           |
| Compatibilité | Studio 0.1.29 et l'extension actuelle ne reçoivent pas les lignes Musique (`music=1`) : prouvé par tests, pas relu en Production |

Gestes restants d'Antoni :

1. Installer Studio 0.1.30 (Studio › « Rechercher une mise à jour »), puis ouvrir Modération › Historique.
2. Petit test réel hors live ou en live : `!addpoints @un_viewer 1 test`, puis `!removepoints @un_viewer 1`.
3. Recette de l'extension dans le Lab ([RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md)), puis
   ajouter la ligne `Validé par Antoni : oui` à la fin de
   `apps/twitch-extension/release-inventory/INVENTAIRE-bb8700814939.md` (sur `main`, ou demander à l'agent de le faire
   sur ta confirmation écrite), puis dans `apps/twitch-extension` :
   `npm run package:production -- --shell v2` → `release/raptoru-live-PRODUCTION-<commit>-depuis-0bf7907-78-commits-shell-v2.zip`
   et son `.sha256`.
4. Téléverser ce ZIP en Hosted Test dans la console Twitch (même procédure que le 10/11,
   [extension/TWITCH_SUBMISSION_2026-11-10.md](extension/TWITCH_SUBMISSION_2026-11-10.md) § 7) ; **ne pas** soumettre ni
   publier. Retour : le ZIP `bbce1048a078`.

### C3. Correctif Tombola du 11/11 (CI « not attached »)

- **Symptôme** (CI run 42962307407, puis reproduit 1 fois sur 3 en local) : « Tout voir » à 120 participants,
  `scrollIntoViewIfNeeded` sur la dernière ligne → « Element is not attached to the DOM ».
- **Cause** : `build()` dessinait l'écran sans remplir le cache de `setSlot` ; la première lecture après tout nouvel
  écran réécrivait donc chaque emplacement même inchangé (120 lignes reconstruites ~1 s après l'ouverture, sous le
  défilement et le survol du viewer, avec perte du défilement des noms longs). Pas une régression du Core ni du
  responsive : un redessin inutile du client, rendu visible par la liste de 120 du nouveau test.
- **Correctif** (`bb870081`, `extension/shared/tombola-v2.js`) : `build()` mémorise le html de chaque emplacement avec
  les mêmes fonctions que `updateSlots` ; rien n'est réécrit tant que l'état du Core ne change pas.
- **Test** : la liste complète doit garder ses lignes à travers trois lectures (échouait 4/4 avant le correctif) ; la
  manche du test est prolongée de 10 min (sous charge, elle pouvait se tirer au milieu d'une vérification).
- **Vérifications** : 5/5 en local ; conteneur Linux Playwright 1.63 (Node 24) : spec 3/3, suite E2E complète 133/133.
  Sous Windows, une longue séquence E2E locale meurt vers 10 min (limite connue) : la CI Linux fait foi.
- **Conséquence livraison** : nouveau commit d'extension → inventaire renommé `INVENTAIRE-bb8700814939.md` (78 commits).

Gestes d'Antoni, dans l'ordre (chacun sur son GO) :

1. Recette Lab : [RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md) (`Ouvrir Music Hub (Lab).cmd`).
2. Fusionner la PR #64 sur GitHub (bouton « Merge pull request »), attendre la CI de `main`.
3. Core : `node scripts/coolify-deploy.mjs plan core <sha40 de main>` (PRÊT attendu, aucune migration), puis
   `deploy core <sha40> --go` hors live, ou le workflow GitHub « Déployer Core / bot ». Vérifier `status core`.
   Retour : `deploy core bbce1048a0783cc1bdbb9a2ca86fb1769ce01872 --rollback --go`.
4. Petit test réel : `!addpoints @un_viewer 1 test` puis `!removepoints @un_viewer 1` ; Studio 0.1.29 ouvre toujours sa
   modération sans erreur.
5. Extension : ajouter « Validé par Antoni : oui » en fin d'inventaire, `npm run package:production -- --shell v2` dans
   `apps/twitch-extension`, téléverser en Hosted Test ; retour : ZIP `bbce1048a078`.
6. Studio : `npm run studio:release` après validation (achats Musique dans la modération native).

## D. Travail réalisé (détail : [RAPPORT_POST_LIVE.md](RAPPORT_POST_LIVE.md))

| Fonction                         | Cause                               | Code                                                             | Tests                           | Statut                   | Retour arrière       |
| -------------------------------- | ----------------------------------- | ---------------------------------------------------------------- | ------------------------------- | ------------------------ | -------------------- |
| `!addpoints` / `!removepoints`   | commandes SE jamais portées         | `core-api/src/wallet/admin-chat.ts`                              | unitaires 18, PostgreSQL réel   | PR #64                   | redéployer `bbce104` |
| `!wallet` unifié, `set` streamer | `staff_roles` obsolète              | `wallet/chat.ts`, `ext/public-frontier.ts`                       | unitaires, PostgreSQL réel      | PR #64                   | idem                 |
| Portefeuille + `@pseudo`         | demande d'Aouh                      | `extension/shared/moderation-v2.js`, `lab-moderation/service.ts` | E2E Lab                         | PR #64 + ZIP à faire     | ZIP `bbce1048a078`   |
| Musique dans la modération       | achats invisibles                   | `lab-moderation/service.ts`, `spotify/service.ts`                | unitaires, PostgreSQL réel, E2E | PR #64                   | redéployer `bbce104` |
| Compatibilité `music=1`          | anciens clients sans module `music` | routes, façade, proxy Studio                                     | unitaire + E2E Studio           | PR #64                   | —                    |
| Tombola 30 lignes                | plafond de 5                        | `extension/shared/tombola-v2.js`                                 | E2E 0 → 120                     | PR #64 + ZIP à faire     | ZIP `bbce1048a078`   |
| Tutoriel                         | texte de l'ancien projet            | `extension/shared/experience.js`                                 | unitaires extension             | PR #64 + ZIP à faire     | ZIP `bbce1048a078`   |
| Studio : module Musique          | crash potentiel                     | `studio/web/src/mod/mod.ts`, journal                             | E2E Studio                      | PR #64 + release à faire | Studio 0.1.29        |

## E. Modération et économie

- **Permission « Portefeuille »** (grant `wallet`, D4 `wallet.admin` et `refund.manual`) : streamer, supermods,
  modérateurs à qui elle est accordée dans Coulisses › Équipe.
- **`!addpoints @x N [motif]`** (`!crediter`), **`!removepoints @x N [motif]`** (`!debiter`) : 1 à 1 000 000, jamais
  sous 0, pas sur soi (sauf streamer), login exact, une fois par message, audit.
- **`!wallet add|remove`** : même opération ; la route du bot ne porte pas le badge → décision par l'équipe Coulisses
  seulement. **`!wallet set`** : streamer seulement. `staff_roles` ne décide plus rien en Production.
- **Remboursement Musique** : depuis l'historique ou la fiche ; seulement une demande terminée et débitée ; une seule
  fois (verrou, testé à deux Cores) ; un skip remboursé garde son statut (le prix des suivants ne change pas) ; Open Bar
  « gratuit », jamais remboursable.
- **Risques de doublons** couverts : message rejoué, deux Cores, double clic, réponse perdue (clé d'idempotence).

## F. Extension

- Dernière archive : `raptoru-live-PRODUCTION-bbce1048a078-depuis-0bf7907-72-commits-shell-v2.zip`
  (`80bdab00…f9f5b`), Hosted Test.
- Prochaine : inventaire `apps/twitch-extension/release-inventory/INVENTAIRE-bb8700814939.md` (78 commits) ; il manque
  la ligne « Validé par Antoni : oui » ; puis `npm run package:production -- --shell v2` ; SHA calculé à ce moment-là.
- Testé (Lab, Chromium) : Tombola, Portefeuille, remboursement Musique, filtre Musique, rôles. À tester par Antoni :
  tout le reste de [RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md), puis en Hosted Test.

## G. Lire en priorité

1. [REPRISE.md](REPRISE.md), puis ce fichier.
2. [RAPPORT_POST_LIVE.md](RAPPORT_POST_LIVE.md), [RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md).
3. [INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md), [CATALOGUE_COMMANDES_SITE.md](CATALOGUE_COMMANDES_SITE.md).
4. [INVENTAIRE_RELEASES.md](INVENTAIRE_RELEASES.md) § 3.0, [OPERATIONS.md](OPERATIONS.md) § 3–4 (déploiement, retour).

## H. Backlog

- **Critique** : aucun bug connu bloquant.
- **Important** : recette Lab d'Antoni ; fusion de la PR #64 ; déploiement du Core ; ZIP validé en Hosted Test.
- **Finition** : release Studio (modération native : achats Musique) ; un viewer participant au-delà des 30 plus
  récents n'est plus dans l'aperçu de la Tombola (il reste dans « Tout voir ») ; `!help`.
- **Décisions d'Antoni** : `!solde @x` ; `!wallet set` ; mots réservés ; catalogue public ; commandes historiques.
- **Recherche** : catalogue raptoru.fr (conçu, lots § 8 du document).
- **Prochain grand chantier** : Chaos V2 (§ I).

## I. Chaos V2 (rappel)

Recherche faite et documentée le 10/11 ([chaos/](chaos/ARCHITECTURE_CHAOS_V2.md)) ; **aucun développement commencé**.

1. Lot 0 : mesures de performance (PresentMon), couper les fenêtres Halloween permanentes, choisir 59 / 165 Hz.
2. Lot 1 : prototype natif de retournement d'écran (capture WGC sans curseur), flip seul.

Décisions à garder : aucun contrôle du jeu modifié ; capture sans curseur ; pas de faux curseur ; pas de carré de
masquage ; performances locales ; restauration fiable.

## J. Prompt de reprise

```text
Voici le contexte actualisé de Raptoru 2.0. Lis docs/REPRISE.md puis docs/REPRISE_SESSION_POST_LIVE_2026-11-11.md
(worktree C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live, branche feat/post-live-moderation, PR #64),
vérifie les états réels (git, gh pr view 64, coolify-deploy status core|bot, build-info du Studio) et reprends à partir
des tâches restantes sans refaire les travaux terminés. Respecte CLAUDE.md : aucun push, fusion, déploiement, release,
ZIP ou action Production sans GO explicite d'Antoni pour cette étape.
```
