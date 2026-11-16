# Roue du Sub V3 : barème et rendu

**Statut (16/11/2026) : livré — voir § 13 (système en place) ; les § 1 à 12 sont l'historique de la conception.**

Maquettes (locales : `prototypes/` est exclu de Git), dans `Documents\Raptoru 2.0 - Worktrees\agent\prototypes\sub-wheel-v3\` :

- `roue.html` : **itération 6** (rendu du § 11, barème du § 12) ;
- `arcade.html` : itération 2, les trois mécanismes Arcade (§ 6) ;
- `index.html` : itération 1, quatre directions (§ 4).

Le moteur commun (sons, scène) est dans `shared/`. La roue précédente : [SUB_WHEEL.md](SUB_WHEEL.md) ; les droits
V2 : [SUB_WHEEL_V2_PLAN.md](SUB_WHEEL_V2_PLAN.md).

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

**Trou constaté, puis corrigé le 16/11 (itération 3, commit local `f8f39218`).** Le bot ignorait `resub.is_gift` des
avis `channel.chat.notification`. Le resub partagé par le bénéficiaire d'un abonnement offert faisait donc tourner la
roue. Le correctif :

- **Bot** (`alert-events.ts`) : l'avis `resub` porte `is_gift: true` ; l'alerte reste affichée.
- **Schéma** (`AlertEventInput.is_gift`) : champ optionnel.
- **Core** (`SubWheelService.fromAlert`, `giftedRenewal`) : un avis offert garde son renouvellement en ligne
  « ignorée », raison `gift`, avec son mois et ses preuves. Il n'est jamais tiré ni crédité.
- **Le message de resub du même renouvellement** (côté Loyalty, Twitch n'y met aucun drapeau « offert ») s'y rattache,
  au lieu de créer un droit tirable. Si ce message est arrivé le premier, son droit non tiré est annulé de la même
  façon. En mode v1, rien n'est enregistré.
- **File automatique** (`draws.ts`) : un droit acquis par la seule preuve Loyalty (sans alerte) attend 20 s avant
  d'être tiré. C'est le délai que s'accorde déjà un droit lié à une alerte. Il laisse à l'avis de chat le temps
  d'arriver : son alerte passe d'abord, et un partage offert annule le droit.
- **Studio** : l'historique affiche « Abonnement offert : pas de roue ».
- **Règle** : un cadeau ne donne pas de roue ; payer soi-même le mois suivant, si (nouveau renouvellement, roue
  normale).

**Tests :**

- `sub-wheel-gifts.test.ts` : chaque mode, les deux ordres d'arrivée, rejouage, conversion en abonnement payé,
  attente de 20 s, subscribe offert ;
- course entre deux Core sur vrai PostgreSQL, 20 viewers, 3 tours (`sub-wheel-r2.integration.test.ts`) ;
- bot : `alert-events.test.ts` ;
- le test R3 « resub par le seul message EventSub » vérifie désormais l'attente de 20 s.

**Déploiement :** le Core avant le bot, car le schéma du Core est strict et un ancien Core refuserait `is_gift`.

**Limite restante :** si l'avis de chat d'un partage offert n'arrive jamais (bot coupé), la seule preuve Loyalty ne
dit pas que c'est un cadeau, et le droit est tiré après 20 s. Twitch ne donne pas l'information dans
`channel.subscription.message`.

**Écart avec le § 5 :**

- `subWheelLayout(months, grid)` renvoie les 12 montants de la grille 2, avec des multiplicateurs de part à 1.
- Les coefficients du tier restent 1 / 2 / 3, donc la formule `val × mult × tier` du Core ne change pas.
- La colonne `grid` reste nécessaire, pour qu'une ancienne roue rejouée garde son ancienne grille.
- Il faut un nouveau rendu `wheel-v3.js` (le mécanisme choisi) et l'**avatar Twitch** dans la charge de la roue : le
  Core ne l'envoie pas aujourd'hui.

## 9. Itération 3 : la roue retenue (16/11)

Antoni garde la **roue**. Maquette : `roue.html`.

**Ce qui change visuellement :**

- **Palette chaude :**
  - pour les valeurs : prune, framboise, corail, abricot, et or (avec reflet) pour le jackpot ;
  - pour le reste : fond aubergine, filets crème, 12 lampes blanc chaud (le même nombre qu'avant) et une lueur qui
    tourne en sens inverse ;
  - plus de gris ni de bleu.
- **Carte latérale**, à gauche de la roue et sur son axe, plus jamais posée sur la roue :
  - pendant le tirage : l'avatar à gauche, le pseudo (réduit automatiquement s'il est long), « 45 mois », plus
    « Vétéran » dès 20 mois ;
  - à l'arrêt : l'identité se replie en une légende (mini-avatar, pseudo, mois), et **le même cadre** affiche le lot,
    puis le ×tier, puis le compteur, puis le gain dans la couleur du lot (or au jackpot).
- **Languette à 9 h**, entre la carte et la roue. Les montants sont écrits dans le sens du rayon, lus du bord vers le
  centre : la part gagnante s'arrête contre la carte, avec son montant **à l'horizontale**.
- **Moyeu : le tier seul** (T1 bronze, T2 rubis, T3 or, PRIME), en jeton de casino. Le multiplicateur n'apparaît
  qu'au moment où il s'applique, dans la carte (« 25 000 ×3 »). Pour Prime / T1, aucun ×1 inutile : le compteur
  monte directement de 0 au lot.
- **Encombrement** : environ 645 × 330 px en 1080p, contre 345 × 560 à l'itération 2. C'est bien moins haut.
- **Durée** : environ 6,2 s en Prime / T1 et 7,5 s pour un jackpot en T3.
  - Étapes : entrée 0,45 s, tirage 2,4 s, bascule de la carte 0,35 s, ×tier et compteur 0,8 à 1,5 s, gain 1,3 s
    (1,9 s au jackpot), sortie 0,4 s.
  - Sons d'origine : ticks, arrêt, `Incrémentation`, `Fin casino`, jingle.

**Barème : itération 2 plus un palier « vétéran ».**

- Les 12 parts restent de même chance, de 500 à 6 000 à 1 mois, ×1,55 à chaque doublement des mois.
- **Nouveau : ×1,25 dès 20 mois** (le palier de l'ancienne roue), puis le tier ×1 / ×2 / ×3.
- **Plus aucun creux.** Le minimum, la moyenne et le jackpot ne passent jamais sous l'ancienne grille, de 1 à
  120 mois. À 20 mois, la moyenne et le jackpot égalent l'ancienne roue, avec un minimum 4 fois plus haut.
- Ton exemple se vérifie : à 45 mois, la roue contient la part 25 000, soit 75 000 en T3.

| Mois | Ancien T1 (min / moy. / max) | Nouveau T1          | Nouveau T3           |
| ---- | ---------------------------- | ------------------- | -------------------- |
| 1    | 200 / 1 400 / 5 000          | 500 / 2 100 / 6 000 | 1 500 / 6 200 / 18k  |
| 6    | 200 / 1 700 / 5 000          | 1 600 / 6 500 / 19k | 4 800 / 19k / 57k    |
| 12   | 500 / 5 000 / 15k            | 2 400 / 9 900 / 29k | 7 200 / 30k / 87k    |
| 19   | 500 / 5 000 / 15k            | 3 200 / 13k / 39k   | 9 600 / 40k / 117k   |
| 20   | 1 000 / 17k / 50k            | 4 200 / 17k / 50k   | 12 600 / 52k / 150k  |
| 24   | 1 000 / 17k / 50k            | 4 700 / 19k / 56k   | 14 100 / 58k / 168k  |
| 36   | 1 000 / 17k / 50k            | 6 000 / 25k / 72k   | 18k / 75k / 216k     |
| 45   | 1 000 / 17k / 50k            | 6 900 / 29k / 83k   | 20 700 / 87k / 249k  |
| 60   | 1 000 / 17k / 50k            | 8 300 / 35k / 100k  | 24 900 / 104k / 300k |

- **Coût estimé :** ×1,95 sur le mélange supposé, soit 9 900 Jetons en moyenne par sub éligible au lieu de 5 100. Le
  palier vétéran ajoute environ ×0,18 par rapport à l'itération 2, et ne concerne qu'environ 15 % des subs.
- **À mesurer avant l'activation :** le vrai mélange, dans `sw_spins` (lecture seule, GO d'Antoni).
- **Réglages :** les montants à 1 mois, le facteur 1,55, le palier (20 mois, ×1,25).

**Choix faits par l'agent :**

- T3 au moyeu plutôt que ×3, pour éviter un « ×1 » sans intérêt pour la majorité des subs.
- La carte placée à gauche et la languette à 9 h, pour que le lot tombé soit lisible et touche la carte.
- Le palier vétéran, pour supprimer le creux de 20 à 33 mois.
- Le compteur dès 0 en Prime / T1, pour que tout le monde entende l'incrémentation.

**Intégration** (inchangée, § 5 et § 8) :

- le nouveau rendu `effects-player/wheel-v3.js` d'après `roue.html` ;
- la grille 2 et le palier vétéran dans `subWheelLayout(months, grid)` ;
- la colonne `grid` ;
- l'avatar Twitch dans la charge de la roue.

## 10. Itération 4 : bandeau unique, titres, palettes (16/11)

Maquette : `roue.html`. Les fichiers de l'itération 3 ont été modifiés directement.

**Disposition.** La roue est en haut, avec sa languette à 6 h posée sur un **bandeau unique centré dessous**. La carte
latérale et le badge « Vétéran » sont retirés. Encombrement : environ 360 × 430 px en 1080p.

**Le bandeau a deux états, jamais affichés ensemble :**

- **État A, pendant le tirage :**
  - l'avatar à gauche, avec les mois en pastille (« 45 mois ») ;
  - le pseudo en haut, réduit automatiquement s'il est long ;
  - le **titre équipé** dessous, s'il existe. Sans titre, rien ne s'affiche et le pseudo se centre.
- **Transition :** l'identité sort (0,16 s), puis le gain entre.
- **État B :** seulement le montant, grand et centré.
  - T2 / T3 : le lot, puis la pastille ×tier pendant le calcul, puis le compteur.
  - Prime / T1 : le compteur part de 0.
  - Ensuite « +N JETONS » en or sur fond sombre, avec un cadre or et des confettis au jackpot.
  - Puis la roue et le bandeau sortent.

**Titres équipés : les vraies sources, à réutiliser à l'intégration.**

- **Données** (`apps/core-api/src/progression/service.ts`) :
  - la règle `equippedTitles` : le titre choisi sur raptoru.fr, seulement s'il est encore possédé, actif et non
    brouillon ;
  - les classements renvoient déjà `title: { id, label, rarity, style }`.
- **Style** : `CosmeticStyle` (couleur, dégradé, effet `none | glow | shine | pulse | rainbow | sparkle`, graisse).
  - Il est rendu par la feuille du Core `COSMETICS_CSS` (`apps/core-api/src/cosmetics/look.ts`, servie en
    `GET /v1/cosmetics/style.css`), avec les classes `rc-title`, `rc-grad`, `rc-fx-*` et les variables `--rc-*`.
  - C'est la même méthode que Studio (`player-card.ts`) et raptoru.fr.
- **Maquette** :
  - une copie de cette feuille (`shared/cosmetics.css`) ;
  - « Loup-garou » est la vraie ligne de production du 31/10 (dégradé rouge #f02d2d → #ad0505 et glow) ;
  - « Habitué du casino » (sparkle) et « Légende » (shine) sont simulés, avec des effets qui existent ;
  - seul ajout : un fond neutre sombre derrière le titre, pour le détacher du bandeau.
- **À ajouter à l'intégration** : le titre (libellé et style) et l'avatar Twitch dans la charge de la roue. Aucune
  nouvelle API ; c'est une jointure dans la requête existante.

**Palettes.** Chacune a quatre couleurs distinctes par valeur ; l'or du jackpot, les lampes, les filets crème et le
jeton du tier sont communs. Chaque palette a sa base sombre (anneau et bandeau).

- **Chaude** : prune, framboise, corail, ambre.
- **Verte** : vert profond, turquoise, sauge, émeraude.
- **Bleutée** : indigo, bleu pétrole, ardoise colorée, cyan doux.

Dans la maquette, le sélecteur propose aussi « Auto » et « Les trois côte à côte ». À l'intégration : `paletteOf`
(FNV-1a de l'identifiant Twitch, modulo 3), donc la même palette pour le même viewer à chaque affichage.

**Barème : deux versions à comparer** (aucun gain réel ne change ; T1 min / moyenne / max, T3 = ×3)

| Mois | Ancien (SAMMI)  | Actuel (palier à 20 mois) | Tranches de 3 mois |
| ---- | --------------- | ------------------------- | ------------------ |
| 3    | 200 / 1,4k / 5k | 1k / 4,2k / 12k           | 1,1k / 4,6k / 13k  |
| 6    | 200 / 1,7k / 5k | 1,6k / 6,5k / 19k         | 1,8k / 7,6k / 22k  |
| 12   | 500 / 5k / 15k  | 2,4k / 9,9k / 29k         | 3k / 12k / 36k     |
| 20   | 1k / 17k / 50k  | 4,2k / 17k / 50k          | 4k / 17k / 48k     |
| 36   | 1k / 17k / 50k  | 6k / 25k / 72k            | 6,7k / 28k / 80k   |
| 45   | 1k / 17k / 50k  | 6,9k / 29k / 83k          | 7,8k / 33k / 94k   |
| 60   | 1k / 17k / 50k  | 8,3k / 35k / 100k         | 9,6k / 40k / 120k  |

- **Actuel** (× 1,55 à chaque doublement, × 1,25 d'un coup à 20 mois) :
  - les montants changent presque chaque mois ;
  - la seule marche brutale est +37 % à 20 mois ;
  - coût ×1,95.
- **Tranches de 3 mois** (× 1,65 à chaque doublement, sans palier) :
  - les montants montent tous les 3 mois, de moins en moins : +33 %, +23 %, +18 %, +14 %, +12 %, +11 %… ;
  - jamais sous l'ancienne grille, sauf le 20e mois tout juste (−3 %) ;
  - coût ×2,15.
- **Recommandation : les tranches de 3 mois**, qui correspondent à la progression régulière demandée pour environ
  10 % de coût en plus. Pour garder le coût ×1,95, il suffit de baisser les montants de référence d'environ 10 %. Le
  barème définitif reste à valider séparément.

## 11. Itération 5 : languette à 3 h, paliers de 3 mois (16/11)

**Ce qui change dans la maquette `roue.html`.** Le bandeau est inchangé : sous la roue, avec deux états exclusifs
(identité, puis gain). Les palettes et les 12 lampes sont inchangées.

- **Languette à 3 h**, à droite de la roue et pointée vers l'intérieur.
- **Point d'arrêt** : le tirage s'arrête sur l'angle écran 90° exact, sans décalage aléatoire.
- **Montants des parts** : ils sont écrits dans le sens du rayon (rotation i·30° − 90°). À l'arrêt, le montant
  gagnant est donc **horizontal**, lu de gauche à droite, en face de la languette.
- **Contrôle chiffré en 1080p** : le centre du montant et celui de la languette sont à la même hauteur au pixel près,
  la boîte du texte est plus large que haute, et le montant ne touche pas la languette.
- **Retiré** : le sélecteur de barème.

**Barème proposé : un palier tous les 3 mois.**

- **Palier** : les mois réels arrondis au trimestre supérieur (1–3 mois : palier 1, 4–6 : palier 2…).
- **Grille** : 12 parts de même chance, fixes dans un palier. Grille du palier p = référence (600 · 800 · 1 000 ·
  1 200 · 1 500 · 1 800 · 2 000 · 2 400 · 2 800 · 3 300 · 4 000 · 5 500) × p^0,83.
- **Arrondi** : à la centaine sous 20 000, au demi-millier au-dessus.
- **Tier** : il multiplie le lot (Prime / T1 ×1, T2 ×2, T3 ×3).
- **Cible tenue** : jackpot de 66 000 en T1 à 60 mois, soit **198 000 en T3**.
- **Progression** : chaque palier relève le minimum, la moyenne et le jackpot (vérifié jusqu'à 180 mois). La hausse
  est de plus en plus douce : jackpot +78 % au palier 2, +43 %, +27 %… +7 % au palier 12, +5 % au palier 20, +3 %
  vers 10 ans. Au-delà de 60 mois, la croissance continue à ce rythme (environ 270 000 en T3 à 90 mois, 330 000 à
  120 mois) ; on peut la ralentir encore si besoin.
- La grille de référence est plus resserrée que celle de l'itération 4 : un minimum plus haut, un jackpot moins
  extrême par rapport à la moyenne. Ce sont des gains réguliers plutôt que spectaculaires.

| Mois | Palier | T1 min / moy. / max     | T3 min / moy. / max       | SAMMI moy. T1 / T3 | Écart moy. |
| ---- | ------ | ----------------------- | ------------------------- | ------------------ | ---------- |
| 3    | 1      | 600 / 2 200 / 5 500     | 1 800 / 6 700 / 16 500    | 1 400 / 4 200      | +59 %      |
| 6    | 2      | 1 100 / 4 000 / 9 800   | 3 300 / 12 000 / 29 400   | 1 700 / 5 200      | +132 %     |
| 12   | 4      | 1 900 / 7 100 / 17 400  | 5 700 / 21 200 / 52 200   | 5 000 / 14 900     | +42 %      |
| 24   | 8      | 3 400 / 12 600 / 31 000 | 10 200 / 37 800 / 93 000  | 17 200 / 51 500    | -27 %      |
| 36   | 12     | 4 700 / 17 600 / 43 000 | 14 100 / 52 800 / 129 000 | 17 200 / 51 500    | +3 %       |
| 45   | 15     | 5 700 / 21 200 / 52 000 | 17 100 / 63 600 / 156 000 | 17 200 / 51 500    | +23 %      |
| 60   | 20     | 7 200 / 26 900 / 66 000 | 21 600 / 80 700 / 198 000 | 17 200 / 51 500    | +57 %      |

| Palier | Mois  | 12 parts (Prime / T1, avant le tier)                                                                    |
| ------ | ----- | ------------------------------------------------------------------------------------------------------- |
| 1      | 1–3   | 600 · 800 · 1 000 · 1 200 · 1 500 · 1 800 · 2 000 · 2 400 · 2 800 · 3 300 · 4 000 · 5 500               |
| 2      | 4–6   | 1 100 · 1 400 · 1 800 · 2 100 · 2 700 · 3 200 · 3 600 · 4 300 · 5 000 · 5 900 · 7 100 · 9 800           |
| 3      | 7–9   | 1 500 · 2 000 · 2 500 · 3 000 · 3 700 · 4 500 · 5 000 · 6 000 · 7 000 · 8 200 · 10 000 · 13 700         |
| 4      | 10–12 | 1 900 · 2 500 · 3 200 · 3 800 · 4 700 · 5 700 · 6 300 · 7 600 · 8 800 · 10 400 · 12 600 · 17 400        |
| 5      | 13–15 | 2 300 · 3 000 · 3 800 · 4 600 · 5 700 · 6 800 · 7 600 · 9 100 · 10 600 · 12 500 · 15 200 · 21 000       |
| 6      | 16–18 | 2 700 · 3 500 · 4 400 · 5 300 · 6 600 · 8 000 · 8 800 · 10 600 · 12 400 · 14 600 · 17 700 · 24 500      |
| 7      | 19–21 | 3 000 · 4 000 · 5 000 · 6 000 · 7 500 · 9 000 · 10 000 · 12 100 · 14 100 · 16 600 · 20 000 · 27 500     |
| 8      | 22–24 | 3 400 · 4 500 · 5 600 · 6 700 · 8 400 · 10 100 · 11 200 · 13 500 · 15 700 · 18 500 · 22 500 · 31 000    |
| 9      | 25–27 | 3 700 · 5 000 · 6 200 · 7 400 · 9 300 · 11 100 · 12 400 · 14 900 · 17 300 · 20 500 · 25 000 · 34 000    |
| 10     | 28–30 | 4 100 · 5 400 · 6 800 · 8 100 · 10 100 · 12 200 · 13 500 · 16 200 · 18 900 · 22 500 · 27 000 · 37 000   |
| 11     | 31–33 | 4 400 · 5 800 · 7 300 · 8 800 · 11 000 · 13 200 · 14 600 · 17 500 · 20 500 · 24 000 · 29 000 · 40 000   |
| 12     | 34–36 | 4 700 · 6 300 · 7 900 · 9 400 · 11 800 · 14 100 · 15 700 · 18 900 · 22 000 · 26 000 · 31 500 · 43 000   |
| 13     | 37–39 | 5 000 · 6 700 · 8 400 · 10 100 · 12 600 · 15 100 · 16 800 · 20 000 · 23 500 · 27 500 · 33 500 · 46 000  |
| 14     | 40–42 | 5 400 · 7 100 · 8 900 · 10 700 · 13 400 · 16 100 · 17 900 · 21 500 · 25 000 · 29 500 · 35 500 · 49 000  |
| 15     | 43–45 | 5 700 · 7 600 · 9 500 · 11 300 · 14 200 · 17 000 · 18 900 · 22 500 · 26 500 · 31 000 · 38 000 · 52 000  |
| 16     | 46–48 | 6 000 · 8 000 · 10 000 · 12 000 · 15 000 · 18 000 · 19 900 · 24 000 · 28 000 · 33 000 · 40 000 · 55 000 |
| 17     | 49–51 | 6 300 · 8 400 · 10 500 · 12 600 · 15 700 · 18 900 · 21 000 · 25 000 · 29 500 · 34 500 · 42 000 · 57 500 |
| 18     | 52–54 | 6 600 · 8 800 · 11 000 · 13 200 · 16 500 · 19 800 · 22 000 · 26 500 · 31 000 · 36 500 · 44 000 · 60 500 |
| 19     | 55–57 | 6 900 · 9 200 · 11 500 · 13 800 · 17 300 · 20 500 · 23 000 · 27 500 · 32 000 · 38 000 · 46 000 · 63 500 |
| 20     | 58–60 | 7 200 · 9 600 · 12 000 · 14 400 · 18 000 · 21 500 · 24 000 · 29 000 · 33 500 · 39 500 · 48 000 · 66 000 |

**Avis économique :**

- **Coût** : environ ×1,47 par rapport à SAMMI, sur le mélange supposé (×1,95 pour la proposition de l'itération 4).
  C'est maîtrisé. Le surcoût vient surtout des jeunes abonnés, que SAMMI payait presque pareil de 1 à 11 mois. Le
  plafond demandé à 60 mois est tenu.
- **Un seul point faible : 20 à 33 mois.** Le gain moyen y est 25 à 35 % sous SAMMI, à cause du saut de l'ancienne
  roue à 20 mois et de ses gros lots rares (50 000 en T1).
  - Le minimum reste 3 à 5 fois plus haut.
  - La médiane est équivalente : à 24 mois en T1, 10 500 contre 12 500.
  - La moyenne rejoint SAMMI vers 33–36 mois et la dépasse ensuite.
- **Leviers si ce creux gêne :**
  - monter la grille de référence d'environ 10 % : coût environ ×1,6, creux d'environ −25 % ;
  - ou accepter un jackpot T3 d'environ 230 000 à 60 mois.
- **Avant l'activation** : mesurer le vrai mélange sur `sw_spins` (lecture seule, GO d'Antoni).

**Intégration :**

- `subWheelLayout(months, grid)` renvoie la grille du palier.
- La formule `val × mult × tier` du Core est inchangée (mult = 1, tier ×1 / ×2 / ×3).
- Le reste est inchangé : § 5, § 8 et § 10 (colonne `grid`, `wheel-v3.js`, titre et avatar dans la charge).

## 12. Itération 6 : quatre montants, comparés à la vraie Production (16/11)

Le rendu de l'itération 5 est inchangé. La maquette affiche seulement les quatre montants répétés, et un sélecteur
« Barème » (L1 / L) remplace les grilles précédentes.

### 12.1 Le barème réellement en Production

- **Code** : Core `c1da930a` (relevé du 15/11, identique sur `origin/main`), `subWheelLayout(months)` et
  `subWheelAmount`.
- **4 grilles** (montant = valeur × multiplicateur de la part) :
  - 1–3 mois : 8 parts, de 200 à 5 000 ;
  - 4–11 mois : 10 parts, de 200 à 5 000 ;
  - 12–19 mois : 12 parts, de 500 à 15 000 ;
  - 20 mois et plus : 12 parts, de 1 000 à 50 000.
- **Tirage** : uniforme (`randomInt`).
- **Tier** : ×1 / ×2 / ×3, Prime = T1.
- **Mois de la grille** : le mois du droit au moment du tirage (certain, ou estimé faute de preuve).
- Aucune autre majoration.

**Vraies données, lues en lecture seule** via Studio (`/api/sub-wheel/state`, les 20 derniers tirages, du 20/10 au
13/11 ; seuls des agrégats sont repris ici) :

- **Mélange** : T1 14, T2 2, T3 4. 15 tirages sur 20 concernent une ancienneté de 20 mois ou plus, 3 seulement moins
  de 6 mois. La communauté est surtout ancienne : les hypothèses des § 7 à 11 sous-estimaient le coût.
- **Versé** : 256 300 Jetons, pour une espérance de 421 075 avec les grilles appliquées. Les tirages ont été
  défavorables.
- **Défaut de Production constaté** : 2 tirages sur 20 étaient des « sub » de vétérans (40 et 15 mois) payés sur la
  **grille 1–3 mois**. Le mois était estimé à 1 faute d'historique, puis confirmé après le tirage. En V3, l'écart
  serait plus grand (palier 1 au lieu du palier 14).
  - **Correctif proposé à l'intégration** (Core, classe D) : un droit dont le mois est estimé sans historique attend
    sa confirmation, dans la fenêtre de 10 min déjà prévue, avant d'être tiré.

### 12.2 Le barème proposé

- **12 parts de même chance, quatre montants** : 5 petits, 3 moyens, 3 bons et 1 jackpot, soit **41,7 %, 25 %, 25 %
  et 8,3 %**, pour tous les profils.
- **Disposition** : jackpot, petit, moyen, petit, bon, petit, moyen, petit, bon, moyen, petit, bon. Jamais deux
  montants identiques côte à côte.
- **Palier** : un palier par tranche de 3 mois d'ancienneté réelle (1–3 mois : palier 1…).
- **L1 (recommandé)** : palier p → **(1 500 · 2 000 · 2 500 · 3 200) × (p + 1)**, jusqu'à 60 mois. C'est l'exemple
  d'Antoni (15 000 / 20 000 / 25 000 / 32 000) décalé d'un palier : il tombe à 25–27 mois au lieu de 28–30.
  - Après 60 mois, **un quart de pas par palier** : environ +1,2 % par trimestre.
  - Jackpot T3 : **201 600 à 60 mois**, 225 600 à 90 mois, 249 600 à 120 mois.
- **L** : la même chose sans le décalage, soit l'exemple exact à 30 mois. Jackpot T3 : 192 000 à 60 mois, 216 000 à
  90 mois.
- **Tier** : il multiplie le lot (×1 / ×2 / ×3).

### 12.3 Comparaison : 10 profils, Production contre L1

En Prime / T1. Le T3 vaut T1 × 3 dans les deux systèmes : les écarts en % sont identiques et la dernière colonne donne
la moyenne T3.

| Mois | Palier | SAMMI T1 min / moy. / max | V3 T1 : petit · moyen · bon · jackpot | V3 T1 min / moy. / max   | Moy.   | V3 T3 moy. (SAMMI T3) |
| ---- | ------ | ------------------------- | ------------------------------------- | ------------------------ | ------ | --------------------- |
| 1    | 1      | 200 / 1 406 / 5 000       | 3 000 · 4 000 · 5 000 · 6 400         | 3 000 / 4 033 / 6 400    | +187 % | 12 100 (4 219)        |
| 3    | 1      | 200 / 1 406 / 5 000       | 3 000 · 4 000 · 5 000 · 6 400         | 3 000 / 4 033 / 6 400    | +187 % | 12 100 (4 219)        |
| 6    | 2      | 200 / 1 725 / 5 000       | 4 500 · 6 000 · 7 500 · 9 600         | 4 500 / 6 050 / 9 600    | +251 % | 18 150 (5 175)        |
| 9    | 3      | 200 / 1 725 / 5 000       | 6 000 · 8 000 · 10 000 · 12 800       | 6 000 / 8 067 / 12 800   | +368 % | 24 200 (5 175)        |
| 12   | 4      | 500 / 4 979 / 15 000      | 7 500 · 10 000 · 12 500 · 16 000      | 7 500 / 10 083 / 16 000  | +103 % | 30 250 (14 938)       |
| 18   | 6      | 500 / 4 979 / 15 000      | 10 500 · 14 000 · 17 500 · 22 400     | 10 500 / 14 117 / 22 400 | +184 % | 42 350 (14 938)       |
| 24   | 8      | 1 000 / 17 167 / 50 000   | 13 500 · 18 000 · 22 500 · 28 800     | 13 500 / 18 150 / 28 800 | +6 %   | 54 450 (51 500)       |
| 30   | 10     | 1 000 / 17 167 / 50 000   | 16 500 · 22 000 · 27 500 · 35 200     | 16 500 / 22 183 / 35 200 | +29 %  | 66 550 (51 500)       |
| 40   | 14     | 1 000 / 17 167 / 50 000   | 22 500 · 30 000 · 37 500 · 48 000     | 22 500 / 30 250 / 48 000 | +76 %  | 90 750 (51 500)       |
| 50   | 17     | 1 000 / 17 167 / 50 000   | 27 000 · 36 000 · 45 000 · 57 600     | 27 000 / 36 300 / 57 600 | +111 % | 108 900 (51 500)      |

- **Probabilités V3, pour tous les profils** :
  - petit : 5/12 = 41,7 % ;
  - moyen : 3/12 = 25 % ;
  - bon : 3/12 = 25 % ;
  - jackpot : 1/12 = 8,3 %.
- **Production, pour comparer** : chaque part a 1/8, 1/10 ou 1/12 de chance selon la grille. À 20 mois et plus, il y
  a 1 chance sur 4 de gagner 3 000 ou moins (×3 en T3).

**Profils moins bien récompensés en moyenne :**

- **L1** : seulement **20 et 21 mois** (−6 %). Leur minimum passe de 1 000 à 12 000, leur médiane de 12 500 à 16 000.
  Ils perdent uniquement les gros lots rares de l'ancienne grille (50 000 et 30 000).
- **L** : 20–21 mois (−18 %) et 22–24 mois (−6 %).
- **Ajustement retenu** : c'est justement le décalage d'un palier qui distingue L1 de L. Supprimer aussi les −6 % de
  20–21 mois demanderait environ +0,5 palier partout (jackpot T3 d'environ 206 000 à 60 mois) ; ce n'est pas
  recommandé.

### 12.4 Simulation de 10 viewers (L1)

- Un tirage `u` uniforme entre 0 et 1 par viewer (graine fixe, reproductible).
- Ce même `u` est appliqué aux deux roues, **au même rang** : les montants sont triés et `u` désigne la même place
  dans chaque distribution. Aucune des deux roues n'est avantagée.
- Ces tirages illustrent les écarts. **Seules les moyennes mathématiques du § 12.3 mesurent l'équilibrage.**

| Viewer | Mois | Tier  | u    | SAMMI  | V3      | Différence |
| ------ | ---- | ----- | ---- | ------ | ------- | ---------- |
| V1     | 1    | T1    | 0.25 | 300    | 3 000   | +2 700     |
| V2     | 3    | T1    | 0.10 | 200    | 3 000   | +2 800     |
| V3     | 6    | Prime | 0.49 | 1 000  | 6 000   | +5 000     |
| V4     | 9    | T1    | 0.38 | 750    | 6 000   | +5 250     |
| V5     | 12   | T2    | 0.52 | 10 000 | 20 000  | +10 000    |
| V6     | 18   | T1    | 0.86 | 10 000 | 17 500  | +7 500     |
| V7     | 24   | T3    | 0.10 | 6 000  | 40 500  | +34 500    |
| V8     | 30   | T1    | 0.53 | 15 000 | 22 000  | +7 000     |
| V9     | 40   | T3    | 0.88 | 90 000 | 112 500 | +22 500    |
| V10    | 50   | T1    | 0.97 | 50 000 | 57 600  | +7 600     |

### 12.5 Coût

Estimation sur les 20 vrais tirages, au même volume d'environ 25 roues par mois :

| Barème                                    | Espérance sur les 20 tirages | Rapport à la Production | Par mois (25 roues) |
| ----------------------------------------- | ---------------------------- | ----------------------- | ------------------- |
| Production (grilles telles qu'appliquées) | 421 075                      | ×1                      | ≈ 526 000           |
| V3 L                                      | 740 117                      | ×1,76                   | ≈ 925 000           |
| **V3 L1**                                 | **800 617**                  | **×1,90**               | **≈ 1 000 000**     |

- **Base des mois** : celle des droits, c'est-à-dire l'ancienneté réelle confirmée.
- **Hypothèses** : 20 tirages seulement, et un volume extrapolé. À confirmer sur un mois complet.
- **Pourquoi c'est plus cher que les estimations précédentes** : la communauté est surtout ancienne, et c'est
  là que la V3 est la plus généreuse.

### 12.6 Grille définitive proposée (L1, jusqu'à 60 mois)

| Palier | Mois  | Petit (×5) | Moyen (×3) | Bon (×3) | Jackpot (×1) | Moyenne T1 |
| ------ | ----- | ---------- | ---------- | -------- | ------------ | ---------- |
| 1      | 1–3   | 3 000      | 4 000      | 5 000    | 6 400        | 4 033      |
| 2      | 4–6   | 4 500      | 6 000      | 7 500    | 9 600        | 6 050      |
| 3      | 7–9   | 6 000      | 8 000      | 10 000   | 12 800       | 8 067      |
| 4      | 10–12 | 7 500      | 10 000     | 12 500   | 16 000       | 10 083     |
| 5      | 13–15 | 9 000      | 12 000     | 15 000   | 19 200       | 12 100     |
| 6      | 16–18 | 10 500     | 14 000     | 17 500   | 22 400       | 14 117     |
| 7      | 19–21 | 12 000     | 16 000     | 20 000   | 25 600       | 16 133     |
| 8      | 22–24 | 13 500     | 18 000     | 22 500   | 28 800       | 18 150     |
| 9      | 25–27 | 15 000     | 20 000     | 25 000   | 32 000       | 20 167     |
| 10     | 28–30 | 16 500     | 22 000     | 27 500   | 35 200       | 22 183     |
| 11     | 31–33 | 18 000     | 24 000     | 30 000   | 38 400       | 24 200     |
| 12     | 34–36 | 19 500     | 26 000     | 32 500   | 41 600       | 26 217     |
| 13     | 37–39 | 21 000     | 28 000     | 35 000   | 44 800       | 28 233     |
| 14     | 40–42 | 22 500     | 30 000     | 37 500   | 48 000       | 30 250     |
| 15     | 43–45 | 24 000     | 32 000     | 40 000   | 51 200       | 32 267     |
| 16     | 46–48 | 25 500     | 34 000     | 42 500   | 54 400       | 34 283     |
| 17     | 49–51 | 27 000     | 36 000     | 45 000   | 57 600       | 36 300     |
| 18     | 52–54 | 28 500     | 38 000     | 47 500   | 60 800       | 38 317     |
| 19     | 55–57 | 30 000     | 40 000     | 50 000   | 64 000       | 40 333     |
| 20     | 58–60 | 31 500     | 42 000     | 52 500   | 67 200       | 42 350     |

**Au-delà de 60 mois** : chaque palier ajoute un quart du pas habituel (petit +375, moyen +500, bon +625, jackpot +800,
arrondis à la centaine). La croissance continue sans jamais s'arrêter, environ quatre fois plus lentement.

## 13. Système livré (16/11/2026)

Les décisions d'Antoni du 16/11 : barème L1, avec le haut de la distribution ajusté ; roue Arcade de l'itération 5 ;
abonnements offerts exclus ; ancienneté jamais prise pour « 1 mois » par défaut.

### 13.1 Barème définitif

12 parts de même chance : **5 petits gains, 3 moyens, 3 bons, 1 jackpot** (41,7 %, 25 %, 25 %, 8,3 %). Les montants
identiques ne sont jamais voisins (ordre : jackpot, petit, moyen, petit, bon, petit, moyen, petit, bon, moyen, petit,
bon).

- **Palier** : un tous les 3 mois d'ancienneté **confirmée** (1–3 mois : palier 1, 4–6 : palier 2…).
- **Montants du palier p** : (1 500 · 2 000 · 2 500 · 3 000) × (p + 1) jusqu'au palier 20 (58–60 mois). Au-delà, un
  quart de pas par palier, arrondi à la centaine.
- **Tier** : Prime / T1 ×1, T2 ×2, T3 ×3, appliqué au lot tombé.
- **Ajustement du haut demandé** : le jackpot de référence passe de 3 200 (L1) à 3 000.
  - Aucun gain à six chiffres en T3 avant 31 mois (jackpot T3 de 99 000 à 28–30 mois).
  - Les « bons » gains T3 dépassent 100 000 dès 37 mois, les gains moyens dès 46 mois.
  - Jackpot T3 : 189 000 à 60 mois, puis +2 250 par trimestre environ.
  - Minimums et gains moyens inchangés par rapport à L1.
- **Code** : `SUB_WHEEL_V3`, `subWheelV3Amounts`, `subWheelGrid(months, 3)` dans `packages/schemas/src/sub-wheel.ts`.
  La formule du Core reste `val × mult × tier`, avec mult = 1 en V3.

| Palier | Mois    | Petit (5/12) | Moyen (3/12) | Bon (3/12) | Jackpot (1/12) | Moyenne T1 | Jackpot T3 |
| ------ | ------- | ------------ | ------------ | ---------- | -------------- | ---------- | ---------- |
| 1      | 1–3     | 3 000        | 4 000        | 5 000      | 6 000          | 4 000      | 18 000     |
| 2      | 4–6     | 4 500        | 6 000        | 7 500      | 9 000          | 6 000      | 27 000     |
| 3      | 7–9     | 6 000        | 8 000        | 10 000     | 12 000         | 8 000      | 36 000     |
| 4      | 10–12   | 7 500        | 10 000       | 12 500     | 15 000         | 10 000     | 45 000     |
| 5      | 13–15   | 9 000        | 12 000       | 15 000     | 18 000         | 12 000     | 54 000     |
| 6      | 16–18   | 10 500       | 14 000       | 17 500     | 21 000         | 14 000     | 63 000     |
| 7      | 19–21   | 12 000       | 16 000       | 20 000     | 24 000         | 16 000     | 72 000     |
| 8      | 22–24   | 13 500       | 18 000       | 22 500     | 27 000         | 18 000     | 81 000     |
| 9      | 25–27   | 15 000       | 20 000       | 25 000     | 30 000         | 20 000     | 90 000     |
| 10     | 28–30   | 16 500       | 22 000       | 27 500     | 33 000         | 22 000     | 99 000     |
| 11     | 31–33   | 18 000       | 24 000       | 30 000     | 36 000         | 24 000     | 108 000    |
| 12     | 34–36   | 19 500       | 26 000       | 32 500     | 39 000         | 26 000     | 117 000    |
| 13     | 37–39   | 21 000       | 28 000       | 35 000     | 42 000         | 28 000     | 126 000    |
| 14     | 40–42   | 22 500       | 30 000       | 37 500     | 45 000         | 30 000     | 135 000    |
| 15     | 43–45   | 24 000       | 32 000       | 40 000     | 48 000         | 32 000     | 144 000    |
| 16     | 46–48   | 25 500       | 34 000       | 42 500     | 51 000         | 34 000     | 153 000    |
| 17     | 49–51   | 27 000       | 36 000       | 45 000     | 54 000         | 36 000     | 162 000    |
| 18     | 52–54   | 28 500       | 38 000       | 47 500     | 57 000         | 38 000     | 171 000    |
| 19     | 55–57   | 30 000       | 40 000       | 50 000     | 60 000         | 40 000     | 180 000    |
| 20     | 58–60   | 31 500       | 42 000       | 52 500     | 63 000         | 42 000     | 189 000    |
| 24     | 70–72   | 33 000       | 44 000       | 55 000     | 66 000         | 44 000     | 198 000    |
| 30     | 88–90   | 35 300       | 47 000       | 58 800     | 70 500         | 47 033     | 211 500    |
| 40     | 118–120 | 39 000       | 52 000       | 65 000     | 78 000         | 52 000     | 234 000    |

**Comparaison avec la Production :**

- **Ancienne grille appliquée aux 20 derniers vrais tirages** : 421 075 Jetons d'espérance. **V3** : 794 000, soit
  **×1,89**, environ 990 000 par mois pour 25 roues au lieu d'environ 526 000. Ce coût est calculé sur l'ancienneté
  réelle.
- **Seul profil moins bien récompensé en moyenne** : 20–21 mois (−7 %). Leur minimum passe de 1 000 à 12 000 ; ils
  perdent les gros lots rares de l'ancienne grille. À 24 mois : +5 % ; à 30 mois : +28 %.

### 13.2 Barème de chaque tirage

- **Réglage** : `sw_settings.grid` (1 = ancienne roue, 3 = V3) et `grid_since`.
  - Le Diffuseur choisit dans Studio › Roue du Sub › Barème (journalisé `sw_grid`).
- **Au tirage** (`gridFor`), le Core prend le barème courant, **sauf pour un droit acquis avant son activation** : ce
  droit garde l'ancienne roue. Aucune transformation silencieuse d'un tour en attente.
- **Chaque tirage enregistre son barème** (`sw_spins.grid`) : un tirage rejoué ou relancé garde le sien. Les lignes
  existantes valent 1 : rien n'est recalculé et aucun solde ne change.
- **Le mode de repli `v1`** (pas d'ancienneté confirmée : un « sub » y vaut 1 mois) tire toujours sur l'ancienne roue.

### 13.3 Ancienneté

**Le défaut corrigé** : un « sub » sans mois cumulés et sans historique (une reprise Prime d'un abonné de longue date,
par exemple) était estimé à 1 mois et tiré tout de suite sur la grille d'un premier mois. 2 des 20 derniers tirages de
Production étaient dans ce cas.

**Désormais :**

| Ancienneté du droit                                     | Tirage automatique                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| Certaine (mois cumulés de Twitch)                       | normal                                                           |
| Confirmée par le badge du chat (`badge`)                | normal                                                           |
| Confirmée dans Studio (`manual`, `confirmed_by`)        | normal                                                           |
| Estimée d'après l'historique (dernier mois certain + 1) | après `monthConfirmMs` (10 min) sans confirmation                |
| **Inconnue** (aucun historique)                         | **jamais** : le droit reste dû, hors des files, sans les bloquer |

- **Les confirmations :**
  - le partage du resub (mois cumulés), qui confirmait déjà un droit estimé dans la fenêtre de 10 min ;
  - **le badge abonné du premier message de chat** (`badges[].info`, le nombre de mois). Le bot le transmet
    (`chatter.sub_months`), et le module chat de la roue confirme le dernier droit incertain du viewer. Un badge égal ou inférieur au dernier mois certain est ignoré (badge en retard sur le renouvellement), et le message de chat sert de clé, donc un rejouage ne change rien ;
  - **Studio** : le bouton « Confirmer l'ancienneté » de la liste des tours (journalisé `sw_month_confirm`). Un mois
    certain n'est jamais écrasé (`month_certain`).
- **Les gardes :**
  - `drawLocked` refuse un mois inconnu (`month_unconfirmed`) : ni tirage automatique, ni « Tirer », ni tirage
    immédiat du mode v2_acquire ;
  - les deux files (`draws.ts`) excluent les droits non prêts sans s'y arrêter ;
  - tout vient de la base : un redémarrage ne perd rien et ne retire rien ;
  - le Lab simule la confirmation par le badge (`/lab/simulate` avec `months` sur un sub).
- **Limite** : un nouvel abonné qui n'écrit jamais dans le chat attend qu'on confirme dans Studio. Son tour n'est
  jamais perdu.

### 13.4 Rendu (Studio, lecteur d'effets)

- **Fichiers** : `apps/studio/server/effects-player/wheel-v3.js`, la maquette de l'itération 5 rendue réelle.
  - Il réutilise les sons d'origine exportés par `wheel.js` (ticks, arrêt, jingle) et les deux mp3.
  - Polices locales (`effects-player/fonts/`, OFL) : aucune dépendance réseau pendant le live.
- **Choix du rendu** : `player.js` joue `wheel-v3.js` pour un tirage de barème 3, sinon l'ancienne roue (anciens tirages,
  Core plus ancien).
- **Contenu reçu du Core avec chaque tirage** : `viewer_id`, `prime`, `months`, `month_source`, `grid`, `layout`,
  `segment`, `lot`, `coef`, `amount`, plus l'avatar Twitch et le titre équipé avec son style.
  - L'avatar vient du cache partagé `AvatarCache` / `lab_viewer_avatars`, celui de Votekick, Random Ban et du Dock.
  - Le titre suit la règle de Progression (`equippedTitleLooks`, partagée avec l'annonce Level Up) et la feuille du Core
    relayée par Studio (`/cosmetics/style.css`).
  - Le lecteur refuse un tirage dont le montant ne correspond pas à sa part (`amount_mismatch`).
- **Habillage** : palette déterministe (FNV-1a de l'identifiant Twitch), flèche à 3 h et montant gagnant horizontal,
  bandeau unique (identité, puis gain). Position et taille : en bas à droite, comme l'ancienne roue.
- **Studio** : choix du barème, confirmation de l'ancienneté, aperçu V3 (gains du palier, vrai rendu dans « Essayer »).
- **Politique de sécurité du lecteur** : `img-src` autorise le seul CDN Twitch, `font-src 'self'`.

### 13.5 Migration, déploiement, retour arrière

- **Migration** `20261130130000_sub_wheel_v3.sql` (jumelle Lab `…120000`), additive et idempotente :
  - `sw_settings.grid` / `grid_since` ;
  - `sw_spins.grid` / `confirmed_by` / `prime` ;
  - `month_source` accepte `manual`.
  - Les valeurs par défaut gardent le comportement de l'ancien Core.
- **Ordre de déploiement** : sauvegarde de la base, puis **Core** (migration), puis **bot** (`is_gift`,
  `sub_months` : le schéma strict d'un ancien Core les refuserait), puis release Studio. Le barème V3 s'active ensuite
  dans Studio.
  - Avant l'installation du nouveau Studio, un tirage V3 est rendu par l'ancien `wheel.js`, avec les bons montants et
    l'ancien habillage.
- **Retour arrière** :
  - remettre le barème sur l'ancienne roue (Studio), ou redéployer le Core précédent : il ignore les nouvelles
    colonnes et tire sur l'ancienne roue ;
  - un tirage V3 rejoué par un ancien Core échouerait à l'animation (`amount_mismatch`), sans aucun nouveau crédit ;
  - le bot précédent se redéploie seul ;
  - la migration n'a pas besoin d'être annulée.

### 13.6 Tests

- **Core**, sur PGlite :
  - `sub-wheel-v3.test.ts` : barème (paliers, frontières, tiers, probabilités, croissance jusqu'à 180 mois, ancien
    barème intact), barème de chaque tirage, contenu de l'animation, ancienneté (inconnue, badge, partage dans les deux
    ordres, estimée, confirmation manuelle, redémarrage) ;
  - `sub-wheel-gifts.test.ts` ;
  - les suites V2, R2, R3, Lab et migrations, adaptées à la règle d'ancienneté.
- **Vrai PostgreSQL** : la course badge (Core A) / « Tirer » (Core B) / badge rejoué, 20 viewers, 3 tours ; les suites
  d'intégration de la roue.
- **Bot** : `alert-events` (`is_gift`), `lab-chat-ingest` (`sub_months`).
- **Studio** : lecteur (fichiers servis, politique de sécurité), chaîne Lab V3.
- **Banc visuel Chromium 1080p** du vrai `wheel-v3.js`, sur fonds sombre et clair : montant gagnant horizontal en face
  de la flèche, PRIME au centre, polices locales, `amount_mismatch` refusé.
