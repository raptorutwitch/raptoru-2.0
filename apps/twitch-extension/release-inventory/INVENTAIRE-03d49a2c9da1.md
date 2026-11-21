# Inventaire de l'emballage de Production — source 03d49a2c9da1

Écart : **11 commits** de l'extension depuis `PUBLISHED` = `be1744e75f63` (version « Released » de la console Twitch,
prouvée par Antoni le 20/11/2026). C'est l'inventaire `ffd96677bf64` (9 commits, validé le 20/11, ZIP préparé pour le
Hosted Test : 76875d47e728) **plus les deux lots post-live du Casino du 21/11** (PR #99 et #100).

Préparé par l'agent le 2026-11-21. **Non validé** : la ligne de validation appartient à Antoni ; tant qu'elle manque,
l'emballage de Production refuse d'écrire le ZIP (`npm run package:production -w @raptoru/twitch-extension -- --shell v2`).
Le ZIP est **complet**, pas un différentiel : toute l'extension du commit emballé. Il remplace le ZIP 76875d47e728.
Aucun changement côté Core, bot ni Studio : le Core en Production (`1f05b97c`, relevé en lecture seule le 21/11) a
exactement le même code Casino (`apps/core-api/src`, schémas et migrations inchangés depuis ce commit).

## Nouveau depuis le ZIP 76875d47e728 — 2

- e9e667db 2026-11-21 fix(casino): Blackjack post-live Lot A — Split display, navigation, Auto pacing, Mes manches (#99)
  - Blackjack, Split : chaque main a ses propres cartes, son total et sa mise ; la main à jouer est entourée. Deux
    mains aux verdicts opposés (net 0) affichent « Partagé » et le verdict de chaque main, jamais « Égalité ».
  - « S'asseoir » depuis le mode spectateur prend une place à CETTE table (avant : retour au salon).
  - Bouton Quitter permanent (porte rouge) ; avec une mise engagée, une confirmation : la main reste en jeu (RESTER)
    et est réglée normalement — le comportement du Core, confirmé par Antoni le 21/11.
  - Règles ouvrables depuis le salon ; assurance, Even money et limites réelles du Split expliquées.
  - Onglet « Mes manches » dans l'Historique (manches du viewer, Partager dans le chat, compteur de session remis à
    zéro dans ce navigateur seulement — jamais une opération Jetons).
  - Casino : un double-clic dans un jeu n'atteint plus le lecteur Twitch (plein écran involontaire).
  - Machines à fruits et à émotes : Auto suit le quota du Core (plus de « Trop de demandes » en Rapide + Auto) ; en
    Rapide, chaque ligne gagnante s'affiche avec son montant ; la Table des gains dit le sens de lecture.
- 03d49a2c 2026-11-21 feat(casino): responsive pass (Blackjack, Slot, Book) + a visual bench to check it (Lot B § 1-4, 8-9) (#100)
  - Blackjack à faible hauteur (vidéo zoomée, paysage compact) : les places redeviennent visibles et jouables (elles
    étaient coupées sous ~300 px de haut) ; paris banque en grille compacte.
  - Cartes, places, jetons et barre suivent l'échelle commune de l'extension (`--g`) ; la place qui joue grossit
    légèrement.
  - Machines à fruits et à émotes : la vitre des rouleaux garde ses proportions en portrait mobile.
  - Roulette : vérifiée à toutes les tailles, inchangée.

## Déjà dans l'inventaire ffd96677bf64 (validé le 20/11) — 9

- ffd96677 2026-11-20 fix(casino): blackjack labels — BLACKJACK pill sized to its text, the dealer side bet reads BJ
- 298e9402 2026-11-20 feat(casino): extension — the emote machine and the multiplayer blackjack in Mini-jeux; Studio controls
- 02695b1b 2026-11-19 feat(casino): BONUS drawn as a golden chest, games follow the Wallet, roulette quick bets
- 524d0d18 2026-11-18 fix(mini-jeux): no giant icon when Mini-jeux opens — nothing painted before arcade.css applies
- c4206c2e 2026-11-18 feat(casino): a real spectator panel, and the roulette's true ALL-IN (off until Antoni sets its cap)
- f9515627 2026-11-18 fix(casino): spectators start with the player (<1 s) and the screen no longer flashes
- 850187ae 2026-11-18 feat(casino): spectators follow a player, live — never a result ahead of the player's screen
- 22310e85 2026-11-17 fix(casino): security review — shares only while the casino plays, the wallet cap before the draw, strict ids
- 91839307 2026-11-17 feat(casino): extension, Studio and Lab — the slot machine with the Coffre, the roulette, spectators

La ligne de validation d'Antoni s'ajoute ci-dessous, telle quelle, après son contrôle.
