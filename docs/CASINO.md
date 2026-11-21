# Casino : machine à sous (avec le Coffre), roulette, machine à émotes et blackjack de l'extension

**Casino V1 (20/11/2026)** : les quatre jeux sont validés par Antoni et intégrés au Core, à l'extension et à Studio
(§ 12 blackjack, § 13 machine à émotes ; journal et statut de livraison : [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md)).

État au 18/11/2026 : **intégré et jouable en Lab** (mode spectateur refait le 18/11), branche locale `feat/casino`.
En Production, le Casino reste fermé tant qu'Antoni n'a pas validé :

- la variable `CASINO_EXTENSION` du Core, à `off` par défaut ;
- le réglage Studio `casino.open`, à 0 par défaut ;
- la publication de l'extension.

**Corrigé le 19/11, à valider par Antoni :** le spectateur démarre ses animations en même temps que le joueur (§ 6) ;
les flashs, déformations et zooms intermittents (§ 6, « Stabilité de l'affichage »). Signalés le 18/11, détail dans
[CASINO_HANDOFF_2026-11-18.md](CASINO_HANDOFF_2026-11-18.md). Synchronisation validée par Antoni le 19/11.

**Livré le 19/11, à valider par Antoni :**

- le panneau spectateur de la machine, du Coffre et de la roulette (§ 6) ;
- le vrai ALL-IN de la roulette (§ 4 et § 5). Il est désactivé tant qu'Antoni ne règle pas sa valeur en Production
  (§ 10) ;
- la correction du zoom bref à l'ouverture de Mini-jeux (§ 6, « Stabilité de l'affichage »).

**Livré le 19/11 (deuxième lot), à valider par Antoni :**

- le symbole BONUS dessiné en coffre au trésor doré (§ 2) ;
- le solde de jeu qui suit le Wallet sans recharger l'extension (§ 4, « Solde ») ;
- les mises rapides de la roulette (§ 4) ;
- le prototype du blackjack multijoueur, hors extension et hors Core (§ 12).

L'inventaire des symboles pour les émotes est dans [CASINO_SYMBOLES.md](CASINO_SYMBOLES.md).

Sources de conception : les prototypes validés `prototypes/casino-v7` et `casino-v8`, hors dépôt. Pour les règles,
l'étude du bonus (rapport « Raptoru 2.0 — Le jeu bonus de la machine à sous ») et `casino-v7/etude`.

## 1. Qui fait quoi

| Partie       | Rôle                                                                                                            | Code                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Core         | Vérifie la mise et le solde, tire, calcule, débite, crédite et enregistre la partie, dans une seule transaction | `apps/core-api/src/casino/` (`slot.ts`, `coffre.ts`, `roulette.ts`, `rng.ts`, `service.ts`) |
| Core, direct | Le journal public des spectateurs : les étapes déjà montrées par l'écran du joueur, dans l'ordre (§ 6)          | `casino/feed.ts`                                                                            |
| Core, portes | Extension : `/v1/ext/casino/*` (identité du jeton Twitch). Studio : `casino/<chaîne>/admin/*` en lecture seule  | `ext/casino-ext.ts`, `http/casino-routes.ts`, `http/studio-cockpit-routes.ts`               |
| Core, module | Réglages bornés `casino.*` et supervision du Centre de contrôle                                                 | `modules/casino.ts`                                                                         |
| Extension    | Deux cartes de Mini-jeux (machine, roulette) et le bandeau « parties en direct » ; les écrans animent seulement | `extension/shared/casino/` (`follow.js` : le suivi), `modules/casino/*.css`                 |
| Studio       | Page « Casino » : ouverture, limites, chiffres, parties, refus                                                  | `web/src/pages/casino.ts`, `server/src/casino/relay.ts`                                     |
| Bot          | Rien de nouveau : les messages passent par la file existante (`cmd_steps`, origine `module:casino`)             | —                                                                                           |
| Base         | `casino_rounds` : une ligne par partie ; `casino_feed` : le journal des spectateurs (courte durée)              | `20261201130000_casino.sql`, `20261202130000_casino_feed.sql` (+ jumelles Lab)              |

## 2. La machine à sous

Ce sont les règles validées en V7, avec le Coffre de la V8 :

- **Lignes :** 5 rouleaux, 3 rangées, 10 lignes. Une ligne paie les symboles identiques consécutifs depuis la gauche,
  à partir de 3 (dès 2 pour le 7 et le Diamant).
- **WILD :** il remplace tout sauf BONUS. Une ligne paie une seule combinaison, la meilleure.
- **Table de gains :** celle qui finance le Coffre. Les petits fruits sont réduits :
  - cerise 40 / 115 / 350 ;
  - citron 35 / 115 / 350 ;
  - raisin 65 / 225 / 700.
- **BONUS :** 3, 4 ou 5 BONUS n'importe où ouvrent le Coffre. Ils ne paient rien directement. Depuis le 19/11, le
  symbole est un coffre au trésor doré avec son étiquette BONUS (dessin SVG original, `symbols.js`). Seul le dessin
  change : probabilités, gains et déclenchement sont les mêmes.
- **RTP :** le jeu de base rend 73,12 % (énumération exacte) et le Coffre 21,96 %, soit **95,08 %** au total.
- **Mise :** de 20 à 10 000 Jetons. Les deux bornes sont réglables, sans jamais dépasser 10 000.

### 3. Le Coffre

C'est le modèle recommandé par l'étude. Le test `casino-engine.test.ts` le prouve identique, tirage par tirage, sur
33 000 Coffres.

