# Passe post-live du 11/11/2026 (passe du soir + mission de nuit)

Mandats « PASSE POST-LIVE » puis « OPÉRATION NOCTURNE DE FINALISATION » d'Antoni, après le live test réel de la
nouvelle extension et du Music Hub (testeurs : Aouh, modérateur ; Jinai_, Goz___, PsyCoWiNi, happybearman).

- Branche `feat/post-live-moderation` (depuis `origin/main` `b4e65c6`), worktree
  `Documents\Raptoru 2.0 - Worktrees\post-live`, **PR #64**.
- État de livraison : voir § 4 (rien n'est présenté comme déployé sans preuve).

## 1. Lots

| Lot | Avant                                                                    | Cause                                                                                        | Après (branche)                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Les modérateurs ne peuvent plus créditer/retirer en chat                 | `!addpoints` (StreamElements) jamais porté ; `!wallet` lit l'ancienne table `staff_roles`    | `!addpoints`/`!crediter`, `!removepoints`/`!debiter` ; `!wallet add\|remove` passe par la même décision ; `!wallet set` = streamer seul. Une seule opération : `wallet_adjust` de la modération        |
| A2  | Tombola : « 6 participants, 5 lignes »                                   | plafond de 5 lignes dans l'aperçu (`shared/tombola-v2.js`) ; le Core envoyait tout           | jusqu'à 30 lignes (l'écran défile), au-delà « +N · Tout voir » ; mise à jour en direct                                                                                                                 |
| A3  | Achats Spotify invisibles et non remboursables par la modération         | les achats Musique n'étaient pas dans l'historique D4                                        | achats Musique dans l'historique (titre dans la ligne, filtre « Musique ») et la fiche viewer ; « Rembourser » une seule fois (permission « Portefeuille »), seulement une demande terminée et débitée |
| B   | « Wallet admin », recherche sans `@`                                     | —                                                                                            | « Portefeuille » partout ; lien → recherche `@pseudo` (viewers canoniques inclus) → fiche sur le Portefeuille ; la fiche dit Lab ou Jetons réels                                                       |
| C   | Pas d'inventaire des commandes                                           | —                                                                                            | [INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md) ; conception [CATALOGUE_COMMANDES_SITE.md](CATALOGUE_COMMANDES_SITE.md) (rien publié)                                                 |
| D   | Tutoriel : `!jetons`, `!cashin`, `!oracle`, « TTS 2 000 »                | texte figé de l'ancien projet                                                                | seulement des commandes existantes, aucun prix ni délai écrit en dur (les boutons affichent le coût réel)                                                                                              |
| E   | Le nouveau Core aurait cassé l'extension du Hosted Test et Studio 0.1.29 | les anciens clients ne connaissent pas le module `music` (`MODS[m].c` sur une ligne Musique) | lignes Musique envoyées seulement avec `music=1` (nouveaux clients) ; un ancien client garde l'historique d'aujourd'hui : **le Core peut être déployé seul**                                           |

Code : `apps/core-api/src/wallet/admin-chat.ts` (commandes, `!wallet`), `wallet/chat.ts` (crochet `moderation`),
`ext/public-frontier.ts` (branchement), `lab-moderation/service.ts` (Musique, `music`, recherche, fiche),
`http/lab-moderation-routes.ts`, `ext/ext-facade.ts`, `spotify/service.ts` (`moderationRefund`) ; extension
`shared/moderation-v2.js`, `shared/tombola-v2.js`, `shared/experience.js` ; Studio `web/src/mod/mod.ts`,
`web/src/pages/moderation-journal.ts`, `server/src/lab-moderation/proxy.ts`, `server/src/extension-lab/lab-ebs.ts`.

## 2. Règles de sécurité appliquées

- **Autorisation côté serveur** : le Core décide. « Streamer » par identité seulement ; le badge modérateur seul ne
  donne rien : il faut l'équipe Coulisses (supermod ou permission « Portefeuille »). `!wallet` (route sans badge) lit
  l'équipe seulement.
- **Identité exacte** : Helix par login exact ou mention réelle ; sans Helix, un seul viewer connu ; ambigu ou inconnu
  → rien. Un viewer jamais vu est enregistré sous son vrai login.
- **Montants** : entiers stricts, 1 à 1 000 000 en chat ; jamais sous 0 ; plafond du Wallet.
- **Doublons** : clé par message Twitch (`chat:` / `chat-wallet:`) ; remboursement Musique verrouillé, refusé s'il est
  fait, sans débit d'origine ou demande non terminée ; le skip garde son statut (prix des skips suivants inchangé).
- **Audit** : `lab_moderation_audit` (acteur, rôle, motif, avant/après) ; `!wallet set` : ledger du Wallet avec l'auteur.
- **Pas de second système de Jetons** ; aucune migration.

## 3. Tests (11/11, nuit)

Automatiques (aucun n'est une validation) :

- Core : **1 510 passés**, 210 sautés (fichiers PostgreSQL), 2 workers.
- PostgreSQL réel (base locale `raptoru_postlive_test`) : `economy-lot6` (un `!addpoints` et un `!wallet` livrés à deux
  Cores = un seul crédit ; deux `!removepoints` simultanés jamais sous 0), `music-hub.integration` (remboursements
  concurrents = un seul) ; suite d'intégration complète : voir § 4.
- Extension : 132 unitaires. Studio serveur : 1 061 (passe du soir) + suites modération relancées.
- E2E Lab (Chromium, vraie interface) : `tombola-participants` (0 → 1 → 6/7 → 29/30/31 → 120, liste complète, zoom 150 %,
  318/400/565 px) ; `moderation-portefeuille` (lien, `@viewer`, crédit, cadenas modérateur, achat Musique remboursé une
  fois, filtre Musique, supermod, recherche vide, Studio ouvre l'achat sans erreur) ; non-régression `music-hub`,
  `music-final`, `music-roles`, `lifecycle`, `commands-public` : 10/10.
- typecheck Core / Studio ; eslint et Prettier sur les fichiers modifiés ; build Studio web.

Non vérifiable ici : Production (Helix réel, vrais rôles, vrais Jetons), un vrai OBS, l'extension hébergée par Twitch.
Recette manuelle : [RECETTE_MODERATION_EXTENSION.md](RECETTE_MODERATION_EXTENSION.md).

## 4. Livraison

Voir [REPRISE_SESSION_POST_LIVE_2026-11-11.md](REPRISE_SESSION_POST_LIVE_2026-11-11.md) § B–C pour l'état final
vérifié (PR, CI, fusion, déploiements) et les gestes restants.

## 5. Décisions laissées à Antoni

- `!solde @x` public ou restreint ([INVENTAIRE_COMMANDES_TWITCH.md](INVENTAIRE_COMMANDES_TWITCH.md) § 4).
- `!wallet set` : garder (streamer seul) ou retirer ; mots des modules à réserver dans Commands V2.
- Catalogue public : lancer les lots de [CATALOGUE_COMMANDES_SITE.md](CATALOGUE_COMMANDES_SITE.md) § 8 ou non.
