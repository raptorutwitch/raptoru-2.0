# Raptoru Live (Twitch extension): architecture map

Read-only audit of the worktree `C:\Users\Antoni\Documents\Raptoru 2.0 - Worktrees\studio-ux`, detached at `origin/main` `13ed6e8`, on 07-08/11/2026.
Paths are relative to `apps/twitch-extension/extension/` unless stated. Line numbers are at `13ed6e8`.
Labels: **[P]** proven from code, git or a document quoted here. **[H]** presumed: a document says so and nothing in the repo can confirm it. **[NV]** not verifiable from the repo.

---

## 0. Key facts

1. **There are four HTML entry points but only three real viewer surfaces: Panel, Mobile and Video Component.** The Video Component is the desktop surface "on the video". The "dock + drawer over the video" code from the old Video Overlay layout is still shipped, but in Production it is only reachable when `video_component.html` is not the page name. [P code, H console]
2. **One JS shell serves all three surfaces.** `shared/ui.js` `createModulePanel` is used by `overlay.js` (video component) and `mobile.js` (panel + mobile). The surfaces differ only by: the body class, which CSS files the page loads, the refresh cadence, and a few width or class checks inside modules. [P]
3. **Published today:** presumably the PRODUCTION ZIP of `0bf7907` (22/10), pointing to `https://core.raptoru.fr/v1/ext`. A Halloween ZIP (`f1c9a7d`, 29/10) was prepared "to submit", and nothing proves it was submitted or approved. Everything from 05/11 (`50e8601`, `602401a`, `2d9f7b2`, the module host, the variants) is **not published** [P: no doc says so; H for what is served].
4. **The module mechanism exists in the extension and is used by every current tab.** `module-registry.js` has three entry types (host module, session module, variant). In Production, however, `/modules/v3` lists **no module the extension can show**. Coffre mystère is `labOnly` and is skipped on the canonical economy. The host-module path is therefore proven only in the Lab. [P]
5. **The surfaces are not responsive by design.** There are three different surface-detection strategies (body classes, width ≥ 520, width ≥ 560/900), and CSS is split three ways per module (base + overlay + mobile + own sheet). `base.css` is 16 477 lines and loaded everywhere. [P]

---

## 1. Extension types, entry points, sizing

### 1.1 Entry points (declared in the build)

`scripts/build.mjs:22-27`: `ENTRY_POINTS = ['panel.html','mobile.html','video_component.html','config.html']` ("Paths declared in the Twitch developer console").
Twitch console settings according to `README.md:13-15`: panel `panel.html` (height 496), mobile `mobile.html`, video component `video_component.html` (target height 60 %, ratio 3:2, autoscale off, pixel scale 1024), config and live config `config.html`. **No Video Overlay entry is declared.** [H: the console itself is not readable; OPERATIONS § 7 says "Version réellement servie : à lire dans la console (non vérifiable depuis le dépôt)"]

The geometry docs contradict the README:

- `docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md:3-4, 75` decides **65 % · 3:2 · auto OFF → 565×376**. The measurements were taken on a separate calibration extension on LeCroupier_.
- The Lab uses 565×376: `apps/studio/web/src/pages/labo-extension.ts:55-66` and `labo-surfaces.ts:43-48`.
- The README still says 60 %. Whether the **published** extension's console is at 60 % or 65 % is [NV].

Lab surface sizes, from `apps/studio/web/src/pages/labo-surfaces.ts:16-63`:

| Surface              | Page                                        | Size                  |
| -------------------- | ------------------------------------------- | --------------------- |
| Panel                | `panel.html`                                | 318×496               |
| Moderator Window     | `panel.html` + `popout=true`                | 1100×720 (D4 console) |
| Mobile               | `mobile.html`                               | 390×844               |
| Video component      | `video_component.html` + `anchor=component` | 565×376               |
| Config / live config | `config.html`                               | —                     |

### 1.2 What each page loads

