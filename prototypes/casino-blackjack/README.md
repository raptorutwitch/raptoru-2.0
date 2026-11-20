# Blackjack multijoueur — prototype local (V3 du 19/11/2026, finition du 20/11)

**Finition du 20/11 (présentation seulement : règles, grille et Wallet inchangés).**
- **Tapis :** un arc de feutre avec un seul liseré d'or ; les places sont posées sur sa courbe (même ellipse en CSS et
  dans `view.js`).
- **Paris banque :** 7 cases identiques, droites et symétriques, avec « B » pour Blackjack.
- **Banque :** cartes centrées et éclairées ; le sabot est dans le coin, détaillé au survol.
- **Joueurs :** étiquette « JOUE » ; une main BUSTED est désaturée mais lisible ; aux résultats, le net s'affiche sur
  l'étiquette de mise.
- **Boutons :** colorés, avec icônes.
- **Historique :** chaque mise, chaque pari banque (misé, retour) et le net. Les cotes « a:b » se lisent comme au
  casino : 11:2 = 11 de gain pour 2 misés, donc 100 → +550, retour 650. La bulle donne la mise, le gain net et le
  retour total.

**V3 : présentation et ergonomie de mise, pour le format 565 × 376.**
- **Paris sur la banque :** les 7 scores sont posés en arc autour de la banque, avec des cotes « paye a:b » sans
  virgule. La grille est légèrement retouchée (voir § Paris sur la banque).
- **Mises :** elles se posent directement sur sa place, et la mise principale et les paris banque se préparent dans le
  même tour. Un clic droit ou un appui long retire un jeton ; une bulle discrète montre le gain possible au survol.
- **Historique :** une languette sur le bord droit ouvre un panneau qui glisse, avec des manches repliées qu'un clic
  déplie.
- **Places :** elles sont en arc et plus légères ; la mise est une petite étiquette (200, 1K, 1K5).
- **Busted :** la place se grise et reçoit un badge qui rebondit.
- **Règlement :** des jetons volent vers la banque ou vers le joueur.
- **Barre :** elle passe de 54 à 44 px.
- **Cartes :** un glissement latéral net (64 px, 190 ms).
- **Places :** on choisit la sienne dans le salon.
- **Arrivée en cours de manche :** l'arrivant n'apparaît qu'à la manche suivante, et on lui dit « Tu rejoindras la
  manche suivante ».

**V2 :**

**V2 : l'ergonomie refaite, pas le jeu.**
- **Table :** elle s'adapte au nombre de joueurs.
- **Joueurs :** chaque place a un avatar rond et un pseudo.
- **Mises :** elles se posent comme à la roulette, puis PRÊT les verrouille.
- **Banque :** la mise minimum est de 100, et le gain potentiel est borné au lieu d'un plafond fixe.
- **Paris banque :** les retours sont affichés en Jetons entiers.
- **Timers :** calmes, ils n'apparaissent que quand ils comptent.
- **Cartes :** elles glissent sans rotation.
- **Historique :** les résultats des dernières manches.

Les règles du blackjack et la grille des paris sur la banque ne changent pas.

Quatrième jeu du Casino : jusqu'à 10 joueurs par table, chacun contre la banque, sabot de 8 paquets, paris sur le
résultat final de la banque. **Prototype indépendant** : Jetons fictifs, aucun lien avec l'extension, le vrai Core ni
le Wallet. Le « Core » est simulé dans la page (`src/core-sim.js`) et ne peut pas servir d'autorité en Production.

## Lancer

```
cd "C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\agent\prototypes\casino-blackjack"
node start.mjs
```

