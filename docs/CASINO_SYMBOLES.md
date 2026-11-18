# Casino : inventaire des symboles de la machine à sous (préparation des émotes)

État au 19/11/2026, lu dans le moteur actuel (`apps/core-api/src/casino/slot.ts`) et dans l'affichage
(`extension/shared/casino/symbols.js`, `skin.js`). **Rien n'est encore personnalisé** : Antoni choisit d'abord ses
symboles, l'intégration viendra ensuite.

Personnaliser un symbole ne change **que son image**. Les probabilités, les gains, les lignes et les tirages restent
ceux du Core : ils ne lisent jamais `skin.js`.

## 1. Les 9 symboles logiques

La machine a 5 rouleaux × 3 rangées et 10 lignes fixes. Chaque rouleau a 30 cases. Les gains sont en « × la mise »,
pour une ligne qui part du rouleau de gauche.

| Identifiant | Nom affiché | Cases par rouleau | 2 sur une ligne | 3     | 4     | 5      | Rôle                             |
| ----------- | ----------- | ----------------- | --------------- | ----- | ----- | ------ | -------------------------------- |
| `cerise`    | Cerise      | 8                 | —               | ×0,40 | ×1,15 | ×3,50  | petit fruit, le plus fréquent    |
| `citron`    | Citron      | 7                 | —               | ×0,35 | ×1,15 | ×3,50  | petit fruit                      |
| `raisin`    | Raisin      | 6                 | —               | ×0,65 | ×2,25 | ×7     | fruit moyen                      |
| `cloche`    | Cloche      | 3                 | —               | ×1,75 | ×5,50 | ×17,50 | symbole moyen                    |
| `bar`       | BAR         | 2                 | —               | ×3,50 | ×12,5 | ×45    | symbole fort                     |
| `diamant`   | Diamant     | 1                 | ×0,25           | ×7,50 | ×30   | ×100   | rare, paie dès 2                 |
| `sept`      | 7           | 1                 | ×0,50           | ×15   | ×60   | ×250   | le plus fort, paie dès 2         |
| `wild`      | WILD        | 1                 | —               | ×10   | ×50   | ×500   | joker (voir § 2)                 |
| `bonus`     | BONUS       | 1                 | —               | —     | —     | —      | déclencheur du Coffre (voir § 2) |

Les rouleaux contiennent donc 27 cases de symboles payants, 1 WILD et 1 BONUS sur 30. RTP de la machine : 95,1 %
(jeu de base 73,1 % + Coffre 22,0 %), sans plafond de gain atteint.

## 2. Rôles particuliers

- **WILD :**
  - remplace tous les symboles payants d'une ligne, jamais BONUS ;
  - une ligne ne paie qu'une combinaison, la meilleure : le symbole complété par les WILD, ou les WILD seuls s'ils
    paient plus ;
  - il porte une règle écrite dans la table des gains (« WILD remplace tous les symboles, sauf BONUS »).
- **BONUS (scatter) :**
  - compté n'importe où sur la grille, pas sur les lignes ;
  - il ne paie rien par lui-même et il coupe une ligne ;
  - 3, 4 ou 5 BONUS ouvrent le Coffre : les pièces de départ du Coffre se posent sur les cases des BONUS.

L'idée d'Antoni, sa photo de profil Twitch pour BONUS, ne change rien à ces règles. Les deux symboles spéciaux doivent
seulement rester **reconnaissables au premier coup d'œil**, car le joueur doit voir tout de suite un WILD ou un BONUS.

## 3. Ce qui est remplaçable

- **Les 9 symboles**, chacun indépendamment, y compris WILD et BONUS. Ce qui n'est pas remplacé garde son dessin
  actuel.
- **Partout où le symbole apparaît**, avec la même image :
  - les rouleaux (joueur, spectateur, Replay) ;
  - la table des gains ;
  - l'historique (le meilleur symbole du tour) ;
  - les cases du Coffre avant l'arrivée des pièces.
