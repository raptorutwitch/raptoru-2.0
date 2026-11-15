# Level Up V2 — 1 000 XP par niveau, normalisation WizeBot, annonce chat, son au choix, badges de niveau

**État (15/11/2026)** : développé et testé en Lab, de bout en bout dans de vrais navigateurs, PGlite et PostgreSQL réel.
Branche `feat/level-up-v2-final`, PR #70 (reprise de la PR #43, `02b4ebb`, 30/10). **Rien n'est actif en Production** :
la Production reste sur la courbe tant que la procédure du § 9 n'a pas reçu le GO d'Antoni.

## 1. Décisions retrouvées dans la PR #43 (30/10) et gardées

- **Niveau = 1 + floor(XP / 1 000)** : le niveau 1 vaut 0 XP (convention du projet), le reste est reporté, aucun plafond.
  Plusieurs niveaux d'un coup donnent un seul événement, au niveau final.
- **Normalisation WizeBot, une seule fois**, exposant 0,7 (§ 3) :
  - XP d'un historique rattaché = 1 000 × (N − 1) + XP native, gagnée ou ajustée depuis, jamais perdue ;
  - les paramètres sont figés pour les historiques rattachés plus tard ;
  - audit par compte ;
  - jamais annoncée, jamais dans Semaine / Mois ;
  - annulable tant qu'aucun historique n'a été rattaché depuis.
- **La courbe est verrouillée** une fois Level Up V2 actif.
- **Événement de Level Up seulement pour un vrai gain** (présence, chat). Import, normalisation, rattachement et
  ajustement Studio n'en créent jamais.

## 2. Décisions d'Antoni (14–15/11)

| Sujet                        | Décision                                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifestations d'un Level Up | **Exactement deux** : une ligne de **LeCroupier\_ dans le chat** (message normal, pas `/announce`) et un **son** sur le stream. **Aucune** bannière, aucun texte, aucun cadre à l'écran : la source OBS est invisible et ne joue que le son |
| Annonce chat                 | Pour **chaque vrai Level Up**, indépendante du choix sonore du viewer ; texte réglable dans Studio ; groupée et protégée du flood (§ 5)                                                                                                     |
| Son                          | **Désactivé par défaut** ; joué seulement pour les viewers qui l'ont activé. Une absence de choix n'autorise jamais le son                                                                                                                  |
| Réglage viewer               | **Une case à cocher** dans les préférences (roue crantée), les deux interfaces : « Jouer un son lorsque je monte de niveau », décochée par défaut, enregistrée tout de suite                                                                |
| Préférences historiques      | Récupérées depuis la table Supabase de l'ancienne extension (§ 8) ; jamais écrasées par un import plus ancien                                                                                                                               |
| Gains d'XP                   | **1 XP par minute** de présence, **3 XP par message** éligible, un message récompensé au plus toutes les **60 s**. Au plus 60 XP/h en silence et 240 XP/h en parlant : un rapport de 1 à 4                                                  |
| Anti-farm                    | Gardé : commandes, bots, délai, longueur, 3 lettres ou chiffres différents, même message sans XP pendant 10 min                                                                                                                             |
| Badges                       | **Les vrais badges sub d'Antoni** (`Documents\Twitch\Badge de ma chaine`), un tous les 10 niveaux, dans l'ordre de leur numéro (§ 6)                                                                                                        |

## 3. Données réelles et compression (relevé du 29/10/2026, PR #43)

7 852 historiques WizeBot (1 622 rattachés, 6 228 en attente, 2 conflits), **niveau max 135**.

`nouveau = max(1, floor(1 + 49 × ((L − 1) / (max − 1))^0,7))`, `max` figé à l'activation.

- Exemples : 2→2, 3→3, 5→5, 10→8, 20→13, 50→25, 74→33, 100→40, 121→46, 135→50.
- Les niveaux 1 à 5 sont inchangés.
- Aucun viewer de niveau > 1 n'est ramené à 1.