- **Départ :** les BONUS deviennent les premières pièces, à leur place : ×1, ×2, ×3 ou ×5.
- **Relances :**
  - on dispose de 3 relances ;
  - à chaque relance, une case vide reçoit une pièce avec une probabilité de 4,93 % ;
  - toute nouvelle pièce remet le compteur à 3 ;
  - la première relance pose toujours une pièce.
- **Pièces :** de ×0,5 à ×25. Il y a aussi des jackpots, chacun une seule fois : MINI ×20, MAJEUR ×100, MÉGA ×500.
- **Doubleur :** il sort une seule fois et double toute la grille.
- **Colonne complète :** ses pièces sont doublées, une fois par colonne, avant l'effet du doubleur.
- **Grille pleine :** elle rapporte le GRAND ×1 000. Le maximum exact d'un Coffre est **×2 560**.
- **Tirage :** le Coffre est tiré en entier au déclenchement, avec le tour, et payé avec lui. L'écran ne fait que le jouer.
- **Ce qui ne change rien au gain :**
  - Relancer, Passer, Rapide, Auto ;
  - une fermeture, un rechargement, un autre appareil.
- **Reprise :** l'avancement (`progress_step`) est enregistré par le Core. La reconnexion reprend à la même relance,
  sans second crédit.
- **Rendu :** les cases libres font défiler des symboles et les rouleaux s'arrêtent un par un, le dernier se fait
  attendre. Un BONUS tombe puis se verrouille en médaillon avec sa valeur. Les symboles qui défilent sont du décor,
  choisis par une graine stable : le joueur, le spectateur et le Replay voient les mêmes.

## 4. La roulette

- **Paiements :** roulette européenne, 37 cases dans l'ordre réel. Paiements bruts :
  - numéro plein ×36 ;
  - colonne ou douzaine ×3 ;
  - rouge, noir, pair, impair, 1-18 ou 19-36 ×2 ;
  - le 0 fait tout perdre, sauf la mise placée sur le 0.
- **Mises :**
  - plusieurs paris par tour, seulement sur les cases du tapis ;
  - chaque mise est un multiple de 20 ;
  - total par tour : `casino.roulette_max_total`, 100 000 par défaut.
- **ALL-IN (19/11) :** une exception voulue au plafond par tour.
  - **Ce qu'est un ALL-IN :** une mise qui engage tout le solde, arrondi au multiple de 20 inférieur. Avec 1 000 010
    Jetons, c'est 1 000 000.
  - **Quand l'exception est active** (`casino.roulette_all_in_max_win` > 0) :
    - l'ALL-IN n'a pas de plafond par tour ;
    - son gain possible est borné par ce réglage, au lieu du gain maximum par partie ;
    - une mise qui pourrait le dépasser est refusée avant le tirage, jamais réduite.
  - **Désactivée** (0, valeur par défaut) : l'ALL-IN reste limité au plafond par tour, comme avant.
  - **Mises ordinaires :** elles gardent leur plafond. Une mise au-dessus du plafond qui n'est pas tout le solde est
    refusée (500 000 sur 1 000 000, par exemple).
  - **Le jeton ALL :** l'interface applique la même règle que le Core, `rouletteLimit`, avant d'envoyer. Un ALL-IN
    qu'elle accepte n'est donc pas refusé par le Core, sauf si le solde change entre-temps. La règle est écrite dans
    « Paiements ».
- **RTP :** 97,30 % pour chaque pari, ALL-IN compris.
- **Mise rapide (19/11) :** une languette « Mise rapide » sur le bord droit du plateau, en miroir de « Paiements ».
  - **Ce qu'elle ouvre :** un petit panneau avec le montant (les jetons du tapis, le jeton libre et ALL-IN), six chances
    simples (Rouge, Noir, Pair, Impair, 1–18, 19–36) et « Rejouer ».
  - **En un clic :** le pari est posé sur la vraie case du tapis et lancé.
  - **Ce qui ne change pas :** le tirage du Core, les paiements (×2, le 0 fait perdre), les limites et l'ALL-IN sont
    exactement ceux du tapis.
  - **Le tapis :** il remplace les jetons déjà posés (le panneau le dit), et le tapis classique reste entier.
  - **Indisponible :** un pari impossible (solde, plafond) est grisé, avec la raison en info-bulle. La languette est
    masquée pour un spectateur et en Replay.
- **Solde (19/11) :** la machine et la roulette gardent le solde avec lequel elles jouent.
  - **Le problème corrigé :** un crédit extérieur, par exemple +1 000 000 après un ALL-IN perdu, changeait l'en-tête
    mais pas ce solde. La roulette refusait alors de rejouer.
  - **Maintenant :** à chaque relecture de session, l'extension transmet le Wallet au jeu ouvert
    (`panel.js` → `casino.js` → `wallet-sync.js`).
  - **La source :** si le Wallet diffère, le jeu relit son état **au Core**. Le nombre de la session n'est jamais utilisé
    comme solde jouable.
  - **Les réponses périmées :** une relecture n'est appliquée que si elle est la plus récente, et si le jeu n'a pas reçu
    entre-temps un solde du Core (un tirage, un refus).
  - **Pendant un tirage :** rien n'est appliqué. La fin du tour relit la session, ce qui converge vers le bon solde.
  - **Plusieurs onglets :** c'est le même mécanisme (relecture toutes les 5 s quand le panneau est ouvert).
  - **Tests :** `apps/twitch-extension/test/casino-wallet-sync.test.js`, avec 8 cas de course.