| Page                   | body class                                          | Script              | CSS                                                                                                                                                       |
| ---------------------- | --------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel.html`           | `mobile panel-view` (l.20)                          | `mobile.js` (l.27)  | base, mobile, picker, bonk-chargeur, soundboard, currency-switch, hub, events-shop, tts-v2, moderation-v2, tombola-v2 (l.8-18). **No `commands-v2.css`.** |
| `mobile.html`          | `mobile` (l.21)                                     | `mobile.js` (l.30)  | the same + `commands-v2.css` (l.8-19)                                                                                                                     |
| `video_component.html` | `overlay` (l.21), plus `component-view` added by JS | `overlay.js` (l.46) | base, **overlay**, picker, bonk-chargeur, soundboard, currency-switch, hub, events-shop, tts-v2, moderation-v2, commands-v2, tombola-v2 (l.8-19)          |
| `config.html`          | `config`                                            | `config.js`         | base, config                                                                                                                                              |

All pages load the Twitch helper `https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js` (e.g. `panel.html:7`). Every JS file is an ES module loaded statically: no bundler, no lazy loading (`README.md:9`). `ui.js` imports every module file at the top (`ui.js:23-46`), so all modules are parsed on every surface.

Consequence: a new stylesheet needs three `<link>` edits, and `panel.html` already misses `commands-v2.css` (also noted in `GUIDE_EXTENSION.md:126-127`). Sub Wheel pills (`.lpill`) live only in `commands-v2.css`, so they are unstyled in the panel [P: `grep` finds `.lpill` only in `commands-v2.css`]. Socle-module classes `rp-*` (Coffre, `module-moderation.js`) have **no CSS anywhere**; only the `rl-pay` purchase look is styled.

### 1.3 How the surfaces differ

- **Video Component** (`overlay.js`):
  - Component mode is detected by `isComponentView = query anchor==='component' || /video_component\.html$/` (`overlay.js:25-26`). It then adds `body.component-view` and opens the drawer at once (`overlay.js:142-148`).
  - In component mode, `body.component-view .dock {display:none}` and the drawer fills 100 % × 100 % (`overlay.css` ≈ l.101-108). The drawer header is hidden because Twitch draws its own (≈ l.117).
  - "Close" calls `Twitch.ext.actions.minimize()` (`overlay.js:117-121`). Escape never closes the drawer in component view (`overlay.js:125-129`).
  - **The video component is therefore a full-iframe panel (565×376 in the Lab), not a drawer over the video.** The transparent overlay with a right-edge dock and a 300×360 max drawer (`overlay.css:5-10, 22-30, 80-88`) is leftover from the Video Overlay layout. It runs only if the page is not named `video_component.html` (the Studio Lab and Studio tombola previews use `anchor=component` or `panel.html`).
  - Refresh: 15 s when closed, 5 s when open, 15 s after an error. Paused when the document is hidden. In the Studio preview (`studio=1`) it is not auto-scheduled (`overlay.js:31-33, 71-111`). Logs a large amount of timeout-debug tracing (`timeout-debug.js`).
- **Panel / Mobile** (`mobile.js`, shared):
  - Refresh: 5 s when visible, 15 s when hidden (`mobile.js:12-14, 29-35`). A "↻" button sits in the header.
  - Panel and mobile run identical JS. The only difference is `body.panel-view`, which is read by a few modules:
    - `commands-public.js:118-121` and `moderation-v2.js:1883`: no Commands on the Panel;
    - `tts-v2.js:69-73`: `ttsV2Surface`;
    - `picker.css:193`.
  - **There are no `panel-view` rules in `mobile.css`.** Panel = mobile CSS at 318 px wide.
- **Config** (`config.js`): a status page that still talks about SAMMI (`config.html:44-50`, `config.js:41,73`). It calls `client.setTtsModeration`. The Core façade's legacy moderation answers `not_available` to anything except TTS pause/resume/stop/purge (`core-api/src/ext/ext-facade.ts:1174-1175`). **The Config page is stale.**

### 1.4 Uncommitted change outside origin/main (FYI)

The main checkout `C:\Users\Antoni\Documents\Raptoru 2.0` (branch `main` @ `11ffe3f`) has a **non-committed** "grey screen" fix:

- `overlay.js` / `mobile.js` +10 lines each: an error after 10 s without `onAuthorized`;
- also touches `api.js`, `moderation-v2.js`, `ui.js`;
- `git diff --stat` there: 62 insertions.

It is mentioned as "non commité" in `docs/ROADMAP.md:44` and `docs/REPRISE.md:104`. [P]

---

## 2. Published vs repository

### 2.1 The source still points to the legacy EBS

- `shared/runtime-config.js:3-6`: `mode:'connected', apiBase:"https://raptoru.fr/api", buildId:"20260920-095259Z-consolidated-final"`.
- `scripts/build.mjs` (= `npm run build`, the command **OPERATIONS § 7** names) copies `extension/` into `dist/` **with that legacy URL**. Its only check is that the URL is `https://` (`build.mjs:33-40`).
- The real production package is `npm run build:production` = `build-staging.mjs --production`:
  - it rewrites `runtime-config.js` with `apiBase:"https://core.raptoru.fr/v1/ext"` (`build-staging.mjs:35-39, 108-118`);
  - it refuses any `raptoru.fr` string (`:120-129`, commit `423623c`);
  - it writes `release/raptoru-live-PRODUCTION-<sha>.zip`.
- **OPERATIONS § 7 / README describe the wrong build command** (doc drift; risk: a `dist/` upload would talk to the legacy EBS). [P]

### 2.2 Publication history

| Version                                                        | Evidence                                                                                                                                                                                                                                                                                                            | Status                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `20260920-095259Z-consolidated-final` (legacy EBS)             | `docs/CUTOVER_PLAN_2026-10.md:67`                                                                                                                                                                                                                                                                                   | published before the cutover [H]                         |
| `f97e74a` (20/10) "production package for the production Core" | git                                                                                                                                                                                                                                                                                                                 | the build:production tooling                             |
| **`0bf7907`** (22/10) UX pass                                  | `docs/archive/STATE_AUDIT_2026-10-23.md:62,117`: "ZIP extension 0bf7907 publié par Antoni", sourced "[H] relais ChatGPT … [NV] version servie". `docs/ROADMAP.md:44`: "`0bf7907` publiée ; version servie NV". `docs/HALLOWEEN_GO.md:191`: the public approved version "(`0bf7907`)"                                | **last version documented as published** [H]             |
| `f1c9a7d` (29/10) Halloween "Événements"                       | `docs/HALLOWEEN_GO.md:193-203`: "Paquet prêt … raptoru-live-PRODUCTION-f1c9a7d8c347.zip", steps "upload → Hosted Test → submit". `docs/REPRISE.md:96`: "Extension : nouvelle version après Halloween … à soumettre en revue par Antoni". `archive/REPRISE_2026-10-28_2026-11-04.md:86`: "dépend de la revue Twitch" | prepared; **no evidence of submission or approval** [NV] |
| `50e8601`, `602401a`, `2d9f7b2` (05/11) and later              | `LIVRAISON.md` § 7 (l.89-100): "jamais publiée par Claude. Antoni l'envoie à Twitch"; § 9 (l.138, 164, 179): "Extension : rien à faire / pas republiée"; `OPERATION_COULISSES.md:15, 56, 86`: "pas de republication", "version publiée non lisible"                                                                 | **not published** [P from docs]                          |

Git facts [P]:

- All three 05/11 commits are ancestors of `origin/main` 13ed6e8: `feat/studio-ux` was merged (`git merge-base --is-ancestor`).
- 44 commits touch `extension/` between `0bf7907` and HEAD: 73 files, +7 116 / −4 927.
- 34 commits touch it since `f1c9a7d`.

What the presumed-published `0bf7907` lacks:

- Halloween "Événements" and "Titres";
- H1 `stream_offline` labels and H15;
- the whole module host (`module-registry.js`, `purchase.js`, `module-moderation.js`, `coffre-mystere.js`);
- the variant refactors (ui.js 6 000+ → 1 642 lines);
- the D4 "Autres modules".

The documents state that the Core stays backward compatible with it:

- `HALLOWEEN.md:218-222`: `event_shop` is a separate key;
- `OPERATION_COULISSES.md:56`.

---

## 3. Shell, navigation, shared services

### 3.1 The shell (`shared/ui.js`, 1 642 lines; central file, progressive extraction only)

`createModulePanel({ root, client, onRefresh, initialModule, onNotificationChange })` (`ui.js:205`) returns `{ setState, setError, state, collapse }` (`ui.js:1619-1639`).

