# Raptoru 2.0 — working rules

## Raptoru Studio releases

- When a slice that impacts Raptoru Studio (see README "Does a change need a Studio release?") is
  finished, tested, and explicitly validated by the user ("c'est bon", "validé", "go"), commit it
  and run `npm run studio:release` right away. No separate permission is needed to bump, package
  and publish Studio.
- Never publish a change that has not been validated. Never bump the Studio version by hand.
- If the release fails, report the failing step and the rollback lines printed by the command
  before doing anything else.
- `studio:release` never pushes the source repository; do not push it either unless asked.
