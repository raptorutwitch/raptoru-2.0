# Commands V2 — état et reprise

Mis à jour le 2026-10-04. Vérifier `git status` / `git log` avant de se fier aux SHA ci-dessous.

## Où on en est

| Phase | Contenu                                                                                                                                              | Statut                                | Commits                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| A0    | Frontière migrations Lab / prod (`migrate(db, scope)`, classement fail-closed)                                                                       | ✅ validée                            | `6c9bc58`                                                                |
| A     | Modèle de configuration + API Core (versions, droits équipe, historique, mots réservés Tombola)                                                      | ✅ validée                            | `5663870`                                                                |
| B     | Admission : `decide()` unique, audience, arguments/variables, cooldown, quota, dédoublonnage, `cmd_invocations`                                      | ✅ validée                            | `679f8f2`, correctif audience/follower `a7bb5a0`                         |
| C     | File durable `cmd_steps`, claim/bail/ACK, retry/unknown, journal bot, rate limit, « Sortie chat réelle » (OFF par défaut) — envoi Twitch réel validé | ✅ validée                            | `cc930bb`, `bbec48d` (redémarrage bot à l'activation, `executor_absent`) |
| D     | Onglet Studio « Commandes » (liste V6.3, fiche, création, Tester, historique, droits, catégories, état runtime)                                      | ✅ validée                            | `e2bb54f`                                                                |
| fix   | Groupe Streamer = identité broadcaster réelle                                                                                                        | ✅ validé                             | `1a71099`                                                                |
| E     | Extension « Modération › Commandes » (Video + Mobile, pas Panel), façade EBS Lab                                                                     | ✅ validée                            | `3975535`                                                                |
| fix   | Renommer une commande depuis l'Extension                                                                                                             | ✅ validé                             | `36ae298`                                                                |
| **F** | **Liste publique viewer dans l'Extension**                                                                                                           | **⏳ prochaine étape, NON commencée** | —                                                                        |

Ensuite, après F : une passe **Permissions** (décider notamment d'un droit `rename_command`).

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
- Le **nom** (trigger principal) n'est renommable que par le streamer : aucun droit équipe dédié n'existe encore.
- Toute requête Extension passe par la façade `/commands/v2/*` avec l'identité du token ; jamais `STUDIO_ACTOR`.
- Aucun push / release / deploy sans demande explicite d'Antoni.

## Dette connue (ne pas corriger sans décision)

- **Tombola** : l'annulation par chat utilise un test du type `chatter.id === channel_id` pour reconnaître le streamer — même défaut que celui corrigé pour Commands (`1a71099`). Hors périmètre Commands.
- Catégories : pas de version (dernier écrit gagne) et pas d'entrée dans l'historique.
- `apps/studio/web/src/commands.css` et `apps/twitch-extension/extension/commands-v2.css` ont été générés une fois depuis le prototype `prototypes/commands-v6/` (non versionné) : ce sont désormais les sources.
- Studio et Extension n'ont pas de rafraîchissement automatique pendant l'édition (rechargement à l'ouverture et après chaque action).

## Repères dans le code

- Core : `apps/core-api/src/commands/` (`service.ts` config/droits/catégories, `decide.ts`, `admission.ts`, `steps.ts`), routes `apps/core-api/src/http/commands-routes.ts`
- Bot (exécuteur Lab, LeCroupier_) : `apps/twitch-bot/src/lab-chat-output.ts`, `lab-chat-main.ts`
- Studio : relais `apps/studio/server/src/commands/relay.ts`, onglet `apps/studio/web/src/commands*.ts`
- Extension : façade `apps/studio/server/src/extension-lab/commands-facade.ts`, vue `apps/twitch-extension/extension/shared/commands-v2*.js`
- Référence UX validée : `prototypes/commands-v6/` (V6.3)
