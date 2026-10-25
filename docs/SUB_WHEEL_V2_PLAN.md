# Roue du Sub V2 — droits aux tours persistants : plan technique

**Statut : R1–R3 validés en local ; R4, R7 (détection seule), R8, R9 + simulateurs Lab implémentés en local le 22/10/2026 (non commités, non validés). Aucune migration appliquée en Production. R3b, R5 non commencés.**

**Base :**

- le code de `11ffe3f` (V1 en Production) ;
- les décisions d'Antoni : 11 règles, R-1 à R-7, puis A, B et C (§ 1).

**Légende :**

- ✅ faisable avec l'existant ;
- ⚠️ faisable avec une limite connue ;
- ❓ à prouver sur des données réelles.

---

## 1. Décisions (toutes validées)

| #   | Règle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Aucun tour pour un subgift, ni pour l'offreur ni pour le destinataire                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | Tout nouveau mois éligible donne un droit, même sans message de resub                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Droits acquis **en live** : tirage automatique ; droits accumulés **hors live** : tirage manuel                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | Nouveau sub en live : tirage automatique si la roue est activée et le viewer présent                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 5   | Les droits n'expirent jamais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Viewer absent : droit conservé jusqu'à sa présence                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Niveau et mois figés à l'acquisition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Tours visibles dans Studio, `!roue` et l'extension                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | Wenuyr : réactivation de son `ignored` d'origine, sans doublon, après validation spécifique                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 10  | Rattrapage via l'API Twitch quand c'est possible, sans garantie pour l'irrécupérable                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Roue désactivée = tirages en pause ; jamais de droit supprimé ni refusé                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R-1 | Changement de niveau dans le même mois : aucun tour supplémentaire                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R-2 | Premier mois payé par le viewer après un subgift : un droit                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R-3 | Un droit automatique non tiré pour absence **reste automatique** d'un live à l'autre                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R-4 | Tours automatiques tirés séquentiellement                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R-5 | Mois inconnu : dernier mois connu + 1, « estimé », provenance conservée                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R-6 | D'abord acquisition et persistance, ensuite tirages V2                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R-7 | Diffuseur et modérateurs **explicitement autorisés** : tirer et accorder des tours                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A   | Changement de mode (`v1` / `v2_acquire` / `v2`) : **diffuseur seul**                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B   | Récupération **automatique** d'un gain crédité en double, **uniquement si le doublon est certain**. Jamais sur une estimation ni sur une proximité dans le temps. Jamais rétroactive sans accord spécifique.                                                                                                                                                                                                                                                                                                         |
| C   | R0 (observation des badges) **reporté** après les premiers lots ; aucun redéploiement du bot pour l'instant                                                                                                                                                                                                                                                                                                                                                                                                          |
| D   | **Invitations naturelles** (§ 10 bis) : un viewer qui a des tours accumulés et écrit pendant un live peut être invité par LeCroupier_ (une invitation spontanée par viewer et par live) ; acceptation ou refus reconnus de façon déterministe ; en cas de doute, rien, sauf une demande de `!roue oui` / `!roue non` ; l'acceptation autorise les tirages, sans rien calculer ni créditer ; aucun droit perdu ; les nouveaux subs du live restent automatiques, sans invitation ; lot dédié R9, qui ne bloque pas R1 |
| E   | Récupération automatique des doubles crédits **désactivée par défaut**, activée explicitement par le diffuseur seul (§ 6.2)                                                                                                                                                                                                                                                                                                                                                                                          |

## 2. Ce que Twitch fournit réellement

| Source                                            | Données utiles                                                         | Couvre                                                   | Statut                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `channel.chat.notification` `sub` / `resub`       | `sub_tier`, `is_prime`, `cumulative_months` (resub), `is_gift` (resub) | abonnements et renouvellements **partagés**              | ✅ reçu (V1)                                  |
| `channel.subscription.message`                    | tier, `cumulative_months`                                              | renouvellements **partagés** : même mois que l'avis      | ✅ reçu (fidélité)                            |
| `channel.subscribe`                               | tier, `is_gift`, **aucun mois**                                        | nouveaux subs, **reprises manuelles même non partagées** | ✅ reçu (fidélité) ⚠️ mois inconnus           |
| badge `subscriber.info` (`channel.chat.message`)  | un nombre de mois (cumulé ou série : non précisé)                      | renouvellements non partagés, **si le viewer écrit**     | ❓ R0 reporté (décision C)                    |
| Helix `Get Broadcaster Subscriptions`             | `user_id`, `tier`, `is_gift` (ni mois ni dates)                        | **nouveaux** abonnés après une panne                     | ⚠️                                            |
| Présence (Get Chatters, toutes les 2 min en live) | comptes connectés au chat, silencieux compris                          | présence                                                 | ⚠️ un viewer sans chat connecté paraît absent |

**Le mois cumulé de Twitch (`cumulative_months`) est la seule identité de mois certaine.** C'est le compteur de Twitch lui-même : deux renouvellements différents d'un même viewer n'ont jamais le même `cumulative_months`.

**Limite assumée :** un renouvellement automatique **non partagé** d'un viewer **qui n'écrit jamais** reste invisible (aucune API publique).

---

## 3. Modèle

### 3.1 Un droit, ses preuves, son mois

