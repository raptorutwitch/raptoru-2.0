# Contrats du socle modulaire (implémentés, mis à jour le 05/11/2026 — consolidation)

Ce qui existe dans le code, pas une intention. Les chemins sont relatifs à `apps/` sauf mention.

## 1. Déclaration d'un module — `core-api/src/modules/kit.ts`

Un module est **un objet `ModuleDefinition`** dans **un fichier** `core-api/src/modules/<id>.ts`, plus **une ligne**
dans `core-api/src/modules/index.ts`. Les deux Cores (principal et Lab) construisent leur hôte depuis cette liste unique.

| Champ | Rôle |
|---|---|
| `id` | `^[a-z][a-z0-9_]{1,40}$` ; aussi le préfixe des réglages (`<id>.<clé>`) et l'ancre de la page Studio |
| `label`, `description`, `category` | identité affichée (catégories `jeux`, `interactions`, `communaute`, `outils`) |
| `labOnly` | jamais monté sur l'économie canonique (Production) |
| `capabilities` | ce que le module **fait** : `settings`, `admin`, `viewer`, `wallet`, `live`, `history`, `moderation`, `chat`, `supervision`, `tick` |
| `settings` | réglages bornés (entiers) : `label`, `unit`, `default`, `min`, `max`, `help?`, `advanced?` |
| `enabledByDefault` | défaut de l'interrupteur automatique `<id>.enabled` (créé pour tout module à actions viewer ; 0 par défaut) |
| `enabled(ctx, q, ch)` | module historique qui garde **son** interrupteur : l'hôte le lit (interdit avec des actions viewer) |
| `admin` | actions Studio : `label`, `permission?`, `confirm?`, `input?` {clé, libellé, min, max}, `run` |
| `viewer` | actions viewer : `label`, `price?(ctx,q,ch)`, `liveOnly?`, `run` → `done` ou `queued` |
| `viewerState` | ce que l'extension montre au viewer (son état propre) |
| `status` | état pour le Centre de contrôle (voir § 5) |
| `moderation` | `{ visible, refund: 'never' \| 'moderator', note }` |
| `expireQueuedMs` | une action `queued` non terminée après ce délai échoue et est remboursée une fois |
| `chat(ctx)`, `tick` | lecture du chat Lab, travail périodique |

