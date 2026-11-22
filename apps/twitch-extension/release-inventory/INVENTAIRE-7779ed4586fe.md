# Inventaire de l'emballage de Production — source 7779ed4586fe

Écart : **24 commits** de l'extension depuis `PUBLISHED` = `be1744e75f63` (version « Released » de la console Twitch,
prouvée par Antoni le 20/11/2026). C'est l'inventaire `f04ea1646b4a` (22 commits, ZIP 97eb94777d62) **plus le
correctif d'échelle du composant vidéo du 22/11 au soir** (régression responsive vue en live) et le banc aligné sur
le composant à 65 % du lecteur (réglage de la console Twitch, fait par Antoni).

Préparé par l'agent le 2026-11-22, sur le GO écrit d'Antoni du 22/11 au soir (« GO POUR LE CORRECTIF FRONTEND, LES
TESTS CIBLÉS ET LA CONSTRUCTION DU ZIP ») — la ligne de fin le reprend. ZIP écrit par l'emballage de Production
(`npm run package:production -w @raptoru/twitch-extension -- --shell v2`). Le ZIP est **complet**, pas un différentiel :
toute l'extension du commit emballé. Il remplace le ZIP 97eb94777d62. Frontend seul : aucun changement Core, bot,
Studio ni OBS.

## Nouveau depuis le ZIP 97eb94777d62 — 2

- 7779ed45 2026-11-22 test(extension): the bench follows the component at 65 % of the player (Antoni, 22/11) — normal player 563×376 by default
  - Simulateur seulement (et un commentaire) : le lecteur normal à 65 % (563 × 376) est le format par défaut.
- d073570b 2026-11-22 fix(extension): the Casino scales down as one block in a normal Twitch player — same layout, just smaller
  - Dans un lecteur Twitch normal (composant ≈ 520 × 347), le Casino garde la disposition validée (651 × 434), réduite
    d'un bloc, au lieu des dispositions compressées ; jamais agrandi en plein écran. Menu, autres modules, panneau et
    mobile inchangés.

## Déjà dans l'inventaire f04ea1646b4a — 22

- f04ea164 2026-11-22 fix(casino): blackjack reactions — 😎 and ICANT, a vertical two-floor picker, the dealer reacts to more moments (emotes only)
  - Réactions classiques : 😎 à la place de 🫡. Abonnés : ICANT à la place de Flex Megumin.
  - La flèche gauche/droite devient un petit ascenseur haut/bas : deux étages à la même place, la liste glisse, la
    bulle garde sa taille et reste ouverte. Les non-abonnés n'ont que l'étage des classiques.
  - LeCroupier_ réagit à plus de moments (blackjack, gros gain/perte, banque qui saute, double, split, bust, égalité…)
    d'une émote seule, au plus une par manche, rare sur une manche ordinaire ; jamais de texte.