- **Jetons à l'écran :** ils s'adaptent au solde. Le jeton libre est un multiple de 20. Le jeton ALL engage ce qui reste
  misable, arrondi au multiple de 20 inférieur : tout le solde si l'exception est active, sinon dans la limite du
  plafond par tour.
- **La bille :** sa trajectoire suit une graine visuelle tirée par le Core (`outcome.seed`). Le joueur, les spectateurs
  et le Replay voient le même vol. Le numéro, lui, vient toujours du Core.

## 5. Sécurité économique et plafonds

**Ce que garantit chaque tour :**

- **Une seule transaction :** verrou du viewer, contrôle de l'intention, vérifications, verrou du Wallet et lecture du
  solde, tirage, débit (`casino:<partie>:bet`), crédit (`casino:<partie>:win`), enregistrement de la partie.
  - En Production, c'est le Wallet canonique ; dans le Lab, le portefeuille de test.
  - Le registre d'un tour comporte une mise et un gain, au plus.
- **Une intention, une clé :** une réponse perdue, un double clic ou un renvoi rejouent la même partie, sans second
  débit. La même clé avec une autre mise est refusée (`idempotency_conflict`).
- **Refus avant tout débit, jamais de solde négatif :** hors live, Casino ou jeu fermé, pause générale, viewer bloqué,
  mise invalide, au-dessus du maximum, solde insuffisant, gain possible au-dessus du plafond (roulette). Chaque refus
  est compté pour Studio.
- **Un crash avant la fin de la transaction n'a rien débité.** Testé sur un vrai PostgreSQL avec deux Cores.

**Le plafond de gain par partie (`casino.max_win`) :**

- Valeur par défaut, valeur de sécurité du Lab : 1 000 000 Jetons.
- À la machine, un gain plus grand est payé au plafond et marqué « plafonné » au joueur : jamais en silence.
- À la roulette, une mise qui pourrait le dépasser est refusée avant le tirage.
- Effet sur le RTP de la machine (simulation de 20 millions de tours) :

| Plafond (× la mise) | 50     | 100    | 200    | 300    | 500    | 750    | 1 000 et plus |
| ------------------- | ------ | ------ | ------ | ------ | ------ | ------ | ------------- |
| RTP                 | 89,9 % | 92,0 % | 93,1 % | 93,6 % | 94,5 % | 94,9 % | 95,1 %        |

Avec 1 000 000 de plafond et 10 000 de mise maximale, la machine rend 92,0 % à la mise maximale, et 95,1 % jusqu'à
1 000 de mise. Studio › Casino calcule cet effet en direct pour les valeurs en cours.

**L'ALL-IN de la roulette (19/11) :**

- **Gain maximum d'un ALL-IN :** `casino.roulette_all_in_max_win`. Il est à 0 par défaut (exception désactivée),
  jamais en dessous du gain maximum ordinaire, et au plus 2 000 000 000.
- **Pourquoi 2 000 000 000 au plus :** les montants d'une partie tiennent dans les colonnes entières de `casino_rounds`
  (2 147 483 647 au plus). La mise est bornée aussi, car le meilleur gain de toute mise vaut au moins 36/37 de cette
  mise.
- **Contrôles du portefeuille, avant le tirage :**
  - le Lab plafonne un solde à 1 000 000 000 ; le Wallet canonique n'a pas de plafond de solde, seulement une borne de
    10¹² par opération ;
  - le Core vérifie que solde − mise + meilleur gain possible reste dans ces limites. Sinon : refus `balance_cap`.
- **Espérance :** inchangée. Un ALL-IN perd en moyenne 2,70 % de la mise, comme tout pari.
- **Exemple, 1 000 000 en ALL-IN :**

  | Pari         | Chance de gagner   | Solde si gagné |
  | ------------ | ------------------ | -------------- |
  | Rouge        | 48,6 % (18 sur 37) | 2 000 000      |
  | Douzaine     | 32,4 %             | 3 000 000      |
  | Numéro plein | 2,7 %              | 36 000 000     |

  Dans tous les cas, le solde tombe à 0 si le pari perd.

- **Somme maximale créée en un tour :** le gain maximum d'un ALL-IN, moins la mise. Avec la valeur de la démo,
  36 000 000, un ALL-IN reste possible :

  | Pari          | Solde maximum (36 000 000 ÷ le paiement) |
  | ------------- | ---------------------------------------- |
  | Chance simple | 18 000 000                               |
  | Douzaine      | 12 000 000                               |
  | Numéro plein  | 1 000 000                                |

  Au-delà, l'interface et le Core refusent le même ALL-IN avant le tirage, avec un message clair.

- **Martingale :** aucune interdiction particulière. Doubler en ALL-IN, c'est tout remettre à chaque tour. Une perte
  ramène le solde à 0, et le gain maximum d'un ALL-IN borne la série par le haut. Exemple : 5 rouges de suite font
  passer 1 000 000 à 32 000 000, avec une chance sur 37 environ (2,7 %). La série s'arrête là, car un ALL-IN sur une
  chance simple n'est plus accepté au-delà de 18 000 000.
- **Rien d'autre ne change :** le tirage, la transaction unique, la clé d'intention, le verrou du viewer et du Wallet.
  Testé sur PGlite (refus, gros soldes, doubles clics) et sur un vrai PostgreSQL : 10 ALL-IN simultanés depuis deux
  Cores donnent une seule partie, un solde à 0, jamais négatif.

## 6. Live, spectateurs, partages

