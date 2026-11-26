# Chaos V2 — tarifs par fourchettes (calculés, 26/11/2026) — À VALIDER PAR ANTONI AVANT TOUTE ACTIVATION

**Statut** : grille calculée à partir des fourchettes retenues par Antoni ; **aucun prix n'est actif** sur de vrais
comptes (module `chaos` désactivé par défaut, drapeau `CHAOS_EXTENSION` à `off`). Le Core applique exactement ce calcul
(portage de `catalog.js`, verrouillé par le test croisé `apps/twitch-extension/test/chaos-core-parity.test.js`) et
c'est son devis que l'extension affiche et que l'achat vérifie.

## Modèle

`prix = min + (max − min) × S`, arrondi à 50 Jetons, où :

- `S = sévérité du réglage / sévérité du réglage le plus sévère de l'effet` (0 < S ≤ 1) ;
- `sévérité = gêne mesurée × facteur de durée` ; la gêne se calcule sur les **valeurs réelles** que le moteur appliquera
  (part de l'écran masquée, temps yeux fermés, amplitude, flou moyen, taille des pixels, axe changeant…), jamais sur le
  nom d'un préréglage ; facteur de durée `0,3 + 0,07 × s` (une part fixe par déclenchement + une part par seconde) ;
- le **maximum** n'est atteint qu'au réglage le plus sévère sur la durée la plus longue de l'effet (60 s, ou moins pour
  un effet court par nature) : jamais de plateau (30 s coûte toujours moins que 60 s, testé) ;
- Flash, Impact et « Un clignement » ont des durées courtes par nature : ils se placent dans le bas de LEUR fourchette.

Les tableaux donnent le prix aux **réglages par défaut** de chaque préréglage / force ; pousser un contrôle (zoom ×6,
pixels 112 px, flou 95, alternance 2 s, fermeture 5 s…) monte le prix, jusqu'au maximum de la fourchette. Un crédit
d'effet offert = 0 Jeton. Durées au-delà de 30 s : seulement si la Sécurité de Studio est relevée à 60 s.

### Écran retourné — fourchette 25 000 à 100 000 (dès 35 850)

| Préréglage | Force | Durée min    | 10 s   | 30 s   | 60 s    | Durée max      |
| ---------- | ----- | ------------ | ------ | ------ | ------- | -------------- |
| 180°       | —     | 35 850 (5 s) | 41 650 | 65 000 | 100 000 | 100 000 (60 s) |

### Miroir — fourchette 15 000 à 75 000 (dès 19 950)

| Préréglage      | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| --------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Gauche ↔ droite | —     | 19 950 (5 s) | 22 600 | 33 300 | 49 300 | 49 300 (60 s) |
| Haut ↔ bas      | —     | 19 950 (5 s) | 22 600 | 33 300 | 49 300 | 49 300 (60 s) |
| Alternance      | —     | 22 450 (5 s) | 26 450 | 42 450 | 66 450 | 66 450 (60 s) |

### Tremblement — fourchette 5 000 à 35 000 (dès 5 150)

| Préréglage  | Force | Durée min   | 10 s   | 30 s   | 60 s   | Durée max     |
| ----------- | ----- | ----------- | ------ | ------ | ------ | ------------- |
| Léger       | —     | 5 550 (5 s) | 5 850  | 7 000  | 8 750  | 8 750 (60 s)  |
| Secousse    | —     | 7 150 (5 s) | 8 300  | 12 950 | 19 950 | 19 950 (60 s) |
| Vibration   | —     | 5 400 (5 s) | 5 600  | 6 400  | 7 650  | 7 650 (60 s)  |
| Par rafales | —     | 6 000 (5 s) | 6 500  | 8 600  | 11 800 | 11 800 (60 s) |
| Séisme      | —     | 9 350 (5 s) | 11 650 | 21 000 | 35 000 | 35 000 (60 s) |
| Impact      | —     | 6 550 (3 s) | —      | —      | —      | 6 550 (3 s)   |

### Zoom — fourchette 10 000 à 75 000 (dès 14 000)

| Préréglage     | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| -------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Progressif     | —     | 17 250 (5 s) | 21 150 | 36 750 | 60 150 | 60 150 (60 s) |
| Coup de zoom   | —     | 18 100 (5 s) | 22 500 | 39 950 | 66 150 | 66 150 (60 s) |
| Pulsations     | —     | 15 750 (5 s) | 15 750 | —      | —      | 15 750 (20 s) |
| Zoom et dézoom | —     | 17 850 (5 s) | 17 850 | —      | —      | 17 850 (15 s) |
| Intermittent   | —     | 16 000 (5 s) | 16 000 | —      | —      | 16 000 (20 s) |

### Ivresse — fourchette 10 000 à 75 000 (dès 11 650)

