# Raptoru 2.0

Self-owned streaming platform for one streamer. Source of truth: `Raptoru Studio — Infrastructure Spec.md`.

> **Core thinks, Studio controls/displays and talks to OBS, Bot talks to Twitch, Extension/Web talk to viewers.**

This is the bootstrap pass: every app is an honest placeholder with no business logic.

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

## Commands

```sh
npm install
npm run dev            # all apps in watch mode (except the Electron shell)
npm run studio:desktop # build and open the Electron shell (loads http://127.0.0.1:5173)
npm run check          # lint + format check + typecheck + build
```

Default ports: core-api `3000`, studio/server `4100`, studio/web `5173`, viewer-web `5174`, twitch-extension `5175`.
