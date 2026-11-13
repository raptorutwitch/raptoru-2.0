# Spécification — Random Ban V2 (premier mini-jeu de l'extension)

12/11/2026, **V5 du 13/11** : les charges personnelles remplacent le prix progressif (décision d'Antoni du 13/11).
**Spécification active.** C'est la seule source des règles en vigueur ; les propositions abandonnées sont dans
l'annexe A, à titre d'historique. Constats techniques : [AUDIT](AUDIT_MINI_JEUX_RANDOM_BAN.md). État de la
construction : § 13 et [PLAN](PLAN_IMPLEMENTATION.md).

**Principe directeur : un seul Random Ban.** Trois façons de le lancer, **une seule demande** (`rb_requests`), un seul
exécuteur, les mêmes immunités, le même timeout. Il n'y a jamais trois tirages distincts.

| Moyen                                   | Paiement      | Prix                 | Sniper                 | Limite                                          |
| --------------------------------------- | ------------- | -------------------- | ---------------------- | ----------------------------------------------- |
| Extension (nouveau, source `extension`) | Jetons        | fixe : 25 000 Jetons | **oui**, seulement ici | **charges communes** (§ 2) · 3 en attente       |
| `!rb`                                   | Jetons        | fixe : 25 000 Jetons | non                    | **charges communes** (§ 2) · 3 en attente       |
| Récompense de points de chaîne          | points Twitch | fixe : 3 000 points  | non                    | **charges communes** (§ 2, refus remboursé § 3) |

Tout est identifié par l'**identifiant Twitch** du viewer, jamais par le pseudo. Le Core décide de tout : prix,
cooldowns, Sniper, résultat, primes. L'extension et le chat affichent ce que le Core dit.

## 1. Parcours du viewer (extension)

1. **Hub → « Mini-jeux ».** Tant que Random Ban est le seul jeu, la carte l'ouvre directement.
2. **Écran Random Ban :** le prix (fixe) sur le bouton Lancer et la jauge de tes charges (§ 2.4), ton solde, les règles en
   3 lignes, le nombre de viewers dans le chat, l'état du Sniper (« prêt » ou « prêt dans 12 min »).
3. **Option « 🎯 Viser quelqu'un » (Sniper)**, facultative : « Ça ne change pas le tirage. Si le tirage tombe dessus :
   +2 000 Jetons. »
4. **« Lancer — 25 000 Jetons »** : premier appui → récapitulatif (prix, cible visée, prime possible) ; second appui →
   envoi, avec une clé par intention (`purchase.js`).
5. **Suivi dans le même écran :** payé → en file (2ᵉ) → tirage → résultat ; ou remboursé, ou à vérifier. Rouvrir
   l'extension retrouve l'état, relu sur le Core.
6. **Résultat et historique :** cible, durée, « SNIPER ! +2 000 », CSC, prix payé, remboursement ; tes derniers lancers.

## 2. Prix fixes et charges personnelles (V5, décision du 13/11)

### 2.1 Prix

- Extension et `!rb` : **25 000 Jetons** (réglage `random_ban.price`, « Prix de Random Ban »).
- Points de chaîne : **3 000 points**, le coût réglé sur la récompense Twitch (la récompense existe déjà, Raptoru ne la
  modifie pas).
- Le prix progressif du 12/11 (25 000 → 100 000) est **abandonné** (annexe A) ; il n'a jamais été déployé. La
  récupération des charges remplace la récupération du prix.

### 2.2 Charges

- Chaque viewer (identifiant Twitch) a une **réserve de 3 charges au plus**, **commune** à l'extension, `!rb` et la
  récompense de points de chaîne.
- Un Random Ban **accepté** utilise une charge. Une charge revient **toutes les 10 minutes**, en continu, en
  arrière-plan, sans que le viewer ouvre l'extension. Une utilisation pendant une recharge ne la relance pas.
- **Ne coûte rien :** un refus (aucune demande créée), une demande `failed` (rien fait, remboursée), une demande
  `canceled` (annulée sans exécution), une demande `uncertain` remboursée par la modération. La charge revient d'elle-même.
- **Un refus ne repousse pas la prochaine recharge.**
- **Calcul (le Core, horloge du serveur, sous le verrou de l'acheteur) :** rejoue les demandes comptées des 24
  dernières heures : `plein = max(plein, t) + 10 min` pour chacune (jamais plus de 3 × 10 min devant `t`) ; charges
  disponibles = `3 − ⌈(plein − maintenant) / 10 min⌉`. Rien n'est stocké en plus des demandes : pas de compteur qui
  pourrait dériver, pas de double utilisation par un second onglet ou une seconde connexion, plusieurs Cores lisent
  les mêmes lignes sous le même verrou.
- Capacité (0 = aucune limite) et durée de recharge sont des réglages Studio (§ 12).
- **Récompense que Raptoru ne peut pas rembourser** (l'ancienne) : jamais refusée pour les charges ni la limite de la
  chaîne (un refus coûterait ses points au viewer) ; son Random Ban utilise quand même une charge, sans descendre sous 0.

| Situation                                            | Résultat                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| 3 Random Ban d'affilée                               | 3 acceptés, 75 000 Jetons ; le 4ᵉ refusé, rien débité             |
| Réserve vide, 10 min plus tard                       | 1 charge                                                          |
| Utilisé à 0 et à 5 min                               | à 5 min : 1 charge, la suivante revient à 10 min, pleine à 20 min |
| 2 rédemptions de points puis `!rb`                   | 3 acceptés ; la rédemption suivante est refusée et remboursée     |
| Demande `failed` remboursée                          | la charge revient                                                 |
| La même demande rejouée (même clé, même message)     | une seule demande, un seul débit, une seule charge                |
| 5 achats simultanés sur deux Cores (2 `!rb` + 3 pts) | exactement 3 acceptés (testé sur vrai PostgreSQL)                 |

### 2.3 Jamais plus cher que le prix affiché

- **Extension :** `launch` porte `input.expected_price` (obligatoire). Un prix changé dans Studio entre l'affichage et
  l'achat → `price_changed`, rien débité, l'écran montre le nouveau prix.
- **`!rb` :** seulement `!rb` seul, au prix du réglage (`!rb <montant>` n'est plus une commande).
- **Ordre des refus**, avant toute écriture : pause de la file, blocage, délai personnel de la modération (la
  modération passe avant les charges), limite de la chaîne, charges, demandes en attente, prix, solde.
- **Plafond de file :** 3 demandes en attente au plus par acheteur, toutes sources (réglage).

### 2.4 Données de la jauge (fournies par le Core)

L'état du module (`GET /modules/v3/random_ban/state`) renvoie `price` (Jetons) et `charges` = { `available`, `max`,
`recharge_ms`, `next_at`, `full_at`, `server_now` }, plus `restriction` (pause, blocage, délai, limite de la chaîne),
`pending`, `max_pending`. L'extension anime la jauge à partir de l'écart avec `server_now` (jamais l'horloge locale
seule) et relit l'état dès qu'une charge revient. Le nombre de charges affiché est toujours celui du Core.

### 2.5 Limite de la chaîne (anti-spam global)

Les charges n'empêchent pas plusieurs viewers de lancer en même temps : la file exécute un Random Ban à la fois.
Réglage indépendant, **désactivé par défaut** : au plus `channel_max` Random Ban acceptés par `channel_window_min`
minutes, tous viewers et moyens confondus (sous un verrou de chaîne : deux acheteurs simultanés ne prennent jamais la
dernière place tous les deux). Refus « Trop de Random Ban en ce moment, réessaie dans … », rien débité, points
remboursés.

## 3. Points de chaîne : refus et remboursement

- **Rédemption refusée** (plus de charge, blocage, délai de la modération, pause, limite de la chaîne) :
  1. le Core refuse : **aucune demande, aucun Random Ban**, aucune charge utilisée ;
  2. remboursement automatique : `CANCELED` via `cp_twitch_actions` (une fois par rédemption), **jamais limité** ;
  3. le message part **après la réponse de Twitch** : « @Kiwi - Plus de charge Random Ban, la prochaine dans 6 min 24 s ·
     points remboursés. » (ou « remboursement automatique impossible : un modérateur va le faire. ») ;
  4. tout est journalisé (rédemption, refus, action Twitch, message).
- **Condition :** une récompense **créée par Raptoru**. L'ancienne récompense n'est jamais refusée pour les charges
  (§ 2.2).
- Une demande ratée (`failed`, remboursement dû) est remboursée automatiquement en points.
- **Réussite :** la rédemption reste « en attente » sur Twitch ; tu gardes la main pour la valider.

### 3.1 Messages du chat (V5)

- Achat réussi : aucun message (le Random Ban lui-même est la réponse) ; remboursement d'un échec : un message court.
- Refus (charge, délai, blocage, pause, limite, solde, hors live) : une ligne courte avec le délai restant quand il
  compte, **au plus une ligne de refus par viewer toutes les 5 minutes** (`!rb` et points de chaîne ensemble). Seule la
  ligne est limitée, jamais le remboursement.

## 4. Sniper (extension uniquement)

### 4.1 Règle

- Une **prédiction**, jamais un ciblage : les probabilités ne dépendent pas de la cible visée.
- Déclarée avant le tirage et **figée** à la création de la demande (identifiant Twitch, login, nom), dans la même
  transaction que le paiement. Aucune route ne la modifie.
- La cible visée **n'est jamais transmise à la recherche** du bot. Le bot la reçoit à part, seulement pour dire si elle
  était éligible au moment du tirage. Un test le prouve : à graine égale, tirage identique avec ou sans cible.
- Choix : parmi le dernier relevé de présence du Core (toutes les 120 s, sans appel Twitch) ; l'identifiant est vérifié
  côté Core. Exclus : toi-même et le streamer.

### 4.2 Récupération Sniper : 30 minutes

**Une tentative est récompensable** si l'acheteur n'a lancé **aucun autre Random Ban compté**, par aucun moyen, dans les
**30 minutes** qui précèdent la création de cette demande.

- **Compté :** toute demande réelle de l'acheteur, extension, `!rb` ou points de chaîne, sauf `failed` (rien fait),
  `canceled`, `simulated`, et les rédemptions refusées sous cooldown (elles ne créent pas de demande).
- Une tentative Sniper est elle-même un Random Ban : réussie ou non, elle relance les 30 minutes.
- **Quand c'est décidé :** l'état « prêt » est **affiché** à l'achat, mais la décision **définitive** est prise au
  résultat, sous verrou, avec les statuts finaux des demandes précédentes. La file exécute les demandes une par une
  dans l'ordre : au moment du résultat, toutes les demandes antérieures de l'acheteur sont terminées.
  - Conséquence : une demande antérieure qui échoue et se fait rembourser **ne consomme pas** le droit. L'écart entre
    affichage et décision ne peut jouer qu'en faveur du viewer.
- **Demandes simultanées :** sérialisées par le verrou de l'acheteur. La seconde voit la première (en attente =
  comptée) : elle est affichée « pour la gloire », sauf si la première échoue avant le résultat de la seconde.
- **Hors fenêtre :** la prédiction reste permise « pour la gloire » : affichée, comptée dans les statistiques, sans
  prime ni défi. L'écran dit « Sniper prêt dans 12 min ».

| Cas                                          | Effet                             |
| -------------------------------------------- | --------------------------------- |
| Aucun lancer depuis 30 min                   | récompensable                     |
| `!rb` il y a 10 min, puis Sniper             | pour la gloire ; prêt dans 20 min |
| Points de chaîne il y a 31 min               | récompensable                     |
| Tentative Sniper, puis une autre 5 min après | la seconde est pour la gloire     |
| Demande précédente `failed` et remboursée    | ne compte pas                     |
| Demande précédente en flop                   | compte (un tirage a eu lieu)      |
| Même intention envoyée deux fois             | une seule demande (clé)           |
| Changement de pseudo                         | aucun effet (identifiant)         |

### 4.3 Réussite et prime

Toutes les conditions à la fois :

1. demande récompensable (§ 4.2, décision au résultat) ;
2. statut final `confirmed` (timeout confirmé par Twitch ; `simulated` dans le Lab, en Jetons fictifs) ;
3. cible tirée = cible visée (même identifiant). Une cible tirée est par définition éligible : la V1 ne demande donc pas
   au bot de dire si la cible visée l'était (`wish_eligible` reste une piste pour les statistiques, non codée).

Décisions enregistrées (`sniper`) : `armed` (prédiction pas encore décidée) puis, au résultat, `hit` (prime versée),
`miss`, `glory` / `glory_hit` (raté / réussi hors fenêtre, sans prime), `void` (rien ne s'est passé : `failed`,
`uncertain`, `canceled`), `revoked` (prime retirée par un modérateur).

- **Prime : 2 000 Jetons**, par `economy.move` avec la clé `rb:sniper:<request_id>`, dans la transaction du résultat.
  Rejouer le résultat ne paie jamais deux fois. Le balayage de 15 s rattrape une prime due après un redémarrage.
- `flop`, `failed`, `uncertain`, `canceled` : jamais de prime. Pas de prime rétroactive : un `uncertain` réglé plus tard
  par un modérateur ne la déclenche pas (le modérateur peut créditer à la main, c'est audité).
- Retrait par un modérateur (`wallet.admin`) : mouvement négatif à clé `rb:sniper-revoke:<id>`, avec raison ; la
  demande passe à `sniper = revoked`.
- Économie [estimation] : réussite ≈ 1/N pour N éligibles ; N = 20 → espérance ≈ 100 Jetons par tentative
  récompensable ; au plus 2 par heure et par viewer.

### 4.4 Défi secret

- Le **Sniper est visible** dans l'extension (option, règles, prime, probabilités).
- Le **défi** « Sniper » est **secret** dans le système de défis de raptoru.fr : ni sa condition ni sa récompense ne
  sont montrées avant qu'il soit débloqué ; elles sont révélées à la découverte.
- Métrique `random_ban_sniper` (réussites `hit`, réelles, hors `revoked`), recomptée depuis `rb_requests` comme les
  métriques Random Ban existantes ; métrique `random_ban_self` pour les CSC. Aucun défi n'est créé par nous : le
  catalogue est le tien (visibilité « secret » déjà gérée par les défis).

## 5. Animation : « Le Viseur » (séquence hybride retenue, à valider en recette)

### 5.1 Contraintes mesurées ou connues

| Élément                       | Valeur                                                 | Conséquence                                                                            |
| ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Recherche du bot              | 1 à 3 s                                                | la cible est connue avant tout ban                                                     |
| Timeout confirmé par Twitch   | < 1 s                                                  | —                                                                                      |
| Latence vidéo des spectateurs | ≈ 2 à 6 s, différente pour chacun [à mesurer au lot 0] | le chat (temps réel) est **en avance** sur la vidéo                                    |
| Délai OBS (si activé)         | réglage du stream                                      | s'ajoute à la latence                                                                  |
| Message de timeout            | la cible le voit **tout de suite** dans son chat       | si le ban part avant l'animation, la cible connaît son sort avant de la voir           |
| Extension pendant un timeout  | Twitch peut la masquer sur ordinateur                  | le résultat doit se voir sur le stream et dans le chat, pas seulement dans l'extension |

### 5.2 Comparaison

| Séquence                                                                                                                            | Suspense pour la cible                                            | Risques                                                                | Verdict            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| A. Ban, puis rouleau                                                                                                                | **aucun** : elle lit « tu as été exclu » avant de voir le rouleau | aucun : on ne montre que du confirmé                                   | mode de secours    |
| B. Rouleau, puis ban à la fin                                                                                                       | **oui**                                                           | si le ban échoue après l'arrêt du rouleau, il faut le dire honnêtement | —                  |
| **Hybride : tirage figé → rouleau → ban déclenché à l'arrêt du rouleau, décalé de la latence → tampon « BANNI » à la confirmation** | **oui, pour tout le monde, cible comprise**                       | traités au § 5.4                                                       | **retenu** (12/11) |

**Pourquoi :** le rouleau ne montre que ce qui est **déjà vrai** (« tiré au sort : Kiwi », le tirage est figé avant) et
le mot « BANNI » n'apparaît **qu'après** la confirmation de Twitch. Il n'y a donc jamais de fausse annonce, et la cible
découvre son sort en même temps que le chat.

### 5.3 Séquence (le Core orchestre, Studio joue)

| Étape | Qui           | Quoi                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | bot           | recherche (inchangée) → cible annoncée au Core **avant tout timeout** ; la cible est **figée** (statut `timeout_requested`, rien d'envoyé)                                                                                                                                                                           |
| 2     | Core          | si `random_ban.sequence` = 1 et Studio vu depuis moins de 10 s : construit la bande (`random-ban/reel.ts` : cible à `stop`, 14 autres viewers présents mélangés, cible visée jamais voisine), `strike_at` = maintenant + 4,5 s + `strike_offset_s` ; répond au bot `delay_ms`                                        |
| 3     | Studio        | lecteur d'effets (`effects-player/reel.js`) : bandeau « 🎲 Random Ban de **Pseudo** » (« 🎯 vise Kiwi »), rouleau d'avatars (initiales sur une couleur tirée de l'identifiant, aucune image Twitch), ralentissement, arrêt **exactement** sur la cible : « Tiré au sort : **Kiwi** » (« CSC ! » si c'est l'acheteur) |
| 4     | bot           | attend `delay_ms` (10 s au plus), puis envoie le timeout **une fois** (journal existant) ; arrêté pendant l'attente → rien n'est envoyé                                                                                                                                                                              |
| 5     | Core → Studio | confirmé → la vidéo de ban existante (choisie comme aujourd'hui)                                                                                                                                                                                                                                                     |
| 5′    | Core → Studio | refus Twitch → carte « Esquivé ! » + remboursement automatique ; résultat incertain → rien d'annoncé, « à vérifier »                                                                                                                                                                                                 |

Codé (V1) : étapes 1 à 5′. Pas encore : le tampon « SNIPER ! +2 000 » à l'écran (la prime est versée et visible dans
l'extension), les vrais avatars Twitch (le cache d'avatars du Core existe, non branché ici).

**Règles d'honnêteté :** l'ordre du rouleau est un mélange aléatoire de l'échantillon ; on ne place **jamais** la cible
visée juste avant ou après la cible (pas de faux « presque ») ; le rouleau s'arrête toujours sur la cible réelle.

### 5.4 Cas limites

| Cas                                             | Comportement                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio fermé ou animation non prise             | le Core le sait (dernier passage de Studio) : ban **tout de suite** (séquence A), sans rouleau ; un rouleau que Studio prendrait après `strike_at` est sauté (jamais un rouleau après coup)                                                                                                          |
| Cible devenue modérateur ou bannie entre-temps  | Twitch refuse → « Esquivé ! », remboursement ; jamais « BANNI »                                                                                                                                                                                                                                      |
| Cible partie du chat entre-temps                | le timeout s'applique quand même (Twitch l'accepte par identifiant)                                                                                                                                                                                                                                  |
| Redémarrage du Core ou du bot pendant l'attente | la cible et `strike_at` sont en base. Bot arrêté pendant l'attente : rien n'est envoyé ; à la fin du bail, la demande passe « à vérifier » (`uncertain`), jamais un second timeout. Amélioration possible : la marquer `failed` et la rembourser (rien n'a pu partir), à faire si le cas se présente |
| File d'attente                                  | la demande suivante attend la fin de celle-ci (inchangé)                                                                                                                                                                                                                                             |
| Double exécution                                | impossible : la cible est enregistrée une fois sous verrou, le même rapport reçoit la même réponse (même `strike_at`), journal du bot                                                                                                                                                                |
| Échantillon vide (avatars illisibles)           | carte simple « Tiré au sort : Kiwi », sans rouleau ; jamais un échec du ban pour une image                                                                                                                                                                                                           |
| Seul éligible                                   | carte « seul éligible : Kiwi »                                                                                                                                                                                                                                                                       |
| Flop                                            | trompette existante, « personne d'éligible »                                                                                                                                                                                                                                                         |
| Streamer tiré (2 %)                             | pas de rouleau (le mute OBS de 60 s, V3, inchangé)                                                                                                                                                                                                                                                   |

**Livraison en deux temps** : réglage `random_ban.sequence` = 0 (comportement actuel : timeout, puis vidéo) puis 1
(hybride), activé après ta recette. L'exécuteur de Production ne change de
comportement qu'à ce moment-là.

**Ce que la séquence ne promet pas :** une simultanéité exacte. Chaque spectateur a sa propre latence (2 à 6 s,
variable) ; le décalage `strike_offset_ms` vise le spectateur moyen. La séquence garantit seulement l'honnêteté (rien
d'annoncé qui ne soit vrai) et une seule sanction.

## 6. Éligibles (inchangé, écrit honnêtement)

> **Est éligible :** un compte connecté au chat de raptoru_ au moment du tirage (liste « Get Chatters », mise à jour
> avec un délai par Twitch), qui suit la chaîne, et qui n'est ni le streamer, ni modérateur, ni déjà banni ou en
> timeout. L'acheteur est éligible avec une chance 4 fois plus faible.

- Les comptes exclus de la fidélité (`loyalty_exclusions` : bots, comptes de test) sont exclus du tirage (filtre local,
  sans appel Twitch). **[retenu : proposé, sans objection d'Antoni ; pas encore codé]**
- L'animation montre un échantillon, jamais « la liste exacte ».

## 7. Statistiques

| Où                          | Quoi                                                                                                                                                                  | Qui voit                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| raptoru.fr, page publique   | totaux de la chaîne : Random Ban lancés, exécutés, personnes distinctes bannies, CSC, flops, Snipers tentés et réussis, Jetons dépensés, primes versées               | tout le monde ; **agrégats seulement**, comme les statistiques de modules actuelles |
| Extension, « Mes stats »    | tes lancers, tes victimes, tes CSC, tes Snipers (tentés, récompensables, réussis), Jetons dépensés, primes reçues                                                     | toi seul (JWT)                                                                      |
| Extension, historique       | tes derniers lancers ; les derniers Random Ban de la chaîne (acheteur → cible, déjà publics sur le stream) ; la prédiction d'un autre n'apparaît qu'après le résultat | toi / tout le monde                                                                 |
| raptoru.fr, profil connecté | tes stats Random Ban et Sniper                                                                                                                                        | toi seul, comme `module-stats` aujourd'hui                                          |

Définitions : lancés = demandes réelles hors `canceled` ; exécutés = `confirmed` ; distinctes =
`count(distinct target_id)` des `confirmed` ; taux Sniper = réussis / récompensables à cible éligible ; dépensés =
débits non remboursés ; primes = `move` Sniper non retirés. `since` affiché (rien n'est reconstruit avant le Sniper).

## 8. Modération

Intégrée au système existant (D4 : permissions, journal d'audit `lab_moderation_audit`, blocages et délais personnels).
La migration du lot élargit les contraintes des blocages et des délais à `random_ban`. Code : `random-ban/moderation.ts`,
routes `…/random-ban/<canal>/moderation/history|reconciliation|act`, page Studio « Sanctions › Random Ban ».

| Action                              | Quand                             | Permission                                       | Effet                                                                                                                                          |
| ----------------------------------- | --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Voir l'historique                   | toujours                          | `viewer.read`                                    | une ligne par demande : source, acheteur, cible visée, récompensable, cible tirée, statut, prix payé, niveau, remboursement, prime, dates      |
| Bloquer un viewer                   | toujours                          | `viewer.block` (sans fin : `sanction.sensitive`) | blocage du module `random_ban`                                                                                                                 |
| Délai personnel                     | toujours                          | `viewer.cooldown`                                | « une demande toutes les N min »                                                                                                               |
| Timeout du module                   | toujours                          | `viewer.block`                                   | blocage à durée                                                                                                                                |
| Annuler une demande en attente      | `queued` seulement                | `queue.cancel`                                   | `canceled` ; Jetons remboursés une fois ; points de chaîne `CANCELED` (récompense Raptoru)                                                     |
| Mettre la file en pause / reprendre | toujours                          | `module.pause`                                   | aucun nouvel achat (rien débité), le bot ne prend rien ; les demandes qui attendent plus de 2 min sont remboursées par l'expiration habituelle |
| Rembourser un résultat incertain    | `refund = to_verify`              | `refund.manual`                                  | après vérification sur Twitch ; une fois (clé)                                                                                                 |
| Lever la sanction                   | `confirmed`, timeout encore actif | nouvelle `randomban.lift`                        | **pas codé** : demande une action Unban du bot (déploiement du bot)                                                                            |
| Retirer une prime                   | prime payée                       | `wallet.admin`                                   | mouvement négatif à clé, raison ; `sniper = revoked`                                                                                           |

Chaque intervention écrit l'auteur, la raison et la date (`lab_moderation_audit`). Toutes les opérations d'argent
passent par des clés : rejouer ne paie ni ne rembourse deux fois. Un achat refusé par un blocage, un délai ou la pause
n'est jamais débité ; en points de chaîne, il est remboursé (`CANCELED`) comme sous cooldown.

**Réconciliation (Studio, encart « À vérifier ») :** demandes ouvertes depuis plus de 2 min, `uncertain`,
remboursements dus non faits, primes dues non payées, points de chaîne non remboursés, animations non jouées. Chaque
ligne a son action.

## 9. États

| Statut               | Sens                   | Annulable            | Remboursement                                            |
| -------------------- | ---------------------- | -------------------- | -------------------------------------------------------- |
| `queued`             | payé, en file          | oui (modérateur)     | à l'annulation                                           |
| `searching`          | recherche du bot       | non                  | si échec                                                 |
| `timeout_requested`  | timeout envoyé         | non                  | si refus de Twitch                                       |
| `confirmed`          | timeout confirmé       | non ; levée possible | non                                                      |
| `flop`               | aucun éligible         | —                    | non (règle actuelle)                                     |
| `failed`             | rien n'a été fait      | —                    | oui, automatique (Jetons ; points si récompense Raptoru) |
| `uncertain`          | le timeout a pu partir | —                    | à vérifier (modérateur)                                  |
| `canceled` (nouveau) | retiré de la file      | —                    | une fois                                                 |
| `simulated`          | essai sans sanction    | —                    | —                                                        |

Colonnes ajoutées (migration additive) : `price_paid`, `series_level`, `wish_id/login/name`, `sniper` (§ 4.3),
`canceled_by`, `cancel_reason`. Source `extension` et statut `canceled` ajoutés aux contraintes. Le rouleau (bande,
`strike_at`, état) est rangé dans `stats.reel` : pas de colonne, pas de statut `selected`.

## 10. Timeout Twitch et accès

- **Deux restrictions séparées :** le timeout Twitch (sanction de chat, appliquée par Twitch) et le blocage Raptoru
  (appliqué par le Core). Le Core ne déduit jamais un blocage d'un timeout.
- Le Core applique les mêmes règles sur tous les appareils. Un viewer en timeout qui voit l'extension (mobile) peut
  jouer ; si Twitch la masque sur ordinateur, on ne contourne rien. L'aide le dit.
- Mesures : build `timeout-debug` au lot 0.

## 11. Cas limites

| Cas                                              | Comportement                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Achats simultanés du même viewer                 | verrou de l'acheteur : prix, plafond et Sniper calculés dans l'ordre                                 |
| Réseau perdu côté extension                      | la même clé est renvoyée : la même demande                                                           |
| Événement en double (chat, points)               | dédoublonnage `(source, source_ref)` (inchangé)                                                      |
| Redémarrage du Core                              | tout est en base ; balayage de 15 s : remboursements, primes, frappes en retard                      |
| Redémarrage du bot                               | journal local, jamais un second timeout (inchangé)                                                   |
| Prix baissé entre l'affichage et la confirmation | on débite le prix plus bas, le reçu le dit                                                           |
| Prix monté (achat parallèle)                     | refus sans débit, nouveau prix affiché                                                               |
| Comptes secondaires qui se visent                | chance de 1/N inchangée ; au plus une prime par compte et par 30 min ; visible dans les statistiques |
| Données personnelles                             | prédictions des autres visibles après le résultat seulement ; stats personnelles au seul viewer      |

## 12. Réglages du module

| Réglage                                                                           | Défaut            |
| --------------------------------------------------------------------------------- | ----------------- |
| `random_ban.price` (« Prix de Random Ban », extension et `!rb`)                   | 25 000            |
| `random_ban.charges_max` (0 = aucune limite)                                      | 3                 |
| `random_ban.recharge_min`                                                         | 10                |
| `random_ban.channel_max` · `channel_window_min` (limite de la chaîne, 0 = aucune) | 0 · 10            |
| `random_ban.max_pending`                                                          | 3                 |
| `random_ban_ext.enabled` (achat depuis l'extension, interrupteur du socle)        | OFF               |
| `random_ban.sniper_window_min` · `sniper_bonus`                                   | 30 · 2 000        |
| `random_ban.sequence` (0 = timeout puis vidéo, 1 = Le Viseur) · `strike_offset_s` | 0 · 3 (à mesurer) |
| `random_ban.queue_paused` (réglé par la modération)                               | 0                 |

Toutes existent dans le code (module `random_ban` du socle, `modules/random-ban.ts`) et se règlent dans Studio
(« Sanctions › Random Ban », panneau de réglages).

## 13. État de la construction (Lab, 12/11, V1)

« Testé » = tests automatisés et parcours Chromium sur données fictives. Rien n'est validé par Antoni, rien n'est en
Production.

| Partie                                                                                                               | Où                                                                                                                                | État                                                      |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| V5 : prix fixes, charges communes, limite de la chaîne, recharge par la modération, refus limités à 1 / 5 min        | `random-ban/pricing.ts`, `random-ban/refusal.ts`, `RandomBanService.admit/buy/requestChannelPoints`                               | codé, testé (PGlite + vrai PostgreSQL, deux Cores)        |
| `!rb`                                                                                                                | `chat-interactions/random-ban-chat.ts`                                                                                            | codé, testé                                               |
| Achat extension, jauge, Sniper, « Mes stats »                                                                        | `modules/random-ban.ts` (`random_ban_ext`, OFF), `extension/shared/random-ban-view.js`                                            | codé, testé, vu dans Chromium (deux shells, deux tailles) |
| Sniper : cible figée, jamais transmise au tirage, fenêtre 30 min toutes sources, prime unique                        | `random-ban/sniper.ts`                                                                                                            | codé, testé (cas limites, simultanés, vrai PostgreSQL)    |
| Points de chaîne : charges, refus, `CANCELED`, message après Twitch, remboursement auto d'un échec                   | `channel-points/service.ts`                                                                                                       | codé, testé (Twitch simulé)                               |
| Le Viseur : bande, frappe différée, « Esquivé ! », secours sans Studio                                               | `random-ban/reel.ts`, `RandomBanService.target/claimAnimation`, `twitch-bot` (`delay_ms`), `studio/server/effects-player/reel.js` | codé, testé ; rendu vu dans Chromium ; OFF (`sequence` 0) |
| Modération : historique, À vérifier, annuler, rembourser un incertain, retirer une prime, pause, blocage et délai D4 | `random-ban/moderation.ts`, page Studio                                                                                           | codé, testé (Core) ; page Studio typée, non vue à l'écran |
| Statistiques : personnelles (extension, site) et publiques (`GET /v1/site/modules/random-ban/public`)                | `module-stats/service.ts`                                                                                                         | codé, testé ; le site n'est pas modifié                   |
| Défi secret : métriques `random_ban_sniper`, `random_ban_self`                                                       | `challenges/metrics.ts`                                                                                                           | codé, testé ; le défi est à créer par Antoni              |
| Démonstration locale                                                                                                 | `apps/core-api/scripts/mini-jeux-demo.ts`                                                                                         | parcours complet joué dans Chromium                       |
| Migration additive                                                                                                   | `20261123120000/130000_random_ban_purchase*.sql`                                                                                  | appliquée seulement sur des bases locales de test         |
| Lever une sanction (Unban), tampon « SNIPER ! », vrais avatars                                                       | —                                                                                                                                 | pas fait                                                  |

## Annexe A — propositions abandonnées (historique, ne s'appliquent pas)

- **Prix progressif** (25 000 · 30 000 · 50 000 · 75 000 · 100 000, un palier de moins toutes les 5 min, `!rb <montant>`
  pour confirmer), décidé le 12/11, jamais déployé : remplacé le 13/11 par les prix fixes et les charges (§ 2). Le code
  n'est pas gardé : le retour arrière est le redéploiement du Core précédent.
- **Cooldown individuel de 10 min des points de chaîne** : remplacé par les charges communes.

- **Fenêtre glissante** (« les lancers des N dernières minutes ») et **expiration de chaque lancer** : rejetées, car
  après une rafale tous les lancers expirent ensemble et le prix retombe d'un coup au normal.
- **Récupération d'un palier toutes les 10 min** (retour au normal en 40 min), proposée le 12/11 : remplacée le même
  jour par 5 min (retour en 20 min).
- **Barèmes multiplicatifs** de la première version : remplacés par les cinq montants fixes du § 2.1.
- **Sniper à 60 min** de la première version : remplacé par 30 min, toutes sources comptées (§ 4.2).
- **Animation « ban d'abord » comme séquence finale** : elle reste seulement le mode de secours et l'étape de
  transition (`random_ban.sequence` = 0), la séquence retenue est l'hybride (§ 5).
