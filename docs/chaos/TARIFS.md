# Chaos V2 — tarifs par fourchettes (calculés, 26/11/2026) — À VALIDER PAR ANTONI AVANT TOUTE ACTIVATION

**Statut** : grille calculée à partir des fourchettes retenues par Antoni ; **aucun prix n'est actif** sur de vrais
comptes (module `chaos` désactivé par défaut, drapeau `CHAOS_EXTENSION` à `off`). Le Core applique exactement ce calcul
(portage de `catalog.js`, verrouillé par le test croisé `apps/twitch-extension/test/chaos-core-parity.test.js`) et
c'est son devis que l'extension affiche et que l'achat vérifie.

**Modifiable sans code ni redéploiement** : Studio › Chaos › **Tarifs** (minimum et maximum de chaque effet, aperçu
par préréglage, force et durée, « Par défaut » avec confirmation). Le Core vérifie (entiers, pas de 50, de 50 à
1 000 000, min ≤ max), enregistre dans les réglages de module de la chaîne (`chaos.price_<effet>_min|max`, aucune
migration), calcule chaque devis avec la fourchette en vigueur et revérifie le prix à l'achat (`price_changed`, rien
débité, sous le verrou de la chaîne). Les demandes déjà achetées gardent leur prix ; un remboursement rend ce qui a été
débité. Chaque modification est tracée dans le journal de modération (« Tarifs Chaos modifiés »). Les tableaux
ci-dessous sont ceux des **fourchettes par défaut**.

## Modèle

`prix = min + (max − min) × S`, arrondi à 50 Jetons, où :

- `S = (sévérité du réglage − sévérité la plus douce) / (sévérité la plus forte − sévérité la plus douce)` de l'effet
  (0 ≤ S ≤ 1, depuis le 26/11 au soir) : le **minimum** est exactement le prix du réglage le plus doux sur sa durée la
  plus courte (avant : `S = sévérité / sévérité maximale`, le minimum n'était jamais atteint, Écran retourné commençait
  à 35 850) ; les pondérations propres à chaque effet sont inchangées, l'ordre des réglages aussi ;
- `sévérité = gêne mesurée × facteur de durée` ; la gêne se calcule sur les **valeurs réelles** que le moteur appliquera
  (part de l'écran masquée, temps yeux fermés, amplitude, flou moyen, taille des pixels, axe changeant…), jamais sur le
  nom d'un préréglage ; facteur de durée `0,3 + 0,07 × s` (une part fixe par déclenchement + une part par seconde) ;
- le **maximum** n'est atteint qu'au réglage le plus sévère sur la durée la plus longue de l'effet (60 s, ou moins pour
  un effet court par nature) : jamais de plateau (30 s coûte toujours moins que 60 s, testé) ; plus long ne coûte
  jamais moins ; exceptions plates, voulues par le modèle de gêne : Zoom « Pulsations », « Zoom et dézoom »,
  « Intermittent » (le moteur joue le même nombre de pulsations, plus espacées) et Paupières « Somnolence » à 5 s et
  10 s (même gêne calculée) ;
- Flash, Impact et « Un clignement » ont des durées courtes par nature : ils se placent dans le bas de LEUR fourchette.

Les tableaux donnent le prix aux **réglages par défaut** de chaque préréglage / force ; pousser un contrôle (zoom ×6,
pixels 112 px, flou 95, alternance 2 s, fermeture 5 s…) monte le prix, jusqu'au maximum de la fourchette ; les réglages
fins les plus doux descendent jusqu'au minimum. Un crédit d'effet offert = 0 Jeton. Durées au-delà de 30 s : seulement
si la Sécurité de Studio est relevée à 60 s.

### Écran retourné — fourchette 25 000 à 100 000 (dès 25 000)

| Préréglage | Force | Durée min    | 10 s   | 30 s   | 60 s    | Durée max      |
| ---------- | ----- | ------------ | ------ | ------ | ------- | -------------- |
| 180°       | —     | 25 000 (5 s) | 31 800 | 59 100 | 100 000 | 100 000 (60 s) |

