# Casino : machine à sous (avec le Coffre) et roulette de l'extension

État au 18/11/2026 : **intégré et jouable en Lab** (mode spectateur refait le 18/11), branche locale `feat/casino`.
Rien n'est poussé, fusionné ni déployé. En Production, le Casino reste fermé tant qu'Antoni n'a pas validé :

- la variable `CASINO_EXTENSION` du Core, à `off` par défaut ;
- le réglage Studio `casino.open`, à 0 par défaut ;
- la publication de l'extension.

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
- **BONUS :** 3, 4 ou 5 BONUS n'importe où ouvrent le Coffre. Ils ne paient rien directement.
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
- **RTP :** 97,30 % pour chaque pari.
- **Jetons à l'écran :** ils s'adaptent au solde. Le jeton libre est un multiple de 20, et l'ALL-IN correspond à ce qui
  reste misable, arrondi au multiple de 20 inférieur.
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
  - **Jamais de résultat en avance :** le Core ne publie une étape qu'une fois que l'écran du joueur l'a montrée (ses
    rouleaux arrêtés, sa bille posée, une relance jouée, la fin). Le lancement ne transmet que la mise. Le spectateur
    rejoue chaque étape avec la même animation, donc un peu après le joueur : environ la durée d'une étape (≈ 2 s pour
    les rouleaux, ≈ 6 s pour la roue). Si l'écran du joueur se ferme, le Core publie l'étape une fois son animation
    finie (9 s machine, 14 s roulette, 7 s pour l'ouverture du Coffre). Les relances du Coffre attendent toujours le
    joueur.
  - **Rythme :** Rapide et Passer du joueur sont transmis (le spectateur les suit, même résultat) ; Auto enchaîne
    les tours chez le spectateur aussi. Un spectateur en retard (onglet caché, connexion lente) accélère pour rattraper.
  - **Mises de la roulette en préparation :** l'écran du joueur les envoie (300 ms après le dernier geste) ; affichées
    comme « pose ses jetons », jamais débitées, remplacées par les vraies au lancement.
  - **Technique :** une seule requête en attente par spectateur (long-poll, réponse dès qu'une étape est publiée, au
    plus 20 s sinon). Chaque événement a un numéro (seq) : pas de doublon, pas de trou, reprise exacte après une coupure.
    Rafraîchir la page revient au même joueur, à l'étape où il en est. Un Core réveille ses spectateurs aussitôt ; un
    autre Core les réveille en moins d'une seconde (une lecture par chaîne et par seconde, seulement s'il y a des
    spectateurs). Le journal ne garde que quelques heures.
  - **Droits :** un spectateur n'a aucune commande active (mise, jetons, Lancer, Auto, Rapide, Passer, Coffre). Côté
    Core, toute écriture vise le tour de celui qui l'envoie : agir sur le tour d'un autre est refusé. Le détail d'un
    tour d'un autre viewer n'est lisible qu'une fois sa fin publiée.
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
   - seuil d'annonce (×500).
2. **Le déploiement du Core et de ses migrations** `20261201130000_casino.sql` et `20261202130000_casino_feed.sql`
   (additives). Sauvegarde, puis `--migrations-approved`.
3. **La variable `CASINO_EXTENSION`** : `testers:<id>,…` pour un Hosted Test, puis `on`.
4. **Studio :** release avec la page Casino, puis `casino.open = 1`, `casino.slot_open` et `casino.roulette_open`.
5. **L'extension :**
   - inventaire validé (la ligne « Validé par Antoni : oui » est celle d'Antoni), Hosted Test, revue Twitch ;
   - `random_ban_ext.enabled = 1`, qui porte la carte Mini-jeux.
6. **Les messages de LeCroupier\_ :** textes de partage et d'annonce (service, fonction `shareText`), et le rythme.

## 11. Retour arrière

| Quoi           | Comment                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Tout le Casino | Studio › Casino › Fermé (`casino.open = 0`, immédiat) ; ou `CASINO_EXTENSION=off` (redémarrage du Core)   |
| Un jeu         | `casino.slot_open = 0` / `casino.roulette_open = 0`                                                       |
| Les annonces   | `casino.announce = 0`                                                                                     |
| Core           | Redéployer le Core précédent : il ignore `casino_rounds` et `casino_feed` (migrations additives)          |
| Extension      | Ne pas publier, ou version précédente dans la console Twitch : sans Casino, les tuiles n'apparaissent pas |
