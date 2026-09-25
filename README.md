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
```

Default ports: core-api `3000`, studio/server `4100`, studio/web `5173`, viewer-web `5174`, twitch-extension `5175`.

## Daily (status: dev/test only)

SAMMI still runs the production Daily. Until the cutover:

- `twitch-bot` only connects to Twitch with `TWITCH_ENABLED=true`; never enable it on the production channel;
- the only credit provider is `dev-fake` (no real StreamElements call);
- raptoru.fr keeps reading the SAMMI Daily; Core does not write to its tables.

Rules: one claim per stream-day (window opening at 16:00 Europe/Paris, fixed when the live starts), the streak counts consecutive aired stream-days, days without stream never break it.

Core routes: `/v1/bot/*` (`BOT_SECRET`), `/v1/daily/viewers/:id` and `/v1/daily/leaderboard` (public), `/v1/admin/daily/viewers/:id` (`STUDIO_SECRET`: claims + attempt journal).

```sh
npm run db:migrate -w @raptoru/core-api          # needs DATABASE_URL (see apps/core-api/.env.example)
npm run daily:import-legacy -w @raptoru/core-api # dry-run import of the raptoru.fr history; add -- --apply to write
# Real Postgres concurrency test (wipes the target database; local URLs only):
TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/raptoru_test npm run test:integration -w @raptoru/core-api
```