**Chiffres à relire sur les données du jour** (Studio › Level Up › Simuler) avant l'activation.

## 4. Rythme

- Un viewer présent sans parler monte d'un niveau toutes les **16 h 40** de présence. Avec des lives de 4 h, 4 fois par
  semaine : environ un niveau par semaine, un badge en 10 semaines.
- Un viewer qui parle normalement (au moins un message utile par minute) monte d'un niveau toutes les **4 h 10** : un
  badge en un peu plus de deux semaines.
- **L'activation fixe ces gains** (1 / 3 / 60 s). Ils restent réglables ensuite dans Studio › XP et Daily.
- Un changement de taux ne concerne que les gains suivants : l'XP déjà gagnée n'est jamais recalculée. L'annulation de
  la normalisation remet les gains d'avant.

## 5. Annonces et son

**Chat** (« Annoncer les Level Up », coupé par défaut) :

- Une ligne au plus toutes les **30 s** pour toute la chaîne.
- Les Level Up arrivés entre deux lignes partent ensemble : « Montées de niveau : @a (niveau 5), @b (niveau 12) ! ».
- Un viewer seul : le texte de Studio, par défaut « @{pseudo} vient d'atteindre le niveau {niveau} ! ».
- Un cycle de présence donne au plus une ligne.
- Jamais plus de 2 min de retard.
- Rien n'est mis en file si « Sortie chat réelle » est coupée ou si les annonces sont coupées.

**Son** (« Sons Level Up », coupé par défaut) :

- La source OBS « Level Up » est une source navigateur **invisible**. Elle demande au Core les sons à jouer, seulement
  tant qu'elle est connectée.
- Un son est joué seulement si :
  - le viewer a coché la case ;
  - les sons de la chaîne sont allumés ;
  - le dernier son date d'au moins **60 s** (réglable).
- Hors de ces conditions, rien n'est joué.
- Plusieurs niveaux en attente pour un viewer donnent un seul son.
- Chaque son est joué une fois, jamais en retard, jamais deux à la fois.
- Un viewer qui décoche la case entre le Level Up et le son n'a pas de son.

**Jamais** d'annonce ni de son pour une migration, un import, un rattachement ou un ajustement Studio.

## 6. Badges de niveau

**Le dossier d'Antoni** (inspecté le 15/11, lecture seule) :

| Palier   | Fichier                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10 → 100 | `1. UglyTitan` … `10. FoundingTitan` : 10 dessins de 990 px, un par numéro                                                                                         |
| 110      | `11. Badge HK` (1980 px) : badge sub, **confirmé par Antoni le 15/11** même s'il est aussi rangé, identique, dans `Badges Bits/` (`Badge Bits sans nom aussi.png`) |
| —        | `Obsolète/` : anciennes versions des badges 1 à 8, écartées                                                                                                        |
| —        | `Badges Bits/` : badges de Bits, écartés                                                                                                                           |

**L'import se fait dans Studio** (Level Up › « Importer mes badges sub… ») :

- On choisit le dossier.
- Studio ne retient que les images numérotées **à la racine** : badge n → niveau 10 × n.
- **Il ne devine jamais** :
  - deux images différentes sous un même numéro laissent le palier vide ;
  - un numéro manquant est signalé ;
  - une même image utilisée pour deux paliers à la racine est « à confirmer » et ne s'importe que cochée ;
  - une image aussi présente dans un sous-dossier (le n° 11 dans `Badges Bits`) n'est qu'une remarque : elle est importée.
- **L'ordre des 11 badges est validé par Antoni (15/11)** : n° 1 → niveau 10, …, n° 11 → niveau 110.
- Chaque image est réduite à **128 px** (règle des badges du Core, 40 Ko au plus) ; le dessin ne change pas.
- Le badge s'appelle « Niveau X ». Nom et image se retouchent dans Boutique.

**Attribution** :

