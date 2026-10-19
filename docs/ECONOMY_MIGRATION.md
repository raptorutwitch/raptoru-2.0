# Migration économique StreamElements → Wallet Raptoru

**Statut (19/10/2026) : préparation. Aucun solde lu chez StreamElements, aucun import, aucune bascule.** Production =
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
   avant la première écriture Core = rouvrir SE. Après : remettre dans SE les soldes Core (outil à écrire, écriture
   SE → accord explicite).
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
