# Bonk V2 — local vertical slice awaiting OBS validation

> **Historique** : ce document décrit la tranche locale avant sa validation. Bonk V2 a depuis été validé
> manuellement (27/09/2026, Studio 0.1.3). État courant : `Raptoru-2.0-HANDOFF.md`.

The Core/contract checkpoint already existed on disk as `3665773`. Review corrections were
committed separately as `760cd5e`: claimant-specific readiness, expiration before queue capacity
checks, session/glyph idempotency conflicts, and shared channel locking for ACK/expiry transitions.
The original fix (read delivery in a new SQL statement after locking) is preserved.

## Run for visual validation

From the canonical repository, with the existing local PostgreSQL container running:

```powershell
npm run bonk:lab
```

Open [the local Lab](http://127.0.0.1:4101/?tab=extension-lab).

1. In the **Bonk OBS Lab** card, enter the local OBS WebSocket port (usually 4455) and password.
   The password is not persisted. Click **Connecter OBS local**.
2. In an OBS test scene, add a Browser Source named exactly **Raptoru Bonk Lab**, width 1920,
   height 1080. Paste the URL shown by Studio, including its fragment. Keep it active. Do not add
   it to the production scene. The code never changes scenes, creates sources, or starts streaming.
3. Wait for **Prêt**. Use the actual extension picker to select 😀 and click BONK.
4. Verify movement, impact, sound, rebound and disappearance. The Lab history must progress from
   queued to executing to completed. Then test a rapid series of clicks.
5. Disconnect OBS or deactivate the source and verify that new admissions are refused once the
   readiness heartbeat reflects the change. Stop the launcher with Ctrl+C when finished.

This is a source checkout run, not the installed Studio version. No installer, release or push
is needed or performed. The usual Studio on port 4100 and usual Core on 3000 are not adopted,
stopped or restarted by this launcher. Service controls in this dedicated Lab are disabled.

## Isolation

- Dedicated PostgreSQL database **raptoru_bonk_lab**, local host only. The launcher reads local
  connection credentials server-side, replaces the database name, and applies **only the Bonk
  migration**. It does not migrate or modify the normal `raptoru` database.
- Dedicated Core on `127.0.0.1:4301`: only authenticated `/v1/lab/bonk/*` routes. No Wallet,
  Loyalty, Daily or bot timers. Separate ephemeral service secret, never sent to the UI.
- Dedicated Studio on `127.0.0.1:4101`. OBS connection uses loopback only. The OBS adapter issues
  only `GetInputSettings` and `GetSourceActive`, in addition to protocol identification.
- The extension frontend is unchanged on disk. Lab serving substitutes the Unicode catalog with
  one emoji. Only Bonk calls are sent to Core. Other Extension Lab simulations remain local.
- Payment is a **simulated cost snapshot** (200 `jetons_lab`, real debit 0), not a balance-spending
  simulator. Neither the fictitious EBS wallet nor the real Wallet is debited for these Bonks.
- No stats, achievements or progression are emitted. Interaction history is technical Lab data.
- The renderer assets are bundled by the staging script for future packaging, but no release was
  made. Current launcher is a developer command; installed-app activation is outside this slice.

## Delivery semantics

One click is one persistent interaction. Core assigns admission order. Studio claims the next
interaction only once the previous start is acknowledged; animations can overlap. The local
journal is stored in `apps/studio/server/.runtime/bonk-lab/journal.json`, ignored by Git.

Studio persists `sent` before responding to a renderer poll. An ambiguous lost command response
is never replayed: it ends as `execution_unknown`. Renderer ACKs are durably journaled before
HTTP success and forwarded in order. A restart resends known ACKs, not visuals. Core and Studio
bound the active queue; settled local entries are removed, while authoritative Core history remains.
Core retains Lab interactions indefinitely in this first slice (no automatic destructive purge).

`started` follows animation startup, and `completed` follows `animation.finished`. OBS source
readiness is checked separately; this is not proof of pixels in the audience's stream. A renderer
reload or process crash without terminal proof is reported as unknown. A failed asset produces
`failed`. Source readiness polling and heartbeat imply a short detection window for disconnects.

The legacy trajectory engine is preserved byte-for-byte; see its adjacent README for provenance.
The new transport and minimal impact wrapper need visual validation. Combos, other emotes,
camera bounds discovery and real economy are deliberately outside this slice.

## Verification

- Initial checkpoint reproduced: 10 PGlite tests and 7 real PostgreSQL tests, including three Core
  instances, 30 duplicate submissions and concurrent started ACKs.
- Corrected Core: 13 PGlite tests; the same 7 real PostgreSQL tests pass.
- New Studio integration tests use real Core HTTP + PGlite and a durable journal: actual extension
  payload, 20 ordered interactions from two viewers, retries, no local fake debit, no legacy stage
  event, lost ACK responses, restart ambiguity, renderer failures and zero economic/domain rows.
- OBS protocol is tested with a simulated WebSocket peer. No live OBS visual result is claimed.

The full repository format check still excludes `Raptoru-2.0-ETAT-PROJET.md` at invocation time;
that untracked continuity document was not changed. No production flags, secrets, legacy runtime,
SAMMI, StreamElements or deployed services were modified.
