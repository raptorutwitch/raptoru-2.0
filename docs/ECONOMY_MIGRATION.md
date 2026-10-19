# Migration économique StreamElements → Wallet Raptoru

**Statut (19/10/2026) : préparation. Pilote de lecture StreamElements fait (§ 7, lecture seule) ; aucun import, aucune bascule.** Production =
Jetons StreamElements. Base de travail : audit Astra `docs/LEGACY_DATA_MIGRATION_AUDIT_2026-10.md` (16/10, non suivi
par git), revérifié ici dans le code, les decks SAMMI (lecture seule, `decks_data.json` du 18/10) et la configuration
locale. Légende : **PROUVÉ** (vu / exécuté) · **POSSIBLE** (non testé) · **INCERTAIN** · **DÉCISION** (Antoni).

## 1. État réel

### 1.1 Wallet canonique (Core) — PROUVÉ par le code et les tests

- Monnaies (`main` = Jetons), soldes `bigint`, opérations à clé d'idempotence (même clé + autre contenu → refus), ledger
  `wallet_transactions` append-only (trigger), verrous par portefeuille dans un ordre stable, `spendIn` / `creditIn`
  dans la transaction de l'appelant (débit + admission atomiques), transfert sans taxe, corrections admin, dette admin
  possible, classement, historique. Tests : `wallet`, `economy-core-wallet`, `economy-movements`, `daily-wallet`,
  intégration PostgreSQL réelle (`economy.integration` : 8 requêtes parallèles même clé → 1 débit ; 10 achats sur un
  solde de 3 → 3).
- Branché mais **OFF** : Daily → Wallet (`DAILY_WALLET_CREDITS`), Loyalty passif / événements (`LOYALTY_*`, règles
  « 50 Jetons / 6 min », subs, gifts, bits, follow, dons — validées techniquement en septembre), chat `!solde` /
  `!give` / `!wallet` (`WalletChat`).
- **Pas branché** : `coreWalletEconomy` refuse `hold` / `move` / `transfer` (`canonical_not_wired`) → Jeu des mots,
  Roulette / Slot / Duel, gains Tombola ne peuvent pas encore payer en vrai ; Bonk / Sons / TTS : tables
  d'interactions Lab (`payment_mode = 'simulated'`) et modèle des crédits non décidé (D2) ; Roue du Sub : port
  `WheelAwardPort` prêt, aucun adaptateur.
- Aucune base de production n'existe (D3) ; la migration prod du Wallet n'a jamais tourné ailleurs qu'en test / staging.

### 1.2 Wallet Lab — PROUVÉ

`lab_wallets` (tokens, credits_tts, credits_soundboard), fictif (12 000 Jetons par viewer de test), utilisé par tous
les modules Lab via `labEconomy`. **Ne se migre jamais** (ni soldes, ni ledger, ni interactions).

### 1.3 Qui écrit des Jetons en production aujourd'hui — PROUVÉ (decks SAMMI actifs + plan de cutover)

| Producteur / consommateur                                            | Écrit chez SE par                                 | Remplaçant Raptoru                                |
| -------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Gains passifs, bonus follow / sub / bits / dons                      | StreamElements (loyalty)                          | Loyalty Engine (OFF)                              |
| Roulette, Slot, Duel                                                 | bot StreamElements                                | V1 Lab (Wallet Lab) → `move` canonique à brancher |
| Jeu des mots, Tombola (paiement `API_SE_RAFFLE_WORKER`)              | SAMMI → `PUT /points`                             | V1 / V2 Lab → `move` canonique à brancher         |
| `!daily`                                                             | SAMMI → site `raptoru.fr` → SAMMI `add_jetons`    | Daily Core (OFF) + import Daily legacy            |
| Roue du Sub (ID1)                                                    | SAMMI → `PUT /points`                             | Roue Raptoru (OFF, gains en attente)              |
| `!cashin` (Points de chaîne → Jetons, 100 → 10)                      | SAMMI                                             | rien (Points de chaîne V1 peut le porter)         |
| `!fx` (ID19), `!rb` (ID74), Caution, `!tts` (chat)                   | SAMMI (`remove_jetons`)                           | rien en Jetons                                    |
| Soundboard / TTS / Bonk de l'Extension publiée                       | EBS legacy `raptoru.fr` (holds sur les points SE) | V2 Lab (paiement simulé)                          |
| `!blacklist` / `!whitelist` (« blacklist du casino »)                | SAMMI → **modifie `loyalty.ignored` de SE**       | rien                                              |
| Banque `!banque` / `!depot` / `!retrait`                             | SAMMI (fichier ini)                               | fermée (« coming soon™ »)                         |
| 24H : crédits sur sub / gift, `!echange` (Jetons → crédits), `!code` | SAMMI, deck **24H actif**                         | rien (monnaie à part)                             |
| Classement / profils du site `raptoru.fr`                            | lit SE                                            | à rebrancher sur Core ou figer                    |

## 2. Données StreamElements

| Donnée                                           | Besoin                                          | Récupération                                                                                                         | Statut                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Solde courant par viewer                         | **indispensable**                               | `GET /kappa/v2/points/{canal}/top?limit&offset` (+ `_total`)                                                         | route PROUVÉE (doc officielle, appelée par SAMMI / legacy) ; plafond de page, exhaustivité, zéros **INCERTAINS** |
| Viewers « blacklist casino » (`loyalty.ignored`) | indispensable (absents possibles du classement) | `GET /kappa/v2/loyalty/{canal}` puis lecture individuelle                                                            | lecture déjà faite par SAMMI ; effet sur le classement **INCERTAIN**                                             |
| Identité Twitch                                  | indispensable                                   | SE ne renvoie que `username` ; rapprochement Helix (100 logins / appel) + sources à ID (alertes, chat Lab, Supabase) | **INCERTAIN** pour les pseudos changés / recyclés                                                                |
| Cumul gagné, watchtime                           | statistique, pas un solde                       | `/alltime`, `/watchtime`, fiche individuelle                                                                         | POSSIBLE                                                                                                         |
| Réglages loyalty, commandes du bot, boutique SE  | équivalence fonctionnelle                       | `GET loyalty`, `GET bot/commands`, `GET store/items`                                                                 | POSSIBLE (lecture)                                                                                               |
| Journal des transactions SE                      | **pas disponible de façon prouvée**             | —                                                                                                                    | aucun delta fiable → snapshot final complet sous gel                                                             |

Accès : un **JWT StreamElements est déjà enregistré dans Studio** (`se-connection.json`, chiffré par Windows, type
`jwt`, identifiant de canal SE présent — PROUVÉ sans lecture du secret), utilisé pour les dons. Il permet ces
lectures sans nouveau jeton ; il permet aussi d'écrire : l'outil d'export ne fera que des `GET`.

## 3. Stratégie recommandée

1. **Un seul écrivain, une seule bascule** (décision déjà prise au plan de cutover) : pas de double écriture SE + Core,
   pas de pont.
2. **Aucun delta** : SE n'expose pas de journal. Les exports anticipés servent à préparer les identités et à mesurer ;
   le seul export importé est **le snapshot final complet, pris sous gel**, comparé à un second passage identique.
3. **Import d'ouverture unique** (fait, § 4) : un fichier approuvé par Twitch ID, appliqué en une transaction, refusé
   par la base s'il est rejoué sous un autre nom ou ajouté à des soldes vivants, contrôlable à tout moment.