| Préréglage | Force   | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ---------- | ------- | ------------ | ------ | ------ | ------ | ------------- |
| Pompette   | Léger   | 11 650 (5 s) | 12 500 | 16 050 | 21 350 | 21 350 (60 s) |
| Pompette   | Marqué  | 13 050 (5 s) | 14 700 | 21 200 | 31 050 | 31 050 (60 s) |
| Pompette   | Extrême | 14 700 (5 s) | 17 200 | 27 250 | 42 400 | 42 400 (60 s) |
| Ivre       | Léger   | 11 750 (5 s) | 12 700 | 16 550 | 22 250 | 22 250 (60 s) |
| Ivre       | Marqué  | 13 300 (5 s) | 15 050 | 22 100 | 32 700 | 32 700 (60 s) |
| Ivre       | Extrême | 15 050 (5 s) | 17 750 | 28 650 | 44 950 | 44 950 (60 s) |
| Ivre mort  | Léger   | 13 250 (5 s) | 15 000 | 22 050 | 32 600 | 32 600 (60 s) |
| Ivre mort  | Marqué  | 16 050 (5 s) | 19 350 | 32 400 | 52 000 | 52 000 (60 s) |
| Ivre mort  | Extrême | 19 350 (5 s) | 24 350 | 44 450 | 74 600 | 74 600 (60 s) |
| Vertige    | Léger   | 13 300 (5 s) | 15 050 | 22 150 | 32 750 | 32 750 (60 s) |
| Vertige    | Marqué  | 16 100 (5 s) | 19 400 | 32 550 | 52 250 | 52 250 (60 s) |
| Vertige    | Extrême | 19 400 (5 s) | 24 450 | 44 650 | 75 000 | 75 000 (60 s) |

### Vision tunnel — fourchette 10 000 à 75 000 (dès 13 900)

| Préréglage | Force   | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ---------- | ------- | ------------ | ------ | ------ | ------ | ------------- |
| —          | Léger   | 14 400 (5 s) | 16 750 | 26 200 | 40 400 | 40 400 (60 s) |
| —          | Marqué  | 18 250 (5 s) | 22 700 | 40 450 | 67 150 | 67 150 (60 s) |
| —          | Extrême | 19 400 (5 s) | 24 450 | 44 650 | 74 950 | 74 950 (60 s) |

### Paupières — fourchette 5 000 à 90 000 (dès 5 800)

| Préréglage              | Force        | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ----------------------- | ------------ | ------------ | ------ | ------ | ------ | ------------- |
| Naturel                 | Mi-closes    | 6 350 (5 s)  | 6 750  | 8 900  | 12 350 | 12 350 (60 s) |
| Naturel                 | Presque      | 7 100 (5 s)  | 7 700  | 11 050 | 16 350 | 16 350 (60 s) |
| Naturel                 | Complètement | 7 450 (5 s)  | 8 150  | 12 100 | 18 300 | 18 300 (60 s) |
| Un clignement           | Mi-closes    | 6 650 (2 s)  | —      | —      | —      | fixe          |
| Un clignement           | Presque      | 7 550 (2 s)  | —      | —      | —      | fixe          |
| Un clignement           | Complètement | 8 000 (2 s)  | —      | —      | —      | fixe          |
| Répétés                 | Mi-closes    | 6 650 (5 s)  | 7 550  | 11 150 | 16 500 | 16 500 (60 s) |
| Répétés                 | Presque      | 7 550 (5 s)  | 8 950  | 14 450 | 22 750 | 22 750 (60 s) |
| Répétés                 | Complètement | 8 000 (5 s)  | 9 650  | 16 150 | 25 900 | 25 900 (60 s) |
| Lent                    | Mi-closes    | 8 000 (5 s)  | 8 450  | 13 250 | 19 650 | 19 650 (60 s) |
| Lent                    | Presque      | 9 600 (5 s)  | 10 300 | 17 750 | 27 600 | 27 600 (60 s) |
| Lent                    | Complètement | 10 450 (5 s) | 11 250 | 20 000 | 31 600 | 31 600 (60 s) |
| Somnolence              | Mi-closes    | 13 700 (5 s) | 13 700 | 17 350 | 24 150 | 24 150 (60 s) |
| Somnolence              | Presque      | 18 500 (5 s) | 18 500 | 24 100 | 34 550 | 34 550 (60 s) |
| Somnolence              | Complètement | 20 850 (5 s) | 20 850 | 27 450 | 39 800 | 39 800 (60 s) |
| Lutte contre le sommeil | Mi-closes    | 11 550 (5 s) | 15 050 | 29 150 | 50 300 | 50 300 (60 s) |
| Lutte contre le sommeil | Presque      | 15 100 (5 s) | 20 550 | 42 350 | 75 000 | 75 000 (60 s) |
| Lutte contre le sommeil | Complètement | 16 900 (5 s) | 23 300 | 48 950 | 87 350 | 87 350 (60 s) |
| Yeux fermés             | Mi-closes    | 10 950 (3 s) | 17 900 | —      | —      | 22 650 (15 s) |
| Yeux fermés             | Presque      | 14 150 (3 s) | 24 900 | —      | —      | 32 250 (15 s) |
| Yeux fermés             | Complètement | 15 800 (3 s) | 28 450 | —      | —      | 37 050 (15 s) |

