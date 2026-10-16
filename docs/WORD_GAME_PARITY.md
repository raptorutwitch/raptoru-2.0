# Jeu des mots V1 — référence de parité (Lot 0)

> **Statut (16/10/2026) : JEU DES MOTS V1 FONCTIONNELLEMENT MIGRÉ ET VALIDÉ EN CONDITIONS RÉELLES.**
> **Validation réelle : 16/10/2026** (par Antoni) — vrai chat Twitch, Wallet Lab, sortie chat LeCroupier_, son OBS
> (SSE), Studio. **Pas encore en production** : l'activation définitive et la coupure du deck SAMMI dépendent du
> cutover économique global (Wallet canonique P1-001 lot 2, chat / session de production P1-007) — § 0.
> Rédigé le 16/10/2026 (Lot 0) ; règles inchangées depuis, sauf le mécanisme du son (§ 18).
> Ce document est la référence unique de la migration V1 du Jeu des mots (RET-WORD-001 à 005). Objectif :
> **pouvoir couper le Jeu des mots SAMMI sans perdre de fonction importante.** Parité fonctionnelle avec le legacy,
> pas de refonte. Toute règle ci-dessous cite sa preuve legacy (bouton / position dans le deck SAMMI) ou la décision
> d'Antoni qui la remplace (§ 25).

---

## 0. Checkpoint de migration (16/10/2026)

**Module prêt ; production en attente du cutover.** Commits locaux, branche `feat/compact-video-port`, non poussés :

| Lot    | Commit    | Contenu                                                                                                  |
| ------ | --------- | -------------------------------------------------------------------------------------------------------- |
| 0      | `b4a67aa` | docs(word-game): freeze legacy parity rules                                                              |
| 1      | `cf0e88b` | feat(word-game): implement legacy parity rules (règles pures, banque)                                    |
| 2      | `ebb9f12` | feat(word-game): reuse durable chat output queue (`cmd_steps` origin `word_game`)                        |
| 3      | `bde4c11` | feat(word-game): implement core game service (session, cycle, transaction unique, Wallet, routes Studio) |
| 4      | `d260f09` | feat(word-game): add Studio controls and OBS sound                                                       |
| 5      | `55bb8d1` | feat(word-game): forward plain chat messages to Core (Bot : tous les messages, plus seulement `!`)       |
| Son    | `3a89b9c` | refactor(word-game): push win sound events to OBS (SSE, remplace le polling du Lot 4)                    |
| Studio | `b82851f` | feat(word-game): add optional answer reveal in Studio                                                    |

**Validé par Antoni le 16/10/2026** (Studio Lab sur la vraie pile, puis vrai chat Twitch, SAMMI fermé) :
migrations Lab appliquées ; session live simulée commune détectée ; mot manuel et tirage planifié 5–15 min ; message
ordinaire ignoré ; bonne réponse depuis le vrai chat (casse ignorée, accents exigés) ; annonce réelle par
LeCroupier_ ; crédit Wallet Lab exact, un seul crédit par message ; série, casse-série, `!mots`, `!streakmot` ;
plusieurs mots / combo ; mot doré ×4 (un seul message `🔸 X 🔸`) ; Arrêter / Reprendre (mots actifs toujours
trouvables) ; restart Core dans la même session (état restauré) ; nouvelle session (mots abandonnés, remise à zéro) ;
aucun mot actif en double ; annonces de LeCroupier_ non réinjectées ; idempotence des `message_id` ; Wallet + stats +
série + victoire atomiques, échec Wallet = rollback complet ; son `ShuffleWordsSong.ogg` dans OBS par push SSE, sans
double son au replay / rechargement ; panneau Studio, avec « Voir la réponse » / « Masquer » par mot actif (caché par
défaut, état local à Studio, jamais envoyé au chat, à l'Extension ni à OBS).

**Exploitation Lab** (mise à jour 16/10/2026) : live simulé (session commune lue par le Jeu des mots), ingestion
Twitch et « Sortie chat réelle » se règlent dans l'onglet **Simulation** de Studio ou son panneau rapide (barre du
haut), avec confirmation avant toute écriture dans le vrai chat. Sortie réelle ON = LeCroupier_ écrit dans le vrai chat de `raptoru_` : couper le Jeu des mots SAMMI pendant
un test. La source OBS du son s'ajoute avec l'URL copiée depuis le panneau (sans elle, aucun son).

**Reste avant la production** (transversal, pas propre au module) : gains sur le Wallet canonique (P1-001 lot 2) ;
chat et session de production (P1-007, bot principal seul consommateur EventSub). Au cutover économique : désactiver
le deck SAMMI « Jeu des mots » (cycle de tirage, détection chat, `!mots`, `!streakmot`, annonces, son) et activer la
V1. D'ici là, SAMMI reste la production.

## 1. Architecture legacy prouvée