**Contrôle automatique `checkModule`**, exécuté au démarrage de chaque Core (un module invalide empêche le démarrage) et
par les tests. Il refuse :
- une capacité déclarée sans implémentation, ou implémentée sans être déclarée ;
- des actions viewer sans politique de modération ;
- un module payant invisible pour la modération ;
- un module à actions viewer qui a son propre interrupteur ;
- le réglage `enabled` (réservé à l'hôte) ;
- les identifiants, les actions ou les réglages mal nommés ;
- deux modules ou deux réglages de même nom.

## 2. Contexte fourni au module — `ModuleContext`

`db`, `clock`, `economy` (le port du portefeuille : Lab fictif ou Wallet canonique selon le Core), `settings`,
`setting(q, ch, clé)`, `live(q)` (live canonique en Production, toujours vrai en Lab — H1), `settle(q, activityId,
{status, result})`, `state.get/set` (petit état JSON par module, table `module_state` : pas de migration pour un module
simple). Le module ne reçoit **aucune** copie de ces mécanismes : il appelle ceux-là.

## 3. Contrat d'action — `core-api/src/modules/host.ts`

**Action viewer** (`ModuleHost.viewer`). Dans **une** transaction, dans cet ordre :
1. Identité : le viewer vient du jeton vérifié par la porte (jamais du corps). La clé d'idempotence est obligatoire
   (`^[A-Za-z0-9:_-]{8,128}$`).
2. Rejeu : même clé et même requête → la réponse d'origine (`replayed: true`) ; même clé avec une autre requête →
   `idempotency_conflict`. L'unicité est garantie en base (`module_activity (channel, module, idempotency_key)`).
3. Refus communs :

   | Ordre | Condition | Code |
   |---|---|---|
   | 1 | pause globale | `global_pause` |
   | 2 | blocage modération `all` | `viewer_blocked` |
   | 3 | interrupteur | `module_disabled` |
   | 4 | hors live, si payant et `liveOnly` ≠ false | `stream_offline` |
   | 5 | solde | `insufficient_tokens`, etc. (codes du portefeuille) |

4. Journal (`module_activity`, statut `queued`), débit par le port d'économie (clé `interaction:<activityId>:debit`),
   exécution du module, statut final.
5. Toute erreur annule tout (pas de débit sans ligne, pas de ligne sans débit).

**Action Studio** (`ModuleHost.admin`) :
- permission déclarée, sinon streamer seul ;
- transaction, journal (`done`, opérateur) et audit.

**Fin d'une action `queued`** (`settle`) : décidée une seule fois sous verrou de ligne. Un échec payant rembourse
**le débit d'origine** une fois (`refunded`). L'expiration automatique (`expireQueuedMs`, tâche périodique des deux
Cores) passe par le même chemin.

## 4. Modération — voir `GUIDE_MODERATION.md`

`ModuleHost.activity` (journal partagé), `ModuleHost.refund` :
- motif obligatoire, permission `refund` (modérateur) vérifiée par le Core ;
- politique `refund: 'moderator'` exigée ;
- `already_refunded` / `nothing_to_refund` ;
- remboursement du débit d'origine, opérateur, motif et audit.

Jamais de crédit arbitraire.

## 5. État et supervision

`ModuleStatusView { intention: on|off, observed: ready|waiting|error|unknown, summary, reasons[], activity? }`.
- L'intention vient de l'interrupteur, l'observé du module.
- Un module sans `status` est « inconnu », jamais « prêt ».
- Un `status` qui échoue est lu « inconnu ».

Studio (`studio/server/src/control-center/modules.ts`) traduit :

| État du module | Affichage Studio |
|---|---|
| intention `off` | « coupé » (jamais une panne) |
| `ready` | ok |
| `waiting` | attention, avec la raison |
| `error` | erreur |
| `unknown` | inconnu |

## 6. Portes HTTP

| Porte | Chemin | Qui |
|---|---|---|
| Core (Lab et cockpit) | `/v1/lab/modules/<ch>`, `/activity`, `/refund`, `/<id>/status`, `/<id>/viewer-state`, `/<id>/admin/<a>`, `/<id>/viewer/<a>`, `/<id>/queue`, `/<id>/report` | jeton Studio |
| Cockpit Production | `/v1/studio/cockpit/modules/<ch>/…` (acteur forcé au streamer) | installation appairée |
| Studio | `/api/modules…` (`studio/server/src/modules/relay.ts`, en-tête Studio, même hôte, corps ≤ 16 Ko, acteur forcé) | interface Studio |
| Extension | `/modules/v3`, `/modules/v3/<id>/state`, `POST /modules/v3/<id>/<action>`, `/modules/v3/moderation/activity`, `POST /modules/v3/moderation/refund` | `packages/schemas/src/module-facade.ts`, **la même fonction** dans la façade de Production et l'EBS du Lab |

## 7. Lecteur OBS (pas de lecteur universel)

Le contrat commun est seulement le cycle `queued → settle(done|failed) → remboursement unique`, plus l'expiration.

La porte du lecteur :
- `GET /v1/lab/modules/<ch>/<id>/queue` : les actions en attente, les plus anciennes d'abord ;
- `POST /<id>/report {activity_id, status}` : le compte rendu du lecteur. Une action d'un autre module est refusée ; un
  second compte rendu ne change rien.

Un exécuteur OBS de Studio appelle ces deux routes par le client Lab ou le cockpit. Chaque module garde son rendu
(sa page d'overlay) : la démonstration B a un « lecteur fictif » (action Studio) qui appelle `ctx.settle`.

## 8. Persistance

| Table | Contenu | Migrations (Lab / Production) |
|---|---|---|
| `module_activity` | journal, idempotence, montants, statuts, opérateur, motif | `supabase/migrations/20261121170000_module_activity_lab.sql` / `20261121180000_module_activity.sql` |
| `module_state` | petit état JSON par module | mêmes migrations |
| `module_settings` | réglages bornés | table H10 existante |

Un Core sans la table `module_settings` applique les défauts.

**La migration de Production n'est pas appliquée.** Aucun module non `labOnly` n'utilise encore le journal : la
migration est exigée avant le premier.

## 9. Ajouts de la consolidation (« Opération fondation totale »)

| Contrat | Où | Règle |
|---|---|---|
| Porte chat | `kit.ts` `chat` + `chatWords`, `ctx.say` | mots réservés contre Commandes V2 ; réponses `module:<id>` (une migration pour tous : `20261121190000`) ; idempotentes par clé ; module coupé = sourd ; un module qui échoue répond `module_error`, les autres reçoivent le message |
| Interrupteur | `hasSwitch` | l'interrupteur du socle existe pour un module à actions viewer ou à lecture du chat, sauf s'il garde le sien (`enabled()`) ; le catalogue dit `has_switch` |
| Adaptateur | `ModuleHost.add(def)` | un module historique s'enregistre une fois son service créé (Votekick, Caution, Random Ban, Jeu des mots, Boutique d'événement) ; même contrôle `checkModule` |
| Prix confirmé | `viewer(…, expected_price)` | un prix différent du prix actuel est refusé (`price_changed`) **avant** tout débit |
| Une personne à la fois | verrou consultatif `module:<ch>:<id>:<viewer>` | les actions d'un viewer sur un module sont sérialisées : intention rejouée, limite par viewer tenue ; même clé d'un autre viewer = `idempotency_conflict` |
| Compteurs partagés | `ctx.lock(q, ch, key)` | un module sérialise ses mises à jour partagées dans la transaction de l'appelant |
| Lecteur OBS | `POST …/<id>/claim {player}`, `POST …/<id>/report` | bail de 30 s (`PLAYER_LEASE_MS`), `skip locked` : deux lecteurs ne montrent jamais la même action ; l'expiration ne rembourse pas une action réservée avant la fin du bail |
| Auto-remboursement | `refund` | refusé depuis l'extension sur son propre achat (`self_refund`) |
| Cockpit | `studio-cockpit-routes.ts` | une action **viewer** n'y passe jamais (404) : elle n'entre que par la porte de l'extension, avec l'identité du jeton vérifié |
| Isolation | `catalog`, `status`, `tick` | un module illisible est listé « inconnu » sans vider le catalogue ; chaque travail périodique tourne à part, jamais deux fois en même temps |
| Modération d'équipe | façade `GET /modules/v3/moderation`, `GET /modules/v3/moderation/<id>/activity` | liste des modules modérables (coupés compris), journal d'un seul module dont la politique est visible ; équipe seulement |
| Studio | `createStudioServer(options)` | options nommées (friction S1) |

## 10. Extension : variantes de module et rafraîchissement rapide (05/11, `50e8601`, `2d9f7b2`)

`registerModuleVariant({ id, match, view, rendered?, onState?, intro?, bodyData?, screenClass?, ownHeader? })` dans
`module-registry.js`. Une variante prend le module que la session liste quand `match(env)` est vrai.

| Hook | Rôle |
|---|---|
| `view(ctx)` | crée la vue une fois tant que le module est ouvert ; `start()` facultatif ; `destroy()` à la sortie (`navigateTo`) |
| `rendered(view, ctx)` | appelé à chaque dessin du module par l'hôte |
| `onState(view, next, prev, ctx)` | renvoie `true` si la vue a absorbé le nouvel état : l'hôte ne redessine pas (pas d'animation rejouée). Jamais pendant un écran d'erreur |

