# Security policy

Raptoru 2.0 is the source of a live Twitch channel's tools. The repository is public; the Production services, their
secrets and their data are not.

## Reporting a vulnerability

Do not open a public issue, pull request or discussion for a vulnerability.

Report it privately through GitHub: **Security → Report a vulnerability** on this repository (private vulnerability
reporting). Include the affected component (Core, bot, Studio, extension, workflow), the steps to reproduce and the
impact you expect. You will get an answer as soon as possible; please give a reasonable delay before any disclosure.

Do not test against the Production services (core.raptoru.fr, the Twitch channel, the extension): use a local
checkout. No reward programme exists.

## Rules for this public repository

- No secret is ever committed: tokens, client secrets, passwords, database URLs with credentials, private keys,
  `.env` files, Twitch token files, backups, dumps, logs or viewer data. Production secrets live only in the hosting
  platform's variables, the GitHub environments and the operator's machine.
- Environment variables are documented without values (`apps/*/.env.example` holds placeholders only).
- A secret pushed by mistake is revoked and rotated first; rewriting the history never replaces that.
- Workflows: least privilege (`contents: read` by default), no `pull_request_target`, actions pinned by SHA, secrets
  only in manually dispatched jobs restricted to the maintainer. Pull requests from forks run CI without secrets and
  after approval.
