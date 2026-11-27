# Chaos V2 — proposition de tarifs (28/11/2026, à décider par Antoni)

**Statut** : proposition, **aucun prix de Production** (Chaos n'est pas branché aux Jetons). Testable dans la maquette :
panneau **Lab › Tarifs › Proposition 28/11**, ou `?ixPrices=proposee`, ou le bouton « Tarifs » de la page d'aperçu.
Formule inchangée (spec [EXTENSION_INTERACTIONS.md](EXTENSION_INTERACTIONS.md) § 6) :
`prix = base de l'effet × gêne mesurée du réglage × durée (0,3 + 0,07 × s)`, arrondi à 50, jamais moins de 50.

## 1. L'économie réelle (code du Core, `loyalty/config.ts`, `daily/config.ts`)

| Source                     | Gain                                                        |
| -------------------------- | ----------------------------------------------------------- |
| Présence (sans abonnement) | 10 Jetons toutes les 6 min = **100 / h**                    |
| Présence (abonné)          | **200 / h**                                                 |
| Daily                      | 500 → 2 000 par live selon la série (2 000 dès le 10e live) |
| Follow                     | 500 (une fois)                                              |
| Abonnement T1 / T2 / T3    | 2 000 / 4 000 / 10 000                                      |
| Bits / tips                | ~7 à 10 Jetons par bit, 500 à 700 par euro                  |

Un habitué (live de 3 h, série en cours) gagne **~2 300 Jetons par live** sans abonnement, **~2 600 abonné**, soit
~9 000 à 10 500 par semaine de 4 lives. Il existe aussi de très gros soldes (7 comptes au-delà d'un million).

Dépenses existantes : Bonk 200 · son 500 (2 000 premium) · !fxcam 1 500 · TTS 7 500 à 37 500 · Random Ban 20 000 ·
passage de musique 25 000 · caution 1 000 / min.

## 2. Principe de la proposition

- **Trois niveaux** selon la gêne réelle : léger (ambiance) ≈ un ou deux lives d'économies ; moyen (gêne le jeu) ≈ une
  semaine ; fort (prend la main sur le jeu) ≈ deux à quatre semaines pour un habitué, une dépense nette même pour un gros
  solde.
- Les effets **forts** (Écran retourné, Miroir, Yeux fermés, Brouillard occultant, Ivresse extrême) coûtent 2,5 à 3 × la
  maquette ; les **moyens** 2 × ; les **légers** 1,3 à 1,5 × : il reste toujours des effets à 1 500–3 000.
- La fréquence reste tenue par les règles (une minute par viewer et par effet, file de 3, une demande en attente,
  charges du clignement), pas par le prix.

Bases proposées (10 s, réglage de référence) : Couleur 3 000 · VHS 4 000 · Tremblement 6 000 · Zoom, Flou, Pixelisation
10 000 · Ivresse, Brouillard 12 000 · Vision tunnel 14 000 · Flash 20 000 · Miroir 25 000 · Écran retourné 35 000 ·
Paupières 40 000 (référence : yeux fermés tout du long).

## 3. Grille (calculée par la maquette, mêmes réglages qu'à l'écran)

| Effet          | Réglage                         | Maquette 10 s | **Proposé 10 s** | Proposé 30 s | Proposé 60 s |
| -------------- | ------------------------------- | ------------- | ---------------- | ------------ | ------------ |
| Couleur        | Noir et blanc                   | 2 000         | **3 000**        | 7 200        | 13 500       |
| Couleur        | Négatif                         | 3 000         | **4 500**        | 10 800       | 20 250       |
| VHS / glitch   | VHS légère                      | 1 100         | **1 500**        | 3 600        | 6 750        |
| VHS / glitch   | Glitch violent                  | 4 750         | **6 350**        | 15 250       | 28 550       |
| Tremblement    | Léger                           | 1 000         | **1 500**        | 3 600        | 6 750        |
| Tremblement    | Secousse                        | 4 000         | **6 000**        | 14 400       | 27 000       |
| Tremblement    | Séisme                          | 8 050         | **12 050**       | 28 950       | 54 250       |
| Tremblement    | Impact (3 s)                    | 1 850         | **2 750** (3 s)  | —            | —            |
| Zoom           | Progressif ×2                   | 5 000         | **10 000**       | 24 000       | 45 000       |
| Zoom           | Progressif ×4                   | 6 250         | **12 500**       | 30 000       | 56 250       |
| Flou           | Marqué · 55                     | 5 000         | **10 000**       | 24 000       | 45 000       |
| Flou           | Illisible · 95                  | 8 650         | **17 250**       | 41 450       | 77 750       |
| Pixelisation   | 28 px                           | 5 000         | **10 000**       | 24 000       | 45 000       |
| Pixelisation   | 80 px                           | 8 450         | **16 900**       | 40 550       | 76 050       |
| Ivresse        | Ivre                            | 6 000         | **12 000**       | 28 800       | 54 000       |
| Ivresse        | Ivre mort, extrême              | 17 050        | **34 100**       | 81 850       | 153 500      |
| Brouillard     | Marqué                          | 6 000         | **12 000**       | 28 800       | 54 000       |
| Brouillard     | Dense                           | 10 500        | **21 000**       | 50 450       | 94 600       |
| Brouillard     | Occultant                       | 15 800        | **31 550**       | 75 750       | 142 000      |
| Vision tunnel  | Marqué                          | 7 000         | **14 000**       | 33 600       | 63 000       |
| Vision tunnel  | Extrême                         | 7 950         | **15 900**       | 38 200       | 71 600       |
| Flash          | Court (3 s)                     | 1 100         | **2 950** (3 s)  | —            | —            |
| Flash          | Intense (6 s)                   | 5 400         | **14 400** (6 s) | —            | —            |
| Miroir         | Gauche ↔ droite                 | 9 000         | **25 000**       | 60 000       | 112 500      |
| Miroir         | Alternance 2 s                  | 15 750        | **43 750**       | 105 000      | 196 900      |
| Écran retourné | 180°                            | 12 000        | **35 000**       | 84 000       | 157 500      |
| Paupières      | Un clignement (2 s, une charge) | 1 700         | **4 950**        | —            | —            |
| Paupières      | Naturel                         | 1 800         | **5 200**        | 11 650       | 21 850       |
| Paupières      | Yeux fermés (5 s)               | 8 350         | **23 900**       | —            | —            |

« dès » sur les cartes (le moins cher atteignable) : Tremblement 300, VHS 950, Flou 900, Couleur 1 000, Paupières 1 300,
Pixelisation 1 650, Flash 2 950, Zoom 3 550, Ivresse 3 900, Tunnel 4 300, Brouillard 12 000, Miroir 16 250, Écran
retourné 22 750.

## 4. Scénarios

| Profil                                            | Gains             | Ce que la grille proposée lui permet                                                                                                                                                 |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Occasionnel** (non abonné, 1 live par semaine)  | ~2 300 / live     | un effet léger par live (Couleur, Secousse légère, VHS) ou un moyen par mois (Flou, Zoom 10 s)                                                                                       |
| **Régulier** (abonné, 4 lives par semaine, série) | ~10 000 / semaine | un moyen chaque semaine (Brouillard marqué, Tunnel, Ivresse), un fort par mois (Écran retourné 10 s = 3,5 semaines) ; un rafale de 10 clignements ≈ 5 semaines                       |
| **Stream très actif / gros solde** (≥ 1 million)  | —                 | un fort quand il veut (≈ 28 Écrans retournés pour 1 million) : ce sont les règles (1 min par effet, file de 3, une demande en attente, charges) qui limitent la cadence, pas le prix |

## 5. Points à trancher

1. Les bases (surtout Écran retourné 35 000, Miroir 25 000, Paupières 40 000) ; garder ou non des entrées à 300–1 500.
2. La part fixe de la durée (60 s = × 4,5) : plus forte si les effets longs doivent rester rares.
3. Un prix du clignement unique (≈ 5 000) cohérent avec 10 charges (une rafale complète ≈ 50 000) ?
4. Réduction abonnés ou prix en points de chaîne : non proposé ici (le Core ne le prévoit pas encore pour Chaos).