- cba1f66c 2026-11-22 feat(casino): Blackjack — 10 réactions classiques (emojis Discord) et une page réservée aux abonnés
  - Réactions du Blackjack : 🙂 😅 😭 😳 🫡 😡 🤗 😮 💀 (les emojis de Discord, Twemoji) et ptn (animée), dans l'ordre
    d'Antoni ; une rangée sur PC, 2 × 5 sur une table étroite ou au téléphone.
  - Abonnés de la chaîne : une petite flèche ouvre leur page (9 émotes d'Antoni + ptn), vérifiée par le Core à chaque
    envoi ; leurs émotes s'envolent chez tout le monde.

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
- ecaa5841 2026-11-21 fix(casino): passe corrective après les essais interactifs — Split main par main, assurance et gain assuré, lignes gagnantes, téléphone (#107)
  - Blackjack, Split : une seule main jouée à la fois, et l'écran le montre. Chaque main dit son état : à jouer,
    « attend sa 2ᵉ carte » ou finie. La 2ᵉ carte arrive automatiquement à son tour (règle du moteur, inchangée).
    « Main 1 sur 2 » s'affiche au-dessus des actions. Le clignotement qui faisait croire à une carte tirée sur les
    deux mains est supprimé.
  - Blackjack, assurance : le règlement détaille la main, l'assurance (en net) et le bilan. « Even money » devient
    « Gain assuré » (la mise, payée 1:1), face à « Tenter le 3:2 ».
  - Blackjack :
    - bust : un seul signal, le score rouge ;
    - les mains de beaucoup de cartes tiennent dans leur place, score lisible ;
    - mise libre sans arrondi silencieux, avec les valeurs acceptées ; montants exacts (1K25) ;
    - salon en lignes (Regarder, Rejoindre) ;
    - historique : vraie icône de partage, remise à zéro compacte.
  - Blackjack sur téléphone : banque plus grande, paris banque en arc quand la largeur le permet, ma place plus
    lisible, languettes plus grandes. Les messages ne couvrent plus le texte ni les boutons.
  - Machines à fruits et à émotes : on explore chaque ligne gagnante (survol sur PC, toucher sur téléphone). La table
    des gains montre chaque ligne sur les rouleaux.
  - Mini-jeux sur téléphone en paysage : tout le catalogue tient sans défilement.
- 337fe3e0 2026-11-21 feat(casino): Blackjack — pile du Split, cartouche, languettes groupées ; machines — gains explorés sur les rouleaux ; téléphone et paysage ; tables et réactions éteintes jusqu'au Core (#109)
  - Blackjack, Split : les mains en pile (2 à 4) — la main à jouer au premier plan, les autres derrière avec leur
    numéro, leur score et leur état ; la main finie passe derrière, la suivante avance (fondu seul si le mouvement est
    réduit).
  - Blackjack : un cartouche dans le coin dit qui joue (« À toi », « Main 1/2 », les secondes) ; la place du joueur au
    centre se fait discrète ; à mon tour au téléphone, ma main passe au centre en grand.
  - Blackjack : Règles et Historique l'un au-dessus de l'autre sur le bord droit, un seul panneau à la fois.
  - Blackjack au téléphone : paris sur la banque en 4 + 3 grandes cases, cercle de mise au centre de ma place ;
    paysage 844 × 390 : banque plus grande, paris en arc large, places plus larges.
  - Machines à fruits et à émotes : on explore les gains directement sur les rouleaux (survol, toucher, un clic de plus
    pour la ligne suivante qui passe par le même symbole) ; les symboles comptés sont cernés, le reste assombri.
  - Préparé mais éteint avec le Core actuel : « + Nouvelle table » et les réactions (émotes au-dessus des places,
    réactions ponctuelles de la banque). Ils n'apparaissent que lorsque le Core les annonce (évolution du Core non
    déployée, sur GO d'Antoni) ; 6 émotes provisoires, remplaçables sans toucher au code.
- 7d042f1f 2026-11-21 fix(casino): Blackjack — panneau plein écran : les languettes cachées restent sur le tapis (#110)
  - Blackjack sur table étroite ou basse : un panneau Règles ou Historique ouvert en plein écran ne pousse plus les
    languettes (cachées) hors du tapis.
- 8d85e9b7 2026-11-21 fix(casino): Blackjack — la pile du Split s'étale en largeur sur les tables de hauteur moyenne (#112)
  - Blackjack, Split à 3 ou 4 mains sur PC (651 × 434) et en vidéo zoomée : la pile s'étale vers la droite au lieu de
    monter sur les paris banque.
- 83be8ceb 2026-11-21 feat(casino): Blackjack — les 7 réactions définitives d'Antoni (5 emojis Discord via Twemoji, ICANT, ptn animé) (#114)
  - Réactions du Blackjack (toujours éteintes avec le Core actuel) : les 7 choisies par Antoni, dans son ordre — 🙂, 😳,
    😡, 😎, 😉 (les emojis de Discord : Twemoji, déjà embarqué, licence CC-BY 4.0), puis ses émotes ICANT et ptn
    (animée). Les visuels provisoires sont retirés.
  - Bulle de choix : une rangée de 7 sur PC, 4 + 3 au téléphone ; une émote animée s'anime partout.
  - Réactions de la banque : chaque situation a son émote, modifiable (blackjack d'un joueur → ptn, la banque saute →
    colère, un bust → ICANT…), toujours au plus une par manche.
- 2411c992 2026-11-22 feat(casino): dernière passe — gains explorés sur les rouleaux seuls, réactions « hélium », bulle qui reste ouverte, banque en émote, ruban BUST (#115)
  - Machines à fruits et à émotes : plus de rangée de pastilles sous les rouleaux ; la plaque garde le gain total, les
    combinaisons s'explorent directement sur les rouleaux.
  - Réactions du Blackjack (éteintes avec le Core actuel) : envol continu « hélium », plusieurs à la fois, bulle qui
    reste ouverte, 5 d'affilée puis 1 toutes les 2 s ; la banque réagit d'une émote seule.
  - Blackjack : ruban diagonal « BUST » sur la main dépassée, le score en nombre rouge.

- ffd96677 2026-11-20 fix(casino): blackjack labels — BLACKJACK pill sized to its text, the dealer side bet reads BJ
- 298e9402 2026-11-20 feat(casino): extension — the emote machine and the multiplayer blackjack in Mini-jeux; Studio controls
- 02695b1b 2026-11-19 feat(casino): BONUS drawn as a golden chest, games follow the Wallet, roulette quick bets
- 524d0d18 2026-11-18 fix(mini-jeux): no giant icon when Mini-jeux opens — nothing painted before arcade.css applies
- c4206c2e 2026-11-18 feat(casino): a real spectator panel, and the roulette's true ALL-IN (off until Antoni sets its cap)
- f9515627 2026-11-18 fix(casino): spectators start with the player (<1 s) and the screen no longer flashes
- 850187ae 2026-11-18 feat(casino): spectators follow a player, live — never a result ahead of the player's screen
- 22310e85 2026-11-17 fix(casino): security review — shares only while the casino plays, the wallet cap before the draw, strict ids
- 91839307 2026-11-17 feat(casino): extension, Studio and Lab — the slot machine with the Coffre, the roulette, spectators

Validé par Antoni : oui
