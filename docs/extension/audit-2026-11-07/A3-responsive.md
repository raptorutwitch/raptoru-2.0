# Raptoru Live extension — responsive diagnosis (read-only)

Source: worktree `Raptoru 2.0 - Worktrees/studio-ux`, detached at `origin/main` `13ed6e8`, folder
`apps/twitch-extension/extension/`. Nothing in the repository was modified.

## 0. How it was measured

- `server.mjs` (this folder): read-only static server on `127.0.0.1:4471` serving the real `extension/`
  files. Two on-the-fly substitutions, never on disk: the Twitch helper `<script>` is stripped, and
  `shared/runtime-config.js` is replaced by the **calibration build's** config (`mode: 'demo'`,
  `fixtureCall` = `apps/twitch-extension/calibration/adapter.js`). So the real client, Hub, views and
  CSS run against the anonymised fixtures of `calibration/fixtures.js` (moderator, TTS / Soundboard /
  Bonk / Tombola + Moderation, 69 sounds, 7 Tombola participants). No network, no Twitch, no Core.
  This is exactly what `scripts/build-calibration.mjs` packages (minus the HUD).
- Views opened with the existing `?demoModule=<id>` option (`overlay.js` / `mobile.js` → `createModulePanel`).
- `audit.mjs` (in-page): for every visible interactive element and every text-bearing element:
  clipped by an `overflow: hidden|clip` ancestor (child of a scroll container is judged through that
  container's visible window, i.e. "reachable by scrolling" is NOT counted as cut), outside the viewport
  when the document cannot scroll, centre covered by another element, smallest font, smallest target
  (WCAG 2.5.8: 24 px), scroll containers that actually scroll.
- `measure.mjs` (matrix), `sweep.mjs` (breaking points), `resize.mjs` (live resize without reload),
  `popovers.mjs` (layers), `legacy.mjs` (dead CSS check). Screenshots: `shots/`. Raw: `results-*.json`,
  `sweep.json`, `resize.json`.
- Headless Chromium (Playwright 1.63, SwiftShader). Browser zoom emulated as "CSS viewport ÷ zoom +
  deviceScaleFactor = zoom" (what the journal already used: 600×432 @150 % → 400×288).
- Known harness artefacts: the orange `CALIBRATION · test` env badge (10 px) exists only because
  `environment: 'calibration'`; it is excluded from the min-font column. Soundboard card names
  (`.sbx-card__label`) are clamped/marquee by design and excluded from "text cut".

## 1. How the layout is sized

### 1.1 Root size

| Surface            | Root rule                                                                                                                                                                                                                                                                                       | Effect                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video Component    | `overlay.css:5-10` `html, body.overlay { height:100%; overflow:hidden }`                                                                                                                                                                                                                        | The iframe never scrolls: anything past the viewport is unreachable.                                                                                          |
| Video Component    | `overlay.js:146` adds `body.component-view`; `overlay.css:98-111` `body.component-view .drawer { inset:0; width:100%; height:100% }`; `overlay.css:118-123` `body.component-view .drawer__body { overflow:hidden }` and `overlay.css:236-246` `body.component-view .drawer { overflow:hidden }` | The whole UI lives in `#panel.drawer__body`, a non-scrolling box of exactly the iframe size. Every view must fit by itself.                                   |
| Hub (all surfaces) | `hub.css:18-19` `.rh-hub { height: calc(100dvh - var(--rh-top) - var(--rh-bottom)); min-height: 330px; overflow:hidden }`, offsets measured once in `shared/ui.js:1494-1504` (rAF)                                                                                                              | Fits the viewport down to 330 px of height, then overflows its non-scrolling parent (video) or makes the page scroll (panel/mobile).                          |
| Soundboard         | `soundboard.css:13-14` `height/max-height: calc(100dvh - var(--sb-top) - var(--sb-bottom))`, measured in `shared/soundboard-view.js:1059-1068`                                                                                                                                                  | Fits any height; only the grid scrolls. Most robust view.                                                                                                     |
| TTS V2             | `tts-v2.css:8,13` `.jdm-module__body[data-tts-v2]`, `.ttsv2 { height:100%; overflow:hidden }`                                                                                                                                                                                                   | Must fit; no internal scroll on the video surface (the `.scroll` wrapper exists only in the stacked panel/mobile layout).                                     |
| Tombola V2         | `tombola-v2.css:12` body `overflow:hidden`; `.tmbx .body` scrolls except in the compact window (`tombola-v2.css:1007-1012` sets it to `overflow:hidden`).                                                                                                                                       | See §2.                                                                                                                                                       |
| Panel              | `mobile.css:5-8` `html, body.mobile { min-height:100% }`; `.m-body` flows                                                                                                                                                                                                                       | The document scrolls (318×300: doc 360 px tall). Panel width is fixed by Twitch at 318 CSS px, height 496 in the console (`apps/twitch-extension/README.md`). |
| Mobile             | same as panel + per-view `body.mobile:has(.ttsv2/.tmbx/.modv2/.cmdx) .m-body { height:100vh; overflow:hidden }` (`tts-v2.css:11`, `tombola-v2.css:21`, `moderation-v2.css:9`, `commands-v2.css:6`)                                                                                              | Views lock the page to 100vh and scroll inside.                                                                                                               |

No `aspect-ratio`, no `vw`-based root, no global `transform: scale` / `zoom` (stated explicitly in
`hub.css:994` "Aucun transform/zoom global"). Fonts are all **px** (≈ 1 380 `font-size: …px`
declarations, no `rem` sizing of text; `body { font: 14px/1.45 … }` `base.css:31-36`). Spacing tokens
`--jdm-gap-xs…lg` 4/6/10/14 px and `--jdm-control-min: 30px` (`base.css:17-25`) are px constants.

### 1.2 Scaling / adaptation logic that exists

| Mechanism                                       | Where                                                                                                                                     | Breakpoint / rule                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "compact-video" profile (only real calibration) | `hub.css:995`, `tts-v2.css:284`, `tombola-v2.css:995`, `moderation-v2.css:600`                                                            | `(min-width:521px) and (min-height:321px) and (max-height:400px)` — a **window** tailored to 565×376.                                                                                                                                                                                                                    |
| Soundboard compact                              | `soundboard.css:1276`, `1436`, `1441`, `1447`                                                                                             | `max-height:400px` (any width); `≤460` / `≤360` wide; `≤320` high.                                                                                                                                                                                                                                                       |
| Tombola 2 columns                               | `tombola-v2.css:881`                                                                                                                      | `min-width:560px` → `250px minmax(0,1fr)`.                                                                                                                                                                                                                                                                               |
| Tombola compact heights                         | `tombola-v2.css:740, 875`                                                                                                                 | `max-height:520px`.                                                                                                                                                                                                                                                                                                      |
| TTS layout chosen by page, not size             | `shared/tts-v2.js:69-73` `ttsV2Surface()`                                                                                                 | `body.component-view` ⇒ always the 2-column video layout (`tts-v2.css:245` `grid-template-columns: 1fr 250px`), whatever the width.                                                                                                                                                                                      |
| Moderation mode by JS width                     | `shared/moderation-v2.js:244-247`                                                                                                         | `≥900` window · `≥560` video · else compact; container queries `moderation-v2.css:349-356` (440/330/280).                                                                                                                                                                                                                |
| Commands mode by JS width                       | `shared/commands-v2.js:90`, `shared/commands-public.js:22`                                                                                | `≥520` video · else mobile.                                                                                                                                                                                                                                                                                              |
| Hub carousel                                    | `shared/hub-carousel.js:216-230` (ResizeObserver)                                                                                         | card width `176` (or `--rh-card-w`, 153 in compact) when track `>460`, else `min(224, w-150)` / `min(200, w-110)`; card height `max(180, min(h-18, cw*1.52))`. `is-narrow` at `≤340` (`ui.js:1495`).                                                                                                                     |
| Picker / emote grid                             | `shared/emote-picker.js:219-287` (ResizeObserver)                                                                                         | columns from container width.                                                                                                                                                                                                                                                                                            |
| Legacy fluid rules                              | `overlay.css:120-345` (`clamp(…, 9vh, …)`, `clamp(…, 2vw, …)`), `base.css` 132 media queries (390/520/620/660/700 wide, 320/390/430 high) | **Dead in the current UI**: `legacy.mjs` found 0 elements for `.jdm-tab(s)`, `.jdm-sound`, `.jdm-grid`, `.jdm-home*`, `.jdm-link`, `.jdm-emotes`, `.jdm-badge`, `.jdm-wallet`, `.jdm-actions`, `.jdm-input` across 7 views × 3 surfaces. Comments there still assume "hauteur cible 40 % du player" (`overlay.css:316`). |

Breakpoint values in use (all px): widths 280, 330, 340, 350, 360, 390, 420, 440, 460, 520, 521, 560,
620, 660, 700, 900; heights 320, 321, 380, 390, 400, 420, 430, 520. Container queries: only
`moderation-v2.css` (3) and `soundboard.css:560` (`sbx-card ≤150px`). `clamp()`: 39 uses, almost all in
the dead legacy rules above. `!important`: base 2 414, overlay 1 839, mobile 1 619 — specificity wars
between generations of CSS (`soundboard.css:1-3` explains it re-takes the container "avec une spécificité
d'id").

### 1.3 No resize bug found

`resize.mjs`: loading at 565×376 then resizing live to 450×300 or 867×578 gives the same result as a fresh
load at the target size (`--rh-top` stays 0, `--sb-top` 46 px, hub/sb boxes follow `100dvh`). The
measured-once offsets are not a problem in the Video Component (hypothesis that remains open: panel /
mobile where `--rh-bottom` is only ever increased, `ui.js:1503`).

## 2. Concrete causes (ranked by impact)

| #   | Cause                                                                                                                                                                                                                                                                                                        | File:selector / line                                                                                                                                                                                                                                                                                                       | Visible effect                                                                                                                                                                                                                                                            | Sizes where it bites (measured)                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | TTS video layout has a fixed 250 px preview column and no scroll; the pay row is the last flex child of a column inside `.ttsv2 { overflow:hidden }`. Layout picked by page class, not by size.                                                                                                              | `tts-v2.css:245` `.ttsv2[data-surface='video'] .cols { grid-template-columns: 1fr 250px }`; `tts-v2.css:13` `.ttsv2 {overflow:hidden}`; `tts-v2.css:84-85` `.cols` / `.col`; `shared/tts-v2.js:69-73`, `:291-294`                                                                                                          | **"Confirmer · 7 500 J" and the currency button are clipped → TTS cannot be paid.** Message column squeezed to ≈ 90 px at 378 wide.                                                                                                                                       | Cut when height < ≈ 335–345 (also inside the compact window: 565×330) or width < ≈ 400 (380×376): 514×342 (zoom 110 %), 452×301 (125 %), 377×251 (150 %), 400×288, 450×300, 378×252, 300×300. OK at 521×347 / 565×376 (compact profile) and ≥ 600×432. See sweep. |
| 2   | Hub cannot go below 330 px of height, inside a non-scrolling root                                                                                                                                                                                                                                            | `hub.css:19` `.rh-hub { min-height:330px }` + `overlay.css:118-123` `.drawer__body {overflow:hidden}` + `overlay.css:5-10`                                                                                                                                                                                                 | **Bottom dock cut: "Historique", "Voir tous les modules" (grid), "?" tutorial unreachable.** At ≤ 252 high the carousel itself is cut and card titles overlap their icons (min card height 180 px, `hub-carousel.js:224`).                                                | Every Video Component height < ≈ 320 px (sweep): 450×300, 452×301 (zoom 125 % of the reference), 400×288, 378×252, 377×251 (150 %), 300×300.                                                                                                                      |
| 3   | The compact profile is a _window_ (521–∞ × 321–400) shared by 4 files; outside it each view falls back to its 600×432-era layout. Different views switch at different, unrelated thresholds (TTS: page class; Moderation 560/900 JS; Commands 520 JS; Tombola 560 CSS; Soundboard 400 high; Hub 340/460 JS). | `hub.css:995`, `tts-v2.css:284`, `tombola-v2.css:995`, `moderation-v2.css:600`, `soundboard.css:1276`                                                                                                                                                                                                                      | A few px of difference (zoom 110 %: 565×376 → 514×342) flips the layout from "fits" to "CTA cut". The design only holds at the measured reference.                                                                                                                        | Cliffs at width 521 and heights 321 / 400; see the sweep table.                                                                                                                                                                                                   |
| 4   | Tombola: compact profile starts at **521** px wide but the 2-column grid starts at **560**; inside the compact window the body is `overflow:hidden`, so between 521 and 559 px the stacked participants list is below the fold and **cannot be scrolled**.                                                   | `tombola-v2.css:881` `@media (min-width:560px) .grid2` vs `tombola-v2.css:995-1012` `.body:has(> .grid2 .hero) { overflow:hidden }`                                                                                                                                                                                        | Participants list ("Participants · 7", rows) clipped and unreachable.                                                                                                                                                                                                     | **521×347 = the measured 60 % Twitch size**; any 521–559 × 321–400.                                                                                                                                                                                               |
| 5   | Selector collision on mobile TTS: `body.mobile:has(.ttsv2) .m-body { height:100vh; overflow:hidden }` targets the page `<main class="m-body">` **and** the TTS inner `<div class="m-body">` (`shared/tts-v2.js:284,302`). The inner scroll content is capped at exactly 100vh and clipped.                   | `tts-v2.css:11`; `shared/tts-v2.js:302` `stacked(surface === 'mobile' ? 'm-body' : 'body')`                                                                                                                                                                                                                                | Mobile TTS: `.scroll` content height always = viewport height (780/844/932/390 measured). Landscape 844×390: **character roster/arrows unreachable**; 360×780: arrows clipped at the edges.                                                                               | Mobile 844×390 (8 controls), 360×780 (2).                                                                                                                                                                                                                         |
| 6   | Over-stretch on large iframes: fixed px fonts and components, no `max-width` on the view roots, fixed side columns with a `1fr` filler.                                                                                                                                                                      | `tts-v2.css:245` (`1fr 250px`), `tombola-v2.css:881` (`250px minmax(0,1fr)`), hub card width 176 px (`hub-carousel.js:221-222`), `.rh-hub`/`.ttsv2`/`.tmbx` without max-width                                                                                                                                              | 1053×702: TTS textarea 760 px wide with a large empty middle; Tombola list stretched over 760 px, hero stuck at 250 px, half the screen empty; Hub cards stay 176 px in a 1053 px stage; text stays 9–13 px. Nothing is cut, the composition just floats.                 | ≥ 750×500, worst at the theatre/fullscreen sizes 867×578, 1053×702.                                                                                                                                                                                               |
| 7   | Root `overflow:hidden` is still programmatically scrollable: focusing / scrolling-into-view a clipped control scrolls `#panel` and the header leaves the iframe with no way back (no scrollbar, wheel ignored).                                                                                              | `overlay.css:118-123`, `236-246`                                                                                                                                                                                                                                                                                           | Observed after activating "Voir tous les modules" / tutorial at 378×252 and 450×300: notifications, préférences and wallet moved to y = −61 / −4 (`shots/pop-*-378x252.png`). Mouse users cannot trigger it on a cut element; keyboard Tab can (hypothesis for real use). | Same sizes as #2.                                                                                                                                                                                                                                                 |
| 8   | Tiny text / targets baked in px (not size-dependent, so zoom does not help inside the iframe either). 368 `font-size` declarations below 10 px (5–9.5 px).                                                                                                                                                   | Bonk: `.bkc-grab` 40×12, `.bkc-wipe` 15×39, `.bkc-help-btn` 18×18, `.rl-picker__input` 17 px high, caret 8 px. Soundboard: `.sbx-card__fav` 18×18, filters 20 px high (compact). Moderation: `button.who` / `button.txt` 17 px high, search input 20 px. Hub compact: brand `small` 8.5 px, `Historique` 81×23, `?` 23×23. | Below WCAG 2.5.8 (24 px); 8–9 px text.                                                                                                                                                                                                                                    | Constant across sizes (fixed px); the compact profile makes it slightly worse (8.5 px).                                                                                                                                                                           |
| 9   | Popovers / overlays are mostly well bounded                                                                                                                                                                                                                                                                  | hub "Tous" `hub.css:552-553` (`max-width: calc(100% - 16px); max-height: calc(100% - 110px)`), notifications `base.css:16471`, Bonk tour `bonk-chargeur.css:283` (`min(300px, 100vw - 16px)`), moderation menus clamped in JS (`moderation-v2.js:1253-1256`)                                                               | No popover found outside the viewport at 378×252 … 1053×702 except the consequence of #7.                                                                                                                                                                                 | –                                                                                                                                                                                                                                                                 |

Not a cause (checked): no `vw`-based root, no `aspect-ratio`, no global scale; document never scrolls
horizontally (scrollWidth = clientWidth in every measured case); Soundboard and Bonk adapt correctly to
every measured size (only their grids scroll).

## 3. What sizes the code expects, and what Twitch gives

- Video Component settings: README says _target height 60 %, ratio 3:2, autoscale off_
  (`apps/twitch-extension/README.md`); the calibration doc says the decision is **65 % · 3:2 · OFF**
  (§4). The README is out of date or the console still says 60 % — the latter gives 521×347, which hits
  cause #4 (Tombola). **To confirm with Antoni (console value).**
- The iframe CSS size is `0.65 × player height` × 3:2. The player height depends on window size, chat /
  side-bar, theatre / fullscreen and browser zoom / Windows scaling. Approximate CSS iframe sizes
  (hypotheses, Twitch layout assumed: top bar 50, chat 340, side nav 240/50, 16:9 player):

| Situation (hypothesis)                  | Player CSS height | Iframe at 65 %      |
| --------------------------------------- | ----------------- | ------------------- |
| Antoni's measurement (fact)             | ≈ 578             | 565×376             |
| 1920 wide, 100 %, chat + collapsed nav  | ≈ 860             | ≈ 840×560           |
| 1920 wide @125 % (1536 CSS), chat + nav | ≈ 540–645         | ≈ 525×350 … 630×420 |
| 1920 wide @150 % (1280 CSS), chat + nav | ≈ 395–500         | ≈ 385×257 … 490×325 |
| Theatre 1920×1080                       | ≈ 890             | ≈ 867×578           |
| Fullscreen 1920×1080                    | 1080              | ≈ 1053×702          |

So real viewers span roughly **380×250 → 1050×700**; the extension is designed for one point of it.

## 4. "V1" reference data found

| Source                                                                                                                    | What it says                                                                                                                                                                                                                                         | Implied dimensions                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md` §4 (measured by Antoni, Hosted Test on LeCroupier_, calibration HUD, 14/10) | 60 % → **521×347**, 65 % → **565×376** (target), 75 % → **651×434**; autoscale ON = blurry.                                                                                                                                                          | All three = pct × **≈ 578.6 CSS px** of player height → player ≈ 1029×579 CSS. dpr / window size **not recorded** in the doc (the HUD did show dpr). Hypothesis: 1920×1080 screen at 125 % scaling (CSS viewport ≈ 1536 wide) or a ≈ 1600 CSS-px window; to verify. |
| same doc §1                                                                                                               | Old Lab assumption: player 1280×720, 60 %, 3:2 − 48 px = **600×432**.                                                                                                                                                                                | 600×432 = the frame of every validated prototype capture (below).                                                                                                                                                                                                   |
| `docs/archive/REPRISE_journal_2026-10-21_24.md` l.580-604 (Wenuyr report, 22/10)                                          | Component 600×432 at zoom 100/110/125/150 % → 12/12/3/0 Soundboard cards before the fix; "en dessous d'environ 300×200 (portable + zoom 150 %) l'en-tête commun laisse trop peu de place"; sizes tested 420×300, 360×260, 400×288, 396×264, 317×211. | Confirms real viewers with zoom 125–150 % (≈ 480×346, 400×288). Only the Soundboard was adapted.                                                                                                                                                                    |
| Prototypes (main checkout `prototypes/`, not in git): `tts-v2-extension-ux/captures`                                      | 72 captures each at **600×432** (video), **318×496** (panel), **390×557** (mobile)                                                                                                                                                                   | The TTS V2 video layout (`1fr 250px`) was validated at 600×432.                                                                                                                                                                                                     |
| `prototypes/moderation-v2-d4/captures`                                                                                    | video 604×448 (600×432 + frame), panel 322×512, mobile 379×576, window 1104×736                                                                                                                                                                      | Same 600×432 reference.                                                                                                                                                                                                                                             |
| `prototypes/hub-nav-dots/captures`                                                                                        | 604×448 (×20)                                                                                                                                                                                                                                        | Hub validated at 600×432.                                                                                                                                                                                                                                           |
| `prototypes/commands-v6/captures`                                                                                         | viewer video 602×434, mobile 378×562                                                                                                                                                                                                                 | Same.                                                                                                                                                                                                                                                               |
| Studio Lab presets                                                                                                        | `apps/studio/web/src/pages/labo-surfaces.ts:43-49` video **565×376**, panel 318×496, mobile 390×844; `labo-extension.ts:56-71` 565×376 + 651×434, phones 360×780 / 390×844 / 430×932                                                                 | The Lab tests only the reference point (plus 651×434).                                                                                                                                                                                                              |
| `docs/studio-refonte/captures/foundation/08-extension-lab.png`                                                            | Studio Lab with the panel 318×496                                                                                                                                                                                                                    | Not Antoni's Twitch environment.                                                                                                                                                                                                                                    |

No screenshot of Antoni's real Twitch page was found in the repo. The calibration build
(`npm run build:calibration`) is the existing instrument to capture it (HUD shows inner size, dpr,
visualViewport, `onContext.displayResolution`).

## 5. Measurement matrix

Cell = status · smallest font (px, env badge excluded) · smallest interactive target (px, count < 24).
"✗ n ctl cut" = n interactive elements clipped by an `overflow:hidden` ancestor or outside a
non-scrolling viewport. Bonk measured with its first-visit tour dismissed (`NOTOUR=1`).

### video

| size @dpr    | label                       | doc scroll (W×H vs client) | hub                          | tts                           | soundboard             | bonk                | raffle_join             | moderation               | actions       |
| ------------ | --------------------------- | -------------------------- | ---------------------------- | ----------------------------- | ---------------------- | ------------------- | ----------------------- | ------------------------ | ------------- |
| 378x252@1    | 3:2 small laptop (hyp.)     | 378×252 / 378×252          | **✗ 4 ctl cut** · f9.5 · t27 | **✗ 2 ctl cut** · f10.5 · t30 | ok · f9.5 · t18(9<24)  | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 450x300@1    | 3:2                         | 450×300 / 450×300          | **✗ 3 ctl cut** · f9.5 · t27 | **✗ 2 ctl cut** · f10.5 · t30 | ok · f9.5 · t18(12<24) | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 521x347@1    | Twitch 60% measured         | 521×347 / 521×347          | ok · f8.5 · t23(2<24)        | ok · f10.5 · t30              | ok · f9.5 · t18(15<24) | ok · f8 · t12(5<24) | ⚠ 22 txt cut · f9 · t28 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 565x376@1    | Twitch 65% measured (REF)   | 565×376 / 565×376          | ok · f8.5 · t23(2<24)        | ok · f10.5 · t30              | ok · f9.5 · t18(19<24) | ok · f8 · t12(5<24) | ok · f9 · t28           | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 600x432@1    | old Lab normal              | 600×432 / 600×432          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 651x434@1    | Twitch 75% measured         | 651×434 / 651×434          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 750x500@1    | 3:2                         | 750×500 / 750×500          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 867x578@1    | 3:2 theatre 1080p (hyp.)    | 867×578 / 867×578          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 1053x702@1   | 3:2 fullscreen 1080p (hyp.) | 1053×702 / 1053×702        | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 514x342@1.1  | REF @ zoom 110%             | 514×342 / 514×342          | ok · f9.5 · t26              | **✗ 2 ctl cut** · f10.5 · t30 | ok · f9.5 · t18(15<24) | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 452x301@1.25 | REF @ zoom 125%             | 452×301 / 452×301          | **✗ 3 ctl cut** · f9.5 · t27 | **✗ 2 ctl cut** · f10.5 · t30 | ok · f9.5 · t18(12<24) | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 377x251@1.5  | REF @ zoom 150%             | 377×251 / 377×251          | **✗ 4 ctl cut** · f9.5 · t27 | **✗ 2 ctl cut** · f10.5 · t30 | ok · f9.5 · t18(9<24)  | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 400x288@1.5  | 600x432 @150% (journal)     | 400×288 / 400×288          | **✗ 3 ctl cut** · f9.5 · t27 | **✗ 2 ctl cut** · f10.5 · t30 | ok · f9.5 · t18(12<24) | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 300x300@1    | portrait (caller)           | 300×300 / 300×300          | **✗ 3 ctl cut** · f12 · t27  | **✗ 2 ctl cut** · f10.5 · t24 | ok · f9.5 · t18(9<24)  | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 400x500@1    | portrait (caller)           | 400×500 / 400×500          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 480x640@1    | portrait (caller)           | 480×640 / 480×640          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 560x800@1    | portrait (caller)           | 560×800 / 560×800          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(5<24) | ok · f9 · t30 |
| 700x900@1    | portrait (caller)           | 700×900 / 700×900          | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |
| 900x1100@1   | portrait (caller)           | 900×1100 / 900×1100        | ok · f9.5 · t26              | ok · f10.5 · t30              | ok · f10 · t24         | ok · f8 · t12(5<24) | ok · f10 · t32          | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |

### panel

| size @dpr   | label                | doc scroll (W×H vs client) | hub            | tts              | soundboard            | bonk                | raffle_join    | moderation               | actions       |
| ----------- | -------------------- | -------------------------- | -------------- | ---------------- | --------------------- | ------------------- | -------------- | ------------------------ | ------------- |
| 318x496@1   | panel console height | 318×496 / 318×496          | ok · f11 · t26 | ok · f10.5 · t30 | ok · f10 · t24        | ok · f8 · t12(5<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 318x300@1   | panel short          | 318×360 / 318×300          | ok · f12 · t27 | ok · f10.5 · t30 | ok · f9.5 · t18(9<24) | ok · f8 · t12(5<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 318x700@1   | panel tall           | 318×700 / 318×700          | ok · f11 · t26 | ok · f10.5 · t28 | ok · f10 · t24        | ok · f8 · t12(5<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 318x496@1.5 | panel @ zoom 150%    | 318×496 / 318×496          | ok · f11 · t26 | ok · f10.5 · t30 | ok · f10 · t24        | ok · f8 · t12(5<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |

### mobile

| size @dpr | label           | doc scroll (W×H vs client) | hub             | tts                         | soundboard             | bonk                | raffle_join    | moderation               | actions       |
| --------- | --------------- | -------------------------- | --------------- | --------------------------- | ---------------------- | ------------------- | -------------- | ------------------------ | ------------- |
| 360x780@2 | phone small     | 360×780 / 360×780          | ok · f9.5 · t26 | **✗ 2 ctl cut** · f12 · t30 | ok · f10 · t24         | ok · f8 · t12(6<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 390x844@3 | phone standard  | 390×844 / 390×844          | ok · f9.5 · t26 | ok · f12 · t30              | ok · f10 · t24         | ok · f8 · t12(6<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 430x932@3 | phone large     | 430×932 / 430×932          | ok · f9.5 · t26 | ok · f12 · t30              | ok · f10 · t24         | ok · f8 · t12(6<24) | ok · f10 · t32 | ok · f11.5 · t19.5(1<24) | ok · f9 · t30 |
| 844x390@3 | phone landscape | 844×390 / 844×390          | ok · f9.5 · t26 | **✗ 8 ctl cut** · f12 · t30 | ok · f9.5 · t18(23<24) | ok · f8 · t12(6<24) | ok · f10 · t32 | ok · f10.5 · t16.8(6<24) | ok · f9 · t30 |

### Breaking-point sweep (Video Component, fresh load per size)

| series | size    | hub | tts | raffle_join | soundboard (visible cards / cols) | moderation |
| ------ | ------- | --- | --- | ----------- | --------------------------------- | ---------- |
| 3:2    | 360x240 | ✗4  | ✗2  | ok          | ok 6/3                            | ok         |
| 3:2    | 375x250 | ✗4  | ✗2  | ok          | ok 6/3                            | ok         |
| 3:2    | 390x260 | ✗4  | ✗2  | ok          | ok 6/3                            | ok         |
| 3:2    | 405x270 | ✗3  | ✗2  | ok          | ok 9/3                            | ok         |
| 3:2    | 420x280 | ✗3  | ✗2  | ok          | ok 9/3                            | ok         |
| 3:2    | 435x290 | ✗3  | ✗2  | ok          | ok 9/3                            | ok         |
| 3:2    | 450x300 | ✗3  | ✗2  | ok          | ok 9/3                            | ok         |
| 3:2    | 465x310 | ✗3  | ✗2  | ok          | ok 9/3                            | ok         |
| 3:2    | 480x320 | ok  | ✗2  | ok          | ok 16/4                           | ok         |
| 3:2    | 495x330 | ok  | ✗2  | ok          | ok 12/4                           | ok         |
| 3:2    | 510x340 | ok  | ✗2  | ok          | ok 12/4                           | ok         |
| 3:2    | 525x350 | ok  | ok  | ⚠txt        | ok 12/4                           | ok         |
| 3:2    | 540x360 | ok  | ok  | ⚠txt        | ok 16/4                           | ok         |
| 3:2    | 555x370 | ok  | ok  | ⚠txt        | ok 16/4                           | ok         |
| 3:2    | 570x380 | ok  | ok  | ok          | ok 16/4                           | ok         |
| 3:2    | 585x390 | ok  | ok  | ok          | ok 20/5                           | ok         |
| 3:2    | 600x400 | ok  | ok  | ok          | ok 20/5                           | ok         |
| 3:2    | 615x410 | ok  | ok  | ok          | ok 12/4                           | ok         |
| 3:2    | 630x420 | ok  | ok  | ok          | ok 12/4                           | ok         |
| 3:2    | 645x430 | ok  | ok  | ok          | ok 12/4                           | ok         |
| 3:2    | 660x440 | ok  | ok  | ok          | ok 12/4                           | ok         |
| 3:2    | 675x450 | ok  | ok  | ok          | ok 12/4                           | ok         |
| 3:2    | 690x460 | ok  | ok  | ok          | ok 12/4                           | ok         |
| h376   | 380x376 | ok  | ✗2  | ok          | ok 12/3                           | ok         |
| h376   | 400x376 | ok  | ok  | ok          | ok 12/3                           | ok         |
| h376   | 420x376 | ok  | ok  | ok          | ok 12/3                           | ok         |
| h376   | 440x376 | ok  | ok  | ok          | ok 12/3                           | ok         |
| h376   | 460x376 | ok  | ok  | ok          | ok 12/3                           | ok         |
| h376   | 480x376 | ok  | ok  | ok          | ok 16/4                           | ok         |
| h376   | 500x376 | ok  | ok  | ok          | ok 16/4                           | ok         |
| h376   | 520x376 | ok  | ok  | ok          | ok 16/4                           | ok         |
| h376   | 540x376 | ok  | ok  | ⚠txt        | ok 16/4                           | ok         |
| h376   | 560x376 | ok  | ok  | ok          | ok 16/4                           | ok         |
| h376   | 580x376 | ok  | ok  | ok          | ok 16/4                           | ok         |
| h376   | 600x376 | ok  | ok  | ok          | ok 20/5                           | ok         |
| h376   | 620x376 | ok  | ok  | ok          | ok 20/5                           | ok         |
| h376   | 640x376 | ok  | ok  | ok          | ok 20/5                           | ok         |
| h376   | 660x376 | ok  | ok  | ok          | ok 20/5                           | ok         |
| h376   | 680x376 | ok  | ok  | ok          | ok 20/5                           | ok         |
| h376   | 700x376 | ok  | ok  | ok          | ok 24/6                           | ok         |
| h376   | 720x376 | ok  | ok  | ok          | ok 24/6                           | ok         |
| w565   | 565x300 | ✗3  | ✗2  | ok          | ok 12/4                           | ok         |
| w565   | 565x310 | ✗3  | ✗2  | ok          | ok 12/4                           | ok         |
| w565   | 565x320 | ok  | ✗2  | ok          | ok 16/4                           | ok         |
| w565   | 565x330 | ok  | ✗2  | ok          | ok 12/4                           | ok         |
| w565   | 565x340 | ok  | ok  | ok          | ok 12/4                           | ok         |
| w565   | 565x350 | ok  | ok  | ok          | ok 12/4                           | ok         |
| w565   | 565x360 | ok  | ok  | ok          | ok 16/4                           | ok         |
| w565   | 565x370 | ok  | ok  | ok          | ok 16/4                           | ok         |
| w565   | 565x380 | ok  | ok  | ok          | ok 16/4                           | ok         |
| w565   | 565x390 | ok  | ok  | ok          | ok 16/4                           | ok         |
| w565   | 565x400 | ok  | ok  | ok          | ok 16/4                           | ok         |
| w565   | 565x410 | ok  | ok  | ok          | ok 12/4                           | ok         |
| w565   | 565x420 | ok  | ok  | ok          | ok 12/4                           | ok         |
| w565   | 565x430 | ok  | ok  | ok          | ok 12/4                           | ok         |
| w565   | 565x440 | ok  | ok  | ok          | ok 12/4                           | ok         |

### Breaking points (from the sweep)

| View                         | Breaks when                                                                                                                                                                                  | Evidence                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Hub                          | height < ≈ 320 px (any width) → bottom dock cut; ≤ 260 the carousel too                                                                                                                      | 3:2 465×310 ✗, 480×320 ok; w565: 310 ✗, 320 ok               |
| TTS (video)                  | height < ≈ 335–345 px (even inside the compact window: 565×330 ✗) **or** width < ≈ 400 at 376 high (380×376 ✗)                                                                               | 3:2 510×340 ✗, 525×350 ok; w565: 330 ✗, 340 ok               |
| Tombola                      | 521 ≤ width < 560 and 321 ≤ height ≤ 400 → list unreachable                                                                                                                                  | 525×350, 540×360, 555×370, 540×376 ⚠; 520×376 and 560×376 ok |
| Soundboard                   | never cut; visible cards: 6 at ≤ 260 high, 9 at 270–310, 12–20 above. **Non-monotonic cliff at 400/401 px of height**: 600×400 shows 20 cards, 615×410 only 12 (leaving the compact profile) | sweep `sbx` column                                           |
| Bonk, Moderation, Historique | never cut in the matrix (only small targets)                                                                                                                                                 | –                                                            |

Zoom reading: at the reference 565×376, browser / Windows zoom 110 % (514×342) already cuts the TTS
pay button; 125 % (452×301) cuts TTS + Hub dock; 150 % (377×251) cuts both and part of the carousel. The
panel (fixed 318 CSS px wide, 496 high) is not affected by zoom (only dpr changes; measured identical at
dpr 1 and 1.5).

## 6. Could not measure / limits

- Real Twitch: iframe sizes for other windows / zoom levels are **computed hypotheses** (§3); only
  521×347, 565×376, 651×434 are measured facts. Antoni's dpr and window size are not recorded anywhere
  in the repo.
- Data states beyond the calibration fixtures (moderator, open Tombola, 69 sounds): viewer role,
  long pseudos, TTS transaction / recap phases, Commands (`commands_public: false` in fixtures),
  Event Shop, Sub Wheel, restriction popups, error banners. A taller state (e.g. "Il te manque …" hint,
  refusal message) can only make #1/#2 worse (hypothesis).
- The legacy Video **Overlay** (dock + 300 px drawer, `overlay.css:23-91`) is not a configured anchor in
  the README; not measured.
- Headless Chromium: no real touch, no OS font scaling / minimum-font-size settings, no Safari/iOS
  (mobile `100vh` vs dynamic toolbar: hypothesis that iOS hides the bottom pay row in TTS/Tombola,
  since those rules use `100vh`, not `100dvh`).
- Visual overlap inside Hub cards (title over the icon at ≤ 342 px high) was seen on screenshots
  (`shots/video-514x342@1.1-hub.png`, `video-378x252@1-hub.png`) but is not counted by the script.
- The Studio Extension Lab was not started (ports 4302 etc. forbidden); its presets were read in code only.