`ctx.host` fournit ce que `ui.js` passait à la main :
- `home()`, `refresh()` ;
- `payment` : le choix de monnaie, rangé par module dans `paymentChoice` ;
- `walletMethods()`, `restrictionChips(id)`, `stopRaffleTimer()`.

Un seul emplacement dans `ui.js` (`hostView`, `hostViewId`, `hostVariant`) sert aux modules de session, aux variantes et
aux vues du socle. Le panneau de modération du socle n'est monté que pour une vue du socle.

Consommateurs :
- TTS V2 (`tts-v2.js`) ;
- Tombola V2 (`tombola-v2.js`) ;
- console D4 (`moderation-v2.js`, avec sa bascule vers « Commandes »).

## 11. Extension : cycle de vie d'une vue dessinée par l'hôte (05/11, continuation)

Le contrat de la § 10 (`view` / `rendered` / `onState` / `destroy`) reste le seul. Pour les modules encore dessinés par
`ui.js` (Soundboard, Bonk), la même règle est appliquée sans nouvelle architecture :

- **ce qu'une vue possède, elle le libère** : la Soundboard dessinée rend une poignée unique `soundboardMount`
  (`syncVolume`, `closeSearch`, `deselect`, `holdState`, `destroy`), détruite au rendu suivant ; son glisser, son compte à
  rebours et ses contrôles sont à elle ;
