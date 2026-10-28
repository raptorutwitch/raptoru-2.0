# Raptoru 2.0 — working rules

## Resuming work

- Start with `docs/REPRISE.md` (entry point: state, versions, work in progress, next action) and
  `git status`. Reference documents: `docs/ROADMAP.md` (every module's state, arbitrations),
  `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/BACKUPS.md`; they are on `origin/main` (the main
  checkout is behind: read them in an up-to-date worktree or with `git show origin/main:<path>`, see REPRISE § 1). `Raptoru-2.0-HANDOFF.md` and `Raptoru-2.0-ETAT-PROJET.md` are frozen history:
  open them only for the section a task needs. Verify `git status` / `git log` yourself before
  trusting any SHA in a document.
- Keep `docs/REPRISE.md` current and short at each milestone and before stopping (precise enough to
  resume after an interruption); dated details go to a journal under `docs/archive/`. Do not redo an
  analysis it records unless the code changed since.
- A validated prototype in `prototypes/` is a specification, not an inspiration: never drop,
  simplify or replace one of its elements silently; show a missing backend as such.
- "Validated" means tested manually by Antoni — never call automated tests or E2E a validation.
- Commands V2 (A0 → F done, validated): current state and rules are in `docs/COMMANDS_V2_STATUS.md`.
- Audit consolidation: `docs/ASTRA_GLOBAL_AUDIT_2026-10.md` is the register (status, proof and commit of every finding).
- Current phase: Production live since the 2026-10-20 cutover (Core + bot on Coolify/VPS, Studio on
  the PC; SAMMI abandoned, never re-enable it). No agent pushes, deploys, releases, migrates a remote
  database, changes flags/variables, restarts a service, installs Studio, touches OBS / Twitch /
  StreamElements or the Wallet without Antoni's explicit GO for that step.
- The installed Studio uses this checkout as its data folder (`.env`, Twitch tokens,
  `apps/studio/server/.runtime`): never `git clean`, `reset --hard` or `checkout .` here.

## Workspace (decided 2026-10-28)

One project, one repository: `Documents\Raptoru 2.0` (main checkout and the installed Studio's data folder). Inventory,
target layout and the post-Halloween cleanup plan: `docs/WORKSPACE.md`.

- Never clone Raptoru 2.0 again and never create a Raptoru folder at the root of `Documents`. A task, a build or a
  check uses a worktree: `git worktree add "..\Raptoru 2.0 - Worktrees\<name>" -b <branch> origin/main` — never under
  `AppData\Local\Temp`, an agent's job or scratchpad folder, or `.claude\worktrees`.
- Delivery packages (installers, SQL, runbooks) go to `Documents\Raptoru 2.0 - Livraisons\<YYYY-MM-DD>-<subject>\`,
  backups to `Documents\Sauvegarde Raptoru 2.0\<YYYY-MM-DD>-<subject>\` — no `*-GO` or `*-backup-*` folder at the root.
- Studio data (`.env`, tokens, `.runtime`, media) live only in the main checkout; a worktree's `.runtime` is disposable.
- A worktree is removed with `git worktree remove` (moved with `git worktree move`) only once merged, delivered and
  clean, its uncommitted work archived first; never `rm -rf`. No mass move or deletion without Antoni's GO.

## Central files (ASTRA-P1-008, decided 2026-10-04)

Progressive extraction, no big refactor. Baseline at the decision: `apps/twitch-extension/extension/shared/ui.js`
6 206 lines, `extension/base.css` 16 477, `apps/studio/server/src/extension-lab/lab-ebs.ts` 2 255,
`apps/studio/web/src/commands.ts` 2 066.

- A new module or significant screen gets its own file/component (as Commands V2 did:
  `commands-v2*.js`, `commands-public.js`, `commands-facade.ts`); the central file only wires it.
- Do not grow these files on purpose when a local extraction is reasonable.
- Extract existing code only when it really has to be modified, keeping the validated UX strictly
  identical. No framework migration, no "clean-up" split, no removal of legacy still in use.

## Workflow (decided 2026-10-21)

- Deliver vertical features (Core, routes, Studio/extension, tests) up to a milestone usable in the
  Lab; do not stop between interdependent sub-lots when the information to continue is available.
- Take ordinary technical decisions and fix local problems alone. Interrupt Antoni only for an
  undefined business decision, an unsolvable blocker, an action that could affect Production, or a
  major risk needing arbitration.
- The Lab must test features end to end without Twitch, OBS or Production services: explicit,
  isolated local simulators when external data is needed.
- During development: typecheck and tests targeted at what changed; no global suite after each small
  change. Whenever Jetons, rights, access or transactions are touched: concurrency, idempotence and
  permission tests (real PostgreSQL when locks matter) — never weakened to go faster.
- Before delivery: relevant global suites and integration, lint, typecheck, build; fix the
  regressions introduced. Known intermittent failures under load (not regressions; re-run alone):
  Windows vitest worker crash 0xC0000409, Studio `brb`, `alerts-twitch-chain`, `creepy`,
  `word-game-service` events stream.
- Delivery report, concise: what works · what is really incomplete · tests passed / failed ·
  blocking risks for Production · next priority. Say what was tested in the real UI, what only by
  automated tests, and what cannot be verified here. No command histories or repeated
  justifications unless asked. Secondary improvements go to the module's "remaining work" in
  `docs/ROADMAP.md`, never a blocker.

## Raptoru Studio releases

- When a slice that impacts Raptoru Studio (see README "Does a change need a Studio release?") is
  finished, tested, and explicitly validated by the user ("c'est bon", "validé", "go"), commit it
  and run `npm run studio:release` right away. No separate permission is needed to bump, package
  and publish Studio.
- Since 2026-10-21: a lot « validé en local » is not that permission — commit, push and release only
  when Antoni explicitly asks for them.
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