- **Live :**
  - en Production, le live canonique (`stream_sessions`, ouvert par Twitch via le bot) ;
  - dans le Lab, le live simulé (Studio › Simulation › « Simuler début / fin »), pour qu'on puisse aussi essayer le
    Casino fermé.
  - Un live qui s'arrête pendant un Coffre ne change rien : le gain est déjà crédité, le Coffre reste lisible et se
    termine.
- **Spectateurs (refonte du 18/11) :** on suit un JOUEUR, pas une partie isolée.
  - **Entrée :** dans Mini-jeux, sous les deux jeux, le bandeau « Regarder les parties en direct » : le nombre de
    viewers en jeu et leurs initiales (toucher une initiale suit ce joueur), ou « Personne ne joue en ce moment ». Il se
    met à jour seul. « Regarder › » ouvre la liste : pseudo, jeu, mise, état (En jeu, Coffre, Entre deux tours).
  - **Suivi :** tous ses tours s'enchaînent sans rien rouvrir : les rouleaux, les lignes, le Coffre relance par relance,
    le tour suivant ; s'il passe à la roulette, on le suit sur la roulette (ses jetons pendant qu'il mise, la roue, le
    résultat sur le tapis). S'il quitte le jeu, on le voit (« a quitté le jeu ») ; rien ne reste figé.
  - **Synchronisé, sans résultat en avance (19/11) :** une étape devient publique quand elle COMMENCE sur l'écran du
    joueur (ses rouleaux partent, sa roue part, une relance, la finale du Coffre) : jamais avant que son propre client
    ait le résultat (son tirage vient de lui répondre), jamais au tirage. Le lancement seul ne transmet que la mise. Le
    spectateur joue la même animation sur la même chronologie : il la commence là où en est celle du joueur (l'heure
    du Core, estimée par le meilleur de ses dernières réponses), donc les rouleaux et la bille se posent en même temps
    chez tous. Un résultat arrivé au Core plus de 1,5 s après son tirage (une file d'attente) prend pour moment le
    tirage + 300 ms. Mesuré en Lab (trois navigateurs) : départ ≈ 100–300 ms après le joueur, arrêt ≈ 30–200 ms,
    relance du Coffre ≈ 100–400 ms. Si l'écran du joueur se ferme, le Core publie l'étape une fois son animation
    finie (9 s machine, 14 s roulette, 7 s pour l'ouverture du Coffre). Les relances du Coffre attendent toujours le
    joueur.
  - **Rythme :** Rapide est transmis avec l'étape ; Passer est un événement à part (`skip`, accepté seulement pour une
    étape déjà publique, une fois) qui fait sauter le spectateur à la même fin. Auto enchaîne les tours chez le
    spectateur aussi. Un spectateur très en retard (onglet caché qui revient, plus de 6 s) joue vite pour rattraper.
  - **Mises de la roulette en préparation :** l'écran du joueur les envoie (300 ms après le dernier geste) ; affichées
    comme « pose ses jetons », jamais débitées, remplacées par les vraies au lancement.
  - **Technique :** une seule requête en attente par spectateur (long-poll, réponse dès qu'une étape est publiée, au
    plus 20 s sinon). Chaque événement a un numéro (seq) : pas de doublon, pas de trou, reprise exacte après une coupure.
    Rafraîchir la page revient au même joueur, à l'étape où il en est. Un Core réveille ses spectateurs aussitôt ; un
    autre Core les réveille en moins d'une seconde (une lecture par chaîne et par seconde, seulement s'il y a des
    spectateurs). Le journal ne garde que quelques heures.
  - **Le panneau spectateur (19/11) :** le plateau et les animations restent ceux du joueur. Les commandes du joueur
    disparaissent : Rapide, Auto, Lancer, la barre de mise, Derniers gains, le gros bouton EN DIRECT. À leur place,
    une carte (`Frame.watchCard`) :
    - le joueur suivi : son initiale et son pseudo ;
    - EN DIRECT, avec une pastille rouge ;
    - l'état, en clair : « attend son prochain tour », « lance… », « joue… », « ouvre le Coffre », « pose ses
      jetons », « la bille tourne… », « tour terminé », « a quitté le jeu » ;
    - la mise du tour, en or ;
    - le gain du tour, en vert s'il est positif, neutre s'il est nul. Il reste « … » tant que le Core ne l'a pas rendu
      public : fin du tour à la machine, bille arrêtée à la roulette ;
    - « Coffre · n BONUS » pendant un Coffre ;
    - un bouton Son, pour ce navigateur seulement.

    La disposition dépend du jeu :
    - **Machine :** la carte occupe la colonne de droite, et les rouleaux prennent la hauteur de l'ancienne barre de
      mise (symboles de 66 px au lieu de 59).
    - **Coffre :** la même carte remplace ses commandes.
    - **Roulette :** la carte tient en une ligne sous le tapis, et le tapis gagne de la hauteur ; à côté de la roue, la
      carte verticale, avec le numéro sur la roue.

    La carte est construite une seule fois, puis seuls ses textes changent : sa pastille ne redémarre jamais.

  - **Droits :** un spectateur n'a aucune commande active (mise, jetons, Lancer, Auto, Rapide, Passer, Coffre). Côté
    Core, toute écriture vise le tour de celui qui l'envoie : agir sur le tour d'un autre est refusé. Le détail d'un
    tour d'un autre viewer n'est lisible qu'une fois sa fin publiée.
