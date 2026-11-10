# Inventaire de l'emballage de Production — source af7d00be51d5

Écart : 70 commits de l'extension depuis `PUBLISHED` = `0bf7907` (**présumé, non prouvé**).
Si la version servie n'est pas `0bf7907`, corriger `PUBLISHED` et régénérer cet inventaire.

Préparé par l'agent le 2026-11-10. La ligne de validation appartient à Antoni : elle a été ajoutée en fin de fichier sur sa réponse,
sous la forme exacte attendue par l'emballage.

## Music Hub (module du shell v2 ; fermé en Production par le Core) — 11

- af7d00b 2026-11-10 fix(music): a paid skip or a seek is sold only to a Studio that skips the named track (release 10/11)
- 831f8de 2026-11-09 fix(music): audit 09/11 — moderator skip waits for a paid skip, no paid skip at a track's end, !song v2 Lab-only
- cafbf80 2026-11-09 feat(music): Music Hub final pass — event overlay (30 s), !song announcement, direct mod controls and seek, paid viewer skip, Open Bar (Lab)
- 3510fd5 2026-11-09 feat(music): OBS music overlays — six archetypes, Studio editor with live preview, variants, show / hide, OBS assistant; history per Daily (Lab)
- 43eb7c4 2026-11-09 feat(music): live track from Windows SMTC in Studio and the extension, stream music history, Spotify covers fixed (Lab)
- 03bc628 2026-11-09 feat(spotify): protect the essential calls, adaptive playback watch, local counters; Music Hub on the real catalogue in the Lab (read-only by default)
- 99d43ce 2026-11-08 feat(music): final « une seule liste » design in the Lab module — curtain search, economics band, « en cours » first, notifications, real evening history
- fa09c88 2026-11-08 fix(extension): Music Hub — « Historique » no longer closes and the focus no longer jumps at each reading
- c9e88a8 2026-11-08 feat(extension): Music Hub V2 — search-first module, slim « en cours » strip, supermods' player panel
- faed546 2026-11-08 feat(music): Music Hub, Studio page + Lab E2E — extension settings, player controls, payment per request
- 8f91e50 2026-11-08 feat(extension): Music Hub module (shell v2) on the existing Spotify V2 queue — Lab only

## Audit de fiabilité du 09/11 (double débit, session, TTS) — 4

- 66a32a2 2026-11-10 Merge audit/fiabilite-2026-11-09: 15 reliability fixes and the audit report
- 921fd3d 2026-11-09 fix(extension): an uncertain TTS send is checked again by the poll, not only on reopening (audit 09/11, P2)
- 572f97e 2026-11-09 fix(extension): a session reset during a poll reads the whole session again (audit 09/11, P1)
- e094740 2026-11-09 fix(extension): a purchase re-sent after a lost answer keeps its Idempotency-Key (audit 09/11, P1)

## Extension Next (socle v2, emballage verrouillé, lot 1, écran gris) — 13

- 2e0777a 2026-11-08 fix(extension): no hit area on the Soundboard search field — it took the « Effacer » button's click
- e97ca86 2026-11-08 feat(extension): compare legacy and v2 side by side with one double-click (local data, no service reached)
- 1536c8b 2026-11-08 feat(extension): a new v2 module plugs in with its own files only — Lab demo module proves it
- 5e8a1dc 2026-11-08 fix(extension): v2 hit areas — 200 small targets down to 19, no enlarged zone over another control
- 44f86c2 2026-11-08 feat(extension): v2 follows the composition scale in JS too; minimum hit areas; Lab can serve the v2 shell; SOCLE.md
- a3158d5 2026-11-08 feat(extension): socle step 2 — v2 shell runs on its own entry, panel and sheets: scales, text floors, box media queries, views on demand
- 7da34a6 2026-11-08 feat(extension): socle step 1 — app/boot.js chooses the shell (legacy default, v2 opt-in), one layout measurement, v2 sheets = live rules only
- d021b47 2026-11-08 Merge feat/extension-next-packaging: locked packaging (lot 0)
- c322de0 2026-11-08 fix(extension): lot 1 — TTS payment, Hub bottom bar, Tombola participants and mobile TTS never cut; safety net
- 2f80968 2026-11-08 fix(extension): grey-screen guard — recoverable error when the Twitch helper or onAuthorized never comes
- dac6f74 2026-11-08 feat(extension): locked packaging — one package.mjs with frozen targets, unconfigured source, runtime guard, production inventory gate (lot 0)
- 2d9f7b2 2026-11-05 refactor(extension): the D4 console leaves ui.js (module variant); fix a blank screen for moderators on TTS V2 / Tombola V2
- 50e8601 2026-11-05 refactor(extension): TTS V2 and Tombola V2 leave ui.js — module variants with their own live update (onState)

## Extraction des modules hors de ui.js, hôte de modules, économie (05–06/11) — 29