### Miroir — fourchette 15 000 à 75 000 (dès 15 000)

| Préréglage      | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| --------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Gauche ↔ droite | —     | 15 000 (5 s) | 17 900 | 29 550 | 46 950 | 46 950 (60 s) |
| Haut ↔ bas      | —     | 15 000 (5 s) | 17 900 | 29 550 | 46 950 | 46 950 (60 s) |
| Alternance      | —     | 17 700 (5 s) | 22 050 | 39 500 | 65 650 | 65 650 (60 s) |

### Tremblement — fourchette 5 000 à 35 000 (dès 5 000)

| Préréglage  | Force | Durée min   | 10 s   | 30 s   | 60 s   | Durée max     |
| ----------- | ----- | ----------- | ------ | ------ | ------ | ------------- |
| Léger       | —     | 5 400 (5 s) | 5 700  | 6 850  | 8 600  | 8 600 (60 s)  |
| Secousse    | —     | 7 000 (5 s) | 8 200  | 12 850 | 19 850 | 19 850 (60 s) |
| Vibration   | —     | 5 250 (5 s) | 5 450  | 6 250  | 7 550  | 7 550 (60 s)  |
| Par rafales | —     | 5 850 (5 s) | 6 350  | 8 500  | 11 650 | 11 650 (60 s) |
| Séisme      | —     | 9 200 (5 s) | 11 550 | 20 950 | 35 000 | 35 000 (60 s) |
| Impact      | —     | 6 400 (3 s) | —      | —      | —      | 6 400 (3 s)   |

### Zoom — fourchette 10 000 à 75 000 (dès 10 000)

| Préréglage     | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| -------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Progressif     | —     | 13 500 (5 s) | 17 650 | 34 250 | 59 150 | 59 150 (60 s) |
| Coup de zoom   | —     | 14 400 (5 s) | 19 050 | 37 650 | 65 600 | 65 600 (60 s) |
| Pulsations     | —     | 11 900 (5 s) | 11 900 | —      | —      | 11 900 (20 s) |
| Zoom et dézoom | —     | 14 100 (5 s) | 14 100 | —      | —      | 14 100 (15 s) |
| Intermittent   | —     | 12 150 (5 s) | 12 150 | —      | —      | 12 150 (20 s) |

### Ivresse — fourchette 10 000 à 75 000 (dès 10 000)

| Préréglage | Force   | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ---------- | ------- | ------------ | ------ | ------ | ------ | ------------- |
| Pompette   | Léger   | 10 850 (5 s) | 11 700 | 15 300 | 20 650 | 20 650 (60 s) |
| Pompette   | Marqué  | 12 250 (5 s) | 13 900 | 20 550 | 30 500 | 30 500 (60 s) |
| Pompette   | Extrême | 13 900 (5 s) | 16 450 | 26 650 | 41 950 | 41 950 (60 s) |
| Ivre       | Léger   | 10 950 (5 s) | 11 900 | 15 800 | 21 550 | 21 550 (60 s) |
| Ivre       | Marqué  | 12 500 (5 s) | 14 300 | 21 450 | 32 200 | 32 200 (60 s) |
| Ivre       | Extrême | 14 300 (5 s) | 17 050 | 28 050 | 44 600 | 44 600 (60 s) |
| Ivre mort  | Léger   | 12 500 (5 s) | 14 250 | 21 400 | 32 050 | 32 050 (60 s) |
| Ivre mort  | Marqué  | 15 300 (5 s) | 18 600 | 31 850 | 51 700 | 51 700 (60 s) |
| Ivre mort  | Extrême | 18 600 (5 s) | 23 700 | 44 050 | 74 600 | 74 600 (60 s) |
| Vertige    | Léger   | 12 500 (5 s) | 14 300 | 21 450 | 32 200 | 32 200 (60 s) |
| Vertige    | Marqué  | 15 350 (5 s) | 18 700 | 32 000 | 51 950 | 51 950 (60 s) |
| Vertige    | Extrême | 18 700 (5 s) | 23 800 | 44 300 | 75 000 | 75 000 (60 s) |