- **une vue détachée n'écrit plus l'état partagé** (défaut trouvé : le `focusout` de l'ancien curseur de volume refermait
  l'aperçu que la nouvelle vue venait d'ouvrir) ;
- **un résultat appartient à la visite** : en quittant le module, son dernier message est oublié, y compris celui d'une
  requête encore en vol (`bonk-send.js`, compteur de visite ; `soundboard-feedback.js`) ; une erreur reste publiée dans le
  centre de notifications ;
- **un module fermé ne lit plus rien** : vérifié par `lifecycle.e2e.ts` (TTS `/tts/state`, Tombola `/raffle/state`,
  D4 `/moderation/v2/*`) sur deux lectures de l'hôte.

Signal de disponibilité : `.ttsv2[data-recovered]` quand la vue TTS a décidé de son écran (composer ou TTS en cours).

## 12. Extension : extensions du contrat de variante (05/11, frontières Soundboard et Bonk)

Toujours un seul contrat (`registerModuleVariant`, § 10). Chaque ajout répond à au moins deux besoins réels (Soundboard
et Bonk) et reste facultatif : TTS V2, Tombola V2 et D4 n'en utilisent aucun et n'ont pas changé.

| Ajout | Rôle | Utilisé par |
|---|---|---|
| `rendered(view, ctx)` reçoit `ctx.body` ; une vue sans `node` n'est pas ajoutée | la vue dessine dans le conteneur de l'hôte (`.jdm-module__body`, que leur CSS met en forme) | Soundboard, Bonk |
| `headClass`, `headIcon(view)`, `headAfter(view)`, `walletClass` | l'en-tête reste celui de l'hôte ; la vue y place son contrôle | Soundboard (volume), Bonk (« ? », classes) |
| `host.memory` | objet par module gardé pour la vie du panneau (brouillons ; instances qui survivent à une visite) | Soundboard (tri, filtre, sélection), Bonk (picker, chargeur, tutoriel, envoi) |
| `host.run(node, task, { feedbackScope, onSettled })` | l'exécuteur d'actions de l'hôte (occupé, rafraîchissement, notifications) ; la vue dit le résultat elle-même | Soundboard |
| `host.restriction()`, `host.interactions()`, `host.redraw()`, `host.refresh()` (renvoie la promesse) | état de l'hôte lu au moment voulu | Soundboard, Bonk |
| `host.errorReason(error)`, `host.notifyError(error, { title })` | raison lisible d'un refus ; centre de notifications | Soundboard, Bonk |
| `host.emotes` | le service d'accès aux emotes Twitch (`emote-access.js`), propre au panneau | Bonk (et le tutoriel global, directement) |

Règle des instances persistantes : une instance gardée dans `host.memory` (chargeur, tutoriel de Bonk) ne capture jamais
la fermeture d'une vue ; ses rappels passent par `memory.handlers`, que la vue ouverte remplace.