- **Stabilité de l'affichage (19/11) :** cause mesurée des flashs : le panneau redessinait le module ouvert à chaque
  lecture d'état (toutes les 5 s, le compte à rebours de la Tombola change à chaque lecture) et rattachait l'écran du
  Casino ; ses feuilles `<link>` se rechargeaient (images sans styles : icônes à leur taille naturelle) et ses
  animations ponctuelles se rejouaient. Corrigé : feuilles construites adoptées par le shadow root, pas de redessin
  d'un écran de module hôte sur une lecture identique (hors Tombola), crochets `detaching` / `attached` qui remettent
  chaque animation où elle en était. Contrôle : `casino:watch-check` (0 image sans styles, 0 animation ponctuelle
  rejouée).
- **Zoom bref à l'ouverture de Mini-jeux (19/11) :**
  - **Le symptôme :** une icône géante, la « croix » de Random Ban, quelques images au premier affichage de Mini-jeux.
  - **La cause, mesurée image par image :** la feuille `modules/arcade/arcade.css` n'était demandée qu'à l'ouverture de
    Mini-jeux, et le catalogue se dessinait aussitôt. Ses icônes, des SVG en ligne dont la taille vient de cette feuille,
    occupaient toute la largeur tant qu'elle chargeait :
    - le dé et viseur de Random Ban en 549 × 549 px, dans le titre ;
    - les icônes des cartes entre 350 et 530 px.
  - **Le constat :** 6 sessions sur 6, de 4 à 22 images chacune, toujours pendant le chargement de la feuille. Le
    panneau et le Casino n'y étaient pour rien.
  - **Corrigé dans `random-ban-view.js` :**
    - la feuille est demandée dès le chargement de l'extension ;
    - Mini-jeux et Random Ban restent invisibles, leur place gardée, jusqu'à ce qu'elle soit appliquée (ou en erreur).
  - **Contrôle :** 0 icône agrandie sur 30 sessions d'entrées et sorties, et encore 0 avec les feuilles ralenties de
    0,4 s et 2,5 s.
- **Partage :** depuis l'historique, le viewer partage son propre tour.
  - Le Core relit la vraie partie et écrit le message de LeCroupier_ : court, pertes comprises, jamais présentées comme
    des gains.
  - Rythme : une fois par tour, une fois par viewer toutes les `casino.share_cooldown_s` (300 s par défaut), une fois
    toutes les 30 s sur la chaîne.
  - Seulement quand le Casino joue : ouvert, pendant le live, hors pause globale, viewer non bloqué, tour de moins de
    24 h. Sinon, refus sans aucun message dans le chat.
- **Annonces automatiques :** seulement le GRAND et les gains d'au moins `casino.announce_min_x` × la mise (500 par
  défaut). Au plus une toutes les 2 minutes, par la file existante du bot.

## 7. Symboles personnalisables

Le fichier `extension/shared/casino/skin.js` règle les symboles, et seulement leur apparence :

- **Identifiants stables :** chaque identifiant logique (`cerise` … `bonus`) peut recevoir une image : PNG, WebP (animé
  aussi), GIF, APNG ou SVG.
- **Sources acceptées :** fichiers de l'extension (`assets/casino/…`) ou émotes Twitch (`static-cdn.jtvnw.net`).
- **Cadrage et taille :** `fit`, `scale`, `y`.
- **Animations :** au repos (`idle`) et à la victoire (`win`).
- **Repli :** une image absente ou en erreur revient seule au dessin d'origine.
- **Ce qui ne change pas :** les probabilités, les gains et les tirages ne lisent jamais ce fichier. Par défaut, les
  fruits validés restent en place.

L'inventaire complet, pour choisir les émotes, est dans [CASINO_SYMBOLES.md](CASINO_SYMBOLES.md) : les 9 symboles,
leurs rôles et valeurs, les tailles d'affichage mesurées et les animations possibles.

## 8. Studio › Casino

La page regroupe :

- **Ouverture :** le Casino, puis chaque jeu.
- **Annonces automatiques.**
- **Limites :** mises, total de roulette, gain maximum, délai de partage, seuil d'annonce. On les prépare, puis
  « Appliquer ». Une confirmation est demandée sur le vrai Core.
- **Effet sur le RTP** des valeurs en cours.
- **Chiffres des 24 dernières heures** par jeu : parties, joueurs, misé, payé, net, plafonnés.
- **Parties :** celles en cours et les 60 dernières, avec le détail technique (tirage, clés Wallet).
- **Refus :** compteurs et derniers cas.

Studio ne lit que `casino/<chaîne>/admin/*`. Le cockpit refuse toute autre route du Casino : une installation de Studio
ne joue jamais à la place d'un viewer.

## 9. Essayer en Lab

**Démo rapide, sans Studio :** `npm run casino:demo -w @raptoru/core-api`, puis ouvrir http://127.0.0.1:4497.

- **Ce qui tourne :** un Core en mémoire, le portefeuille de test et la vraie extension.
- **Les comptes fictifs :** Alice joue (1 000 000 Jetons) ; Bob la regarde : dans sa fenêtre, Mini-jeux › bandeau
  « Regarder les parties en direct » › l'initiale d'Alice. Un lien en haut ouvre Carla, un 2ᵉ spectateur.
- **Les commandes du Lab :**
  - live oui / non, Casino ouvert / fermé ;
  - gain maximum, solde d'Alice ;
  - gain maximum d'un ALL-IN. La démo le met à 36 000 000 (exception active) ; 0 rend l'ALL-IN ordinaire. Pour un
    très gros solde, régler celui d'Alice, par exemple à 500 000 000 ;
  - prochain tour : Coffre à 3 ou 5 BONUS, grille pleine, ou roulette sur le 17. Ce sont de vrais tirages, seulement
    choisis, et cela n'existe que dans cette démo ;
  - Luna joue ou ouvre un Coffre, à regarder depuis Bob.
