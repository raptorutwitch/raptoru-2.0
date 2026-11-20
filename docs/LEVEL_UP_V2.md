# Level Up V2 — 1 000 XP par niveau, normalisation WizeBot, annonce chat, son au choix, badges de niveau

**État (15/11/2026)** : **CLÔTURÉ, ACTIF EN PRODUCTION**.

- Activé le 15/11 ~03:55 UTC (GO d'Antoni, Core `f04b41a2`, PR #70 puis #71) : normalisation appliquée, 11 badges,
  266 attributions rétroactives, préférences historiques restaurées.
- Finitions déployées le 15/11 ~14:25 UTC (Core et bot `d2fd5bb7`, PR #73 et #74) :
  - vraies annonces Twitch groupées sur 5 min, le titre équipé ;
  - un son par annonce, 3 s avant le bandeau ;
  - pseudos repris de Twitch ;
  - liste des viewers avec son dans Studio.
- Chiffres, contrôles et retour arrière : § 12, § 13,
  [archive/LIVRAISON_2026-11-15_LEVEL_UP_MINI_PROFIL.md](archive/LIVRAISON_2026-11-15_LEVEL_UP_MINI_PROFIL.md) et
  [archive/LIVRAISON_2026-11-15_LEVEL_UP_FINITIONS.md](archive/LIVRAISON_2026-11-15_LEVEL_UP_FINITIONS.md).

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

| Sujet                        | Décision                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifestations d'un Level Up | **Exactement deux** : une **vraie annonce Twitch** de LeCroupier\_ (bandeau coloré, API Send Chat Announcement, décision du 15/11 au soir) et un **son** sur le stream. **Aucune** bannière, aucun texte, aucun cadre à l'écran : la source OBS est invisible et ne joue que le son |
| Annonce chat                 | Pour **chaque vrai Level Up**, indépendante du choix sonore du viewer ; « 🚀 LEVEL UP — Aouh [Loup-Garou] (57) · Calypso (23) », sans @ ; regroupée sur une fenêtre de 5 min (§ 5)                                                                                                  |
| Son                          | **Désactivé par défaut** ; joué seulement pour les viewers qui l'ont activé. Une absence de choix n'autorise jamais le son                                                                                                                                                          |
| Réglage viewer               | **Un interrupteur** dans les Préférences (⚙) du **mini-profil** ([MINI_PROFIL.md](MINI_PROFIL.md)) : « Jouer un son lorsque je monte de niveau », désactivé par défaut, enregistré tout de suite par le Core (les deux shells)                                                      |
| Préférences historiques      | Récupérées depuis la table Supabase de l'ancienne extension (§ 8) ; jamais écrasées par un import plus ancien                                                                                                                                                                       |
| Gains d'XP                   | **1 XP par minute** de présence, **3 XP par message** éligible, un message récompensé au plus toutes les **60 s**. Au plus 60 XP/h en silence et 240 XP/h en parlant : un rapport de 1 à 4                                                                                          |
| Anti-farm                    | Gardé : commandes, bots, délai, longueur, 3 lettres ou chiffres différents, même message sans XP pendant 10 min                                                                                                                                                                     |
| Badges                       | **Les vrais badges sub d'Antoni** (`Documents\Twitch\Badge de ma chaine`), un tous les 10 niveaux, dans l'ordre de leur numéro (§ 6)                                                                                                                                                |

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

**Chat** (« Annoncer les Level Up ») : une **vraie annonce Twitch** (Send Chat Announcement, bandeau coloré), envoyée par
LeCroupier\_ depuis la file des commandes (mode `announce`, « Sortie chat réelle » et la limite du bot).

- **Format** : `🚀 LEVEL UP — Aouh [Loup-Garou] (57) · Calypso (23)`.
  - Texte réglable dans Studio (`{liste}` = les viewers), couleur au choix parmi les cinq de Twitch (par défaut celle de
    la chaîne).
  - Le pseudo est écrit **sans @**, avec un séparateur invisible (U+2060) après sa première lettre : il ne mentionne
    personne.
  - Le **titre équipé** sur raptoru.fr, entre crochets, seulement s'il existe et que le viewer le possède encore (la règle
    des classements). Sans titre : rien, aucun emplacement vide.
- **Regroupement** :
  - le premier Level Up en attente ouvre une **fenêtre** (5 min par défaut, 30 s au moins) ; à sa fin, **une seule
    annonce** nomme tout le monde ;
  - un viewer monté plusieurs fois n'apparaît qu'**une fois**, à son plus haut niveau (les autres : « regroupé ») ;
  - **8 pseudos et 450 caractères au plus** ; les suivants partent dans l'annonce d'après, **une minute** plus tard au
    moins ;
  - le Core vérifie toutes les 30 s : l'annonce part même si personne ne parle.
- **Aucune perte silencieuse** : chaque Level Up garde un état (envoyé, regroupé, trop ancien, non envoyé et pourquoi),
  visible dans « Derniers Level Up ». Pas envoyé **2 min** après la fin de sa fenêtre : « trop ancien », jamais une
  annonce en retard.
- Si Twitch refuse l'annonce (droit absent), le même texte part une fois en message normal.
- Rien n'est mis en file si « Sortie chat réelle » est coupée ou si les annonces sont coupées.

**Son** (« Sons Level Up », coupé par défaut) : **un seul son par annonce, juste avant le bandeau** (décision d'Antoni
du 15/11, effet d'anticipation).

- À la fin de la fenêtre, si **au moins un viewer nommé** a activé le son (et que les sons de la chaîne sont allumés),
  la source OBS « Level Up » (navigateur **invisible**, rien à l'écran) joue **un** son ; l'annonce Twitch part
  **3 s après** (réglable dans Studio de 0 à 5 s).
- Personne à l'écoute, sons coupés ou dernier son il y a moins de **60 s** (réglable, mesuré entre les annonces) :
  l'annonce part **tout de suite**, sans son.
- La source OBS a 3 s pour prendre le son ; sinon l'annonce part sans lui (« aucune source OBS à temps ») et le son
  n'est **jamais** joué après le bandeau.
- Le son est joué **une fois** : ni une reconnexion de la source, ni une relance du bot, ni un accusé rejoué ne le
  rejoue. Pendant ces quelques secondes, l'annonce ne bloque pas les autres réponses du bot.
- Un viewer qui décoche la case avant la fin de la fenêtre n'est plus compté.
- Si Twitch refuse ensuite le bandeau, le son a déjà été joué : l'échec est noté sur l'annonce et ses Level Up.
- Annonces coupées : pas d'annonce, donc pas de son (« pas d'annonce »).
- Studio › Level Up montre, pour la dernière annonce test, l'heure du son et celle du bandeau.
- Stockage : `progression_announcements` (une ligne par annonce : son attendu / joué / silencieux / manqué, réponse de
  Twitch), migration additive `20261127130000_level_up_announcements.sql`.

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
8. OBS : ajouter la source navigateur « Level Up » (invisible), choisir le son, puis Studio › Level Up › **Tester un Level Up**.
9. Allumer « Annoncer les Level Up » et « Sons Level Up » quand Antoni le décide.

**Retour arrière** :

- couper les annonces ou les sons (immédiat) ;
- « Annuler la normalisation » (tant qu'aucun historique n'a été rattaché depuis ; les badges donnés restent) ;
- Core précédent (la migration reste, additive) ;
- SQL en tête de la migration.

## 9 bis. Tester un Level Up depuis Studio (15/11)

Studio › Progression › Level Up › **Tester un Level Up** : un test administrateur de la chaîne audio et de l'annonce.

- **Rien n'est écrit** : aucune XP, aucun niveau, aucun badge, aucune récompense, aucun événement de progression.
  Le test ne dépend pas du choix sonore d'un viewer.
- Saisies : le pseudo (par défaut « Raptoru »), le niveau (par défaut 25) et, au choix, un **titre du catalogue**.
  L'aperçu montre l'annonce avec le texte réglé dans Studio, par exemple « 🚀 LEVEL UP — Raptoru [Loup-Garou] (25) ».
- Le bouton **Tester un Level Up** joue le son par la **vraie source OBS** (le même circuit qu'en live : Studio pousse
  « joue le son » à la source navigateur, au volume réglé).
  - Rien ne s'affiche sur le stream.
  - Sans source connectée, Studio le dit (« Aucune source OBS « Level Up » connectée »).
  - L'état de la source (connectée / absente) est affiché dans le bloc.
- Le bouton **Envoyer une vraie annonce test…** publie la **vraie annonce Twitch** « [TEST] 🚀 LEVEL UP — … » (bandeau
  à la couleur choisie) dans le vrai chat :
  - seulement après une confirmation tapée (`ENVOYER LE TEST`) ;
  - par la file d'annonces des commandes (LeCroupier\_, « Sortie chat réelle » et la limite du bot s'appliquent) ;
  - jamais automatiquement (ni au déploiement, ni à une migration, ni au lancement de Studio) ;
  - refusé si la « Sortie chat réelle » est coupée ;
  - **le même chemin qu'en live** : le son dans OBS d'abord (même si les sons de la chaîne sont coupés), puis le
    bandeau après le décalage réglé ; Studio affiche l'heure du son et celle du bandeau (« Dernière annonce test »).
  - Route Core : `POST /v1/studio/progression/level-v2/test-chat`.

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
- **Extension** : l'interrupteur du mini-profil envoie un booléen ; le niveau et le rang (« Mon niveau »).
- **E2E navigateur** (`progression-v2-level-up.e2e.ts`) :
  - simulation, puis activation tapée, puis annonces et son allumés ;
  - import de deux images numérotées (de simples aplats générés par le test, jamais les badges d'Antoni) ;
  - interrupteur du mini-profil désactivé par défaut, gardé après rechargement ;
  - un message fait passer un viewer au niveau 10 : **une ligne de chat**, le badge avec son image, **le son joué et rien
    d'affiché** ;
  - « Tester un Level Up » : le son par la même source, XP et chat inchangés ; puis la ligne « [TEST] » après la
    confirmation tapée.

## 11. Ce qui attend Antoni

- ~~Installer Studio 0.1.35~~ : fait (Studio 0.1.38 installé le 15/11). Pour mémoire : réglages de l'annonce et du décalage du son, liste des
  viewers avec son, pseudos du classement, test de l'annonce réelle.
- Studio › Level Up › **Envoyer une vraie annonce test…** (source OBS « Level Up » connectée) : le son, puis le bandeau
  `[TEST]` 3 s après ; « Dernière annonce test » affiche les deux heures.
- **Extension** : la ligne de validation de l'inventaire, puis la publication Twitch. Sans elle, les viewers n'ont pas
  encore l'interrupteur du son ni le mini-profil (les 5 choix historiques fonctionnent déjà).

## 12. Exécution en Production (15/11/2026)

- Core **`f04b41a2`** déployé ; migration `20261126130000_progression_level_up.sql` appliquée.
  - Sauvegarde Coolify de 03:34 UTC : 9 565 742 octets, `success`.
- Simulation sur les données du jour, puis activation, **identiques** :
  - 1 840 comptes, dont 1 636 avec un historique WizeBot rattaché ;
  - **910 XP normalisées, 441 niveaux changés**, niveau max 135 → 57.
- **XP native conservée** : 25/25 identiques sur les plus grandes variations, recalculées indépendamment.
  - Aucun historique au-delà du niveau 1 n'est ramené au niveau 1.
  - +69 comptes au niveau 1 : sans historique WizeBot et sous 1 000 XP, XP inchangée.
- **266 badges** attribués rétroactivement : 159 au niveau 10, 64 au 20, 28 au 30, 11 au 40, 4 au 50.
  - Images servies publiquement (le site les lit).
- **0 Level Up** créé par la migration et l'activation : aucune annonce, aucun son.
- 6 214 historiques WizeBot en attente et 2 conflits : jamais rattachés au hasard.
- Préférences historiques : 5 sons activés, 1 coupé, relus un par un ; viewer sans choix = son coupé.
- Règles en vigueur :
  - 1 000 XP par niveau ; 1 XP/min, 3 XP/message, 60 s ; anti-farm 3 caractères distincts, 10 min ;
  - annonces au plus toutes les 30 s, abandonnées après 120 s ; un son au plus toutes les 60 s.

## 13. Finitions en Production (15/11/2026, ~14:25 UTC)

- Sauvegarde Coolify de 14:02:53 UTC (9 712 396 octets, `success`), puis Core **`d2fd5bb7`** avec la migration additive
  `20261127130000_level_up_announcements.sql` (table présente, vide au départ), puis bot **`d2fd5bb7`** (EventSub bot
  et diffuseur actifs).
  - Le script a signalé « sortie du migrateur non trouvée dans le journal » : vérifié, la migration est appliquée (la
    route de la nouvelle table répond), le Core sert `d2fd5bb7`, `/health` et `/ready` OK.
- Réglages : annonces en vraie annonce Twitch, `🚀 LEVEL UP — {liste}`, fenêtre **300 s**, couleur de la chaîne, son
  **3 s** avant le bandeau ; inchangés : 1 000 XP par niveau, 1 XP/min, 3 XP/message, 60 s, normalisation, badges.
- **Droit Twitch** : `moderator:manage:announcements` déjà actif (127 annonces réussies avant) ; aucune autorisation
  nouvelle.
- **Pseudos** (actualisation automatique 2 min après le démarrage) : 1 840 comptes vérifiés par leur identifiant,
  1 083 pseudos ajoutés, 132 mis à jour, **1 inconnu de Twitch** (absent du classement). Classement public : 1 129
  viewers, **0 identifiant numérique**, 7 titres équipés affichés.
- Viewers avec son activé : 5 (choix importés de l'ancienne extension).
- Aucun message ni annonce envoyé par le déploiement ; aucune XP, aucun niveau, aucun badge modifié.
- Retour arrière : Core `f04b41a2` et bot `13969a8c` (`--rollback`) ; la migration reste (additive) ; sauvegarde de
  14:02 UTC.

## 14. Équilibrage, badges tous les 25 niveaux, étude de restauration WizeBot (20/11/2026)

Mandat d'Antoni du 20/11. **Aucun niveau ni aucune XP de viewer n'a été modifié.**

**Texte des annonces.**

- La chaîne a été vérifiée : Studio, puis le Core (`progression_settings`), relu **à chaque annonce** (aucun cache),
  puis la file des commandes, puis LeCroupier\_.
- Texte enregistré en Production le 20/11 : « 🚀 Level UP - {liste} ! », identique octet pour octet.
- Les 12 dernières annonces réelles (jusqu'au 19/11, 22:55 UTC) portaient l'ancien texte : aucun Level Up n'a eu lieu
  depuis l'enregistrement.
- La « fois précédente » est expliquée. Le texte du premier V2 (« @{pseudo} vient d'atteindre le niveau {niveau} ! »,
  sans `{liste}`) était lu comme le texte par défaut, sans le dire.
- Studio refuse maintenant un texte sans `{liste}`, et le Core relit le texte modifié dès l'annonce suivante (test
  « a text changed in Studio is the NEXT announcement's text »).
- Correctif Studio : une saisie non enregistrée n'est plus écrasée par le rafraîchissement de 6 s quand on clique
  ailleurs avant « Enregistrer ».
- Variable disponible : `{liste}`, qui devient « Pseudo [Titre] (niveau) · … », sans @.

**Équilibrage (appliqué en Production le 20/11).** Seul le délai entre deux messages récompensés change : 60 s → **120 s**.

- Inchangé : 1 000 XP par niveau, 1 XP par minute de présence, 3 XP par message, anti-farm.
- Données réelles de la semaine : les messages font 23 % de l'XP. Le plus bavard gagne environ 49 XP/h par le chat,
  contre 60 XP/h par la présence.
- Le plafond d'un farmeur (un message valable par délai) passe de 240 à **150 XP/h**, soit 2,5 fois un lurker.

| XP par heure (modèle calé sur la semaine) | 60 s | 120 s | Heures par niveau (120 s) |
| ----------------------------------------- | ---- | ----- | ------------------------- |
| Lurker                                    | 60   | 60    | 16,7                      |
| Occasionnel (5 msg/h)                     | 68   | 68    | 14,8                      |
| Régulier (20 msg/h)                       | 88   | 84    | 11,9                      |
| Très actif (45 msg/h)                     | 113  | 101   | 9,9                       |
| Spammeur (300 msg/h)                      | 195  | 137   | 7,3                       |
| Plafond théorique                         | 240  | 150   | 6,7                       |

**Badges tous les 25 niveaux (appliqué en Production le 20/11).**

- Les 11 badges sub gardent leur image et leur identifiant. Le badge n passe au palier **25 × n** (25, 50, …, 275).
- Aucun badge n'a été retiré ni donné : les détenteurs sont inchangés (159, 64, 29, 11, 5, 1).
- Un badge déjà débloqué reste (règle du § 6) : un viewer de niveau 12 garde le badge n°1, maintenant nommé « Niveau 25 ».
- L'importeur de Studio suit la même règle, sans dernier palier : badge 41 → niveau 1 025, ordre par numéro.
- Paliers testés aux frontières 24/25, 49/50, 74/75, 99/100, 999/1 000/1 025. Un ajustement administratif donne les
  badges sans aucune annonce.
- Retour arrière : les valeurs d'avant sont gardées dans le dossier privé
  `Documents\Raptoru\_migration-exports\levels-2026-11-20\`.

**Étude de restauration WizeBot (lecture seule).**

- Rapport complet et CSV viewer par viewer : dossier privé ci-dessus (données de viewers, jamais dans le dépôt).
- Le basculement des niveaux date du 29/10 : niveau WizeBot importé tel quel, aucune présence ni aucun message compté
  avant. La perte ressentie vient de la compression du 15/11 (135 → 50).
- Formule de restauration : XP = 1 000 × (niveau WizeBot − 1) + XP gagnée depuis le 29/10. L'écart vaut exactement les
  niveaux retirés par la compression, sans double comptage.
- La simulation est recoupée avec le journal d'audit du Core : identique pour les 926 comptes audités, et aucun
  mouvement administratif sur ces comptes.
- Chiffres :
  - 1 159 comptes, dont 930 avec WizeBot ;
  - **363 viewers monteraient**, de +3 niveaux en médiane, 12 d'au moins 50, au plus +85 ;
  - niveau max 60 → 141 ;
  - 888 correspondances certaines (identifiant Twitch), 42 probables (pseudo identique au 29/10), 0 ambiguë ;
  - 454 historiques WizeBot > 1 jamais rattachés, sans compte actif correspondant ;
  - 69 viewers sans WizeBot ont perdu de 1 à 11 niveaux affichés le 15/11 (changement de courbe), hors du périmètre
    d'une restauration WizeBot.
- Procédure proposée, non écrite : une normalisation version 2 par le chemin gardé du 15/11 (exposant 1, cible = max,
  qui rend le niveau WizeBot exact). Simulation, phrase tapée, audit par compte, annulable ; aucune annonce ; badges
  donnés sans annonce. **Décision d'Antoni.**