### Vision tunnel — fourchette 10 000 à 75 000 (dès 10 000)

| Préréglage | Force   | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ---------- | ------- | ------------ | ------ | ------ | ------ | ------------- |
| —          | Léger   | 10 550 (5 s) | 13 050 | 23 100 | 38 200 | 38 200 (60 s) |
| —          | Marqué  | 14 650 (5 s) | 19 400 | 38 300 | 66 650 | 66 650 (60 s) |
| —          | Extrême | 15 850 (5 s) | 21 200 | 42 700 | 74 950 | 74 950 (60 s) |

### Paupières — fourchette 5 000 à 90 000 (dès 5 000)

| Préréglage              | Force        | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ----------------------- | ------------ | ------------ | ------ | ------ | ------ | ------------- |
| Naturel                 | Mi-closes    | 5 550 (5 s)  | 5 950  | 8 150  | 11 600 | 11 600 (60 s) |
| Naturel                 | Presque      | 6 300 (5 s)  | 6 900  | 10 300 | 15 650 | 15 650 (60 s) |
| Naturel                 | Complètement | 6 700 (5 s)  | 7 400  | 11 350 | 17 650 | 17 650 (60 s) |
| Un clignement           | Mi-closes    | 5 850 (2 s)  | —      | —      | —      | fixe          |
| Un clignement           | Presque      | 6 800 (2 s)  | —      | —      | —      | fixe          |
| Un clignement           | Complètement | 7 250 (2 s)  | —      | —      | —      | fixe          |
| Répétés                 | Mi-closes    | 5 850 (5 s)  | 6 800  | 10 400 | 15 800 | 15 800 (60 s) |
| Répétés                 | Presque      | 6 800 (5 s)  | 8 200  | 13 750 | 22 100 | 22 100 (60 s) |
| Répétés                 | Complètement | 7 250 (5 s)  | 8 900  | 15 450 | 25 300 | 25 300 (60 s) |
| Lent                    | Mi-closes    | 7 200 (5 s)  | 7 650  | 12 550 | 18 950 | 18 950 (60 s) |
| Lent                    | Presque      | 8 850 (5 s)  | 9 550  | 17 100 | 27 050 | 27 050 (60 s) |
| Lent                    | Complètement | 9 700 (5 s)  | 10 500 | 19 350 | 31 050 | 31 050 (60 s) |
| Somnolence              | Mi-closes    | 13 000 (5 s) | 13 000 | 16 650 | 23 500 | 23 500 (60 s) |
| Somnolence              | Presque      | 17 800 (5 s) | 17 800 | 23 450 | 34 050 | 34 050 (60 s) |
| Somnolence              | Complètement | 20 200 (5 s) | 20 200 | 26 850 | 39 300 | 39 300 (60 s) |
| Lutte contre le sommeil | Mi-closes    | 10 800 (5 s) | 14 350 | 28 600 | 49 950 | 49 950 (60 s) |
| Lutte contre le sommeil | Presque      | 14 400 (5 s) | 19 900 | 41 900 | 74 850 | 74 850 (60 s) |
| Lutte contre le sommeil | Complètement | 16 200 (5 s) | 22 650 | 48 550 | 87 350 | 87 350 (60 s) |
| Yeux fermés             | Mi-closes    | 10 200 (3 s) | 17 200 | —      | —      | 22 000 (15 s) |
| Yeux fermés             | Presque      | 13 450 (3 s) | 24 300 | —      | —      | 31 700 (15 s) |
| Yeux fermés             | Complètement | 15 100 (3 s) | 27 850 | —      | —      | 36 550 (15 s) |

### Flash — fourchette 8 000 à 25 000 (dès 8 000)

| Préréglage       | Force | Durée min    | 10 s | 30 s | 60 s | Durée max    |
| ---------------- | ----- | ------------ | ---- | ---- | ---- | ------------ |
| Court            | —     | 8 000 (3 s)  | —    | —    | —    | 9 700 (9 s)  |
| Intense          | —     | 13 050 (3 s) | —    | —    | —    | 18 850 (9 s) |
| Rémanence longue | —     | 16 400 (3 s) | —    | —    | —    | 25 000 (9 s) |

