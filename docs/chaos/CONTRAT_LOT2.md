# Chaos V2 — contrat du lot 2 (Core ↔ Studio ↔ extension), 26/11/2026

Source unique pour les trois chantiers parallèles de la branche `feat/chaos-integration`. Tout ce qui n'est pas écrit
ici reprend le modèle existant le plus proche : **Soundboard V2** (`apps/core-api/src/sound-lab/sound-lab-service.ts`)
pour l'achat, le bail et les remboursements ; **Halloween** (`apps/studio/server/src/halloween/runtime.ts`) et le
**worker son** (`apps/studio/server/src/sound-lab/worker.ts`) pour la boucle Studio. Rien ici n'active quoi que ce soit
en Production : tout est derrière `chaos.enabled` (défaut 0) et le drapeau `CHAOS_EXTENSION` (défaut `off`).

## 1. Règles métier (identiques au faux Core de la maquette, `lab-modules/interactions/model.js`)

- Prix : modèle par **fourchettes** (`PRICE_RANGES`, `rangePrice` de `catalog.js`), calculé par le Core seul. Le
  navigateur envoie `expected_price` ; différent → `price_changed`, rien de débité.
- Durée : bornée par la plage du préréglage (catalogue) ET par la Sécurité de Studio reçue au heartbeat
  (`safety_max_ms`) ; au-delà → `duration_out_of_range`.
- File (hors achats à charges) : 3 demandes en attente par canal au plus (`queue_full`) ; une seule en attente par viewer
  (`one_waiting`) ; 60 s entre deux achats du même effet par le même viewer après sa fin (`cooldown`) ; Flash : 60 s
  communes au canal (`global_cooldown`) ; mode doux de Studio + effet photosensible → `safe_mode`.
- Achats à charges (préréglage `ponctuel` de `blink`) : 10 charges par viewer, +1 toutes les 6 s ; 10 en attente par
  canal au plus (`burst_full`) ; 20 départs + attentes par minute glissante et par canal (`burst_rate`) ; pas de délai
  de 60 s ni de « une seule en attente ».
- Expiration : jamais livrée/démarrée en 180 s → `expired`, remboursée.
- Refus avant tout débit, dans cet ordre : module fermé / suspendu (`paused`), pause globale, live (paid), blocage du
  viewer (module `chaos` ou `all`), délai personnel de modération, Studio pas prêt (`studio_offline`, heartbeat > 10 s,
  ou `engine_ready` faux), effet désactivé dans Studio (`effect_disabled`), mode doux, durée, délais, file, solde.

## 2. Core

### 2.1 Tables (migrations jumelles `supabase/migrations/20261206120000_chaos_lab.sql` et `…130000_chaos.sql`,

déclarées dans `src/db/migration-scopes.ts`, `apps/studio/server/src/runtime/local-runtime.ts`,
`apps/studio/server/scripts/bonk-lab.mjs`)

- `chaos_channels (channel_id pk, state text check in ('open','paused') default 'open', updated_at, updated_by)`.
- `chaos_studios (studio_instance_id pk, engine_ready bool, safety_max_ms int, safe_mode bool, effects jsonb
{id: {enabled}}, last_seen timestamptz)`.
- `chaos_requests` :
  `id uuid pk, channel_id, viewer_id, viewer_name, idempotency_key, request_hash, effect, preset, level, choice jsonb,
engine_request jsonb, duration_ms int, price int, payment text check ('jetons','credit','gift'), credit_id uuid null,
charged bool, status text check ('queued','claimed','started','ended','failed','canceled','expired'), code text,
reason text, refund_status text check ('none','refunded') default 'none', refunded_at, refund_reason, actor text,
created_at, expires_at, studio_instance_id, attempt_id, lease_expires_at, started_at, ended_at, played_ms int,
stop_requested_at, stop_refund bool, stop_reason`, `unique (channel_id, viewer_id, idempotency_key)`.
- `chaos_effect_credits` et `chaos_effect_credit_events` : modèle du § 8 de `EXTENSION_INTERACTIONS.md`.
- `chaos_charges (channel_id, viewer_id, effect, preset, n int, at timestamptz, primary key (…))`.
- Restrictions : élargir les contraintes `lab_viewer_blocks_module_id_check` et `lab_viewer_cooldowns_module_id_check`
  (réécrire la liste complète, `random_ban` compris) avec `chaos` ; `USE_TABLE` du store pointe sur `chaos_requests`.

