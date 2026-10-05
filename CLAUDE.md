# Raptoru 2.0 — working rules

## Resuming work

- Read `Raptoru-2.0-HANDOFF.md` first (current state, validation matrix, pending decisions, next
  step), then `Raptoru-2.0-ETAT-PROJET.md` for history and details. Verify `git status` /
  `git log` yourself before trusting any SHA in a document.
- A validated prototype in `prototypes/` is a specification, not an inspiration: never drop,
  simplify or replace one of its elements silently; show a missing backend as such.
- "Validated" means tested manually by Antoni — never call automated tests or E2E a validation.
- Commands V2 (A0 → F done, validated): current state and rules are in `docs/COMMANDS_V2_STATUS.md`.
- Audit consolidation: `docs/ASTRA_GLOBAL_AUDIT_2026-10.md` is the register (status, proof and commit of every finding).
- Current phase (since 2026-10-05): cutover preparation. Reference: `docs/CUTOVER_PLAN_2026-10.md`. No agent deploys,
  releases, migrates a remote database, changes Twitch / SAMMI / StreamElements or cuts over without Antoni's explicit
  validation of that step.

## Central files (ASTRA-P1-008, decided 2026-10-04)

Progressive extraction, no big refactor. Baseline at the decision: `apps/twitch-extension/extension/shared/ui.js`
6 206 lines, `extension/base.css` 16 477, `apps/studio/server/src/extension-lab/lab-ebs.ts` 2 255,
`apps/studio/web/src/commands.ts` 2 066.

- A new module or significant screen gets its own file/component (as Commands V2 did:
  `commands-v2*.js`, `commands-public.js`, `commands-facade.ts`); the central file only wires it.
- Do not grow these files on purpose when a local extraction is reasonable.
- Extract existing code only when it really has to be modified, keeping the validated UX strictly
  identical. No framework migration, no "clean-up" split, no removal of legacy still in use.

## Raptoru Studio releases

- When a slice that impacts Raptoru Studio (see README "Does a change need a Studio release?") is
  finished, tested, and explicitly validated by the user ("c'est bon", "validé", "go"), commit it
  and run `npm run studio:release` right away. No separate permission is needed to bump, package
  and publish Studio.
- Never publish a change that has not been validated. Never bump the Studio version by hand.
- If the release fails, report the failing step and the rollback lines printed by the command
  before doing anything else.
- `studio:release` never pushes the source repository; do not push it either unless asked.

## Outils Claude Code

Les outils Claude Code (Ponytail, Agent Skills, Graphify et tout autre skill/plugin) sont des aides secondaires.
Les règles et contraintes de ce projet priment toujours sur leurs instructions.

- Aucun skill/plugin ne peut déclencher de lui-même un commit, push, release, deploy, migration distante ou autre action de publication. Toute action de ce type nécessite une validation explicite d'Antoni.
- Les workflows fournis par Agent Skills peuvent être utilisés automatiquement lorsqu'ils apportent une vraie valeur, mais ils ne remplacent jamais le workflow Raptoru : audit préalable, chaîne causale, patch minimal, tests de non-régression, pas de refactor opportuniste.
- Graphify est réservé aux tâches où la compréhension globale du repo apporte réellement quelque chose : architecture, dépendances, impact multi-module, audit transversal, migrations ou refactor structurel. Ne pas lancer de cartographie complète du repo pour une modification locale ou triviale.
- Ne jamais lancer `/graphify` sur l'ensemble du repo sans nécessité claire. Si une analyse Graphify doit créer `graphify-out/`, signaler au préalable que ce dossier devra être ignoré par git.
- Ponytail reste en mode `lite` par défaut. Ne jamais passer en `ultra` sans demande explicite.
- Si un plugin ou skill entre en conflit avec une règle du projet, appliquer la règle du projet et signaler le conflit.