| Élément             | Emplacement                                                                                                                                                 | Preuve                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Moteur              | Deck SAMMI **« Jeu des mots »** dans `C:\Users\Antoni\Downloads\SAMMI.2022.5.3.x64\json\decks_data.json` (10 boutons)                                       | `on = 1` ; fichier du 08/10/2026 ; 40+ sauvegardes `before-jdm-*` / `before-jeu-des-mots-*` (13 → 21/09/2026, dernière `jdm-streakmot-scope-fix`) ; `Documents\Raptoru\SOURCE_OF_TRUTH.md` |
| Ancienne version    | Deck « Le jeu des mots ! » (28 boutons)                                                                                                                     | `on = False` — RET-WORD-006, obsolète                                                                                                                                                      |
| Banque              | `…\SAMMI.2022.5.3.x64\data\liste_mots.txt`                                                                                                                  | relue à chaque nouveau mot (`ShuffleWord` pos 0) ; 26/09/2026 ; SHA-256 `b455ae2d730f466ae4fd975bea9d4dedcbbaeea38f462537ab83f865011f0e2f`                                                 |
| Crédit Jetons       | Deck Principal, bouton `API_SE` (déclenché par `JeuDesMots` pos 117)                                                                                        | `PUT api.streamelements.com/kappa/v2/points/{compte}/{login}/{montant}` — par login, non idempotent                                                                                        |
| Stats / leaderboard | `Documents\Raptoru\Leaderboard\app\lb-app` : `api/sammi/find.js`, `lib/sammi-word-find.js`, Supabase `finds`, `players.best_word_streak`                    | appelé par mot (`JeuDesMots` pos 90) ; enregistre seulement (unique par `occurrence_id`), ne calcule rien                                                                                  |
| Session de live     | `api/sammi/find.js?action=session` (id de stream Helix)                                                                                                     | boutons `JDM_SESSION_SYNC` / `JDM_SESSION_CLEAR`                                                                                                                                           |
| Annonces de série   | Helix `POST /chat/announcements` au nom de lecroupier_                                                                                                      | bouton `JDM_STREAK_SENDER`                                                                                                                                                                 |
| Son                 | `C:\Users\Antoni\Documents\Rendu Audacity\ShuffleWordsSong.ogg` (44 072 octets, SHA-256 `bd301e4c19fb10738c7fcfd1209dc0a39f6a8a73e1ece6228195f4002c0fdf7f`) | `JeuDesMots` pos 115 (lecture locale)                                                                                                                                                      |
| Overlay visuel      | **aucun**                                                                                                                                                   | aucune source OBS / overlay Jeu des mots                                                                                                                                                   |

Boutons du deck actif : `RandShuffle` (cycle), `ShuffleWord` (nouveau mot), `ID99` (`!mots`), `JeuDesMots` (réponses),
`ID2` (`ARRET`), `JDM_SESSION_SYNC`, `JDM_SESSION_CLEAR`, `JDM_STREAKMOT` (`!streakmot`), `JDM_STREAK_ANNOUNCER`,
`JDM_STREAK_SENDER`. Positions = index de commande (base 0) ; `v0` d'un If / Loop = nombre de commandes du bloc.

Le deck contient le secret SAMMI du leaderboard en clair dans des URL : **il n'est recopié nulle part**.

## 2. Les 5 entrées RET-WORD (document canonique de migration du 06/10/2026)

| ID               | Besoin                                                             | Couverture V1                                                                         | État V2 au 16/10/2026 (registre du 06/10 : NON MIGRÉ)                                          |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **RET-WORD-001** | Chercher des mots et recevoir les gains ; consultation par `!mots` | §§ 3–5, 11, 14–17                                                                     | **MIGRÉ** · validé en réel le 16/10 (Wallet Lab)                                               |
| **RET-WORD-002** | Bonus mots dorés, rapidité et combos                               | §§ 5–7                                                                                | **MIGRÉ** · validé en réel le 16/10                                                            |
| **RET-WORD-003** | Séries pendant le live, consultation, annonces                     | §§ 8, 10, 11                                                                          | **MIGRÉ** · validé en réel le 16/10                                                            |
| **RET-WORD-004** | Bonus de rupture de série                                          | § 9                                                                                   | **MIGRÉ** · validé en réel le 16/10                                                            |
| **RET-WORD-005** | Statistiques et progression des trouvailles                        | § 21 (stats minimales enregistrées) ; affichage site / leaderboard = PLUS TARD (§ 24) | **PARTIEL** · critère V1 atteint (stats enregistrées) ; progression / affichage = APRÈS PILOTE |

RET-WORD-006 (ancien jeu des mots) reste obsolète. Le registre (PDF du 06/10/2026, hors dépôt) est figé : l'état à
jour des RET-WORD est cette colonne. « MIGRÉ » = fonction portée et validée ; l'**activation production** reste liée
au cutover économique (§ 0).

## 3. Règles fonctionnelles — vue d'ensemble