4. **StreamElements n'est jamais modifié** pendant la migration : son état gelé est la sauvegarde. Retour arrière
   avant la première écriture Core = rouvrir SE. Après les premières transactions Raptoru : **retour arrière NON
   garanti** (consigne d'Antoni, 19/10) tant qu'une méthode sûre de réconciliation Core → SE n'est pas démontrée
   (outil à écrire, répété à blanc ; toute écriture SE → accord explicite).
5. **Identités prudentes** : ID connu → direct ; login seul → Helix au moment du snapshot + concordance avec une source
   à ID ; tout le reste → quarantaine avec son montant (réclamable sur preuve), jamais fusionné au pseudo.
6. **Événements pendant le gel** : capturés sans paiement par les chemins déjà durables (alertes, roue « en attente »,
   Loyalty en aperçu) puis attribués une fois après la bascule. Manque prouvé : une récompense Loyalty « aperçu » ne
   passe jamais « à créditer » aujourd'hui → petite promotion explicite à écrire (même clé, donc jamais deux fois).

## 4. Fait dans ce lot (local, tests uniquement)

- Migration prod `20261028130000_wallet_opening_import.sql` : table `wallet_imports` (un import d'ouverture **par
  monnaie, à vie**, empreinte sha256 du fichier) + index unique « **un seul `opening_balance` par portefeuille** ».
- `apps/core-api/src/wallet/opening-import.ts` + `npm run wallet:opening-import -w @raptoru/core-api -- <snapshot.json>
[--apply=<id>|--verify]` : essai à blanc par défaut ; application en une transaction (tout ou rien) ; refus listés
  (doublon d'ID, dette, monnaie, portefeuille déjà mouvementé, autre import) ; contrôle compte par compte (ouverture =
  snapshot, aucune ouverture hors snapshot, solde = ledger, totaux) valable même après la reprise des mouvements.
- **Renforcé le 19/10/2026 (§ 10)** : format, contrôle sous verrou et vérification ont changé depuis ce lot.
- Tests `wallet-opening-import` (7) : plan sans écriture, application exacte, rejeu → « déjà appliqué », autre
  snapshot refusé, portefeuille mouvementé / dette / doublon refusés sans rien écrire, panne au milieu → rien gardé
  puis réimport propre, seconde ouverture refusée par la base, contrôle après dépense et anomalies détectées.
- Répétition sur une base PostgreSQL locale **jetable** (supprimée ensuite), 8 000 comptes **fictifs** : plan → refus
  sans l'identifiant retapé → deux imports simultanés (un appliqué, l'autre refusé proprement) → contrôle OK (écart 0,
  2 502 633 764 Jetons) → second snapshot refusé. Durée ≈ 50 s.

## 5. Décisions d'Antoni

| #   | Décision                                                                                                                                                                        | Recommandation                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| E1  | Pilote de **lecture** StreamElements (réglages loyalty, classement paginé, quelques fiches, commandes du bot, boutique) avec le JWT déjà dans Studio, résultats gardés en local | **oui** : c'est lui qui lève les incertitudes du § 2                                                       |
| E2  | Viewers non rapprochés d'un Twitch ID                                                                                                                                           | quarantaine, montant réservé, attribution sur preuve                                                       |
| E3  | Monnaies et dettes annexes : crédits 24H, Roue du Sub en attente, banque fermée (fichier à vérifier vide), soldes négatifs SE éventuels                                         | 24H archivés (non convertis) ; roue rapprochée puis payée par le Wallet ; dettes : décision au cas par cas |
| E4  | Équivalence au jour J : ce qui doit marcher en Jetons à la bascule (§ 1.3) et ce qu'on accepte de couper                                                                        | tout le tableau sauf banque et 24H                                                                         |
| E5  | Fenêtre de gel (hors live) et durée de retour arrière                                                                                                                           | 1er stream après bascule                                                                                   |

## 6. Critères pour déclarer la bascule possible (tous requis)

1. **Exhaustivité SE** : nombre de comptes exportés = `_total` annoncé, ignorés inclus ; deux passages identiques
   sous gel ; top 20 + 50 comptes tirés au hasard identiques à leur fiche individuelle.
2. **Identités** : 100 % des comptes rapprochés ou en quarantaine avec leur montant ; somme rapprochée + somme en
   quarantaine = somme SE ; aucun rapprochement par similarité.
3. **Import** : plan sans refus, application, contrôle `ok` (écart 0 sur chaque compte), relance → « déjà appliqué »
   — d'abord sur une répétition complète avec le vrai snapshot dans une base jetable.
4. **Équivalence** : chaque ligne du § 1.3 a son remplaçant branché au Wallet canonique et testé (Lab), ou une coupure
   décidée (E4) ; `coreWalletEconomy` ne refuse plus rien d'utilisé.
5. **Gel prouvé** : écrivains SAMMI / SE / EBS coupés, soldes SE identiques entre deux passages espacés.
6. **Retour arrière répété** : plan Core → SE produit et vérifié à blanc.
7. Aucun test n'a touché un vrai solde (bases jetables, Wallet Lab).

## 7. Pilote de lecture StreamElements (19/10/2026, autorisé par Antoni — E1)

Fait le 19/10 vers 02:20 (heure de Paris), hors live, **uniquement des requêtes GET** (≈ 90 au total), avec le JWT
déjà enregistré par Studio : déchiffré par un processus Electron séparé, sur une copie isolée de la clé (supprimée
ensuite), jamais affiché ni écrit ; Studio n'a pas été modifié ni redémarré. Outil :
`apps/studio/server/src/economy/se-points-export.ts` (tests `se-points-export` : pages plafonnées, 429, erreur = arrêt,
canal vérifié, GET uniquement, résumé sans pseudo). Données brutes (pseudos, soldes) gardées en local hors dépôt.