- **À l'écran :** le chat simulé de LeCroupier_ et la lecture de Studio.

**Contrôles automatiques :** `npm run casino:check -w @raptoru/core-api` (le Casino entier, 25 points) et
`npm run casino:watch-check -w @raptoru/core-api` (les spectateurs : Alice, Bob et Carla dans trois navigateurs).

**Lab complet :** `npm run studio:lab`. On y trouve Studio › Casino, l'extension du Lab et le live simulé
(Simulation › Simuler début).

## 10. Avant la Production : à valider explicitement par Antoni

1. **Les limites :**
   - mise maximale de la machine (10 000 validé) et gain maximum par partie : 1 000 000 en Lab ; voir l'effet sur le
     RTP au § 5 ;
   - total par tour de la roulette (100 000) ;
   - délai de partage (300 s) ;
   - seuil d'annonce (×500) ;
   - **le gain maximum d'un ALL-IN** (`casino.roulette_all_in_max_win`). Il vaut 0 par défaut : l'ALL-IN reste dans le
     plafond par tour, comme aujourd'hui. Pour le vrai ALL-IN, il faut choisir une valeur, par exemple 36 000 000 :
     un ALL-IN reste alors possible jusqu'à 1 000 000 sur un numéro et 18 000 000 sur une chance simple (§ 5). Aucune
     valeur n'est réglée pour la Production à ta place.
2. **Le déploiement du Core et de ses migrations** `20261201130000_casino.sql`, `20261202130000_casino_feed.sql`,
   `20261203130000_casino_feed_skip.sql` et `20261204130000_casino_v1.sql` (additives). Sauvegarde, puis
   `--migrations-approved`.
3. **La variable `CASINO_EXTENSION`** : `testers:<id>,…` pour un Hosted Test, puis `on`.
4. **Studio :** release avec la page Casino, puis `casino.open = 1` ; chaque jeu (`slot_open`, `roulette_open`,
   `book_open`, `blackjack_open`) est ouvert par défaut une fois le Casino ouvert.
5. **L'extension :**
   - inventaire validé (la ligne « Validé par Antoni : oui » est celle d'Antoni), Hosted Test, revue Twitch ;
   - `random_ban_ext.enabled = 1`, qui porte la carte Mini-jeux.
6. **Les messages de LeCroupier\_ :** textes de partage et d'annonce (service, fonction `shareText`), et le rythme.

## 11. Retour arrière

| Quoi             | Comment                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tout le Casino   | Studio › Casino › Fermé (`casino.open = 0`, immédiat) ; ou `CASINO_EXTENSION=off` (redémarrage du Core)                                                                                                                                                                  |
| Un jeu           | `casino.slot_open` / `roulette_open` / `book_open` / `blackjack_open = 0` (une manche de blackjack engagée se termine et se paie)                                                                                                                                        |
| Annonce de table | `casino.bj_announce = 0`                                                                                                                                                                                                                                                 |
| Les annonces     | `casino.announce = 0`                                                                                                                                                                                                                                                    |
| Core             | Redéployer le Core précédent : il ignore `casino_rounds`, `casino_feed` et `casino_bj_tables` (migrations additives). Une manche de blackjack en cours reste figée jusqu'au retour d'un Core V1 (aucun Jeton perdu : les mises engagées restent dans l'état de la table) |
| Extension        | Ne pas publier, ou version précédente dans la console Twitch : sans Casino, les tuiles n'apparaissent pas                                                                                                                                                                |

## 12. Blackjack multijoueur — Casino V1 (20/11)

**Intégré au Core et à l'extension le 20/11** (mandat d'Antoni « CASINO V1 : intégration finale et mise en
Production » ; journal : [CASINO_V1_INTEGRATION.md](CASINO_V1_INTEGRATION.md)). Les règles, la grille et l'écran sont ceux
du prototype validé, versionné dans `prototypes/casino-blackjack` (il se lance toujours seul : `node start.mjs`).

- **Le Core décide tout** (`apps/core-api/src/casino/blackjack/`) : le sabot de 8 paquets, les cartes, les tours, les
  timers, l'assurance, les gains. `rules.ts` et `paytable.ts` sont le prototype à l'identique (test de parité sur
  20 000 mains) ; `engine.ts` est la machine de table ; `service.ts` la porte vers Postgres et le Wallet.
- **Une ligne par table** (`casino_bj_tables`, migration `20261204130000_casino_v1.sql`) : tout l'état de la table,
  modifié seulement sous le verrou de sa ligne, dans la même transaction que les mouvements du Wallet. Chaque mouvement
  a sa clé (`casino:bj:bet|unbet|double|split|ins|insp|pay|side:…`) : un double clic, deux onglets ou une requête
  renvoyée ne paient jamais deux fois. Une action porte le jeton du tour visé et son identifiant.
- **Timers serveur** : l'étape en attente est enregistrée avec la table et jouée par le Core (toutes les 250 ms). Après
  un redémarrage, elle joue en retard avec son défaut sûr : RESTER, pas d'assurance, donne avec les joueurs prêts. Une
  table vide n'a aucune étape : elle garde son numéro sans rien consommer.
- **Tables** : la première s'ouvre toute seule quand un viewer s'assoit, sous le verrou du salon (deux premiers joueurs
  au même instant = une seule table n°1, prouvé sur vrai Postgres avec deux Cores) ; une table pleine (10) ouvre la
  suivante, 8 au plus. Un joueur n'est que sur une table. Une place choisie déjà prise est refusée.
- **Présence** : l'écran du joueur lit sa table en continu ; un joueur non vu depuis 25 s ne bloque jamais la donne (son
  assurance est refusée, sa décision devient RESTER à l'échéance) ; hors manche, sa place se libère après 90 s.
- **Reprise** : rafraîchir l'extension redemande l'état de la table au Core ; rien n'est retiré, redistribué ni
  remboursé, aucune animation n'est rejouée. Un joueur parti en pleine manche retrouve sa place et sa main.
- **Spectateurs** : n'importe quel viewer regarde une table depuis le salon (ou suit un joueur depuis « Parties en
  direct ») ; la carte cachée et l'ordre du sabot ne quittent jamais le Core ; aucune commande n'agit.
