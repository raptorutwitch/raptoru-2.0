# Bonk overlay renderer

`bonk-v3-core.js` is copied byte-for-byte from the user-authorized canonical legacy source:
`C:/Users/Antoni/Documents/Raptoru/CANONICAL_WORKSPACE/extension/viewer/bonk-v3-core.js`.

SHA-256: `329F540164004CBEBCA32183DDFC6934FDC9C447869F9F8234A89A01207B1C0D`.

It stays unchanged. Since Bonk VNext lot 1 the renderer only imports its seeded random generator
(`seedFromReference`, `createSeededRandom`); its physics (`buildBonkTrajectory`) was ported and
generalised into `engine/physics.js` (same gravity, 16 ms step, wall bounces, ground hold and roll,
« fall » / « shrink » exits).

`overlay.js` keeps the transport (poll `next`, renderer ACKs `started` / `completed` / `failed`, URL
allow-list, simulated payment only) and wires the engine (`engine/`):

- `size.js`: sizes around 140 px (80 % within ±10 px, 94 % within ±20 px);
- `target.js`: impact point around the current target (Manuel zone, Auto camera box, or Fullscreen),
  categories rim 45 % / inside 22 % / graze 30 % / centre 3 % (Fullscreen: always « glass »),
  anti-clustering — every projectile physically hits the target (no flying through or past it);
- `families.js`, `presets.js`, `physics.js`, `plan.js`: weighted trajectory families, common impact
  presets, bounce strength strong / normal / weak (edge contacts always leave outwards), everything
  seeded by the interaction id;
- `density.js`, `scene.js`: one requestAnimationFrame loop, density limits (soft 18, hard 30);
- `impact-fx.js`: the historical impact FX of the legacy overlay (streaks, particles, 30 % with its wave), CSS in
  `overlay.css` (lot 6);
- `combo.js`: multi-viewer combo (distinct viewers among the Bonks played, 5 s window) and the size of its giant
  finisher, played by the same scene (`plan.js` mass profile) (lot 6);
- `audio.js`: adaptive impact sound (existing extension sounds `punch-2…6`, `roblox-oof`).

The target comes from the Studio settings (`/bonk-lab/renderer/config`, re-read right before each
shot): Manuel zone, Fullscreen, or the Auto camera found in the OBS program scene (`src/bonk-lab/obs-scene.ts`,
`obs-auto.ts`), the Manuel zone when Auto has none.

The Studio « Tester » preview (`/bonk-lab/renderer/preview`) is drawn by the same scene, but is
renderer-only: no Core, no wallet, no delivery journal, no ACK.

Status, validated rules (sizes, sounds, physics — not to be changed without Antoni's decision) and
next lots (Salves, then rare FX): `docs/BONK_VNEXT_AUDIT_2026-10.md` § 0.
