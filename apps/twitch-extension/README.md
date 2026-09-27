# Raptoru Live — Twitch extension

`extension/` started as the production extension, imported unchanged from the package currently
published on Twitch, and is now the source of the next upload (first change: Bonk picker V2,
`shared/emote-picker.js` + `picker.css`):

- source: `raptoru-live-production-20260920-095259Z-consolidated-final.zip`
  (sha256 `ea20acd07acafb39d78d06abce357d0922f10388b260975d2f161ce8c4c1bfe3`, 2014 files);
- static HTML/CSS/ES modules, no bundler;
- it still talks to the current production EBS (`shared/runtime-config.js` → `https://raptoru.fr/api`).
  Branching it to the new Core is a later slice.

Twitch console settings (asset hosting): panel `panel.html` (height 496), mobile `mobile.html`,
video component `video_component.html` (target height 60 %, ratio 3:2, autoscale off, pixel
scale 1024), config and live config `config.html`.

## Commands

```sh
npm run build -w @raptoru/twitch-extension   # dist/ = upload package (checks entry points and production config)
npm test -w @raptoru/twitch-extension        # pure logic of shared/emote-picker.js (search, sections, grid)
```

## Local testing: Raptoru Studio → Extension Lab

The Studio serves `extension/` as is, with two substitutions made **while serving** (never in
these files):

- the Twitch helper script is replaced by a local simulation of `window.Twitch.ext`
  (role, identity, context, broadcast);
- `shared/runtime-config.js` points to the Studio's local Lab EBS (fictitious jetons, no
  StreamElements, no SAMMI, no Core Wallet). The lab pages' CSP only allows the Studio origin,
  so a lab frame cannot reach the production EBS.

Do not edit `extension/` for the lab: what is tested locally must be what is uploaded.