**Rendering model: full rebuild.** `render()` destroys the hub carousel and calls `root.replaceChildren()` (`ui.js:1110-1113`), then rebuilds:

- the identity CTA;
- the wallet;
- flashes;
- the Hub or the module screen.

Three mechanisms survive the rebuild:

- `renderPreservingViewport` (`ui.js:482-499`) keeps scroll by `data-scroll-key` and the focus/selection of `data-draft-key` inputs;
- a module view created by a registered factory keeps its `node` across renders (`hostView` / `hostViewId` / `hostVariant`, `ui.js:251-254, 1516-1531`);
- `updateState` (`ui.js:501-521`) skips the render when the Hub state is identical (`stableState` strips the raffle `ends_in_s`, `ui.js:527-530`), or when the open variant's `onState` returns `true`.

**Hub.** The module list is built in `ui.js:1323-1338`:

1. `state.modules`, minus `moderation`;
2. "Actions" (Historique) when identity is shared;
3. available session modules (`hubFirst` ones go first);
4. "Modération" when `state.moderation.tts.can_moderate === true` (`ui.js:368-370`);
5. host modules (`loadHostModules` + `hostModules()`).

Hub layout (`ui.js:1356-1504`):

- a header with brand, notification bell, preferences ⚙ and wallet switch;
- a carousel (`hub-carousel.js`), plus a rail of dots;
- a utility bar (Historique · launcher "Voir tous les modules" · Classement link to `state.site_url` · tutorial "?").

Card styling comes from a per-id table `HUB_MODULE_STYLES` (`ui.js:116-124`) and per-id chips (`ui.js:1410-1419`): raffle open, TTS paused, moderation "Modérateurs").

**"Voir tous les modules"** is a popover (`rh-all`, `role=dialog`) created in `hub-carousel.js:348-376`. Its open state is kept across redraws in `hubAllOpen` (`ui.js:316, 1490-1491`, fix `602401a`). It closes on an outside pointerdown or Escape (document listeners, removed in `destroy`, `hub-carousel.js:381-397`).

**Module screen** (`ui.js:1505-1614`):