- **Droit** = une ligne `sw_spins`, avec chaîne, viewer, niveau, mois, file et état.
- **Preuve** = une ligne `sw_spin_sources`, une par événement Twitch qui annonce ce droit, avec une clé unique par source.
- **Provenance du mois** (`month_source`) :
  - `twitch` : `cumulative_months` fourni par Twitch, **certain** ;
  - `estimated` : dernier mois connu + 1 ;
  - `estimated_no_history` : 1, faute d'historique ;
  - `legacy` : mois d'une ligne V1, voir § 4.3 ;
  - `badge` : réservé à R6, inutilisé tant que R0 n'a pas prouvé ce que compte le badge.
- **Unicité en base** : `unique (channel_id, viewer_id, sub_month) where month_source = 'twitch' and status <> 'merged'`. Deux droits certains ne peuvent pas porter le même mois.

### 3.2 États et files

| État                                                  | Sens                                                                   | Gain                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `owed`                                                | droit acquis, rien tiré                                                | aucun                           |
| `requested`                                           | tirage manuel demandé, en attente d'affichage                          | aucun                           |
| `queued` → `playing` → `shown` / `failed` / `skipped` | tiré (V1 ou V2)                                                        | **décidé une fois pour toutes** |
| `merged`                                              | droit absorbé par un autre droit du même mois **certain**, jamais tiré | aucun                           |
| `ignored`                                             | V1 uniquement (roue désactivée), conservé pour l'historique            | aucun                           |

- **Files** : `auto` (acquis pendant un live) ou `manual` (tous les autres). **Un droit ne change jamais de file** (R-3, décision 3).
- **Mode par chaîne** : `sw_settings.mode` = `v1` (par défaut) / `v2_acquire` / `v2`. Il est modifiable **par le diffuseur seulement** (décision A), avec une trace dans le journal.

### 3.3 Migration Production additive (une seule, avant R1)

- **`sw_settings`** : ajout de `mode`.
- **`sw_spins`** :
  - contraintes élargies : états `owed`, `requested`, `merged` ; origines `subscribe`, `message`, `manual`, `reconcile` ;
  - colonnes : `queue`, `sub_month`, `month_source`, `acquired_at`, `requested_at`, `requested_by`, `drawn_at`, `granted_by`, `grant_note`, `merged_into`, `confirmed_at` ;
  - index unique partiel (§ 3.1) et index de file.
- **Nouvelles tables** :
  - `sw_spin_sources` : preuves, `unique (channel_id, source, source_event_id)` ;
  - `sw_recoveries` : récupérations des doubles crédits (§ 6).
- **`lab_staff_grants_check`** élargie à `subWheelDraw` et `subWheelGrant`.
- **Lignes existantes non modifiées.** Les colonnes nouvelles restent NULL pour la V1.

---

## 4. V1 et V2 sur le même droit, avec la même clé économique (point 1)

### 4.1 Un seul chemin d'acquisition, un seul chemin de tirage

**Toutes** les sources passent par `acquire(source, event)`, quel que soit le mode, y compris l'avis de chat qui alimente aujourd'hui la V1.

**`acquire()`, en une seule transaction :**

1. **Verrou par viewer** : `pg_advisory_xact_lock('sw:<chaîne>:<viewer>')`.
2. **Mode lu sous verrou partagé** : `select mode, enabled from sw_settings … for share`. Un changement de mode attend, ou est attendu.
3. **Preuve** : `insert into sw_spin_sources … on conflict do nothing`. Si la preuve existe déjà, l'événement a déjà été traité : **on rend le droit existant, sans rien faire d'autre**.
4. **Droit du même renouvellement**, dans cet ordre :
   1. droit certain du même mois (`month_source = 'twitch'`, même `sub_month`) ;
   2. droit dont une preuve est à **moins de 10 min** (heures Twitch) et de **type complémentaire** : un `subscribe` avec un avis ou un message ;
   3. un avis de chat et un message EventSub portant le même `cumulative_months` : même mois, donc même droit (cas 1).
5. **Aucun droit trouvé** : création d'un droit `owed`. Le mois vient de la preuve s'il est certain, sinon il est estimé (§ 5).
6. **Droit trouvé** : la preuve lui est rattachée. Si elle apporte un mois certain à un droit estimé encore **`owed`**, le droit est confirmé (§ 5.2).
7. **Tirage immédiat « à la V1 »**, uniquement si **toutes** ces conditions sont réunies :
   - mode `v2_acquire` ;
   - roue activée ;
   - la preuve vient **d'être insérée** et c'est un **avis de chat** (le déclencheur de la V1) ;
   - le droit est `owed`.

   Le tirage passe alors par **`draw()`**, dans la même transaction.

**`draw(spin)` est le seul code qui tire et crédite :**

- ligne verrouillée (`for update`) ;
- **refus si l'état n'est pas `owed` ou `requested`** ;
- segment, montant et crédit, avec la clé portefeuille `move:sub_wheel:<spin_id>` (inchangée) ;
- passage à `queued` / `playing`, avec `drawn_at`.

**Utilisations :**

- V1 en mode `v1` : le code actuel, avec une seule nouveauté. Il enregistre aussi la preuve et le mois, sans rien changer à son comportement : création avec `admit()`, puis `draw()`.
- Tirage immédiat en `v2_acquire` : `draw()`.
- Tirage automatique ou manuel en `v2` : `draw()`, depuis `claimAnimation`.

### 4.2 Pourquoi un droit traité par la V1 ne peut plus être tiré par la V2

