# Inventaire de l'emballage de Production — source 866e6d6efaaa

Écart : **14 commits** de l'extension depuis `PUBLISHED` = `be1744e75f63` (version « Released » de la console Twitch,
prouvée par Antoni le 20/11/2026). C'est l'inventaire `ffd96677bf64` (9 commits, validé le 20/11, ZIP préparé pour le
Hosted Test : 76875d47e728) **plus les corrections post-live du Casino du 21/11** : lots A et B (PR #99, #100), la
reprise des machines à faible hauteur (PR #102), la passe corrective de nuit (PR #103) et la passe de composition
responsive, essayée dans le vrai cadre de l'extension (PR #105).

Préparé par l'agent le 2026-11-21. **Non validé** : la ligne de validation appartient à Antoni ; tant qu'elle manque,
l'emballage de Production refuse d'écrire le ZIP (`npm run package:production -w @raptoru/twitch-extension -- --shell v2`).
Le ZIP est **complet**, pas un différentiel : toute l'extension du commit emballé. Il remplace le ZIP 76875d47e728
(et les inventaires 03d49a2c9da1 et 1ee8ad9aed0e, jamais validés, que celui-ci remplace).
Aucun changement côté Core, bot ni Studio : le Core en Production (`1f05b97c`, relevé en lecture seule le 21/11) a
exactement le même code Casino (`apps/core-api/src`, schémas et migrations inchangés depuis ce commit).

## Nouveau depuis le ZIP 76875d47e728 — 5

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
- 19964716 2026-11-21 fix(casino): machines at low height — the reels stay inside the stage and Lancer stays on screen (Lot B follow-up) (#102)
  - Machines à fruits et à émotes à faible hauteur (vidéo zoomée, paysage) : les rouleaux restent dans la vitre et
    le bouton Lancer reste à l'écran.
- 1ee8ad9a 2026-11-21 feat(casino): night pass — Blackjack history/Quitter/Split/mobile, machines and roulette on phones, paying lines named (#103)
  - Blackjack, Historique : une petite languette horloge (plus l'onglet « Historique » lourd) ; Cette table / Mes
    manches ; Mes manches = un bilan de session (remise à zéro confirmée, dans ce navigateur seulement) et une carte
    par manche (score de la banque, gain ou perte, heure discrète, Partager dans le chat).
  - Blackjack, Quitter : bouton explicite (porte) dans la barre du bas ; confirmation seulement avec une mise engagée,
    qui reste engagée jusqu'au règlement ; un double appui n'envoie qu'une demande.
  - Blackjack, Split : au tour du joueur, toutes ses mains au centre, côte à côte, la main à jouer entourée ; bilan
    mixte « Main 1 perdue · Main 2 gagnée », « Bilan ±0 · rien gagné, rien perdu ».
  - Blackjack sur téléphone et panneau étroit : paris banque en grille, places en carrousel glissable centré sur le
    joueur qui joue, Règles et Historique plein écran, cibles au doigt ; à faible hauteur, banque et paris compacts ;
    la barre du bas ne dépasse plus de l'écran (vidéo zoomée à 125 %).
  - Machines sur téléphone : rouleaux en pleine largeur, mise dessous, une rangée Derniers gains · Rapide / Auto /
    Son · Lancer. La plaque nomme la ligne qui paie (« Haut · 3 × Cerise (dont 1 WILD) ») ; la Table des gains nomme
    les 10 lignes et explique le WILD.
  - Roulette sur téléphone : le tapis est inchangé ; la barre du bas ne se chevauche plus (jetons glissables, actions
    et Lancer dessous) ; la roue s'affiche au-dessus du résultat.
- 866e6d6e 2026-11-21 feat(casino): real-frame interactive bench + composition pass — roulette portrait mat, slot cabinet, Blackjack hero seat (#105)
  - Application Twitch sur téléphone (page mobile) et panneau : le Casino s'affiche (son écran faisait 0 px de haut :
    trouvé en essayant le Casino dans le vrai cadre de l'extension).
  - Roulette en portrait : le même tapis, debout comme une vraie table verticale (0 en haut, 1·2·3 par rangée, 2:1 en
    bas, douzaines et chances simples à droite), toutes les mises possibles ; en portrait court, le tapis défile avec
    des cases d'au moins 30 px et montre le numéro sorti.
  - Machines en portrait : une borne verticale (derniers gains en haut, vitre plus haute sans déformer les symboles,
    mise dessous, Rapide · Auto · Son et Lancer sous le pouce) ; le Coffre empilé au lieu d'être écrasé.
  - Blackjack en portrait : ta place en grand juste au-dessus des commandes (tes cartes, ta mise, ton cercle de
    mise), la banque et ses paris en haut, les autres joueurs en carrousel ; paris banque de 40 px avec leur titre.
  - Blackjack partout : « Mise en cours » au lieu de « reste … » ; Quitter = la porte seule, séparée des jetons ;
    languettes Règles / Historique centrées sur le bord ; partage et remise à zéro en pictogrammes ; Règles en
    accordéon (10 rubriques, exemple chiffré pour l'assurance).
  - Blackjack au format de référence (vidéo 75 %) : banque lisible et paris sans chevauchement (la table n'a que
    373 px sous l'en-tête) ; grand format : cartes et places plus grandes ; téléphone en paysage : les 7 paris sur une
    rangée de 30 px.
  - Vidéo zoomée (125 %, 150 %) : machines et roulette gardent la composition de PC (vitre et tapis lisibles).

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
