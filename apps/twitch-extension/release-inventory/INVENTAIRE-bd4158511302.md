# Inventaire de l'emballage de Production — source bd4158511302

Écart : 83 commits de l'extension depuis `PUBLISHED` = `0bf7907` (**présumé, non prouvé**).
Si la version servie n'est pas `0bf7907`, corriger `PUBLISHED` et régénérer cet inventaire.

Préparé par l'agent le 2026-11-13 (Mini-jeux V5). **Non validé** : la ligne de validation appartient à Antoni ; tant
qu'elle manque, l'emballage de Production refuse d'écrire le ZIP (`npm run package:production -- --shell v2`).
Remplace l'inventaire `INVENTAIRE-bb8700814939.md` (78 commits, non validé) : ses commits sont repris ci-dessous,
ceux de Mini-jeux dans la première section. Prérequis côté Core : la livraison Mini-jeux (docs/mini-jeux/LIVRAISON_V5.md).
Sans `random_ban_ext` activé, aucun viewer ne voit Mini-jeux.

## Mini-jeux / Random Ban (catalogue, machine de tirage, Sniper, jauge des charges) — 5

- bd415851 2026-11-13 feat(mini-jeux): Random Ban V5 — fixed prices, personal charges shared by the extension, !rb and channel points
- 53760e2c 2026-11-13 feat(mini-jeux): V4 — carousel draw machine, compact price gauge, availability before the click
- 66cc3b40 2026-11-13 feat(mini-jeux): V3 — Mini-jeux catalog, draw machine, continuous price recovery gauge, arcade identity
- 1cf11d90 2026-11-13 feat(mini-jeux): Random Ban refonte — game screen, in-extension reel, free-text Sniper, Studio moderation
- a407f320 2026-11-13 wip(mini-jeux): Random Ban V2 — progressive price, !rb <montant>, Sniper, Viseur, moderation, extension view

## Déjà inventoriés (archive Hosted Test du 11/11, INVENTAIRE-bb8700814939.md)