- **Annonce dans le chat** : seulement à la personne qui a créé la table, une petite question « Une table de blackjack
  vient d'ouvrir ! Tu veux prévenir le chat ? ». Le message part uniquement sur « Annoncer dans le chat », par la file
  existante de LeCroupier_ (`cmd_steps`, `module:casino`), une fois par table, au plus une annonce de table toutes les
  `casino.bj_announce_gap_s` (600 s). Chat indisponible : le blackjack reste jouable. Aucune récompense.
- **Historique** : chaque manche réglée écrit une ligne par joueur dans `casino_rounds` (jeu `blackjack`).
- **Réglages** (Studio › Casino) : `blackjack_open`, `bj_main_min` (100), `bj_max_win` (1 000 000, gain net possible
  par manche, refus avant la donne), `bj_side_max_return` (100 000), `bj_announce`, `bj_announce_gap_s`.

### Historique du prototype (19–20/11)

Le prototype (`prototypes/casino-blackjack`, `node start.mjs`) contient :

- les règles précises ;
- la grille exacte des paris sur la banque, et l'analyse anti-comptage qui a fixé la coupe à 25 % et le Blackjack à
  ×19 ;
- les choix multijoueur et timers ;
- ce qui reste à faire au Core.

Tout est dans son `README.md`. Validé par Antoni le 20/11 (mandat Casino V1).

