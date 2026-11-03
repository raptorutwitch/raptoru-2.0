# Défis et succès (raptoru.fr lot 5) — Lab, non livré

Le Core est l'autorité : il compte, termine et récompense. Studio sert à administrer, le site ne fait que lire.
**Aucun défi n'existe par défaut** : la migration ne crée aucune ligne, et les défis du simulateur et des tests sont
fictifs (« fictif », « Exemple fictif »).

Code :
- Core : `apps/core-api/src/challenges/` (`metrics.ts`, `service.ts`) et `src/http/challenges-routes.ts`.
- Studio : `apps/studio/web/src/challenges*.ts` et `server/src/challenges/relay.ts`.
- Site : `lb-app/api/challenges.js` et `public/app/defis.js`.

Tests :
- Core : `test/challenges.test.ts` (PGlite) et `test/challenges.integration.test.ts` (vrai PostgreSQL).
- Studio : `server/test/challenges-form.test.ts` et `server/e2e/challenges.e2e.ts`.
- Site : `test/site-refonte.test.js` (« Lot 5 »).

## 1. Fonctionnement

| Étape | Ce qui se passe |
|---|---|
| Définition | Antoni crée un brouillon dans Studio › Défis. Il choisit une métrique, un seuil, une période (unique, chaque semaine, chaque mois), des dates éventuelles, rétroactif ou non, public ou secret, et une récompense (objet de la Boutique, Jetons ou aucune). |
| Vérification | « Vérifier et prévisualiser » applique les règles du serveur et montre qui compterait et qui terminerait le défi s'il était activé maintenant. Rien n'est écrit. |
| Activation | Brouillon → actif. Le Core compte aussitôt. Un défi rétroactif est terminé tout de suite par ceux qui remplissent déjà la condition. |
| Comptage | Le Core **recompte** la métrique depuis la table source, compare avec `challenge_progress` et n'écrit que les changements, chacun journalisé (avant → après) dans `challenge_log`. Il recompte toutes les 60 s (minuterie), à l'activation, et quand on clique « Recompter maintenant » dans Studio. |
| Lecture | Le site lit `challenge_progress` tel quel : aucun calcul quand on consulte une page. |
| Complétion | La première fois que la valeur atteint le seuil. La date enregistrée est **celle où le Core l'a constaté** ; aucune date d'événement n'est inventée. |
| Récompense | Une ligne `challenge_awards` par (défi, période, viewer). La clé primaire interdit une seconde ligne. Le paiement passe par l'attribution déjà idempotente de la Boutique (`cosmetic_awards`, clé `challenges:<défi>:<période>:<viewer>`). Un échec (Wallet indisponible, objet désactivé) est retenté à chaque passage, jusqu'à 50 essais, et visible dans Studio. |
| Correction | « Retirer… » dans Studio reprend un objet avec une raison. La récompense passe à `revoked` et n'est jamais redonnée. Les Jetons ne sont pas repris par le moteur : un ajustement du Wallet s'en charge. |
| Suspension | Plus de comptage, plus de versement. « Reprendre » recompte et verse ce qui était en attente. |
| Archivage | Le défi disparaît du site, les succès obtenus restent, et il ne peut plus être réactivé. |

**Pourquoi un recomptage plutôt qu'un journal d'événements à part.** Chaque table source **est** déjà un journal
d'événements à identifiant unique : `word_game_finds.occurrence_id`, `rb_requests.request_id`, opérations du Wallet
par clé d'idempotence, etc.
- Un événement rejoué n'y crée pas de seconde ligne, donc il n'est jamais compté deux fois.
- Un remboursement ou une tombola annulée sort du compte au passage suivant : c'est une correction négative, journalisée (`progress`, et `below_target` si la valeur repasse sous le seuil après la complétion).
- Le rattrapage après une panne et la réconciliation sont le même passage, rejouable sans risque.
- On n'ajoute aucun code dans les chemins d'écriture des modules de Production.

