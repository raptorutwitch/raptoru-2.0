# Level Up V2 — 1 000 XP par niveau, normalisation WizeBot, annonces chat et stream, badges de niveau

**État (15/11/2026)** : développé et testé en Lab, de bout en bout dans de vrais navigateurs, PGlite et PostgreSQL réel.
Branche `feat/level-up-v2-final` (reprise de la PR #43, `02b4ebb`, 30/10). **Rien n'est actif en Production** : la
Production reste sur la courbe tant que la procédure du § 9 n'a pas reçu le GO d'Antoni.

## 1. Décisions retrouvées dans la PR #43 (30/10) et gardées

- **Niveau = 1 + floor(XP / 1 000)** : le niveau 1 vaut 0 XP (convention du projet), le reste est reporté, aucun plafond.
  Plusieurs niveaux d'un coup donnent un seul événement, au niveau final.
- **Gains** : présence validée **1 XP par minute**, message éligible **5 XP**, au plus un toutes les **60 s**. Tout message
  compte dans les statistiques, même sans XP (commandes comprises).
- **Normalisation WizeBot, une seule fois**, exposant 0,7 (§ 3) :
  - XP d'un historique rattaché = 1 000 × (N − 1) + XP native, gagnée ou ajustée depuis, jamais perdue ;
  - les paramètres sont figés pour les historiques rattachés plus tard ;
  - audit par compte ;
  - jamais annoncée, jamais dans Semaine / Mois ;
  - annulable tant qu'aucun historique n'a été rattaché depuis.
- **La courbe est verrouillée** une fois Level Up V2 actif : un niveau atteint ne baisse jamais à cause d'un réglage.
- **Événement de Level Up seulement pour un vrai gain** (présence, chat), une fois par mouvement du registre. Import,
  normalisation, rattachement et ajustement Studio n'en créent jamais.
- **Mode par viewer** (Désactivé / Écrit / Sonore), gardé par le Core, choisi dans l'extension.
- **Source OBS à part** (`/level-up/player.html#<jeton>`), servie par Studio, sans toucher aux alertes ni aux autres
  overlays. Délai entre deux sons de 5 min. Une annonce non affichée en 2 min est abandonnée.

## 2. Ce qui change à la reprise (14–15/11, demande d'Antoni)

| Sujet | PR #43 | Maintenant |
| --- | --- | --- |
| Annonce dans le **chat Twitch** | aucune (source OBS seule) | **LeCroupier_** via la file des commandes (`cmd_steps`, origine `module:level_up`) ; « Sortie chat réelle » et la limite du bot s'appliquent ; **groupées** (§ 5) |
| Mode d'un viewer qui n'a rien choisi | Désactivé | **Sonore** (réglage « Viewer qui n'a rien choisi » dans Studio) ; le choix du viewer gagne toujours |
| Anti-farm du chat | longueur, délai, commandes, bots | en plus : **3 lettres ou chiffres différents** au moins ; le **même texte** que le dernier message récompensé ne rapporte rien pendant **10 min** (empreinte seulement, jamais le texte) |
| Badges | catalogue existant | **un badge tous les 10 niveaux** (catalogue `kind: badge`, `unlock_level`), donnés **selon le niveau recalculé** (§ 6) |
| Son | carillon ou fichier copié à la main | **ton fichier envoyé depuis Studio** (MP3 / OGG / WAV vérifiés à leurs premiers octets, 2 Mo au plus) ; carillon de test sinon |
| Migration | activation directe | **Simuler** d'abord : les chiffres exacts de l'activation, rien d'écrit |
| Extension | choix à trois modes (masqué depuis le 05/11) | choix visible dans **les deux interfaces**, plus **« Mon niveau »** (niveau, XP vers le niveau suivant, badges) |

## 3. Données réelles et compression (relevé du 29/10/2026, PR #43)

7 852 historiques WizeBot (1 622 rattachés, 6 228 en attente, 2 conflits), **niveau max 135**, 75 niveaux distincts.

`nouveau = max(1, floor(1 + 49 × ((L − 1) / (max − 1))^0,7))`, `max` figé à l'activation (le niveau WizeBot le plus haut
connu ce jour-là).

- Exemples : 2→2, 3→3, 5→5, 10→8, 20→13, 50→25, 74→33, 100→40, 121→46, 135→50.
- 0,7 garde les niveaux 1 à 5 identiques.
- Aucun viewer de niveau > 1 n'est ramené à 1 (la proportionnelle en écrasait 716).
- 43 niveaux distincts, monotone.

**Chiffres à relire sur les données du jour avant l'activation** (Studio › Level Up › Simuler) : de l'XP native s'est
accumulée depuis le 29/10.

## 4. Rythme attendu (taux de la PR #43, inchangés)

- Un viewer présent sans parler gagne environ **60 XP/h**, soit un niveau toutes les 17 h de présence. Avec des lives de
  4 h, 4 fois par semaine : environ un niveau par semaine, un badge en 10 semaines.
- Un viewer qui parle normalement (un message utile par minute) gagne environ **360 XP/h**, soit un niveau toutes les
  2 h 45 : un badge en environ deux semaines.
- Tous les taux se règlent dans Studio › Progression › XP et Daily (« Ce qui rapporte ») ; l'anti-farm dans
  Studio › Progression › Level Up.

## 5. Annonces

**Chat** (réglage « Annonces dans le chat », coupé par défaut) :

- Une ligne au plus toutes les **30 s** pour toute la chaîne.
- Les Level Up arrivés entre deux lignes partent ensemble : « Montées de niveau : @a (niveau 5), @b (niveau 12) ! »,
  jusqu'à 10 pseudos et 450 caractères ; les autres attendent la ligne suivante.
- Un viewer seul : le texte de Studio, par défaut « @{pseudo} vient d'atteindre le niveau {niveau} ! ».
- Un cycle de présence donne au plus une ligne pour tous ceux qui ont monté pendant ce cycle.
- Jamais d'annonce de plus de 2 min (après une pause, pas de rafale en retard).
- Rien n'est mis en file si :
  - « Sortie chat réelle » est coupée ;
  - le viewer a choisi « Désactivé » ;
  - les annonces chat sont coupées.

  La raison reste visible dans Studio.
- Pseudo : le nom affiché quand il ne diffère du login que par la casse, sinon le login (pour que la mention marche).

**Stream** (réglage « Annonces à l'écran », coupé par défaut) :

- La source OBS « Level Up » demande au Core les annonces à afficher, seulement tant qu'une source est connectée.
- Écrit : la ligne seule ; Sonore : la ligne et le son.
- Un son au plus toutes les 5 min pour la chaîne : une annonce dans ce délai s'affiche sans son.
- Plusieurs niveaux en attente pour un viewer : une seule annonce.
- Chaque annonce est livrée une fois.

**Jamais** d'annonce pour une migration, un import, un rattachement ou un ajustement Studio.

## 6. Badges de niveau

- Un badge = une entrée du catalogue de progression (`kind: badge`, `unlock_level` = 10, 20, 30…). Studio › Level Up ›
  « Créer le badge » crée `niveau-10`, `niveau-20`… sans image.
- **L'image** (PNG ou WebP, 128 px, 40 Ko au plus) s'ajoute dans Studio › Boutique, avec les illustrations d'Antoni. Sans
  image, raptoru.fr montre le nom du badge. **Aucun faux badge définitif** n'est livré.
- **Rétroactif et idempotent** : un badge créé est donné à tous ceux qui ont déjà le niveau, puis à chaque passage ; un
  badge déjà donné ne l'est jamais deux fois ; un badge débloqué ne disparaît pas (seul un badge rendu inactif dans
  Studio disparaît du profil).
- **Pas de badge selon l'ancienne échelle** : tant que des historiques WizeBot attendent la normalisation (modèle
  « courbe »), les récompenses de niveau attendent l'activation ; l'activation les donne selon les niveaux recalculés (un
  ancien niveau 135 reçoit les badges 10 à 50, pas 130). Sans historique WizeBot, rien ne change : donnés tout de suite.
