# Inventaire de l'emballage de Production — source 2e2d664208a9 (Chaos V2 · Interactions sur le Core · tarifs Studio)

Écart : **56 commits** de l'extension depuis `PUBLISHED` = `be1744e75f63`. C'est l'inventaire `9da1d323642f`
(37 commits, validé par Antoni le 24/11, ZIP `1254d0257d08`) **plus 19 commits** de la branche locale
`feat/chaos-integration` (non poussée) ; remplace l'inventaire `a4fd2972be05` (non validé, aucun ZIP écrit).

Préparé par l'agent le 2026-11-26 (mandats « CHAOS V2 : INTÉGRATION RÉELLE ET OBJECTIF DÉPLOIEMENT » puis « éditeur de
tarifs dynamique dans Studio »). **Aucun ZIP n'est
écrit tant qu'Antoni n'a pas inscrit lui-même la ligne de validation** en fin de fichier ; seul
`node scripts/package.mjs --target production --shell v2 --check` a été lancé (toutes les vérifications, aucun ZIP).

À savoir avant de valider :

- **Chaos / Interactions reste invisible** tant que le Core ne l'ouvre pas : la carte n'apparaît que si la session dit
  `chaos.enabled` (`CHAOS_EXTENSION` + réglage `chaos.enabled`, tous deux fermés par défaut). La section FX de la
  console n'apparaît que si l'aperçu du Core contient `chaos.enabled`.
- **Visible dès la mise en ligne, sans activation** : le raccourci « Tombola ouverte » (Hub et modules, pendant une
  tombola), le solde de Mini-jeux à 4 chiffres, le bouclier de modération dans l'en-tête des modules (équipe), le badge
  Tombola compact.
- Tarifs : « dès » et le détail du prix suivent les fourchettes que le Core envoie (Studio › Chaos › Tarifs) ; le
  journal de la console de modération nomme « Tarifs Chaos modifiés ». Rien de visible tant que Chaos est fermé.
- Maquette, faux Core et « Jouer sur mon PC » sont dans `lab-modules/` : jamais emballés.
- Configuration habituelle : API `https://core.raptoru.fr/v1/ext`, shell v2.

## Nouveau depuis l'inventaire 9da1d323642f — 19

- 2e2d6642 2026-11-26 feat(chaos): Studio › Chaos › Tarifs — each effect's price range set in Studio, checked, stored and applied by the Core
- a4fd2972 2026-11-26 fix(extension): the shield opens the FX section even before the Core's overview arrives
- b5dfcff9 2026-11-26 fix(extension): Interactions on the real Core — real Jetons wording, refusals worded like the validated mock-up, quotes follow the Core's state
- f3605271 2026-11-26 feat(studio): extension Lab reaches the Lab Core's Chaos (state, quote, buy) with the token identity and the intent key; FX line only when the Core says chaos is enabled
- d2f8e045 2026-11-26 feat(ext): Interactions becomes a packaged module wired to the Core (modules/interactions); the mock-up stays Lab-only
- 569d02fa 2026-11-26 feat(ext): Interactions (Lab) — « Jouer sur mon PC »: the sheet's real request goes to the Studio serving the page, plus an engine STOP ALL
- db08815b 2026-11-26 feat(chaos): price ranges chosen by Antoni (28/11) — min + (max − min) × severity share, maximum only at the most severe setting
- 7aa6ea7f 2026-11-26 feat(ext): Interactions (Lab) — switch between the mock prices and the 28/11 price proposal
- 28355dce 2026-11-26 feat(ext): Interactions (Lab) — closer previews for Brouillard, Paupières, Vision tunnel and Tremblement, from the engine's shaders
- 4555062e 2026-11-26 feat(ext): Interactions (Lab) — automatic refunds when an effect never starts, transaction ledger, 60 s for every compatible effect, no « exclusive fullscreen » guessed from
- be95e529 2026-11-26 fix(ext): Interactions (Lab) — « Ne plus demander confirmation » always visible, one click = one purchase, no 0.7 s lock between deliberate clicks
- 33928078 2026-11-26 feat(ext): Interactions (Lab) last UX pass — compact credits, « Conditions », repeat purchases, blink charges, blur slider, smoother sheets, FX in the real moderation console
- cab80028 2026-11-26 feat(ext): moderation shield in module headers, extra sections in the D4 console, demo source for the Lab, compact « Tombola » badge
- 3955d105 2026-11-26 feat(ext): Interactions (Lab) finishing pass — real presets and controls, gêne-based prices, effect credits, FX section of the moderation console, Bonk keeps its colours
- ff01e83a 2026-11-26 fix(ext): Interactions (Lab) header leaves room for the Tombola shortcut; times readable on narrow cards
- 6d894bbc 2026-11-26 feat(ext): « Tombola ouverte » shortcut from the Hub and every module while a raffle is open
- 0d295667 2026-11-26 fix(ext): Mini-jeux header balance shows up to 4 digits (1,234 K · 12,34 K · 2,656 M) instead of 2
- 5c21290b 2026-11-26 feat(ext): « Interactions » (Lab only) — Chaos V2, Bonk and the Régie, rebuilt: header switcher, favourites and personal order, effect sheet grown from its card, real engine
- 3a848143 2026-11-26 feat(ext): « Effets live » mock-up (Lab only) — Chaos V2 for viewers with Bonk inside and a moderation tab, on a fake Core

## Repris de l'inventaire 9da1d323642f (validé le 24/11) — 37

