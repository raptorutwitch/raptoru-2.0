# Roue du Sub V3 : barème et rendu

**Statut (16/11/2026) : proposition.** Maquettes non branchées, **locales** (le dossier `prototypes/` est exclu de
Git par `.git/info/exclude`) : `Documents\Raptoru 2.0 - Worktrees\agent\prototypes\sub-wheel-v3\index.html`. Rien n'est développé ni déployé, et
aucune direction n'est encore choisie par Antoni. La Production garde la roue actuelle
([SUB_WHEEL.md](SUB_WHEEL.md), droits V2 : [SUB_WHEEL_V2_PLAN.md](SUB_WHEEL_V2_PLAN.md)).

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
