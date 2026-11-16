# Roue du Sub V3 : barème et rendu

**Statut (16/11/2026) : proposition, itération 2.** Rien n'est développé ni déployé ; aucun gain réel n'a changé.
Maquettes non branchées et **locales** (`prototypes/` est exclu de Git par `.git/info/exclude`), dans
`Documents\Raptoru 2.0 - Worktrees\agent\prototypes\sub-wheel-v3\` :

- `arcade.html` : itération 2, les trois mécanismes Arcade (§ 6) ;
- `index.html` : itération 1, quatre directions (§ 4).

Le moteur commun (sons, scène) est dans `shared/`. La Production garde la roue actuelle
([SUB_WHEEL.md](SUB_WHEEL.md), droits V2 : [SUB_WHEEL_V2_PLAN.md](SUB_WHEEL_V2_PLAN.md)).

**Itération 2 (décision d'Antoni du 16/11) :**

- direction **Arcade** ;
- montants écrits sur les parts, puis le tier en multiplicateur fixe (×1 / ×2 / ×3) ;
- le barème « Base × multiplicateur » des § 2 à 5 est **écarté** ;
- les § 6 et 7 remplacent le § 2 ; le § 5 reste valable pour l'intégration (voir § 8).

## 1. Ce qui ne va pas

**Gains.** Le barème actuel est la **copie exacte** de celui de SAMMI (`subWheelLayout`,
`packages/schemas/src/sub-wheel.ts`). Il n'a pas baissé ; il est mal construit :

- **Plancher ridicule.** À 45 mois en T3, la pire part vaut 3 000 Jetons, et 1 tirage sur 4 donne 9 000 ou moins.
  Les 90 000 et 150 000 dont on se souvient sont 3 parts sur 12.
- **Ancienneté en marches d'escalier.** Il y a quatre grilles (1–3, 4–11, 12–19, 20+ mois). Il y a un saut ×3,4 à
  20 mois, puis plus rien : 45 mois valent 20 mois.
- **Tier 3 sous-payé.** Il compte ×3, alors que le Loyalty paie déjà le sub ×5 (2 000 / 4 000 / 10 000) et que le T3
  coûte 5 fois le T1.
- **Illisible.** Pour comprendre son gain, un viewer doit multiplier trois nombres : la valeur de la part (« 5k »),
  le ×N de la part et le ×tier du moyeu.

**Rendu** (`apps/studio/server/effects-player/wheel.js`, copie de `Alerte_system.html`) :

- arc-en-ciel de 12 couleurs par valeur ;
- couleur du cadre tirée au hasard selon le pseudo (parfois laide) ;
- Helvetica avec contour noir ;
- bandeau « mois | pseudo | tier » petit et plat ;
- le montant final n'est qu'une ligne de texte ;
- le compteur ne tourne que pour les T2 / T3 ;
- la durée du spin est tirée au hasard entre 2 et 5 s.

## 2. Barème recommandé

**Gain = Base × multiplicateur de la roue.** La base est connue et affichée avant le spin. La roue ne fait que
multiplier.

- **Base** = (1 000 + 250 par mois, plafonnée à 10 000 à partir de 36 mois) × tier : Prime et T1 ×1, T2 ×2, T3 ×5.
- **Roue** : 10 parts égales, tirage uniforme comme aujourd'hui (crypto, côté Core, avant l'animation). Il y a
  3 parts ×1, 4 parts ×2, 2 parts ×3 et 1 part ×5, soit 30 / 40 / 20 / 10 %. La moyenne est ×2,2 et le cas le plus
  fréquent est « tu doubles ».

| Base     | Prime / T1 | T2     | T3     |
| -------- | ---------- | ------ | ------ |
| 1 mois   | 1 250      | 2 500  | 6 250  |
| 6 mois   | 2 500      | 5 000  | 12 500 |
| 12 mois  | 4 000      | 8 000  | 20 000 |
| 24 mois  | 7 000      | 14 000 | 35 000 |
| 36 mois+ | 10 000     | 20 000 | 50 000 |

Comparaison avec la roue actuelle (min / médiane / moyenne / max) :

| Profil      | Actuelle                  | V3                        |
| ----------- | ------------------------- | ------------------------- |
| T1, 1 mois  | 200 / 875 / 1,4k / 5k     | 1,3k / 2,5k / 2,8k / 6,3k |
| T1, 12 mois | 500 / 4k / 5k / 15k       | 4k / 8k / 8,8k / 20k      |
| T1, 24 mois | 1k / 12,5k / 17,2k / 50k  | 7k / 14k / 15,4k / 35k    |
| T1, 45 mois | 1k / 12,5k / 17,2k / 50k  | 10k / 20k / 22k / 50k     |
| T3, 12 mois | 1,5k / 12k / 14,9k / 45k  | 20k / 40k / 44k / 100k    |
| T3, 45 mois | 3k / 37,5k / 51,5k / 150k | 50k / 100k / 110k / 250k  |

- **Plancher.** Il est 5 à 50 fois plus haut selon le profil.
- **Médiane.** Elle est meilleure partout.
- **Seul recul.** La **moyenne** des T1 / T2 entre 20 et 33 mois perd 10 à 25 %, à cause des gros lots rares de
  l'ancienne grille 20+. Leur plancher passe de 1 000 à 6 000–9 000.
- **Plafond absolu.** 250 000 (T3, 36 mois et plus, ×5).
- **Réglage économique.** Il tient en deux constantes : 1 000 + 250 par mois, et le plafond. Le coût réel dépend du
  mélange des subs. Avant l'activation, il se mesure sur `sw_spins` par une requête en lecture seule, avec le GO
  d'Antoni.

## 3. Animation recommandée

Elle dure environ 6,3 s pour un ×1 et environ 9 s pour le jackpot ; l'ancienne roue durait 4,5 à 10,6 s. La roue
démarre toujours après la fin de l'alerte (règle actuelle conservée).

| Temps       | Ce qui se passe                                                         | Sons                                       |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| 0,9 s       | entrée ; pseudo, tier, mois et **Base** lisibles                        | —                                          |
| 2,8 s       | spin, durée **fixe**, ralenti final ; la languette claque à chaque cran | ticks d'origine                            |
| 0,4 s       | arrêt, la part gagnante s'allume, les autres s'éteignent ; ×N au moyeu  | son d'arrêt d'origine                      |
| 0,9–1,8 s   | compteur Base → gain (×2 0,9 s, ×3 1,3 s, ×5 1,8 s) ; absent pour ×1    | `Incrémentation Son.mp3` puis `Fin casino` |
| 1,7 / 2,4 s | gain final mis en valeur (reflet doré ; or et particules au jackpot)    | jingle de victoire / jackpot d'origine     |
| 0,45 s      | sortie                                                                  | —                                          |

## 4. Directions visuelles (maquette)

Les quatre directions sont dans la maquette (touches 1 à 4, Espace pour lancer, mode OBS `?obs=1&v=A`) :

- **A · Écrin** : sobre et premium, noir et or ;
- **B · Arcade** : couleurs par multiplicateur, ampoules ;
- **C · Bandeau** : bandeau bas avec une demi-roue ;
- **D · Anneau** : minimaliste.

**Recommandation : A · Écrin.**

- Elle colle à l'identité « Croupier / casino » du stream et à ses sons.
- Elle reste lisible sur n'importe quel jeu, grâce à son fond opaque.
- Elle est sobre mais fait « événement ».
- Le montant final est la chose la plus mise en valeur.
- **Repli si l'emprise gêne en jeu : C · Bandeau**, haut de 190 px seulement.

## 5. Intégration (si une direction est validée)

Le modèle de données actuel suffit : `montant = val × mult × coefficient du tier`. La V3, c'est `val` = base par
unité de tier, `mult` = multiplicateur de la part, et des coefficients 1 / 2 / 5. Pas de refonte du backend.

1. **Schémas** (`packages/schemas/src/sub-wheel.ts`) : `grid: 1 | 3` sur `subWheelLayout` et `subWheelAmount`, les
   constantes V3, et des tests du barème (plafond à 36 mois, T3 ×5, Prime = T1).
2. **Migration additive** (Lab et Production) : `sw_settings.grid` et `sw_spins.grid` (défaut 1). Chaque roue garde
   la grille de son tirage, donc une roue ancienne rejouée (retry, replay) garde son ancien rendu et son montant. Le
   retour arrière consiste à remettre `grid = 1`. Classe D au déploiement : sauvegarde, `--migrations-approved`.
3. **Core** (`apps/core-api/src/sub-wheel/service.ts`) : le tirage enregistre `grid` (tirages V1 et V2), et
   l'animation renvoie `layout` et `grid` de la roue. La file, la présence, la règle « après l'alerte », les droits
   et le crédit idempotent restent tels quels. Annonce dans le chat : ajouter « (×3) ».
4. **Studio, lecteur d'effets** :
   - nouveaux fichiers `effects-player/wheel-v3.js` et `wheel-v3.css` (direction choisie) ;
   - `player.js` choisit le rendu selon `spin.grid` ;
   - `wheel.js` reste pour les anciennes roues ;
   - les deux mp3 sont réutilisés (`SUB_WHEEL_MEDIA`).
5. **Studio, page Roue du Sub** : sélecteur « Barème : SAMMI / V3 » (Broadcaster), aperçu des parts
   (`sub-wheel-stage.ts`) selon la grille, et « Tester l'animation » en V3.
6. **Tests** :
   - schémas ;
   - service Core : grille enregistrée, rejouée à l'identique, aucun double crédit, sur un vrai PostgreSQL (les
     Jetons sont touchés) ;
   - lecteur d'effets : garde « montant différent → refus » ;
   - e2e « Test complet simulé » : l'alerte, puis la roue V3.
7. **Mise en service** :
   - Lab : « Tester l'animation » et le test complet ;
   - validation d'Antoni dans le vrai OBS ;
   - avec GO : migration, déploiement Core, release Studio ;
   - interrupteur V3 dans Studio.

**À savoir avant d'activer :**

- Les droits « dus » encore non tirés seront tirés au barème V3. Les compter avant (lecture seule).
- Un sub sans message de resub reste estimé à 1 mois (règle V2, inchangée) : sa base est donc celle d'un premier
  mois.
- Les subs offerts ne font pas tourner la roue (règle SAMMI conservée le 18/10). Ne rien changer sans décision
  d'Antoni.

## 6. Itération 2 : trois mécanismes Arcade

`arcade.html`, touches 1 à 4 : Roue, Rouleau, Carrousel, puis **les trois côte à côte** sur le même tirage. Espace
pour lancer. L'outil permet aussi de choisir le résultat (minimum, moyen, jackpot) et le fond, de tester un pseudo
long, et d'ouvrir la version pour OBS (`?obs=1&d=reel`) ou un contrôle en 1080p (`?full=1&d=all&bg=light`).

**Habillage commun.** Les trois mécanismes partagent la même finition, pour que le choix porte sur le mécanisme seul :

- plaque du viewer avec l'avatar centré au-dessus (symétrique, pseudo long réduit automatiquement) ;
- tier et multiplicateur au **centre** du dispositif ;
- zone du bas **vide pendant le tirage** ;
- 12 lampes blanc chaud au lieu de 24, plus une lueur qui tourne ou défile en sens inverse ;
- une couleur par valeur : gris, bleu, vert, violet, or pour le jackpot.

**Séquence** : environ 5,8 s en Prime / T1, 7,4 s pour un jackpot en T3.

| Temps       | Ce qui se passe                                                                                        | Sons                                  |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 0,5 s       | entrée                                                                                                 | —                                     |
| 2,3 s       | tirage avec ralenti progressif, petit retour à l'arrêt                                                 | ticks d'origine                       |
| 0,25 s      | arrêt : le lot s'allume, les autres s'éteignent                                                        | son d'arrêt                           |
| 0,8 à 1,9 s | T2 / T3 : le lot apparaît en bas, puis le ×tier, puis le compteur ; Prime / T1 : le compteur part de 0 | blips, `Incrémentation`, `Fin casino` |
| 1,3 / 1,9 s | gain final dans la couleur du lot (or et confettis au jackpot)                                         | jingle d'origine                      |
| 0,4 s       | sortie                                                                                                 | —                                     |

| Mécanisme       | Pour                                                                                                           | Contre                                                                                   | Encombrement 1080p |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| A · Roue        | objet iconique ; on voit les 12 lots d'un coup                                                                 | montants dans le sens du rayon : lisibles à l'arrêt, couchés ou à l'envers sur les côtés | ≈ 345 × 560 px     |
| **B · Rouleau** | montants toujours droits et les plus gros ; la ligne se lit comme la formule « T3 · 25 000 · ×3 » ; symétrique | 3 à 4 lots visibles à la fois ; « machine à sous » assumée                               | ≈ 365 × 515 px     |
| C · Carrousel   | très lisible, familier (ouverture de caisse) ; 4 à 5 lots visibles                                             | le plus large, il avance vers le centre de l'écran ; plus « loot box » que casino        | ≈ 565 × 405 px     |

**Recommandation : B · Rouleau.**

- C'est la meilleure lisibilité en stream : des chiffres horizontaux de 38 px, lisibles même sur mobile.
- Le résultat se comprend sans explication : le tier et son multiplicateur encadrent le lot sur la ligne de gain.
- Il garde l'esprit arcade / casino et les mêmes sons, dans une colonne étroite et symétrique.
- **Repli : C · Carrousel** si l'on préfère voir plus de lots à la fois et un dispositif moins haut.

## 7. Barème proposé (itération 2)

**Une part, un montant écrit, puis le tier.**

- 12 parts de même chance (tirage uniforme, comme aujourd'hui).
- À 1 mois, les montants vont de 500 à 6 000 :
  500 · 600 · 800 · 1 000 · 1 200 · 1 500 · 1 800 · 2 000 · 2 500 · 3 000 · 4 000 · 6 000.
- **Tous les montants sont multipliés par 1,55 à chaque doublement de l'ancienneté** (mois^0,632, arrondis à deux
  chiffres).
- **Sans plafond** : la croissance ralentit d'elle-même. Elle est de 2,4× à 4 mois, 5,8× à 16 mois, 8,9× à 32 mois,
  13,9× à 64 mois.
- Le tier multiplie ensuite le lot tombé : Prime / T1 ×1, T2 ×2, T3 ×3 (règle historique).
- Exemple à 45 mois, les 12 lots : 5 500 · 6 700 · 8 900 · 11 000 · 13 000 · 17 000 · 20 000 · 22 000 · 28 000 ·
  33 000 · 44 000 · 67 000. Un T3 qui tombe sur 22 000 reçoit 66 000.

Minimum, moyenne et jackpot (T2 = T1 × 2 dans les deux grilles ; l'ancien T3 = l'ancien T1 × 3) :

| Mois | Ancien T1       | **Nouveau T1**    | **Nouveau T3**    |
| ---- | --------------- | ----------------- | ----------------- |
| 1    | 200 / 1,4k / 5k | 500 / 2,1k / 6k   | 1,5k / 6,2k / 18k |
| 6    | 200 / 1,7k / 5k | 1,6k / 6,5k / 19k | 4,8k / 19k / 57k  |
| 12   | 500 / 5k / 15k  | 2,4k / 9,9k / 29k | 7,2k / 30k / 87k  |
| 24   | 1k / 17k / 50k  | 3,7k / 15k / 45k  | 11k / 46k / 135k  |
| 36   | 1k / 17k / 50k  | 4,8k / 20k / 58k  | 14k / 60k / 174k  |
| 45   | 1k / 17k / 50k  | 5,5k / 23k / 67k  | 17k / 69k / 201k  |
| 60   | 1k / 17k / 50k  | 6,7k / 28k / 80k  | 20k / 83k / 240k  |

- **Partout :** le minimum est 2,5 à 8 fois plus haut, et minimum, moyenne et jackpot montent avec chaque mois.
- **Avant 20 mois :** la moyenne est nettement meilleure ; l'ancienne grille était plate jusqu'à 11 mois.
- **De 20 à 33 mois :** recul de 10 à 25 % sur la moyenne et le jackpot. C'est le saut de l'ancienne grille à
  20 mois, qu'une courbe régulière ne peut pas reproduire sans gonfler les jeunes abonnés. La parité revient vers
  33 mois, puis la nouvelle grille passe devant.
- **Coût estimé :** environ ×1,8, soit 8 900 Jetons en moyenne par sub éligible au lieu de 5 100. C'est calculé sur
  un **mélange supposé** : 55 % de subs de moins de 6 mois, 90 % de Prime / T1. Pour 60 subs par mois, cela fait
  environ 230 000 Jetons de plus par mois.
- **À confirmer avant l'activation :** le mélange réel, à lire dans `sw_spins` par une requête en lecture seule
  avec le GO d'Antoni.
- **Réglages :** les montants à 1 mois et le facteur 1,55. À 1,50, le coût baisse vers ×1,6.

## 8. Règles d'éligibilité et écart avec l'intégration du § 5

**Règle confirmée par Antoni.** Seuls comptent le premier abonnement personnel, le resub et le Prime. **Aucun
abonnement offert** ne donne de roue, ni au donneur, ni au bénéficiaire.

Le Core applique déjà cette règle :

- `fromAlert` n'accepte que `sub` / `resub` venant de Twitch ;
- `fromLoyalty` refuse un `sub` offert ;
- les avis `sub_gift` et `community_sub_gift` deviennent des alertes `gift_*` ignorées par la roue ;
- les doublons restent protégés par l'identifiant d'événement et les droits V2.

**Trou constaté (non corrigé, système d'événements gelé).**

- Le bot ne lit pas `resub.is_gift` des avis `channel.chat.notification`
  (`apps/twitch-bot/src/alert-events.ts`, cas `resub`).
- Un resub partagé par le bénéficiaire d'un abonnement offert sur plusieurs mois peut donc faire tourner la roue.
- Correctif prévu à l'intégration : ne pas créer d'alerte « roue » quand `is_gift` est vrai, avec son test.
- Le même examen vaut pour `channel.subscription.message` côté Loyalty.

**Écart avec le § 5 :**

- `subWheelLayout(months, grid)` renvoie les 12 montants de la grille 2, avec des multiplicateurs de part à 1.
- Les coefficients du tier restent 1 / 2 / 3, donc la formule `val × mult × tier` du Core ne change pas.
- La colonne `grid` reste nécessaire, pour qu'une ancienne roue rejouée garde son ancienne grille.
- Il faut un nouveau rendu `wheel-v3.js` (le mécanisme choisi) et l'**avatar Twitch** dans la charge de la roue : le
  Core ne l'envoie pas aujourd'hui.