- 9da1d323 2026-11-24 fix(extension): the Twitch app's mobile page is the mobile surface even with anchor=component
- ed70a107 2026-11-23 Merge pull request #127 from raptorutwitch/feat/casino-mobile-density
- 7a6f4f74 2026-11-23 feat(soundboard): add, re-cut and remove sounds from Studio — real cut, Core-held files, dynamic catalogue
- bd49e202 2026-11-23 fix(ext): Blackjack 563 × 376 — history panel 248 px wide, capped at 225 px (was 268 × 257)
- d4a8c22a 2026-11-23 fix(ext): Blackjack 563 × 376 — history as a right-anchored floating panel; split Aces explained
- 3a2daff0 2026-11-23 fix(ext): Blackjack 563 × 376 — history as a compact centred popup sized to its content (capped, list scrolls)
- a89cfa45 2026-11-23 fix(ext): Blackjack 563 × 376 — other players' seat scores hidden, shown only while their seat is hovered
- f5093f63 2026-11-23 fix(ext): Blackjack 563 × 376 finishing pass — shoe back, seat scores inside their seat, lower gold line, 100K stakes, narrower actions
- 4ee99532 2026-11-23 feat(ext): Blackjack laid out natively at the normal Twitch player (563 × 376) instead of a uniform zoom
- 16681881 2026-11-23 fix(ext): Casino readability pass — Blackjack and Roulette on Twitch Android, Blackjack on the PC video component
- ad23251c 2026-11-23 fix(ext): diagnostic panel — Fermer and Désactiver really hide it (inline display won over hidden)
- 95ace3cb 2026-11-23 feat(ext): mobile diagnostic for Hosted Test — build, sizes, casino steps and captured errors
- 445e0722 2026-11-22 fix(extension): Twitch mobile — real app area, Casino height, TTS and Random Ban compact, Bonk emote retry loop
- 7779ed45 2026-11-22 test(extension): the bench follows the component at 65 % of the player (Antoni, 22/11) — normal player 563×376 by default
- d073570b 2026-11-22 fix(extension): the Casino scales down as one block in a normal Twitch player — same layout, just smaller
- f04ea164 2026-11-22 fix(casino): blackjack reactions — 😎 and ICANT, a vertical two-floor picker, the dealer reacts to more moments (emotes only)
- cba1f66c 2026-11-22 feat(casino): Blackjack — 10 réactions classiques (emojis Discord) et une page réservée aux abonnés
- 2411c992 2026-11-22 feat(casino): dernière passe — gains explorés sur les rouleaux seuls, réactions « hélium », bulle qui reste ouverte, banque en émote, ruban BUST (#115)
- 83be8ceb 2026-11-21 feat(casino): Blackjack — les 7 réactions définitives d'Antoni (5 emojis Discord via Twemoji, ICANT, ptn animé) (#114)
- 8d85e9b7 2026-11-21 fix(casino): Blackjack — la pile du Split s'étale en largeur sur les tables de hauteur moyenne (#112)
- 7d042f1f 2026-11-21 fix(casino): Blackjack — panneau plein écran : les languettes cachées restent sur le tapis (#110)
- 337fe3e0 2026-11-21 feat(casino): Blackjack — pile du Split, cartouche, languettes groupées ; machines — gains explorés sur les rouleaux ; téléphone et paysage ; tables et réactions éteint
- ecaa5841 2026-11-21 fix(casino): passe corrective après les essais interactifs — Split main par main, assurance et gain assuré, lignes gagnantes, téléphone (#107)
- 866e6d6e 2026-11-21 feat(casino): real-frame interactive bench + composition pass — roulette portrait mat, slot cabinet, Blackjack hero seat (#105)
- 1ee8ad9a 2026-11-21 feat(casino): night pass — Blackjack history/Quitter/Split/mobile, machines and roulette on phones, paying lines named (#103)
- 19964716 2026-11-21 fix(casino): machines at low height — the reels stay inside the stage and Lancer stays on screen (Lot B follow-up) (#102)
- 03d49a2c 2026-11-21 feat(casino): responsive pass (Blackjack, Slot, Book) + a visual bench to check it (Lot B § 1-4, 8-9) (#100)
- e9e667db 2026-11-21 fix(casino): Blackjack post-live Lot A — Split display, navigation, Auto pacing, Mes manches (#99)
- ffd96677 2026-11-20 fix(casino): blackjack labels — BLACKJACK pill sized to its text, the dealer side bet reads BJ
- 298e9402 2026-11-20 feat(casino): extension — the emote machine and the multiplayer blackjack in Mini-jeux; Studio controls
- 02695b1b 2026-11-19 feat(casino): BONUS drawn as a golden chest, games follow the Wallet, roulette quick bets
- 524d0d18 2026-11-18 fix(mini-jeux): no giant icon when Mini-jeux opens — nothing painted before arcade.css applies
- c4206c2e 2026-11-18 feat(casino): a real spectator panel, and the roulette's true ALL-IN (off until Antoni sets its cap)
- f9515627 2026-11-18 fix(casino): spectators start with the player (<1 s) and the screen no longer flashes
- 850187ae 2026-11-18 feat(casino): spectators follow a player, live — never a result ahead of the player's screen
- 22310e85 2026-11-17 fix(casino): security review — shares only while the casino plays, the wallet cap before the draw, strict ids
- 91839307 2026-11-17 feat(casino): extension, Studio and Lab — the slot machine with the Coffre, the roulette, spectators

<!-- Ligne de validation : à inscrire par Antoni seulement (ou par l'agent sur son autorisation écrite), après lecture. -->
<!-- Ligne inscrite par l'agent le 27/11/2026 sur autorisation écrite d'Antoni, point de décision unique de la livraison Chaos V2 : « Je t'autorise à l'inscrire » (inventaire 2e2d664208a9, 56 commits, exact après fusion de la PR #130 en commit de fusion). -->

Validé par Antoni : oui
