# Bonk Lab renderer provenance

`bonk-v3-core.js` is copied byte-for-byte from the user-authorized canonical legacy source:
`C:/Users/Antoni/Documents/Raptoru/CANONICAL_WORKSPACE/extension/viewer/bonk-v3-core.js`.

SHA-256: `329F540164004CBEBCA32183DDFC6934FDC9C447869F9F8234A89A01207B1C0D`.

The new `overlay.js` uses `buildBonkTrajectory` for the existing physics. It replaces the legacy
transport with local Studio commands and renderer ACKs. It does not import SAMMI, catalog network
calls, payment or progression. Combos/Giga are not enabled in this slice. The sound is the existing
extension asset `punch-2.mp3`; the emoji is the existing Twemoji `1f600.svg` (its license remains in
the imported extension assets). The impact ring is a minimal Lab visual, pending user validation.

The fixed canvas is 1920 × 1080, impact at (960, 400), projectile size 150. Camera auto-discovery,
multiple providers, configurable position, renderer styling parity and combos are later slices.