1. **État** : après le tirage V1, le droit est `queued` / `shown` / `failed` / `skipped`. `draw()` refuse tout ce qui n'est ni `owed` ni `requested`, sous verrou de ligne. Les trois chemins de la V2 passent par `draw()`.
2. **Identité** : une source V2 (`subscribe`, message) du même renouvellement retrouve **ce** droit (§ 4.1, étape 4), et ne fait que s'y rattacher.
3. **Clé économique** : une seule clé par droit, `move:sub_wheel:<spin_id>`. Même si les deux premières barrières cédaient (bug), le portefeuille rejouerait le mouvement existant au lieu d'en créer un second (`wallet_operations.idempotency_key` est unique).
4. **Mode** : il est lu sous verrou partagé dans la même transaction que la décision de tirer. Un changement de mode ne peut pas s'intercaler entre la lecture et l'action.

**Le seul cas qui crée deux droits pour un même mois** : deux sources sans lien certain. Par exemple, un `subscribe` seul (mois estimé) puis, plus de 10 minutes après, un avis du même mois. Ce cas donne **deux droits**, jamais deux tirages du même droit. Il est traité au § 5.2 et, quand il est certain, par la récupération du § 6.

### 4.3 Lignes V1 déjà en base (avant le déploiement)

- **Mois certain** (`month_source = 'twitch'`) pour les `resub`, dont `months` vient de `cumulative_months`. Il est renseigné **à la lecture** au moment de la recherche, sans réécrire la ligne.
- **`sub` V1** (`months = 1`) : `legacy`, **jamais** utilisé comme preuve certaine. Un `sub` de nouvel abonné vaut 1, mais une reprise Prime peut arriver en `sub`. Ces lignes ne servent qu'à l'historique.
- **Aucune de ces lignes n'est modifiée**, sauf la réactivation explicite de Wenuyr (lot R5).

## 5. Mois estimés : règle sûre (point 3)

### 5.1 La fenêtre de 28 jours n'est pas sûre : contre-exemples

| #   | Scénario                                                                                                                                              | Ce que ferait « badge M′ < 28 j après l'acquisition ⇒ même mois » | Résultat                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| 1   | Droit estimé créé par **rattrapage Helix**, 9 jours après la vraie reprise (le bot était coupé). Le mois suivant arrive 21 jours après l'acquisition. | badge M+1 à 21 j → fusionné avec l'estimation                     | **un mois légitime perdu**            |
| 2   | Renouvellement facturé quelques heures avant la date anniversaire (février, 28 jours).                                                                | badge M+1 à 27 j 22 h → fusionné                                  | **un mois perdu**                     |
| 3   | `subscribe` traité en retard par la file du bot (acquisition des heures après la reprise).                                                            | même décalage qu'au cas 1                                         | **risque de perte**                   |
| 4   | Le badge compte la **série** et non le cumul (non prouvé, R0 reporté).                                                                                | une valeur M′ sans rapport avec le cumul                          | **fusion ou création erronée**        |
| 5   | Viewer avec un historique antérieur (époque StreamElements) : estimation 1 alors que le vrai mois est 15.                                             | « M′ ≥ estimation » est toujours vrai, quel que soit le mois réel | **fusion de mois distincts possible** |

**Conclusion : toute correction par proximité de date peut faire perdre un droit.** Elle est **abandonnée**.

### 5.2 Règle retenue : ne corriger que sur un lien certain

1. **Estimation à la création** : dernier mois **certain** du viewer + 1 ; sinon `estimated_no_history` = 1. La provenance est conservée.
2. **Confirmation** d'un droit estimé, **seulement** par une preuve **du même renouvellement** :
   - un avis de chat ou un message EventSub portant `cumulative_months`, à moins de 10 min (heures Twitch) du `subscribe` qui a créé l'estimation ;
   - ou partageant ses preuves.
     Le mois devient certain (`twitch`), `confirmed_at` est renseigné, et l'estimation d'origine reste dans les preuves.