- Rétroactive et idempotente ; jamais en double ; un badge débloqué ne disparaît pas.
- **Selon le niveau recalculé** : tant que des historiques WizeBot attendent la normalisation, les récompenses de niveau
  attendent l'activation, qu'on les crée dans Level Up ou dans Boutique. Un ancien niveau 135 reçoit les badges 10 à 50,
  pas 130.

**Sur raptoru.fr (déjà en Production)** : Profil › Apparence › « Badges affichés (3 au plus) ». Le viewer choisit parmi
ses badges, y compris un ancien qu'il préfère. Ils s'affichent à côté de son pseudo. Aucune modification du site n'est
nécessaire.

## 7. Simulation et migration

**« Simuler »** fait l'activation dans un savepoint annulé et n'écrit rien. Elle montre :

- le nombre de comptes, dont ceux qui ont un historique WizeBot ;
- les comptes dont le niveau change ;
- la distribution des niveaux aujourd'hui et après ;
- les **25 plus grandes variations** (nom, niveau WizeBot, avant, après) ;
- les badges et titres de niveau (nombre de viewers avant et après) ;
- les gains après l'activation ;
- les **historiques WizeBot non résolus** (inconnus, ambigus, en conflit, avec une liste). Ils ne sont jamais donnés à
  une mauvaise personne, et reçoivent le même niveau figé le jour où ils sont rattachés.

**« Activer Level Up V2… »** :

- Phrase tapée : « NORMALISER LES NIVEAUX ».
- Une seule fois. Une seconde activation est refusée, donc aucune double récompense.
- Une ligne d'audit par compte (niveau et XP avant).
- Jamais d'annonce ni de son.

**« Annuler la normalisation… »** : phrase « ANNULER LA NORMALISATION ».

## 8. Préférences historiques du son

**Où elles étaient.** Jusqu'à la bascule du 20/10, l'extension parlait à l'EBS de raptoru.fr. Celui-ci gardait la case
« son des Level Up » dans la table Supabase **`ext_viewer_preferences`**, sur `supabase.raptoru.fr`. Colonnes :
`channel_id`, `twitch_user_id`, `twitch_login`, `level_up_sfx_opt_in`, `updated_at`. Les sons WizeBot n'étaient joués
que pour ces viewers (commit du site `9e19ca8`).

Depuis la bascule, le Core ne gardait le choix **qu'en mémoire**, perdu à chaque redémarrage, et le réglage était masqué
depuis le 05/11. Il n'existe donc rien de durable après le 20/10.

**Export du 15/11/2026 (lecture seule, autorisée par Antoni)** :

- Lu par l'API REST du projet `supabase.raptoru.fr`, **GET uniquement**, avec la clé de lecture déjà rangée hors dépôt
  (`Documents\Raptoru\_migration-exports\legacy-supabase.env`, celle de la lecture du 19/10).
- La clé n'a été ni affichée ni copiée, et aucune donnée n'a été modifiée.
- Le fichier est privé, hors de tout dépôt : `Documents\Raptoru\_migration-exports\level-up-prefs-2026-11-15\ext_viewer_preferences.json`.
- Contenu : **6 préférences**, toutes de la chaîne 83603689, datées du 14 au 21/09/2026 ; **5 son activé, 1 coupé**.
- Simulation d'import (le code du Core appelé par Studio, base jetable de la chaîne) :
  - **5 viewers retrouvent le son, 1 le garde coupé** ;
  - 0 doublon, 0 autre chaîne, 0 ligne sans identifiant ;
  - rien d'écrit.