- **Sur raptoru.fr (déjà en Production)** : Profil › Apparence › « Badges affichés (3 au plus) ». Le viewer choisit parmi
  ses badges, y compris un ancien qu'il préfère. Ils s'affichent à côté de son pseudo dans les classements, la carte de
  joueur et le profil. Aucune modification du site n'est nécessaire.

## 7. Studio › Progression › Level Up

- **Passage à Level Up V2** :
  - modèle actuel, comptes, niveau WizeBot le plus haut ;
  - niveaux aujourd'hui ;
  - **Simuler** (niveaux après, comptes modifiés, récompenses de niveau données, rien d'écrit) ;
  - **Activer Level Up V2…** (phrase « NORMALISER LES NIVEAUX ») ;
  - **Annuler la normalisation…** (phrase « ANNULER LA NORMALISATION »).
- **Annonces** : chat, texte, intervalle ; écran, délai entre sons, fraîcheur ; mode par défaut ; anti-farm.
- **Source OBS** : adresse à copier (source navigateur 1920 × 1080), sources connectées, volume, « Choisir un son… »,
  « Revenir au carillon », tests écrit / sonore.
- **Badges de niveau** : chaque palier, son image, son nombre de viewers, « Créer le badge ».
- **Derniers Level Up** : heure, viewer, niveaux, mode, sort de l'annonce chat et de l'annonce à l'écran (avec la
  raison au survol).