### Flash — fourchette 8 000 à 25 000 (dès 9 850)

| Préréglage       | Force | Durée min    | 10 s | 30 s | 60 s | Durée max    |
| ---------------- | ----- | ------------ | ---- | ---- | ---- | ------------ |
| Court            | —     | 9 850 (3 s)  | —    | —    | —    | 11 350 (9 s) |
| Intense          | —     | 14 350 (3 s) | —    | —    | —    | 19 550 (9 s) |
| Rémanence longue | —     | 17 300 (3 s) | —    | —    | —    | 25 000 (9 s) |

### Brouillard — fourchette 15 000 à 100 000 (dès 22 200)

| Préréglage | Force     | Durée min     | 10 s   | 30 s   | 60 s    | Durée max      |
| ---------- | --------- | ------------- | ------ | ------ | ------- | -------------- |
| Nappes     | Marqué    | 22 200 (10 s) | 22 200 | 32 250 | 47 300  | 47 300 (60 s)  |
| Nappes     | Dense     | 27 600 (10 s) | 27 600 | 45 200 | 71 650  | 71 650 (60 s)  |
| Nappes     | Occultant | 33 900 (10 s) | 33 900 | 60 350 | 100 000 | 100 000 (60 s) |

### Flou — fourchette 15 000 à 100 000 (dès 15 950)

| Préréglage | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ---------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Constant   | —     | 22 100 (5 s) | 25 950 | 41 250 | 64 200 | 64 200 (60 s) |
| Pulsé      | —     | 19 500 (5 s) | 21 950 | 31 700 | 46 300 | 46 300 (60 s) |
| Progressif | —     | 18 550 (5 s) | 20 450 | 28 100 | 39 600 | 39 600 (60 s) |
| Vague      | —     | 19 200 (5 s) | 21 450 | 30 500 | 44 100 | 44 100 (60 s) |

### Pixelisation — fourchette 15 000 à 100 000 (dès 16 550)

| Préréglage    | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Constante     | —     | 21 150 (5 s) | 24 450 | 37 650 | 57 500 | 57 500 (60 s) |
| Progressive   | —     | 18 400 (5 s) | 20 200 | 27 450 | 38 400 | 38 400 (60 s) |
| Intermittente | —     | 18 400 (5 s) | 20 200 | 27 450 | 38 400 | 38 400 (60 s) |

### Couleur — fourchette 8 000 à 25 000 (dès 8 800)

| Préréglage    | Force | Durée min    | 10 s   | 30 s   | 60 s   | Durée max     |
| ------------- | ----- | ------------ | ------ | ------ | ------ | ------------- |
| Noir et blanc | —     | 9 650 (5 s)  | 10 500 | 14 050 | 19 350 | 19 350 (60 s) |
| Film noir     | —     | 9 950 (5 s)  | 11 000 | 15 250 | 21 600 | 21 600 (60 s) |
| Sépia         | —     | 9 450 (5 s)  | 10 250 | 13 450 | 18 200 | 18 200 (60 s) |
| Négatif       | —     | 10 450 (5 s) | 11 800 | 17 050 | 25 000 | 25 000 (60 s) |
| Délavé        | —     | 9 000 (5 s)  | 9 500  | 11 650 | 14 800 | 14 800 (60 s) |
| Saturé        | —     | 9 050 (5 s)  | 9 650  | 11 950 | 15 350 | 15 350 (60 s) |
| Monochrome    | —     | 9 650 (5 s)  | 10 500 | 14 050 | 19 350 | 19 350 (60 s) |

### VHS / glitch — fourchette 5 000 à 25 000 (dès 5 700)

| Préréglage        | Force | Durée min   | 10 s  | 30 s   | 60 s   | Durée max     |
| ----------------- | ----- | ----------- | ----- | ------ | ------ | ------------- |
| VHS légère        | —     | 5 700 (5 s) | 6 050 | 7 500  | 9 700  | 9 700 (60 s)  |
| VHS abîmée        | —     | 6 800 (5 s) | 7 800 | 11 700 | 17 600 | 17 600 (60 s) |
| Tracking instable | —     | 6 850 (5 s) | 7 850 | 11 850 | 17 850 | 17 850 (60 s) |
| Glitch bref       | —     | 6 250 (5 s) | 6 950 | 9 650  | 13 700 | 13 700 (60 s) |
| Glitch violent    | —     | 7 900 (5 s) | 9 450 | 15 650 | 25 000 | 25 000 (60 s) |