3. **Jamais** de confirmation par la date seule, par un badge (tant que R0 n'est pas fait), ni par le rattrapage Helix.
4. **Confirmation vers un mois qui a déjà son droit certain** :
   - le droit estimé est encore `owed` : il passe à **`merged`**, avec `merged_into` et ses preuves rattachées. **Aucune perte** : le mois garde son droit, et une seule ligne reste due ;
   - les deux droits ont déjà été tirés et crédités : **doublon certain**, récupération automatique (§ 6) ;
   - un seul des deux a été tiré : on garde celui-là ; l'autre, encore `owed`, passe à `merged`.
5. **Une estimation jamais confirmée reste un droit à part entière.** Elle est tirée sur sa grille estimée (R-5), affichée « estimé », et n'est **jamais** récupérée (décision B).

**Conséquence assumée :** un renouvellement sans aucune preuve certaine peut donner, au pire, **un droit de plus**. C'est un surplus pour le viewer, jamais une perte. Cela ne peut arriver qu'avec un `subscribe` seul suivi, plus de 10 minutes après, d'un avis du même mois.

## 6. Récupération automatique des doubles crédits (décision B, point 4)

### 6.1 Ce qu'est un doublon certain

Deux droits **A** et **B** forment un doublon certain si **toutes** ces conditions sont réunies :

- même chaîne et même viewer ;
- **même mois certain**, établi par l'une de ces deux voies :
  - les deux portent `month_source = 'twitch'` avec le même `sub_month`, ce que l'index unique rend impossible sauf bug ;
  - ou B a été **confirmé** vers le mois de A par une preuve certaine du § 5.2 ;
- **deux gains crédités** (`award_status = awarded`, deux mouvements `sub_wheel` distincts) ;
- **les deux crédits sont postérieurs à l'activation de la récupération** (`recovery_enabled_at` dans `sw_settings`). Ainsi, rien n'est jamais rétroactif sans accord spécifique.

**Jamais un doublon certain :**

- une estimation non confirmée ;
- deux droits proches dans le temps sans preuve commune ;
- un mois `legacy` ou `badge` ;
- les lignes de test ou de simulation ;
- tout crédit antérieur à `recovery_enabled_at`.

**Lequel est récupéré :** **B**, le droit **tiré en second** (`drawn_at` le plus récent, puis `spin_id` en cas d'égalité). A reste intact.

**Portée réelle : un filet de sécurité.** Par construction, un doublon certain ne devrait jamais naître :

- l'acquisition cherche **d'abord** le droit qui porte déjà ce mois certain (§ 4.1). Une preuve certaine s'y rattache donc toujours, au lieu de confirmer une estimation vers un mois déjà pris ;
- l'index unique interdit deux droits certains du même mois ;
- le verrou par viewer sérialise toutes les acquisitions d'un même viewer.

La récupération ne s'applique donc qu'aux défauts : contournement d'une protection par un bug, données corrigées à la main, régression future. Dans les tests, elle est déclenchée en fabriquant le doublon directement dans la base de test (P8, P9).

### 6.2 Mécanisme

- **Détection** : au moment même où la confirmation du § 5.2 révèle le doublon, dans la même transaction. Un contrôle en lecture seule, idempotent, la complète à la reprise du Core.
- **Ligne `sw_recoveries`** :

  | Champ              | Contenu                         |
  | ------------------ | ------------------------------- |
  | `spin_id` (B)      | **unique**                      |
  | `duplicate_of` (A) | droit conservé                  |
  | `viewer_id`        | viewer concerné                 |
  | `amount_due`       | gain de B                       |
  | `amount_recovered` | montant déjà récupéré           |
  | `status`           | `due` / `partial` / `recovered` |
  | `proof`            | ids, mois, preuves              |
  | dates              | `created_at`, `updated_at`      |

  **Une seule récupération par droit B**, garantie par la contrainte unique.

- **Prélèvement**, dans une seule transaction :
  1. ligne `sw_recoveries` verrouillée (`for update`) ;
  2. **solde lu sous le verrou du portefeuille** ;
  3. **montant = min(reste dû, solde)** ;
  4. débit par le chemin existant `economy.move(q, …, { amount: -montant, kind: 'sub_wheel', key: 'recover:<spin B>:<n>' })`, qui refuse un solde insuffisant au lieu de le rendre négatif. La clé est stockée **avant** l'appel, avec `<n>` le numéro de versement ;
  5. mise à jour de `amount_recovered` et du statut.
- **Solde insuffisant** :
  - on prélève ce qui est disponible (`partial`), **jamais de solde négatif** ;
  - le reste est retenté à chaque nouveau crédit du viewer, ou à chaque cycle du Core, avec une nouvelle clé `<n+1>`.
  - 🟦 Option à confirmer : plafonner le prélèvement à une part des crédits futurs. Par défaut, le prélèvement est complet dès que le solde le permet.
- **Aucun double débit** :
  - la clé du versement est unique (`wallet_operations.idempotency_key`) : une relance rejoue le versement au lieu d'en créer un second ;
  - la ligne de récupération est verrouillée, ce qui empêche deux versements concurrents ;
  - `amount_recovered` n'avance que dans la transaction du débit ;
  - un statut `recovered` ne prélève plus rien.
- **Historique** :
  - la ligne `sw_recoveries` ;
  - les mouvements `sub_wheel` négatifs, avec leur référence `recover:…` ;
  - une note sur B (`award_note`) ;
  - une ligne `lab_moderation_audit` (`sw_recovery`, auteur `system`) ;
  - Studio affiche la récupération sur la fiche des deux droits.
- **Désactivable** :
  - interrupteur `recovery_enabled` dans `sw_settings`, réservé au diffuseur, **désactivé par défaut** ;
  - désactivée, la détection continue mais n'inscrit que `due`, sans prélever ;
  - **aucun traitement rétroactif** : les crédits antérieurs à son activation ne sont jamais concernés.

---

## 7. Concurrence, redélivrance, bascule de mode, redémarrage, ordre des sources (point 2)

| Situation                                                                | Comportement                                                                                                         | Garantie                                   |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Même événement reçu deux fois (redélivrance, file du bot rejouée)        | la preuve existe déjà : le droit est rendu tel quel                                                                  | `unique` sur la preuve                     |
| Avis et message du même mois traités **en même temps** (deux Core)       | le verrou par viewer sérialise : le second trouve le premier droit (même mois certain)                               | verrou + recherche sous verrou             |
| `subscribe` puis avis à 8 s                                              | le second rejoint le droit (10 min) et le confirme ; un seul tirage                                                  | § 4.1                                      |
| Avis puis `subscribe` (ordre inversé)                                    | idem, dans l'autre sens                                                                                              | idem                                       |
| `subscribe` traité **3 h** après l'avis (file du bot)                    | rapprochement sur les **heures Twitch**, pas de traitement                                                           | `occurred_at` des preuves                  |
| `subscribe` seul, puis avis **15 min** après                             | 2 droits (aucun lien certain) ; si l'estimation est encore `owed`, elle reste un droit séparé                        | surplus possible, jamais une perte (§ 5.2) |
| Bascule `v2_acquire` → `v2` pendant le traitement d'un avis              | le mode est lu sous verrou partagé : l'avis est traité entièrement dans l'ancien mode ou entièrement dans le nouveau | `for share` sur `sw_settings`              |
| Retour `v2` → `v1`                                                       | les droits `owed` restent intacts, non tirés ; ceux en cours d'animation finissent normalement                       | aucune réécriture                          |
| Redémarrage du Core pendant `draw()`                                     | transaction non validée : droit `owed`, aucun crédit                                                                 | atomicité                                  |
| Redémarrage pendant une animation                                        | bail expiré : `failed`, gain conservé, jamais de nouveau tirage                                                      | V1 inchangée                               |
| Deux tirages concurrents du même droit (manuel + automatique, deux Core) | `for update` + contrôle de l'état : un seul `draw()` aboutit                                                         | verrou de ligne + clé portefeuille         |
| Deux prélèvements concurrents de la même récupération                    | verrou de ligne + clé de versement                                                                                   | § 6.2                                      |
| Crédit refusé au tirage                                                  | gain `pending` avec sa raison, puis `award()` (même clé)                                                             | V1 inchangée                               |

## 8. Présence et file automatique

- **Présence, trois états** pour le stream en cours :
  - **présent** : vu dans un relevé `ok` de moins de 5 min, ou a écrit depuis moins de 5 min ;
  - **absent confirmé** : des relevés `ok` existent depuis moins de 5 min et il n'y figure pas ;
  - **inconnu** : aucun relevé `ok` depuis 5 min.
  - **Seul « présent » déclenche un tirage automatique.** Les deux autres **conservent** le droit, et Studio affiche la différence.
- **Tirage automatique**, dans `claimAnimation`, si **toutes** ces conditions sont réunies :
  - mode `v2` et roue activée ;
  - live en cours ;
  - droit `auto` `owed` ;
  - viewer présent ;
  - alerte terminée, ou 20 s écoulées.
    Ordre : `acquired_at` croissant. La file `auto` est **conservée entre les lives** (R-3).
- **Tirage manuel** : la demande (`requested`, `requested_by`) passe **avant** la file automatique. Le tirage a lieu au moment de l'affichage.
- **Séquentiel (R-4)** :
  - **une seule** roue `playing` par chaîne, sous verrou consultatif de chaîne (existant) ;
  - la roue suivante attend le compte rendu ou l'expiration du bail de 60 s.

## 9. Permissions et journal

| Action                                   | Qui                                                         | Journal                         |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| Changer le mode, activer la récupération | **diffuseur seul** (installation Studio)                    | `sw_mode`, `sw_recovery_switch` |
| Demander un tirage manuel                | diffuseur, supermodérateur, modérateur avec `subWheelDraw`  | `sw_draw_request`               |
| Accorder un tour, réactiver un `ignored` | diffuseur, supermodérateur, modérateur avec `subWheelGrant` | `sw_grant`, `sw_reactivate`     |
| Récupération automatique                 | `system`                                                    | `sw_recovery`                   |
| Lire ses propres droits                  | le viewer (extension, `!roue`)                              | —                               |

- Les permissions sont vérifiées par le Core, comme pour Moderation V2 : rôle effectif et octrois `lab_staff`.
- Chaque ligne `lab_moderation_audit` porte le module `sub_wheel`, l'auteur, le rôle, le viewer, le droit, le motif et l'état avant / après.

## 10. OBS, gains existants, reprise

- **Lecteur d'effets et `wheel.js` inchangés.** Toujours un segment et un montant décidés par le Core, toujours une roue à la fois.
- **Gains V1 et lignes existantes** : jamais modifiés, sauf la réactivation de Wenuyr. Aucune récupération ne les concerne (§ 6.1).
- **Animation ratée** : gain conservé, jamais de nouveau tirage. **Crédit refusé** : `award()`.
- **Droits** : jamais purgés (décision 5).

## 10 bis. Invitations naturelles aux tours accumulés (décision D, lot R9)

### Principe et place dans les files

- **Seuls les droits `manual` `owed`** (accumulés hors live, rattrapés, accordés, réactivés) sont concernés.
- Les droits `auto` d'un sub reçu pendant le live gardent leur tirage automatique, **sans invitation** (règle 4).
- Un droit déjà `requested` (demandé par le diffuseur ou un modérateur) ne déclenche aucune invitation.
- **Accepter = autoriser :**
  - les droits `manual` `owed` du viewer passent à **`requested`** (`requested_by` = le viewer, `requested_via` = `chat_accept` ou `command`) ;
  - **aucun segment, aucun montant, aucun crédit** au moment de la réponse ;
  - le tirage reste fait par `draw()`, au moment de l'affichage (§ 4.1, § 8), séquentiel, et seulement si le live est en cours, la roue activée, le mode `v2` actif et le lecteur OBS de Studio présent ;
  - par défaut, une demande venue du viewer attend aussi sa **présence** (§ 8) : il voit sa roue.
- **Refuser, ne pas répondre, laisser expirer : aucun droit perdu.** Les droits restent `manual` `owed`, et le viewer peut toujours accepter plus tard avec `!roue oui`.
- **Réglage** `invitations_enabled` dans `sw_settings` : **diffuseur seul**, désactivé par défaut, avec une trace dans le journal.

### Où ça tourne : dans le Core, sans modifier le bot

- **Lecture :** le Core reçoit déjà **tous** les messages du chat en live (`/v1/bot/chat`, entrée commune des jeux chat, `CHAT_GAMES=true`). Les invitations sont un module de plus derrière cette entrée.
- **Réponses dans le chat :** elles passent par la file de sortie existante (`cmd_steps`, nouvelle origine `sub_wheel`). Elles respectent donc :
  - l'interrupteur « Sortie chat » de Studio ;
  - la limite de débit du bot (20 messages / 30 s) ;
  - son journal anti-doublon.
- **Le bot n'est pas modifié**, ce qui respecte la décision C.

### Une invitation par viewer et par live, persistante

- **Table `sw_invitations`** (migration additive propre à R9) :

  | Colonne                                        | Contenu                                                                                     |
  | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
  | `channel_id`, `stream_session_id`, `viewer_id` | **unique**, d'où une invitation spontanée par viewer et par live, même après un redémarrage |
  | `status`                                       | `offered` / `accepted` / `declined` / `expired` / `clarified`                               |
  | `offered_at`, `expires_at`                     | 🟦 durée d'écoute proposée : **3 min**                                                      |
  | `answered_at`                                  | heure de la réponse                                                                         |
  | `answer_message_id`                            | **unique** : un message Twitch ne compte qu'une fois                                        |
  | `answer_class`                                 | `accept` / `decline` / `ambiguous` / `unrelated`                                            |
  | `rights_requested`                             | nombre de droits passés à `requested`                                                       |
  | `step_ids`                                     | messages envoyés par LeCroupier_                                                            |

- **Déclenchement :** au premier message d'un viewer pendant le live, si toutes ces conditions sont réunies :
  - invitations activées, mode `v2`, roue activée ;
  - le viewer a au moins un droit `manual` `owed` ;
  - aucune invitation n'existe encore pour ce viewer et ce live.

  La transaction prend le verrou du viewer. L'insertion de l'invitation et celle du message à envoyer forment une seule transaction. **Deux messages simultanés ne créent qu'une invitation** (contrainte unique).

- **Écoute :** seuls les messages **de ce viewer**, et seulement pendant `offered` et avant `expires_at`. Les autres viewers et les autres messages ne sont pas concernés.

### Reconnaissance déterministe et prudente

**Normalisation :**

- minuscules, accents retirés, ponctuation et émojis retirés ;
- les mentions `@…` rendent le message **hors sujet** : il s'adresse à quelqu'un d'autre.

| Classe      | Règle (message **entier**, au plus 5 mots une fois normalisé)                                 | Exemples                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `accept`    | uniquement des mots d'acceptation et de remplissage, **sans** mot de négation ni d'hésitation | « oui », « ouais vas-y », « go », « ok go », « vas y », « let's go », « carrément », « allez » |
| `decline`   | uniquement des mots de refus, sans mot d'acceptation                                          | « non », « nan », « plus tard », « pas maintenant », « nope », « tout à l'heure »              |
| `ambiguous` | contient **à la fois** acceptation et refus, ou une hésitation, ou un « ? »                   | « oui mais plus tard », « euh ouais ? », « peut-être », « go non attends »                     |
| `unrelated` | tout le reste (plus de 5 mots, aucun mot clé, une mention)                                    | « gg le dernier mot », « @aouh ouais »                                                         |

**Effets :**

- `accept` → acceptation, avec une confirmation courte dans le chat ;
- `decline` → refus noté, avec une réponse courte (« d'accord, tes N tours t'attendent ») ;
- `ambiguous` → **aucune action sur les droits**, et **une seule** relance par invitation : « réponds `!roue oui` ou `!roue non` » (`clarified`) ;
- `unrelated` → ignoré en silence, pour qu'un viewer bavard ne soit pas spammé.

Les listes de mots sont **fermées, versionnées et testées**. Le doute se résout toujours en « ne rien faire ». Il n'y a pas d'IA.

### `!roue` (complète R8)

- **`!roue`** : nombre de tours dus, `auto` et `manual`, et en cours.
- **`!roue oui`** : acceptation explicite. Elle est valable avec ou sans invitation spontanée, en live, roue activée, mode `v2`. Elle est **idempotente** : elle ne fait rien si tout est déjà `requested`.
- **`!roue non`** : refus explicite. Aucun droit perdu.
- Chacun ne voit et n'accepte que **ses** droits. L'identité vient de Twitch (message EventSub), jamais d'un argument.

### Modération

- Le diffuseur et les modérateurs `subWheelDraw` peuvent toujours demander un tirage à la place du viewer (§ 9).
- 🟦 Annuler une acceptation, c'est-à-dire repasser de `requested` à `owed` : proposé pour `subWheelDraw`, avec une trace dans le journal.
- L'acceptation du viewer n'est **pas** une action de modération : elle est tracée dans `sw_invitations` et sur les droits.

## 11. Activation progressive et retour arrière

| Étape | Action                                                                                                                         | Retour arrière (sans perte)                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 0     | migration + code, mode `v1` : comportement V1 identique, seule l'enregistrement des preuves et des mois s'ajoute               | redéployer le commit précédent ; migration additive conservée ; les preuves restent |
| 1     | `v2_acquire` : la V1 tire comme avant, la V2 accumule (`owed`) ce que la V1 perdait (roue désactivée, `subscribe` non partagé) | repasser en `v1` : droits `owed` intacts                                            |
| 2     | Studio en lecture : file, preuves, estimations, doublons détectés (`due`)                                                      | —                                                                                   |
| 3     | `v2` : tirages V2 automatiques et manuels                                                                                      | repasser en `v2_acquire` ou `v1` : aucun droit consommé                             |
| 4     | récupération automatique activée (après observation des `due` en lecture seule)                                                | la désactiver : la détection continue sans prélever                                 |

## 12. Scénarios de tests PostgreSQL et critères de validation avant R1 (point 5)

**Sur PostgreSQL réel**, base locale jetable, deux Core sur deux connexions. Chaque scénario est **rejoué 3 fois**, et chaque protection a sa **contre-épreuve** : le test doit échouer quand on la retire.

| #        | Scénario                                                                                                                        | Attendu                                                                                            | Contre-épreuve                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P1       | Mode `v1` : 30 avis, roue activée, deux Core                                                                                    | comportement V1 identique (mêmes tirages, mêmes crédits) ; preuves enregistrées                    | —                                                                       |
| P2       | `v2_acquire`, roue activée : avis + message + `subscribe` du même renouvellement, simultanés sur deux Core, 30 viewers          | **un droit, un tirage, un crédit** par viewer                                                      | sans verrou par viewer → 2 droits                                       |
| P3       | `v2_acquire` : avis tiré par la V1, puis `claimAnimation` V2 forcé et `draw()` direct sur ce droit                              | refus (`not_owed`) ; 1 crédit                                                                      | sans contrôle de l'état → second segment, mais clé portefeuille rejouée |
| P4       | Bascule `v2_acquire` ↔ `v2` en boucle pendant 60 avis concurrents                                                               | chaque droit tiré au plus une fois ; aucun crédit en double                                        | sans `for share` → divergences détectées                                |
| P5       | Tirage manuel + tirage automatique concurrents du même droit                                                                    | un seul `draw()`                                                                                   | sans `for update` → deux décisions                                      |
| P6       | Redélivrance ×3 de chaque source, dans tous les ordres, avec 3 h de retard                                                      | aucun nouveau droit ni crédit                                                                      | sans `unique` sur la preuve → doublons                                  |
| P7       | `subscribe` seul (estimé), puis avis à 8 s / 15 min                                                                             | 8 s : 1 droit confirmé ; 15 min : 2 droits, aucune récupération                                    | —                                                                       |
| P8       | Confirmation vers un mois déjà tiré : estimation `owed` → `merged` ; estimation tirée → doublon `due`                           | aucune perte ; récupération seulement si activée et postérieure                                    | —                                                                       |
| P9       | Récupération : solde suffisant, insuffisant (partiel puis complément), relance du même versement, deux prélèvements concurrents | jamais de solde négatif ; total prélevé = gain de B ; un mouvement par versement                   | sans verrou de récupération → double débit                              |
| P10      | Récupération désactivée, ou crédits antérieurs à `recovery_enabled_at`                                                          | aucun prélèvement                                                                                  | —                                                                       |
| P11      | Redémarrage simulé (transaction annulée) pendant `draw()` et pendant un prélèvement                                             | état d'origine intact                                                                              | —                                                                       |
| P12      | Lignes V1 existantes (copie de la forme Production)                                                                             | aucune ligne V1 modifiée par toute la suite                                                        | —                                                                       |
| P13 (R9) | Deux messages simultanés d'un viewer qui a des droits, deux Core                                                                | **une** invitation, **un** message envoyé                                                          | sans contrainte unique → deux invitations                               |
| P14 (R9) | Redémarrage du Core entre l'invitation et la réponse ; même message Twitch rejoué                                               | réponse reconnue une fois ; aucune seconde invitation dans le même live                            | —                                                                       |
| P15 (R9) | Acceptation                                                                                                                     | droits `manual` → `requested` en une transaction ; **aucun mouvement de portefeuille** à ce moment | —                                                                       |
| P16 (R9) | Refus, expiration, `unrelated`, `ambiguous`                                                                                     | droits inchangés ; une seule relance pour `ambiguous`                                              | —                                                                       |
| P17 (R9) | Tableau de reconnaissance (≥ 150 phrases réelles et pièges : accents, majuscules, émojis, mentions, « oui mais », « ? »)        | aucune acceptation fausse ; les cas douteux donnent `ambiguous` ou `unrelated`                     | —                                                                       |
| P18 (R9) | Un sub reçu pendant le live alors qu'une invitation est en cours                                                                | droit `auto`, tiré automatiquement, jamais rattaché à l'invitation                                 | —                                                                       |

**Critères de validation avant de livrer R1 :**

- P1 à P12 réussis 3 fois ;
- toutes les contre-épreuves échouent comme attendu ;
- les suites Core, d'intégration, de fidélité, d'alertes et de Roue V1 restent vertes ;
- le mode `v1` est démontré **identique** à la V1 actuelle (P1) ;
- le script de migration est testé, comme pour la 39, sur une base aux 39 migrations de la Production : seule la nouvelle migration est appliquée, l'économie est inchangée, un second passage ne fait rien ;
- la revue de ce plan est validée par Antoni.

## 13. Lots

| Lot     | Contenu                                                                                                                                                                                                                                                      | Dépend de                                      | Fichiers principaux                                                                                                                                                      | Risque              | Validation                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------- |
| **R1**  | Migration ; `acquire()` (avis de chat) et `draw()` uniques ; preuves ; mois certains et estimés ; `merged` ; mode (`v1` / `v2_acquire`) ; détection des doublons certains (sans prélèvement)                                                                 | ce plan                                        | `supabase/migrations/…_sub_wheel_v2.sql`, `migration-scopes.ts`, `sub-wheel/service.ts`, `sub-wheel-routes.ts`, `packages/schemas/src/sub-wheel.ts`, `lab-moderation.ts` | moyen               | P1, P2, P3, P6, P7, P8, P11, P12                                            |
| **R2**  | Sources `subscribe` et message (appel depuis la fidélité, même transaction), R-1, R-2                                                                                                                                                                        | R1                                             | `loyalty/engine.ts` (appel), `sub-wheel/service.ts`                                                                                                                      | moyen               | P2, P6, P7 sur toutes les combinaisons ; récompenses de fidélité inchangées |
| **R3**  | Tirages V2 (automatique avec présence en 3 états, manuel `requested`), séquentiel, permissions et journal, mode `v2`                                                                                                                                         | R1, R2                                         | `sub-wheel/service.ts`, `sub-wheel-routes.ts`, `lab-moderation/service.ts`, `presence`, `stream-sessions`                                                                | **élevé**           | P3, P4, P5, P11                                                             |
| **R3b** | Récupération automatique (`sw_recoveries`, prélèvements, interrupteur)                                                                                                                                                                                       | R1, R3                                         | `sub-wheel/service.ts`, `economy` (utilisation)                                                                                                                          | **élevé**           | P8, P9, P10, P11                                                            |
| **R4**  | Studio : mode, files (présent / absent / inconnu), « Tirer », « Accorder », preuves, « estimé », récupérations                                                                                                                                               | R1, R3                                         | `apps/studio/web/src/sub-wheel-view.ts`, `sub-wheel.ts`, `apps/studio/server/src/sub-wheel/runtime.ts`                                                                   | faible              | validation visuelle d'Antoni                                                |
| **R5**  | Wenuyr : réactivation de `2e3e4a3d…` (même `event_key`, file `manual`), tirage au live                                                                                                                                                                       | R3, R4                                         | route `reactivate`                                                                                                                                                       | faible              | **ton feu vert spécifique** ; un seul tirage                                |
| **R0**  | Observation des badges (reportée, décision C)                                                                                                                                                                                                                | R1 à R4                                        | bot (journal temporaire)                                                                                                                                                 | faible              | nature de `info` prouvée                                                    |
| **R6**  | Source badge                                                                                                                                                                                                                                                 | R0                                             | bot + Core                                                                                                                                                               | moyen               | selon R0                                                                    |
| **R7**  | Rattrapage Helix (droits `manual`, estimés, jamais certains)                                                                                                                                                                                                 | R2                                             | `loyalty/tiers.ts`, `sub-wheel/service.ts`                                                                                                                               | moyen               | aucun faux positif ; jamais source d'une récupération                       |
| **R8**  | `!roue` et `/v1/ext/sub-wheel/me` ; vue extension                                                                                                                                                                                                            | R1                                             | commandes système, `ext/…`, extension                                                                                                                                    | faible / moyen      | chacun ne voit que ses droits                                               |
| **R9**  | Invitations naturelles (§ 10 bis) : `sw_invitations` (migration additive propre), déclencheur sur l'entrée chat du Core, reconnaissance déterministe, `!roue oui` / `!roue non`, réglage `invitations_enabled` (désactivé par défaut), affichage dans Studio | R3 (états `requested`, présence), R8 (`!roue`) | `sub-wheel/invitations.ts` (nouveau), `lab-chat/router.ts` (branchement), commandes système, `sub-wheel/service.ts`, Studio                                              | moyen (chat public) | P13 à P18 ; validation en Lab avec un faux chat, puis un live de test       |

**Ordre de déploiement**, toujours hors live, le Core par le Terminal en commandes découpées :

1. R1 + R2, en mode `v1` ;
2. passage en `v2_acquire` ;
3. R4 (lecture) ;
4. R3 + R4 (actions) ;
5. passage en `v2` ;
6. R5 ;
7. R3b, après observation des `due` ;
8. R7, R8 ;
9. R9 (invitations), d'abord activé en Lab, puis en Production par le diffuseur ;
10. R0 et R6 en dernier.

**R1 ne dépend pas de R9.** Les invitations n'utilisent que ce que R1 et R3 créent : les droits `manual` `owed`, l'état `requested`, `draw()`. Elles ont leur propre migration additive.

## 14. Risques résiduels

- **Surplus possible**, jamais une perte : un `subscribe` seul suivi, plus de 10 minutes après, d'un avis du même mois donne deux droits. Ce n'est pas certain, donc jamais récupéré (décision B).
- **Estimations basses** pour les anciens abonnés sans historique certain dans Raptoru (grille 1–3) : le droit est garanti, mais la grille est plus faible que la réalité.
- **Invisibles** : un renouvellement automatique non partagé d'un viewer qui n'écrit jamais. Le rattrapage Helix ne voit pas les renouvellements.
- **Présence** : un viewer sans chat connecté paraît absent. Son droit attend, et un tirage manuel reste possible.
- **Récupération partielle** : si le solde reste insuffisant longtemps, une dette `partial` demeure visible. Elle n'est jamais rendue négative.
- **Comportement Prime de Twitch** : déduit d'un seul cas réel.
- **Invitations (R9) :**
  - une acceptation formulée hors des listes, par exemple « avec plaisir » ou « bien sûr », est classée `unrelated`. Le viewer garde ses droits et peut toujours répondre `!roue oui` ;
  - une **fausse acceptation** est le risque à éviter : seuls les messages courts, uniquement composés de mots d'acceptation, sont acceptés ;
  - un message qui répond en réalité à un autre viewer sans le mentionner peut passer pour une réponse. La fenêtre de 3 min et l'exigence d'un message court limitent ce risque, et une acceptation n'engage rien d'irréversible : aucun gain avant l'affichage ;
  - les messages de LeCroupier_ dépendent de l'interrupteur « Sortie chat ». Coupé, aucune invitation n'est envoyée et rien n'est enregistré comme proposé.