- a host header: back chevron, title or icon (or the view's `headIcon` / `headAfter`), and the wallet on the right except for moderation;
- restriction chips;
- an optional intro;
- a body `.jdm-module__body` with `data-scroll-key="module-<id>"` (none for moderation);
- the restriction modal (`viewer-restrictions.js`).

Per-id code that remains:

- `isRaffle` / `isModeration` (`ui.js:1508-1509, 1544-1554, 1562, 1573, 1582-1583`);
- `navigateTo` resets the tutorial for `soundboard` (`ui.js:550-553`);
- `shouldAutoOpenTutorial` refuses when `bonk` exists (`ui.js:141-151`);
- Hub chips for `raffle_join` / `tts` (`ui.js:1413-1418`);
- `emoteAccess.following: openModule === 'bonk'` (`ui.js:329`).

**Mount / unmount.**

- `navigateTo(id)` (`ui.js:533-556`) destroys `hostView` when the id changes, resets `restrictionsSeen`, re-renders, and restores scroll.
- `render()` also destroys an orphan view when the open module disappeared from the Hub (`ui.js:1338-1345`).
- On creation: `view(ctx)` → `start?.()` → `rendered?(view, ctx)` on every draw → `queueMicrotask(attached?)` (`ui.js:1517-1524, 1596-1599`).

**Shell-level listeners and timers that are never removed.** The panel lives as long as the page, so these are acceptable, but the shell cannot be unmounted:

- `setInterval(…,1000)` ticking restriction countdowns (`ui.js:215-217`);
- a document `click` closing notifications/preferences (`ui.js:356-366`);
- a root `keydown` (Escape) (`ui.js:332-355`);
- `emote-access.js:159` `win.addEventListener('message', …)`.

### 3.2 Registry (`shared/module-registry.js`, 111 lines)

| Entry                                              | Signature                                                                                                                                            | Who decides it appears                                                 | Users                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `registerViewerModule(id, factory, {icon})` (l.15) | `factory({document, client, module})` → `{node, start(), destroy?(), attached?()}`                                                                   | server list `/modules/v3` ∩ known views, `enabled !== false` (l.24-35) | `coffre_mystere` only                                                     |
| `registerSessionModule(def)` (l.77)                | `{id, card(state), available({state, client, document}), view(ctx), hubFirst?, intro?, bodyData?}`                                                   | `available()` reading session flags                                    | `commands`, `sub_wheel`, `event_shop`                                     |
| `registerModuleVariant(def)` (l.105)               | `{id, match(env), view, rendered?, onState?, intro?, bodyData?, screenClass?, ownHeader?, headClass?, headIcon?, headAfter?, walletClass?, wallet?}` | first registered whose `match` is true (l.109-111)                     | tts (V2, V1), raffle_join (V2, V1), moderation (V2, V1), soundboard, bonk |

- `loadHostModules(client, onChange)` (l.39-53) reads the list **at most every 30 s**, triggered from `render()` (`ui.js:1336`). Errors are swallowed; the previous list is kept.
- The registry is module-global state (`views`, `catalog`, `sessionDefs`, `variantDefs`), not per panel.
- Import order in `ui.js` = registration order = V2 before V1 and Hub order.

`ctx.host` (`ui.js:257-311`) provides:

- `home`, `refresh`;
- `payment {get, set, sync}`;
- `walletMethods`, `restrictionChips`;
- `memory` (per-module object kept for the panel's lifetime);
- `run` (the host action runner: busy flag, flash, refresh, notifications; `ui.js:564-642`);
- `scopedError`, `feedback`, `restriction`, `interactions`, `redraw`, `errorReason`;
- `emotes` (the emote-access service);
- `notifyError`.

### 3.3 Shared components and services

| Concern                         | File                                                                                                                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI primitives                   | `ui-primitives.js` (833)                                                                                                                                                                                                                                                                                 | Icons, wallet formatting, `createIconButton`, `createWalletFace`, `createCurrencySwitch` (l.423), `createMultiCurrencyPayment` (l.569, TTS V1), feedback slot (l.810-826), search helpers. "aucune règle métier" (l.1-2).                                                |
| Currency switch / header wallet | `ui-primitives.js` + `currency-switch.css` (376)                                                                                                                                                                                                                                                         | Header wallet built in `ui.js:1178-1301`. Hub = consultation tokens / credits (sum of `pending_actions.credits_remaining`). A paid module declares `wallet: {label, credits(state)}` in its variant (`9443ac1`).                                                         |
| Notifications                   | `notifications.js` (362)                                                                                                                                                                                                                                                                                 | Persistent centre in localStorage `raptoru-live:notification-center:v1` (l.15), 80 items, 7-day TTL. Fed by runtime errors (`ui.js:170-197, 408-431`) and by session `notifications`. Drawn by `ui.js:1016-1108`. Badge count on the dock and Hub (`experience.js:141`). |
| Toasts / flashes                | `ui.js:558-562` `flash()` (4 s); module-local toasts in `bonk-chargeur.js:319`, `commands-v2.js:406`, `moderation-v2.js:1485`, `events-shop.js:342`, `soundboard-feedback.js`                                                                                                                            | No shared toast component.                                                                                                                                                                                                                                               |
| Modals / popovers               | Tutorial dialog `ui.js:644-756`; preferences `ui.js:954-1014`; notifications `ui.js:1016`; restriction modal `viewer-restrictions.js:174`; "Tous" popover `hub-carousel.js`; Bonk tour `bonk-tour.js`; Twitch emote dialog `bonk-twitch-source.js:41`; D4 dialogs/sheets/sdrop inside `moderation-v2.js` | Each implemented locally; no shared modal primitive.                                                                                                                                                                                                                     |
| Emote picker                    | `emote-picker.js` (893) + `picker.css` (560)                                                                                                                                                                                                                                                             | Bonk only. Own scroll keys (`rl-picker-nav`, `rl-picker-scroll`), drag of favourites with document listeners removed on drag end. Its `ResizeObserver` (l.287) is never disconnected.                                                                                    |
| Twitch emote access             | `emote-access.js` (465)                                                                                                                                                                                                                                                                                  | Panel-level service: OAuth popup, polling 2 s up to 90 s, catalogue refresh 10 min.                                                                                                                                                                                      |
| Purchase                        | `purchase.js` (92)                                                                                                                                                                                                                                                                                       | Two-tap button, one idempotency key per intent, sends `expected_price`. **Used only by Coffre.** Historical purchases keep a key per click (`FRICTIONS.md` E3; `api.js:492-571`).                                                                                        |
| Experience                      | `experience.js` (144)                                                                                                                                                                                                                                                                                    | Presentation registry (short labels, home descriptions, themes default/halloween/winter, core tutorial).                                                                                                                                                                 |
| Restrictions                    | `viewer-restrictions.js` (218)                                                                                                                                                                                                                                                                           | Pill, chips, modal, tick from `state.restrictions`. **The Production Core façade never sends `restrictions`** (`grep` finds it only in `lab-ebs.ts:96, 427-433, 2190`), so this UI is legacy-Lab-only. [P]                                                               |
| Env badge                       | `env-badge.js`                                                                                                                                                                                                                                                                                           | Badge from `RUNTIME.environment` (staging, calibration).                                                                                                                                                                                                                 |

### 3.4 Access to the Core (`shared/api.js`, 735 lines)

- **Base URL:** `RUNTIME.apiBase` (`api.js:10`).
  - Production package: `https://core.raptoru.fr/v1/ext`.
  - Lab: `/ext-lab/api`, served by Studio (`apps/studio/server/src/extension-lab/serve.ts:28-37`).
  - Calibration: no apiBase, `fixtureCall` (`calibration/adapter.js`).
- **Auth:** `Authorization: Bearer <Twitch extension JWT from onAuthorized>` (`api.js:128-133`). Without a token: `authorization_pending`.
- **Requests:**
  - `Idempotency-Key` header on actions (`api.js:135`);
  - 8 s budget covering the body (`:15, 23-32`);
  - one retry on network errors and on 408/425/429/5xx with the same key (`:152-197`);
  - a JSON body is required on success (`:226-235`).
- **Session caching:** the first `GET /session`, then `GET /state` merged over it (`api.js:478-483`). The Core's `/state` also returns `modules` and `event_shop`, so prices follow (`ext-facade.ts:634-652`).
- **Demo mode:** an inline simulator (`api.js:276-461`) plus `demo-data.js` (485).
- **Endpoints, all relative to `/v1/ext` (`api.js:471-627`):**
  - session/state;
  - viewer/preferences;
  - emotes (+ refresh, oauth start/disconnect);
  - `/actions/tokens`, `/actions/redemption` (credits), Bonk salve on `/actions/tokens`;
  - `/moderation/v2/*` + `/moderation/v2/actions`;
  - `/modules/v3` (+ `/<id>/state`, `/<id>/<action>`, `/moderation`, `/moderation/<id>/activity`, `/moderation/refund`);
  - `/commands/public`, `/commands/v2/*`;
  - `/sub-wheel/me`, `/me/accept`, `/team/*`;
  - `/tts/state`;
  - `/events/state`, `/events/titles`, `/actions/events/purchase`, `/actions/events/titles/purchase`;
  - `/raffle/state`, `/actions/raffle`;
  - legacy: `/moderation/tts/*`, `/moderation/history`, `/moderation/users*`, `/moderation/modules`, `/actions/lab`.
- **Server side:**
  - `core-api/src/ext/public-frontier.ts` (293): JWT, CORS, rate limit;
  - `ext-facade.ts` (1 211): routes `ext-facade.ts:204-301`.
  - The Core derives `team` from the JWT role broadcaster/moderator (`ext-facade.ts:391-397`); `/moderation/*` requires `team` + shared identity (`:273-276`).
  - Commands (`/commands/public`, `/commands/v2/*`) are answered **only when `config.lab`** (`:223-242`). The session sets `commands_public` and `sub_wheel` to `this.config.lab === true` (`:583-585`). Production viewers see neither Commands nor Sub Wheel.
  - In Production, most legacy moderation routes return `not_available` (`:1174-1175`), so `api.js` keeps several dead methods (`moderationHistory`, `moderationUsers*`, `suspendUser`, `adjustSoundboardCredits`, `decideTtsSubmission`, `banTtsViewer`, `setModuleControl`, `setTtsModeration`, `runLab`).

### 3.5 Moderation access

- The Hub shows "Modération" when `state.moderation.tts.can_moderate`. The Core sets it to `true` for team (`ext-facade.ts:542-553, 614-621`).
- D4 (`moderation-v2.js`) reads `GET /moderation/v2/whoami` and uses `me.permissions` / `me.grants` (`moderation-v2.js:224-240`). These are display gates; the comment at l.72 says "Core checks them, never this page".
- The supermod role and D4 grants are computed by the Core.
- The host-module moderation panel appears under a host module view only when `canModerate()` (`ui.js:1525-1530`), and in D4 › "Autres modules" (`moderation-v2.js:637, 861, 1584` → `module-moderation.js:86-117`).

### 3.6 Lab / Hosted Test / calibration specifics

- **Extension Lab.** Studio serves `extension/` byte for byte under `/ext/`, with two substitutions (`apps/studio/server/src/extension-lab/serve.ts:1-90`):
  - the Twitch helper is replaced by `twitch-mock.ts`;
  - `runtime-config.js` points to `/ext-lab/api`.
  - The strict CSP allows `connect-src 'self'` only.
- **Default Lab.** The Lab now runs on the main Core in Lab mode. `core-frontier.ts` signs a Twitch-like JWT for fictional accounts 900101 / 900102 / 900100 and relays to `/v1/ext` (`core-frontier.ts:1-60`). `GUIDE_EXTENSION.md:8-13`: "Le Lab teste donc la vraie façade de Production".
- **Old Lab.** `lab-ebs.ts` (2 469 lines; the baseline in CLAUDE.md is 2 255) is the legacy EBS (`npm run studio:legacy`). It is the only server that sends `restrictions`, and the only one where TTS V1 / Tombola V1 / Moderation V1 can still be reached (see § 4).
- **Lab-only behaviours inside the extension:**
  - `bonkTwitchLockedForRole` (`bonk-model.js:364-369`, `environment==='lab'`);
  - `tts-v2` `lab` flag (`tts-v2.js:755`);
  - `wallet-payment.js:15` (`state.lab_mode`);
  - `ui.js:376-379` (`lab_mode` allows interactions).
- **Calibration build:** `build-calibration.mjs` + `calibration/` (adapter, fixtures, HUD). It packages a demo-mode extension for Video Component geometry only.
- **Staging build:** `build-staging.mjs` with a "STAGING · test" badge.

---

## 4. Module map

Legend for the "Shell" column: **S** = simple, **M** = medium, **C** = complex.

| Module                                                        | Hub id / nav                                                        | Main files (JS / CSS)                                                                                                                                                                                                                                                                     | Lifecycle, timers, scroll                                                                                                                                                                                                                                     | Modals / menus                                                            | Moderation functions                                                                                                     | Shared deps                                                                       | Reachable in Production?                                                                                         | Shell                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Hub / Historique / Notifications / Préférences / Tutorial** | host itself; Historique = pseudo-module `actions` (`ui.js:109-114`) | `ui.js`, `hub-carousel.js` (400), `experience.js`, `notifications.js`, `history-format.js` / `hub.css` (1 210) + `base.css` (`.jdm-notification` 50, `.jdm-tour` 46)                                                                                                                      | full rebuild per state; carousel destroyed each render; scroll keys `notification-center-list`, `module-actions`                                                                                                                                              | tutorial dialog, notification drawer, preferences, "Tous" popover         | —                                                                                                                        | everything                                                                        | yes                                                                                                              | **C**: this _is_ the shell; per-id styles/chips                                    |
| **Soundboard**                                                | `soundboard` (session `modules`)                                    | `soundboard-view.js` (1 152), `soundboard-model.js`, `-preview.js`, `-feedback.js`, `hover-marquee.js`, `stored-ids.js` / `soundboard.css` (1 495) **plus** `.jdm-sound`/`.sbx-` in `base.css` (1 128 matches), `mobile.css` (714), `overlay.css` (734)                                   | variant `match:()=>true` (`soundboard-view.js:1136-1152`); **draws into the host body** (`node:null`, `rendered`), `onState: view.absorb`; 1 s cooldown interval (l.1040-1056); root listeners removed in destroy (l.1125-1131); scroll key `soundboard-grid` | sort/filter menus, volume popover in the host header (`headIcon`), search | none (D4 handles)                                                                                                        | `host.run`, `host.memory`, `host.payment`, `wallet` decl., `walletPaymentMethods` | yes                                                                                                              | **C**: writes into the host container and header; CSS spread over 4 files          |
| **Bonk**                                                      | `bonk`                                                              | `bonk-view.js` (539), `bonk-model.js` (411), `bonk-chargeur.js`/`-model.js`, `bonk-send.js`, `bonk-tour.js`, `bonk-twitch-source.js`, `bonk-picker-groups.js`, `emote-picker.js` (893), `unicode-emojis.js` (9 648) / `picker.css` (560), `bonk-chargeur.css` (385) + base/overlay/mobile | variant `match:()=>true` (`bonk-view.js:530-539`), draws into host body; persistent chargeur/tour in `host.memory`; ResizeObservers in chargeur and picker never disconnected                                                                                 | tour (document keydown, removed), Twitch emote dialog, chargeur toast     | none                                                                                                                     | `host.emotes` (emote-access), `host.memory`, `newIdempotencyKey`                  | yes                                                                                                              | **C**: biggest asset set, OAuth flow, host-owned emote service                     |
| **TTS V2**                                                    | `tts` when `module.tts_v2` and `client.ttsBuy` (`tts-v2.js:739`)    | `tts-v2.js` (777), `tts-characters.js`, `tts-calibration.js` / `tts-v2.css` (291)                                                                                                                                                                                                         | own node; poll `/tts/state` 2 s (`:24, 647-649`); 1 s tick; timers set cleared in destroy (`:725-733`); localStorage tx record (`:113-114`); scroll key `tts-v2`                                                                                              | —                                                                         | —                                                                                                                        | `host.payment.sync` (header switch), `host.refresh`                               | yes (Core sets `tts_v2` when the TTS config is readable: `ext-facade.ts:468-478, 504`)                           | **M**: self-contained, but surface from body class and payment coupling            |
| **TTS V1**                                                    | fallback `!ttsV2Applies`                                            | `tts-v1.js` (251) / `.jdm-tts` in base (65), mobile (31), overlay (57)                                                                                                                                                                                                                    | `view:()=>({node:null})`, drawn into body each render (`tts-v1.js:243-251`)                                                                                                                                                                                   | —                                                                         | —                                                                                                                        | `createMultiCurrencyPayment`, `host.run`                                          | only if the Core cannot read the TTS config (`ttsConfig` `.catch(()=>null)`, `ext-facade.ts:434-436`)            | M (legacy fallback)                                                                |
| **Tombola V2**                                                | `raffle_join` when `module.raffle_v2` (`tombola-v2.js:584`)         | `tombola-v2.js` (611) / `tombola-v2.css` (1 102)                                                                                                                                                                                                                                          | own node + own header (`ownHeader`); poll `/raffle/state` 1 s active / 3 s idle; 250 ms ticker; cleared in destroy                                                                                                                                            | —                                                                         | D4 has Tombola V2 controls                                                                                               | `currency.js`, `host.restrictionChips`                                            | yes (`raffle_v2: true` always, `ext-facade.ts:543`)                                                              | **M**: self-contained, but `ui.js` still has raffle header/chip/`stableState` code |
| **Tombola V1**                                                | fallback                                                            | `tombola-v1.js` (507) / `.jdm-raffle` in base (331)                                                                                                                                                                                                                                       | countdown interval cleared in destroy                                                                                                                                                                                                                         | history drawer                                                            | —                                                                                                                        | —                                                                                 | **no** on the current Core (V2 always on); old Lab only                                                          | — (do not port)                                                                    |
| **Moderation V2 (D4)**                                        | `moderation` when `state.moderation_v2` (`moderation-v2.js:1866`)   | `moderation-v2.js` (1 916), `moderation-restrictions.js`, `module-moderation.js`, `commands-v2.js` (659) + model/icons / `moderation-v2.css` (611), `commands-v2.css` (898)                                                                                                               | own full screen; poll 2 s (`:1828`); 1 s tick; ResizeObserver (`:1812`) disconnected; 3 width modes compact / video / window (`:244-247`); `onState` absorbs for team                                                                                         | sheets, dialogs, dropdowns, toasts; Commands swap (not on Panel)          | full D4: search, viewer card, Jetons, restrictions, refunds, history, team / permissions, TTS controls, "Autres modules" | `module-moderation.js`, `currency.js`                                             | yes (`moderation_v2: true` always, `ext-facade.ts:582`)                                                          | **C**: its own app inside the shell, and its own responsive logic                  |
| **Moderation V1**                                             | fallback                                                            | `moderation-v1.js` (1 132) / `.jdm-mod*` in base / mobile / overlay                                                                                                                                                                                                                       | persistent console in `host.memory`                                                                                                                                                                                                                           | user history drawer                                                       | legacy routes, mostly 404 on Core                                                                                        | `host.feedback`                                                                   | **no** on the current Core                                                                                       | — (do not port)                                                                    |
| **Commands (public)**                                         | session module `commands` (`commands-public.js:113-125`)            | `commands-public.js` (125), `commands-v2-model.js`, `-icons.js` / `commands-v2.css`                                                                                                                                                                                                       | lazy reload ≤ 30 s on `attached`; no timer                                                                                                                                                                                                                    | search field                                                              | —                                                                                                                        | —                                                                                 | **no** (Core `commands_public` only in Lab, `ext-facade.ts:223-229, 583`); never on the Panel                    | S                                                                                  |
| **Roue du Sub**                                               | session module `sub_wheel` (`sub-wheel-ext.js:198-205`)             | `sub-wheel-ext.js` (205) / no own CSS (borrows `.lpill` from `commands-v2.css`)                                                                                                                                                                                                           | reload ≤ 15 s on `attached`                                                                                                                                                                                                                                   | inline confirm, team grant form                                           | team: draw request, grant                                                                                                | —                                                                                 | **no** (`sub_wheel` Lab only, `ext-facade.ts:585`)                                                               | S                                                                                  |
| **Événements (Halloween shop + Titres)**                      | session module `event_shop`, `hubFirst` (`events-shop.js:478-490`)  | `events-shop.js` (490) / `events-shop.css` (428)                                                                                                                                                                                                                                          | `setInterval` 5 s + 1 s ticker, cleared in destroy (`:456-463`)                                                                                                                                                                                               | two-tap confirm, notice                                                   | —                                                                                                                        | —                                                                                 | when the Core sends `event_shop.enabled === true` (shop open); **not in the presumed-published 0bf7907**         | S/M: self-contained "vue autonome" (cited as good pattern, `FRICTIONS.md:61`)      |
| **Coffre mystère (socle demo)**                               | host module (`coffre-mystere.js:68`)                                | `coffre-mystere.js` (68), `purchase.js` / **no CSS** (`rp-*` unstyled)                                                                                                                                                                                                                    | `setInterval` 5 s, cleared                                                                                                                                                                                                                                    | —                                                                         | panel under the module + D4 "Autres modules"                                                                             | `purchase.js`, `module-moderation.js`                                             | **no**: `labOnly`, skipped on canonical economy (`core-api/src/modules/host.ts:121-122`, `coffre-mystere.ts:33`) | S: already the target contract                                                     |
| **Currency switch**                                           | header (Hub and paid modules)                                       | `ui-primitives.js` `createCurrencySwitch` / `currency-switch.css`                                                                                                                                                                                                                         | rebuilt each render                                                                                                                                                                                                                                           | —                                                                         | —                                                                                                                        | —                                                                                 | yes                                                                                                              | S/M (logic lives in `ui.js:1178-1301`)                                             |
| **Restrictions UI**                                           | Hub pill, header chips, modal                                       | `viewer-restrictions.js` / `hub.css` `.rl-r*`                                                                                                                                                                                                                                             | 1 s tick in shell                                                                                                                                                                                                                                             | modal + "Ne plus afficher"                                                | —                                                                                                                        | localStorage                                                                      | **no data in Production** (Core façade never sends `restrictions`)                                               | S                                                                                  |
| **Config page**                                               | `config.html`                                                       | `config.js` (134) / `config.css`                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                             | —                                                                         | TTS pause / mode                                                                                                         | —                                                                                 | stale (SAMMI text, `setTtsModeration` 404)                                                                       | S (rewrite)                                                                        |

Modules **absent** from the extension (not found): Caution, Votekick, Random Ban, Spotify, Daily, Progression / Level Up (the preference is hidden, H15 `ui.js:951-1012`), Cosmetic shop (only "Titres" inside Événements), Mini-jeux.

Tests (`apps/twitch-extension/test/`, 15 files): pure model tests (bonk, commands, emote-picker, soundboard, currency, events-shop, calibration, api) plus `module-host.test.js` (registry / variants). Browser E2E lives in Studio (`apps/studio/server/e2e/*`, e.g. `lifecycle.e2e.ts`, `v1-parity.e2e.ts`, `modularity.e2e.ts`; listed in GUIDE/PREUVES, not re-run here).

---

## 5. Modular mechanisms from the Studio redesign: proven vs demo

| Mechanism                                                                                | Where                                                                              | Proven                                                                                                           | Not proven / limits                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One server door `moduleFacade` for Production and the old Lab                            | `packages/schemas/src/module-facade.ts`; `ext-facade.ts:287-300`                   | tested on both servers (PREUVES B: "façade de Production de bout en bout 2"); E2E `modularity.e2e.ts` in the Lab | **no host module viewer-visible in Production** (Coffre / Objectif labOnly; mini-games have no viewer capability, `mini-games.ts:21`); `module_activity` migration "préparée, pas appliquée" (`PREUVES.md:96-97`) [state at 05/11; whether Coulisses applied it is NV] |
| Host-module negotiation (server list ∩ known view)                                       | `module-registry.js:24-53`                                                         | unit tests; Lab E2E                                                                                              | 30 s cadence; global module state                                                                                                                                                                                                                                      |
| Purchase per intent, `expected_price`                                                    | `purchase.js`, `api.js:517-521`                                                    | Coffre, Core integration (10 concurrent → 1 debit)                                                               | **not used by any historical module** (TTS `ttsBuy` sends no price, `GUIDE_EXTENSION.md:149, 181`)                                                                                                                                                                     |
| Session modules                                                                          | `registerSessionModule`                                                            | Commands, Sub Wheel, Events moved out of `ui.js` (`8a2f113`)                                                     | Commands / Sub Wheel are Lab-only on the server                                                                                                                                                                                                                        |
| Variants V2/V1 with a server-driven switch                                               | `registerModuleVariant`, `ttsV2Applies`, `tombolaV2Applies`, `moderationV2Applies` | V1 parity E2E in demo mode (`6e0e4ae`); `onState` proven by mutation (`PREUVES.md:163`)                          | the switch is **frozen to true** for Tombola and D4 in the Core façade; only TTS can fall back (on Core failure, not by a setting). `GUIDE_EXTENSION.md:136-137`: who drives the signal is Antoni's decision                                                           |
| View lifecycle (destroy → no more reads)                                                 | `ui.js:533-556, 1338-1345`                                                         | `lifecycle.e2e.ts` 4/4 (PREUVES)                                                                                 | shell-level timers and listeners stay                                                                                                                                                                                                                                  |
| Host contract extensions (`headIcon`, `headAfter`, `wallet`, `host.run`, `host.memory`…) | CONTRATS § 12-13                                                                   | Soundboard, Bonk, TTS V1, Moderation V1                                                                          | Soundboard, Bonk and TTS V1 still draw into the host's body and header (no own node)                                                                                                                                                                                   |
| Module moderation panel + D4 "Autres modules"                                            | `module-moderation.js`, `moderation-v2.js:1584`                                    | HTTP tests                                                                                                       | `PREUVES.md:105-107`: "Pas vu : le panneau de modération sous le module avec une identité modérateur ; le remboursement cliqué"                                                                                                                                        |
| Generator `npm run module:new`                                                           | Core / Studio                                                                      | replayed 07/11 (`GUIDE_MODULE.md:48-80`)                                                                         | the extension view is still hand-written (one file + one import)                                                                                                                                                                                                       |

**Fallback / switch mechanisms that really exist:**

1. V2/V1 variants with complementary `match` (TTS live, the others frozen).
2. `loadHostModules` silent fallback (older Core: no host modules).
3. `typeof client.x === 'function'` capability checks in `available()`.
4. `sessionFailureState` closes interactions on a refresh failure, without blanking the UI (`api.js:724-735`, `ui.js:1623-1636`).
5. A Core-side visibility gate for Événements ("Tous / Testeurs seulement", `HALLOWEEN.md` § 7).
6. Rollback = republish the previous extension version (`LIVRAISON.md:100`).

---

## 6. Core as single authority: where the extension computes rules

The Core re-checks at payment time in every case listed. The risk is a **displayed** value that differs from what the Core will do.

| Place                                                                                 | What it computes                                                                                                                                          | Core equivalent                                                                                                                   | Risk                                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `tts-v1.js:60-74` `quoteFor`                                                          | price = `base_price × price_multiplier` per tier, else `mod.token_cost`                                                                                   | Core sells at the tier's absolute price; never sends `price_multiplier`; façade constant `token_cost: 7500` (`ext-facade.ts:111`) | V1 shows 7 500 (`GUIDE_EXTENSION.md:177-179`)                                                       |
| `tts-v2.js:118-133` `quote`                                                           | tier by code-point length after normalisation, tokens / credits price, cooldown, duration estimate (13.5 c/s default)                                     | Core `tts-lab/rules.ts` (`tierFor`, `normalizeMessage`)                                                                           | `ttsBuy` sends no price, so no `price_changed` guard if they diverge                                |
| `tts-v2.js:139-158` `blocker`                                                         | availability: disabled / paused / blocked / player offline / cooldown left (client clock) / busy / queue full / over max / insufficient tokens or credits | mostly reads Core flags (`viewer.*`), but balance and cooldown are compared locally                                               | display only                                                                                        |
| `wallet-payment.js:5-17` `walletPaymentMethods`                                       | which modules can pay in credits (`soundboard`, `tts` hard-coded); TTS has no credits in the Lab; TTS tokens only if `token_cost > 0`                     | Core `/actions/redemption` "TTS / Soundboard only" (`ext-facade.ts:270-272`)                                                      | hard-coded module list (`FRICTIONS` E5)                                                             |
| `wallet-payment.js:19-25` `walletCanPayTokens`                                        | `available >= cost`                                                                                                                                       | Core debit                                                                                                                        | display / CTA disable (Soundboard `soundboard-view.js:938, 1029`; TTS V1)                           |
| `soundboard-view.js:209-225`                                                          | fallback costs `token_cost ?? mod.token_cost ?? 500`, `credit_cost ?? 1`; availability from `cooldown_until` (client clock), `running` + `playback_mode`  | Core catalogue (`ext-facade.ts:507-534`) sends these                                                                              | the 500 / 1 defaults are invented when a field is missing                                           |
| `soundboard-view.js` ≈ 926-930                                                        | chooses which pending reward has `credits_remaining >= creditCost`                                                                                        | Core consumes credits                                                                                                             | display                                                                                             |
| `ui.js:1214-1222, 1316` and `soundboard-view.js:1142-1145`                            | credit balance = Σ `credits_remaining ?? 1`; TTS credits = count of pending TTS rows (`tts-v2.js:746`, `tts-v1.js:248`)                                   | Core sends `credits: { tts, soundboard }` (`ext-facade.ts:599-602`), **not read** for the header                                  | possible mismatch between the header count and the Core balance [P that both exist; equivalence NV] |
| `bonk-chargeur-model.js:128-129`                                                      | Auto salve price = `remaining shots × cost`                                                                                                               | Core admits and pays the salve atomically; bounds from `module.volley`                                                            | display                                                                                             |
| `bonk-model.js:367-369`                                                               | Lab-only Twitch emote lock for moderator / broadcaster                                                                                                    | Core `viewer_not_linked`                                                                                                          | display                                                                                             |
| `events-shop.js:110-125, 220-230`                                                     | `poor = balance < price`, `viewerWait` from `retry_after_ms` minus elapsed time                                                                           | Core sends `items[].reason`, `retry_after_ms`, balance                                                                            | display                                                                                             |
| `moderation-v2.js:1320`                                                               | "refundable" = not live, not raffle, not refunded, debited > 0                                                                                            | Core TTS publishes `refundable` (not read); same rule duplicated in Studio `mod/mod.ts` ≈ 948 (`GUIDE_EXTENSION.md:182-184`)      | button shown or hidden wrongly                                                                      |
| `moderation-v2.js:238-240` `can` / `has`                                              | permission gates from `whoami`                                                                                                                            | Core checks every command                                                                                                         | display only (correct pattern)                                                                      |
| `tombola-v1.js:26-28` `raffleIsActive` (also used by the Hub chip `ui.js:1405, 1546`) | open = `open && !unavailable && !closed_at`                                                                                                               | Core raffle state                                                                                                                 | display                                                                                             |
| `viewer-restrictions.js` `holdsAction`, tick                                          | remaining time from `until`                                                                                                                               | Core rows (old Lab only)                                                                                                          | display                                                                                             |
| `ui.js:376-379`                                                                       | interactions available = identity shared && (`interactions.available` or `lab_mode`)                                                                      | Core                                                                                                                              | display                                                                                             |
| `sub-wheel-ext.js` (grant)                                                            | key `crypto.randomUUID()` per submit, months clamped to 1..200                                                                                            | Core validates                                                                                                                    | retry = new key (`FRICTIONS` E3)                                                                    |

Correct "display what the Core returns" patterns:

- `coffre-mystere.js:31-44` (price, availability, reason from `moduleState`);
- Bonk price from the session (`bonk-view.js:281-283`, fix `d163944`);
- D4 (every list is a Core read model).

---

## 7. Implications for a responsive + modular redesign

- **Surface detection** should become one rule. Today:
  - body classes (`overlay`, `component-view`, `mobile`, `panel-view`);
  - width ≥ 520 (`commands-public.js:22`, `commands-v2.js:90`);
  - width ≥ 560 / 900 (`moderation-v2.js:244-247`);
  - the `is-narrow` threshold of 340 px (`ui.js:1495-1498`).

  Only `moderation-v2.css` and `soundboard.css` use `@container` (3 + 1 rules).

- **CSS volume:**
  - `base.css` has 132 `@media` and 72 `component-view` rules;
  - `overlay.css` has 804 `body.overlay` and 238 `component-view` selectors;
  - `mobile.css` has 984 `body.mobile` selectors.

  Legacy modules (Soundboard, TTS V1, Tombola V1, Moderation V1) are styled three times. New-generation modules (TTS V2, Tombola V2, D4, Commands, Events) are scoped in their own sheet. Moving everything to one responsive shell means the legacy-styled modules carry most of the CSS work.

- **Easiest to put under a new shell first:** Coffre / any socle module, Commands, Sub Wheel, Events. These are already `{node, start, destroy}`.
- **Medium:** TTS V2, Tombola V2. Self-contained, but coupled to the header wallet or their own header.
- **Hardest:**
  - D4: its own app with its own breakpoints and popout;
  - Soundboard and Bonk: they draw into the host body/header, use `host.memory` persistent instances and the host emote service, and spread CSS across four files;
  - the Hub itself: full-rebuild renderer, per-id styles and chips.
- **Do not port:** TTS V1, Tombola V1, Moderation V1 are unreachable on the current Core except TTS V1 on a Core read failure. Per CLAUDE.md, legacy still in use must not be removed; their status ("unreachable") should be confirmed by Antoni before any drop.
- **Publication risk:**
  - fix OPERATIONS § 7 (build vs build:production);
  - remember that any redesign ships only through Twitch review, one version at a time, after the not-yet-submitted 05/11 work.

## Unproven / to confirm

- Which version Twitch serves today (0bf7907 is documented only through a relay; Halloween f1c9a7d submission is unknown).
- The published extension's console settings (60 % vs 65 %, panel height 496, whether a Video Overlay anchor is also declared).
- Whether `module_activity` was applied in Production by Opération Coulisses (no host module would be visible anyway: all are labOnly).
- Whether the header credit counts (Σ `credits_remaining`) always equal the Core's `credits.{tts, soundboard}`.
- Whether the legacy `raptoru.fr/api` EBS still answers (it matters only if someone uploads `npm run build` output).