- bb870081 2026-11-11 fix(tombola): a new screen's slots are remembered at build — the first read no longer redraws an unchanged list
- 458e3581 2026-11-11 feat(extension): Music purchases findable in the moderation history (track in the row, « Musique » filter); E2E refund once, locked without Portefeuille, Studio opens it
- 58f33889 2026-11-11 test(tombola): E2E 0 → 1 → 6/7 → 29/30/31 → 120 participants, full list, zoom 150 %
- 63e74d73 2026-11-11 fix(extension): tutorial lists only existing commands, no hardcoded prices (!solde, not !jetons; no !cashin / !oracle; TTS price from the buttons)
- 327b44d5 2026-11-11 feat(moderation): one Portefeuille decision for every door; Music Hub rows only for clients that know them
- 04f96a01 2026-11-11 feat(extension): Portefeuille in the moderation, Music Hub refunds, every Tombola participant listed
- 86646df0 2026-11-10 fix(extension): Music Hub supermod controls — the volume behind an explicit speaker, not an ambiguous settings icon; roles E2E
- be9e3b37 2026-11-10 feat(music): the paid skip's progression set in Studio — base price, multiplier, window (defaults 25 000, ×2, 30 min)
- af7d00be 2026-11-10 fix(music): a paid skip or a seek is sold only to a Studio that skips the named track (release 10/11)
- 66a32a2a 2026-11-10 Merge audit/fiabilite-2026-11-09: 15 reliability fixes and the audit report
- 831f8de1 2026-11-09 fix(music): audit 09/11 — moderator skip waits for a paid skip, no paid skip at a track's end, !song v2 Lab-only
- 921fd3d3 2026-11-09 fix(extension): an uncertain TTS send is checked again by the poll, not only on reopening (audit 09/11, P2)
- 572f97eb 2026-11-09 fix(extension): a session reset during a poll reads the whole session again (audit 09/11, P1)
- e0947405 2026-11-09 fix(extension): a purchase re-sent after a lost answer keeps its Idempotency-Key (audit 09/11, P1)
- cafbf807 2026-11-09 feat(music): Music Hub final pass — event overlay (30 s), !song announcement, direct mod controls and seek, paid viewer skip, Open Bar (Lab)
- 3510fd51 2026-11-09 feat(music): OBS music overlays — six archetypes, Studio editor with live preview, variants, show / hide, OBS assistant; history per Daily (Lab)
- 43eb7c4b 2026-11-09 feat(music): live track from Windows SMTC in Studio and the extension, stream music history, Spotify covers fixed (Lab)
- 03bc6288 2026-11-09 feat(spotify): protect the essential calls, adaptive playback watch, local counters; Music Hub on the real catalogue in the Lab (read-only by default)
- 99d43ce0 2026-11-08 feat(music): final « une seule liste » design in the Lab module — curtain search, economics band, « en cours » first, notifications, real evening history
- fa09c884 2026-11-08 fix(extension): Music Hub — « Historique » no longer closes and the focus no longer jumps at each reading
- c9e88a8a 2026-11-08 feat(extension): Music Hub V2 — search-first module, slim « en cours » strip, supermods' player panel
- faed5461 2026-11-08 feat(music): Music Hub, Studio page + Lab E2E — extension settings, player controls, payment per request
- 8f91e500 2026-11-08 feat(extension): Music Hub module (shell v2) on the existing Spotify V2 queue — Lab only
- 2e0777a6 2026-11-08 fix(extension): no hit area on the Soundboard search field — it took the « Effacer » button's click
- e97ca86b 2026-11-08 feat(extension): compare legacy and v2 side by side with one double-click (local data, no service reached)
- 1536c8b9 2026-11-08 feat(extension): a new v2 module plugs in with its own files only — Lab demo module proves it
- 5e8a1dc7 2026-11-08 fix(extension): v2 hit areas — 200 small targets down to 19, no enlarged zone over another control
- 44f86c22 2026-11-08 feat(extension): v2 follows the composition scale in JS too; minimum hit areas; Lab can serve the v2 shell; SOCLE.md
- a3158d5a 2026-11-08 feat(extension): socle step 2 — v2 shell runs on its own entry, panel and sheets: scales, text floors, box media queries, views on demand
- 7da34a69 2026-11-08 feat(extension): socle step 1 — app/boot.js chooses the shell (legacy default, v2 opt-in), one layout measurement, v2 sheets = live rules only
- d021b479 2026-11-08 Merge feat/extension-next-packaging: locked packaging (lot 0)
- c322de00 2026-11-08 fix(extension): lot 1 — TTS payment, Hub bottom bar, Tombola participants and mobile TTS never cut; safety net
- 2f809683 2026-11-08 fix(extension): grey-screen guard — recoverable error when the Twitch helper or onAuthorized never comes
- dac6f74a 2026-11-08 feat(extension): locked packaging — one package.mjs with frozen targets, unconfigured source, runtime guard, production inventory gate (lot 0)
- 7a907dd6 2026-11-06 feat(lab): functional parity on the real Core: every E2E spec runs on the main Core in Lab mode
- 9443ac10 2026-11-05 refactor(extension): the header wallet reads the open module's declared payment — ui.js names no paid module
- b27da6e7 2026-11-05 refactor(extension): moderation V1 is a module variant in its own file; its user history drawer closes on Escape again
- 2ad1bb11 2026-11-05 refactor(extension): Tombola V1 is a module variant in its own file — ui.js keeps no raffle timer, drawer or join state
- 6e0e4ae4 2026-11-05 refactor(extension): TTS V1 is a module variant in its own file — V1 parity E2E in demo mode (TTS, Tombola, moderation)
- dccec77f 2026-11-05 fix(extension): independent review of the Soundboard / Bonk frontiers — Escape stays in the panel, no orphan view
- 9a2c5046 2026-11-05 refactor(extension): the Bonk screen is a module variant in its own file — ui.js no longer knows Bonk
- ae85b0c7 2026-11-05 refactor(extension): access to the viewer's Twitch emotes out of ui.js (emote-access.js, a panel-level service)
- d1639445 2026-11-05 test(e2e)+fix: deterministic Bonk Lab scenario (fictional Twitch, price, delay, narrow screens) — 3 defects fixed
- 9c45e910 2026-11-05 refactor(extension): the Soundboard is a module variant in its own file — ui.js no longer knows it (+3 mouse defects fixed)
- d3e564a9 2026-11-05 fix(extension): independent review — a Bonk in flight when leaving no longer comes back; stronger tests; browser network guard
- 725df10a 2026-11-05 refactor(extension): Bonk sending and its outcome out of ui.js (bonk-send.js owns requests in flight, message, slot)
- c9608944 2026-11-05 fix(extension): Bonk no longer shows the previous visit's last outcome on return
- 208791e5 2026-11-05 refactor(extension): the Soundboard drawn on screen is ONE mount it owns (lifecycle) + 2 volume defects fixed
- 7cc951b0 2026-11-05 refactor(extension): Soundboard send feedback out of ui.js (soundboard-feedback.js owns its outcome and timer)
- 295e59c3 2026-11-05 refactor(extension): Soundboard local preview out of ui.js (soundboard-preview.js owns its audio, sound and volume)
- 480ee5cc 2026-11-05 test(e2e): deterministic TTS live-update chain — settled-screen signal, fictional players settle what they are handed
- 2d9f7b25 2026-11-05 refactor(extension): the D4 console leaves ui.js (module variant); fix a blank screen for moderators on TTS V2 / Tombola V2
- 602401a7 2026-11-05 fix(extension): « Voir tous les modules » no longer closes under the viewer when a new state arrives
- 50e8601a 2026-11-05 refactor(extension): TTS V2 and Tombola V2 leave ui.js — module variants with their own live update (onState)
- 8a2f1137 2026-11-05 refactor(extension): session modules register themselves — Commandes, Roue du Sub and Événements leave ui.js
- 104acb7d 2026-11-05 feat(extension): the D4 moderation console shows the host's modules — same panels and API as under each module
- 77e614d3 2026-11-05 fix(modules): consolidation after an independent review — cockpit purchase forgery, self-refund, price change, player claims
- dbb17984 2026-11-05 fix(studio,extension): seen in a real browser — the preview stack wires the relay chain; house payment button; reasons of an off module
- 8ef29124 2026-11-05 feat(modules): the team moderates host modules from the extension; fix the Lab allow-list that refused settings and the host
- 8a2d8623 2026-11-05 feat(extension): the module host in the extension — one door shared by Production and the Lab, a registry, purchase per intent
- f9e9724e 2026-11-05 feat(economy): H1 paid stream interactions only during the canonical live — refused before any debit
- e9446708 2026-11-05 feat(extension): H15 hide « Annoncer mes Level Up » while nothing reads it
- 9e1e3fa2 2026-11-05 fix(economy): P0-2 one Wallet write per intent — Moderation « Créditer / Débiter » and Boutique « Donner »
- ab0560f3 2026-10-31 fix(extension): « Titres » — a title's full name wraps instead of « … » (panel 318 px)
- 423623cd 2026-10-30 fix(extension): no raptoru.fr in the extension package (production build guard)
- c0e3b284 2026-10-30 feat(halloween): « Titres » in the Événements module — the cosmetic shop's titles bought with Bonbons
- b13d46f0 2026-10-30 feat(halloween): Bonbons economy (presence, Prime/resub, Bits, donations) and alert variants per family
- 2f322bf6 2026-10-30 feat(halloween): Halloween alert profile (Miss Minute, Ballon, Jerry) and screamer catalogue cleanup
- 63c17a98 2026-10-30 feat(halloween): Chaos « Écran retourné » and « Flou », Miss Minute and 7 more media, new items seeded disabled
- bce49e90 2026-10-28 style(halloween): « Événements » in dark burgundy, burnt orange and amber; a bat instead of the pumpkin
- c2c5b462 2026-10-28 feat(halloween): D4 rules on purchases (Pause Raptoru, block everywhere), Studio « Trouver un viewer », safe manual credit
- ffe81848 2026-10-28 fix(halloween): « Événements » scrolls in the 565×376 video component; section tabs stay at the top
- b0884a87 2026-10-28 feat(halloween): stable Lab panel, temporary event (controlled closing), !solde with Bonbons, « Événements » module
- d27a7419 2026-10-28 fix(halloween): Lab purchase path — no lost taps, visible feedback, explicit connection states
- a126492f 2026-10-28 feat(halloween): « Halloween » shop in the extension — façades, Hub module, thumbnails
- 473ad0b4 2026-10-28 feat(halloween): Studio overlay engine — transparent click-through window, screamer videos, drawn effects, STOP ALL
- 05e19a44 2026-10-26 feat(sub-wheel): autonomous recovery of wheels never shown, « À vérifier » for wheels perhaps seen, pseudo everywhere
- 4848b5f5 2026-10-25 feat(sub-wheel): Roue du Sub V2 (R1–R9) integrated on origin/main — production kept, chat origins safe