**V2 (19/11, après le premier essai d'Antoni) :** l'ergonomie est refaite, les règles et la grille ne changent pas.

- **Table :** elle s'adapte au nombre de joueurs, chaque place a un avatar et un pseudo, et le tour du joueur se voit
  d'un coup d'œil.
- **Mises :** elles se posent comme à la roulette (jeton, puis cercle ou case banque), puis PRÊT les verrouille. Le
  délai de secours de 45 s ne démarre qu'au premier PRÊT et rend les mises non confirmées.
- **Économie :** mise dès 100, sans maximum fixe ; c'est le gain potentiel (doubles et splits compris) qui est borné
  avant la donne.
- **Paris banque :** les retours sont affichés en Jetons entiers.
- **Décisions :** 30 s, puis 20 s, puis 12 s pour un absent ; le temps n'apparaît qu'à 8 s.
- **Historique :** les résultats des dernières manches.

**V3 (19/11) :**

- **Présentation :** les 7 scores de la banque sont en arc autour d'elle, et les mises se posent directement sur sa
  place.
- **Historique :** une languette ouvre un panneau latéral, avec des manches repliées.
- **Pendant la manche :** un badge BUSTED, et des jetons qui volent au règlement.
- **Places :** on choisit la sienne dans le salon.
- **Grille :** en cotes « paye a:b » à dénominateur 1, 2 ou 5 (17 et 18 à 11:2, 19 à 6:1, 20 à 4:1, 21 à 12:1,
  Blackjack à 18:1, Bust à 12:5). Le RTP passe à 89,9-95,8 %, contre 90,2-96,2 % avant. Détail et avant/après dans le
  README du prototype.

**Finition visuelle (20/11) :** même jeu, mêmes règles, même grille.

- **Tapis :** la zone de jeu est un arc de feutre plus chaud, avec un seul liseré d'or et des coins plus sombres (plus
  d'ovale complet). Les cartes de la banque sont centrées et éclairées ; le sabot n'est plus qu'une indication dans un
  coin, détaillée au survol.
- **Paris banque :** 7 cases identiques, droites, opaques et symétriques, avec « B » pour Blackjack (nom complet au
  survol). Le titre suit la courbe.
- **Places :** chaque place est posée sur la courbe du feutre. Le joueur actif reçoit une étiquette verte « JOUE » ; une
  main busted est désaturée, et ses cartes et sa mise restent lisibles. Aux résultats, l'étiquette de mise affiche le
  net.
- **Boutons :** une couleur et une icône par action ; l'état désactivé est éteint.
- **Historique :** pour chaque joueur, mise principale et mains, chaque pari banque (misé, retour) et le net.
- **Bulle :** la mise, le gain net et le retour total.
- **Contrôles :** 81 contrôles Chromium, dont un audit de chevauchements et de textes coupés à 565 × 376 et en panneau 318.

**Passe corrective du 20/11 (règles + UI) :**

- **Banque bust :** vérifié dans tous les cas, le moteur était juste : toute main vivante gagne, une main bust perd,
  aucune égalité. L'« égalité » affichée venait du net total (main + paris banque). L'étiquette et le centre montrent
  désormais le résultat de la main, puis les paris banque, l'assurance et le total.
- **Assurance :** officielle, seulement face à un As : la moitié de la mise au plus, payée 2:1 si la banque a
  blackjack, perdue sinon (la main continue). Un joueur qui a un blackjack face à un As se voit proposer l'even money.
  Au Core : phase `insurance` avant la vérification de la banque, clés `ins:` / `insp:`.
- **UI :** panneau « Règles » à gauche ; languettes discrètes (icône, nom au survol) ; BUSTED au milieu de la place ;
  titre courbe abaissé ; historique avec un résumé par manche (ma main, mes paris banque ✓/✗, l'assurance).
- **Tests :** 47 tests et 95 contrôles Chromium.

## 13. Machine à émotes — Casino V1 (20/11)

Le prototype validé (`prototypes/casino-emotes`, versionné) est la deuxième machine de la tuile Mini-jeux.

- **Règles** : 5 × 3, les 10 lignes de la machine à fruits ; 9 symboles payants (4 forts dès 2, 5 communs dès 3) et le
  BONUS Qilby, WILD sur les lignes et scatter (2 / 20 / 200 × la mise). 3 BONUS ou plus : 10 tours gratuits, un symbole
  tiré au hasard devient extensible (il remplit ses rouleaux et paie sur les 10 lignes en plus) ; 3 BONUS pendant le
  bonus : +10 tours. RTP exact du moteur : **95,23 %** (`prototypes/casino-emotes/tools/rtp.mjs`).
- **Au Core** : `apps/core-api/src/casino/book.ts`, jeu `book` du service existant. Le tour ENTIER (base, symbole,
  chaque tour gratuit) est tiré au spin et payé dans la même transaction, comme le Coffre ; l'écran ne fait que le jouer.
  Parité exacte avec le moteur du prototype (3 000 tours identiques). Un rechargement reprend les tours gratuits là où
  l'écran en était (`progress_step`), déjà crédités ; les spectateurs voient chaque tour gratuit quand le joueur le
  voit.
- **Extension** : `shared/casino/book.js` (l'écran du prototype sur les vrais modules de la machine), `book-symbols.js`,
  `book-sfx.js`, `modules/casino/book.css`, images `assets/casino/emotes/`.
- **Mise** : `book_min_bet` 20, `book_max_bet` 1 000 par défaut, en multiples de 10. Le gain d'un tour est payé jusqu'au
  « gain maximum par partie » (`max_win`, 1 000 000), marqué « plafonné » au joueur. Effet mesuré par simulation
  (3 millions de tours) : voir CASINO_V1_INTEGRATION.md § RTP et plafond.

## 14. Post-live du 21/11 — lots A et B (PR #99, #100)

Corrections du premier retour des viewers (audit `_recherches/casino-audit-2026-11-21`, hors dépôt). **Extension
seule** : aucune règle, cote, mise ni limite du Core modifiée ; le Core en Production (`1f05b97c`) suffit.

- **Split, règles réelles du moteur** (`blackjack/rules.ts`, `actions()`) : 4 mains au plus ; re-split permis sur une
  nouvelle paire de même valeur ; As splittés : une carte chacun, jamais de re-split ni de double, et un 21 obtenu ainsi
  n'est pas un blackjack ; doubler après un Split est permis (sauf sur As splittés). Chaque main est réglée et payée
  sur sa propre clé (test de bout en bout : `casino-blackjack.test.ts` « split »).
- **Affichage** : une place montre toutes ses mains (cartes, total, mise ; la main à jouer entourée) ; des verdicts
  opposés donnent « Partagé » et le détail par main, jamais « Égalité ».
- **Quitter** (décision d'Antoni du 21/11, comportement du Core inchangé) : sans mise engagée, la place se libère ;
  avec une mise engagée, le joueur quitte l'écran mais sa main reste en jeu (RESTER à l'échéance) et est réglée
  normalement ; il la retrouve s'il revient pendant la manche. Rien n'est confisqué.
- **Mes manches** : onglet de l'Historique (route existante `/casino/history?game=blackjack`), Partager (route
  existante `/casino/share`, mêmes protections). « Remettre à zéro » ne déplace qu'un point de départ dans le
  navigateur du viewer (`casino:bj:session`) : jamais une opération du Wallet.
- **Machines** : Auto suit un budget local qui reproduit le quota du Core (`shared/casino/rate-pace.js`) ; un 429
  pendant Auto met en pause au lieu d'arrêter.
- **Responsive** : `--g` (échelle commune de l'extension) sur les tailles qui décident de la place ; Blackjack réorganisé
  sous 320 px de haut (`@container bj`) ; vitre des machines à proportions fixes.

**Banc visuel** (données fictives locales, aucun appel au Core ni à Twitch, aucun débit) :

- `npm run casino:bench -w @raptoru/twitch-extension` : ouvre une page où choisir le jeu, l'état (table vide, pleine,
  mon tour, Split, Split mixte, blackjack de la banque, spectateur, Règles, Mes manches ; gains et erreur des machines)
  et la taille (vidéo zoomée, panneau, référence, plein écran, mobile portrait et paysage, ou libre).
- `npm run test:casino-responsive -w @raptoru/twitch-extension -- [--games blackjack,slot] [--quick] [--shots]` :
  chaque jeu × état × taille, contrôles coupés ou hors champ, erreurs JS ; captures dans
  `apps/twitch-extension/test/responsive/out/shots/<tag>/` (hors Git).
- Limites : Chromium n'est pas le client Twitch (contrôle final dans l'extension réelle) ; un historique qui défile et
  la languette « Gains » (qui dépasse de 3 px par design) sont signalés sans être des défauts.