| Question                                                                           | Résultat                                                                                                                                                                                                                              | Statut                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Accès                                                                              | le jeton ouvre bien le canal configuré (`channels/me`)                                                                                                                                                                                | PROUVÉ                           |
| Comptes récupérables                                                               | **2 886** comptes, `_total` = 2 886, pages de 1 000 (3 pages), page suivante vide ; **somme 41 021 548 Jetons** (min 10, médiane 240, 7 comptes ≥ 1 M)                                                                                | PROUVÉ                           |
| Stabilité                                                                          | deux passages complets **identiques** (comptes, soldes, somme)                                                                                                                                                                        | PROUVÉ (hors live)               |
| Cohérence avec les fiches                                                          | **73 / 73** fiches individuelles (top 20, échantillon réparti, blacklistés) = solde du classement                                                                                                                                     | PROUVÉ                           |
| Comptes à zéro                                                                     | absents du classement : le seul compte du classement « alltime » (2 717) hors classement courant a une fiche à **0**                                                                                                                  | PROUVÉ (rien à perdre)           |
| Blacklist casino (`loyalty.ignored`, 4 entrées)                                    | les 2 qui ont un solde **sont dans le classement**, fiche identique ; les 2 autres n'ont **aucun compte** SE (404)                                                                                                                    | PROUVÉ                           |
| Dettes (soldes négatifs)                                                           | aucune vue (classement, alltime) ; un compte négatif sans gains cumulés serait invisible                                                                                                                                              | INCERTAIN (ne lèse aucun viewer) |
| « alltime » comme recensement                                                      | **non** : 170 comptes du classement n'y figurent pas (Jetons ajoutés par `PUT`, sans gains comptés)                                                                                                                                   | PROUVÉ                           |
| Identité fournie par SE                                                            | **aucune** : classement, alltime et fiche ne donnent que `username` (fiche : + `pointsAlltime`, `watchtime`, `rank`)                                                                                                                  | PROUVÉ                           |
| Rapprochement Twitch (Get Users par login, jeton d'application temporaire révoqué) | **2 691 comptes résolus = 40 538 328 Jetons (98,8 %)** ; **193 pseudos introuvables = 327 220 Jetons (0,8 %)**, dont 4 > 10 000 (max 115 190) ; **2 noms avec espace** (impossibles sur Twitch) = 156 000 Jetons ; aucun ID en double | PROUVÉ                           |
| Pseudo résolu = bon titulaire ?                                                    | non démontré : SE ne garde pas l'ID ; un ancien pseudo libéré puis repris donnerait le solde au nouveau titulaire. 171 comptes résolus créés sur Twitch depuis 2025 (284 494 Jetons, 3 > 10 000)                                      | INCERTAIN                        |
| Comptes techniques                                                                 | `streamelements`, `wizebot`, `lecroupier_`, `raptoru_` ont un solde                                                                                                                                                                   | PROUVÉ (décision)                |
| Durée d'un export complet                                                          | **45 s** (2 passages + 73 fiches)                                                                                                                                                                                                     | PROUVÉ                           |

**Réglages de fidélité SE** (lecture) : monnaie « Jetons », **10 Jetons toutes les 6 min**, multiplicateur abonné ×2,
bonus follow 500, sub 2 200, don 600, cheer 750, raid 0. Écart avec la configuration Raptoru actuelle (50 Jetons / 6
min, T1 ×2 · T2 ×2,5 · T3 ×4, sub 2 000 / 4 000 / 10 000, dons 500–700 / €, bits 700–1 000 / 100) : **gain passif ×5**
et barèmes différents → à trancher avant la bascule (E4), sinon l'économie change de rythme le jour J.

**Conclusion du pilote.** L'export des soldes est **exhaustif et reproductible** pour tout compte ayant un solde
positif (aucun plafond, aucune pagination instable, blacklistés inclus, zéros sans enjeu) et rapide (gel court
possible). Le risque restant est **l'identité** : 1,2 % des Jetons (193 + 2 comptes) sans titulaire Twitch trouvé, et
aucune preuve que le titulaire actuel d'un pseudo est l'historique. Sources possibles pour les lever : base Supabase
legacy (`players` : Twitch ID + login, rattachements) — lecture distante **à autoriser** —, archives locales SAMMI,
réclamation sur preuve.

## 8. Identités : méthode de rapprochement (19/10/2026)

Règle d'Antoni : **le `twitch_user_id` est l'identité canonique ; un compte en quarantaine plutôt qu'au mauvais
viewer.** `apps/core-api/src/wallet/se-identity.ts` (tests `se-identity`) classe chaque compte SE à partir de trois
lectures : Twitch maintenant (login → ID), Twitch maintenant par ID (pour les ID de l'historique), et les paires datées
(ID, pseudo) de l'historique :

| Statut         | Règle                                                                                                                      | Solde                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `confirmed`    | l'historique a vu ce pseudo avec un seul ID, qui est le titulaire actuel                                                   | attribuable                          |
| `renamed`      | pseudo abandonné ; l'historique nomme un seul titulaire, toujours existant                                                 | attribuable                          |
| `current_only` | pseudo résolu aujourd'hui, jamais vu dans l'historique                                                                     | **décision** (plausible, non prouvé) |
| `ambiguous`    | plusieurs titulaires dans l'historique, titulaire historique ≠ actuel (pseudo réattribué), ou titulaire historique disparu | quarantaine                          |
| `unresolved`   | ni compte actuel ni historique                                                                                             | quarantaine                          |
| `invalid`      | pas un login Twitch (espace…)                                                                                              | examen à la main                     |

Un même ID derrière deux comptes SE est signalé (deux soldes d'une même personne, ou un mauvais rapprochement).

**Sans la base legacy** (historique = Lab + journal Spotify SAMMI, 216 paires) : 21 comptes `confirmed` (18 839 307
Jetons, les plus gros), 2 670 `current_only` (21 699 021 Jetons, dont 87 > 10 000), 193 `unresolved` (327 220), 2
`invalid` (156 000), aucun ID partagé. **La lecture de la base Supabase legacy** (autorisée par Antoni le 19/10, lecture
seule) apportera les paires de `players`, `player_wallet_peaks` (pseudo SE ↔ ID, la meilleure preuve), `finds`,
`events`, `credit_events`, `twitch_subscriptions`, `raffle_stats`, `daily_legacy`, `daily_events`,
`wizebot_snapshots` ; lecteur prêt (API REST de Supabase, GET seulement, pagination avec total exact vérifié, testé sur
un faux serveur) — lu le 19/10 (§ 8.1).

### 8.1 Avec la base Supabase legacy (19/10/2026, lecture seule autorisée par Antoni)

Projet vérifié avant extraction (`supabase.raptoru.fr`, `raptoru_` présent dans `players`, les 200 derniers pseudos de
`player_wallet_peaks` tous présents chez SE). API REST, **GET uniquement**, 10 tables lues en entier (total exact vérifié
à chaque table) en 32 s : 269 019 paires (ID, pseudo) datées. La clé n'a été ni affichée ni copiée (vérifié par
recherche sur le poste) ; aucune écriture.

| Statut                                                               | Comptes | Jetons     | Part   |
| -------------------------------------------------------------------- | ------- | ---------- | ------ |
| `confirmed`                                                          | 485     | 38 304 874 | 93,4 % |
| `renamed` (pseudo abandonné, titulaire historique unique retrouvé)   | 15      | 155 520    | 0,4 %  |
| `current_only` (titulaire actuel du pseudo, aucune trace historique) | 2 205   | 1 772 570  | 4,3 %  |
| `unresolved`                                                         | 178     | 171 700    | 0,4 %  |
| `ambiguous`                                                          | 1       | 460 884    | 1,1 %  |
| `invalid` (nom avec espace)                                          | 2       | 156 000    | 0,4 %  |

- **Qualité des preuves** : 162 comptes confirmés / renommés (37 204 961 Jetons, 90,7 % du total) le sont par des
  sources de première main (Jeu des mots, crédits, événements, Daily, Tombola, pics de solde, `players`) ; 338 (1 255 433
  Jetons) seulement par les relevés Wizebot (rattachement du collecteur legacy, à l'époque du relevé).
- **Le seul cas ambigu est `raptoru_`** (compte du streamer) : son ID partout de juin à octobre 2026 dans 8 sources, plus
  une seule trace du 02/09/2026 (`players` + `events`) sous un autre ID — probablement une donnée de test.
- **Pseudos réattribués détectés : aucun** (aucun pseudo dont le titulaire historique diffère du titulaire actuel).
  **Renommages retrouvés : 15**, dont le plus gros compte jusque-là introuvable (115 190).
- **3 viewers ont deux comptes SE** (ancien et nouveau pseudo, même ID) : 2 530 + 120, 740 + 460, 590 + 20.
- `current_only` : 11 comptes > 10 000 (le plus gros 300 000 ; comptes Twitch créés entre 2012 et 2020, sauf un de
  2026), 126 entre 1 000 et 10 000 (275 390), 2 068 ≤ 1 000 (505 610). La date de création Twitch ne prouve rien : un
  compte ancien peut avoir pris un pseudo libéré.
- `unresolved` : 178 comptes, les plus gros 37 460, 19 050, 18 000 ; 160 ≤ 1 000.
- Comptes techniques : `raptoru_` (ambigu ci-dessus), `lecroupier_` 174 410 (confirmé), `wizebot` 4 700 (confirmé),
  `streamelements` 3 300 (titulaire actuel seulement).
- Revue nominative pour Antoni (sur son poste, hors dépôt) : `C:\Users\Antoni\Documents\Raptoru\_migration-exports\se-pilot-2026-10-19\revue-identites.csv`.

### 8.2 Cas incertains approfondis et politique d'attribution proposée (19/10/2026)

Vérifications ajoutées, toutes en lecture seule : lignes legacy du compte `raptoru_`, fiabilité de chaque source
historique, liste des followers (1 907, avec date) et abonnés actuels (307) de `raptoru_` via le jeton broadcaster déjà
stocké (utilisé tel quel, jamais renouvelé, fichier inchangé), archives SAMMI locales, recherche Twitch des noms
invalides. Aucune attribution, aucun import.

**Constats.**

- **`raptoru_`** : l'ID discordant est `0`. Il vient de 3 tests automatiques de l'Extension du 02/09/2026 (« admin-test
  … smoke-soundboard », montant 0) qui ont aussi créé une ligne `players` fictive. Ce n'est pas un compte Twitch
  (un ID Twitch est un nombre positif) : la règle ignore désormais ces ID (`se-identity.ts`), et `raptoru_` est confirmé
  sur 83603689.
- **Source historique défaillante** : les événements **Bonk** du legacy (Extension et SAMMI) enregistrent souvent l'ID
  du streamer ou d'un bot avec le pseudo du viewer (848 paires fausses). Ils sont exclus des preuves ; un « renommage »
  de 1 000 Jetons qui ne reposait que sur eux redevient introuvable. Toutes les autres sources (Jeu des mots, crédits,
  Daily, Tombola, pics de solde, `players`, relevés Wizebot) : **aucune contradiction** avec Twitch aujourd'hui.
- **SE garde des comptes séparés par pseudo** : les 3 doubles comptes ont chacun un ancien et un nouveau compte SE ;
  le changement de pseudo ne déplace pas le solde.
- **Doubles comptes : fusionnables sans ambiguïté** : pour chacun, un seul ID, des périodes successives sans
  chevauchement (ancien pseudo puis nouveau). Dans le fichier d'ouverture, une ligne par ID (somme des deux, les deux
  comptes dans `sources`, cf. § 10) ; la base refuse toute seconde ouverture du même portefeuille.
- **Noms invalides** : un seul morceau du nom à 150 000 existe sur Twitch, compte qui ne suit pas la chaîne ; rien pour
  6 000. Probablement des saisies manuelles.
- **Archives SAMMI locales** : elles ne contiennent que des pseudos (pas d'ID) ; elles datent l'activité d'un pseudo,
  sans prouver qui le détient.

**Bilan (2 886 comptes, 41 021 548 Jetons, chaque compte dans un seul panier, somme conservée).**

| Panier                      | Comptes                              | Jetons                  | Preuve                                                                                                                                                              |
| --------------------------- | ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attribuable avec preuve** | 497 (→ 494 portefeuilles, 3 fusions) | **38 280 284 (93,3 %)** | même ID vu avec ce pseudo dans l'historique : 159 comptes (37 024 851) par des sources directes, 338 (1 255 433) par les relevés Wizebot datés — dont 14 renommages |
| **Probable**                | 343                                  | 169 060 (0,4 %)         | titulaire actuel du pseudo qui **suit** la chaîne (202) et / ou y est **abonné** (164), sans trace historique                                                       |
| **Réservé**                 | 2 042                                | 1 928 910 (4,7 %)       | 1 861 titulaires actuels sans aucun signal (1 600 210, dont 10 > 10 000 = 980 670), 179 introuvables (172 700), 2 noms invalides (156 000)                          |
| **Comptes techniques**      | 4                                    | 643 294 (1,6 %)         | `raptoru_` 460 884, `lecroupier_` 174 410, `wizebot` 4 700, `streamelements` 3 300                                                                                  |

Essai à blanc du fichier d'ouverture (base vide jetable, supprimée) : prêt, aucun refus, 494 portefeuilles,
38 280 284 Jetons, **aucune écriture**.

**Politique proposée (simple, sans grosse interface).**

1. **Au cutover** : seuls les comptes **prouvés** sont importés (import d'ouverture unique, doubles fusionnés).
2. **Tout le reste est réservé, jamais perdu, jamais payé automatiquement** : une ligne par compte SE à la coupure
   (pseudo, montant, panier, ID candidat **figé à la coupure**, signaux), sans échéance par défaut.
3. **Réclamation** : le viewer tape `!recuperer` dans le chat (Twitch authentifie son ID). Core enregistre une demande
   « à valider » seulement si son ID est l'ID candidat figé à la coupure ; pour un introuvable / nom invalide,
   `!recuperer <ancien pseudo>` enregistre une demande sans correspondance automatique. Antoni valide ou refuse, avec
   une note (une courte liste dans Studio ou une commande, pas d'interface lourde). Le paiement est un crédit Wallet à
   clé `legacy-claim:<pseudo SE>` : chaque compte SE est payé au plus une fois.
4. **Anti-usurpation** : ID figé à la coupure (un pseudo pris après la bascule ne peut rien réclamer) ; aucune
   validation automatique ; pour les gros montants, une preuve en plus (reconnaissance par Antoni ou les modérateurs) ;
   chaque décision journalisée. Limite : un compte SE dont le pseudo a été repris **avant** la coupure par un autre
   viewer reste indiscernable sans l'historique Twitch des pseudos ; c'est déjà le cas aujourd'hui chez SE, qui crédite
   et débite par pseudo.

## 9. StreamElements conserve-t-il le Twitch ID des comptes de fidélité ? (19/10/2026)

Enquête : documentation officielle (variables du chatbot, OpenAPI `api-docs`, centre d'aide), code public du tableau de
bord StreamElements (lecture des fichiers JavaScript servis), une requête GET (`/kappa/v2/bot/{canal}/users`, champs
seulement), et les données du pilote. Aucune commande créée, aucun message de chat, aucune écriture.

| Constat                                                  | Preuve                                                                                                                                                                                                                                                                                                                                                        | Statut                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| SE **garde un lien interne** compte ↔ utilisateur Twitch | aide officielle « Loyalty: Troubleshooting » : après un changement de pseudo, points et temps de visionnage sont **transférés automatiquement la première fois que le viewer écrit avec son nouveau nom** ; `$(user.twitchid)` = « User's platform user ID », seulement pour les utilisateurs **vus par le bot** dans la chaîne                               | PROUVÉ (doc)                                                      |
| Ce lien **n'est exposé par aucune API de fidélité**      | OpenAPI officielle : `/points/{canal}/{user}`, `top`, `alltime`, `watchtime`, ajout, mise à jour en masse — tous par `username` ; le tableau de bord SE lui-même ne lit que `username` + montant (même son import / export CSV laisse l'identifiant vide) ; nos réponses réelles : `username`, `points` (+ `pointsAlltime`, `watchtime`, `rank` sur la fiche) | PROUVÉ                                                            |
| `/bot/{canal}/users` porte des `providerId`…             | 16 entrées : la liste des **utilisateurs à permissions** du bot, pas les comptes de fidélité                                                                                                                                                                                                                                                                  | PROUVÉ (sans valeur pour la migration)                            |
| `$(user.twitchid X)` à grande échelle                    | uniquement dans une **commande de chat** : créer une commande (modification SE) et poster **un message public par viewer** (≈ 2 400 messages pour les comptes non prouvés), soumis aux délais du bot, sans garantie documentée sur un pseudo abandonné ou repris                                                                                              | **non utilisable** (interdit sans accord, irréaliste, non fiable) |
| Ce que renverrait `$(user.twitchid)`                     | la doc ne dit pas si elle lit l'utilisateur que le bot a **vu** sous ce pseudo (ancien titulaire) ou le titulaire **actuel** ; aucun moyen de le vérifier sans message public                                                                                                                                                                                 | INCERTAIN                                                         |
| Comptes créés par erreur                                 | SE crée un compte pour **n'importe quel texte** reçu en ajout de points (nos 2 noms avec espace) ; les 3 doubles comptes montrent que le transfert automatique **n'a pas eu lieu** quand un compte existait déjà sous le nouveau pseudo (créé par un ajout SAMMI)                                                                                             | PROUVÉ (données)                                                  |

**Ce que cela change à notre lecture des données** (sans changer la méthode) : grâce au transfert automatique, un
viewer actif qui change de pseudo emporte ses points ; un pseudo SE **périmé** est donc celui d'un viewer qui n'a plus
écrit depuis son changement — exactement nos « renommés » (retrouvés par l'historique) et une partie des
« introuvables ». Pour les « titulaires actuels sans trace », le risque reste qu'un pseudo libéré ait été repris : aucune
donnée SE accessible ne permet de le lever.

**Conclusion : la piste ne fournit pas de Twitch ID exploitable.** On garde le rapprochement par l'historique
(`se-identity.ts`) et la politique « prouvés importés, le reste réservé et réclamable ». Seule option restante, à
l'accord d'Antoni et de faible valeur : un essai limité avec une commande réservée aux modérateurs sur 3 à 5 pseudos
connus (renommé, introuvable, confirmé), pour savoir quel titulaire elle renvoie — sans pouvoir l'étendre à tous les
comptes.

## 10. Import d'ouverture renforcé (phase technique 1, 19/10/2026)

Correctifs des constats de l'audit contradictoire d'Astra sur l'import (B3, I1, I2) et préparation des rattachements /
exclusions de la sélection. Local et tests uniquement : aucun solde réel lu ni importé.

**Format du fichier d'ouverture (strict, tout champ inconnu refusé)** :

- `source_snapshot` : empreinte sha256 du snapshot StreamElements brut, nombre de comptes et total qu'il contenait.
- `rows` : une ligne par Twitch ID (`^[1-9]\d{0,31}$`, jamais « 0 »), `login` Twitch, `balance`, et `sources` — chaque
  compte StreamElements versé sur ce Twitch ID (plusieurs pour un rattachement). `balance` = somme des `sources`.
- `excluded` : comptes sources non repris (`source_ref`, `balance`, `reason`) ; jamais un portefeuille, jamais le ledger.
- Refus (essai à blanc comme application) : compte source en double (deux Twitch ID, ou importé et exclu), ligne ≠ somme
  de ses sources, comptes ou total importés + exclus ≠ snapshot source, Twitch ID en double, dette, monnaie, autre import.

**Application (une transaction)** : registre → **verrou de chaque portefeuille cible** (ordre stable, celui de toute
opération Wallet, `WalletService.lockPristineIn`) et refus si solde ≠ 0 ou ligne de ledger **sous ce verrou** → une
ouverture par ligne positive → chaque compte source enregistré (`wallet_import_sources`, migration
`20261029130000`, append-only : importé vers son Twitch ID, ou exclu) → **contrôle complet avant commit** (tout écart :
rien n'est validé). Un crédit validé avant le verrou fait refuser l'import ; un crédit arrivé pendant attend le commit
et s'ajoute après l'ouverture, qui reste exacte.

**Contrôle (`--verify`, valable à tout moment)** : le registre contient CE fichier (ID, sha256, source, cutoff, totaux,
empreinte et totaux du snapshot source), chaque compte source est enregistré une fois avec son sort, chaque ouverture a
son montant et ses références, aucune ouverture hors fichier, chaque portefeuille de la monnaie = son ledger,
ouvertures + exclus = total du snapshot source. Sans import, ou pour un autre fichier : jamais « ok ».

**Reprise** : une panne avant le commit ne laisse rien ; une réponse perdue après le commit se résout en relançant le
même fichier (« déjà appliqué », puis contrôle) — jamais un second paiement, jamais un autre lot pour lever le doute.

**Tests** : `wallet-opening-import` (14, PGlite) et `wallet-opening-import.integration` (4, PostgreSQL réel, deux
connexions : crédit en vol contre import, crédit pendant l'import, deux imports simultanés, panne et rollback).

**Reste ouvert (hors de ce lot)** : générer ce fichier depuis le manifeste de sélection validé (et refaire le snapshot
au gel) ; validateur bloquant de l'exporteur StreamElements (B4) ; gel et capture des événements (B5) ; raccordement des
modules au Wallet canonique (B6) ; service de réserve (I4).

## 11. Convertisseur sélection → fichier d'ouverture (phase 1B, 19/10/2026)

`npm run wallet:opening-from-selection -w @raptoru/core-api -- <manifeste.json> <export-brut.json> --import-id=<id>
[--out=<ouverture.json>]` (`src/wallet/selection-to-opening.ts`). Pur et reproductible : aucune base touchée, mêmes
entrées → mêmes octets ; sans `--out`, validation seule ; n'écrase jamais un fichier existant. Aucun solde ni pseudo
codé en dur : tout vient du manifeste.

- Une ligne par Twitch ID destinataire ; comptes repris et rattachés regroupés dans `sources` ; exclus dans `excluded`
  (motif = décision + règle) ; empreinte de l'export brut dans `source_snapshot`, empreinte du manifeste et politique
  dans `provenance` (liées au registre par le sha256 du fichier).
- Refus : manifeste non validé, incomplet ou avec problème, compte sans décision ; export brut différent (compte absent
  ou en trop, solde différent, passes différentes, autre date) ; compte en double ; destination absente, rattachement
  non vérifié ou sans cible, Twitch ID cible ≠ destination, compte cible non repris ou d'une autre destination, deux
  pseudos pour un Twitch ID ; importé + exclu ≠ total.
- Tests `wallet-selection-to-opening` (5, données fictives) : conversion, import puis contrôle, refus.
- 19/10 : le manifeste réel (13 h 59) est refusé pour la seule raison `wenou` (Twitch ID cible 37006561 ≠ `wenuyr` 172305417) ; l'export brut correspond par ailleurs exactement (2 886 comptes, 41 021 548 Jetons).

## 12. Raccordement des modules au Wallet canonique (phase 2, 19/10/2026)

**Port unique** : tous les modules payants passent déjà par `EconomyPort` (`economy/economy.ts`), dans la transaction
de leur propre décision. Adaptateurs : `labEconomy` (portefeuille Lab fictif, 12 000 Jetons créés par viewer, défaut
partout) et `coreWalletEconomy` (Wallet canonique, Jetons = monnaie `main`). Un seul point de choix :
`economy/activation.ts` (`selectEconomy`) — Lab par défaut ; canonique refusé tant qu'aucun import d'ouverture n'est
appliqué ou qu'un module du runtime n'est pas prouvé (`CANONICAL_READY`). Aucun lanceur ne l'active.

| Module                         | Mouvements                                                  | Monnaie         | Rejeu / doublon                            | Échec après paiement                                   | État canonique                                                                    |
| ------------------------------ | ----------------------------------------------------------- | --------------- | ------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Jeu des mots                   | un gain par message                                         | Jetons          | clé message                                | tout dans la transaction du message                    | **raccordé (lot 1)**                                                              |
| Roulette / Slot                | mise et gain net par message                                | Jetons          | clé message, cooldown                      | idem                                                   | **raccordé (lot 1)**                                                              |
| Duel                           | transfert perdant → gagnant à l'acceptation                 | Jetons          | clé du duel                                | idem                                                   | **raccordé (lot 1)**                                                              |
| Bonk (et salves)               | débit à l'admission, remboursements auto / modération       | Jetons          | clé d'admission                            | remboursement différé (savepoint)                      | débit/remboursement prouvés ; historique et modération lisent `lab_wallet_ledger` |
| Soundboard                     | débit Jetons ou crédits ; points de chaîne payés sur Twitch | Jetons, crédits | clé d'admission                            | idem                                                   | idem + crédits (D2)                                                               |
| TTS                            | débit Jetons ou crédits, remboursements                     | Jetons, crédits | clé d'admission                            | idem                                                   | idem + état des remboursements lu dans `lab_wallet_ledger`                        |
| Tombola                        | gains (`raffle_win`) dans la monnaie du tirage              | Jetons ou autre | déduplication lue dans `lab_wallet_ledger` | gain « failed » rejouable                              | à adapter                                                                         |
| Roue du Sub                    | gains « en attente », jamais crédités                       | Jetons          | clé du tour                                | port non branché (I3)                                  | à concevoir                                                                       |
| Points de chaîne, Random Ban   | payés en points Twitch                                      | points          | redemption Twitch                          | remboursement Twitch                                   | hors Wallet                                                                       |
| Daily                          | crédit quotidien                                            | Jetons          | clé de demande                             | B5 : fournisseur factice OFF = « crédité » sans argent | canonique derrière `DAILY_WALLET_CREDITS` (OFF)                                   |
| Présence / Loyalty             | gains passifs, bonus d'événements                           | Jetons          | clés d'événement / tick                    | outbox du bot (B5)                                     | canonique derrière flags (OFF) ; barème à décider                                 |
| `!solde` / `!give` / `!wallet` | lecture, transfert                                          | Jetons          | clé de commande                            | transaction Wallet                                     | canonique (commandes du bot OFF)                                                  |
| Modération Lab                 | ajustement manuel                                           | Jetons, crédits | clé d'action (P1-009)                      | transaction                                            | portefeuille Lab seulement                                                        |

**Lot 1 (fait)** : `WalletService.lockIn` / `transferIn` ; `hold` / `move` / `transfer` canoniques (Jetons seulement,
clé obligatoire, rejeu = même résultat sans second paiement, crédits jamais convertis, monnaie indisponible = refus du
module) ; Jeu des mots, Roulette / Slot, Duel prouvés sur le Wallet canonique (PGlite) et en concurrence réelle avec le
Bonk sur un même portefeuille (PostgreSQL, deux connexions). Core Lab : option `economy` (Lab par défaut, inchangé).

**Lot 2 (fait)** : le port porte aussi les lectures (`balances`, `interactionMovements`, `debitedInteractions`,
`ledger`) ; Bonk, Soundboard, TTS et la modération Lab ne lisent plus `lab_wallet_ledger` / `lab_wallets` en
direct (file TTS « payée », fiche viewer, détail d'une interaction, « Activité Jetons », solde de l'Extension). En
canonique : crédits `null` (jamais 0), ajustement manuel et portefeuille de test refusés
(`canonical_wallet_tools_not_wired`). Core Lab : la même `economy` pour tous ses modules (Lab par défaut). Prouvé
en canonique : salves (tout ou rien), remboursements automatiques (expiration, échec avant lecture) et de modération
(annulation, pause « annuler et rembourser ») une seule fois, y compris après redémarrage et depuis deux Core à la fois
(PostgreSQL) ; trois modules dépensant en même temps sur un portefeuille trop court. `CANONICAL_READY` : Bonk prêt ;
Soundboard et TTS bloqués par leurs crédits (D2 : monnaie secondaire distincte, gagnée seulement par des récompenses
de points de chaîne, jamais convertie ; paramétrage reporté) ; outils de portefeuille de la modération bloqués.

**Lot 3 (fait)** : Tombola V2 — un seul mouvement économique, le gain (inscriptions gratuites). L'anti-doublon de
`pay()` et l'historique d'un tirage lisent les gains par le port (`raffleWins`) ; en canonique, la clé
`move:raffle_win:<tirage>:<gagnant>` rend tout rejeu (ticks, redémarrage, `retry_payout`, réponse perdue) sans second
crédit. `acceptsCurrency` : en canonique, seuls les Jetons ; un tirage en crédits TTS / Soundboard ou autre monnaie Lab
est refusé à la configuration et à l'ouverture (rien d'annoncé, jamais converti ; règles Lab inchangées). Prouvé : tirage
à plusieurs gagnants vers des portefeuilles vierges, sans participant, panne avant crédit (rien gardé), réponse perdue
après crédit, Jetons indisponibles (échec visible, relance payée une fois) ; PostgreSQL : même tirage pris par deux Core,
gagnant payé pendant des dépenses Bonk, même relance depuis deux Core. `CANONICAL_READY` : Tombola prête.

**Lot 5 (fait)** : Roue du Sub — en canonique, le gain d'une roue décidée est crédité dans la transaction de la roue
(clé `move:sub_wheel:<spin_id>`, ligne verrouillée), refus = « en attente » avec sa raison, gain d'avant jamais payé
automatiquement (`award()` explicite), « crédité à la main » fermé en canonique, annulation et `award()` sérialisés sur
la même ligne (course I3 fermée). Rien n'est crédité avec le portefeuille Lab. Prouvé : portefeuille vierge,
redélivrance et redémarrage, panne avant commit, réponse perdue, Jetons indisponibles puis `award()`, viewer sans
Twitch ID, gain d'avant, règlement manuel, gain nul, tests Studio et cadeaux ; PostgreSQL : même sub sur deux Core,
`award()` ×2 contre annulation, gain pendant des dépenses Bonk et un gain Tombola. `CANONICAL_READY` : Roue prête.

**Lot 6 (fait)** : modération « Créditer / Débiter » par le port (`adjust` → `WalletService.adminAdjustIn`, dans la
transaction de l'action : borné à 0 — un débit ne rend jamais négatif —, dédupliqué par la clé de l'action, audité,
permissions inchangées) ; l'outil « portefeuille de test » reste Lab seulement. `!solde` / `!give` / `!wallet` :
déjà canoniques (clé = id du message Twitch). Daily crédits OFF : crédit « en attente » pour le Wallet canonique, rien
envoyé, payé une fois à l'activation (B5 corrigé). Loyalty : `occurredAt` (heure Twitch) transmis par le bot ; en
mode crédit, un événement antérieur au cutoff de l'import est « exclu » (déjà payé par StreamElements).
`economyPreflight` + `selectEconomy`. `CANONICAL_READY` : outils de portefeuille de la modération prêts.

**Lot 4 (fait)** : crédits TTS / Soundboard, voir § 14.

**Suite proposée** : lot 7 hébergement des modules par un Core au schéma Wallet et activation au cutover.

## 13. Gel et bascule : qui crédite des Jetons, et comment le vérifier (phase 2 lot 6, 19/10/2026)

| Écrivain de Jetons                                                                      | Aujourd'hui                                                                        | Au gel / à la bascule                                                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| StreamElements (fidélité : 10 / 6 min, bonus follow 500, sub 2 200, don 600, cheer 750) | **seul écrivain réel**                                                             | arrêt manuel par Antoni ; snapshot sous gel = cutoff de l'import              |
| SAMMI (Roue du Sub, commandes payantes, jeux, crédits SE)                               | production                                                                         | decks à couper au gel (hors Raptoru)                                          |
| Site / Supabase legacy (Tombola, Daily legacy, pics)                                    | lecture seule pour la migration                                                    | vérifier l'arrêt de tout écrivain avant le snapshot                           |
| Bot Raptoru : événements Loyalty (outbox), `!daily`, `!solde` / `!give` / `!wallet`     | drapeaux OFF                                                                       | activés seulement après l'import ; l'heure Twitch accompagne chaque événement |
| Core Daily                                                                              | `DAILY_WALLET_CREDITS=false` : crédits « en attente » (`core-wallet`), rien envoyé | activé → chaque crédit payé une fois (clé `daily-claim:<id>`)                 |
| Core Loyalty / présence                                                                 | `LOYALTY_PREVIEW` / `_PASSIVE_CREDITS` / `_EVENT_CREDITS` OFF                      | aperçus jamais payables ; événement antérieur au cutoff « exclu »             |
| Modules (Bonk, Soundboard, TTS, Tombola, jeux, Jeu des mots, Roue, modération)          | portefeuille Lab fictif (12 000 / viewer)                                          | `selectEconomy('canonical')` : un seul port pour tous les modules du runtime  |

**Garanties en place** : frontière = `wallet_imports.cutoff` (registre de l'import, lié au fichier et au snapshot) ;
`economyPreflight` (lecture seule) bloque sans import et tant qu'un gain de Roue du Sub d'avant la bascule n'est pas
rapproché, et liste ce qui attend (crédits Daily, récompenses Loyalty en attente) ; `selectEconomy` refuse en plus
tout module non prouvé (`CANONICAL_READY` : tous les modules prouvés depuis le lot 4). Aucun lanceur ne l'appelle :
l'activation reste un geste explicite du cutover (lot 7). Les rapprochements se font sur le ledger canonique (sources,
clés, références) et le registre `wallet_import_sources`.

**Événements Twitch durables (19/10/2026)** : Loyalty — outbox fichier du bot (écrite avant l'envoi, retirée après la
réponse du Core, reprise au démarrage, refus bornés) ; alertes du Lab (et donc gains de la Roue du Sub) — même outbox
(`.lab-alerts-outbox.json`) au lieu des nouvelles tentatives en mémoire abandonnées après 90 s. Chaque événement garde son
id Twitch (idempotence du Core) et son heure Twitch (`occurred_at` / `occurredAt`, nanosecondes acceptées) ; un sub ou
un événement Loyalty antérieur au cutoff reçu après l'import n'est jamais payé automatiquement (Roue : « en attente,
avant la bascule : à rapprocher » ; Loyalty : « exclu »). Limite Twitch : un événement émis pendant qu'aucune session
WebSocket n'est ouverte n'est jamais reçu (Twitch ne rejoue pas une session perdue). Messages du chat (Jeu des mots,
mini-jeux) : politique décidée inchangée (ASTRA-P1-002, 15 s en mémoire) — aucun Jeton n'a bougé tant que le message
n'est pas admis.

**Restent ouverts** : barèmes (passif 50 / 6 min chez Raptoru contre 10 chez StreamElements, bonus) ; crédits TTS /
Soundboard : fait (§ 14) ; `!wallet remove` / `set` peuvent créer une dette (monnaie `main` : `allow_negative_admin = true`,
règle existante) ; affichage d'une alerte reçue très en retard (aucune règle d'âge dans la file des alertes : à décider) ;
hébergement et activation au cutover (lot 7).

## 14. Crédits TTS et Soundboard (phase 2 lot 4, 19/10/2026)

**Modèle** : deux monnaies secondaires du **même** Wallet canonique (`currencies` : `credits_tts` « Crédits TTS »,
`credits_soundboard` « Crédits Soundboard » — migration `20261030130000_wallet_credit_currencies.sql`, non
transférables, jamais négatives). Pas de second Wallet, pas d'échange, aucune conversion en Jetons ni entre elles.
Aucun crédit créé à l'ouverture (l'import ne touche que la monnaie principale). Un solde est un vrai 0 quand le viewer
n'a rien ; `null` seulement si la monnaie n'est pas installée ou désactivée (jamais un zéro fictif).

**Obtention — uniquement par une récompense de points de chaîne** : nouvelle action de règle
`{ type: 'credits', currency, amount }` (Studio : « Accorder des crédits (TTS / Soundboard) »). Le nombre est fixé
par la règle, **aucune valeur par défaut, aucune règle créée** : rien n'est crédité tant qu'Antoni n'a pas configuré
une récompense. Exécutée dans la transaction de réception (clé `move:channel_points:cp:<source>:<redemption>:<index>`,
la redemption Twitch étant déjà unique) : une redemption redélivrée, rejouée par l'outbox ou reçue par deux Core
donne un seul crédit. Interrupteur Points de chaîne OFF, règle absente / désactivée → rien. Redemption « en retard »
(> 2 min, reprise après panne) → **seulement** ses crédits (les points sont dépensés ; pas d'effet OBS ni de son
décalé). Test Studio (simulation) → aucun crédit. Monnaie indisponible → action « échec » visible, redemption gardée.

**Annulation Twitch** : abonnement `channel.channel_points_custom_reward_redemption.update` (même scope
`channel:read:redemptions`). « canceled » (Twitch a rendu les points) → les crédits accordés sont repris une fois,
au plus le solde restant (jamais négatif) ; la part déjà dépensée est marquée « à rapprocher » dans l'historique de la
redemption. « fulfilled » : noté, rien ne bouge. Raptoru ne valide ni n'annule jamais une redemption lui-même.

**Livraison durable (bot et adaptateur Lab)** : chaque redemption / changement de statut est écrit dans une outbox
fichier avant l'envoi (`.channel-points-outbox.json` du bot, `.lab-channel-points-outbox.json` du Lab, ignorés par
git), retiré à la réponse du Core, repris au démarrage ; plus d'abandon après 90 s. Une annulation dont la redemption
attend encore le Core attend derrière elle. Limite Twitch inchangée : rien n'est reçu sans session WebSocket ouverte.

**Dépense** : TTS (`payment_method: 'credits'`) débite des Crédits TTS, le Soundboard des Crédits Soundboard (prix
en crédits du module, inchangés) ; jamais l'une pour l'autre, jamais des Jetons à la place (`insufficient_credits`).
Remboursement (échec, expiration, modération) dans la monnaie d'origine, une seule fois. Son payé directement en
points de chaîne : inchangé (aucun débit). Modération : solde des trois monnaies, ajustement manuel par monnaie
(borné à 0), activité « Points de chaîne » en crédits. Extension (façade Core `/v1/ext`) : soldes réels des crédits
(plus de `0` en dur), paiement TTS / Soundboard en crédits accepté (`/actions/redemption`), jamais pour le Bonk.

`CANONICAL_READY` : `tts`, `soundboard` et `channel_points` prêts.

**Crédits Lab historiques** : le portefeuille de test Lab crée 1 Crédit TTS et 3 Crédits Soundboard fictifs par
viewer (`DEFAULT_LAB_WALLET`) ; ils ne sont ni migrés, ni convertis, ni supprimés. Proposition : rien n'est repris
au cutover (le Wallet canonique part de 0 crédit) ; les crédits SAMMI éventuellement en cours chez des viewers sont
à recenser à part par Antoni avant le gel, et seulement s'ils existent réellement, à recréditer à la main par la
modération (ajustement tracé). Décision à Antoni.

**Restent ouverts** : récompenses Twitch à associer et nombres de crédits (configuration Antoni) ; recensement des
crédits SAMMI en cours ; crédits déjà dépensés lors d'une annulation (« à rapprocher » : la règle de reprise est à
décider) ; release Studio (éditeur de règles, adaptateur Lab) non faite.

## 15. Intégration globale du Wallet canonique (phase 2 lot 7, 19/10/2026)

**Les Core présents**

| Runtime                                   | Lancé par                                                  | Base                           | Modules économiques                                                                                                                          | Économie                                                                    |
| ----------------------------------------- | ---------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Core principal** (`src/index.ts`)       | Coolify (staging aujourd'hui)                              | schéma prod (+ extras staging) | Daily, Presence, Loyalty, `!solde` / `!give` / `!wallet`, Bonk, TTS, Soundboard, Tombola, Roue du Sub, Points de chaîne, modération (façade) | **`ECONOMY_MODE`** : `lab` (défaut) ou `canonical` (refusé sans conditions) |
| Lab Core (`bonk-lab/lab-core.ts`)         | Studio (runtime local), `bonk-lab.mjs`                     | base Lab dédiée                | les mêmes modules + Jeu des mots, Roulette / Slot / Duel, Commandes V2                                                                       | portefeuille Lab (option `economy` jamais passée par un lanceur)            |
| Bot de production (`twitch-bot/index.ts`) | —                                                          | aucune                         | transmet au Core principal : chat (Daily, wallet), Loyalty, Points de chaîne, Random Ban                                                     | —                                                                           |
| Adaptateur chat Lab (`lab-chat-main.ts`)  | Studio                                                     | aucune                         | transmet au Lab Core : chat, alertes (Roue du Sub), Points de chaîne                                                                         | —                                                                           |
| Façade Extension (`/v1/ext`)              | Core principal (`ext/public-frontier.ts`)                  | celle du Core principal        | soldes, Bonk, TTS, Soundboard, Tombola, modération V2                                                                                        | celle du Core principal (`payment_mode: wallet` en canonique)               |
| Services Studio                           | Studio ↔ Lab Core (secret) / Core principal (installation) | —                              | configuration (règles, prix, interrupteurs), cockpit                                                                                         | —                                                                           |

**Core définitif = Core principal.** `createCore(…, economy)` passe le même port à Bonk, Soundboard, TTS, Tombola,
Roue du Sub, Points de chaîne, et la façade à la modération (`core.economy`). `src/index.ts` choisit ce port au
démarrage : `ECONOMY_MODE=lab` (défaut, inchangé) ou `canonical`, accepté seulement par `selectEconomy`
(`CORE_ECONOMY_MODULES`). Daily, Loyalty et les commandes wallet du chat écrivent déjà le Wallet canonique (sans port).
En canonique, la façade annonce un paiement réel (`payment_mode: 'wallet'`, `test_mode: false`, `charged: true`) et
plus « Jetons de test ».

**Activation refusée (code 1, rien n'écoute) tant que** : aucun import d'ouverture des Jetons ; une des trois monnaies
absente ou inactive ; **aucun import d'ouverture pour `credits_tts` ou `credits_soundboard`** (décision du 19/10 :
soldes historiques conservés — un import vide si la source n'en contient pas, jamais une absence silencieuse) ; un
module du Core non prouvé ; un gain de Roue du Sub d'avant la bascule non rapproché. Configuration refusée au
démarrage : un flux qui crédite le Wallet canonique (`DAILY_WALLET_CREDITS`, `LOYALTY_PASSIVE_CREDITS`,
`LOYALTY_EVENT_CREDITS`) pendant que les modules restent sur le portefeuille Lab (deux économies) ; canonique sans
`TWITCH_CHANNEL_ID`. `economyPreflight` liste aussi ce qui attend : crédits Daily, récompenses Loyalty, gains Tombola
non payés. Essayé le 19/10 : démarrage réel de `src/index.ts` refusé sur base vide, refusé avec `DAILY_WALLET_CREDITS`
en mode Lab, accepté sur la base répétée.

**Crédits : trois objets séparés.** (1) Acquisition — l'action de règle « Accorder des crédits » (lot 4) reprend le
modèle legacy (récompense TTS → 1 crédit, récompense Soundboard → pack de 3) avec un nombre configurable ; aucune
règle n'est créée. (2) Stockage — monnaies du Wallet. (3) Dépense — Extension, TTS / Soundboard, depuis le solde, sans
redemption Twitch (les identifiants « credit-… » de la façade ne sont que des libellés). L'annulation Twitch (lot 4) ne
touche **que l'attribution** : jamais une interaction déjà payée (test « spending is independent of Twitch ») ; les
remboursements internes (échec, expiration, modération) restent dans la monnaie d'origine. Question ouverte :
garder ou non la reprise des crédits d'une redemption annulée (le legacy faisait expirer les redemptions non
consommées en 6 h et les remboursait sur Twitch ; aujourd'hui les crédits n'expirent pas).

**Crédits historiques — source réelle** : la table `ext_channel_point_redemptions` de l'ancienne base Supabase de
l'extension (`CANONICAL_WORKSPACE/extension/db` 001 et 006) : `credit_remaining` par redemption, `reward_key` `tts` /
`sound`, `expires_at` (365 jours pour les crédits historiques SAMMI, 6 h pour les récompenses gérées). **Non lue** :
seul accès = une clé service-role non autorisée pour cette mission. `credits.ini` de SAMMI (144 soldes) : sens non
établi (audit legacy D05), **exclu** tant qu'il n'est pas qualifié. Les crédits fictifs du Lab ne sont jamais une
source (format refusé). Outil prêt : `npm run wallet:credits-from-legacy -- <export.json> --import-prefix=<id>
[--out-dir=…]` → un fichier d'ouverture par monnaie, puis `wallet:opening-import` (plan → apply → verify) comme les
Jetons. Lecture à faire par Antoni (après drainage, rien en vol), au format attendu :

```sql
select redemption_id, reward_key, twitch_user_id, login, status, expires_at, credit_units, credit_remaining,
       credit_in_flight from ext_channel_point_redemptions order by redemption_id;
-- declared : count(*) et sum(credit_remaining) group by reward_key, dans la même lecture
```

Refus : crédit en vol (`claimed`, `cancel_pending`, `credit_in_flight`), `reward_key` inconnue, identité non
numérique, doublon, total ou nombre de lignes différent du déclaré. Un crédit est repris s'il est `available` et non
expiré à la coupure ; les autres sont listés exclus avec leur raison. Plusieurs logins pour un même Twitch ID : le plus
récent (l'ID est la clé).

**Répétitions (19/10)** — (1) `test/economy-rehearsal.integration.test.ts` (PostgreSQL réel, deux Core, HTTP) :
ouverture Jetons + crédits, activation, soldes Extension, Bonk / TTS / Soundboard en Jetons et en crédits, Tombola
(inscriptions Extension), Roue du Sub, `!give`, ajustement de modération en crédits, Daily, Loyalty (dont un événement
d'avant la coupure exclu), redemption « crédits », rejeu de tous les événements sur les deux Core (aucune opération
nouvelle), concurrence (même intention Bonk sur deux Core = un débit), ledger = soldes, Lab jamais touché.
(2) Données réelles (`_migration-exports/repetition-lot7-2026-10-19`, base jetable) : 543 portefeuilles / 39 336 444 J
importés, activation **refusée** faute d'import des crédits, puis — simulation seulement — imports de crédits vides :
20 plus gros soldes lus à l'identique par l'Extension, 215 opérations concurrentes sur deux Core (65 dépenses,
47 transferts acceptés ; refus = Jetons insuffisants, file Bonk pleine), rejeux sans effet, 16 / 16 contrôles.

**Restent ouverts avant le cutover** (mis à jour au lot 8, § 16 : jeux du chat, alertes réelles et périmètre des migrations résolus) : lecture réelle des crédits historiques ; release Studio ; arrêt des écrivains externes (StreamElements, SAMMI) au gel.

## 16. Core unifié : jeux du chat et alertes Twitch réelles (phase 2 lot 8, 20/10/2026)

**Jeux du chat dans le Core principal.** Une seule composition, `lab-chat/games.ts` (`createChatGames`), utilisée par le
Lab Core (`bonk-lab/lab-core.ts`, comportement inchangé) et par `createCore` : Commandes V2 (admission, réponses en
étapes durables), Jeu des mots, Roulette / Slot / Duel, avec l'économie du runtime (portefeuille Lab ou Wallet
canonique). Le routeur unique du chat (`chatRouter` : Tombola d'abord, puis les jeux) est celui du Lab.

| Porte (Core principal)                                         | Auth                | Contrat (identique au Lab)                                        |
| -------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `POST /v1/bot/chat`                                            | secret du bot       | `LabChatMessage` ; `source: twitch` seulement, chaîne du Core     |
| `POST /v1/bot/stream`                                          | secret du bot       | `LabStreamEvent` (sessions Tombola / Jeu des mots)                |
| `POST /v1/bot/commands/<chaîne>/steps/claim` · `/<step>/ack`   | secret du bot       | réponses du chat (exécuteur du bot)                               |
| `POST /v1/bot/alerts/events`                                   | secret du bot       | `AlertEventInput` `source: twitch` → file d'alertes + Roue du Sub |
| `/v1/studio/cockpit/commands/…`, `word-game/…`, `mini-games/…` | installation Studio | configuration (jamais le chat simulé, jamais claim / ACK)         |

Le simulateur de chat de Studio n'atteint jamais le Core principal (un message simulé déplacerait de vrais Jetons en
canonique). Le Jeu des mots tourne (cycle 5–15 min) dans le processus du Core principal comme dans le Lab Core.
`CORE_ECONOMY_MODULES` inclut `word_game` et `mini_games` (déjà prouvés au lot 1) ; Commandes V2 ne déplace aucun Jeton.

**Bot de production** (`twitch-bot/src/core-chat-bridge.ts`) : les modules de l'adaptateur Lab réutilisés tels quels
(ingestion du chat, ingestion des alertes avec outbox durable, exécuteur de sortie chat), seul le préfixe change
(`/v1/lab/…` → `/v1/bot/…`). Sur la connexion EventSub existante de LeCroupier_ : `channel.chat.message` une seule fois
(par le runtime ou le pont), `channel.chat.notification` (sub, resub, sub offert, raid…), cheers, `channel.follow`
(avec `moderator:read:followers`). Drapeaux, **tous OFF par défaut** : `CHAT_GAMES`, `CHAT_GAMES_OUTPUT` (et
« Sortie chat réelle » du Core, OFF), `ALERTS_MODE` off / test / active, `ALERTS_FOLLOW`. Fichiers git-ignorés :
`.alerts-outbox.json`, `.chat-games-journal.json`.

**Un sub, deux récompenses possibles, chacune une fois** : la Roue du Sub vient de l'alerte (id du message de chat
Twitch), Loyalty de l'événement EventSub `channel.subscribe` (son id) ; chacune dédupliquée par son id, l'heure
Twitch transmise pour la coupure StreamElements.

**Migrations** : `MAIN_CORE_LAB_MIGRATIONS` (13 fichiers, restés classés Lab, contenu et ordre inchangés) entre dans
la sélection prod : Commandes V2 (4), les quatre « staging » (idempotence de la modération, `twitch_stream_id` des
sessions, OAuth viewer du Bonk, salves Bonk), Jeu des mots (2), mini-jeux et Duel (2), type de ledger Lab
`channel_points`. Le périmètre staging devient égal au périmètre prod. Une base existante reçoit seulement les fichiers
qu'elle n'a pas (par nom ; une base staging ne rejoue jamais les quatre) ; chaque fichier dans sa transaction ; les
contraintes de `lab_wallet_ledger` sont seulement élargies. Prouvé sur PostgreSQL jetable : base vierge (38), base
prod existante avec données (13 ajoutés, données intactes), base staging (9 ajoutés), installation interrompue reprise.
Environnements réels : la base du Core staging (Coolify) a les quatre extras d'après la doc ; aucune base réelle n'a été
touchée ni lue.

**Prouvé** (`economy-lot8.integration.test.ts`, PostgreSQL réel, deux Core + un Core en panne) : roulette, slot, Bonk ;
Duel accepté pendant une dépense Soundboard ; gain Jeu des mots pendant un gain de Tombola ; sub → alerte + Roue +
Loyalty, une fois chacun ; tous les événements rejoués quatre fois sur deux Core (aucune opération nouvelle) ; Core en
panne pendant un jeu (rien gardé, message renvoyé payé une fois) ; même message pris par deux Core (un effet) ;
ledger = soldes ; portefeuille Lab jamais touché. Pont bot → Core réel en HTTP (`bot-core-bridge.test.ts`) : Core
arrêté, alerte gardée puis livrée une fois au redémarrage. Lancement réel de `src/index.ts` (canonique, base jetable) :
routes du bot à 200, message simulé refusé, `/v1/lab/chat` absent.

**Restent** : Studio, profil production — le son OBS des gains du Jeu des mots arrive par un flux d'événements que le
cockpit ne relaie pas (écran Jeu des mots encore Lab seulement ; Commandes V2 et l'interrupteur mini-jeux passent par le
cockpit) ; l'état « événements Twitch réels » des alertes n'est pas affiché pour le bot de production ; release Studio.