- 7a907dd 2026-11-06 feat(lab): functional parity on the real Core: every E2E spec runs on the main Core in Lab mode
- 9443ac1 2026-11-05 refactor(extension): the header wallet reads the open module's declared payment — ui.js names no paid module
- b27da6e 2026-11-05 refactor(extension): moderation V1 is a module variant in its own file; its user history drawer closes on Escape again
- 2ad1bb1 2026-11-05 refactor(extension): Tombola V1 is a module variant in its own file — ui.js keeps no raffle timer, drawer or join state
- 6e0e4ae 2026-11-05 refactor(extension): TTS V1 is a module variant in its own file — V1 parity E2E in demo mode (TTS, Tombola, moderation)
- dccec77 2026-11-05 fix(extension): independent review of the Soundboard / Bonk frontiers — Escape stays in the panel, no orphan view
- 9a2c504 2026-11-05 refactor(extension): the Bonk screen is a module variant in its own file — ui.js no longer knows Bonk
- ae85b0c 2026-11-05 refactor(extension): access to the viewer's Twitch emotes out of ui.js (emote-access.js, a panel-level service)
- d163944 2026-11-05 test(e2e)+fix: deterministic Bonk Lab scenario (fictional Twitch, price, delay, narrow screens) — 3 defects fixed
- 9c45e91 2026-11-05 refactor(extension): the Soundboard is a module variant in its own file — ui.js no longer knows it (+3 mouse defects fixed)
- d3e564a 2026-11-05 fix(extension): independent review — a Bonk in flight when leaving no longer comes back; stronger tests; browser network guard
- 725df10 2026-11-05 refactor(extension): Bonk sending and its outcome out of ui.js (bonk-send.js owns requests in flight, message, slot)
- c960894 2026-11-05 fix(extension): Bonk no longer shows the previous visit's last outcome on return
- 208791e 2026-11-05 refactor(extension): the Soundboard drawn on screen is ONE mount it owns (lifecycle) + 2 volume defects fixed
- 7cc951b 2026-11-05 refactor(extension): Soundboard send feedback out of ui.js (soundboard-feedback.js owns its outcome and timer)
- 295e59c 2026-11-05 refactor(extension): Soundboard local preview out of ui.js (soundboard-preview.js owns its audio, sound and volume)
- 480ee5c 2026-11-05 test(e2e): deterministic TTS live-update chain — settled-screen signal, fictional players settle what they are handed
- 602401a 2026-11-05 fix(extension): « Voir tous les modules » no longer closes under the viewer when a new state arrives
- 8a2f113 2026-11-05 refactor(extension): session modules register themselves — Commandes, Roue du Sub and Événements leave ui.js
- 104acb7 2026-11-05 feat(extension): the D4 moderation console shows the host's modules — same panels and API as under each module
- 77e614d 2026-11-05 fix(modules): consolidation after an independent review — cockpit purchase forgery, self-refund, price change, player claims
- dbb1798 2026-11-05 fix(studio,extension): seen in a real browser — the preview stack wires the relay chain; house payment button; reasons of an off module
- 8ef2912 2026-11-05 feat(modules): the team moderates host modules from the extension; fix the Lab allow-list that refused settings and the host
- 8a2d862 2026-11-05 feat(extension): the module host in the extension — one door shared by Production and the Lab, a registry, purchase per intent
- f9e9724 2026-11-05 feat(economy): H1 paid stream interactions only during the canonical live — refused before any debit
- e944670 2026-11-05 feat(extension): H15 hide « Annoncer mes Level Up » while nothing reads it
- 9e1e3fa 2026-11-05 fix(economy): P0-2 one Wallet write per intent — Moderation « Créditer / Débiter » and Boutique « Donner »
- ab0560f 2026-10-31 fix(extension): « Titres » — a title's full name wraps instead of « … » (panel 318 px)
- 423623c 2026-10-30 fix(extension): no legacy site URL in the extension package (production build guard)

## Halloween et boutique « Événements » (événement clos ; module masqué hors événement) — 11

- c0e3b28 2026-10-30 feat(halloween): « Titres » in the Événements module — the cosmetic shop's titles bought with Bonbons
- b13d46f 2026-10-30 feat(halloween): Bonbons economy (presence, Prime/resub, Bits, donations) and alert variants per family
- 2f322bf 2026-10-30 feat(halloween): Halloween alert profile (Miss Minute, Ballon, Jerry) and screamer catalogue cleanup
- 63c17a9 2026-10-30 feat(halloween): Chaos « Écran retourné » and « Flou », Miss Minute and 7 more media, new items seeded disabled
- bce49e9 2026-10-28 style(halloween): « Événements » in dark burgundy, burnt orange and amber; a bat instead of the pumpkin
- c2c5b46 2026-10-28 feat(halloween): D4 rules on purchases (Pause Raptoru, block everywhere), Studio « Trouver un viewer », safe manual credit
- ffe8184 2026-10-28 fix(halloween): « Événements » scrolls in the 565×376 video component; section tabs stay at the top
- b0884a8 2026-10-28 feat(halloween): stable Lab panel, temporary event (controlled closing), !solde with Bonbons, « Événements » module
- d27a741 2026-10-28 fix(halloween): Lab purchase path — no lost taps, visible feedback, explicit connection states
- a126492 2026-10-28 feat(halloween): « Halloween » shop in the extension — façades, Hub module, thumbnails
- 473ad0b 2026-10-28 feat(halloween): Studio overlay engine — transparent click-through window, screamer videos, drawn effects, STOP ALL

## Roue du Sub V2 — 2

- 05e19a4 2026-10-26 feat(sub-wheel): autonomous recovery of wheels never shown, « À vérifier » for wheels perhaps seen, pseudo everywhere
- 4848b5f 2026-10-25 feat(sub-wheel): Roue du Sub V2 (R1–R9) integrated on origin/main — production kept, chat origins safe

Validation donnée par Antoni le 10/11/2026 (réponse explicite à l'agent, mission « GO officiel Music Hub », Hosted Test) :

Validé par Antoni : oui