- **Ce qui ne se remplace pas par `skin.js` :** les pièces du Coffre (valeurs, MINI / MAJEUR / MÉGA / GRAND), le cadre de
  la machine, la roulette. Les sons, eux, se remplacent par fichier (`SKIN.sounds`).

## 4. Images acceptées

- **Formats :** PNG, WebP (animé aussi), GIF, APNG, SVG.
- **Fond :** transparent de préférence, sinon carré plein, cadré avec `fit: 'cover'`.
- **Sources :**
  - les émotes Twitch (`https://static-cdn.jtvnw.net/emoticons/v2/<id>/default/dark/3.0`, 112 × 112 px) ;
  - une image du CDN Twitch, comme une photo de profil (`https://static-cdn.jtvnw.net/jtv_user_pictures/…`, 300 × 300 px) ;
  - un fichier livré avec l'extension (`assets/casino/…`).

  Un autre hébergeur demande d'abord de l'ajouter dans la console Twitch de l'extension.

- **Repli :** une image absente ou en erreur revient seule au dessin d'origine. Une case n'est jamais vide.

## 5. Dimensions

Tailles d'affichage mesurées le 19/11 dans la fenêtre réelle de 565 × 376 px :

| Endroit                     | Taille du symbole |
| --------------------------- | ----------------- |
| Rouleaux, joueur            | 59 × 59 px        |
| Rouleaux, spectateur        | 66 × 66 px        |
| Cases du Coffre             | 43 × 43 px        |
| Table des gains, historique | 25 × 25 px        |

**Recommandation :**

- une image carrée de **256 × 256 px**. Elle reste nette sur un écran haute densité et quand Twitch agrandit
  l'extension (plein écran) ;
- **112 × 112 px au minimum** : c'est la taille d'une émote Twitch, correcte jusqu'à environ 60 px affichés ;
- un dessin lisible à 25 px, car la table des gains l'affiche en petit : silhouette simple, contraste fort, peu de
  texte.

**Réglages fins par symbole :**

| Réglage | Rôle                                                     | Valeurs            |
| ------- | -------------------------------------------------------- | ------------------ |
| `fit`   | l'image entière (`contain`) ou la case remplie (`cover`) | `contain`, `cover` |
| `scale` | taille dans la case                                      | de 0,5 à 1,6       |
| `y`     | décalage vertical                                        | de −0,3 à 0,3      |

**Pour la photo de profil en BONUS :** une photo carrée ne garde pas d'elle-même la forme ronde de la pièce BONUS. Deux
options, à choisir au moment de l'intégration :

- une version déjà découpée en rond, sur fond transparent ;
- une petite option « image ronde », à ajouter.

Dans les deux cas, garder un repère visuel du bonus : l'anneau violet ou le mot BONUS.

## 6. Animations

- **Au repos** (`idle`), en boucle douce :

  | Valeur  | Effet            |
  | ------- | ---------------- |
  | `none`  | aucune           |
  | `bob`   | léger flottement |
  | `pulse` | légère pulsation |
  | `spin`  | rotation lente   |

  Une émote animée (GIF, WebP ou APNG animé) s'anime aussi d'elle-même.

- **À la victoire** (`win`), sur les cases gagnantes :

  | Valeur  | Effet                                |
  | ------- | ------------------------------------ |
  | `pop`   | rebond, l'effet actuel de la machine |
  | `shake` | secousse                             |
  | `glow`  | halo doré                            |

- **Conseil :** peu d'animations au repos. Quinze cases qui bougent en même temps fatiguent l'œil. Réserver le
  mouvement aux symboles rares (7, WILD, BONUS) ou à la victoire.

## 7. Prochaine étape

1. Antoni choisit les émotes ou images, symbole par symbole. Il peut garder certains fruits.
2. Pour chacune : la source (identifiant d'émote ou fichier), le cadrage, l'animation au repos et à la victoire.
3. L'intégration remplit `SKIN.symbols` dans `extension/shared/casino/skin.js`, puis vérifie la lisibilité aux quatre
   tailles du § 5 et le repli en cas d'image absente.

Aucune probabilité ne change.