1. Pendant un live, un nouveau mot est publié toutes les **5 à 15 min** (aléatoire), précédé d'une annonce.
2. Le mot est publié **mélangé** ; les mots non trouvés restent jouables **jusqu'à la fin de la session de live**.
3. Tout message du chat qui **contient** un mot actif (casse ignorée, accents exigés) le gagne pour son auteur.
4. Gain par mot selon sa longueur × rapidité (× 4 s'il est doré), arrondi à 10 ; combo si plusieurs mots dans le
   même message ; prime de casse-série ; **un seul crédit total par message gagnant**.
5. Série globale (une seule pour la chaîne) ; annonces de palier ; `!mots`, `!streakmot`.
6. Un son est joué une fois par message gagnant.

## 4. Barème et formule de gain (`JeuDesMots` pos 64–85, init_variable `rewards`)

- **Base** = `rewards[longueur]` = **100 × longueur** (table 4 → 30 lettres ; la banque va de 4 à 19).
  La longueur est le nombre de caractères du mot (accents compris : « crâne » = 5).
- **Gain d'un mot** = `round((base × mult) / 10) × 10`, puis **× 4 si doré** (§ 6).
- `mult` selon l'âge du mot (§ 5).
- **Arrondi** : au plus proche. Le cas « exactement 0,5 » (possible seulement dans la rampe de patience) dépend du
  `round` de SAMMI, non vérifié ; V1 retient **la moitié vers le haut** (écart maximal de 10 Jetons sur ces cas rares).
- **Total du message** = Σ gains des mots + combo (§ 7) + prime de casse-série (§ 9).

## 5. Rapidité (`JeuDesMots` pos 64–73)

`âge = horodatage du message − horodatage de création du mot`, en **secondes** (horodatage SAMMI `{X}`, cohérent
avec la note legacy `jeu_des_mots_rewards_current.md` du 13/09/2026).

| Âge                | `mult`                                 | Drapeau « rapide » | Affichage du mot dans l'annonce                                    |
| ------------------ | -------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| < 30 s (strict)    | 3                                      | oui                | `⚡mot⚡`                                                          |
| 30 s ≤ âge < 300 s | 1                                      | non                | `"mot"` (guillemets droits)                                        |
| ≥ 300 s            | `1 + (âge − 300) / 1500`, plafonné à 2 | non                | `"mot"` ; **`✨mot✨` seulement quand `mult` = 2** (âge ≥ 1 800 s) |

Exemples de référence (mot de 6 lettres, base 600, non doré) — à reprendre tels quels dans les tests du Lot 1 :

| Âge        | mult  | Gain  |
| ---------- | ----- | ----- |
| 10 s       | 3     | 1 800 |
| 29 s       | 3     | 1 800 |
| 30 s       | 1     | 600   |
| 120 s      | 1     | 600   |
| 300 s      | 1     | 600   |
| 900 s      | 1,4   | 840   |
| 1 800 s    | 2     | 1 200 |
| 2 000 s    | 2     | 1 200 |
| 10 s, doré | 3 × 4 | 7 200 |

## 6. Mot doré

- À la création du mot, tirage entier uniforme **1–100** ; doré si `tirage < GOLDEN_WORD_CHANCE + 1` avec
  `GOLDEN_WORD_CHANCE = 10` → **10 %** (`ShuffleWord` pos 12–15).
- Gain du mot × `GOLDEN_WORD_MULTIPLIER = 4`, après l'arrondi (`JeuDesMots` pos 77–79).
- Annonce de trouvaille : suffixe ` 🪙 x4` (une fois, si au moins un mot doré dans le message ; pos 113–114).
- **Message de publication : voir § 12.2 — RÈGLE V1 VALIDÉE : UN SEUL MESSAGE.**

## 7. Combos (par message, `JeuDesMots` pos 95–104)

| Mots gagnés dans le même message | Bonus  |
| -------------------------------- | ------ |
| 1                                | 0      |
| 2                                | +500   |
| 3                                | +1 000 |
| 4                                | +2 500 |
| ≥ 5                              | +5 000 |

Chaque occurrence compte : un même mot présent deux fois parmi les mots actifs compte deux fois. En V1 ce cas
disparaît, puisqu'un mot actif n'est jamais tiré une deuxième fois (§ 16).

## 8. Série (`JeuDesMots` pos 31–63, `JDM_STREAKMOT`, `JDM_SESSION_*`)

- **Une seule série pour la chaîne** : détenteur (id Twitch, nom affiché) + compteur.
- Traitée **pour chaque mot gagné**, dans l'ordre de détection :
  - le détenteur gagne → compteur **+1** (un message de 3 mots = +3) ;
  - un autre viewer gagne → contrôle de casse-série (§ 9), puis il devient détenteur avec un compteur de **1**.
- **Session** : la série appartient à la session de live. Nouvelle session → série vide (V1 : pas de détenteur au
  début du live ; legacy : remise à zéro au premier mot gagné d'une nouvelle session, même effet observable).
- Un mot non trouvé ne casse pas la série.

## 9. Casse-série (`JeuDesMots` pos 46–63, 86–89, 127–129)

- Quand un viewer **différent** du détenteur gagne un mot alors que la série du détenteur est **≥ 3**.
- Prime selon la série cassée : **≥ 3 → 500 ; ≥ 5 → 1 000 ; ≥ 8 → 2 000 ; ≥ 12 → 4 000**.
- **Au plus une prime par message** (drapeau `breaker_awarded`), ajoutée au total du message.
- Annonce 2,1 s après l'annonce de trouvaille (§ 12.6).

## 10. Annonces de série (`JDM_STREAK_ANNOUNCER`, `JDM_STREAK_SENDER`)

Après chaque message gagnant, avec la série **finale** du message (détenteur = le gagnant) :

1. Si la session a changé depuis la dernière annonce → `dernier_annoncé = 0`, mémoriser joueur et session.
2. Si le joueur a changé → `dernier_annoncé = 0`, mémoriser le joueur.
3. Annoncer si `série ≥ 3` **et** (`dernier_annoncé = 0` **ou** `série ≥ dernier_annoncé + 3`).
   → annonces à 3, 6, 9… ; un saut de plusieurs mots en un message décale la suite (ex. 2 → 4 annonce à 4, puis ≥ 7).
4. Texte : palier par la série (3–4, ≥ 5, ≥ 8, ≥ 12), **variante tirée uniformément parmi 4** (§ 12.5).
5. `dernier_annoncé = série`.
6. Envoi en **annonce Twitch** (Helix, couleur primary = défaut) **2 000 ms** après le message gagnant.

L'état de l'annonceur (dernier annoncé, joueur, session) est persistant et lié à la session.

## 11. Commandes chat

| Commande     | Legacy                                                               | Comportement V1                                                                                                       |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `!mots`      | `ID99`, message exact, insensible à la casse, chat propre uniquement | liste des **mélanges** des mots actifs non trouvés ; délai **1 s commun à la chaîne** (`elapsed ≥ 1`) ; textes § 12.7 |
| `!streakmot` | `JDM_STREAKMOT`, message exact, insensible à la casse                | état de la série ; pas de délai ; textes § 12.8                                                                       |

Pas d'autre commande chat, ni streamer ni modérateur. Les contrôles streamer sont dans Studio (§ 14).
Un message de commande est aussi analysé comme réponse : dans le legacy, `!join angle` gagne « angle » (le
déclencheur `*` voit tous les messages).

## 12. Textes chat exacts

`@X` = nom affiché Twitch du viewer. Les nombres sont écrits sans séparateur de milliers. Apostrophe typographique
`’` (U+2019) dans « d’affilée », « s’arrête », « n’arrête ». Mode **annonce** = annonce Twitch (legacy `/announce …`) ;
mode **normal** = message ordinaire.

### 12.1 Annonce de cycle (`RandShuffle` pos 6) — mode annonce

`Trouve le mot caché parmi ces lettres et remporte des jetons !`

### 12.2 Publication du mot (`ShuffleWord` pos 19–21) — mode normal — **RÈGLE V1 VALIDÉE : UN SEUL MESSAGE**

| Mot    | Message V1 (unique) |
| ------ | ------------------- |
| normal | `-> MÉLANGE <-`     |
| doré   | `🔸 MÉLANGE 🔸`     |

**Lecture statique du deck** (pour mémoire) : pos 19 « If doré » contient seulement la pos 20 (`🔸 MÉLANGE 🔸`) ;
la pos 21 (`-> MÉLANGE <-`) est hors du If. Le deck envoie donc deux messages successifs pour un mot doré
(`🔸 X 🔸` puis `-> X <-`) et un seul pour un mot normal. Avant le correctif du 17/09/2026 (`golden-single-send`),
l'ordre était `-> X <-` puis `🪙 X 🪙`.
**Décision d'Antoni (16/10/2026) : 1 nouveau mot = 1 message.** Le mot doré est signalé uniquement par son rendu
(`🔸 … 🔸`), jamais suivi d'un deuxième message standard.

### 12.3 Trouvaille (`JeuDesMots` pos 123–126) — mode annonce

- 1 mot : `@X a trouvé le mot {MOTS} ! +{TOTAL} jetons{BONUS}{DORÉ}`
- plusieurs : `🔥 @X a trouvé {N} mots: {MOTS} ! +{TOTAL} jetons{BONUS}{DORÉ} 🔥`
- `{MOTS}` : chaque mot décoré selon § 5 (`⚡mot⚡`, `✨mot✨`, `"mot"`), séparés par `, `, dans l'ordre de détection
  (V1 : du mot actif le plus récent au plus ancien).
- `{BONUS}` (pos 105–112) :
  - combo et prime : ` (⚡ +{C} combo💥 +{B} breaker)`
  - combo seul : ` (⚡ +{C} combo)`
  - prime seule : ` (💥 +{B} breaker)`
  - aucun : vide
- `{DORÉ}` : ` 🪙 x4` si au moins un mot doré, sinon vide.

### 12.4 Casse-série (`JeuDesMots` pos 129) — mode annonce

`💥 @{CASSEUR} casse la streak de @{CASSÉ} ({N}) ! +{B} jetons !`

### 12.5 Annonces de série (`JDM_STREAK_ANNOUNCER` pos 15–46) — mode annonce

Suffixe commun : ` {N} mots d’affilée !`

| Palier | Variante 1                        | Variante 2                          | Variante 3                         | Variante 4                                 |
| ------ | --------------------------------- | ----------------------------------- | ---------------------------------- | ------------------------------------------ |
| 3–4    | `🔥 @X est EN FEU !`              | `🔥 @X commence à chauffer !`       | `🔥 @X prend feu !`                | `🔥 Ça chauffe pour @X !`                  |
| ≥ 5    | `🔥🔥 @X est INARRÊTABLE !`       | `🔥🔥 @X ne s’arrête plus !`        | `🔥🔥 @X enchaîne tout !`          | `🔥🔥 Quelle série pour @X !`              |
| ≥ 8    | `⚡ @X entre en DOMINATION !`     | `⚡ @X roule sur le jeu !`          | `⚡ @X est en pleine DOMINATION !` | `⚡ Rien n’arrête @X !`                    |
| ≥ 12   | `👑 @X devient MAÎTRE DES MOTS !` | `👑 @X règne sur le Jeu des mots !` | `👑 @X est au SOMMET !`            | `👑 Le royaume des mots appartient à @X !` |

### 12.6 Ordre et délais d'un message gagnant

| Instant       | Effet                                     |
| ------------- | ----------------------------------------- |
| t0            | son (§ 18) ; annonce de trouvaille (12.3) |
| t0 + 2 000 ms | annonce de série, si due (12.5)           |
| t0 + 2 100 ms | annonce de casse-série, si due (12.4)     |

### 12.7 `!mots` — mode annonce

- `🎲 Mots restants : {M1} | {M2} | …` (mélanges, du plus récent au plus ancien)
- `Aucun mot en cours !`

### 12.8 `!streakmot` — mode annonce

| État                          | Texte                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| aucun détenteur ou compteur 0 | `🔥 Aucune streak du Jeu des mots en cours.`                     |
| compteur 1 ou 2               | `🔥 @X est à {N} mots d’affilée.` (« 1 mots » conservé tel quel) |
| compteur ≥ 3                  | `🔥 @X est actuellement EN FEU : {N} mots d’affilée !`           |

## 13. Délais exacts

| Délai                                 | Valeur                                                            | Source                                          |
| ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| Intervalle entre deux mots            | entier uniforme **300 000 – 900 000 ms**                          | `RandShuffle` pos 4                             |
| Premier mot d'un live                 | même tirage après l'ouverture de la session (pas de mot immédiat) | `RandShuffle` déclenché par « stream en ligne » |
| Annonce de cycle → publication du mot | **500 ms**                                                        | `RandShuffle` pos 7                             |
| Message gagnant → annonce de série    | **2 000 ms**                                                      | `JDM_STREAK_SENDER` pos 1                       |
| Message gagnant → casse-série         | **2 100 ms**                                                      | `JeuDesMots` pos 127                            |
| `!mots`                               | 1 s commun à la chaîne                                            | `ID99` pos 2                                    |

## 14. Live, session, arrêt, redémarrage

- **Session** = la session de live du Lab, lue par l'unique lecteur `liveChannelSession` (`apps/core-api/src/stream/
channel-sessions.ts`, ASTRA-P1-007). Elle est ouverte et fermée par l'événement de stream Twitch (ou « Simuler
  début de stream » dans Studio), **quelle que soit la configuration de la Tombola** (seul son planificateur en
  dépend). Le Jeu des mots **lit** la session, il ne l'écrit jamais.
- **Hors live** (aucune session ouverte) : aucun nouveau mot, **aucune détection**, `!mots` → « Aucun mot en
  cours ! », `!streakmot` → « Aucune streak… ». Le jeu est considéré arrêté.
- **Chaque occurrence de mot porte son `session_id`.** Mot actif = non trouvé **et** `session_id` = session
  ouverte. Série et état de l'annonceur sont aussi liés à la session.
- **Nouvelle session** : zéro mot actif, série vide, annonceur remis à zéro ; les mots non trouvés des sessions
  précédentes sont marqués **abandonnés**, jamais réactivés. Aucune contamination entre streams.
- **Même live revu après une coupure** (la session existante est rouverte par `streamEvent`) : même session, donc
  ses mots actifs, sa série et son annonceur sont restaurés.
- **Redémarrage du Core ou de Studio pendant la même session** : tout est relu en base (mots actifs, série,
  annonceur, heure du prochain mot). Si l'heure du prochain mot est **déjà dépassée** : **exactement un** mot généré
  immédiatement, puis reprise du cycle 5–15 min. Pas de rattrapage multiple.
- **Studio « Arrêter »** : arrête la génération de nouveaux mots pour la session en cours. Les mots déjà actifs
  restent trouvables jusqu'à la fin de la session. La session suivante repart normalement (cycle actif, zéro mot).
- **Studio « Nouveau mot »** = clic legacy sur `ShuffleWord` : un mot tout de suite, **sans** l'annonce de cycle,
  un seul message (§ 12.2). Seulement pendant un live. Ne décale pas le cycle (le legacy ne le faisait pas).
- **Studio, affichage** : statut (actif / arrêté / hors live), mots actifs avec mélange, mot clair et âge, série
  (détenteur et compteur), dernières trouvailles (validation / débogage).

## 15. Redémarrage — résumé

| Situation                                 | Mots actifs                | Série / annonceur | Prochain mot                                   |
| ----------------------------------------- | -------------------------- | ----------------- | ---------------------------------------------- |
| Restart Core ou Studio, même session      | restaurés                  | restaurés         | heure conservée ; si dépassée → 1 mot immédiat |
| Coupure puis même live (session rouverte) | restaurés                  | restaurés         | idem                                           |
| Nouvelle session                          | aucun (anciens abandonnés) | vides             | 5–15 min après l'ouverture                     |
| Hors live                                 | aucun actif                | —                 | aucun                                          |

## 16. Tirage et doublons

- Banque **legacy complète**, copiée **à l'identique** dans le dépôt (SHA-256 au § 1) : 15 737 lignes, UTF-8
  (forme NFC), minuscules, 4 à 19 lettres, 4 296 mots accentués.
- Le seul doublon (`loser`, deux lignes) est neutralisé au chargement → **15 736 mots distincts**. Aucun autre mot
  retiré ni modifié.
- Tirage **uniforme**, en **excluant les mots actifs** de la session. Un mot trouvé ou abandonné peut revenir plus
  tard. Pas d'historique global ni de rotation forcée.
- Mélange : permutation aléatoire des caractères du mot (`ShuffleWord` pos 4–6). Le mélange peut, rarement,
  redonner le mot lui-même (comme le legacy).

## 17. Casse et accents

- **Détection par sous-chaîne** : le mot est trouvé s'il apparaît n'importe où dans le message (`String Position > 0`,
  `JeuDesMots` pos 27–28). « chat » est trouvé dans « château ». Pas de découpage en mots.
- **Casse ignorée** : `ANGLE` trouve `angle`. Preuve statique : la doc SAMMI de String Position a une case
  « Case Insensitive » ; elle est cochée (`v0 = 1`) sur toutes les recherches de texte du deck et décochée (`v0 = 0`)
  seulement pour la recherche de `+` (Lucky Wheel). Décision d'Antoni : insensible à la casse.
- **Accents exigés** : aucune normalisation dans le legacy (aucune commande entre le message et la recherche).
  `CRÂNE` trouve `crâne` (casse ignorée, y compris pour les lettres accentuées) ; `CRANE` ne trouve pas `crâne`.
- V1 : minuscules Unicode des deux côtés, puis recherche de sous-chaîne. Aucune autre transformation.

## 18. Son

- `ShuffleWordsSong.ogg` (§ 1), versionné dans le dépôt (asset unique du module, pas de catalogue).
- Joué **une fois par message gagnant**, quel que soit le nombre de mots (`JeuDesMots` pos 115, hors de la boucle).
- Mécanisme : une **source navigateur OBS servie par Studio**. Aucun visuel, aucun accusé de réception, aucun
  paiement lié au son. Un son manqué (source fermée) ne change rien d'autre.
- **Mécanisme final (`3a89b9c`, validé en réel le 16/10/2026) : push, sans polling.** Le polling 1 s de `recent` du
  Lot 4 initial est supprimé. Chaîne : victoire entièrement commitée (mots, série, stats, Wallet, victoire) →
  `WordGameWinEvent` (`channel_id`, `message_id` Twitch, `created_at`) → SSE Core → Studio
  (`GET /v1/lab/word-game/:channel/events`, Lab uniquement) → SSE Studio → source OBS (`/word-game/events`, jeton,
  `EventSource`) → `ShuffleWordsSong.ogg`.
- Aucun événement si le Wallet est refusé (rollback), sur un message rejoué, ni pour `!mots`, `!streakmot` ou
  « Nouveau mot ». La source mémorise les derniers `message_id` joués (aucun double son) ; reconnexion sans rejeu de
  l'historique. Une victoire pendant une coupure peut être ratée : accepté pour la V1.

## 19. Contrat de sortie chat — `cmd_steps` (feu vert d'Antoni, 16/10/2026)

Réutilisation de la file durable existante de Commands V2 ; **aucun deuxième circuit chat**.

- **Schéma** (migration Lab) :
  - `invocation_id` devient **facultatif** ;
  - nouvelle colonne `origin text not null default 'commands'`, valeurs `commands` ou `word_game` ;
  - contrainte : `origin = 'commands'` ⇔ `invocation_id is not null` ;
  - les lignes existantes restent valides sans modification ; la clé étrangère vers `cmd_invocations` est conservée
    pour les lignes Commands.
- **Lignes word_game** : `executor = 'twitch_chat'`, `kind = 'action'`, `type = 'chat'`, `on_error = 'continue'`,
  `params = { mode: 'normal' | 'announce', text }`, `available_at` = instant voulu (§ 13), expiration
  inchangée (60 s).
- **Clés d'idempotence dédiées**, uniques et stables :
  - annonce de cycle : `jdm:word:<occurrence_id>:cycle` ;
  - publication : `jdm:word:<occurrence_id>:publish` ;
  - trouvaille / série / casse-série : `jdm:msg:<message_id>:find` / `:streak` / `:breaker` ;
  - `!mots` / `!streakmot` : `jdm:cmd:<message_id>`.
- **Inchangé** : un seul message en cours par chaîne, ordre de file (le message en tête attend son heure d'envoi,
  rien ne le double), attribution sous bail, accusés de réception liés à la tentative, réessais seulement si
  l'envoi n'a certainement pas eu lieu, « inconnu » jamais renvoyé, expiration.
  Conséquence acceptée : un délai du Jeu des mots (≤ 2,1 s) peut retarder d'autant une réponse Commands.
- **Annulation en cascade de Commands** (`on_error = 'stop'`, par invocation) : **n'agit jamais** sur une ligne
  word_game (garde explicite sur `origin`, en plus de `invocation_id` nul).
- **Interrupteur « Sortie chat réelle »** (`cmd_channels.chat_output`) : le même pour Commands et le Jeu des mots.
  Le Jeu des mots crée la ligne `cmd_channels` de la chaîne si elle manque, **sans jamais changer l'interrupteur**.
- **Exécuteur Bot** (`apps/twitch-bot/src/lab-chat-output.ts`) : **aucune modification** — il ne lit pas
  `invocation_id` et sait déjà envoyer `normal` et `announce` (scopes `user:write:chat`,
  `moderator:manage:announcements`), au nom de **LeCroupier_**, avec journal et limite de débit.
- **Diagnostics Studio** (liste des steps) : `invocation_id` peut être absent ; `origin` est affiché.
- **Tests** : `commands-v2-steps.test.ts` et `lab-chat-output.test.ts` restent inchangés et verts ; des tests
  ajoutés couvrent les lignes word_game (ordre, délais, cascade sans effet, idempotence).

## 20. Contrat d'ingestion chat

- **Bot** (`apps/twitch-bot/src/lab-chat-ingest.ts:157`) : le filtre qui ne garde que les messages commençant par
  `!` est retiré ; **tous** les messages (≤ 500 caractères, comme aujourd'hui) vont au même endpoint `/v1/lab/chat`,
  avec le même `message_id` et la même politique de réessai (dédoublonnage par le Core). Les messages du compte du
  bot restent ignorés.
- **Router Core** (`apps/core-api/src/lab-chat/router.ts`) : une option `plainText: true` par module. Un message qui
  ne commence pas par `!` n'est transmis **qu'aux modules qui l'ont activée** (le Jeu des mots). Tombola et Commands
  ne voient rien de nouveau : leur comportement ne change pas.
- **Jeu des mots** : reçoit **tous** les messages (commandes comprises, cf. § 11) ; hors live, jeu arrêté ou aucun
  mot actif → réponse « ignoré », sans écriture ni journal.
- **Aucun stockage des messages** : seules les trouvailles sont persistées (§ 21). Pas de journal par message.
- Pas de bus d'événements, pas de framework.
- **Dépendance de cutover (connue)** : ce chemin est celui du Lab. En production, il faudra la frontière chat de
  P1-007 (un seul consommateur EventSub).

## 21. Idempotence et données persistées

- **Traitement d'un message gagnant = une seule transaction** sous le verrou de la chaîne : prise des occurrences,
  calcul, série / casse-série / annonceur, crédit Wallet, stats, mise en file des messages chat. Deux messages
  simultanés ne peuvent jamais gagner la même occurrence.
- **Occurrence** : `occurrence_id` unique par mot généré ; gagnée une seule fois (`found_at` posé une seule fois, avec
  le `message_id` gagnant).
- **Message** : un enregistrement unique par `(chaîne, message_id)` gagnant ; un renvoi du même message renvoie le
  résultat déjà enregistré, sans nouvel effet.
- **Limite connue** (acceptée) : un message traité sans gain puis renvoyé par le Bot (réponse perdue, renvoi
  ≤ 15 s) est réévalué ; il pourrait gagner un mot publié entre-temps. Fenêtre de quelques secondes, sur réponse
  perdue seulement.
- **Génération de mot** : sous le même verrou ; au plus un mot par échéance du cycle. Le bouton Studio « Nouveau
  mot » porte une clé de requête (un double clic = un seul mot).
- **Stats minimales (RET-WORD-005)**, une ligne par mot gagné : viewer (id Twitch, nom affiché), mot, points du mot
  (rapidité et doré compris, **hors combo et prime**, comme l'envoi legacy au leaderboard), rapide, doré, série
  après ce mot, `occurrence_id`, `message_id`, session, date. Plus une ligne par message gagnant : total, combo,
  prime, opération Wallet.

## 22. Wallet

- **Un seul crédit par message gagnant**, montant = total du message (§ 4), clé d'idempotence
  `jdm:<channel_id>:<message_id>`, dans la transaction de traitement (§ 21).
- Crédit à l'**id Twitch** du viewer (le legacy créditait par login).
- **Lab** : Wallet de test, monnaie Jetons, comme les gains de Tombola (`lab_wallet_ledger`) — nouvelle valeur de
  `kind` (`word_game`) dans la migration du Lot 2.
- **Production** : Wallet canonique via le port économique (P1-001 lot 2), **à la bascule économique**. Avant elle,
  aucun appel réel à StreamElements et pas de coupure du Jeu des mots SAMMI (les vrais soldes y sont encore).
- Un message chat perdu n'annule jamais un crédit déjà fait (comme le legacy).

## 23. Critères de validation (RET-WORD-001 à 004 = MIGRÉ ; RET-WORD-005 = stats enregistrées)

État au 16/10/2026 : automatiques verts ; manuels validés par Antoni (§ 0), sauf « un vrai stream complet » et le
cutover.

Automatiques (Lots 1–4) :

- [x] Cas de référence du § 5, combos § 7, primes § 9, paliers et variantes § 10 / 12.5.
- [x] Sous-chaîne, casse ignorée (y compris lettres accentuées), accents exigés (§ 17).
- [x] Plusieurs mots par message, série +1 par mot, prime au plus une fois.
- [x] Deux messages simultanés → un seul gagnant ; renvoi d'un `message_id` → aucun double crédit ni message.
- [x] Session : nouvelle session → zéro mot, série vide ; restart même session → restauration ; heure dépassée → un
      seul mot.
- [x] Hors live → aucune détection, aucun mot.
- [x] Tirage sans mot actif en double ; doublon de banque neutralisé.
- [x] `cmd_steps` : tests Commands inchangés verts ; lignes word_game ordonnées, sans cascade.
- [x] Router : Tombola et Commands ne reçoivent pas les messages ordinaires.

Manuels, par Antoni (« validé » = testé par Antoni) :

- [x] Lab, simulateur Studio puis vrai chat (chaîne de test, ou Jeu des mots SAMMI coupé pendant le test pour
      éviter un double jeu) : mot publié (normal et doré, **un seul message**), trouvaille, combo, série et annonces,
      casse-série, `!mots`, `!streakmot`, textes au caractère près.
- [x] Son joué une fois par message gagnant dans OBS.
- [x] Crédit unique visible dans le Wallet de test.
- [x] « Arrêter », « Nouveau mot », restart Core pendant un live.
- [ ] Un vrai stream complet sans erreur (à observer au premier stream réel en V1).
- [ ] Cutover (pas encore) : à la bascule économique (Wallet canonique, chat de production P1-007), désactiver le deck SAMMI
      « Jeu des mots », activer la V1.

## 24. PLUS TARD (hors V1, ne bloque rien)

UI Extension Jeu des mots · nouvelle UX viewer · nouveaux modes (mot maudit, lettre cachée) · nouveaux bonus ·
nouveaux effets / animations / overlay visuel · rééquilibrage · tolérance aux fautes · normalisation des accents ·
détection par mot entier · expiration des mots · historique global de tirage · leaderboard / site V2 complet ·
import de l'historique legacy (`finds`, `best_word_streak`) · succès « mots » et nouveaux succès · stats enrichies ·
personnalisation avancée (textes, barème, intervalle dans Studio) · application de la pause globale / des blocages
de la Modération au jeu · catalogue d'assets · SDK · moteur d'automatisation · refonte économique.

## 25. Écarts volontaires entre V1 et le legacy technique

| Point                      | Legacy technique                                                                                 | V1                                                             | Raison                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Mot doré                   | 2 messages (`🔸 X 🔸` puis `-> X <-`)                                                            | **1 message** `🔸 X 🔸`                                        | décision d'Antoni                                                            |
| Mots entre streams         | conservés dans des variables persistantes                                                        | **abandonnés à chaque nouvelle session**                       | décision d'Antoni : le legacy réel repartait sans mots à la relance de SAMMI |
| Hors live                  | la détection tournait si SAMMI recevait le chat (seules les stats étaient bloquées côté serveur) | **aucune détection ni génération**                             | décision d'Antoni                                                            |
| Doublons de tirage         | un mot actif pouvait être retiré                                                                 | **jamais un mot déjà actif** ; doublon de la banque neutralisé | décision d'Antoni                                                            |
| Restart pendant un live    | boucle `RandShuffle` morte jusqu'au prochain « stream en ligne » ou clic manuel                  | cycle restauré ; un seul mot si l'échéance est passée          | décision d'Antoni                                                            |
| Concurrence                | course possible entre messages simultanés → double crédit StreamElements possible                | transaction unique, crédit idempotent                          | correction interne                                                           |
| Crédit                     | par login, StreamElements                                                                        | par id Twitch, Wallet Raptoru                                  | migration                                                                    |
| Messages du bot            | analysés comme les autres                                                                        | ignorés (le compte du bot ne joue pas)                         | correction interne, aucun effet pour les viewers                             |
| Compte d'envoi             | compte SAMMI pour la plupart, lecroupier_ pour les séries                                        | LeCroupier_ pour tout                                          | décision d'Antoni                                                            |
| Session inconnue           | la série continuait                                                                              | n'arrive pas (jeu seulement en live)                           | conséquence de la règle hors live                                            |
| Remise à zéro au démarrage | `RandShuffle` remettait à zéro des variables locales, sans effet                                 | série liée à la session                                        | même effet observable                                                        |
| Arrondi à 0,5 exact        | `round` de SAMMI (non vérifié)                                                                   | moitié vers le haut                                            | cas rare, ≤ 10 Jetons                                                        |
| Délais                     | précédés d'appels HTTP au leaderboard (latence variable)                                         | délais exacts du § 13                                          | fidélité au rythme voulu                                                     |