- XP et Daily : la courbe affichée comme verrouillée une fois Level Up V2 actif.

## 8. Extension

- Préférences (les deux interfaces) : **« Mon niveau »**, puis « Mes Level Up sur le stream : Désactivé / Écrit / Sonore ».
  « Mon niveau » montre le niveau, une barre « 340 / 1 000 XP vers le niveau 13 » et le nombre de badges débloqués.
- Lu pour le viewer du jeton seulement (`GET /viewer/progression`, `GET|POST /viewer/preferences`) ; le choix est gardé
  par le Core.

## 9. Activation en Production (sur GO d'Antoni, étape par étape)

1. Sauvegarde Coolify et restauration vérifiée.
2. Fusion de la PR, CI verte, déploiement du Core.
   - La migration `20261126130000_progression_level_up.sql` est **additive** : 3 tables, 1 colonne facultative, une
     contrainte élargie `NOT VALID`, sans parcours de table ni verrou long.
   - Rien ne change pour les viewers.
3. Release Studio (onglet Level Up et source OBS), installation par Antoni.
4. Extension : publier la nouvelle version (« Mon niveau » et le choix à trois modes), téléversement par Antoni.
5. Studio › Level Up › **Simuler** sur les données du jour, puis **Activer Level Up V2…**.
6. Badges : « Créer le badge » pour chaque palier, puis l'image de chaque badge dans Boutique.
7. OBS : ajouter la source navigateur « Level Up », choisir le son, « Tester (sonore) ».
8. Couper ou allumer les annonces chat et écran quand Antoni le décide.

**Retour arrière** :

- couper les annonces (immédiat) ;
- « Annuler la normalisation » (tant qu'aucun historique n'a été rattaché depuis ; les badges donnés restent) ;
- Core précédent (la migration reste, additive) ;
- SQL en tête de la migration (démontré sur PostgreSQL réel).

## 10. Tests

- **Core, PGlite et PostgreSQL réel** (`progression-level-v2.suite.ts`) :
  - 999 → 1 000 XP, report, plusieurs niveaux, rejeu ;
  - normalisation une fois, XP native gardée, audit, annulation ;
  - classement stable ;
  - modes et mode par défaut ;
  - annonces écran (son, délai, fusion, expiration) ;
  - **annonces chat** (une ligne, groupée, intervalle, expiration, interrupteurs, rejeux concurrents) ;
  - **anti-farm** (répétition, lettres, commande, bot, fenêtre) ;
  - **badges** (rétroactifs selon le niveau recalculé, jamais deux fois, absent sans erreur, ancien badge affichable,
    badge inactif retiré) ;
  - **simulation = activation**, rien d'écrit.
- Retour arrière des migrations de la progression : PostgreSQL réel.
- **Studio** :
  - source OBS (jeton, rien demandé sans source, annonce livrée une fois, test local, volume) ;
  - **son envoyé** (format vérifié, remplacement, taille, retour au carillon) ;
  - relais.
- **Extension** : mode envoyé, « Mon niveau » (texte, barre, appel).
- **E2E navigateur** (`progression-v2-level-up.e2e.ts`, pile Core Lab) :
  - activation tapée dans Studio, annonces allumées, badge du niveau 10 créé ;
  - « Mon niveau » et le mode gardé dans l'extension ;
  - un message fait passer Kirito_TV au niveau 10, ce qui donne une ligne dans la file du chat, le badge, la source OBS
    avec le son ;
  - Studio liste ce Level Up.

## 11. Ce qui attend Antoni

- **Les images des badges** (ses badges d'abonnement redessinés en badges communautaires), au format du catalogue.
- **Le fichier son** (le son de Level Up qu'il a choisi) : à envoyer depuis Studio. **Le droit de diffuser ce son en
  public reste à clarifier avant la Production.**
- Le GO de chaque étape du § 9.
