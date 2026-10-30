# Level Up V2 — niveaux à 1 000 XP, normalisation WizeBot, annonces par viewer

**État (30/10/2026)** : développé et testé (Lab de bout en bout, PostgreSQL réel), **rien n'est actif en Production**.
La Production reste au premier modèle (courbe) jusqu'à l'activation après Halloween (§ 7).

## 1. Données réelles (relevé du 29/10/2026 21:20 UTC, sauvegarde vérifiée)

7 852 historiques WizeBot (1 622 rattachés, 6 228 en attente, 2 conflits), **niveau max 135**, 75 niveaux distincts.

| Niveau WizeBot | 1     | 2–5 | 6–10 | 11–20 | 21–40 | 41–60 | 61–100 | 101–135 |
| -------------- | ----- | --- | ---- | ----- | ----- | ----- | ------ | ------- |
| Tous           | 6 488 | 944 | 214  | 96    | 53    | 26    | 22     | 9       |
| Rattachés      | 712   | 547 | 178  | 81    | 49    | 24    | 22     | 9       |
| En attente     | 5 775 | 396 | 36   | 15    | 4     | 2     | 0      | 0       |

Aucune XP native n'avait encore été gagnée (pas de live depuis l'activation de la progression). Le Core montre les
niveaux de l'ancienne courbe (`60 × (L − 1)^1,6`).

## 2. Compression choisie : exposant 0,7 (interpolation entre les deux méthodes demandées)

`nouveau = max(1, floor(1 + 49 × ((L − 1) / (max − 1))^e))`, `max` = 135 figé ; `max = 1` → 1.

| Méthode (sur les 7 852)   | 1–10  | 11–20 | 21–30 | 31–40 | 41–50 | Niveaux > 1 tombés à 1 | Niveaux distincts |
| ------------------------- | ----- | ----- | ----- | ----- | ----- | ---------------------- | ----------------- |
| Proportionnelle (e = 1)   | 7 776 | 42    | 20    | 7     | 7     | **716**                | 39                |
| Adoucie (racine, e = 0,5) | 7 488 | 272   | 54    | 27    | 11    | 0                      | 41                |
| **Retenue (e = 0,7)**     | 7 697 | 96    | 33    | 17    | 9     | **0**                  | **43**            |

Exemples (ancien → nouveau) : proportionnelle 2→1, 3→1, 10→4, 50→18 ; racine 2→5, 3→6, 10→13, 50→30 ;
**retenue 2→2, 3→3, 5→5, 10→8, 20→13, 50→25, 74→33, 100→40, 121→46, 135→50**.

Pourquoi 0,7 :

- la proportionnelle écrase 716 viewers au niveau 1 (2 et 3 → 1) : perte de distinction et sensation de régression ;
- la racine gonfle les petits niveaux (un niveau 2 devient 5) : progression faussée et classement des débutants
  déformé ;
- 0,7 garde les niveaux 1 à 5 identiques, n'écrase personne, utilise le plus de niveaux distincts (43), répartit le
  haut du classement de 31 à 50 (de quoi accrocher des titres / badges à 10, 20, 30, 40, 50) ; elle est monotone
  (jamais un viewer mieux classé derrière un autre).

## 3. Modèle de progression

- **Niveau = 1 + floor(XP / 1 000)** ; le reste est conservé ; plusieurs niveaux d'un coup sont gérés (une seule annonce,
  le niveau final).
- Présence 1 XP / minute validée ; message éligible 5 XP, au plus un toutes les 60 s ; les messages comptent dans les
  statistiques même sans XP (commandes comprises).
- Les niveaux montent sans plafond (51, 52…).
- Une fois activé, la courbe n'est plus un réglage (le Core refuse de la changer) : un niveau atteint ne baisse jamais à
  cause d'un réglage.
- Classement global : XP, puis le niveau WizeBot d'origine pour départager deux XP égales, puis l'identifiant.

## 4. Normalisation (une seule fois, `POST …/progression/level-v2/activate`, phrase « NORMALISER LES NIVEAUX »)

- Historique rattaché : **XP = 1 000 × (niveau normalisé − 1) + XP native** (gagnée ou ajustée depuis : jamais perdue).
- Compte sans historique : son XP est gardée, son niveau se lit sur la nouvelle échelle.
- Chaque compte : une ligne d'audit `progression_normalizations` (niveau WizeBot, niveau et XP avant, XP native,
  niveau et XP après, date, version) et un mouvement `normalization` au registre (jamais dans Semaine / Mois, jamais
  annoncé).
