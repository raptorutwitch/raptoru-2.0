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

## 15. Passe corrective de nuit du 21/11 (PR #102, #103)

Toujours **extension seule** : aucune règle, cote, mise, limite ni route du Core modifiée ; le Core en Production
(`1f05b97c`) suffit, aucun déploiement Core / Coolify.

- **Blackjack — Historique** : une petite languette horloge (elle s'élargit au survol ; icône seule au toucher) ;
  panneau à deux onglets Cette table / Mes manches ; Mes manches = une carte « Bilan de la session » (net, nombre de
  manches, depuis quand, bouton « Remettre le bilan à zéro » confirmé) puis une carte par manche (score de la banque,
  gain ou perte, table · manche · mise, heure discrète, « Partager dans le chat »).
- **Blackjack — Quitter** : bouton explicite (porte) dans la barre du bas avec les autres actions, icône seule en
  panneau étroit ; confirmation seulement si une mise est engagée (elle reste engagée jusqu'au règlement : décision
  d'Antoni) ; un double appui n'envoie qu'une demande.
- **Blackjack — Split** : au tour du joueur, toutes ses mains au centre, côte à côte (« Main k · à jouer » entourée,
  mains finies estompées) ; ma place un peu plus grande, les autres en retrait ; bilan mixte « Main 1 perdue · Main 2
  gagnée » puis « Bilan ±0 · rien gagné, rien perdu ».
- **Blackjack — téléphone / panneau étroit** : paris sur le score de la banque en grille sous la banque ; places en
  carrousel glissable (plus de 3 joueurs) recentré sur le joueur dont c'est le tour ; jetons sur leur propre ligne ;
  cibles au doigt (`pointer: coarse`). Hauteur basse (≤ 380 px, dont l'application Twitch en paysage) : banque et
  paris compacts, les places ne sont plus avalées.
- **Machines (Slot + Book)** : sous 520 px de large, rouleaux en pleine largeur, mise dessous, puis une rangée
  Derniers gains · Rapide / Auto / Son · Lancer. La plaque nomme ce qui paie (« +40 Haut · 3 × Cerise (dont 1
  WILD) » ; Book : « dont 1 BONUS ») pendant le dévoilement, Rapide compris, et après ; la table des gains nomme les 10
  lignes, dit que seules elles paient (de gauche à droite depuis le 1er rouleau), le rôle du WILD et « un gain par
  ligne ». Tout est lu dans le tour du Core, jamais recalculé. Audit des gains (21/11) : le +80 signalé est
  correct, aucun écart entre le calcul du Core et l'affichage ; le défaut était l'explication, corrigée ici.
- **Roulette** : le tapis validé est conservé (ses cases deviennent hautes, faciles au doigt) ; sous 520 px, la barre du
  bas se réagence (derniers numéros · jetons glissables · Annuler / Effacer / Reposer / Doubler + Lancer) au lieu de se
  chevaucher ; la roue passe au-dessus du résultat ; mises posées et libellés plus petits.
- **Banc** : matrice étendue à 844×300 et à deux estimations de l'application Twitch (360×480 portrait, 300×340
  compact) en mode tactile ; machines et roulette réellement lancées dans le banc (grilles et tirages au format du
  Core).

## 16. Composition responsive et banc interactif en cadre réel (21/11, après essai d'Antoni)

Toujours **extension seule** (le Core en Production `1f05b97c` suffit : aucune règle, cote, mise, limite, route ni
protection modifiée). Retour d'Antoni sur le banc : les débordements étaient corrigés, pas la façon d'occuper
l'espace ; et le banc ne montrait ni le vrai cadre de Raptoru Live ni de vraies parties.

**Banc** (`npm run casino:bench -w @raptoru/twitch-extension`, http://127.0.0.1:4472/) :

- **Extension complète** (par défaut) : les vraies pages de l'extension (`video_component.html`, `panel.html`,
  `mobile.html`, shell v2) en mode démo — en-tête Raptoru Live, module Mini-jeux, ‹ retour fonctionnel, solde fictif
  dans l'en-tête — pour chaque surface et format réels (largeur ET hauteur). Elles jouent contre un **Core local**
  (`test/responsive/casino-demo/local-core.js`) qui exécute les **moteurs du Core eux-mêmes**
  (`apps/core-api/src/casino/{slot,book,roulette,coffre}.ts`, `blackjack/engine.ts`, compilés pour le navigateur par
  esbuild au lancement) avec des Jetons fictifs en mémoire de la page (50 000 au départ) : mêmes tirages, règles et
  règlements, mêmes réponses que les routes. Aucun appel au Core, à Twitch ni au Wallet ; marqué « Démo locale ».
  - Machines : vraie mise, Lancer, Rapide, Auto (arrêt compris), gains et table des gains ; « Prochain tirage »
    choisit la SORTE du résultat suivant (perte, une ligne, WILD/BONUS, plusieurs lignes, gros gain, Coffre / tours
    gratuits) en retirant avec le vrai moteur jusqu'à en obtenir une — jamais un résultat inventé.
  - Roulette : jetons, mises posées et retirées, tirage animé, résultat ; « Prochain numéro » au choix.
  - Blackjack : salon, s'asseoir, miser, PRÊT, donne, Tirer / Rester / Doubler / Split, assurance et even money,
    règlement, historique, quitter et revenir ; « Joueurs fictifs » (0 à 9, stratégie de base) et « Prochaine donne »
    (paire, As-As, 11, blackjack, banque As…) via le `rig` du moteur.
- **Jeu isolé** : l'ancien banc (un jeu seul sur des états figés), signalé comme non représentatif du cadre réel.

**Contrôle de composition** (`npm run test:casino-compose -w @raptoru/twitch-extension`) : dans le cadre réel, chaque
jeu est JOUÉ sur 9 formats (vidéo 651×434, 452×301, 1053×702 ; panneau 318×496 ; téléphone 390×844, 360×780, 430×932,
390×560, 844×390 en tactile) ; à chaque étape il mesure l'occupation de la zone par ce qui compte, le plus grand vide
horizontal, la distance du jeu à sa commande principale, les cibles tactiles sous 32 px et les débordements, et
enregistre une capture (`test/responsive/out/casino-compose/`, rapport `RAPPORT.md`). L'ancienne matrice
anti-débordement (`test:casino-responsive`, jeu isolé) reste en place.

**Trouvé grâce au cadre réel** :

- **Mobile (`mobile.html`, l'application Twitch) : le Casino faisait 0 px de haut.** La page grandit avec son contenu
  (`min-height`) : la hauteur « 100 % » du Mini-jeux ne se résolvait pas et l'écran du Casino (taille fixe, container
  `size`) retombait à 0. Corrigé (`arcade.css` : la colonne flex du module donne sa hauteur au jeu ; `casino.css` :
  `#body` épinglé à la boîte de l'hôte). Vaut aussi pour `panel.html`.
- **Blackjack à 651×434** : l'en-tête laisse ≈ 373 px à la table ; le mode « hauteur basse » (≤ 380 px) s'y
  appliquait (banque à 22 px, arc des paris débordant sur le centre). Seuils : hauteur basse ≤ 339 px, nouvelle
  hauteur moyenne 340-399 px (rangée de la banque 112 px) ; l'arc se cale sur la hauteur réelle de sa rangée.

**Compositions** :

- **Roulette, portrait** (≤ 560 px de large et plus haute que large) : le MÊME tapis debout, comme une vraie table
  verticale — 0 en haut, 12 rangées de 1·2·3, les 2:1 en bas, douzaines puis chances simples sur la droite. Chaque case
  porte sa place horizontale et verticale (`roulette.js` `at()`) : toutes les mises existantes restent possibles, au
  même endroit logique. De haut en bas : derniers numéros · tapis (cases ≈ 70 × 40 px, jamais étirées) · jetons ·
  Annuler / Effacer / Reposer / Doubler + LANCER (avec la mise totale). Le tapis horizontal validé reste celui du PC et
  du paysage. En portrait court (≈ 390 × 560, panneau), le tapis garde des cases d'au moins 30 px et défile dans son
  cadre ; le numéro sorti est ramené en vue.
- **Machines, portrait haut** (≥ 600 px) : une borne verticale centrée d'un bloc — « Derniers gains » en fronton (4
  derniers résultats côte à côte), la vitre en pleine largeur, plus haute parce qu'elle montre davantage les symboles
  voisins (`--peek`, relu par `reels.js` : symboles jamais déformés), la mise juste dessous, Rapide · Auto · Son à
  gauche du gros LANCER. Portrait moyen (≈ 390 × 560) : la vitre prend la hauteur libre. Le Coffre est empilé
  (jackpots · coffre · relances et gain · Le Coffre / Rapide / Auto / Passer + gros bouton) au lieu de sa colonne de
  150 px qui écrasait le coffre en bandes et coupait le bouton. Les deux machines.
- **Blackjack, portrait** (étroit et ≥ 430 px de tapis) : de haut en bas, la banque en grand (cartes ≈ 7 % de la
  hauteur), ses paris en grille sous un titre visible (cases ≈ 40 px), le centre (ce qui se passe, la main de qui joue),
  les autres joueurs (carrousel au doigt, recentré à chaque tour sans gêner le défilement entre deux tours), puis **ma
  place en grand** juste au-dessus des commandes : mes cartes, ma mise, mon cercle de mise ; mes mains splittées y
  restent. À mon tour, le centre dit seulement « À toi de jouer » (et le temps).
- **Blackjack, barre** : « Mise en cours » (petite zone dorée, distincte) remplace « reste 49 900 » — le solde est
  dans l'en-tête ; Quitter = la porte rouge seule, séparée des jetons, `title` « Quitter la table » et `aria-label`
  (au toucher : sans mise engagée on quitte tout de suite, avec une mise engagée une confirmation l'explique ; la règle
  validée ne change pas ; après le règlement, plus de confirmation ni de mise dite « engagée »).
- **Blackjack, panneaux** : languettes Règles / Historique centrées sur le bord vertical du tapis, collées au bord
  (icône seule ; le libellé s'ouvre au survol sur PC). Historique : « Partager dans le chat » et « Remettre le bilan à
  zéro » deviennent de petits pictogrammes (partage dans le coin de la carte ; flèche de remise à zéro, toujours
  confirmée ; `title` + `aria-label` ; aucune donnée réelle effacée). Règles : un **accordéon** de 10 rubriques
  (Blackjack, Valeur des cartes, Tour de la banque, Tirer / Rester, Doubler, Split, Assurance avec un exemple chiffré,
  Even Money, Paris sur le score de la banque — cotes lues dans la grille —, Quitter la table), textes courts relus
  contre `rules.ts`, `engine.ts` et `paytable.ts`.
- **Blackjack, Split (PC)** : le nom de chaque main à côté de son total (une rangée de moins) : les mains ne recouvrent
  plus le titre des paris.
- **Paysage franc et étroit** (vidéo zoomée 452 × 301, 377 × 251) : les dispositions « téléphone » (pile verticale)
  ne s'appliquent plus qu'aux cadres d'au plus 4:3 ; au-delà, machines et roulette gardent la composition de PC
  resserrée (vitre ≈ 4 fois plus grande, rangées du tapis ≈ 30 px au lieu de 10).
- **Tactile** : touches de mise ≥ 44 px, languettes latérales 30 px, « Derniers gains », son, Rapide et Passer ≥ 32 px,
  croix des panneaux 36 px ; Blackjack en paysage téléphone : les 7 paris banque sur une rangée de 30 px (au lieu de
  2 rangées de 16), jetons et actions 32-34 px.

## 17. Passe corrective après les essais interactifs d'Antoni (21/11 au soir)

Toujours **extension seule** : aucune règle, cote, mise, limite, route ni protection du Core modifiée (Core en
Production `1f05b97c`). Un test du Core a été ajouté (`casino-blackjack.test.ts`), sans changer son code.

**Split, main par main.** Le comportement est vérifié à quatre niveaux :

- **Le Core** (`engine.ts`) : Tirer, Rester et Doubler ne touchent que la main du tour (`t.turn.hand`). Au Split,
  la main 1 reçoit sa 2ᵉ carte tout de suite. La main 2 reçoit la sienne automatiquement quand vient son tour
  (`nextTurn` : « A split hand gets its second card when it becomes active »). C'est une règle voulue et standard,
  conservée.
- **Ce que reçoit l'extension** : un état par événement, `last` = `{ type: 'card', seat, hand, auto: true }` pour
  la carte distribuée sans clic.
- **Ce que l'extension montrait** :
  - Quand Tirer terminait la main 1 (bust ou 21), la main 2 recevait sa 2ᵉ carte 0,4 s plus tard. Entre les deux,
    le centre se vidait (`turn` nul) puis se redessinait, et les deux mains semblaient tirer ensemble.
  - Corrigé :
    - le centre et la barre gardent le joueur entre deux décisions (`turnOf`) ;
    - rien n'est redessiné en passant d'une main à l'autre ;
    - chaque main porte son état (« à jouer », « attend sa 2ᵉ carte », « finie ») ;
    - la barre affiche « Main 1 sur 2 » au-dessus des actions ;
    - un message explique la carte automatique ;
    - la rubrique Split des Règles la décrit aussi.
- **Le simulateur** : il exécute ce même moteur, il ne pouvait donc pas différer.
- **Test** : un test du Core joue un Split, trois Tirer sur la main 1 jusqu'au bust, puis Doubler sur la main 2. Il
  vérifie qu'à chaque Tirer une seule carte arrive sur la seule main active, que la main 2 reçoit exactement une carte
  à son tour, et que Doubler ne double que sa mise.

**Assurance.** Le moteur règle correctement : l'assurance payée 2:1 rend 3 × sa mise.

- Exemple : main 5 000 perdue, assurance 2 500 → 7 500 rendus, bilan 0.
- La présentation était trompeuse : « Perdu −5 000 » en gros, puis le bilan en petit.
- Désormais, au règlement : « Main perdue −5 000 », « Assurance gagnée +5 000 », « Bilan 0 Jeton ». Tous les montants
  sont NETS, jamais le paiement brut.
- La place affiche le bilan (« bilan ±0 ») dès qu'il y a une assurance ou un pari banque.
- La proposition d'assurance dit ce qu'on accepte réellement : « Assurance 2 500 : +5 000 net si elle a blackjack (ta
  mise est compensée), sinon perdue et ta main continue ».

**Even money → « Gain assuré ».**

- Ce qu'on accepte réellement (`engine.ts`) : la main est payée 1:1 quoi qu'ait la banque (5 000 → +5 000).
- Ce n'est jamais un « +0 » : l'égalité ne concerne que l'autre choix, quand la banque a aussi blackjack.
- Les deux boutons : « Gain assuré +5K » et « Tenter le 3:2 +7K5 ou 0 ».
- Le résultat : « Gain assuré +5 000 ». La rubrique des Règles s'appelle « Gain assuré (Even money) ».
- Pas de confirmation supplémentaire : la décision a 12 s et les deux boutons disent chacun leur montant.

**Bust.** Un seul signal : le score rouge « 26 · bust ». Le ruban BUSTED posé dessus est retiré. Le score reste en
couleur, la place est grisée.

**Mains de plusieurs cartes.**

- Chaque main mesure sa largeur réelle (container `hand`). Les cartes se resserrent progressivement (jusqu'à 74 % de
  recouvrement, la valeur reste lisible), puis rapetissent un peu seulement si ça ne suffit pas.
- Les cartes ne débordent jamais sur la place voisine.
- Le score passe en haut à droite (le coin vide d'une carte), avec un liseré sombre pour ne pas se fondre dans une
  carte blanche.
- Valable pour les places, les mains splittées et le carrousel.

**Mises.**

- Le Core impose des multiples de `step` (10). La mise principale va de `bj_main_min` (100) au plafond de gain
  (splits et doubles compris, 125 000 par défaut) ; un pari banque commence à 10.
- Le jeton libre affiche ces valeurs sous le champ. Il n'arrondit plus en silence : 1 255 est refusé avec « 1 250 ou
  1 260 ? ».
- L'arrondi apparent venait aussi de l'affichage : `kfmt` montrait 1 250 en « 1K2 ». Il est désormais sans arrondi
  (« 1K25 »), testé.
- Sur PC, le titre « Pari sur le score de la banque » descend de 6 px sous les cases.

**Historique.**

- Partager = trois points reliés, dans le coin de la carte. Remise à zéro = une flèche autour d'un 0, toujours
  confirmée.
- Les deux pictogrammes sont compacts (26 px, 32 au doigt, cible étendue invisible).
- « Mes manches » détaille main, assurance et paris quand la manche est encore dans l'historique de la table. Le Core
  ne renvoie que le net et le total misé (« misé 7 500 »).

**Salon.**

- Une ligne par table : numéro, joueurs et état, l'œil (« Regarder », spectateur), « Rejoindre » sur la même ligne.
- Les petites places restent pour choisir la sienne à la souris ; au doigt, « Rejoindre » choisit la place.
- Jouer seul : le Core le permet déjà (la donne part dès que tous les joueurs assis sont prêts). Le banc, lui, asseyait
  3 joueurs fictifs par défaut ; il démarre désormais seul contre la banque.
- Plusieurs tables : le Core les ouvre à la demande, jusqu'à 8. `join` choisit la table la plus pleine qui a une place,
  et une nouvelle table ne s'ouvre que quand toutes sont complètes. Une table vide garde son numéro, sans nettoyage.
- Un bouton « + » demanderait un changement du Core, non fait : voir « À décider » ci-dessous.

**Machines (les deux).** Explorer les lignes gagnantes :

- Avec 2 combinaisons ou plus, le récapitulatif affiche une pastille par ligne (sa forme, son montant).
- Au survol (PC), à la sélection au doigt ou au clavier, la ligne s'éclaire sur les rouleaux, ses symboles comptés sont
  identifiés, le reste est atténué.
- Les 10 lignes de la table des gains sont des boutons qui dessinent la ligne sur les rouleaux, « rien ce tour » si elle
  n'a pas payé.
- La note explique pourquoi des symboles identiques hors ligne ne paient rien.
- Rien n'est recalculé : c'est le résultat du Core.

**Téléphone.**

- Banque plus grande (cartes ≈ 8 % de la hauteur, score 18 px).
- Les 7 paris banque gardent leur courbe sous la banque quand chaque case a au moins 40 px (≈ 390 px de large et plus),
  sinon la grille compacte.
- Ma place : avatar, nom et mise sur le côté ; cartes ou cercle de mise au centre, en grand. Le cercle n'est plus décalé
  par un score vide. La main à jouer porte « à jouer ».
- Languettes 40 × 48 au doigt. Le centre ne passe plus sous elles (le texte de l'assurance y était caché).
- Les messages éphémères s'affichent au milieu du tapis, plus sur les boutons d'action.

**Mini-jeux en paysage téléphone** (`arcade.css`, téléphone en paysage ≤ 500 px de haut seulement) :

- Le bandeau titre du catalogue, déjà dit deux fois au-dessus, est retiré.
- Les tuiles sont plus denses : icône 42 px, description sur 3 lignes au plus.
- Aucun défilement à 844×390, 740×360, 667×375 et 844×300. Vidéo, panneau et portrait identiques au pixel près.

**À décider (évolutions du Core, non faites)** :

1. **Créer une table (« + »)** : `POST /casino/bj/join` avec `{ new_table: true }` ouvrirait une table neuve même si
   d'autres ont des places, sous le verrou du salon et dans la limite `MAX_TABLES` (8).
   - Il faudrait aussi un nettoyage des tables vides : supprimer une table vide sans manche depuis N minutes, sauf la
     n° 1.
   - Sans ce nettoyage, 8 tables vides finiraient par refuser `casino_full`.
   - Ce sont une écriture et une suppression en base de Production, avec un déploiement du Core.
2. **Le détail de « Mes manches »** : `/casino/history` pourrait renvoyer, pour le blackjack, le détail que
   `casino_rounds.outcome.player` contient déjà (main, assurance, paris banque).
   - C'est une lecture seule, un champ ajouté.
   - Aujourd'hui le détail n'est visible que pour les manches encore dans l'historique de la table.

**Ce qui n'est vérifiable qu'en vrai** : l'application Twitch sur un téléphone réel et le Hosted Test.

L'en-tête de Raptoru Live affiche brièvement le mouvement du solde (« +7,5K » au règlement : la mise rendue et le
gain). C'est un indicateur commun à tous les modules, laissé tel quel. Le résultat de la manche, lui, est au centre.

## 18. Tables, Split, réactions et UX (mandat d'Antoni du 21/11, nuit)

Deux livraisons séparées :

- **Extension seule** (fusionnée) : la pile du Split, le cartouche, la place discrète, les languettes groupées,
  l'exploration directe des gains des machines, le téléphone et le paysage. Elle contient aussi l'interface des
  nouvelles tables et des réactions, **éteinte** tant que le Core ne l'annonce pas (§ 18.8).
- **Core** (branche `feat/casino-bj-tables-reactions-core`, PR séparée, **ni fusionnée ni déployée**) : la politique
  des tables, la fermeture des tables vides, la transmission des réactions, deux réglages. Aucune migration.

### 18.1 Split : les mains en pile (2 à 4)

- Au centre, les mains du joueur dont c'est le tour sont **empilées** comme des fiches : celle à jouer au premier
  plan, nette, avec son score et sa mise ; les autres derrière, décalées et estompées. Chacune dépasse d'une bande qui
  dit « Main 2 · 15 ✓ », « Main 3 · … » (attend sa 2ᵉ carte) ou « bust ». On voit toujours combien de mains existent.
- Quand une main finit, elle glisse hors de la pile et repasse derrière ; la suivante avance (0,56 s). **Mouvement
  réduit** (réglage du système) : un simple fondu.
- Table de hauteur moyenne ou basse (PC 651 × 434, paysage 844 × 390) : la pile s'étale en largeur (« M2 », « M3 » sur
  les bandes), la hauteur manquant ; grand format et téléphone en portrait : en hauteur.
- Rien ne change dans les règles : Tirer, Rester et Doubler ne touchent que la main au premier plan (le Core), la
  2ᵉ carte d'une main splittée arrive à son tour (§ 17). Les messages sur le Split ne s'affichent qu'une fois par
  manche.

### 18.2 Qui joue : un cartouche ; la place discrète

- Le badge « À toi de jouer » + « Ton tour · Main 1/2 » + l'étiquette au-dessus des actions sont remplacés par **un
  cartouche dans le coin haut gauche** du tapis : avatar, « À toi » ou le pseudo, « Main 1/2 » après un Split, les
  secondes restantes. Téléphone : en haut à gauche du centre.
- La place du joueur dont la main est au centre devient **discrète** : pseudo, avatar, liseré, cartes en petit ; ni
  score, ni mise, ni étiquette (déjà au centre). Elle redevient complète dès que sa main quitte le centre.
- Téléphone : à mon tour, ma main passe au centre en grand (score et mise sur la plaque) et ma place devient une
  bande « Toi ». Le carrousel et la mise en évidence du joueur actif sont conservés.

### 18.3 Règles et Historique

- Les deux languettes sont l'une au-dessus de l'autre sur le **bord droit**, à mi-hauteur (Règles, puis Historique).
- **Un seul panneau à la fois** : ouvrir l'un ferme l'autre. Le panneau des Règles s'ouvre maintenant à droite, comme
  l'Historique ; le groupe de languettes se colle au bord du panneau ouvert (la languette active en or).
- PC : le nom apparaît au survol. Téléphone : languettes 40 × 48, aucun survol nécessaire ; un panneau plein écran a
  sa croix.

### 18.4 Machines : explorer les gains directement sur les rouleaux

- Survoler (souris) un symbole d'une combinaison **payée** montre sa ligne : les symboles comptés par le Core sont
  **cernés** (double liseré clair et or), les autres nettement assombris, le gain en pastille (« Haut +350 »).
- Un clic ou un toucher la fixe. Si plusieurs lignes payées passent par ce symbole, chaque nouveau clic montre la
  suivante (« 1/2 », « 2/2 »). Un symbole qui n'a rien payé, ou ailleurs : retour au tour.
- Jamais pendant le tour ni la présentation des gains (la vitre garde « Passer »). Aucun tracé de ligne permanent ; un
  alignement qui ne paie pas n'est jamais mis en évidence. La puce du récapitulatif correspondante s'éclaire.
- Les puces du récapitulatif restent (résumé) ; la table des gains garde le tracé d'une ligne sur demande.

### 18.5 Téléphone et paysage

- **Portrait** : les 7 paris banque en **4 + 3** grandes cases symétriques sous leur titre (≈ 80 × 46 px, police 16)
  au lieu d'un arc de 7 cases de 44 px. Le cercle de mise est **au centre de ma place** (avatar et mise sur le côté).
- **Paysage bas mais large** (table ≥ 600 px de large et ≤ 339 px de haut : 844 × 390) : la banque plus grande
  (cartes 34 px), ses paris en **arc large et peu profond** de part et d'autre (cotes lisibles) au lieu d'une rangée
  plate ; le titre de l'arc cède sa place au centre ; dix places de 70 px au lieu de 50 ; le message éphémère dans la
  zone libre à gauche.

### 18.6 Nouvelles tables (Core, `lobby.ts`)

**Politique** :

- **« + Nouvelle table »** dans le salon : une table pour jouer seul contre la banque, même si d'autres ont des places.
  Elle reste **publique** et rejoignable ; jamais verrouillée pour son créateur.
- **Un joueur, une table** : un joueur assis qui demande une nouvelle table reste à la sienne.
- **Jamais deux tables vides** : demander une nouvelle table quand une table est vide installe le joueur à cette table
  (« La table 3 était libre : tu y es seul contre la banque »). Ouvrir puis quitter ne peut donc pas empiler des tables.
- **Plafond qui suit la foule** : **5 tables**, **+1 par table d'au moins 6 joueurs**, **8 au plus** (`MAX_TABLES`,
  inchangé). Au plafond, le bouton est grisé avec la raison au survol, et la requête est refusée (`tables_cap`).
  « Trouver une place » ouvre toujours une table quand toutes sont complètes (comportement existant).
- **Fermeture** : une table vide depuis **10 minutes**, sans étape en attente, est fermée (balayage chaque minute, sous
  le verrou du salon) ; **la plus petite table reste toujours**. Ses manches restent dans `casino_rounds`. Un
  spectateur encore dessus revient au salon (« Cette table vient de fermer »). Le numéro libéré est repris par la
  table suivante.
- **Annonce dans le chat** : jamais automatique ; la proposition (un clic du créateur) est désormais **désactivée par
  défaut** (`casino.bj_announce` = 0). Si Antoni l'avait déjà réglée dans Studio, sa valeur enregistrée reste.
- Le salon se met à jour seul (toutes les 6 s tant qu'il est à l'écran).

**Contrat** (additif, tolérant) :

- `GET /casino/bj/tables` → `create: { allowed, reason: null | 'tables_cap' | 'casino_full', cap, open }`.
- `POST /casino/bj/join` accepte `new_table: true` → `{ table, seat, created, reused?, no }`, ou 409 `tables_cap`
  (`cap`, `open`).

**Vérifié** :

- la politique (tests unitaires) ;
- le service sur PGlite : nouvelle table, réutilisation de la table vide, plafond puis plafond relevé, un joueur une
  table, fermeture après 10 min mais pas avant, jamais la plus petite ni une table dont la manche est en attente,
  numéro repris, aucun Jeton déplacé ;
- **vrai PostgreSQL, deux Cores** : 7 demandes simultanées → tables 1 à 5, deux refus, jamais un numéro en double ; le
  même viewer depuis deux onglets → une table ; deux balayages simultanés → la table fermée une fois.

### 18.7 Réactions (Core `reactions.ts`, extension `bj-reactions.js`)

- Un joueur **assis** touche « Réagir » (à côté de Quitter) : une bulle de **7 émotes** (une rangée sur PC, 4 + 3 au téléphone, au
  doigt). L'émote apparaît 2,6 s
  au-dessus de sa place, chez tous les joueurs **et les spectateurs**. Les spectateurs ne réagissent pas eux-mêmes en
  V1 (pas de place où l'afficher, moins de bruit). Rien ne capte le toucher ni ne masque durablement cartes, scores
  ou boutons.
- **Téléphone, carrousel** : une réaction d'un joueur hors écran affiche un repère sur le bord (‹ émote, ou émote ›) ;
  le toucher fait défiler jusqu'à sa place. Jamais de défilement automatique.
- **La banque réagit parfois** : au règlement, au plus une bulle par manche (≈ 1 manche sur 4), une émote et une
  phrase courte. Choix **déterministe** à partir de la table et de la manche : tous les viewers voient la même.
  **Aucune IA** (la personnalité de LeCroupier_ reste suspendue). Les associations, modifiables dans `reactions.js`
  (`DEALER` : émote, probabilité, phrases) :

  | Situation (la plus marquante de la manche)     | Émote              | Probabilité |
  | ---------------------------------------------- | ------------------ | ----------- |
  | Blackjack de la banque                         | Sourire en coin    | 60 %        |
  | Blackjack d'un joueur                          | ptn                | 60 %        |
  | Gros gain d'un joueur (≥ 10 × la mise minimum) | Visage attendri    | 50 %        |
  | La banque saute                                | Colère             | 35 %        |
  | Un joueur dépasse 21                           | ICANT              | 20 %        |
  | La banque gagne contre tous                    | Lunettes de soleil | 20 %        |

- **Sécurité** :
  - seulement les identifiants `r1` … `r7`, jamais de texte libre ; aucun Jeton ; rien en base ;
  - une réaction toutes les 1,5 s par viewer, 8 par 30 s au plus (`react_rate`) ; un viewer bloqué par la modération
    ne réagit pas ;
  - transmission en mémoire dans le Core (comme la présence), jointe à l'état de la table ; le long-poll répond aussi
    pour une nouvelle réaction (`rx`) ;
  - reconnexion : une réaction de plus de 3,5 s n'est jamais rejouée.
- **Arrêt** : `casino.bj_reactions` (joueurs) et `casino.bj_dealer_reactions` (banque), à 1 par défaut, dans Studio ›
  Casino (avec la prochaine version de Studio ; avant, seulement par l'API des réglages). Chaque viewer peut aussi
  « Masquer les réactions » pour lui seul (bulle de choix).
- **Les 7 réactions** (choix d'Antoni du 21/11, dans cet ordre ; le Core ne transmet que l'identifiant) :

  | Id   | Réaction           | Visuel                                                       |
  | ---- | ------------------ | ------------------------------------------------------------ |
  | `r1` | Sourire            | 🙂 Twemoji `1f642`                                           |
  | `r2` | Visage attendri    | 😳 Twemoji `1f633`                                           |
  | `r3` | Colère             | 😡 Twemoji `1f621`                                           |
  | `r4` | Lunettes de soleil | 😎 Twemoji `1f60e`                                           |
  | `r5` | Sourire en coin    | 😉 Twemoji `1f609`                                           |
  | `r6` | ICANT              | `ICANT.png` (émote d'Antoni, fixe)                           |
  | `r7` | ptn                | `ptn.gif` (émote d'Antoni, animée : 75 images, transparente) |
  - Les cinq emojis sont ceux de Discord : Discord affiche le jeu **Twemoji**, déjà embarqué dans l'extension
    (`assets/twemoji`, version 17.0.3, SVG nets). Licence des visuels **CC-BY 4.0** : redistribution permise avec
    attribution (`assets/twemoji/readme.txt`, `license-graphics.txt`). Ils ont été identifiés sur la capture fournie
    par Antoni : le 2ᵉ est 😳 (_flushed_) et le 5ᵉ 😉 (_wink_), comme sur la capture.
  - ICANT.png et ptn.gif sont les fichiers d'Antoni tels quels (128 × 128, transparents) : jamais réencodés, le GIF
    garde toutes ses images. Une émote est toujours affichée par une image (`<img>`) : elle s'anime dans la bulle de
    choix, au-dessus des places, dans le repère hors écran et dans la bulle de la banque. Un WebP animé futur
    fonctionne de la même façon. Les 7 images sont chargées une fois, dès que le Core annonce les réactions.

- **Remplacer une émote** : déposer le fichier (PNG, GIF ou WebP animé, transparent, carré, 112 à 128 px) dans
  `apps/twitch-extension/extension/assets/casino/reactions/` et changer sa ligne `src` dans `reactions.js` du même
  dossier. Rien d'autre : identifiants, protocole, rythme, logique, animations d'apparition et Core ne bougent pas.
  Ajouter une 8ᵉ réaction demanderait en plus son identifiant dans le Core (`reactions.ts`).

**Contrat** :

- `GET /casino/bj/state?…&rx=<n>` → en plus de `state`, `reactions: { on, dealer, ids, seq, list: [{ n, seat, r,
age_ms }] }`.
- `POST /casino/bj/react { r }` → `{ ok, n }`, ou 400 `bad_reaction`, 409 `not_seated` / `reactions_off` /
  `viewer_blocked`, 429 `react_rate` (`retry_in_ms`).

### 18.8 Mise en service sans incompatibilité

1. **Le ZIP de l'extension** (avec l'inventaire et la ligne d'Antoni) : contre le Core actuel (`1f05b97c`), aucun
   bouton « Nouvelle table » ni « Réagir », aucune réaction de la banque : le Core ne les annonce pas. Tout le reste
   (pile, cartouche, languettes, machines, téléphone) fonctionne.
2. **Sur GO d'Antoni** : fusionner la PR du Core → CI de `main` → `plan` → déploiement du Core (aucune migration, bot
   inchangé). Dès le déploiement, les viewers qui ont ce ZIP voient « + Nouvelle table » et « Réagir » : pas de
   nouveau ZIP.
3. Facultatif : une version de Studio pour les deux interrupteurs (sinon valeurs par défaut : réactions activées).
4. **Retour arrière** : redéployer le Core précédent ; les boutons disparaissent seuls (ils suivent ce qu'annonce le
   Core). Les tables ouvertes restent (lignes existantes, lues normalement).

**Démo locale** (`npm run casino:bench -w @raptoru/twitch-extension`, sur la branche du Core) : « + Table fictive »,
« Réaction d'un joueur fictif », « Fermer les tables vides » ; les joueurs fictifs réagissent parfois au règlement.
« Quatre 8 (Split jusqu'à 4 mains) » est dans « Prochaine donne » partout. Le banc de `main` (extension seule) n'a ni
nouvelles tables ni réactions, comme le Core actuel.