### 2.2 Paiement

`economy.debit` (EconomyPort : Lab ou canonique) dans la **même transaction** que l'insertion, après le verrou du canal
(`chaos_channels … for update`) et la recherche de l'intention (même clé + même `request_hash` → même réponse,
`duplicate: true` ; même clé, autre contenu → `idempotency_conflict`). Remboursement : `deferrableRefund` /
`refundDebit` derrière `update chaos_requests set refund_status='refunded' … where id=$1 and refund_status='none'`
(jamais deux fois). Crédit d'effet : consommé dans la même transaction (`update … set state='used' where id=$1 and
state='available' and viewer_id=$2`), rendu dans la même branche que le remboursement (crédit rendu, jamais des Jetons).
Charge : retirée dans la même transaction, rendue si la demande ne démarre jamais.

### 2.3 Machine d'états et remboursements

`queued` → (claim) `claimed` (bail 30 s) → (ack `started`) `started` → (ack `ended`) `ended`.

- `failed` (jamais démarré : refus du moteur, `exclusive_fullscreen`, `no_frame`, `start_timeout`, erreur, réseau,
  bail expiré sans `started`) → **remboursement intégral automatique**.
- `expired` (jamais réclamé en 180 s) → remboursement intégral automatique.
- `canceled` (modération, ou STOP ALL de Studio sur une demande pas encore démarrée) → remboursé par défaut ; sans
  remboursement : motif obligatoire.
- `ended` avec `code` panne (`target_lost`, `capture_lost`, `display_changed`, `shutdown`, `engine_exit`,
  `unknown_end`) → politique d'interruption : remboursé si `played_ms < 0,5 × duration_ms` (réglable :
  `chaos.interrupted_refund_below`, défaut 0,5), motif tracé. `ended` par arrêt de modération : remboursé selon le choix
  du modérateur (`stop_refund`), d'office avant 25 %.
- `started` sans `ended` après `duration_ms + 15 s` : `ended` avec `code='unknown_end'`, une **panne** (décision
  d'Antoni, 27/11) : `played_ms` = temps entre le début et le dernier signe de vie de son Studio (dernier heartbeat),
  borné à la durée ; politique d'interruption (remboursé sous 50 %). Studio encore vivant après la fin (seul l'ACK
  perdu) → compté joué, non remboursé ; remboursable par la modération.
- Balayage (`sweep`, toutes les 5 s, et au démarrage du Core) : expirations, baux expirés sans `started` (→ `failed`
  `no_ack`, remboursé), `started` sans fin. Une erreur de communication ne fait jamais perdre de Jetons : tout ce qui n'a
  pas de `started` confirmé est rendu.

### 2.4 Routes

Viewer (façade `/v1/ext`, mêmes en-têtes et JWT que Soundboard ; `Idempotency-Key` obligatoire à l'achat) :

- `GET /v1/ext/chaos/state` → `{ enabled, status: 'open'|'paused'|'offline'|'engine_down', cap_s, safe_mode,
effects: { [id]: { available: bool, reason?: code } }, active: [View], queue: [View], burst: [View],
mine: [View] (20 derniers), credits: [Credit], charges: { [effect:preset]: { n, max, next_s } } }`.
- `POST /v1/ext/chaos/quote` `{ effect, choice }` → `{ price, choice (normalisé), engine_request, outcome: { kind:
'now'|'queue'|'burst', position?, eta_s? }, block?: { code, detail }, charges? }`.
- `POST /v1/ext/chaos/buy` `{ effect, choice, expected_price, credit_id? }` → `{ ok: true, request: View, duplicate? }`
  ou erreur `{ code, message }` (HTTP 409/402/503 comme Soundboard).
- `View = { id, effect, preset, level, duration_ms, price, payment, status, code, reason, refund_status, position?,
eta_s?, remaining_s?, progress?, viewer_name, mine, created_at, started_at, ended_at }`.
- `choice = { style, level, duration, opts }` (forme de `catalog.js`), normalisé par le Core avec le **même** code
  (`apps/core-api/src/chaos/catalog.ts`, portage verrouillé par un test croisé avec l'extension).

Studio (Lab : `/v1/lab/chaos/:channel/...` avec `STUDIO_SECRET` ; Production : `/v1/studio/chaos/...` avec l'identité
d'installation, module `chaos` ajouté à `executionRoutes`) :

- `POST heartbeat` `{ studio_instance_id, engine_ready, safety_max_ms, safe_mode, effects: {id: {enabled}}, inflight:
[request_id] }` → `{ ok, stop: [{ id, reason }] }` (les baux des `inflight` sont prolongés ; `stop` = arrêts demandés
  par la modération).
- `POST claim` `{ studio_instance_id, startable: [effect] }` → `{ item: { id, attempt_id, engine_request, duration_ms,
lease_expires_at } | null }` (la plus ancienne demande `queued` dont l'effet peut démarrer tout de suite).
- `POST requests/:id/ack` `{ studio_instance_id, attempt_id, event: 'started'|'ended'|'failed', code?, reason?,
played_ms? }` → idempotent ; un état final ne recule jamais ; mauvais essai → `attempt_mismatch`.
- `POST stop-all` `{ studio_instance_id }` → demandes `queued`/`claimed` → `canceled` remboursées ; `started` → arrêt
  (Studio les arrête lui-même).

Modération (D4, `/moderation/v2/actions`, module `chaos`, permissions vérifiées par `needs()` + `assertAccess`) :
`stop {id, refund?, reason?}`, `cancel {id, refund?, reason?}`, `refund {id, reason}`, `pause {paused}`, `stop_all`,
`gift {effect, choice}` (gratuit, devant la file), `credit_grant {viewer_id, effect, constraints, reason}`,
`credit_revoke {credit_id, reason}` ; blocages et délais personnels : commandes existantes avec `module: 'chaos'`.
Overview : clé `chaos` = `{ module_state, active, queue, burst, recent, credits_pending }`.

## 3. Studio

- `apps/studio/server/src/chaos/core-loop.ts` : heartbeat toutes les 3 s (état du moteur, `safety.max_duration_ms`,
  `safe_mode`, effets activés, `inflight`) ; claim seulement si le moteur est prêt, avec les effets qui peuvent démarrer
  (emplacements libres, même effet pas déjà actif, sous `max_active_effects`) ; envoi au moteur par la **même fonction**
  que la route Lab (`submitViewerEffect`) : `effect.request`, `source: { kind: 'core', ref: <id> }`,
  `request_id: core-<id>`, `target: { kind: 'screen', device: <écran de la fiche de l'effet> }`, `policy: 'reject'` ;
  événements du moteur → ack (`started` ; `ended` + `played_ms` = `running_ms` ; `failed` pour
  failed/rejected/expired/canceled ou refus synchrone) ; journal sur disque des demandes envoyées (jamais rejouées) ;
  STOP ALL de Studio → `POST stop-all` au Core ; demandes `stop` du heartbeat → `effect.cancel`.
- Schéma : `target.kind: 'screen'` (`device` = `\\.\DISPLAYn`) ajouté à `chaosEffectRequestSchema` (le moteur le gère
  déjà : `Targets.cs`, mode E, capture directe vue par OBS).
- Sécurité : les routes `/api/chaos/*` passent par la garde **même hôte** de `index.ts` (fermeture du rebinding DNS).
- Route Lab `POST /api/chaos/lab/play` (profil Lab seulement, même hôte + en-tête) : corps = `engine_request` de la
  fiche, source `extension`, ref `Lab Interactions`, même `submitViewerEffect` ; réponse : état du moteur ou refus.

## 4. Extension

- Mode connecté (session avec le module `chaos`) : le faux Core est remplacé par un client du Core (même forme que
  `snapshot()` / `quote()` / `buy()` du faux Core, devis du Core affichés, achat avec `expected_price` et
  `Idempotency-Key` par intention). Mode démo et maquette : faux Core inchangé.
- Lab servi par Studio : interrupteur « Jouer sur mon PC » → `POST /api/chaos/lab/play` (même origine).
- Section FX : lit `overview.chaos`, envoie les commandes `chaos.*` par `modV2Act`.
