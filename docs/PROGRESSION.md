# Progression native — XP, niveaux, titres et badges

Remplace les niveaux WizeBot. **Le Core est la source de vérité** (XP, niveaux, historique, récompenses) ; le bot ne
fait que lui transmettre ce qu'il transmet déjà (présence, messages du chat) ; Studio configure et attribue ;
raptoru.fr affiche et permet de choisir ce qu'on équipe. Les titres et badges sont des **cosmétiques de raptoru.fr**,
jamais des badges du chat Twitch.

**État** : voir `docs/PROGRESSION_GO.md` (livraison). Migration
`20261113130000_progression.sql` (additive). **OFF par défaut** : rien n'est compté avant l'activation dans Studio.

## Calcul de l'XP

| Source   | Règle (réglable)                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Présence | `xp_per_minute` (1) par minute de **présence validée** : le viewer figure dans deux relevés Get Chatters consécutifs (toutes les 2 min, en live). Un spectateur absent de la liste des chatters (mobile, lecteur intégré…) n'est **pas** compté : aucune détection de lurker n'est promise. |
| Chat     | `message_xp` (5) par message, au plus un message récompensé par `message_cooldown_s` (60 s) ; au moins `message_min_chars` (4) caractères ; jamais une commande (`!`) ; seulement en live (`live_only`).                                                                                    |
| Exclus   | le diffuseur et `excluded_logins` (lecroupier_, viewerumobilu, streamelements, wizebot, nightbot, streamlabs).                                                                                                                                                                              |

Chaque mouvement est écrit **une seule fois** dans `progression_ledger` (clé unique : intervalle de présence, id de
message, import) : un message ou un relevé renvoyé ne paie jamais deux fois. Le registre est en ajout seul.

**Niveaux** : XP totale pour atteindre le niveau L = `round(curve_base × (L − 1) ^ curve_exponent)` (60 et 1,6 par
défaut : niveau 10 ≈ 2 000 XP, niveau 50 ≈ 30 000, niveau 135 ≈ 152 000). Changer la courbe recalcule les niveaux,
jamais l'XP.

## Titres et badges

- **Catalogue** (`progression_rewards`) : titre ou badge, libellé, description, rareté (`common`, `rare`, `epic`,
  `legendary`, `event`), catégorie, niveau de déblocage optionnel, actif ou non.
- **Inventaire** (`progression_grants`) : une ligne par viewer et récompense, avec sa source (`level`, `event`,
  `manual`, `import`) et sa référence (« halloween-2026 »…). Une révocation garde la ligne (qui, quand, pourquoi) ;
  un niveau ne redonne jamais une récompense révoquée à la main ; une nouvelle attribution volontaire la rend.
- **Équipement** (`progression_equipped`) : un titre et jusqu'à 3 badges, choisis sur raptoru.fr parmi ce que le
  viewer possède. Changer de titre ne fait rien perdre ; une révocation déséquipe.
- **Événements** : `POST …/progression/grant` (récompense, viewers, `source: event`, `reference`) — générique, pour
  Halloween comme pour tout autre événement, mini-jeu ou Tombola spéciale ; aucune modification de base à la main.

## Reprise de WizeBot

