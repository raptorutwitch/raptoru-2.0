# Progression native — XP, niveaux, titres et badges

Remplace les niveaux WizeBot. **Le Core est la source de vérité** (XP, niveaux, historique, récompenses) ; le bot ne
fait que lui transmettre ce qu'il transmet déjà (présence, messages du chat) ; Studio configure et attribue ;
raptoru.fr affiche et permet de choisir ce qu'on équipe. Les titres et badges sont des **cosmétiques de raptoru.fr**,
jamais des badges du chat Twitch.

**État** : développé et testé automatiquement (branche `feat/progression`), **non déployé**. Migration
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

Récupérable (API WizeBot en lecture seule, via raptoru.fr, relevé du 29/10) : **niveau** (2 441 viewers),
**watchtime** (5 943), **messages** (2 991), par pseudo WizeBot. Ni l'XP WizeBot ni ses titres de rang ne sont
exposés par l'API : non récupérables.

`POST …/progression/import` démarre chaque viewer **à son niveau WizeBot** (XP = seuil de ce niveau, une fois par
viewer : clé `import:wizebot:<id>`) et garde son watchtime et ses messages comme historique importé, à part. Un pseudo
est résolu par les viewers connus du Core ; les inconnus sont renvoyés (à réimporter plus tard, jamais devinés).
`POST …/progression/import/revert` retire exactement l'import (les récompenses déjà données restent).

## Routes

- Public (raptoru.fr) : `GET /v1/progression/leaderboard`, `GET /v1/progression/viewers/<id>`, `GET /v1/progression/catalog`.
- Studio (installation appairée ; `/v1/lab/progression/*` dans le Lab) : `settings`, `rewards`, `grant`, `revoke`,
  `import`, `import/revert`.
- Site (jeton `SITE_TOKEN`, route montée seulement s'il est défini) : `POST /v1/site/progression/equip`.

## Retour arrière

SQL en tête de la migration, démontré sur PostgreSQL réel (`progression-rollback.integration.test.ts`). Il efface
l'XP et les inventaires : préférer couper la progression dans Studio (OFF), qui fige tout sans rien perdre.