- Les paramètres (exposant 0,7, max 135, cible 50, courbe d'avant) sont figés dans les règles : un historique rattaché
  des mois plus tard prend exactement le même niveau.
- Une seconde activation est refusée (`already_applied`) : jamais abaissé deux fois. L'annulation (« ANNULER LA
  NORMALISATION ») remet XP et courbe d'avant tant qu'aucun historique n'a été rattaché depuis.
- Les archives (`progression_history`) ne sont jamais modifiées ; les 2 conflits restent en attente.

## 5. Annonces de Level Up

- Un **vrai** passage de niveau (présence, chat) crée un événement `progression_level_events` (une fois par mouvement :
  un rejeu n'en crée pas un second). Import, normalisation, rattachement, ajustement Studio : jamais d'annonce.
- Mode du viewer, choisi dans l'extension (préférence persistante du Core, **Désactivé par défaut**) : Désactivé (rien),
  Écrit (annonce sans son), Sonore (annonce + son court). L'ancien interrupteur de l'extension est lu (activé = Sonore).
- Interrupteur général (Studio, coupé par défaut) ; délai entre deux sons pour toute la chaîne (5 min par défaut : une
  annonce dans le délai s'affiche sans son) ; une annonce non affichée en 2 min est abandonnée ; plusieurs niveaux d'un
  viewer en attente : une seule annonce.
- Affichage : une **source OBS à part** servie par Studio (`/level-up/player.html#<jeton>`), sans toucher aux alertes,
  au lecteur d'effets ni à l'overlay Halloween. Studio ne demande rien au Core sans source connectée. Son : carillon
  d'environ 2,4 s créé par Studio, ou le fichier `level-up/sound.mp3|ogg|wav` du dossier de Studio ; volume dans Studio.

## 6. Studio (Progression)

Carte « Level Up V2 » : modèle actuel, distribution réelle, comparaison des trois compressions, activation / annulation
(phrase tapée). Carte « Annonces » : interrupteur, délai entre sons, fraîcheur. Carte « Source OBS » : URL, volume,
tests écrit / sonore. « Derniers Level Up » : statut de chaque annonce et pourquoi. Un viewer : son mode, la provenance
de son niveau (audit), le journal (normalisation comprise). Ajustements manuels et leur journal inchangés.

## 7. Activation après Halloween (sur GO d'Antoni)

1. Sauvegarde Coolify + restauration vérifiée (comme le 29/10).
2. Fusion de la PR, CI verte, déploiement du Core : migration `20261115130000_progression_level_up.sql` (additive ; la
   contrainte élargie est `NOT VALID` : aucun parcours de table, aucun verrou long). Rien ne change pour les viewers.
3. Release Studio (onglet + source OBS), installation par Antoni.
4. Extension : publier la nouvelle version (choix en trois modes), téléversement par Antoni.
5. Studio › Progression › Level Up V2 : relire la distribution réelle du jour (le Core la recalcule), puis « Activer
   Level Up V2… ».
6. OBS : ajouter la source navigateur « Level Up » (URL dans Studio, 1920 × 1080), « Tester (sonore) ».
7. « Activer les annonces » quand Antoni le décide.

Retour arrière : couper les annonces (immédiat) ; « Annuler la normalisation » (tant qu'aucun historique n'a été
rattaché depuis) ; Core précédent (la migration reste, additive) ; SQL en tête de la migration (démontré sur PostgreSQL
réel).

## 8. Tests

- Core, PGlite et **PostgreSQL réel** (même suite `progression-level-v2.suite.ts`) : 999 → 1 000, report, plusieurs
  niveaux, rejeu, présence et chat, cooldown des messages, import et rattachement tardif (mêmes paramètres figés),
  normalisation deux fois refusée, XP native et ajustements gardés, classement stable (égalités), Semaine / Mois
  inchangés, modes Désactivé / Écrit / Sonore, absence = Désactivé, annonce livrée une fois, cooldown du son, fusion,
  expiration, annonces coupées, annulation, rejeux concurrents (une seule annonce).
- Chaîne réelle du bot (`progression-chain.test.ts`) : le cycle de présence qui atteint 1 000 XP → une annonce sonore.
- Migration : retour arrière exact des trois migrations de la progression (PostgreSQL réel).
- Studio : source OBS (jeton, rien demandé sans source, annonce poussée une fois, test local, volume, carillon / son
  personnel), relais ; **e2e navigateur** `progression-v2-level-up.e2e.ts` : activation tapée, « Sonore » choisi dans
  l'extension et gardé après rechargement, un message qui franchit le niveau 2 → la source OBS affiche « Kirito_TV passe
  niveau 2 ! » et joue le son, Studio la liste.
- Extension : le client envoie le mode (tout autre valeur = Désactivé).
