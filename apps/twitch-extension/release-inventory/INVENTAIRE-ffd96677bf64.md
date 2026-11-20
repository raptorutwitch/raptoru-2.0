# Inventaire de l'emballage de Production — source ffd96677bf64

Écart : **9 commits** de l'extension depuis `PUBLISHED` = `be1744e75f63` (version « Released » de la console Twitch,
prouvée par Antoni le 20/11/2026). C'est l'inventaire `298e940290ab` (8 commits du Casino V1, validé le 20/11, ZIP du
Hosted Test : 2e2eaf3ae34a) **plus un commit visuel du Blackjack** (PR #97, `main` 76875d47).

Préparé par l'agent le 2026-11-20. **Non validé** : la ligne de validation appartient à Antoni ; tant qu'elle manque,
l'emballage de Production refuse d'écrire le ZIP (`npm run package:production -w @raptoru/twitch-extension -- --shell v2`).
Le ZIP est **complet**, pas un différentiel : toute l'extension du commit emballé (modules déjà publiés et Casino V1
entier). Il remplace le ZIP 2e2eaf3ae34a du Hosted Test. Aucun changement côté Core, bot ni Studio : le Core en
Production (1f05b97c) suffit (routes `/v1/ext/casino/*`, `CASINO_EXTENSION`).

## Nouveau depuis le ZIP du Hosted Test — 1

- ffd96677 2026-11-20 fix(casino): blackjack labels — BLACKJACK pill sized to its text, the dealer side bet reads BJ
  - Blackjack naturel d'un joueur : « BLACKJACK » dans une pastille dorée à la taille du texte, au-dessus des cartes
    (avant : « BJ » étiré sur toute la place, à cause d'un conflit de classe avec la racine de la table).
  - Même conflit corrigé pour le total « BJ » de la banque et le message de résultat d'un Blackjack (lignes qui se
    chevauchaient au centre du tapis).
  - Pari sur le score de la banque : libellé visible « BJ » au lieu de « B » (pari, cotes et règlement inchangés).

## Casino (machine à fruits + Coffre, roulette, machine à émotes, blackjack) — 8, déjà dans le Hosted Test

- 298e9402 2026-11-20 feat(casino): extension — the emote machine and the multiplayer blackjack in Mini-jeux; Studio controls
- 02695b1b 2026-11-19 feat(casino): BONUS drawn as a golden chest, games follow the Wallet, roulette quick bets
- 524d0d18 2026-11-18 fix(mini-jeux): no giant icon when Mini-jeux opens — nothing painted before arcade.css applies
- c4206c2e 2026-11-18 feat(casino): a real spectator panel, and the roulette's true ALL-IN (off until Antoni sets its cap)
- f9515627 2026-11-18 fix(casino): spectators start with the player (<1 s) and the screen no longer flashes
- 850187ae 2026-11-18 feat(casino): spectators follow a player, live — never a result ahead of the player's screen
- 22310e85 2026-11-17 fix(casino): security review — shares only while the casino plays, the wallet cap before the draw, strict ids
- 91839307 2026-11-17 feat(casino): extension, Studio and Lab — the slot machine with the Coffre, the roulette, spectators

Validé par Antoni : oui