### Brouillard — fourchette 15 000 à 100 000 (dès 15 000)

| Préréglage | Force     | Durée min     | 10 s   | 30 s   | 60 s    | Durée max      |
| ---------- | --------- | ------------- | ------ | ------ | ------- | -------------- |
| Nappes     | Marqué    | 15 000 (10 s) | 15 000 | 26 000 | 42 450  | 42 450 (60 s)  |
| Nappes     | Dense     | 20 900 (10 s) | 20 900 | 40 150 | 69 000  | 69 000 (60 s)  |
| Nappes     | Occultant | 27 800 (10 s) | 27 800 | 56 650 | 100 000 | 100 000 (60 s) |

### Flou — fourchette 15 000 à 100 000 (dès 15 000)

| Préréglage | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ---------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Constant   | —     | 21 200 (5 s) | 25 100 | 40 550 | 63 800 | 63 800 (60 s) |
| Pulsé      | —     | 18 600 (5 s) | 21 050 | 30 900 | 45 700 | 45 700 (60 s) |
| Progressif | —     | 17 600 (5 s) | 19 550 | 27 300 | 38 900 | 38 900 (60 s) |
| Vague      | —     | 18 250 (5 s) | 20 550 | 29 700 | 43 450 | 43 450 (60 s) |

### Pixelisation — fourchette 15 000 à 100 000 (dès 15 000)

| Préréglage    | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Constante     | —     | 19 650 (5 s) | 23 050 | 36 500 | 56 700 | 56 700 (60 s) |
| Progressive   | —     | 16 850 (5 s) | 18 700 | 26 100 | 37 200 | 37 200 (60 s) |
| Intermittente | —     | 16 850 (5 s) | 18 700 | 26 100 | 37 200 | 37 200 (60 s) |

### Couleur — fourchette 8 000 à 25 000 (dès 8 000)

| Préréglage    | Force | Durée min   | 10 s   | 30 s   | 60 s   | Durée max     |
| ------------- | ----- | ----------- | ------ | ------ | ------ | ------------- |
| Noir et blanc | —     | 8 850 (5 s) | 9 800  | 13 500 | 19 050 | 19 050 (60 s) |
| Film noir     | —     | 9 200 (5 s) | 10 300 | 14 750 | 21 450 | 21 450 (60 s) |
| Sépia         | —     | 8 700 (5 s) | 9 500  | 12 850 | 17 850 | 17 850 (60 s) |
| Négatif       | —     | 9 700 (5 s) | 11 100 | 16 650 | 25 000 | 25 000 (60 s) |
| Délavé        | —     | 8 150 (5 s) | 8 750  | 10 950 | 14 300 | 14 300 (60 s) |
| Saturé        | —     | 8 250 (5 s) | 8 850  | 11 250 | 14 900 | 14 900 (60 s) |
| Monochrome    | —     | 8 850 (5 s) | 9 800  | 13 500 | 19 050 | 19 050 (60 s) |

### VHS / glitch — fourchette 5 000 à 25 000 (dès 5 000)

| Préréglage        | Force | Durée min   | 10 s  | 30 s   | 60 s   | Durée max     |
| ----------------- | ----- | ----------- | ----- | ------ | ------ | ------------- |
| VHS légère        | —     | 5 000 (5 s) | 5 400 | 6 900  | 9 150  | 9 150 (60 s)  |
| VHS abîmée        | —     | 6 200 (5 s) | 7 200 | 11 250 | 17 350 | 17 350 (60 s) |
| Tracking instable | —     | 6 200 (5 s) | 7 250 | 11 400 | 17 600 | 17 600 (60 s) |
| Glitch bref       | —     | 5 600 (5 s) | 6 300 | 9 100  | 13 300 | 13 300 (60 s) |
| Glitch violent    | —     | 7 300 (5 s) | 8 900 | 15 350 | 25 000 | 25 000 (60 s) |
