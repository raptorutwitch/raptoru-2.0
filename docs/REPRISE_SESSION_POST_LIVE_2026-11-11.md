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

**Rien n'est en Production à l'heure de ce document** (voir § C) : tout est sur la PR #64. Ce qui attend Antoni :
la recette manuelle dans le Lab, puis la fusion de la PR, le déploiement du Core, la ligne de validation de
l'inventaire de l'extension (ZIP), et éventuellement la release Studio. Prochain grand chantier : Chaos V2 (lot 0).

## B. État exact du code

| Élément             | Valeur                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Dépôt               | `raptorutwitch/raptoru-2.0` (public)                                                                 |
| Branche             | `feat/post-live-moderation`, poussée                                                                 |
| PR                  | **#64** (ouverte ; voir le rapport final pour la CI et la fusion)                                    |
| Worktree            | `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live`                                        |
| Base                | `origin/main` `b4e65c6` (PR #63 fusionnée le 10/11)                                                  |
| Dernier commit code | `458e3581` (extension) ; documents ensuite                                                           |
| Non fusionné        | toute la passe (≈ 12 commits)                                                                        |
| Base de test        | PostgreSQL Docker `vk-test-pg` (port 55432), base `raptoru_postlive_test` (effaçable)                |
| Checkout principal  | `Documents\Raptoru 2.0` : **ne pas toucher** (données du Studio installé, très en retard sur `main`) |

Vérifier :

```sh
git -C "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live" fetch origin
git -C "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\post-live" log --oneline -15
gh pr view 64 --json state,mergedAt,mergeCommit,statusCheckRollup
```

## C. Production (relevé du 11/11 ~03:30 UTC, lecture seule)

| Composant       | Version                                      | Note                                                          |
| --------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Core            | `bbce104`, sain ; sauvegarde 10/11 04:00 UTC | `MUSIC_HUB_EXTENSION=on`, `ECONOMY_MODE=canonical`            |
| Bot             | `900637f`, bail actif                        | aucun changement nécessaire pour cette passe                  |
| Studio installé | 0.1.29 (`bbce104`)                           | compatible avec le nouveau Core (lignes Musique non envoyées) |
| Extension       | Hosted Test : ZIP `bbce1048a078` (shell v2)  | publique : `0bf7907` présumée                                 |
| Site            | `74f7542`                                    | non concerné                                                  |
| Base            | aucune migration dans cette passe            |                                                               |

Ne jamais supposer qu'un déploiement a eu lieu parce que la PR est fusionnée : `node scripts/coolify-deploy.mjs status
core` (avec `COOLIFY_URL=https://dashboard.raptoru.fr`).

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
- Prochaine : inventaire `apps/twitch-extension/release-inventory/INVENTAIRE-458e3581c96a.md` (77 commits) ; il manque
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
