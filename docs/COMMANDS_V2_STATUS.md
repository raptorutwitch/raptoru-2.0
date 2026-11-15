# Commands V2 — état et reprise

Mis à jour le 2026-10-05. Vérifier `git status` / `git log` avant de se fier aux SHA ci-dessous.

## Où on en est

| Phase       | Contenu                                                                                                                                                                                                             | Statut     | Commits                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| A0          | Frontière migrations Lab / prod (`migrate(db, scope)`, classement fail-closed)                                                                                                                                      | ✅ validée | `6c9bc58`                                                                |
| A           | Modèle de configuration + API Core (versions, droits équipe, historique, mots réservés Tombola)                                                                                                                     | ✅ validée | `5663870`                                                                |
| B           | Admission : `decide()` unique, audience, arguments/variables, cooldown, quota, dédoublonnage, `cmd_invocations`                                                                                                     | ✅ validée | `679f8f2`, correctif audience/follower `a7bb5a0`                         |
| C           | File durable `cmd_steps`, claim/bail/ACK, retry/unknown, journal bot, rate limit, « Sortie chat réelle » (OFF par défaut) — envoi Twitch réel validé                                                                | ✅ validée | `cc930bb`, `bbec48d` (redémarrage bot à l'activation, `executor_absent`) |
| D           | Onglet Studio « Commandes » (liste V6.3, fiche, création, Tester, historique, droits, catégories, état runtime)                                                                                                     | ✅ validée | `e2bb54f`                                                                |
| fix         | Groupe Streamer = identité broadcaster réelle                                                                                                                                                                       | ✅ validé  | `1a71099`                                                                |
| E           | Extension « Modération › Commandes » (Video + Mobile, pas Panel), façade EBS Lab                                                                                                                                    | ✅ validée | `3975535`                                                                |
| fix         | Renommer une commande depuis l'Extension                                                                                                                                                                            | ✅ validé  | `36ae298`                                                                |
| Permissions | Droit d'équipe `rename` (renommer = modifier `config.name`), réglable par rôle dans Studio → Droits de l'équipe                                                                                                     | ✅ validée | voir `git log`                                                           |
| F           | « Commandes » public pour les viewers dans l'Extension (Video + Mobile, pas Panel), lecture seule : Hub → Commandes, projection publique Core `GET /v1/lab/commands/:c/public` via l'EBS Lab `GET /commands/public` | ✅ validée | voir `git log`                                                           |

## Action « son » et viewers par ID Twitch (15/11/2026)

- **Action « son »** : une commande peut jouer un son sur le stream, seul ou avec des messages.
  - Le son est importé dans Studio (MP3, OGG ou WAV, 2 Mo au plus), dans le dossier de Studio, jamais dans Git.
  - Il est joué par la **source OBS sonore invisible** déjà utilisée par Level Up (aucune nouvelle source à ajouter ;
    l'actualiser une fois dans OBS après la mise à jour de Studio).
  - Le Core le met en file à l'admission (`cmd_sounds`, migration additive `20261128130000_cmd_sounds.sql`) : une fois
    par utilisation acceptée, expiré après la minute de vie des étapes (jamais en retard), sans lien avec « Sortie chat
    réelle » ni avec l'économie.
  - Studio le prend toutes les 2 s tant qu'une source écoute (`/v1/lab/commands/<chaîne>/sounds/claim`, par le cockpit
    en Production), chaque son une seule fois.
- **Viewers précis par ID Twitch** (`audience.allow_ids`) : ils gardent le droit s'ils changent de pseudo.
  - Studio convertit un pseudo saisi en ID grâce à l'annuaire du Core ; un pseudo inconnu est refusé, jamais deviné.
  - Même droit d'équipe et même historique que « Autoriser aussi » (`audience.allow`).
- Configurer : Studio › Commandes › une commande › « Ensuite » › **Ajouter un son**, puis « Qui » › **Viewers
  précis**. Pour un son seul : la réponse sur « Ne rien répondre ».

Commands V2 A0 → F est terminé et validé (Lab). Les passes de consolidation de l'audit sont suivies dans
[`docs/ASTRA_GLOBAL_AUDIT_2026-10.md`](ASTRA_GLOBAL_AUDIT_2026-10.md). Commands reste Lab jusqu'à un cutover explicite.

## Migrations Commands (Lab uniquement, déjà appliquées — ne jamais les réécrire)

- `20261011120000_commands_v2.sql` — commandes, triggers, historique, droits équipe
- `20261012120000_commands_v2_invocations.sql` — invocations (décisions)
- `20261013120000_commands_v2_steps.sql` — file `cmd_steps`, `chat_output`
- `20261014120000_commands_v2_categories.sql` — catégories du streamer

Toute évolution passe par une nouvelle migration additive, classée `lab` dans `apps/core-api/src/db/migration-scopes.ts` et ajoutée aux listes Lab (`local-runtime.ts`, `bonk-lab.mjs`, `stage.mjs`).

## Règles à garder

- **Core = source de vérité.** Studio, l'Extension et le bot ne décident rien : ils affichent et transmettent. Pas de règle métier dupliquée côté UI (au-delà d'une aide UX légère).
- **Lab uniquement** jusqu'à un cutover explicite (SAMMI + StreamElements restent la production).
- **Streamer** = identité du compte broadcaster réel du canal (`BONK_LAB_CHANNEL_TWITCH_ID`, c.-à-d. `TWITCH_BROADCASTER_ID` du bot), jamais un rôle ou un badge envoyé par le client, jamais `channel_id` seul (le canal Lab `900100` n'est pas un id Twitch).
- Aucun passe-droit implicite : streamer et équipe suivent l'audience configurée (groupes OR, « Tout le monde » exclusif, deny gagne).
- Follower jamais déduit des badges : inconnu tant qu'il n'y a pas de provider Helix réel.
- `/me` n'est pas envoyé (Helix Send Chat Message ne le supporte pas) : affiché « non supporté ».
- Un envoi Twitch ambigu devient `unknown` et n'est jamais renvoyé.
- Règle unique partagée par tous les modules du chat Lab (Commands V2, annulation Tombola) : `apps/core-api/src/lab-chat/broadcaster.ts` (`75c9ea0`).
- Le **nom** (trigger principal) se renomme avec le droit d'équipe `rename` (vrai par défaut pour modos et supermodos, désactivable par rôle par le streamer ; les droits enregistrés avant son ajout le lisent à vrai). Le streamer peut toujours ; un verrou de module sur `name` gagne sur tout.
- Toute requête Extension passe par la façade `/commands/v2/*` avec l'identité du token ; jamais `STUDIO_ACTOR`.
- Aucun push / release / deploy sans demande explicite d'Antoni.

## Dette connue (ne pas corriger sans décision)

- Catégories : pas de version (dernier écrit gagne) et pas d'entrée dans l'historique.
- `apps/studio/web/src/pages/commands.css` et `apps/twitch-extension/extension/commands-v2.css` ont été générés une fois depuis le prototype `prototypes/commands-v6/` (non versionné) : ce sont désormais les sources.
- Extension : `cmdV2Post` est réessayé sur 5xx sans clé d'idempotence. Sans risque pour les données (`expected_version` sur update/delete, nom unique à la création), mais une création dont la réponse s'est perdue peut afficher une erreur alors que la commande existe.
- Libellés du modèle de vue dupliqués entre `apps/studio/web/src/commands-model.ts` et `apps/twitch-extension/extension/shared/commands-v2-model.js` (pas de partage de code entre TS Studio et JS Extension).
- Studio et Extension n'ont pas de rafraîchissement automatique pendant l'édition (rechargement à l'ouverture et après chaque action).

## Repères dans le code

- Core : `apps/core-api/src/commands/` (`service.ts` config/droits/catégories, `decide.ts`, `admission.ts`, `steps.ts`), routes `apps/core-api/src/http/commands-routes.ts`
- Bot (exécuteur Lab, LeCroupier_) : `apps/twitch-bot/src/lab-chat-output.ts`, `lab-chat-main.ts`
- Studio : relais `apps/studio/server/src/commands/relay.ts`, onglet `apps/studio/web/src/commands*.ts`
- Extension : façade `apps/studio/server/src/extension-lab/commands-facade.ts`, vue `apps/twitch-extension/extension/shared/commands-v2*.js` ; liste publique `shared/commands-public.js` (route EBS `/commands/public`, entrée Hub dans `shared/ui.js`)
- Référence UX validée : `prototypes/commands-v6/` (V6.3)