**Import** (Studio › Level Up › « Choix du son de l'ancienne extension », après le déploiement du Core, sur GO) :

1. Choisir ce fichier ; Studio montre **d'abord la simulation**, rien n'est écrit.
2. « Importer ces choix » sur confirmation.

**Priorité** :

1. Un choix fait dans l'extension actuelle passe toujours en premier.
2. Ensuite, le choix historique ; pour un même viewer, la ligne la plus récente gagne.
3. Sans aucune des deux : pas de son.

**Identité** : l'identifiant Twitch. Une ligne d'une autre chaîne, ou sans identifiant, est signalée et jamais rattachée
par pseudo.

L'import est idempotent, ne déclenche ni son ni annonce, et n'efface jamais rien (la provenance `legacy` et la date
d'origine sont gardées).

## 9. Activation en Production (sur GO d'Antoni, étape par étape)

1. Sauvegarde Coolify et restauration vérifiée.
2. Fusion de la PR, CI verte, déploiement du Core.
   - La migration `20261126130000_progression_level_up.sql` est **additive** : 3 tables, des colonnes facultatives, une
     contrainte élargie `NOT VALID`.
   - Rien ne change pour les viewers.
3. Release Studio (onglet Level Up et source OBS), installation par Antoni.
4. Extension : publier la version avec la case à cocher et « Mon niveau », téléversement par Antoni.
5. Préférences historiques : export Supabase, puis Studio › Level Up : simulation, puis import.
6. Badges : Studio › Level Up › « Importer mes badges sub… » (les 11 badges, niveaux 10 à 110, cochés d’office).
7. Studio › Level Up › **Simuler** sur les données du jour, puis **Activer Level Up V2…**.
8. OBS : ajouter la source navigateur « Level Up » (invisible), choisir le son, « Tester le son ».
9. Allumer « Annoncer les Level Up » et « Sons Level Up » quand Antoni le décide.

**Retour arrière** :

- couper les annonces ou les sons (immédiat) ;
- « Annuler la normalisation » (tant qu'aucun historique n'a été rattaché depuis ; les badges donnés restent) ;
- Core précédent (la migration reste, additive) ;
- SQL en tête de la migration.

## 10. Tests

- **Core, PGlite et PostgreSQL réel** (`progression-level-v2.suite.ts`) :
  - son désactivé sans choix connu ; son seulement pour un viewer qui l'a activé ; viewer qui le coupe entre-temps ;
  - un son par Level Up, délai, fusion, expiration, sons coupés ;
  - **préférences historiques** : simulation sans écriture, ligne la plus récente, choix récent jamais écrasé, autre
    chaîne et identifiant manquant signalés, import répété sans effet ;
  - **chat indépendant du son**, groupé, différé, expiré, interrupteurs, rejeux concurrents ;
  - 1 XP/min et 3 XP/message, anti-farm, taux changés sans recalcul ;
  - activation qui fixe les gains, annulation qui les remet ;
  - **badges** rétroactifs selon le niveau recalculé, jamais en double ;
  - **simulation = activation** (variations, badges, non résolus), rien d'écrit ;
  - **aucune annonce ni son pendant la migration**.
- Retour arrière des migrations : PostgreSQL réel.
- **Studio** :
  - la source OBS **ne dessine rien** (vérifié sur la page et le script) et ne reçoit que « joue le son » ;
  - son envoyé, remplacé, supprimé ; volume ; test ;
  - **ordre des badges sub** sur le dossier réel (11 badges dans l'ordre, le 11ᵉ importé avec une simple remarque, `Obsolète` et
    `Badges Bits` écartés, deux images sous un numéro jamais devinées) ;
  - lecture de l'export Supabase (CSV et JSON).
- **Extension** : la case envoie un booléen ; « Mon niveau ».
- **E2E navigateur** (`progression-v2-level-up.e2e.ts`) :
  - simulation, puis activation tapée, puis annonces et son allumés ;
  - import de deux images numérotées (de simples aplats générés par le test, jamais les badges d'Antoni) ;
  - case décochée par défaut, gardée après rechargement ;
  - un message fait passer un viewer au niveau 10 : **une ligne de chat**, le badge avec son image, **le son joué et rien
    d'affiché**.

## 11. Ce qui attend Antoni

- **Le fichier son** : à envoyer depuis Studio. Le droit de le diffuser en public reste à clarifier avant la Production.
- **L'import des choix historiques** (export lu le 15/11 : 5 son activé, 1 coupé), après le déploiement du Core.
- Le GO de chaque étape du § 9.
