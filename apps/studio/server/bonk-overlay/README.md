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
- `target.js`: fixed target zone 480 × 300 around (960, 400) in this lot, impact categories (rim,
  traverse, graze, offset, rare centre), anti-clustering;
- `families.js`, `presets.js`, `physics.js`, `plan.js`: weighted trajectory families, common impact
  presets, everything seeded by the interaction id;
- `density.js`, `scene.js`: one requestAnimationFrame loop, density limits (soft 18, hard 30), puff;
- `audio.js`: adaptive impact sound (existing extension sounds `punch-2…6`, `roblox-oof`).

The Studio « Tester » preview (`/bonk-lab/renderer/preview`) is drawn by the same scene, but is
renderer-only: no Core, no wallet, no delivery journal, no ACK.

Target modes (Manuel / Fullscreen, then Auto OBS), Salves, rare FX and combos are later lots
(`docs/BONK_VNEXT_AUDIT_2026-10.md`).