La page http://127.0.0.1:4530/ s'ouvre toute seule. On peut aussi double-cliquer sur `Lancer le blackjack.cmd`. Au
démarrage, tu es assis avec 4 joueurs simulés et 50 000 Jetons fictifs. Le Lab est à droite.

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm test` | 47 tests (dont banque bust sous toutes ses formes, assurance, even money, le choix de place et le détail de l'historique) : règles, probabilités, table (PRÊT, délai de secours, exposition, timers, départs, splits, historique, paiements uniques…) |
| `npm run odds` | La grille exacte, les estimations par simulation et l'analyse anti-comptage (`tools/odds-result.txt`) |
| `node tools/check.mjs` | 95 contrôles dans Chromium (dont assurance payée / perdue, even money, banque bust, panneau Règles) avec de vrais clics, dont un audit de mise en page (chevauchements, textes coupés, symétrie) à 565 × 376 et en panneau 318, de 1 à 10 joueurs, ~3 min (un vrai délai de secours de 45 s) ; captures dans `captures/` |

## Séparation des responsabilités

| Fichier | Rôle | Au vrai Core ? |
| --- | --- | --- |
| `src/rules.js` | Les règles, en fonctions pures : totaux, actions permises, banque, règlement, sabot | **Oui**, à porter tel quel en TypeScript |
| `src/paytable.js` | La grille des paris sur la banque et les limites | **Oui** (réglages Core) |
| `src/odds.js` | Les probabilités exactes de la banque | Outil et tests seulement |
| `src/core-sim.js` | La table autoritaire : salon, places, tours, timers, Wallet fictif, idempotence, masquage | **Le contrat** à réécrire côté Core (PostgreSQL, verrous) |
| `src/client.js` | Le réseau simulé : latence, coupure, réponse perdue | Remplacé par HTTP + long-poll |
| `src/view.js`, `src/bj.css`, `src/sfx.js` | L'écran : n'affiche que l'état reçu, n'envoie que des intentions | **Oui**, côté extension |
| `src/avatar.js` | Avatars : l'URL Twitch si elle charge, sinon un remplacement (initiale sur dégradé) | **Oui**, côté extension |
| `src/bots.js`, `src/main.js` | Joueurs simulés et Lab | Non |

## Règles retenues

- **Le sabot :**
  - 8 paquets, soit 416 cartes ;
  - il est remélangé **entre deux manches** dès que la carte de coupe (104e carte, le quart du sabot) est passée ;
  - jamais au milieu d'une manche : une manche consomme au plus une centaine de cartes, il en reste au moins 312.
- **Les valeurs :** l'As vaut 1 ou 11, les figures 10. Le total souple s'affiche comme « 7/17 ».
- **Le blackjack naturel :** un As et une carte de valeur 10 en deux cartes. Il ne compte **jamais** sur une main issue
  d'un split : un 21 après split est un 21 ordinaire.
- **La banque :**
  - elle tire jusqu'à 16 et reste sur tous les 17, y compris un 17 souple ;
  - si elle montre un As ou un 10, elle vérifie son blackjack **avant toute décision**. Si elle l'a, la manche s'arrête :
    personne n'a pu doubler ni splitter, et seul un joueur à blackjack récupère sa mise ;
  - elle **termine toujours sa main**, même si tous les joueurs ont sauté ou sont partis. Les paris sur la banque se
    résolvent donc toujours, et leurs probabilités ne dépendent d'aucune décision des joueurs (voir plus bas).
- **Les paiements (bruts, mise comprise) :**
  - blackjack ×2,5 (3:2) ;
  - victoire ×2 (1:1), y compris contre une banque qui saute ;
  - égalité : mise rendue ;
  - perdu ou sauté : 0. Un joueur qui saute perd, même si la banque saute ensuite.
- **Doubler :**
  - sur ses deux premières cartes, quel que soit le total (souple compris) ;
  - la mise est doublée et le joueur reçoit **une seule** carte ;
  - possible après un split, sauf sur des As splittés.
- **Split :**
  - deux cartes de même **valeur** (un Roi et une Dame se splittent), avec une mise égale ;
  - jusqu'à **4 mains** par joueur, donc 3 splits ;
  - la deuxième carte d'une main splittée arrive quand cette main devient active.
- **As splittés :**
  - une carte chacun, puis plus rien : ni tirer, ni doubler, ni re-splitter ;
  - un As + 10 vaut 21, payé 1:1.
- **Banque bust :** toute main encore vivante gagne (1:1, ou 3:2 pour un blackjack) ; une main déjà bust reste perdue ;
  jamais d'égalité contre une banque bust. Le moteur l'appliquait déjà ; l'« égalité » vue à l'écran venait de
  l'étiquette, qui affichait le net total (main + paris banque). Depuis le 20/11, l'étiquette et le centre montrent le
  résultat de la MAIN, puis les paris banque, l'assurance et le total à part.
- **Assurance (20/11) :** proposée seulement si la carte visible de la banque est un **As**, pendant 12 s (fin dès que
  tous ont répondu ; sans réponse = pas d'assurance). Au plus **la moitié de la mise principale** (le bouton propose
  la moitié). Banque blackjack : assurance payée **2:1** (50 → retour 150), la main perd (ou égalité contre un
  blackjack). Pas de blackjack : assurance perdue tout de suite, la main continue normalement. Clés Wallet `ins:` (mise)
  et `insp:` (paiement).
- **Even money :** un joueur qui a un blackjack face à un As peut prendre **1:1 garanti** (au lieu du 3:2 risqué :
  égalité si la banque a blackjack). Même résultat qu'assurer la moitié.
- **Pas d'abandon.**
- **Les mises (V2) :**
  - principale : **100 minimum, sans maximum fixe** ;
  - pari sur la banque : 10 minimum par case, autant de cases que voulu ;
  - toujours en multiples de 10, donc le 3:2 et tous les retours sont des entiers. Le calcul se fait en dixièmes
    entiers, sans flottant ;
  - il faut une mise principale pour parier sur la banque, et il faut être assis : un spectateur ne peut rien engager.
- **L'exposition (V2, `paytable.betProblem`, réglable) :** elle remplace les plafonds.
  - **Gain net potentiel max par manche** (`maxWin`, 1 000 000 fictifs, Lab › Économie). Le pire cas compte 8 fois la
    mise principale (3 splits puis 4 doubles, tous gagnés) plus le meilleur retour possible des paris banque (un seul
    peut gagner).
  - **Retour max des paris banque** (`sideMaxReturn`, 100 000).
  - **Avant la donne :** une mise qui pourrait dépasser est **refusée, avec la mise maximale encore possible**, par
    exemple « mise principale de 125 000 au plus ».
  - **Après la donne :** un gain n'est jamais plafonné. Les doubles et splits restent dans l'enveloppe acceptée ; ils ne
    demandent que le solde.

## Paris sur la banque : grille et RTP

**V3 — la grille en cotes de casino.** Avant, des multiplicateurs à virgule comme ×6,6 ne pouvaient pas s'afficher en
« a:1 ». Maintenant ce sont des cotes « a:b » à dénominateur 1, 2 ou 5, donc des Jetons entiers pour toute mise
multiple de 10. Les RTP sont exacts.

| Banque | Avant (V2) | Maintenant (V3) | 100 rendent | RTP V2 → V3 |
| --- | --- | --- | --- | --- |
| 17 | ×6,6 | **paye 11:2** | 650 | 95,8 → **94,4 %** |
| 18 | ×6,9 | **paye 11:2** | 650 | 96,1 → **90,6 %** |
| 19 | ×7,2 | **paye 6:1** | 700 | 96,2 → **93,5 %** |
| 20 | ×5,3 | **paye 4:1** | 500 | 95,3 → **89,9 %** |
| 21 | ×13 | **paye 12:1** | 1 300 | 94,7 % (inchangé) |
| Blackjack | ×19 | **paye 18:1** | 1 900 | 90,2 % (inchangé) |
| Bust | ×3,4 | **paye 12:5** | 340 | 95,8 % (inchangé) |

- **Ce que ça change :** l'avantage maison passe de 4-5 % à 4-10 %. C'est l'ordre des paris commerciaux du même type
  (6 à 10 %) : le pari reste attrayant, mais n'est plus plus généreux que le commerce.
- **Pourquoi pas mieux :** une cote entière juste au-dessus (6:1 sur 17 ou 18, 13:2 sur 19, 9:2 sur 20) rendrait de
  97,5 à 101,7 %, donc favorable au joueur. C'est exclu.
- **Bust en 12:5 :** c'est la seule cote à dénominateur 5. Les cotes voisines sont 2:1 (84,6 %) et 5:2 (98,6 %), l'une
  trop avare, l'autre trop généreuse.
- **Le comptage de cartes :** il devient pratiquement nul partout, sauf sur Blackjack, qui reste à 4 % de manches
  favorables pour un compteur parfait, soit +0,12 % de sa mise.

**La grille V2 (pour mémoire) :**

Le résultat final de la banque est l'un de ces sept, exclusifs : 17, 18, 19, 20, 21 (non naturel), Blackjack (naturel)
ou Bust. **Blackjack et 21 sont deux cases distinctes** : un 21 en 3 cartes ne paie jamais la case Blackjack, et
inversement.

À l'écran, aucun multiplicateur : chaque case montre ce que rend une mise, mise comprise, en Jetons entiers. Le
retour est affiché pour le jeton choisi (« 100 → 660 »), puis pour sa propre mise sur la case.

| Banque | Probabilité **exacte** | 100 rendent | RTP **exact** | Avantage maison |
| --- | --- | --- | --- | --- |
| 17 | 14,5215 % | 660 | 95,84 % | 4,16 % |
| 18 | 13,9318 % | 690 | 96,13 % | 3,87 % |
| 19 | 13,3629 % | 720 | 96,21 % | 3,79 % |
| 20 | 17,9709 % | 530 | 95,25 % | 4,75 % |
| 21 | 7,2838 % | 1 300 | 94,69 % | 5,31 % |
| Blackjack | 4,7451 % | 1 900 | 90,16 % | 9,84 % |
| Bust | 28,1839 % | 340 | 95,83 % | 4,17 % |

**La comparaison avec les vrais casinos (recherche du 19/11) :** les paris de ce type existent.
- **Le « Hedge Bet » homologué au Nevada :** il parie sur un total final exact de la banque, de 18 à 21. Son paiement
  dépend du nombre de paquets, de la grille, de la carte visible et du total.
- **Les paris « Bust » :** Bust It, Silver Dollar Bust Bonus, Dealer Breakz.
- **Leur avantage maison :** il se situe en général entre 6 et 10 % sur 8 paquets, et souvent davantage pour les paris
  secondaires du blackjack, entre 3 et 15 %.
- **Notre grille :** 4 à 5 % d'avantage maison, sauf Blackjack à 10 %. Elle est donc plus généreuse que le commerce,
  sans être favorable. Je la garde.
- **Pourquoi on ne copie pas une grille commerciale :** les paiements selon la carte visible de la banque n'ont pas de
  sens ici. Nos paris se posent avant la donne, donc avant de voir la carte.

- **Exact :** énumération complète de tous les tirages de la banque depuis un sabot plein de 8 paquets
  (`src/odds.js`). La somme des probabilités vaut 1 à 10⁻¹².
- **Pourquoi c'est exact à chaque manche :** les paris sont posés avant la donne. Dans un sabot bien mélangé, et puisque
  la décision de tirer ou de rester est un temps d'arrêt, la loi des cartes de la banque ne dépend ni de la position
  dans le sabot ni des décisions des joueurs (échangeabilité). Ce point est **vérifié par simulation** : 400 000 manches
  à 7 joueurs donnent tous les résultats à moins de 1,2 σ de la valeur exacte. Il est vérifié une deuxième fois avec des
  joueurs qui tirent jusqu'à 19.
- **Jeu principal, estimé par simulation :** RTP ≈ **99,62 %** (± 0,14 %) avec la stratégie de base, soit un avantage
  maison ≈ 0,38 %. Ces règles ne permettent pas de calculer cette valeur exactement en un temps raisonnable.
- **Limites :** voir l'exposition ci-dessus. Avec les réglages fictifs : mise principale jusqu'à 125 000, et un retour
  des paris banque jusqu'à 100 000 par manche.

### Anti-abus : le comptage des cartes

Dans un sabot partiellement distribué, les probabilités changent. Un compteur parfait (un script qui note toutes les
cartes sorties) pourrait miser seulement quand c'est favorable. La simulation mesure ce cas sur 800 sabots, avec un
calcul exact à chaque manche :

| Réglage | Manches favorables, pari Blackjack | Gain moyen du compteur |
| --- | --- | --- |
| Coupe à 50 %, Blackjack ×20 | 25 % | 1,9 % de la mise par manche |
| Coupe à 25 %, Blackjack ×20 | 17 % | 0,6 % |
| **Coupe à 25 %, Blackjack ×19 (retenu)** | **4 %** | **0,12 %** de ce qu'il mise sur ces manches |

- **Les autres paris :** ils sont favorables dans moins de 1,6 % des manches, pour un gain inférieur à 0,015 %. Bust ne
  l'est jamais.
- **Le prix de cette protection :** Blackjack est le seul pari à 90,2 %.
- **Ce qui n'est pas prouvé :** le comptage n'est pas impossible, il est rendu très peu rentable. Un compteur parfait
  garde un petit avantage mesuré (0,12 % sur ses mises Blackjack choisies). Puisque les mises n'ont plus de plafond
  fixe, ce sont le retour maximum des paris banque (100 000 par manche) et le gain potentiel maximum qui bornent ce
  qu'il peut en tirer.
- **Les autres protections :**
  - les paris ferment au début de la donne ;
  - le client ne reçoit jamais le sabot ni la carte cachée ;
  - au Core, le mélange se fera par `crypto` (aucune graine).

## Multijoueur et timers

- **Tables et places :**
  - 10 places par table, une par joueur, et personne ne joue derrière un autre ;
  - **une seule participation active** : rejoindre à nouveau renvoie la même place ;
  - « Trouver une place » remplit d'abord la table en attente la plus pleine **jusqu'à 7**, puis ouvre une nouvelle
    table (8 au plus). Les places 8 à 10 ne se prennent qu'en choisissant une table, ou quand le salon est plein. C'est
    le choix pour le rythme : une table de 10 joueurs reste possible, mais ce n'est pas la norme ;
  - si la table est en pleine manche, le joueur joue la suivante.
- **La préparation des mises (V2) :** il n'y a **pas de compte à rebours**.
  - **Poser :** on choisit un jeton (100, 500, 1K, 5K, 25K, ou le jeton libre ✎ au montant exact), puis on touche
    **son cercle** (sa mise) ou une **case banque**. Chaque toucher ajoute le jeton.
  - **Retirer :** « − » sur le cercle retire le dernier jeton de la mise. Un clic droit retire un jeton d'une case. ↶
    retire le dernier jeton posé, ✕ efface tout, ↻ reprend les mises de la manche précédente.
  - **Ce qu'on voit :** le total engagé et le solde restant, toujours.
  - **La réservation :** les jetons posés sont réservés au Wallet un instant après. C'est **une seule réservation,
    ajustée** à chaque changement, jamais additionnée.
  - **PRÊT** (ou Entrée) verrouille les mises pour la manche. On voit alors « 3/5 prêts ».
- **La donne :** elle part dès que **tous les joueurs assis et connectés** sont prêts.
- **Le délai de secours (45 s) :**
  - il ne démarre qu'au **premier PRÊT**, pour que personne ne soit pressé avant ;
  - il ne s'affiche que sur ses 15 dernières secondes : « Distribution dans 12 s avec les joueurs prêts » ;
  - à son terme, la manche part avec les joueurs prêts. Une mise posée mais non confirmée n'est **jamais engagée** :
    elle est **rendue**, et le joueur ne joue pas cette manche ;
  - un joueur déconnecté ne bloque pas la donne.
- **Une mise est engagée à la donne :** après, rien n'est plus jamais remboursé.
- **Les décisions (V2) :**
  - dans l'ordre des places, puis des mains ;
  - **30 s** pour la première décision d'une main, **20 s** pour les suivantes, **12 s** pour un joueur qui a laissé
    filer le timer à la manche précédente. Ses 30 s reviennent dès qu'il rejoue ;
  - **1 s de tolérance** pour la latence ;
  - le temps ne s'affiche qu'à partir de **8 s restantes** (« encore 6 s » et une fine barre), avec un tic par seconde
    sur les 3 dernières pour soi ;
  - les mains à 21 et les blackjacks passent seuls.
- **Le rythme :**
  - le serveur attend l'animation avant d'ouvrir une décision : 120 ms entre deux cartes à la donne, une carte en
    210 ms, 620 ms pour la banque ;
  - une table de 10 qui décide vite enchaîne sans pause ;
  - un absent coûte au plus 31 s, puis 13 s à la manche suivante, puis il perd sa place.
- **Sans réponse :** **RESTER**, toujours possible. Personne ne double, ne splitte ni ne tire à la place d'un joueur.
- **Une déconnexion :** la table continue et le même timer s'applique. Au retour : instantané complet (resynchronisation)
  et la main là où elle en est.
- **Un départ :**
  - avant la donne, la mise est rendue ;
  - pendant la manche, la place reste jusqu'au règlement. Ses mains sont jouées par RESTER **sans attendre de timer**
    (0,45 s), et ses gains éventuels sont **crédités normalement**. Rien n'est remboursé ni effacé ;
  - revenir pendant la manche redonne **la même place** et la main.
- **Un absent répété :** 2 manches sans miser ni dire PRÊT, ou une manche entièrement jouée par le timer, et sa place
  est libérée.

## L'écran (V2)

- **Les places :** seules les places occupées sont dessinées, dans l'ordre des sièges. Leur largeur suit le nombre de
  joueurs : environ 150 px à 2, 100 px à 5, 50 px à 10. En panneau étroit, elles passent sur 2 rangées à partir de
  5 joueurs.
- **Pendant une manche, personne ne bouge :** un arrivant est annoncé à part (« + Nom · prochaine manche »).
- **Les places libres :** une simple pastille.
- **Une place :** les cartes d'abord, le total en petit dans le coin, puis l'avatar rond et le pseudo sous la main, puis
  la mise. Pendant les mises, la place montre la pile de jetons du joueur et « prêt ».
- **Les avatars :** au Core, `profile_image_url` de Twitch, lu et mis en cache. Si l'URL manque ou ne charge pas, un
  remplacement (initiale sur un dégradé) s'affiche, et le jeu n'attend jamais une image. Dans le prototype, un joueur
  simulé sur cinq a une URL cassée pour le montrer.
- **Mon tour :** le tapis entier s'éclaire en or, « À TOI » se pose sur ma place, et le centre dit « À toi de jouer »
  avec mon avatar. Pour un autre joueur, sa place est surlignée et le centre montre son avatar, son pseudo et sa main.
- **Le sabot :** une minuscule icône avec le nombre de cartes restantes.
- **Les cartes :** elles glissent vers la main (34 px, 210 ms, sans rotation). Une carte déjà visible ne rejoue jamais
  son entrée, même après un rafraîchissement ou une reconnexion.
- **L'historique** (bouton en haut à droite) :
  - les 12 dernières manches, produites par le Core, les mêmes pour joueurs et spectateurs (15 gardées) ;
  - pour chaque manche : la banque, le gain ou la perte de chaque joueur, les blackjacks, les paris banque gagnés et le
    nombre de perdus.

## Autorité, idempotence, reprise

C'est ce que les tests vérifient.

- **Ce que le client ne décide jamais :** il n'envoie que des intentions (miser, tirer, rester, doubler, splitter,
  partir). Les cartes, l'ordre du sabot, les gains, la banque, les limites et le tour sont décidés au Core.
- **Chaque action porte deux marques :**
  - le **jeton du tour** visé : une action hors tour ou périmée est refusée ;
  - un **identifiant** : un double clic, ou un renvoi après une réponse perdue, donne la même réponse sans deuxième
    effet. C'est testé dans le navigateur : la réponse au split est perdue, l'action est renvoyée, et il y a un seul
    split et un seul débit.
- **Chaque mouvement du Wallet a une clé unique :** `bet:`, `unbet:`, `double:`, `split:`, `pay:` et `side:`. Un
  règlement rejoué après une interruption ne paie rien de plus. Les tests vérifient aussi la conservation des Jetons :
  soldes + gains de la banque = total de départ.
- **Les mises de deux onglets :** la réservation suit la dernière mise envoyée et ne s'additionne jamais.
- **Ce que voit un client :** un état masqué. La carte cachée est un dos, sans son identité. Le sabot n'est jamais
  envoyé. Les paris banque des autres ne sont visibles qu'une fois résolus.
- **Les numéros de séquence :** un état en double ou plus ancien est ignoré, sans animation ni son. Après un trou ou une
  reconnexion, l'écran reçoit un instantané et se dessine sans rejouer d'animation.
- **Une interruption du Core** (Lab, 5 s) :
  - rien n'est accepté pendant, et aucun timer ne joue ;
  - à la reprise, les échéances passées s'appliquent et la manche se termine ;
  - chaque paiement reste unique.

## Ce que tu peux tester dans le Lab

- **Joueurs simulés :** ils jouent la stratégie de base et parient parfois sur la banque.
  - « Joueurs à ma table » : 2, 3, 5, 7 ou 10, la table se recompose entre deux manches ;
  - un absent : il pose une mise mais ne dit jamais PRÊT, et le délai de secours le montre ;
  - un lent, et un qui part en pleine main ;
  - « +15 au salon » ouvre plusieurs tables.
- **Économie :** le gain potentiel max par manche (100 000, 1 000 000 ou 10 000 000).
- **Forcer la prochaine manche :**
  - paire de 8, re-split jusqu'à 4 mains, As splittés, 11 à doubler, mon blackjack ;
  - blackjack de la banque, avec un As ou un 10 visible ;
  - banque qui saute, 17 souple, tout le monde saute, égalité.

  Le Core échange des cartes dans le sabot sans en changer la composition. Cette fonction n'existe qu'en Lab.
- **Pannes :** déconnexion de 6 s, réponse perdue, rafraîchissement de l'écran, interruption du Core.
- **Affichage :** format panneau 318 × 496, vue spectateur à côté (un autre viewer, non assis), son.
- **Clavier pendant ton tour :** `T` tirer, `R` rester, `D` doubler, `S` split. `Entrée` : PRÊT.

## Ce qui reste au vrai Core après ta validation visuelle

1. **Porter `rules.js` et `paytable.js` en TypeScript** (`apps/core-api/src/casino/blackjack*.ts`), avec ces tests.
2. **Persister les tables** : tables, places, manches, mains et sabot, en lignes PostgreSQL avec une version, mises à
   jour sous `SELECT … FOR UPDATE`.
   - Le sabot est stocké côté serveur seulement, mélangé par `crypto.randomInt`.
   - Option à étudier : publier l'empreinte du sabot pour une preuve d'équité.
3. **Les timers serveur** : un ordonnanceur qui reprend les échéances au redémarrage (aujourd'hui, `resume()` simulé).
4. **Le Wallet réel** : la réservation et les crédits passent par le Wallet existant du Casino, avec les clés
   d'idempotence ci-dessus, les plafonds de solde (`balance_cap`) et un `casino_rounds` par main ou par manche pour
   l'historique.
5. **Les routes `/v1/ext/casino/blackjack/*`** (join, leave, bets, act, state) et le flux d'événements par long-poll,
   comme le Casino actuel, avec le masquage de `view()`.
6. **Spectateurs :** brancher sur le système spectateur existant (`casino_feed`). Les états de table sont déjà publics
   et masqués : le spectateur suit une table, pas un joueur.
7. **Studio › Casino** : ouverture du jeu, limites, et activation des paris sur la banque.
8. **Puis seulement** l'écran dans l'extension (`view.js` et `bj.css` → `shared/casino/blackjack.js`), un Hosted Test,
   et ton GO.

Rien de tout cela n'est commencé côté Core ou extension : c'est volontaire, en attendant ta validation du prototype.
