# Raptoru 2.0

Self-owned streaming platform for one streamer. Source of truth: `Raptoru Studio — Infrastructure Spec.md`.

> **Core thinks, Studio controls/displays and talks to OBS, Bot talks to Twitch, Extension/Web talk to viewers.**

Implemented so far: **Daily** (core-api + twitch-bot). Other apps are still placeholders.

## Apps

| App                     | Role (from the spec)                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/core-api`         | The brain of the platform: domain logic, shared state, feature orchestration, persistence. Also the EBS.      |
| `apps/twitch-bot`       | Thin Twitch adapter: sole EventSub process, forwards events to Core, executes Twitch-side commands from Core. |
| `apps/twitch-extension` | Viewer-facing interface hosted by Twitch. Submits intents to Core; owns no authoritative state.               |
| `apps/viewer-web`       | Public viewer UI and entry point, not domain authority.                                                       |
| `apps/studio/server`    | Local Studio server (`127.0.0.1`): holds Studio secrets, talks to Core, only bridge to OBS.                   |
| `apps/studio/web`       | Streamer-facing control/configuration UI.                                                                     |
| `apps/studio/desktop`   | Electron Windows shell around the Studio web UI.                                                              |
| `packages/schemas`      | Zod contracts shared by the apps (stream lifecycle, Daily). No business logic.                                |
| `supabase/migrations`   | Versioned SQL migrations, applied with `npm run db:migrate -w @raptoru/core-api`.                             |

## Commands

```sh
npm install
npm run dev            # all apps in watch mode (except the Electron shell)
npm run studio:desktop # build and open the Electron shell (loads http://127.0.0.1:5173)
npm run check          # lint + format check + typecheck + tests + build
npm run studio:package # build the Windows installer: apps/studio/desktop/release/Raptoru Studio Setup <version>.exe
```

## Studio for Windows (installer)

The NSIS installer is the only official format. The portable build was dropped, because a second launch could break an instance already running. The `release/win-unpacked` folder is only for debug and tests.

- The app installs per user into `%LOCALAPPDATA%\Programs\Raptoru Studio`, with Start menu and Desktop shortcuts.
- The Studio server, Core and the bot run on the Node embedded in the exe, with no console window.
- Only one instance runs: a second launch focuses the open window.
- Closing the window stops what the Studio started (bot, Core); Postgres keeps running.
- The package contains code only. The `.env` files, tokens and runtime PIDs stay in the local Raptoru folder, which is named in `%APPDATA%\Raptoru Studio\studio.json`: `{"dataRoot": "C:/path/to/Raptoru 2.0"}`.
- No Raptoru `.ico` exists yet, so the app uses the default Electron icon. The exe is unsigned, so SmartScreen warns on the first run.

## Auto-update (V1)

One channel, GitHub Releases, driven only by explicit user action (a silent startup check may
detect an update, but never downloads or installs on its own). Built on `electron-updater` — no
custom updater logic.

- **Version**: `apps/studio/desktop/package.json`'s `version` field is the single source of
  truth (`stage.mjs` copies it into the packaged app; `app.getVersion()` reads it at runtime). To
  cut a release: bump that field, then `npm run studio:package`.
- **Artifacts to publish**: a GitHub Release tagged `v<version>` with these 3 files from
  `apps/studio/desktop/release/` attached: `Raptoru Studio Setup <version>.exe`, its
  `.blockmap` (enables differential/delta downloads), and `latest.yml` (the update manifest
  electron-updater reads — do not rename or edit it; GitHub uploads the `.exe` under a
  hyphenated name and `latest.yml` already points at that name).
- **Before this works for real**: set the real `owner`/`repo` in
  `apps/studio/desktop/electron-builder.json`'s `publish` block (currently placeholders). Nothing
  publishes on its own: `package:win` always runs with `--publish never`. To actually publish,
  run `electron-builder --publish always` with a `GH_TOKEN` env var (a repo-scope PAT) — a
  separate, explicit step, never part of `studio:package`.
- **UX**: a widget in the top bar — current version, "Rechercher une mise à jour", then
  "Nouvelle version : x.y.z" + "Mettre à jour", then "Téléchargement… NN %", then "Redémarrer et
  installer". On click, the app stops its local server (bot/Core shut down cleanly) before
  installing and relaunching. Never touches `%APPDATA%\Raptoru Studio` or the repo's local
  `.env`/tokens — only the `%LOCALAPPDATA%\Programs\Raptoru Studio` install directory changes.
- **Testing without a GitHub Release**: `apps/studio/desktop/scripts/test-update-feed.mjs` points
  electron-updater at any local "generic" feed (a folder with a `latest.yml` + installer served
  over plain HTTP) and logs every event — see the file's header comment for exact usage. This is
  how "no update available", "update available" and "download + progress" were validated for V1.

Default ports: core-api `3000`, studio/server `4100`, studio/web `5173`, viewer-web `5174`, twitch-extension `5175`.

## Extension Lab (Studio → "Extension Lab" tab)

Local test bench for the Twitch extension, without a stream: the production extension
(`apps/twitch-extension/extension`, imported unchanged) runs inside realistic Twitch frames.

- **Surfaces**: panel viewer (318 × 496), mobile viewer (phone presets), video component (60 % of
  the player height, 3:2, minus Twitch's 48 px column; normal / theatre / fullscreen players),
  config, live config.
- **Simulated context**: viewer / moderator / broadcaster, identity shared or not (the
  extension's "share identity" request is answered from the Studio), Twitch URL parameters
  (`anchor`, `mode`, `platform`…).
- **Local Lab EBS** (Studio server, `/ext-lab/api`): same contract as the production EBS for
  session, jetons, channel-points credits, Soundboard, Bonk, TTS (instant or approval), Tombola and
  moderation. Fictitious jetons in memory: no StreamElements, no SAMMI, no Twitch write, no Core
  Wallet. The lab pages' CSP only allows the Studio origin.
- **Local stage**: accepted actions are played in the Studio (sound file, TTS voice, Bonk
  animation, raffle) with a journal; wallets, modules and raffle are controllable.

```sh
npm run studio                # build everything, open Raptoru Studio → "Extension Lab" tab
# Browser alternative: node apps/studio/server/dist/index.js, then
# http://127.0.0.1:4100/?tab=extension-lab&surface=video&role=moderator   (deep link)
```

## Daily (status: dev/test only)

SAMMI still runs the production Daily. Until the cutover:

- `twitch-bot` only answers `!daily`/`!streak` with `DAILY_CHAT_COMMANDS=true`; never enable it on the production channel;
- the only credit provider is `dev-fake` (no real StreamElements call);
- raptoru.fr keeps reading the SAMMI Daily; Core does not write to its tables.

Rules: one claim per stream-day (window opening at 16:00 Europe/Paris, fixed when the live starts), the streak counts consecutive aired stream-days, days without stream never break it.

Core routes: `/v1/bot/*` (`BOT_SECRET`), `/v1/daily/viewers/:id` and `/v1/daily/leaderboard` (public), `/v1/admin/daily/viewers/:id` (`STUDIO_SECRET`: claims + attempt journal).

```sh
npm run db:migrate -w @raptoru/core-api          # needs DATABASE_URL (see apps/core-api/.env.example)
npm run daily:import-legacy -w @raptoru/core-api # dry-run import of the raptoru.fr history; add -- --apply to write
# Real Postgres concurrency test (wipes the target database; local URL + db name containing "test"):
TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/raptoru_test npm run test:integration -w @raptoru/core-api
```

## Presence tracker (shadow mode)

**NO WALLET / NO CREDITS / SHADOW MODE.** Estimated watch time from Twitch Get Chatters, for comparison with StreamElements. Nothing is paid and nothing is sent to chat.

- `twitch-bot` (`PRESENCE_SHADOW=true`) takes a full Get Chatters snapshot at live start, then every 2 minutes, and reports each snapshot or failure to Core.
- Core credits the interval between two snapshots only to viewers present in both. The two snapshots must be consecutive successful cycles of the same worker, at most 3 minutes apart. Errors, restarts and gaps are never turned into watch time.
- Twitch auth: confidential app of Raptoru 2.0; the refresh token is used automatically (single-flight, a rejected refresh stops the tracker). Token owner = broadcaster, or a moderator of the channel.
- Storage: one row per cycle (`presence_cycles`) and one row per viewer per stream (`presence_viewer_streams`).

```sh
npm run twitch:auth -w @raptoru/twitch-bot                     # once: OAuth in the browser, writes .twitch-tokens.json (git-ignored)
npm run presence:preflight -w @raptoru/twitch-bot              # read-only token/scope/Get Chatters check
npm run presence:report -w @raptoru/core-api -- --latest       # read-only report (works during the live too)
npm run presence:report -w @raptoru/core-api -- --stream <id> --csv presence.csv
```

## Wallet / Loyalty (Core V1, dev/test only)

Core is the only economic source of truth. StreamElements and SAMMI stay in charge of production until the cutover. Nothing is imported, and Presence and Daily are not connected to the wallet.

- **Model**: multi-currency (`currencies`, primary `main` = Jeton/Jetons, renamable), `wallets` (balance per viewer and currency), and an append-only ledger (`wallet_transactions`).
- **Idempotency**: every change is a `wallet_operations` row with an idempotency key; a retry replays the outcome, and a different payload under the same key is refused.
- **Concurrency**: only the wallets involved are locked (stable order), independent viewers run in parallel, and there is no global queue.
- **Debt**: spends and transfers never go below 0 and are refused while in debt. Admin corrections and penalties may go negative if the currency allows it, and gains repay the debt.
- **Loyalty**: a personal rate replaces the standard rate, then the global boost applies (x3 × x2 = x6). Resolution only for now: no feature uses it yet.
- **Permissions**: internal `staff_roles` (owner/supermod), independent from the Twitch moderator badge.
- **Chat** (`LOYALTY_CHAT_COMMANDS=true`, off by default): `!solde` / `!balance` / `!compte`, `!give` / `!trade @pseudo montant` (either order), and `!wallet add|remove|set @pseudo montant [motif]` for staff.
- **Core routes**: bot `/v1/bot/wallet/{balance,transfer,admin}`; public `/v1/wallet/{currencies,leaderboard,viewers/:id}`; Studio `/v1/admin/wallet/*`, `/v1/admin/loyalty/*`, `/v1/admin/staff*`.

## Loyalty Engine (V1: preview only until the cutover)

The pipeline is: source event → Loyalty calculation → Wallet. Presence and Twitch never see amounts; the Wallet never sees Twitch.

- **Modes** (core-api env, all `false` by default):
  - no flag: shadow, nothing computed;
  - `LOYALTY_PREVIEW`: rewards are computed and stored with their breakdown, with no Wallet write;
  - `LOYALTY_PASSIVE_CREDITS` / `LOYALTY_EVENT_CREDITS`: the rewards are also credited, idempotently.
- **Passive**: Presence hands over validated intervals only. Each 6 validated minutes is one tick (`passive:{stream}:{viewer}:{n}`), worth 50 × tier multiplier (none ×1, T1 ×2, T2 ×2.5, T3 ×4). A personal rate replaces the tier multiplier. Excluded accounts (`loyalty_exclusions`, admin API; for example system bots) never enter the passive aggregation: no progress and no tick, but Presence still records them. Excluded accounts keep their wallet and event rewards. Rounding is always up.
- **Tiers**: the `viewer_subscriptions` cache is fed by events and full snapshots. Without a recent snapshot the tier is `tier_unknown` and is never guessed.
- **Events**:
  - sub/resub: 2000/4000/10000;
  - subgift: tier × count, plus a per-action bonus tier;
  - bits and tips: progressive brackets;
  - follow: 500, once per Twitch identity.
    All values live in `loyalty_config`, read at each reward. Breakdowns are frozen in `loyalty_rewards`.
- **Twitch**: the broadcaster token (`npm run twitch:auth -w @raptoru/twitch-bot -- --broadcaster`, logged in as the broadcaster) and `LOYALTY_TWITCH_EVENTS=true` enable the sub/gift/cheer/follow events and the subscriber snapshots.

```sh
npm run loyalty:report -w @raptoru/core-api -- --latest [--csv loyalty.csv]   # read-only preview/credit report
npm run loyalty:preflight -w @raptoru/twitch-bot                              # read-only broadcaster token check
```
