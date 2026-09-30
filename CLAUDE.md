# Raptoru 2.0 — working rules

## Resuming work

- Read `Raptoru-2.0-HANDOFF.md` first (current state, validation matrix, pending decisions, next
  step), then `Raptoru-2.0-ETAT-PROJET.md` for history and details. Verify `git status` /
  `git log` yourself before trusting any SHA in a document.
- A validated prototype in `prototypes/` is a specification, not an inspiration: never drop,
  simplify or replace one of its elements silently; show a missing backend as such.
- "Validated" means tested manually by Antoni — never call automated tests or E2E a validation.

## Raptoru Studio releases

- When a slice that impacts Raptoru Studio (see README "Does a change need a Studio release?") is
  finished, tested, and explicitly validated by the user ("c'est bon", "validé", "go"), commit it
  and run `npm run studio:release` right away. No separate permission is needed to bump, package
  and publish Studio.
- Never publish a change that has not been validated. Never bump the Studio version by hand.
- If the release fails, report the failing step and the rollback lines printed by the command
  before doing anything else.
- `studio:release` never pushes the source repository; do not push it either unless asked.
