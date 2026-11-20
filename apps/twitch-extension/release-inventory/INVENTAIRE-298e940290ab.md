# Inventaire de l'emballage de Production — source 298e940290ab

Écart : **8 commits** de l'extension depuis `PUBLISHED` = `be1744e75f63`, **prouvé** : la version « Released » de
la console Twitch est le ZIP `raptoru-live-PRODUCTION-be1744e75f63-depuis-0bf7907-95-commits-shell-v2.zip`,
relevé par Antoni le 20/11/2026. Les 95 commits de l'inventaire `a971386f8c8d` sont donc déjà publiés.

Préparé par l'agent le 2026-11-20 (Casino V1, PR #90 fusionnée dans `main` : `18a4b048`). **Non validé** : la
ligne de validation appartient à Antoni ; tant qu'elle manque, l'emballage de Production refuse d'écrire le ZIP
(`npm run package:production -w @raptoru/twitch-extension -- --shell v2`).
Le ZIP est **complet**, pas un différentiel : il contient toute l'extension du commit emballé (les modules déjà
publiés et le Casino). Cet inventaire ne liste que ce qui change pour les viewers.
Prérequis côté Core : le Core de `18a4b048` déployé (routes `/v1/ext/casino/*`, migration `20261204130000_casino_v1`)
et `CASINO_EXTENSION` à `testers:<id>` pour le Hosted Test, puis `on` ; sans elle, les tuiles du Casino n'apparaissent
pas (le reste de l'extension fonctionne).

## Casino (machine à fruits + Coffre, roulette, machine à émotes, blackjack) — 8

- 298e9402 2026-11-20 feat(casino): extension — the emote machine and the multiplayer blackjack in Mini-jeux; Studio controls
- 02695b1b 2026-11-19 feat(casino): BONUS drawn as a golden chest, games follow the Wallet, roulette quick bets
- 524d0d18 2026-11-18 fix(mini-jeux): no giant icon when Mini-jeux opens — nothing painted before arcade.css applies
- c4206c2e 2026-11-18 feat(casino): a real spectator panel, and the roulette's true ALL-IN (off until Antoni sets its cap)
- f9515627 2026-11-18 fix(casino): spectators start with the player (<1 s) and the screen no longer flashes
- 850187ae 2026-11-18 feat(casino): spectators follow a player, live — never a result ahead of the player's screen
- 22310e85 2026-11-17 fix(casino): security review — shares only while the casino plays, the wallet cap before the draw, strict ids
- 91839307 2026-11-17 feat(casino): extension, Studio and Lab — the slot machine with the Coffre, the roulette, spectators