**Concurrence.** Chaque défi est recompté dans une transaction qui verrouille sa définition (`for update`). Deux
passages simultanés sont donc sérialisés : le second voit les écritures du premier et ne change rien. Le test sur un
vrai PostgreSQL lance 4 passages en parallèle, depuis deux pools de connexions : 40 complétions et 40 paiements,
exactement.

## 2. Métriques disponibles (`metrics.ts`)

| Clé | Source | Granularité | Limite historique |
|---|---|---|---|
| `words_found`, `words_fast` | `word_game_finds` | exacte | depuis le Core (20/10/2026) ; l'archive de l'ancien site n'est pas datée par mot |
| `raffle_joins`, `raffle_wins` | tirages `finished` (`lab_raffles` et entrées / gagnants), retirés exclus | exacte (date de fin du tirage) | tombolas du Core seulement |
| `daily_claims` | `daily_claims` | exacte | historique importé daté inclus |
| `random_ban_sent`, `random_ban_landed`, `random_ban_received` | `rb_requests`, mode `real`, terminés | exacte | depuis Random Ban V3 ; rien avant (SAMMI) |
| `paid_bonk`, `paid_tts`, `paid_soundboard` | Wallet canonique, débits `interaction:<id>:debit` non remboursés | exacte | depuis le Wallet canonique ; usages gratuits non comptés |
| `duels_won` | `mini_game_duels` résolus | exacte | depuis le Core |
| `watch_minutes`, `messages` | `progression_period_stats` (semaine, mois) ; `progression_accounts` (à vie, import WizeBot inclus) | **par période** | un défi unique sur ces métriques doit être rétroactif et sans dates (total à vie) ; un défi non rétroactif commence à la première période **entière** après l'activation |

Pour toutes les métriques :
- Les comptes exclus de la fidélité (`loyalty_exclusions` : bots, tests) ne comptent jamais.
- Une métrique dont la table source n'existe pas sur ce Core est marquée indisponible. C'est le cas dans le Lab, qui n'a ni Wallet canonique ni Daily. Studio la grise, et l'activation comme la prévisualisation la refusent.
- Ajouter une métrique = une entrée dans `metrics.ts`, avec ses tables, sa requête et sa date de premier enregistrement, plus un test.

## 3. Règles du serveur

- Identifiant : `[a-z0-9][a-z0-9_-]{0,47}`. `meta`, `runs`, `run` et `preview` sont réservés.
- Seuil : de 1 à 1 000 000 000. Récompense en Jetons : de 1 à 1 000 000.
- La fin doit être après le début. Un défi dont la fin est passée ne peut pas être activé.
- Un objet donné en récompense doit exister, être publié et actif. C'est vérifié à l'activation, et de nouveau au paiement.
- **Une condition publiée est figée** : métrique, seuil, période, dates, rétroactivité et récompense. Le titre, la description, la catégorie, l'icône et la visibilité peuvent changer : `version` augmente et une ligne `admin` est ajoutée au journal. Pour une autre condition, il faut archiver le défi et en créer un nouveau.
- Transitions autorisées : brouillon → actif ou archivé ; actif ↔ suspendu ; actif ou suspendu → archivé. Seul un brouillon peut être supprimé.
- Semaine : du lundi au dimanche, heure de Paris (`w2026-11-02`). Mois : `m2026-11`. Le Core recompte la période en cours et la précédente, pour les événements arrivés en retard.
- Un défi dont la fin est passée de plus de 24 h n'est plus recompté : son état est définitif.

## 4. Routes

| Route | Accès | Rôle |
|---|---|---|
| `GET/POST /v1/studio/challenges[...]` (Production) | installation Studio appairée | liste, `meta`, création, modification, `delete`, `status`, `preview`, `run`, `runs`, détail (progressions, récompenses, journal), `revoke` |
| `/v1/lab/challenges[...]` | secret du Lab | les mêmes, dans le Lab |
| `GET /v1/site/challenges[?viewer=<id>]` | jeton du site (absente sans `SITE_TOKEN`) | catalogue, progression et succès du viewer. **Aucune route d'écriture côté site.** |