Récupérable (API et tableau de bord WizeBot en lecture seule, via raptoru.fr, relevé du 29/10) : **niveau**
(2 441 viewers), **watchtime** (5 943), **messages** (2 991), par pseudo WizeBot, et l'identifiant Twitch que WizeBot
donne pour ses 1 000 premiers de chaque classement. Ni l'XP WizeBot ni ses titres de rang ne sont exposés : non
récupérables (le niveau est repris, l'XP repart du seuil de ce niveau sur la courbe native).

**Lecture** : Studio « Simuler » / « Importer depuis WizeBot » → `POST …/progression/import/wizebot` ; le Core lit
lui-même `https://raptoru.fr/api/wizebot?export=1` (toute la lecture, ~6 000 pseudos, une ligne par pseudo) et
importe en **une transaction** ; la simulation fait exactement le même travail puis l'annule.

**Chaque ligne est gardée** dans `progression_history` (pseudo d'origine, niveau, watchtime, messages, identifiant et
sa provenance, date du relevé, statut), rattachée ou non. Une fois rattachée, ses mesures sont figées ; un relevé plus
ancien ne remplace jamais un relevé plus récent.

**Rattachement : les règles du Wallet** (`docs/ECONOMY_MIGRATION.md` § 8, `wallet/se-identity.ts` — l'identifiant
Twitch est l'identité ; la quarantaine plutôt qu'un mauvais titulaire), le répertoire du Core tenant lieu de « Twitch
aujourd'hui » :

| Preuve                                                                                          | Résultat                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| identifiant donné par WizeBot (`id_source: wizebot`)                                            | rattaché par identifiant (exact)    |
| paire (id, pseudo) du site legacy (`legacy` : dernier relevé, connexions Twitch) non contredite | rattaché par identifiant            |
| paire legacy contredite (le Core connaît un autre titulaire du pseudo : pseudo réattribué)      | `ambiguous`                         |
| plusieurs titulaires dans les données legacy (`ambiguous`)                                      | `ambiguous`                         |
| pas d'identifiant, **un seul** compte du Core sous ce pseudo                                    | rattaché par pseudo                 |
| plusieurs comptes du Core sous ce pseudo                                                        | `ambiguous`                         |
| aucun compte connu                                                                              | `pending`                           |
| un viewer atteint par deux lignes, ou qui a déjà un historique                                  | `conflict` (aucune n'est fusionnée) |

Rattacher = démarrer le viewer à son niveau WizeBot (XP = seuil, une fois : clé `import:wizebot:<id>`) et garder son
watchtime et ses messages à part (`imported_*`). L'XP gagnée depuis n'est jamais touchée.

**Ne perdre personne** : les lignes en attente se rattachent **automatiquement** quand le viewer revient — relevé de
présence, message dans le chat, ou connexion Twitch sur raptoru.fr (`POST /v1/site/progression/identify`, la paire
vérifiée par l'OAuth du site) — avec les mêmes règles. Les cas incertains (ambigus, conflits) attendent une **décision
dans Studio** (« Historiques en attente » : comptes du Core sous ce pseudo, puis « Rattacher… » avec l'identifiant
vérifié et la façon dont il l'a été, journalisé). Jamais de rattachement sur la ressemblance des pseudos ; un viewer
n'a qu'un historique WizeBot.

`POST …/progression/import/revert` retire exactement l'import (les lignes repassent en attente, les récompenses déjà
données restent). L'XP de présence passe dans son propre savepoint : une erreur de progression n'annule jamais le
cycle de présence ni les Jetons de fidélité. Livraison : `docs/PROGRESSION_GO.md`.

## Présence et messages après WizeBot

Le Core compte lui-même, dès l'activation : `watch_seconds` (présence validée, la même que pour les Jetons) et
`messages` (chaque message non-commande, une fois). Le site affiche **historique WizeBot + compté par Raptoru**
(`totals` d'un viewer ; classements `GET /v1/progression/leaderboard?by=xp|watch|messages`). « Présence détectée » =
vue dans la liste des chatters Twitch, jamais présentée comme une preuve de visionnage. Les classements semaine / mois
de présence et de messages restent ceux de WizeBot tant qu'il répond (le Core ne garde pas ces fenêtres).

## Administration dans Studio

Rechercher un viewer (pseudo ou identifiant), voir niveau, XP, présence, messages, inventaire ; **XP manuelle** :
ajouter, retirer, fixer l'XP ou le niveau (`POST …/progression/adjust`, raison obligatoire, une clé par clic : un
double clic ne compte qu'une fois ; jamais sous 0 ; le niveau suit l'XP) ; **journal** du viewer (reprises, ajouts,
corrections : qui, quand, pourquoi) et son historique WizeBot rattaché.

## Routes

- Public (raptoru.fr) : `GET /v1/progression/leaderboard?by=xp|watch|messages`, `GET /v1/progression/viewers/<id>`,
  `GET /v1/progression/catalog`.
- Studio (installation appairée ; `/v1/lab/progression/*` dans le Lab) : `settings`, `rewards`, `grant`, `revoke`,
  `adjust`, `viewers`, `viewers/<id>`, `viewers/<id>/history`, `import`, `import/wizebot`, `import/status`,
  `import/waiting`, `import/attach`, `import/resolve`, `import/revert`.
- Site (jeton `SITE_TOKEN`, routes montées seulement s'il est défini) : `POST /v1/site/progression/equip`,
  `POST /v1/site/progression/identify`.

## Retour arrière

SQL en tête de la migration, démontré sur PostgreSQL réel (`progression-rollback.integration.test.ts`). Il efface
l'XP et les inventaires : préférer couper la progression dans Studio (OFF), qui fige tout sans rien perdre.