- **Migration absente** : toutes ces routes répondent 503 `challenges_unavailable`, et la minuterie ne fait rien.
- **Site** : il passe toujours l'identifiant de sa session, jamais un paramètre du navigateur. Sans Core, ou avec un Core plus ancien, il affiche une indisponibilité propre.
- **Minuterie du Core principal** : désactivée par défaut (`CHALLENGES_ENGINE=false`). Même activée, elle ne fait rien sans les tables ou sans défi actif. Dans le Lab, elle est toujours active.

## 5. État

- Migration `20261120130000_challenges.sql`, avec son jumeau Lab `20261120120000_challenges_lab.sql` : uniquement de nouvelles tables, aucune donnée. **Préparée, non appliquée.** Le retour arrière est en commentaire dans le fichier.
- Rien n'est en Production : aucune migration appliquée, aucun déploiement, aucune release Studio.
- **Testé automatiquement** :
  - Core : règles, rétroactif ou non, rejeu, remboursement, passages répétés et simultanés (PGlite et vrai PostgreSQL), panne au paiement puis reprise, suspension, retrait, semaine, défi secret, migration absente, métrique sans source, routes et accès ;
  - Studio : test de bout en bout de l'onglet sur des données fictives ;
  - site : tests de la route et contrôle visuel sur ordinateur et sur mobile.
- **Non vérifié** :
  - aucun test manuel par Antoni ;
  - aucun essai sur les données réelles de Production, notamment le volume d'un premier recomptage rétroactif sur tout l'historique (mesure à faire sur une copie avant de l'activer) ;
  - Safari et vrais téléphones.

## 6. Ce qui reste (non bloquant)

- **Notifications au viewer** (« Défi réussi ») : le moteur journalise, mais rien n'est encore envoyé (chat, notifications du site).
- **Trophées de l'ancien site** (`player_achievements`) : leur reprise comme défis rétroactifs demande de connaître leurs conditions exactes. À décider avec Antoni.
- **Défis publics sur le profil d'un autre viewer** : décision de confidentialité, comme pour les statistiques du lot 4.
- **Bascule en « vérification »** si une métrique dérive brusquement. Aujourd'hui, une baisse est journalisée (`below_target`) et visible dans Studio, mais rien ne se met en pause automatiquement.
- **Icônes** : le site n'accepte que les noms de son propre jeu d'icônes (`trophy`, `word`, `ticket`, `dice`, `coin`, `clock`, `chat`…) ; tout autre nom s'affiche comme `trophy`.

## 7. Idées de défis — **suggestions à valider par Antoni, rien n'est créé**

Ces lignes sont des pistes pour remplir le catalogue. Les seuils et les récompenses sont des exemples d'ordre de
grandeur, **pas des décisions** :

| Idée | Métrique | Exemple de seuil | Période | Rétroactif ? |
|---|---|---|---|---|
| Premiers mots | `words_found` | quelques dizaines | unique | oui |
| Habitué de la tombola | `raffle_joins` | quelques dizaines | unique | oui |
| Chanceux | `raffle_wins` | 1 | unique | oui |
| Fidèle au Daily | `daily_claims` | une semaine de streams | chaque mois | oui |
| Bavard de la semaine | `messages` | à fixer d'après les classements | chaque semaine | oui |
| Spectateur assidu | `watch_minutes` | à fixer d'après la présence moyenne | chaque mois | oui |
| Duelliste | `duels_won` | une poignée | unique | oui |
| Semeur de chaos | `random_ban_landed` | une poignée | unique | non (pas d'historique avant la V3) |

Questions à trancher avant la Production :
- les récompenses (objets exclusifs à créer dans la Boutique, ou montants en Jetons) ;
- les défis secrets ;
- l'affichage public des succès sur les profils.
